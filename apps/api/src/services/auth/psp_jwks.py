"""Provider-agnostic validation of shell-issued JWTs (Auth0 or Okta).

Validation is driven by the token's own `iss` claim — checked against an
allowlist — then OIDC discovery resolves the JWKS. No per-provider branching:
the shell's authProvider only changes which trusted issuer signs the token.
"""

import os
from functools import lru_cache

import httpx
import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWTError



class ShellTokenError(Exception):
    """Raised when a shell JWT is missing, untrusted, or invalid."""


def _trusted_issuers() -> set[str]:
    raw = os.getenv("PSP_TRUSTED_ISSUERS", "")
    return {i.strip().rstrip("/") + "/" for i in raw.split(",") if i.strip()}


def _trusted_audiences() -> set[str]:
    raw = os.getenv("PSP_TRUSTED_AUDIENCES", "")
    return {a.strip() for a in raw.split(",") if a.strip()}


@lru_cache(maxsize=8)
def _discover_jwks_uri(issuer: str) -> str:
    url = issuer.rstrip("/") + "/.well-known/openid-configuration"
    resp = httpx.get(url, timeout=5.0)
    resp.raise_for_status()
    return resp.json()["jwks_uri"]


@lru_cache(maxsize=8)
def _jwks_client(issuer: str) -> PyJWKClient:
    # PyJWKClient fetches + caches the JWKS and selects the signing key by kid.
    return PyJWKClient(_discover_jwks_uri(issuer))


def _verify_signature(token: str, issuer: str, audiences: set[str]) -> dict:
    # `issuer` is the EXACT iss claim string from the token (trailing slash
    # preserved) so PyJWT's equality check matches Auth0 and Okta alike.
    try:
        signing_key = _jwks_client(issuer).get_signing_key_from_jwt(token)
    except Exception as err:  # discovery/network/kid failures → fail closed
        raise ShellTokenError(f"jwks resolution failed: {err}")

    try:
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=issuer,
            options={"verify_aud": False},
        )
    except PyJWTError as err:
        raise ShellTokenError(f"signature/issuer check failed: {err}")

    if audiences:
        raw = claims.get("aud")
        token_auds = {raw} if isinstance(raw, str) else set(raw or [])
        if not (token_auds & audiences):
            raise ShellTokenError("audience not allowed")
    return claims


def validate_shell_token(token: str) -> str:
    """Validate `token` and return the email claim, or raise ShellTokenError."""
    if not token:
        raise ShellTokenError("missing token")
    try:
        unverified = jwt.decode(token, options={"verify_signature": False})
    except PyJWTError as err:
        raise ShellTokenError(f"unparseable token: {err}")

    raw_iss = unverified.get("iss") or ""
    normalized = raw_iss.rstrip("/") + "/"
    if normalized not in _trusted_issuers():
        raise ShellTokenError(f"untrusted issuer: {normalized}")

    claims = _verify_signature(token, raw_iss, _trusted_audiences())
    email = claims.get("email") or claims.get("preferred_username")
    if not email:
        raise ShellTokenError("no email claim in token")
    return email
