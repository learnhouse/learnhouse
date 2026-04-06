"""
Cryptographic helpers for webhook secrets.

- Fernet symmetric encryption for storing secrets at rest (key derived from JWT secret).
- HMAC-SHA256 for signing outgoing payloads.
"""

import base64
import functools
import hashlib
import hmac

from cryptography.fernet import Fernet

from config.config import get_learnhouse_config


@functools.lru_cache(maxsize=1)
def _fernet_key() -> bytes:
    """Derive a 32-byte Fernet key from the application's JWT secret."""
    secret = get_learnhouse_config().security_config.auth_jwt_secret_key
    digest = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a webhook signing secret for database storage."""
    f = Fernet(_fernet_key())
    return f.encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a stored webhook signing secret."""
    f = Fernet(_fernet_key())
    return f.decrypt(ciphertext.encode()).decode()


def compute_signature(payload: bytes, secret: str) -> str:
    """
    Compute an HMAC-SHA256 signature for a webhook payload.

    Returns a string in the form ``sha256=<hex_digest>``, matching the
    convention used by GitHub, Stripe, and supported by Zapier / Make.com.
    """
    mac = hmac.new(secret.encode(), payload, hashlib.sha256)
    return f"sha256={mac.hexdigest()}"
