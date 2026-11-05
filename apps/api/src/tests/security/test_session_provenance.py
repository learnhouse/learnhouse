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


def test_lms_sessions_cannot_change_account_security():
    """A session an LMS launch started is held to that org: it may never
    delete the account or touch its second factor, email or password."""
    import pytest
    from fastapi import HTTPException

    from src.security.session_context import (
        SessionProvenance,
        refuse_lms_session,
        set_session_provenance,
    )

    try:
        set_session_provenance(SessionProvenance(amr="lti", org_id=1))
        with pytest.raises(HTTPException) as exc:
            refuse_lms_session()
        assert exc.value.status_code == 403
        assert exc.value.detail["code"] == "LMS_SESSION_NOT_ALLOWED"
        for amr in ("password", "google", "sso", None):
            set_session_provenance(SessionProvenance(amr=amr, org_id=1))
            refuse_lms_session()
        set_session_provenance(None)
        refuse_lms_session()
    finally:
        set_session_provenance(None)


def test_held_org_covers_lms_and_custom_domain_sessions():
    import pytest
    from fastapi import HTTPException

    from src.security.session_context import (
        SessionProvenance,
        held_org_id,
        refuse_outside_held_org,
        set_session_provenance,
    )

    try:
        for provenance, held in (
            (SessionProvenance(amr="lti", org_id=3), 3),
            (SessionProvenance(amr="password", org_id=3, custom_domain=True), 3),
            (SessionProvenance(amr="password", org_id=3), None),
            (SessionProvenance(amr="lti", org_id=None), None),
            (None, None),
        ):
            set_session_provenance(provenance)
            assert held_org_id() == held
        set_session_provenance(SessionProvenance(amr="lti", org_id=3))
        refuse_outside_held_org(3)
        with pytest.raises(HTTPException) as exc:
            refuse_outside_held_org(4)
        assert exc.value.status_code == 403
    finally:
        set_session_provenance(None)



class TestLoginTracking:
    """``user_logged_in`` is recorded once per minted session, never for a
    pending MFA challenge, and only when the session belongs to an org."""

    async def test_track_login_maps_methods_and_skips_orgless(self):
        from unittest.mock import AsyncMock, patch

        from src.services.auth.session import track_login

        with patch("src.services.auth.session.track", new_callable=AsyncMock) as mock_track:
            await track_login(5, "password", 9)
            await track_login(5, "api_token", 9)
            await track_login(None, None, 9)
            await track_login(5, "google", None)

        calls = [c.kwargs for c in mock_track.await_args_list]
        assert calls == [
            {"event_name": "user_logged_in", "org_id": 9, "user_id": 5, "properties": {"login_method": "password"}},
            {"event_name": "user_logged_in", "org_id": 9, "user_id": 5, "properties": {"login_method": "token_exchange"}},
            {"event_name": "user_logged_in", "org_id": 9, "user_id": 0, "properties": {"login_method": "unknown"}},
        ]

    async def test_issue_session_tracks_only_real_sessions(self):
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, patch

        from src.services.auth.session import issue_session_or_challenge

        user = SimpleNamespace(id=3, email="a@b.co")
        with patch("src.services.auth.session.track", new_callable=AsyncMock) as mock_track, \
             patch("src.services.auth.session.is_mfa_active", new_callable=AsyncMock, return_value=False):
            result = await issue_session_or_challenge(None, user, amr="magic_login", org_id=4)
        assert result.mfa_required is False
        mock_track.assert_awaited_once_with(
            event_name="user_logged_in",
            org_id=4,
            user_id=3,
            properties={"login_method": "magic_login"},
        )

        with patch("src.services.auth.session.track", new_callable=AsyncMock) as mock_track, \
             patch("src.services.auth.session.is_mfa_active", new_callable=AsyncMock, return_value=True):
            result = await issue_session_or_challenge(None, user, amr="password", org_id=4)
        assert result.mfa_required is True
        mock_track.assert_not_awaited()
