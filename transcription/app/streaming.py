"""Incremental streaming transcription for a single participant audio stream.

Whisper is not a streaming model. We approximate real-time behaviour with a
sliding window: every `stride` seconds we transcribe the trailing `window`
seconds and keep only words that start after the previously committed point.
The overlap region gives the model acoustic context without duplicating text.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Awaitable, Callable

import numpy as np

from .config import settings
from .model_manager import manager

log = logging.getLogger("transcription.stream")

SendFn = Callable[[dict], Awaitable[None]]


class StreamSession:
    def __init__(
        self,
        send: SendFn,
        sample_rate: int = 16000,
        meeting_id: str | None = None,
        participant_id: str | None = None,
    ) -> None:
        self.send = send
        self.sample_rate = sample_rate
        self.meeting_id = meeting_id
        self.participant_id = participant_id

        self.window_sec = max(2.0, settings.chunk_seconds)
        self.stride_sec = max(1.0, min(settings.stride_seconds, self.window_sec - 0.5))
        self.provisional_interval = settings.provisional_interval

        self.buffer = np.zeros(0, dtype=np.float32)
        self.received_samples = 0
        self.committed_until = 0.0
        self.last_commit_at = 0.0
        self.last_provisional_at = -1e9
        self.provisional_id: str | None = None

        self.trigger = asyncio.Event()
        self.stopped = False
        self.task: asyncio.Task | None = None
        self.session_tag = uuid.uuid4().hex[:8]
        self.counter = 0

    # -- audio input ----------------------------------------------------
    def push(self, data: bytes) -> None:
        if not data:
            return
        usable = len(data) - (len(data) % 2)
        samples = np.frombuffer(data[:usable], dtype="<i2").astype(np.float32) / 32768.0
        if samples.size == 0:
            return
        self.buffer = np.concatenate((self.buffer, samples))
        self.received_samples += samples.size
        # Keep a generous backlog so slower-than-real-time inference cannot
        # discard uncommitted speech. The window builder always consumes audio
        # from committed_until forward, not merely the most recent seconds.
        max_samples = int(max(self.window_sec + 2.0, 60.0) * self.sample_rate)
        if self.buffer.size > max_samples:
            self.buffer = self.buffer[-max_samples:]
        self.trigger.set()

    @property
    def now(self) -> float:
        return self.received_samples / self.sample_rate

    def _window(self) -> tuple[np.ndarray, float, float]:
        """Return the next uncommitted audio, with a small acoustic context."""
        now = self.now
        buffer_start = max(0.0, (self.received_samples - self.buffer.size) / self.sample_rate)
        context = min(0.8, self.committed_until)
        start = max(buffer_start, self.committed_until - context)
        end = min(now, max(start + 0.5, self.committed_until + self.window_sec))
        if end <= start:
            return np.zeros(0, dtype=np.float32), start, start
        start_index = max(0, int(round(start * self.sample_rate)) - (self.received_samples - self.buffer.size))
        end_index = min(self.buffer.size, int(round(end * self.sample_rate)) - (self.received_samples - self.buffer.size))
        audio = self.buffer[start_index:end_index]
        return audio, start, end

    # -- lifecycle ------------------------------------------------------
    async def start(self) -> None:
        self.task = asyncio.create_task(self._loop(), name=f"stt-{self.session_tag}")

    async def stop(self) -> None:
        self.stopped = True
        self.trigger.set()
        if self.task:
            try:
                await asyncio.wait_for(self.task, timeout=60)
            except asyncio.TimeoutError:
                self.task.cancel()
        await self._send({"type": "closed", "sessionId": self.session_tag})

    async def _loop(self) -> None:
        while not self.stopped:
            try:
                await asyncio.wait_for(self.trigger.wait(), timeout=0.4)
            except asyncio.TimeoutError:
                pass
            self.trigger.clear()
            now = self.now
            if now >= 0.8 and now - self.last_commit_at >= self.stride_sec:
                await self._commit()
            elif (
                self.provisional_interval > 0
                and now - self.last_provisional_at >= self.provisional_interval
                and now - self.committed_until >= 0.8
            ):
                await self._provisional()

        # Drain the tail so the last sentence is not lost.
        if self.now - self.committed_until >= 0.3:
            await self._commit(force=True, is_final_flush=True)

    async def flush(self) -> None:
        """Force a final commit of all pending audio (used on stop)."""
        if self.now - self.committed_until >= 0.2:
            await self._commit(force=True, is_final_flush=True)

    # -- inference ------------------------------------------------------
    async def _transcribe_window(self) -> tuple[dict | None, float, float] | None:
        audio, window_start, window_end = self._window()
        if audio.size < int(0.5 * self.sample_rate):
            return None
        try:
            result = await asyncio.to_thread(manager.transcribe, audio, settings.language_arg)
        except Exception as exc:  # noqa: BLE001
            log.exception("Transcription failed for %s", self.session_tag)
            await self._send({"type": "error", "message": f"Transcription failed: {exc}"})
            return None
        return result, window_start, window_end

    async def _commit(self, force: bool = False, is_final_flush: bool = False) -> None:
        if not force and self.now - self.last_commit_at < self.stride_sec:
            return
        self.last_commit_at = self.now
        outcome = await self._transcribe_window()
        if outcome is None:
            return
        result, window_start, window_end = outcome
        words = self._absolute_words(result.get("words") or [], window_start)
        cutoff = self.committed_until
        kept = [word for word in words if word["start"] >= cutoff - 0.05]
        self.committed_until = window_end

        if not kept:
            return

        groups = self._group_words(kept)
        replace_id = self.provisional_id
        self.provisional_id = None
        for index, group in enumerate(groups):
            self.counter += 1
            segment = {
                "type": "segment",
                "status": "final",
                "segmentId": f"f-{self.session_tag}-{self.counter}",
                "text": self._clean_text(" ".join(word["word"] for word in group)),
                "startSec": round(group[0]["start"], 3),
                "endSec": round(group[-1]["end"], 3),
                "language": result.get("language"),
                "replaceId": replace_id if index == 0 else None,
                "flush": is_final_flush,
            }
            await self._send(segment)

    async def _provisional(self) -> None:
        self.last_provisional_at = self.now
        outcome = await self._transcribe_window()
        if outcome is None:
            return
        result, window_start, _ = outcome
        words = self._absolute_words(result.get("words") or [], window_start)
        kept = [word for word in words if word["start"] >= self.committed_until - 0.05]
        if not kept:
            return
        previous = self.provisional_id
        self.provisional_id = f"p-{self.session_tag}-{self.counter}-{int(self.last_provisional_at * 1000)}"
        await self._send(
            {
                "type": "segment",
                "status": "provisional",
                "segmentId": self.provisional_id,
                "replaces": previous,
                "text": self._clean_text(" ".join(word["word"] for word in kept)),
                "startSec": round(kept[0]["start"], 3),
                "endSec": round(kept[-1]["end"], 3),
                "language": result.get("language"),
            }
        )

    # -- helpers --------------------------------------------------------
    def _absolute_words(self, words: list[dict], window_start: float) -> list[dict]:
        out = []
        for word in words:
            start = window_start + float(word.get("start", 0.0))
            end = window_start + float(word.get("end", 0.0))
            if end < start:
                end = start
            out.append({"word": str(word.get("word", "")), "start": start, "end": end})
        out.sort(key=lambda item: item["start"])
        return out

    def _group_words(self, words: list[dict], gap: float = 1.2, max_span: float = 15.0) -> list[list[dict]]:
        groups: list[list[dict]] = []
        current: list[dict] = []
        for word in words:
            if not current:
                current = [word]
                continue
            if word["start"] - current[-1]["end"] > gap or word["end"] - current[0]["start"] > max_span:
                groups.append(current)
                current = [word]
            else:
                current.append(word)
        if current:
            groups.append(current)
        return groups

    @staticmethod
    def _clean_text(text: str) -> str:
        cleaned = " ".join(text.split())
        if cleaned and cleaned[0].isalpha():
            cleaned = cleaned[0].upper() + cleaned[1:]
        return cleaned

    async def _send(self, payload: dict) -> None:
        try:
            await self.send(payload)
        except Exception:  # noqa: BLE001 - socket may have gone away
            self.stopped = True
