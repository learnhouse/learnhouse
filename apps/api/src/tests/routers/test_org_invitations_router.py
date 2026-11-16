"""/api/v1/orgs/{org_id}/invitations and /invite-codes, through HTTP.

The services have their own tests; this walks every route once as an admin
and checks the wiring (bodies, query parameters, status codes)."""

import pytest
from unittest.mock import patch

from httpx import ASGITransport, AsyncClient

from src.tests.security.test_invitations_security import ORGS, _app

pytestmark = pytest.mark.usefixtures("quiet")


async def test_every_route_as_an_admin(world, db):
    app = _app(db, world.admin)
    base = f"{ORGS}/{world.org.id}"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        options = await c.get(f"{base}/invitations/options")
        assert options.status_code == 200 and options.json()["default_role_id"] == 4

        preview = await c.post(f"{base}/invitations/preview", json={"emails": "a@test.com regular@test.com", "role_id": 9})
        assert preview.json()["counts"]["member"] == 1

        sent = await c.post(
            f"{base}/invitations",
            json={"emails": ["a@test.com", "b@test.com"], "role_id": 9, "usergroup_ids": [1], "course_uuids": ["course_test"], "expires_in_days": 7},
        )
        assert sent.status_code == 200, sent.text
        uuids = [r["invitation_uuid"] for r in sent.json()["results"]]

        listing = await c.get(f"{base}/invitations", params={"status": "pending", "q": "a@", "limit": 10})
        assert [i["email"] for i in listing.json()["items"]] == ["a@test.com"]

        edited = await c.patch(f"{base}/invitations/{uuids[0]}", json={"message": "Welcome"})
        assert edited.json()["message"] == "Welcome"
        assert (await c.post(f"{base}/invitations/{uuids[0]}/resend")).json()["resent"] is True
        assert (await c.post(f"{base}/invitations/{uuids[0]}/resend", json={"expires_in_days": 3})).status_code == 200
        assert "/signup?invite=" in (await c.post(f"{base}/invitations/{uuids[0]}/link")).json()["url"]
        assert (await c.post(f"{base}/invitations/{uuids[0]}/revoke")).json()["status"] == "revoked"
        bulk = await c.post(f"{base}/invitations/bulk", json={"action": "revoke", "invitation_uuids": uuids})
        assert [r["status"] for r in bulk.json()["results"]] == ["skipped", "revoked"]

        with patch("src.services.analytics.analytics.track"):
            code = await c.post(f"{base}/invite-codes", json={"role_id": 9, "max_uses": 10, "expires_in_days": 30})
        assert code.status_code == 200, code.text
        code_uuid = code.json()["invite_code_uuid"]
        assert [x["invite_code_uuid"] for x in (await c.get(f"{base}/invite-codes")).json()] == [code_uuid]
        assert (await c.patch(f"{base}/invite-codes/{code_uuid}", json={"max_uses": None})).json()["max_uses"] is None
        assert (await c.delete(f"{base}/invite-codes/{code_uuid}")).json() == {"invite_code_uuid": code_uuid, "revoked": True}

        # A legacy Redis code answers with the deleted keys; the route says "revoked".
        class R:
            def scan_iter(self, match, count):
                return [b"k"]

            def delete(self, *keys):
                return 1

        legacy_uuid = "org_invite_code_12345678-1234-1234-1234-1234567890ab"
        with patch("src.services.orgs.invites._get_redis", return_value=R()), patch(
            "src.services.orgs.invites.get_learnhouse_config"
        ) as cfg:
            cfg.return_value.redis_config.redis_connection_string = "redis://fake"
            legacy = await c.delete(f"{base}/invite-codes/{legacy_uuid}")
        assert legacy.json() == {"invite_code_uuid": legacy_uuid, "revoked": True}
