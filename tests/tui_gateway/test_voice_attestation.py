import base64
import hashlib
import hmac
import json
import time

from tui_gateway import server


def _token(key: str, *, expires_at: float) -> str:
    payload = base64.urlsafe_b64encode(
        json.dumps({"exp": expires_at, "nonce": "test", "webContentsId": 1}).encode()
    ).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(
        hmac.new(key.encode(), payload.encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")
    return f"{payload}.{signature}"


def test_voice_attestation_is_authenticated_expiring_and_single_use(monkeypatch):
    key = "test-desktop-key"
    monkeypatch.setenv("HERMES_DESKTOP_VOICE_ATTESTATION_KEY", key)
    server._USED_VOICE_ATTESTATIONS.clear()
    token = _token(key, expires_at=time.time() * 1000 + 60_000)

    assert server._verify_voice_attestation(token) is True
    assert server._verify_voice_attestation(token) is False
    assert server._verify_voice_attestation(_token("wrong", expires_at=time.time() * 1000 + 60_000)) is False
    assert server._verify_voice_attestation(_token(key, expires_at=time.time() * 1000 - 1)) is False
