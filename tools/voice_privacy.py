"""Authoritative privacy policy for speech transports.

Renderer checks are advisory.  STT/TTS dispatch calls this module immediately
before selecting a provider so local-only desktop policy cannot be bypassed by
another playback or transcription surface.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


VERIFIED_LOCAL_STT_PROVIDERS = frozenset({"local"})
VERIFIED_LOCAL_TTS_PROVIDERS = frozenset({"neutts", "kittentts", "piper", "none"})


def _local_ai_state() -> dict[str, Any]:
    raw = os.environ.get("HERMES_LOCAL_AI_STATE_PATH", "").strip()
    if not raw:
        return {}
    try:
        value = json.loads(Path(raw).expanduser().read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) and value.get("schemaVersion") == 1 else {}


def local_audio_only_required() -> bool:
    """Return whether speech must stay on verified local transports."""
    sensitive = os.environ.get("HERMES_SENSITIVE_MODE", "").strip().lower()
    return sensitive in {"1", "true", "yes", "on"} or _local_ai_state().get("mode") == "local-only"


def enforce_local_stt_provider(config: dict[str, Any], resolved_provider: str) -> None:
    """Fail closed before STT dispatch when local-only policy is active."""
    if not local_audio_only_required():
        return
    configured = str(config.get("provider") or "").strip().lower()
    if configured in {"", "auto"} or resolved_provider not in VERIFIED_LOCAL_STT_PROVIDERS:
        raise PermissionError(
            "Local-only audio requires an explicitly configured, verified local STT provider; "
            f"resolved provider was {resolved_provider or 'unknown'}."
        )


def enforce_local_tts_provider(config: dict[str, Any], resolved_provider: str) -> None:
    """Fail closed before TTS dispatch when local-only policy is active."""
    if not local_audio_only_required():
        return
    configured = str(config.get("provider") or "").strip().lower()
    if configured in {"", "auto"} or resolved_provider not in VERIFIED_LOCAL_TTS_PROVIDERS:
        raise PermissionError(
            "Local-only audio requires verified local TTS (NeuTTS, KittenTTS, or Piper) "
            f"or text-only mode; resolved provider was {resolved_provider or 'unknown'}."
        )
