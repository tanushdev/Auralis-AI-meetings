"""Configuration for the local faster-whisper transcription service."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

SERVICE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(SERVICE_DIR / ".env")


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    token: str = field(default_factory=lambda: os.getenv("TRANSCRIPTION_TOKEN", ""))
    provider: str = field(default_factory=lambda: os.getenv("TRANSCRIPTION_PROVIDER", "faster-whisper"))
    model: str = field(default_factory=lambda: os.getenv("WHISPER_MODEL", "small"))
    device: str = field(default_factory=lambda: os.getenv("WHISPER_DEVICE", "auto"))
    compute_type: str = field(default_factory=lambda: os.getenv("WHISPER_COMPUTE_TYPE", "auto"))
    language: str = field(default_factory=lambda: os.getenv("WHISPER_LANGUAGE", "auto"))
    chunk_seconds: float = field(default_factory=lambda: _float("WHISPER_CHUNK_SECONDS", 6.0))
    stride_seconds: float = field(default_factory=lambda: _float("WHISPER_STRIDE_SECONDS", 4.0))
    provisional_interval: float = field(
        default_factory=lambda: _float("WHISPER_PROVISIONAL_INTERVAL", 2.5)
    )
    model_dir: str = field(default_factory=lambda: os.getenv("WHISPER_MODEL_DIR", ""))
    concurrency: int = field(default_factory=lambda: _int("WHISPER_CONCURRENCY", 2))
    preload: bool = field(
        default_factory=lambda: os.getenv("WHISPER_PRELOAD", "1") not in ("0", "false", "False")
    )
    host: str = field(default_factory=lambda: os.getenv("TRANSCRIPTION_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: _int("TRANSCRIPTION_PORT", 8000))

    @property
    def language_arg(self) -> str | None:
        value = self.language.strip().lower()
        if value in ("", "auto", "none"):
            return None
        return value

    def resolved_device(self) -> tuple[str, str]:
        """Return (device, compute_type) with safe local defaults."""
        device = self.device.strip().lower()
        compute = self.compute_type.strip().lower()
        if device == "auto":
            device = "cuda" if _cuda_available() else "cpu"
        if compute == "auto":
            compute = "int8_float16" if device == "cuda" else "int8"
        return device, compute


def _cuda_available() -> bool:
    try:
        import ctranslate2  # type: ignore

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


settings = Settings()
