"""Deterministic local-first wrapper for OpenAI chat-completions clients.

The desktop writes a small, mode-0600 controller file containing only runtime
coordinates and aggregate counters. This module reads that file per request so
an already-running Hermes backend sees setup and policy changes immediately.
Prompt bodies are never persisted.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import secrets
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Iterator


_FRONTIER_PHRASES = ("frontier", "highest quality", "best available", "use cloud")
_SENSITIVE_PREFIXES = ("[sensitive]", "sensitive:", "local-only:")
_PENDING_APPROVALS: dict[str, tuple[str, str, str, float]] = {}
_APPROVAL_TTL_SECONDS = 600


class CloudEscalationApprovalRequired(RuntimeError):
    pass


def _state_path() -> Path | None:
    raw = os.environ.get("HERMES_LOCAL_AI_STATE_PATH", "").strip()
    return Path(raw).expanduser() if raw else None


def _load_state() -> dict[str, Any] | None:
    path = _state_path()
    if path is None:
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    if value.get("schemaVersion") != 1:
        return None
    return value


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = []
    for item in content:
        if isinstance(item, dict) and item.get("type") in {"text", "input_text"}:
            parts.append(str(item.get("text") or ""))
    return "\n".join(parts)


def _latest_user(messages: list[dict[str, Any]]) -> str:
    for message in reversed(messages):
        if message.get("role") == "user":
            return _content_text(message.get("content"))
    return ""


def _is_sensitive(kwargs: dict[str, Any]) -> bool:
    messages = kwargs.get("messages") if isinstance(kwargs.get("messages"), list) else []
    extra_body = kwargs.get("extra_body") if isinstance(kwargs.get("extra_body"), dict) else {}
    sensitivity = str(extra_body.get("sensitivity") or "").strip().lower()

    return sensitivity in {"confidential", "sensitive", "local-only"} or _latest_user(
        messages
    ).strip().lower().startswith(_SENSITIVE_PREFIXES)


def _has_unsupported_modality(messages: list[dict[str, Any]]) -> bool:
    for message in messages:
        content = message.get("content")
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") not in {"text", "input_text"}:
                    return True
    return False


def _estimate_tokens(messages: list[dict[str, Any]]) -> int:
    try:
        return max(1, len(json.dumps(messages, ensure_ascii=False, default=str)) // 4)
    except (TypeError, ValueError):
        return 1


def _route(state: dict[str, Any], kwargs: dict[str, Any]) -> tuple[str, str]:
    mode = state.get("mode") or "cloud-only"
    messages = kwargs.get("messages") if isinstance(kwargs.get("messages"), list) else []
    user_text = _latest_user(messages).strip().lower()
    sensitive = _is_sensitive(kwargs)
    local_available = bool(state.get("endpoint") and state.get("modelId") and state.get("apiKey"))
    reason = "local-capable"

    if mode == "cloud-only":
        return ("blocked", "sensitive-cloud-blocked") if sensitive else ("cloud", "policy-cloud-only")
    if any(phrase in user_text for phrase in _FRONTIER_PHRASES):
        reason = "frontier-requested"
    elif _has_unsupported_modality(messages):
        reason = "unsupported-modality"
    elif _estimate_tokens(messages) > 65_536:
        reason = "context-limit-exceeded"
    elif not local_available:
        reason = "local-unavailable"
    else:
        return "local", reason

    if mode == "local-only" or sensitive:
        return "blocked", "sensitive-cloud-blocked" if sensitive else reason
    return "cloud", reason


def _compact_cloud_kwargs(kwargs: dict[str, Any]) -> dict[str, Any]:
    compact = copy.deepcopy(kwargs)
    messages = kwargs.get("messages") if isinstance(kwargs.get("messages"), list) else []
    system = next((message for message in reversed(messages) if message.get("role") == "system"), None)
    recent = [message for message in messages if message.get("role") != "system"][-12:]
    selected = [message for message in ([system] if system is not None else []) + recent]
    result_ids = {
        str(message.get("tool_call_id"))
        for message in selected
        if message.get("role") == "tool" and message.get("tool_call_id")
    }
    valid_tool_ids = {
        str(call.get("id"))
        for message in selected
        if message.get("role") == "assistant"
        for call in (message.get("tool_calls") or [])
        if call.get("id") in result_ids
    }
    selected = [
        message
        for message in selected
        if message.get("role") != "tool"
        or str(message.get("tool_call_id")) in valid_tool_ids
    ]
    selected = [
        message
        for message in selected
        if not (
            message.get("role") == "assistant"
            and not _content_text(message.get("content"))
            and message.get("tool_calls")
            and not any(str(call.get("id")) in valid_tool_ids for call in message["tool_calls"])
        )
    ]
    content_budget = max(256, 12_000 // max(1, len(selected)))
    bounded: list[dict[str, Any]] = []
    for message in selected:
        copied = copy.deepcopy(message)
        tool_calls = copied.get("tool_calls") if isinstance(copied.get("tool_calls"), list) else []
        if copied.get("role") == "assistant":
            tool_calls = [call for call in tool_calls if str(call.get("id")) in valid_tool_ids]
            if tool_calls:
                copied["tool_calls"] = tool_calls
            else:
                copied.pop("tool_calls", None)
        part_budget = max(64, content_budget // max(1, len(tool_calls) + 1))
        content = copied.get("content")
        if isinstance(content, str) and len(content) > part_budget:
            copied["content"] = content[: part_budget - 1] + "…"
        elif isinstance(content, list):
            serialized = json.dumps(content, separators=(",", ":"))
            if len(serialized) > part_budget:
                copied["content"] = [
                    {"type": "text", "text": "[multimodal content omitted from bounded cloud handoff]"}
                ]
        for call in tool_calls:
            arguments = (call.get("function") or {}).get("arguments")
            if isinstance(arguments, str) and len(arguments) > part_budget:
                call["function"]["arguments"] = '{"truncated":true}'
        if copied.get("role") == "assistant" and not _content_text(copied.get("content")) and not tool_calls:
            continue
        bounded.append(copied)
    compact["messages"] = bounded
    extra_body = compact.get("extra_body")
    if isinstance(extra_body, dict):
        extra_body.pop("ivx_cloud_escalation_approval", None)
    return compact


def _cloud_passthrough_kwargs(kwargs: dict[str, Any]) -> dict[str, Any]:
    passthrough = copy.deepcopy(kwargs)
    extra_body = passthrough.get("extra_body")
    if isinstance(extra_body, dict):
        extra_body.pop("ivx_cloud_escalation_approval", None)

    return passthrough


def _require_cloud_approval(kwargs: dict[str, Any], reason: str) -> dict[str, Any]:
    frozen = _compact_cloud_kwargs(kwargs)
    canonical = json.dumps(frozen, sort_keys=True, separators=(",", ":"), default=str)
    frozen_digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    messages = frozen.get("messages") if isinstance(frozen.get("messages"), list) else []
    handoff_metadata = {
        "messageCount": len(messages),
        "characterCount": len(canonical),
        "estimatedTokens": max(1, len(canonical) // 4),
        "toolResultCount": sum(1 for message in messages if message.get("role") == "tool"),
    }
    try:
        from tools.approval import request_cloud_escalation_approval

        broker_decision = request_cloud_escalation_approval(
            reason=reason,
            provider=str(kwargs.get("model") or "configured cloud provider"),
            request_id=secrets.token_urlsafe(16),
            action_id=secrets.token_urlsafe(16),
            frozen_digest=frozen_digest,
            handoff_metadata=handoff_metadata,
        )
    except ImportError:
        broker_decision = None
    if broker_decision is True:
        return frozen
    if broker_decision is False:
        raise RuntimeError(f"Cloud escalation denied ({reason})")

    extra_body = kwargs.get("extra_body") if isinstance(kwargs.get("extra_body"), dict) else {}
    session_id = str(extra_body.get("session_id") or kwargs.get("session_id") or "").strip()
    if not session_id:
        raise CloudEscalationApprovalRequired(
            json.dumps(
                {
                    "code": "cloud_escalation_session_required",
                    "reason": reason,
                    "disclosure": "Cloud routing was blocked because this request has no session scope.",
                },
                separators=(",", ":"),
            )
        )
    approval = extra_body.get("ivx_cloud_escalation_approval")
    now = time.time()
    for nonce, (_, _, _, expires_at) in list(_PENDING_APPROVALS.items()):
        if expires_at <= now:
            _PENDING_APPROVALS.pop(nonce, None)
    if isinstance(approval, dict):
        nonce = str(approval.get("nonce") or "")
        approved_session = str(approval.get("session_id") or "")
        approved_digest = str(approval.get("frozen_digest") or "")
        pending = _PENDING_APPROVALS.get(nonce)
        if (
            pending
            and pending[0] == session_id == approved_session
            and pending[1] == reason
            and pending[2] == frozen_digest == approved_digest
        ):
            _PENDING_APPROVALS.pop(nonce, None)
            return frozen
    nonce = secrets.token_urlsafe(24)
    _PENDING_APPROVALS[nonce] = (
        session_id,
        reason,
        frozen_digest,
        now + _APPROVAL_TTL_SECONDS,
    )
    raise CloudEscalationApprovalRequired(
        json.dumps(
            {
                "code": "cloud_escalation_approval_required",
                "session_id": session_id,
                "nonce": nonce,
                "frozen_digest": frozen_digest,
                "reason": reason,
                "disclosure": (
                    "A bounded recent conversation and required tool results would be sent "
                    "to the configured cloud provider."
                ),
                "single_use": True,
                "expires_in_seconds": _APPROVAL_TTL_SECONDS,
            },
            separators=(",", ":"),
        )
    )


def _append_metric(
    route: str,
    reason: str,
    input_tokens: int,
    output_tokens: int = 0,
    measurement: str = "estimated",
) -> None:
    state_path = _state_path()
    if state_path is None:
        return
    state = _load_state()
    if not state or state.get("telemetryEnabled") is not True:
        return
    event = {
        "schemaVersion": 1,
        "route": route,
        "reason": reason,
        "inputTokens": max(0, int(input_tokens)),
        "outputTokens": max(0, int(output_tokens)),
        "measurement": measurement,
        "timestamp": time.time(),
    }
    try:
        telemetry_path = state_path.parent / "adaptive-routing.jsonl"
        descriptor = os.open(
            telemetry_path,
            os.O_APPEND | os.O_CREAT | os.O_WRONLY,
            0o600,
        )
        os.chmod(telemetry_path, 0o600)
        with os.fdopen(descriptor, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, separators=(",", ":")) + "\n")
    except OSError:
        pass


def _choice_parts(chunk: Any) -> tuple[str, list[Any], str]:
    choices = getattr(chunk, "choices", None) or []
    if not choices:
        return "", [], ""
    choice = choices[0]
    delta = getattr(choice, "delta", None)
    content = getattr(delta, "content", "") if delta is not None else ""
    tool_calls = getattr(delta, "tool_calls", None) if delta is not None else None
    return content or "", list(tool_calls or []), getattr(choice, "finish_reason", "") or ""


def _stream_quality(chunks: list[Any]) -> tuple[bool, str, int]:
    text_parts: list[str] = []
    arguments: dict[int, str] = {}
    finish_reason = ""
    for chunk in chunks:
        content, tool_calls, finish = _choice_parts(chunk)
        text_parts.append(content)
        finish_reason = finish or finish_reason
        for call in tool_calls:
            index = int(getattr(call, "index", 0) or 0)
            function = getattr(call, "function", None)
            arguments[index] = arguments.get(index, "") + str(getattr(function, "arguments", "") or "")
    for raw in arguments.values():
        try:
            json.loads(raw or "{}")
        except (TypeError, ValueError):
            return False, "local-malformed-tool-json", 0
    text = "".join(text_parts).strip()
    if finish_reason == "length":
        return False, "local-truncated", len(text) // 4
    if not text and not arguments:
        return False, "local-empty-response", 0
    if text.lower().startswith(("i cannot", "i can't", "sorry, i cannot", "sorry, i can't")):
        return False, "local-refusal", len(text) // 4
    return True, "local-quality-passed", max(0, len(text) // 4)


def _stream_usage(chunks: list[Any]) -> tuple[int, int]:
    input_tokens = 0
    output_tokens = 0
    for chunk in chunks:
        usage = getattr(chunk, "usage", None)
        input_tokens = int(getattr(usage, "prompt_tokens", 0) or input_tokens)
        output_tokens = int(getattr(usage, "completion_tokens", 0) or output_tokens)
    return input_tokens, output_tokens


class _BufferedAdaptiveStream:
    def __init__(
        self,
        local_stream: Any,
        cloud_create: Any,
        cloud_kwargs: dict[str, Any],
        mode: str,
        input_tokens: int,
        local_client: Any,
        approval_kwargs: dict[str, Any],
        sensitive: bool,
    ) -> None:
        self._local_stream = local_stream
        self._cloud_create = cloud_create
        self._cloud_kwargs = cloud_kwargs
        self._mode = mode
        self._input_tokens = input_tokens
        self._local_client = local_client
        self._approval_kwargs = approval_kwargs
        self._sensitive = sensitive
        self._selected: Any | None = None

    def _materialize(self) -> Any:
        if self._selected is not None:
            return self._selected
        try:
            chunks = list(self._local_stream)
            passed, reason, output_tokens = _stream_quality(chunks)
            reported_input, reported_output = _stream_usage(chunks)
        except Exception:
            chunks, passed, reason, output_tokens = [], False, "local-transport-failure", 0
            reported_input, reported_output = 0, 0
        self._local_client.close()
        if passed:
            _append_metric(
                "local",
                reason,
                reported_input or self._input_tokens,
                reported_output or output_tokens,
                "runtime-reported" if reported_input or reported_output else "estimated",
            )
            self._selected = chunks
        elif self._mode == "local-only" or self._sensitive:
            raise RuntimeError(f"Local-only inference failed: {reason}")
        else:
            approved_kwargs = _require_cloud_approval(self._approval_kwargs, reason)
            _append_metric("cloud", reason, self._input_tokens)
            self._selected = self._cloud_create(**approved_kwargs)
        return self._selected

    def __iter__(self) -> Iterator[Any]:
        return iter(self._materialize())

    def __enter__(self) -> "_BufferedAdaptiveStream":
        return self

    def __exit__(self, exc_type, exc, traceback) -> bool:
        close = getattr(self._selected or self._local_stream, "close", None)
        if callable(close):
            close()
        return False

    def close(self) -> None:
        close = getattr(self._selected or self._local_stream, "close", None)
        if callable(close):
            close()


class _AdaptiveCompletions:
    def __init__(self, cloud_client: Any) -> None:
        self._cloud_client = cloud_client

    def create(self, **kwargs: Any) -> Any:
        state = _load_state()
        if state is None:
            state_path = _state_path()
            if state_path is not None and state_path.exists():
                raise RuntimeError("Adaptive Local AI state is configured but unreadable; refusing cloud routing")
            return self._cloud_client.chat.completions.create(**kwargs)
        route, reason = _route(state, kwargs)
        messages = kwargs.get("messages") if isinstance(kwargs.get("messages"), list) else []
        input_tokens = _estimate_tokens(messages)
        sensitive = _is_sensitive(kwargs)
        if route == "blocked":
            raise RuntimeError(f"Adaptive Local AI blocked cloud routing: {reason}")
        if route == "cloud":
            if state.get("mode") == "local-first":
                cloud_kwargs = _require_cloud_approval(kwargs, reason)
            else:
                cloud_kwargs = _cloud_passthrough_kwargs(kwargs)
            _append_metric("cloud", reason, input_tokens)
            return self._cloud_client.chat.completions.create(**cloud_kwargs)

        from openai import OpenAI

        local_client = OpenAI(
            base_url=str(state["endpoint"]).rstrip("/") + "/v1",
            api_key=str(state["apiKey"]),
            max_retries=0,
        )
        local_kwargs = copy.deepcopy(kwargs)
        local_kwargs["model"] = state["modelId"]
        cloud_kwargs = _compact_cloud_kwargs(kwargs)
        try:
            local_response = local_client.chat.completions.create(**local_kwargs)
        except Exception:
            local_client.close()
            if state.get("mode") == "local-only" or sensitive:
                raise
            cloud_kwargs = _require_cloud_approval(kwargs, "local-transport-failure")
            _append_metric("cloud", "local-transport-failure", input_tokens)
            return self._cloud_client.chat.completions.create(**cloud_kwargs)
        if kwargs.get("stream"):
            return _BufferedAdaptiveStream(
                local_response,
                self._cloud_client.chat.completions.create,
                cloud_kwargs,
                str(state.get("mode")),
                input_tokens,
                local_client,
                kwargs,
                sensitive,
            )

        choices = getattr(local_response, "choices", None) or []
        message = getattr(choices[0], "message", None) if choices else None
        text = str(getattr(message, "content", "") or "").strip()
        tool_calls = getattr(message, "tool_calls", None) or []
        malformed = False
        for call in tool_calls:
            try:
                json.loads(getattr(getattr(call, "function", None), "arguments", "") or "{}")
            except (TypeError, ValueError):
                malformed = True
                break
        finish = getattr(choices[0], "finish_reason", "") if choices else ""
        passed = bool(text or tool_calls) and not malformed and finish != "length"
        if passed:
            usage = getattr(local_response, "usage", None)
            reported_input = int(getattr(usage, "prompt_tokens", 0) or 0)
            reported_output = int(getattr(usage, "completion_tokens", 0) or 0)
            _append_metric(
                "local",
                "local-quality-passed",
                reported_input or input_tokens,
                reported_output or len(text) // 4,
                "runtime-reported" if reported_input or reported_output else "estimated",
            )
            local_client.close()
            return local_response
        if state.get("mode") == "local-only" or sensitive:
            local_client.close()
            raise RuntimeError("Local-only inference failed deterministic validation")
        cloud_kwargs = _require_cloud_approval(kwargs, "local-validation-failed")
        _append_metric("cloud", "local-validation-failed", input_tokens)
        local_client.close()
        return self._cloud_client.chat.completions.create(**cloud_kwargs)


class AdaptiveLocalClient:
    """Proxy preserving the OpenAI client surface used by Hermes."""

    def __init__(self, cloud_client: Any) -> None:
        self._cloud_client = cloud_client
        self.chat = SimpleNamespace(completions=_AdaptiveCompletions(cloud_client))

    def __getattr__(self, name: str) -> Any:
        return getattr(self._cloud_client, name)

    def close(self) -> None:
        self._cloud_client.close()


def maybe_wrap_client(client: Any, *, api_mode: str, provider: str) -> Any:
    if api_mode != "chat_completions" or provider == "moa" or _state_path() is None:
        return client
    return AdaptiveLocalClient(client)
