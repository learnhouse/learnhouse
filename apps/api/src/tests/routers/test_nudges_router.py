"""Router tests for src/routers/nudges.py (public unsubscribe)."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.nudges import EmailPreference
from src.routers.nudges import public_router
from src.services.nudges.tokens import make_unsubscribe_token


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(public_router, prefix="/api/v1/emails")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


async def _prefs(db, user_id: int):
    return (
        await db.execute(
            select(EmailPreference).where(EmailPreference.user_id == user_id)
        )
    ).scalars().first()


class TestUnsubscribeGet:
    async def test_get_renders_a_confirmation_page(self, client, db, admin_user):
        token = make_unsubscribe_token(admin_user.user_uuid)
        response = await client.get(f"/api/v1/emails/unsubscribe?token={token}")

        assert response.status_code == 200
        assert "Confirm unsubscribe" in response.text
        assert admin_user.email in response.text

    async def test_get_has_no_side_effect(self, client, db, admin_user):
        """Link scanners prefetch every href; a mutating GET would opt people
        out who never clicked anything."""
        token = make_unsubscribe_token(admin_user.user_uuid)
        await client.get(f"/api/v1/emails/unsubscribe?token={token}")

        assert await _prefs(db, admin_user.id) is None

    async def test_get_with_bad_token_shows_the_expired_page(self, client, db):
        response = await client.get("/api/v1/emails/unsubscribe?token=garbage.abc")

        assert response.status_code == 200
        assert "expired" in response.text.lower()

    async def test_get_for_unknown_user_shows_the_expired_page(self, client, db):
        # Signature verifies, but no such user — must not 500.
        token = make_unsubscribe_token("user_does_not_exist")
        response = await client.get(f"/api/v1/emails/unsubscribe?token={token}")

        assert response.status_code == 200
        assert "expired" in response.text.lower()

    async def test_get_without_a_token_is_a_validation_error(self, client):
        response = await client.get("/api/v1/emails/unsubscribe")
        assert response.status_code == 422


class TestUnsubscribePost:
    async def test_post_records_the_opt_out(self, client, db, admin_user):
        token = make_unsubscribe_token(admin_user.user_uuid)
        response = await client.post(
            "/api/v1/emails/unsubscribe", data={"token": token}
        )

        assert response.status_code == 200
        assert "unsubscribed" in response.text.lower()

        pref = await _prefs(db, admin_user.id)
        assert pref is not None
        assert pref.lifecycle_opt_out is True
        assert pref.unsubscribed_at is not None
        assert pref.source == "email_link"

    async def test_post_is_idempotent(self, client, db, admin_user):
        """One-click unsubscribe gets retried by providers, and people
        double-click. The second call must not error or move the timestamp."""
        token = make_unsubscribe_token(admin_user.user_uuid)
        await client.post("/api/v1/emails/unsubscribe", data={"token": token})
        first = await _prefs(db, admin_user.id)
        first_stamp = first.unsubscribed_at

        response = await client.post(
            "/api/v1/emails/unsubscribe", data={"token": token}
        )
        assert response.status_code == 200

        await db.refresh(first)
        assert first.lifecycle_opt_out is True
        assert first.unsubscribed_at == first_stamp

    async def test_post_accepts_the_token_in_the_query_string(self, client, db, admin_user):
        """RFC 8058 one-click posts without a form body."""
        token = make_unsubscribe_token(admin_user.user_uuid)
        response = await client.post(f"/api/v1/emails/unsubscribe?token={token}")

        assert response.status_code == 200
        pref = await _prefs(db, admin_user.id)
        assert pref is not None and pref.lifecycle_opt_out is True

    async def test_post_with_a_tampered_token_changes_nothing(self, client, db, admin_user):
        token = make_unsubscribe_token(admin_user.user_uuid)
        payload, _, signature = token.rpartition(".")
        forged = f"{payload}.{'0' * len(signature)}"

        response = await client.post(
            "/api/v1/emails/unsubscribe", data={"token": forged}
        )

        assert response.status_code == 200
        assert "expired" in response.text.lower()
        assert await _prefs(db, admin_user.id) is None

    async def test_post_without_a_token_shows_the_expired_page(self, client, db):
        response = await client.post("/api/v1/emails/unsubscribe")

        assert response.status_code == 200
        assert "expired" in response.text.lower()


class TestRouterMounting:
    def test_unsubscribe_routes_carry_no_auth_dependency(self):
        """The recipient of a nudge may have no session at all — the HMAC
        token is the only authorisation these routes get."""
        for route in public_router.routes:
            assert route.dependencies == [], route.path


class TestDeletedUser:
    async def test_token_for_a_deleted_user_shows_the_expired_page(
        self, client, db, admin_user
    ):
        """The token stays valid forever by design, so it outlives the account
        it names. That must not 500."""
        from sqlmodel import delete

        from src.db.nudges import EmailPreference
        from src.db.users import User

        token = make_unsubscribe_token(admin_user.user_uuid)
        await db.execute(delete(EmailPreference).where(EmailPreference.user_id == admin_user.id))
        await db.execute(delete(User).where(User.id == admin_user.id))
        await db.commit()

        response = await client.post(
            "/api/v1/emails/unsubscribe", data={"token": token}
        )

        assert response.status_code == 200
        assert "expired" in response.text.lower()


def _svix_sign(payload: str, secret: str, msg_id: str = "msg_1", ts: int | None = None):
    """Produce the headers Resend would send.

    Mirrors the scheme `resend.Webhooks.verify` checks: HMAC-SHA256 over
    "{id}.{timestamp}.{payload}" keyed by the base64-decoded signing secret.
    """
    import base64
    import hashlib
    import hmac
    import time

    ts = ts if ts is not None else int(time.time())
    key = base64.b64decode(secret.removeprefix("whsec_"))
    signed = f"{msg_id}.{ts}.{payload}".encode()
    sig = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
    return {
        "svix-id": msg_id,
        "svix-timestamp": str(ts),
        "svix-signature": f"v1,{sig}",
        "content-type": "application/json",
    }


SIGNING_SECRET = "whsec_" + __import__("base64").b64encode(b"test-signing-key").decode()


class TestDeliveryEvents:
    """The provider callback that stops us mailing dead or hostile addresses."""

    @pytest.fixture
    def app_with_internal(self, db, monkeypatch):
        from fastapi import FastAPI

        from src.routers.nudges import internal_router

        monkeypatch.setenv("LEARNHOUSE_RESEND_WEBHOOK_SECRET", SIGNING_SECRET)
        app = FastAPI()
        app.include_router(internal_router, prefix="/api/v1/internal/emails")
        app.dependency_overrides[get_db_session] = lambda: db
        yield app
        app.dependency_overrides.clear()

    @pytest.fixture
    async def wclient(self, app_with_internal):
        async with AsyncClient(
            transport=ASGITransport(app=app_with_internal), base_url="http://test"
        ) as c:
            yield c

    async def _prefs(self, db, user_id):
        from src.db.nudges import EmailPreference

        return (
            await db.execute(
                select(EmailPreference).where(EmailPreference.user_id == user_id)
            )
        ).scalars().first()

    async def _post(self, wclient, body: dict, **sign_kwargs):
        import json as _json

        payload = _json.dumps(body)
        return await wclient.post(
            "/api/v1/internal/emails/delivery-events",
            headers=_svix_sign(payload, SIGNING_SECRET, **sign_kwargs),
            content=payload,
        )

    async def test_permanent_bounce_suppresses(self, wclient, db, admin_user):
        """Resend says "Permanent", not "hard" — getting this wrong means the
        endpoint silently discards every real bounce."""
        r = await self._post(
            wclient,
            {
                "type": "email.bounced",
                "data": {
                    "to": [admin_user.email],
                    "bounce": {"type": "Permanent", "subType": "General", "message": "no such user"},
                },
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["suppressed"] == 1
        assert (await self._prefs(db, admin_user.id)).suppressed is True

    async def test_temporary_bounce_does_not_suppress(self, wclient, db, admin_user):
        """A full mailbox is not a dead address."""
        r = await self._post(
            wclient,
            {
                "type": "email.bounced",
                "data": {"to": [admin_user.email], "bounce": {"type": "Temporary"}},
            },
        )
        assert r.status_code == 200
        assert "non-permanent" in r.json()["reason"]
        assert await self._prefs(db, admin_user.id) is None

    async def test_bounce_without_a_type_is_not_suppressed(self, wclient, db, admin_user):
        """Unknown shape: leave the address alone rather than guess."""
        await self._post(
            wclient, {"type": "email.bounced", "data": {"to": [admin_user.email]}}
        )
        assert await self._prefs(db, admin_user.id) is None

    async def test_complaint_suppresses(self, wclient, db, admin_user):
        r = await self._post(
            wclient, {"type": "email.complained", "data": {"to": admin_user.email}}
        )
        assert r.json()["reason"] == "complaint"
        pref = await self._prefs(db, admin_user.id)
        assert pref.suppressed is True and pref.suppressed_reason == "complaint"

    async def test_provider_suppression_is_mirrored(self, wclient, db, admin_user):
        r = await self._post(
            wclient, {"type": "email.suppressed", "data": {"to": [admin_user.email]}}
        )
        assert r.json()["suppressed"] == 1

    async def test_unhandled_event_is_ignored(self, wclient, db, admin_user):
        r = await self._post(
            wclient, {"type": "email.delivered", "data": {"to": admin_user.email}}
        )
        assert r.json()["reason"] == "unhandled event"
        assert await self._prefs(db, admin_user.id) is None

    async def test_a_forged_signature_is_rejected(self, wclient, db, admin_user):
        import json as _json

        payload = _json.dumps(
            {"type": "email.complained", "data": {"to": admin_user.email}}
        )
        headers = _svix_sign(payload, SIGNING_SECRET)
        headers["svix-signature"] = "v1,Zm9yZ2Vk"
        r = await wclient.post(
            "/api/v1/internal/emails/delivery-events", headers=headers, content=payload
        )
        assert r.status_code == 403
        assert await self._prefs(db, admin_user.id) is None

    async def test_a_tampered_body_is_rejected(self, wclient, db, admin_user):
        """The signature covers the body, so editing it after signing fails."""
        import json as _json

        signed = _json.dumps({"type": "email.delivered", "data": {"to": "x@y.z"}})
        headers = _svix_sign(signed, SIGNING_SECRET)
        tampered = _json.dumps(
            {"type": "email.complained", "data": {"to": admin_user.email}}
        )
        r = await wclient.post(
            "/api/v1/internal/emails/delivery-events", headers=headers, content=tampered
        )
        assert r.status_code == 403

    async def test_a_stale_timestamp_is_rejected(self, wclient, db, admin_user):
        """Replay protection: an old capture cannot be resent."""
        import time

        r = await self._post(
            wclient,
            {"type": "email.complained", "data": {"to": admin_user.email}},
            ts=int(time.time()) - 60 * 60 * 24,
        )
        assert r.status_code == 403

    async def test_missing_svix_headers_are_rejected(self, wclient, admin_user):
        r = await wclient.post(
            "/api/v1/internal/emails/delivery-events",
            json={"type": "email.complained", "data": {"to": admin_user.email}},
        )
        assert r.status_code == 403

    async def test_unset_secret_fails_closed(self, wclient, db, admin_user, monkeypatch):
        """An unauthenticated endpoint that suppresses addresses would be a
        denial of service on your own mail."""
        monkeypatch.delenv("LEARNHOUSE_RESEND_WEBHOOK_SECRET", raising=False)
        r = await self._post(
            wclient, {"type": "email.complained", "data": {"to": admin_user.email}}
        )
        assert r.status_code == 403

    async def test_unknown_address_is_handled(self, wclient):
        r = await self._post(
            wclient, {"type": "email.complained", "data": {"to": "ghost@nowhere.test"}}
        )
        assert r.status_code == 200
        assert r.json()["suppressed"] == 0
