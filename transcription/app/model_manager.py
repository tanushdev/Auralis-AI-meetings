"""Thread-safe faster-whisper model loading with CPU fallback on CUDA failure."""

from __future__ import annotations

import logging
import threading
from typing import Any

from .config import settings

log = logging.getLogger("transcription.model")


class ModelManager:
    """Lazily loads one WhisperModel and serialises inference moderately."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._model: Any = None
        self._device, self._compute_type = settings.resolved_device()
        self._state = "idle"  # idle | loading | ready | error
        self._error: str | None = None
        self._infer = threading.Semaphore(max(1, settings.concurrency))

    # -- status ---------------------------------------------------------
    @property
    def state(self) -> str:
        return self._state

    @property
    def device(self) -> str:
        return self._device

    @property
    def compute_type(self) -> str:
        return self._compute_type

    def status(self) -> dict[str, Any]:
        return {
            "provider": settings.provider,
            "model": settings.model,
            "device": self._device,
            "computeType": self._compute_type,
            "modelLoaded": self._model is not None,
            "state": self._state,
            "error": self._error,
            "chunkSeconds": settings.chunk_seconds,
            "strideSeconds": settings.stride_seconds,
            "provisionalInterval": settings.provisional_interval,
        }

    # -- loading --------------------------------------------------------
    def _load_locked(self) -> None:
        from faster_whisper import WhisperModel  # imported lazily (heavy)

        self._state = "loading"
        self._error = None
        attempts = [
            (self._device, self._compute_type),
            ("cpu", "int8"),
        ]
        last_error: Exception | None = None
        for device, compute_type in attempts:
            try:
                log.info("Loading Whisper model '%s' on %s (%s)", settings.model, device, compute_type)
                self._model = WhisperModel(
                    settings.model,
                    device=device,
                    compute_type=compute_type,
                    download_root=settings.model_dir or None,
                    num_workers=1,
                    cpu_threads=0,
                )
                self._device = device
                self._compute_type = compute_type
                self._state = "ready"
                log.info("Whisper model ready on %s (%s)", device, compute_type)
                return
            except Exception as exc:  # noqa: BLE001 - we want to fall back on anything
                last_error = exc
                log.warning("Failed to load Whisper on %s (%s): %s", device, compute_type, exc)
                self._model = None
        self._state = "error"
        self._error = str(last_error) if last_error else "unknown model loading error"
        raise RuntimeError(self._error)

    def ensure_loaded(self) -> None:
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            self._load_locked()

    def preload(self) -> None:
        try:
            self.ensure_loaded()
        except Exception as exc:  # noqa: BLE001
            log.error("Preload failed: %s", exc)

    # -- inference ------------------------------------------------------
    def transcribe(self, audio, language: str | None):
        """Transcribe a float32 numpy array. Retries once on CPU after CUDA errors."""
        self.ensure_loaded()
        if self._model is None:
            raise RuntimeError(self._error or "model unavailable")

        model = self._model
        with self._infer:
            try:
                return self._run(model, audio, language)
            except Exception as exc:  # noqa: BLE001
                message = str(exc).lower()
                cuda_problem = self._device == "cuda" or "cuda" in message or "out of memory" in message
                if not cuda_problem:
                    raise
                log.warning("CUDA inference failed (%s); reloading on CPU", exc)
                with self._lock:
                    self._model = None
                    self._device = "cpu"
                    self._compute_type = "int8"
                    self._load_locked()
                    model = self._model
                return self._run(model, audio, language)

    def _run(self, model, audio, language: str | None):
        segments, info = model.transcribe(
            audio,
            language=language,
            beam_size=1,
            best_of=1,
            temperature=0.0,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400},
            word_timestamps=True,
            condition_on_previous_text=False,
        )
        words = []
        full_text: list[str] = []
        for segment in segments:
            text = (segment.text or "").strip()
            if text:
                full_text.append(text)
            for word in segment.words or []:
                token = word.word.strip()
                if token:
                    words.append({"word": token, "start": float(word.start), "end": float(word.end)})
        return {
            "text": " ".join(full_text).strip(),
            "words": words,
            "language": getattr(info, "language", None),
            "languageProbability": float(getattr(info, "language_probability", 0.0) or 0.0),
            "duration": float(getattr(info, "duration", 0.0) or 0.0),
        }


manager = ModelManager()
