"""Resolve whether chat-completions API streaming should be disabled.

Desktop / TUI always register stream consumers, so Hermes prefers
``stream=true`` for LLM calls. Some proxies (notably LiteLLM) intermittently
return empty streams after tool turns (``in=0 out=0``), which surfaces as
``(empty)`` in the UI even though non-streaming calls succeed.

This module is the single chokepoint for forcing the non-stream path for
CLI **and** desktop/TUI (unlike ``display.streaming``, which is CLI-display
only).
"""

from __future__ import annotations

import os
from typing import Any, Mapping, Optional, Tuple


def _env_tri_state(name: str, env: Mapping[str, str]) -> Optional[bool]:
    raw = str(env.get(name, "") or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return None


def _looks_like_litellm(base_url: str, provider: str) -> bool:
    base = (base_url or "").lower()
    prov = (provider or "").lower()
    return "litellm" in base or "litellm" in prov or prov.endswith(":litellm")


def _parse_api_streaming_flag(raw: Any) -> Optional[bool]:
    """Return True/False for explicit enable/disable, None for auto/unset."""
    if raw is None:
        return None
    if isinstance(raw, bool):
        return raw
    text = str(raw).strip().lower()
    if text in ("", "auto", "none"):
        return None
    if text in ("1", "true", "yes", "on"):
        return True
    if text in ("0", "false", "no", "off"):
        return False
    return None


def should_disable_api_streaming(
    *,
    model_cfg: Any = None,
    base_url: str = "",
    provider: str = "",
    env: Optional[Mapping[str, str]] = None,
) -> Tuple[bool, str]:
    """Return ``(disable_streaming, reason)``.

    Precedence:
      1. ``HERMES_DISABLE_API_STREAMING`` env (force on/off)
      2. ``model.api_streaming`` in config.yaml (``false`` → disable)
      3. Auto-disable when base_url/provider looks like LiteLLM
      4. Default: keep streaming enabled
    """
    env_map: Mapping[str, str] = env if env is not None else os.environ
    env_force = _env_tri_state("HERMES_DISABLE_API_STREAMING", env_map)
    if env_force is True:
        return True, "HERMES_DISABLE_API_STREAMING"
    if env_force is False:
        return False, "HERMES_DISABLE_API_STREAMING=0"

    if isinstance(model_cfg, dict) and "api_streaming" in model_cfg:
        enabled = _parse_api_streaming_flag(model_cfg.get("api_streaming"))
        if enabled is not None:
            return (not enabled), "model.api_streaming"

    if _looks_like_litellm(base_url, provider):
        return True, "auto:litellm"

    return False, "default"


def apply_api_streaming_policy(
    agent: Any,
    *,
    model_cfg: Any = None,
    env: Optional[Mapping[str, str]] = None,
) -> str:
    """Set ``agent._disable_streaming`` from config/env/auto. Returns reason."""
    disabled, reason = should_disable_api_streaming(
        model_cfg=model_cfg,
        base_url=str(getattr(agent, "base_url", "") or ""),
        provider=str(getattr(agent, "provider", "") or ""),
        env=env,
    )
    agent._disable_streaming = bool(disabled)
    return reason
