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
