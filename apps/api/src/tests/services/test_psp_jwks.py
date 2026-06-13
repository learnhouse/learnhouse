import time
import pytest
import jwt as pyjwt  # PyJWT 2.13.0 — the LH backend's JWT library

from src.services.auth import psp_jwks


def _make_token(claims, key="secret", alg="HS256"):
    return pyjwt.encode(claims, key, algorithm=alg)


def test_rejects_untrusted_issuer(monkeypatch):
    monkeypatch.setattr(psp_jwks, "_trusted_issuers", lambda: {"https://trusted/"})
    token = _make_token({"iss": "https://evil/", "email": "a@b.com", "exp": time.time() + 60})
    with pytest.raises(psp_jwks.ShellTokenError):
        psp_jwks.validate_shell_token(token)


def test_extracts_email_for_trusted_issuer(monkeypatch):
    monkeypatch.setattr(psp_jwks, "_trusted_issuers", lambda: {"https://trusted/"})
    monkeypatch.setattr(psp_jwks, "_trusted_audiences", lambda: {"api://default"})
    monkeypatch.setattr(
        psp_jwks,
        "_verify_signature",
        lambda token, iss, auds: {
            "iss": "https://trusted/",
            "aud": "api://default",
            "email": "user@opengov.com",
        },
    )
    token = _make_token({"iss": "https://trusted/"})
    assert psp_jwks.validate_shell_token(token) == "user@opengov.com"


def test_missing_email_raises(monkeypatch):
    monkeypatch.setattr(psp_jwks, "_trusted_issuers", lambda: {"https://trusted/"})
    monkeypatch.setattr(psp_jwks, "_trusted_audiences", lambda: {"api://default"})
    monkeypatch.setattr(
        psp_jwks, "_verify_signature",
        lambda token, iss, auds: {"iss": "https://trusted/", "aud": "api://default"},
    )
    token = _make_token({"iss": "https://trusted/"})
    with pytest.raises(psp_jwks.ShellTokenError):
        psp_jwks.validate_shell_token(token)
