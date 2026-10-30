"""Local faster-whisper transcription service.

Only ever binds to loopback and requires a shared token on every request.
Audio is processed in memory and never persisted.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from .config import SERVICE_DIR, settings
from .model_manager import manager
from .streaming import StreamSession

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("transcription")

MAX_UPLOAD_BYTES = 25 * 1024 * 1024


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.preload:
        asyncio.create_task(asyncio.to_thread(manager.preload))
    log.info(
        "Transcription service starting: model=%s device=%s compute=%s",
        settings.model,
        manager.device,
        manager.compute_type,
    )
    yield
    log.info("Transcription service stopped")


app = FastAPI(title="Local Transcription Service", version="1.0.0", lifespan=lifespan)


def require_token(
    x_transcription_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> None:
    expected = settings.token
    if not expected:
        raise HTTPException(status_code=503, detail="TRANSCRIPTION_TOKEN is not configured")
    provided = x_transcription_token
    if not provided and authorization and authorization.lower().startswith("bearer "):
        provided = authorization[7:].strip()
    if not provided or provided != expected:
        raise HTTPException(status_code=401, detail="Invalid transcription token")


def ws_authorized(websocket: WebSocket) -> bool:
    expected = settings.token
    if not expected:
        return False
    supplied = websocket.query_params.get("token") or websocket.headers.get("x-transcription-token")
    auth = websocket.headers.get("authorization")
    if not supplied and auth and auth.lower().startswith("bearer "):
        supplied = auth[7:].strip()
    return bool(supplied and supplied == expected)


@app.get("/health")
async def health() -> dict:
    status = manager.status()
    try:
        import faster_whisper  # noqa: F401

        installed = True
    except Exception:  # noqa: BLE001
        installed = False
    return {
        "ok": installed and status["state"] != "error",
        "service": "transcription",
        "timestamp": time.time(),
        "fasterWhisperInstalled": installed,
        **status,
        "cudaAvailable": _cuda_available(),
    }


@app.get("/status")
async def status(_: None = Depends(require_token)) -> dict:
    return manager.status()


@app.post("/transcribe")
async def transcribe_file(
    file: UploadFile = File(...),
    _: None = Depends(require_token),
) -> JSONResponse:
    """Full-file transcription used for verification and manual imports."""
    payload = await file.read()
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 25 MB limit")
    if not payload:
        raise HTTPException(status_code=400, detail="Empty file")

    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    handle, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(handle, "wb") as output:
            output.write(payload)
        try:
            from faster_whisper import decode_audio

            audio = await asyncio.to_thread(decode_audio, path, 16000)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=422, detail=f"Could not decode audio: {exc}") from exc
        result = await asyncio.to_thread(manager.transcribe, audio, settings.language_arg)
        duration = len(audio) / 16000
        return JSONResponse(
            {
                "ok": True,
                "text": result["text"],
                "words": result["words"],
                "language": result["language"],
                "duration": duration,
                "model": settings.model,
                "device": manager.device,
                "computeType": manager.compute_type,
            }
        )
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


@app.websocket("/ws/transcribe")
async def ws_transcribe(websocket: WebSocket) -> None:
    if not ws_authorized(websocket):
        await websocket.accept()
        await websocket.close(code=4401, reason="Unauthorized")
        return

    await websocket.accept()
    send_lock = asyncio.Lock()

    async def send(payload: dict) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    session: StreamSession | None = None
    try:
        hello_raw = await asyncio.wait_for(websocket.receive_json(), timeout=15)
        if hello_raw.get("type") != "hello":
            await send({"type": "error", "message": "Expected hello message"})
            await websocket.close(code=4400)
            return
        sample_rate = int(hello_raw.get("sampleRate", 16000))
        if not 8000 <= sample_rate <= 48000:
            await send({"type": "error", "message": "Unsupported sample rate"})
            await websocket.close(code=4400)
            return

        session = StreamSession(
            send=send,
            sample_rate=sample_rate,
            meeting_id=str(hello_raw.get("meetingId") or ""),
            participant_id=str(hello_raw.get("participantId") or ""),
        )
        await session.start()
        await send(
            {
                "type": "ready",
                "sessionId": session.session_tag,
                "sampleRate": sample_rate,
                "model": settings.model,
                "device": manager.device,
                "computeType": manager.compute_type,
                "chunkSeconds": session.window_sec,
                "strideSeconds": session.stride_sec,
            }
        )

        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            data = message.get("bytes")
            if data:
                session.push(data)
                continue
            text = message.get("text")
            if text:
                try:
                    control = json.loads(text)
                except json.JSONDecodeError:
                    continue
                if control.get("type") == "stop":
                    break
                if control.get("type") == "flush":
                    await session.flush()
    except WebSocketDisconnect:
        pass
    except asyncio.TimeoutError:
        await send({"type": "error", "message": "Timed out waiting for hello"})
    except Exception as exc:  # noqa: BLE001
        log.exception("Transcription websocket failed")
        try:
            await send({"type": "error", "message": str(exc)})
        except Exception:  # noqa: BLE001
            pass
    finally:
        if session:
            try:
                await session.stop()
            except Exception:  # noqa: BLE001
                pass
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass


def _cuda_available() -> bool:
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:  # noqa: BLE001
        return False


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )
