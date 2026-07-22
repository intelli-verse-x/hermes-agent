import json
import os
import threading
from types import SimpleNamespace

import pytest

from agent.adaptive_local_client import (
    CloudEscalationApprovalRequired,
    _AdaptiveCompletions,
    _append_metric,
    _compact_cloud_kwargs,
    _require_cloud_approval,
    _route,
    _stream_quality,
    _stream_usage,
)


def _state(mode="local-first", available=True):
    return {
        "mode": mode,
        "endpoint": "http://127.0.0.1:8080" if available else None,
        "apiKey": "secret" if available else None,
        "modelId": "local-model" if available else None,
    }


def _kwargs(text="hello"):
    return {
        "model": "cloud-model",
        "messages": [
            {"role": "system", "content": "system"},
            {"role": "user", "content": "old"},
            {"role": "assistant", "content": "old answer"},
            {"role": "user", "content": text},
        ],
    }


def _chunk(content="", finish_reason=None, tool_calls=None):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                delta=SimpleNamespace(content=content, tool_calls=tool_calls or []),
                finish_reason=finish_reason,
            )
        ]
    )


def test_local_only_never_routes_to_cloud():
    route, reason = _route(_state("local-only", available=False), _kwargs())

    assert route == "blocked"
    assert reason == "local-unavailable"


def test_sensitive_cloud_only_request_is_blocked():
    route, reason = _route(_state("cloud-only"), _kwargs("[sensitive] customer record"))

    assert route == "blocked"
    assert reason == "sensitive-cloud-blocked"


def test_missing_controller_file_preserves_first_launch_cloud_route(monkeypatch, tmp_path):
    from agent import adaptive_local_client

    cloud = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=lambda **_kwargs: "cloud")
        )
    )
    missing = tmp_path / "controller.json"
    monkeypatch.setattr(adaptive_local_client, "_state_path", lambda: missing)
    monkeypatch.setattr(adaptive_local_client, "_load_state", lambda: None)

    assert _AdaptiveCompletions(cloud).create(**_kwargs()) == "cloud"


def test_existing_unreadable_controller_file_fails_closed(monkeypatch, tmp_path):
    from agent import adaptive_local_client

    cloud = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=lambda **_kwargs: "cloud")
        )
    )
    unreadable = tmp_path / "controller.json"
    unreadable.write_text("invalid")
    monkeypatch.setattr(adaptive_local_client, "_state_path", lambda: unreadable)
    monkeypatch.setattr(adaptive_local_client, "_load_state", lambda: None)

    with pytest.raises(RuntimeError, match="unreadable"):
        _AdaptiveCompletions(cloud).create(**_kwargs())


def test_frontier_request_routes_directly_to_cloud():
    route, reason = _route(_state(), _kwargs("Use the highest quality frontier model"))

    assert route == "cloud"
    assert reason == "frontier-requested"


def test_compact_handoff_keeps_bounded_recent_conversation_context():
    compact = _compact_cloud_kwargs(_kwargs())

    assert compact["messages"] == [
        {"role": "system", "content": "system"},
        {"role": "user", "content": "old"},
        {"role": "assistant", "content": "old answer"},
        {"role": "user", "content": "hello"},
    ]


def test_compact_handoff_drops_orphan_tool_protocol_and_caps_aggregate_content():
    kwargs = {
        "messages": [
            {"role": "system", "content": "policy"},
            {"role": "user", "content": "x" * 20_000},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "orphan",
                        "type": "function",
                        "function": {"name": "read", "arguments": '{"path":"x"}'},
                    }
                ],
            },
        ]
    }
    compact = _compact_cloud_kwargs(kwargs)

    assert [message["role"] for message in compact["messages"]] == ["system", "user"]
    assert len(json.dumps(compact["messages"])) < 12_500


def test_stream_quality_accepts_text_and_rejects_truncation():
    assert _stream_quality([_chunk("ready"), _chunk(finish_reason="stop")])[:2] == (
        True,
        "local-quality-passed",
    )
    assert _stream_quality([_chunk("partial", finish_reason="length")])[:2] == (
        False,
        "local-truncated",
    )


def test_stream_quality_rejects_malformed_tool_json():
    function = SimpleNamespace(arguments='{"broken"')
    tool_call = SimpleNamespace(index=0, function=function)

    assert _stream_quality([_chunk(tool_calls=[tool_call])])[:2] == (
        False,
        "local-malformed-tool-json",
    )


def test_stream_usage_prefers_runtime_reported_counters():
    chunk = _chunk("ready", finish_reason="stop")
    chunk.usage = SimpleNamespace(prompt_tokens=24, completion_tokens=7)

    assert _stream_usage([chunk]) == (24, 7)


def test_cloud_approval_is_required_single_use_and_session_bound():
    kwargs = {"extra_body": {"session_id": "session-a"}}
    with pytest.raises(CloudEscalationApprovalRequired) as pending:
        _require_cloud_approval(kwargs, "local-transport-failure")
    challenge = json.loads(str(pending.value))

    assert challenge["reason"] == "local-transport-failure"
    assert challenge["single_use"] is True
    wrong = {
        "extra_body": {
            "session_id": "session-b",
            "ivx_cloud_escalation_approval": {
                "session_id": "session-b",
                "nonce": challenge["nonce"],
                "frozen_digest": challenge["frozen_digest"],
            },
        }
    }
    with pytest.raises(CloudEscalationApprovalRequired):
        _require_cloud_approval(wrong, "local-transport-failure")
    approved = {
        "extra_body": {
            "session_id": "session-a",
            "ivx_cloud_escalation_approval": {
                "session_id": "session-a",
                "nonce": challenge["nonce"],
                "frozen_digest": challenge["frozen_digest"],
            },
        }
    }
    _require_cloud_approval(approved, "local-transport-failure")
    with pytest.raises(CloudEscalationApprovalRequired):
        _require_cloud_approval(approved, "local-transport-failure")


def test_create_path_never_contacts_cloud_before_session_approval(monkeypatch):
    calls = []
    cloud = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=lambda **kwargs: calls.append(kwargs) or "cloud")
        )
    )
    monkeypatch.setattr(
        "agent.adaptive_local_client._load_state",
        lambda: {
            "schemaVersion": 1,
            "mode": "local-first",
            "endpoint": None,
            "modelId": None,
        },
    )
    completions = _AdaptiveCompletions(cloud)
    kwargs = {
        "model": "cloud-model",
        "messages": [{"role": "user", "content": "summarize this"}],
        "extra_body": {"session_id": "create-session"},
    }
    with pytest.raises(CloudEscalationApprovalRequired) as pending:
        completions.create(**kwargs)
    assert calls == []
    challenge = json.loads(str(pending.value))
    kwargs["extra_body"]["ivx_cloud_escalation_approval"] = {
        "session_id": "create-session",
        "nonce": challenge["nonce"],
        "frozen_digest": challenge["frozen_digest"],
    }
    assert completions.create(**kwargs) == "cloud"
    assert len(calls) == 1
    assert "ivx_cloud_escalation_approval" not in calls[0]["extra_body"]


def test_gateway_broker_pauses_cloud_and_binds_frozen_action(monkeypatch):
    from tools.approval import (
        register_gateway_notify,
        reset_current_session_key,
        resolve_gateway_approval,
        set_current_session_key,
        unregister_gateway_notify,
    )

    calls = []
    notices = []
    notified = threading.Event()
    cloud = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=lambda **kwargs: calls.append(kwargs) or "cloud")
        )
    )
    monkeypatch.setattr(
        "agent.adaptive_local_client._load_state",
        lambda: {
            "schemaVersion": 1,
            "mode": "local-first",
            "endpoint": None,
            "modelId": None,
        },
    )
    session = "gateway-session"
    token = set_current_session_key(session)
    register_gateway_notify(session, lambda payload: (notices.append(payload), notified.set()))
    result = {}

    def run():
        result["value"] = _AdaptiveCompletions(cloud).create(
            model="cloud/model",
            messages=[{"role": "user", "content": "summarize"}],
        )

    thread = threading.Thread(target=run)
    try:
        # ContextVars do not automatically cross raw threads, mirroring the
        # gateway executor's explicit session binding.
        def bound_run():
            child_token = set_current_session_key(session)
            try:
                run()
            finally:
                reset_current_session_key(child_token)

        thread = threading.Thread(target=bound_run)
        thread.start()
        assert notified.wait(2)
        assert calls == []
        notice = notices[0]
        assert notice["approval_kind"] == "adaptive-cloud"
        assert "handoff_metadata" in notice
        assert resolve_gateway_approval(session, "once", resolve_all=True) == 0
        assert resolve_gateway_approval(session, "once") == 0
        assert resolve_gateway_approval(
            session,
            "once",
            request_id=notice["request_id"],
            action_id=notice["action_id"],
            frozen_digest="wrong",
        ) == 0
        assert calls == []
        assert resolve_gateway_approval(
            session,
            "once",
            request_id=notice["request_id"],
            action_id=notice["action_id"],
            frozen_digest=notice["frozen_digest"],
        ) == 1
        thread.join(2)
        assert not thread.is_alive()
        assert result["value"] == "cloud"
        assert len(calls) == 1
    finally:
        unregister_gateway_notify(session)
        reset_current_session_key(token)


@pytest.mark.parametrize(
    ("mode", "content"),
    [("local-only", "summarize"), ("local-first", "[sensitive] summarize")],
)
def test_private_routes_never_create_broker_or_cloud_call(monkeypatch, mode, content):
    from tools.approval import (
        register_gateway_notify,
        reset_current_session_key,
        set_current_session_key,
        unregister_gateway_notify,
    )

    calls = []
    notices = []
    cloud = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=lambda **kwargs: calls.append(kwargs) or "cloud")
        )
    )
    monkeypatch.setattr(
        "agent.adaptive_local_client._load_state",
        lambda: {"schemaVersion": 1, "mode": mode, "endpoint": None, "modelId": None},
    )
    session = f"private-{mode}"
    token = set_current_session_key(session)
    register_gateway_notify(session, notices.append)
    try:
        with pytest.raises(RuntimeError, match="blocked cloud routing"):
            _AdaptiveCompletions(cloud).create(
                model="cloud/model",
                messages=[{"role": "user", "content": content}],
            )
        assert notices == []
        assert calls == []
    finally:
        unregister_gateway_notify(session)
        reset_current_session_key(token)


def test_trusted_sensitive_metadata_blocks_cloud_without_creating_approval(monkeypatch):
    calls = []
    notices = []
    cloud = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=lambda **kwargs: calls.append(kwargs) or "cloud")
        )
    )
    monkeypatch.setattr(
        "agent.adaptive_local_client._load_state",
        lambda: {"schemaVersion": 1, "mode": "cloud-only", "endpoint": None, "modelId": None},
    )
    from tools import approval

    session = "metadata-sensitive"
    token = approval.set_current_session_key(session)
    approval.register_gateway_notify(session, notices.append)
    try:
        with pytest.raises(RuntimeError, match="blocked cloud routing"):
            _AdaptiveCompletions(cloud).create(
                model="cloud/model",
                messages=[{"role": "user", "content": "summarize"}],
                extra_body={"sensitivity": "confidential"},
            )
        assert notices == []
        assert calls == []
    finally:
        approval.unregister_gateway_notify(session)
        approval.reset_current_session_key(token)


def test_gateway_cloud_approval_expires_fail_closed(monkeypatch):
    from tools import approval

    notices = []
    session = "expiring-cloud-approval"
    token = approval.set_current_session_key(session)
    approval.register_gateway_notify(session, notices.append)
    # Upstream renamed the approval-timeout key (approvals.timeout, read by
    # _get_approval_timeout) — patching the old gateway_timeout key would fall
    # back to the 300s default and hang the suite.
    monkeypatch.setattr(approval, "_get_approval_config", lambda: {"timeout": 0})
    try:
        decision = approval.request_cloud_escalation_approval(
            reason="local-validation-failed",
            provider="provider/model",
            request_id="request",
            action_id="action",
            frozen_digest="digest",
            handoff_metadata={"messageCount": 1},
        )
        assert decision is False
        assert notices[0]["request_id"] == "request"
        assert approval.has_blocking_approval(session) is False
    finally:
        approval.unregister_gateway_notify(session)
        approval.reset_current_session_key(token)


def test_routing_telemetry_is_aggregate_only_and_mode_0600(monkeypatch, tmp_path):
    state_path = tmp_path / "controller.json"
    state_path.write_text(
        json.dumps({"schemaVersion": 1, "telemetryEnabled": True}), encoding="utf-8"
    )
    monkeypatch.setenv("HERMES_LOCAL_AI_STATE_PATH", str(state_path))

    _append_metric("local", "local-quality-passed", 12, 4, "runtime-reported")

    telemetry_path = tmp_path / "adaptive-routing.jsonl"
    event = json.loads(telemetry_path.read_text(encoding="utf-8"))
    if os.name != "nt":
        assert os.stat(telemetry_path).st_mode & 0o777 == 0o600
    assert event["inputTokens"] == 12
    assert event["outputTokens"] == 4
    assert "content" not in event
