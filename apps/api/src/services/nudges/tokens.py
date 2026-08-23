"""
Stateless unsubscribe tokens for lifecycle email.

A token carries the user's UUID and an HMAC over it, so rendering an
unsubscribe link needs nothing but the user row already loaded — no token
table, no extra query, no expiry to sweep.

Trade-off, deliberate: the key is derived from the application's JWT secret, so
rotating that secret invalidates every unsubscribe link already sitting in
people's inboxes. The endpoint therefore treats an unverifiable token as
"expired" and points the reader at their dashboard, rather than returning a
bare 403 to someone who is legitimately trying to opt out.
"""

import base64
import binascii
import functools
import hashlib
import hmac
from typing import Optional

from config.config import get_learnhouse_config

# Bumped if the token format ever changes, so old tokens fail closed rather
# than being reinterpreted under new rules.
_TOKEN_VERSION = "v1"

# Categories are namespaced into the signature so a token minted for lifecycle
# mail can never be replayed to opt someone out of a different category (or
# vice versa) once more categories exist.
CATEGORY_LIFECYCLE = "lifecycle"

_SIGNATURE_LENGTH = 32


@functools.lru_cache(maxsize=1)
def _unsub_secret() -> bytes:
    """Derive the unsubscribe signing key from the application's JWT secret.

    Domain-separated from every other JWT-secret-derived credential (e.g. the
    webhook Fernet key) so a token from one subsystem is meaningless in another.
    """
    secret = get_learnhouse_config().security_config.auth_jwt_secret_key
    return hashlib.sha256(f"learnhouse.unsubscribe.{_TOKEN_VERSION}|".encode() + secret.encode()).digest()


def _sign(user_uuid: str, category: str) -> str:
    return hmac.new(
        _unsub_secret(),
        f"{category}:{user_uuid}".encode(),
        hashlib.sha256,
    ).hexdigest()[:_SIGNATURE_LENGTH]


def make_unsubscribe_token(user_uuid: str, category: str = CATEGORY_LIFECYCLE) -> str:
    """Mint an unsubscribe token for a user. Safe to embed in a URL."""
    payload = base64.urlsafe_b64encode(user_uuid.encode()).decode().rstrip("=")
    return f"{payload}.{_sign(user_uuid, category)}"


def verify_unsubscribe_token(
    token: str, category: str = CATEGORY_LIFECYCLE
) -> Optional[str]:
    """Return the user UUID a token attests to, or None if it doesn't verify.

    Returns None rather than raising: every failure mode here (tampering, a
    rotated secret, a mail client mangling the URL) lands on the same
    user-facing outcome.
    """
    if not token or "." not in token:
        return None

    payload, _, signature = token.rpartition(".")
    if not payload or not signature:
        return None

    # Restore the padding stripped at mint time.
    padded = payload + "=" * (-len(payload) % 4)
    try:
        user_uuid = base64.urlsafe_b64decode(padded.encode()).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return None

    if not user_uuid:
        return None

    if not hmac.compare_digest(signature, _sign(user_uuid, category)):
        return None

    return user_uuid
