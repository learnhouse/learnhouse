"""Unit tests for moyasar_utils. No network, no DB writes."""
import hashlib
import hmac
import os

import pytest
from fastapi import HTTPException

from ee.services.payments.utils import moyasar_utils


class TestEncryption:
    def test_encrypt_decrypt_round_trip(self):
        plain = "sk_test_abcdef1234567890"
        cipher = moyasar_utils.encrypt_secret(plain)
        assert cipher != plain
        assert cipher.startswith("gAAAAA")
        assert moyasar_utils.decrypt_secret(cipher) == plain

    def test_decrypt_invalid_token_raises_http_500(self):
        with pytest.raises(HTTPException) as exc:
            moyasar_utils.decrypt_secret("not-a-valid-fernet-token")
        assert exc.value.status_code == 500
        assert "decrypt" in exc.value.detail.lower()

    def test_encrypt_nondeterministic_but_round_trips(self):
        """Fernet uses a random nonce — each call produces a different token,
        but both must round-trip correctly."""
        plain = "whsec_xyz"
        c1 = moyasar_utils.encrypt_secret(plain)
        c2 = moyasar_utils.encrypt_secret(plain)
        assert c1 != c2  # nonce differs
        assert moyasar_utils.decrypt_secret(c1) == plain
        assert moyasar_utils.decrypt_secret(c2) == plain


class TestWebhookSignature:
    """Verify HMAC-SHA256 signature logic against the Moyasar spec.

    Moyasar signs the raw request body with HMAC-SHA256 keyed by the
    shared_secret and places the hex digest in x-moyasar-signature.
    """

    def _make_sig(self, secret: str, body: bytes) -> str:
        return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    def test_valid_signature_passes(self):
        body = b'{"type":"invoice_paid","data":{"id":"inv_123"}}'
        secret = "whsec_test_secret"
        sig = self._make_sig(secret, body)
        # Should not raise
        moyasar_utils.verify_webhook_signature(body, sig, secret)

    def test_wrong_signature_raises_400(self):
        body = b'{"type":"invoice_paid"}'
        secret = "whsec_real"
        bad_sig = self._make_sig("whsec_wrong", body)
        with pytest.raises(HTTPException) as exc:
            moyasar_utils.verify_webhook_signature(body, bad_sig, secret)
        assert exc.value.status_code == 400

    def test_missing_signature_raises_400(self):
        with pytest.raises(HTTPException) as exc:
            moyasar_utils.verify_webhook_signature(b"body", "", "secret")
        assert exc.value.status_code == 400

    def test_tampered_body_raises_400(self):
        body = b'{"type":"invoice_paid","amount":100}'
        secret = "whsec_s"
        sig = self._make_sig(secret, body)
        tampered = b'{"type":"invoice_paid","amount":999}'
        with pytest.raises(HTTPException) as exc:
            moyasar_utils.verify_webhook_signature(tampered, sig, secret)
        assert exc.value.status_code == 400


class TestAmountConversion:
    def test_integer(self):
        assert moyasar_utils.to_halalas(10) == 1000

    def test_float(self):
        assert moyasar_utils.to_halalas(10.50) == 1050

    def test_rounding_half_up(self):
        # 10.005 → 1000.5 → rounds to 1001
        assert moyasar_utils.to_halalas(10.005) == 1001

    def test_currency_validation_passes(self):
        moyasar_utils.validate_currency("SAR")
        moyasar_utils.validate_currency("sar")  # case-insensitive

    def test_currency_validation_rejects_unknown(self):
        with pytest.raises(HTTPException) as exc:
            moyasar_utils.validate_currency("XYZ")
        assert exc.value.status_code == 400
