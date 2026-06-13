"""Provider-agnostic validation of shell-issued JWTs (Auth0 or Okta).

Validation is driven by the token's own `iss` claim — checked against an
allowlist — then OIDC discovery resolves the JWKS. No per-provider branching:
the shell's authProvider only changes which trusted issuer signs the token.
"""

import os
import time
from functools import lru_cache
from typing import Optional

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
    signing_key = _jwks_client(issuer).get_signing_key_from_jwt(token)
    last_err: Optional[Exception] = None
    for aud in audiences or {None}:
        try:
            return jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                audience=aud,
                issuer=issuer.rstrip("/"),
                options={"verify_aud": aud is not None},
            )
        except PyJWTError as err:
            last_err = err
    raise ShellTokenError(f"signature/audience check failed: {last_err}")


def validate_shell_token(token: str) -> str:
    """Validate `token` and return the email claim, or raise ShellTokenError."""
    if not token:
        raise ShellTokenError("missing token")
    try:
        unverified = jwt.decode(token, options={"verify_signature": False})
    except PyJWTError as err:
        raise ShellTokenError(f"unparseable token: {err}")

    iss = (unverified.get("iss") or "").rstrip("/") + "/"
    if iss not in _trusted_issuers():
        raise ShellTokenError(f"untrusted issuer: {iss}")

    exp = unverified.get("exp")
    if exp is not None and float(exp) < time.time():
        raise ShellTokenError("token expired")

    claims = _verify_signature(token, iss.rstrip("/"), _trusted_audiences())
    email = claims.get("email") or claims.get("preferred_username")
    if not email:
        raise ShellTokenError("no email claim in token")
    return email
