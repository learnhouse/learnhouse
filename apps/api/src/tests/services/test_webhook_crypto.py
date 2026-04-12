import pytest

from src.services.webhooks.crypto import (
    compute_signature,
    decrypt_secret,
    encrypt_secret,
)


@pytest.fixture(autouse=True)
def clear_fernet_cache():
    from src.services.webhooks.crypto import _fernet_key

    _fernet_key.cache_clear()
    yield
    _fernet_key.cache_clear()


class TestEncryptDecrypt:
    """Tests for Fernet encrypt/decrypt helpers."""

    def test_encrypt_decrypt_roundtrip(self):
        plaintext = "my-webhook-secret-123"
        ciphertext = encrypt_secret(plaintext)
        assert decrypt_secret(ciphertext) == plaintext

    def test_encrypt_produces_different_ciphertext(self):
        plaintext = "same-secret"
        ct1 = encrypt_secret(plaintext)
        ct2 = encrypt_secret(plaintext)
        assert ct1 != ct2

    def test_decrypt_invalid_ciphertext_raises(self):
        with pytest.raises(Exception):
            decrypt_secret("not-valid-fernet-token")


class TestComputeSignature:
    """Tests for HMAC-SHA256 signature computation."""

    def test_compute_signature_format(self):
        sig = compute_signature(b"payload", "secret")
        assert sig.startswith("sha256=")

    def test_compute_signature_deterministic(self):
        payload = b'{"event": "ping"}'
        secret = "deterministic-secret"
        sig1 = compute_signature(payload, secret)
        sig2 = compute_signature(payload, secret)
        assert sig1 == sig2

    def test_compute_signature_differs_with_different_secret(self):
        payload = b'{"event": "ping"}'
        sig1 = compute_signature(payload, "secret-a")
        sig2 = compute_signature(payload, "secret-b")
        assert sig1 != sig2
