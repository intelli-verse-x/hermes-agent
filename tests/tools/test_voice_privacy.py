import json

import pytest

from tools.voice_privacy import (
    enforce_local_stt_provider,
    enforce_local_tts_provider,
    local_audio_only_required,
)


@pytest.fixture
def local_only_state(tmp_path, monkeypatch):
    state = tmp_path / "controller.json"
    state.write_text(json.dumps({"schemaVersion": 1, "mode": "local-only"}))
    monkeypatch.setenv("HERMES_LOCAL_AI_STATE_PATH", str(state))
    monkeypatch.delenv("HERMES_SENSITIVE_MODE", raising=False)
    return state


def test_local_only_policy_reads_controller_state(local_only_state):
    assert local_audio_only_required() is True


@pytest.mark.parametrize(
    ("config", "resolved"),
    [
        ({}, "local"),
        ({"provider": "auto"}, "local"),
        ({"provider": "groq"}, "groq"),
        ({"provider": "openai"}, "openai"),
    ],
)
def test_local_only_stt_blocks_unverified_or_implicit_routes_before_transport(
    local_only_state, config, resolved
):
    transport_calls = []
    with pytest.raises(PermissionError):
        enforce_local_stt_provider(config, resolved)
    assert transport_calls == []


def test_local_only_stt_allows_explicit_verified_local_route(local_only_state):
    enforce_local_stt_provider({"provider": "local"}, "local")


@pytest.mark.parametrize(
    ("config", "resolved"),
    [
        ({}, "edge"),
        ({"provider": "auto"}, "edge"),
        ({"provider": "edge"}, "edge"),
        ({"provider": "openai"}, "openai"),
        ({"provider": "custom-cloud"}, "custom-cloud"),
    ],
)
def test_local_only_tts_blocks_cloud_and_unknown_routes_before_transport(
    local_only_state, config, resolved
):
    transport_calls = []
    with pytest.raises(PermissionError):
        enforce_local_tts_provider(config, resolved)
    assert transport_calls == []


@pytest.mark.parametrize("provider", ["neutts", "kittentts", "piper", "none"])
def test_local_only_tts_allows_only_verified_local_or_text_only(local_only_state, provider):
    enforce_local_tts_provider({"provider": provider}, provider)


@pytest.mark.parametrize(("configured", "resolved"), [({}, "local"), ({"provider": "auto"}, "groq"), ({"provider": "groq"}, "groq"), ({"provider": "openai"}, "openai")])
def test_transcribe_entrypoint_makes_zero_external_calls_when_blocked(
    local_only_state, monkeypatch, configured, resolved
):
    from tools import transcription_tools

    calls = []
    monkeypatch.setattr(transcription_tools, "_validate_audio_file", lambda _path: None)
    monkeypatch.setattr(transcription_tools, "_load_stt_config", lambda: configured)
    monkeypatch.setattr(transcription_tools, "_get_provider", lambda _config: resolved)
    monkeypatch.setattr(transcription_tools, "_transcribe_groq", lambda *_args: calls.append("groq"))
    monkeypatch.setattr(transcription_tools, "_transcribe_openai", lambda *_args: calls.append("openai"))
    monkeypatch.setattr(transcription_tools, "_transcribe_local", lambda *_args: calls.append("local"))

    result = transcription_tools.transcribe_audio("/tmp/test.wav")

    assert result["policy_blocked"] is True
    assert calls == []


@pytest.mark.parametrize("provider", ["edge", "openai"])
def test_tts_entrypoint_makes_zero_external_calls_when_blocked(local_only_state, monkeypatch, provider):
    from tools import tts_tool

    calls = []
    monkeypatch.setattr(tts_tool, "_load_tts_config", lambda: {"provider": provider})
    monkeypatch.setattr(tts_tool, "_generate_openai_tts", lambda *_args: calls.append("openai"))
    monkeypatch.setattr(tts_tool, "_generate_edge_tts", lambda *_args: calls.append("edge"))

    result = json.loads(tts_tool.text_to_speech_tool("hello"))

    assert result["policy_blocked"] is True
    assert calls == []
