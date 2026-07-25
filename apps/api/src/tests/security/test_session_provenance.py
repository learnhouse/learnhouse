"""Session provenance (``amr`` / ``sorg``) is stamped at mint and survives the
paths that could silently strip it (MFA completion, refresh)."""


from src.security.auth import decode_jwt
from src.security.session_context import AMR_CLAIM, SORG_CLAIM, session_claims
from src.services.auth.session import (
    create_mfa_pending_token,
    decode_mfa_pending_provenance,
    decode_mfa_pending_token,
    mint_session_tokens,
)


class TestSessionClaims:
    def test_omits_absent_claims(self):
        assert session_claims(None, None) == {}
        assert session_claims("password", None) == {AMR_CLAIM: "password"}
        assert session_claims(None, 7) == {SORG_CLAIM: 7}

    def test_mint_embeds_amr_and_org(self):
        result = mint_session_tokens("a@b.co", amr="password", org_id=42)
        access = decode_jwt(result.access_token)
        refresh = decode_jwt(result.refresh_token)
        assert access[AMR_CLAIM] == "password" and access[SORG_CLAIM] == 42
        # Refresh must carry it too, or rotation would launder the claims away.
        assert refresh[AMR_CLAIM] == "password" and refresh[SORG_CLAIM] == 42
        assert access["purpose"] == "session"

    def test_mint_without_provenance_is_backward_compatible(self):
        access = decode_jwt(mint_session_tokens("a@b.co").access_token)
        assert AMR_CLAIM not in access and SORG_CLAIM not in access
        assert access["purpose"] == "session"


class TestPendingTokenProvenance:
    def test_pending_token_carries_provenance(self):
        token = create_mfa_pending_token("a@b.co", amr="sso", org_id=3)
        assert decode_mfa_pending_token(token) == "a@b.co"
        assert decode_mfa_pending_provenance(token) == ("sso", 3)

    def test_pending_token_without_provenance(self):
        token = create_mfa_pending_token("a@b.co")
        assert decode_mfa_pending_provenance(token) == (None, None)

    def test_pending_provenance_ignores_non_pending_token(self):
        # A session token is not a pending token; decode_mfa_pending_token gates
        # that. Provenance decode is only ever called after that check.
        session = mint_session_tokens("a@b.co", amr="password", org_id=1)
        assert decode_mfa_pending_token(session.access_token) is None
