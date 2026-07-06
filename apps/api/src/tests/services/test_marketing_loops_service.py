"""Tests for src/services/marketing/loops.py — the API-side Loops admin sync.

The helper must:
  - be a no-op outside SaaS mode or when LOOPS_API_KEY is unset,
  - upsert the contact (PUT v1/contacts/update) with the shape mirrored from
    apps/web/services/emails/loops.ts, then fire the became_org_admin event,
  - never raise (fire-and-forget) even when Loops errors.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import src.services.marketing.loops as loops_mod


@pytest.fixture(autouse=True)
def _reset_client():
    # Each test starts with a fresh lazy client + key so env/mode changes take.
    loops_mod._loops_client = None
    yield
    loops_mod._loops_client = None


def _fake_response(status_code: int = 200):
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = "{}"
    return resp


async def test_no_op_when_not_saas(monkeypatch):
    monkeypatch.setenv("LOOPS_API_KEY", "key_123")
    with patch.object(loops_mod, "get_deployment_mode", return_value="oss"):
        # Should not construct a client at all.
        loops_mod.record_org_admin_in_loops("admin@test.com", org_slug="acme")
        assert loops_mod._loops_client is None


async def test_no_op_when_key_missing(monkeypatch):
    monkeypatch.delenv("LOOPS_API_KEY", raising=False)
    with patch.object(loops_mod, "get_deployment_mode", return_value="saas"):
        loops_mod.record_org_admin_in_loops("admin@test.com", org_slug="acme")
        assert loops_mod._loops_client is None


async def test_no_op_when_email_missing(monkeypatch):
    monkeypatch.setenv("LOOPS_API_KEY", "key_123")
    with patch.object(loops_mod, "get_deployment_mode", return_value="saas"):
        loops_mod.record_org_admin_in_loops(None, org_slug="acme")
        assert loops_mod._loops_client is None


async def test_upserts_contact_and_sends_event(monkeypatch):
    monkeypatch.setenv("LOOPS_API_KEY", "key_123")

    fake_client = MagicMock()
    fake_client.put = AsyncMock(return_value=_fake_response(200))
    fake_client.post = AsyncMock(return_value=_fake_response(200))

    with patch.object(loops_mod, "get_deployment_mode", return_value="saas"), patch.object(
        loops_mod.httpx, "AsyncClient", return_value=fake_client
    ):
        # Call the coroutine directly to avoid a dangling background task.
        await loops_mod._record_org_admin(
            "admin@test.com", "acme", "Ada", "Lovelace"
        )

    # Contact upsert
    fake_client.put.assert_awaited_once()
    put_path = fake_client.put.call_args.args[0]
    put_body = fake_client.put.call_args.kwargs["json"]
    assert put_path == "v1/contacts/update"
    assert put_body["email"] == "admin@test.com"
    assert put_body["is_org_admin"] is True
    assert put_body["userGroup"] == "signed-users"
    assert put_body["source"] == "learnhouse.io"
    assert put_body["org_slug"] == "acme"
    assert put_body["firstName"] == "Ada"
    assert put_body["lastName"] == "Lovelace"

    # Event
    fake_client.post.assert_awaited_once()
    post_path = fake_client.post.call_args.args[0]
    post_body = fake_client.post.call_args.kwargs["json"]
    assert post_path == "v1/events/send"
    assert post_body["email"] == "admin@test.com"
    assert post_body["eventName"] == "became_org_admin"
    assert post_body["eventProperties"] == {"org_slug": "acme"}


async def test_never_raises_on_loops_error(monkeypatch):
    monkeypatch.setenv("LOOPS_API_KEY", "key_123")

    fake_client = MagicMock()
    fake_client.put = AsyncMock(side_effect=RuntimeError("boom"))
    fake_client.post = AsyncMock(side_effect=RuntimeError("boom"))

    with patch.object(loops_mod, "get_deployment_mode", return_value="saas"), patch.object(
        loops_mod.httpx, "AsyncClient", return_value=fake_client
    ):
        # Must not propagate.
        await loops_mod._record_org_admin("admin@test.com", None, None, None)
