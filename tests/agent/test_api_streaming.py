"""Tests for agent.api_streaming — desktop/LiteLLM non-stream policy."""

from __future__ import annotations

from types import SimpleNamespace

from agent.api_streaming import (
    apply_api_streaming_policy,
    should_disable_api_streaming,
)


def test_env_force_disable():
    disabled, reason = should_disable_api_streaming(
        model_cfg={},
        base_url="https://api.openai.com/v1",
        provider="openai",
        env={"HERMES_DISABLE_API_STREAMING": "1"},
    )
    assert disabled is True
    assert reason == "HERMES_DISABLE_API_STREAMING"


def test_env_force_enable_overrides_litellm():
    disabled, reason = should_disable_api_streaming(
        model_cfg={},
        base_url="https://litellm.intelli-verse-x.ai/v1",
        provider="custom:litellm",
        env={"HERMES_DISABLE_API_STREAMING": "0"},
    )
    assert disabled is False
    assert reason == "HERMES_DISABLE_API_STREAMING=0"


def test_config_api_streaming_false():
    disabled, reason = should_disable_api_streaming(
        model_cfg={"api_streaming": False},
        base_url="https://api.openai.com/v1",
        provider="openai",
        env={},
    )
    assert disabled is True
    assert reason == "model.api_streaming"


def test_config_api_streaming_true():
    disabled, reason = should_disable_api_streaming(
        model_cfg={"api_streaming": True},
        base_url="https://litellm.intelli-verse-x.ai/v1",
        provider="custom:litellm",
        env={},
    )
    assert disabled is False
    assert reason == "model.api_streaming"


def test_auto_litellm_base_url():
    disabled, reason = should_disable_api_streaming(
        model_cfg={},
        base_url="https://litellm.intelli-verse-x.ai/v1",
        provider="custom",
        env={},
    )
    assert disabled is True
    assert reason == "auto:litellm"


def test_auto_litellm_provider():
    disabled, reason = should_disable_api_streaming(
        model_cfg={},
        base_url="https://proxy.example/v1",
        provider="custom:litellm",
        env={},
    )
    assert disabled is True
    assert reason == "auto:litellm"


def test_default_keeps_streaming():
    disabled, reason = should_disable_api_streaming(
        model_cfg={},
        base_url="https://api.openai.com/v1",
        provider="openai",
        env={},
    )
    assert disabled is False
    assert reason == "default"


def test_apply_sets_agent_flag():
    agent = SimpleNamespace(base_url="https://litellm.example/v1", provider="custom")
    reason = apply_api_streaming_policy(agent, model_cfg={}, env={})
    assert reason == "auto:litellm"
    assert agent._disable_streaming is True
