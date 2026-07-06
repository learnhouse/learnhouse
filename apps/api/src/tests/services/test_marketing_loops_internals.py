"""Complementary tests for src/services/marketing/loops.py internals.

The sibling file test_marketing_loops_service.py covers the fire-and-forget
public entrypoint and the happy-path contact upsert + event send. This file
targets the lines that file misses:

  - _get_loops_client(): builds + MEMOIZES a real client when SaaS + key set,
    and returns None outside SaaS / when the key is unset.
  - close_loops_client(): closes an open client and resets the singleton.
  - _record_org_admin(): the optional-field branches (org_slug / firstName /
    lastName omitted when absent), the event-without-org_slug branch, the
    >=400 warning branch (both PUT and POST), and the early-return when the
    client is None.

Mocking mirrors test_marketing_loops_service.py exactly: patch
get_deployment_mode + httpx.AsyncClient, fake the .put/.post AsyncMocks.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import src.services.marketing.loops as loops_mod


@pytest.fixture(autouse=True)
def _reset_client():
    # Each test starts with a fresh lazy client so env/mode changes take.
    loops_mod._loops_client = None
    yield
    loops_mod._loops_client = None


def _fake_response(status_code: int = 200):
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = "{}"
    return resp


# ---------------------------------------------------------------------------
# _get_loops_client — construction, memoization, gating
# ---------------------------------------------------------------------------


def test_get_loops_client_builds_and_memoizes(monkeypatch):
    """SaaS + key set → a client is built once and reused (covers line ~65)."""
    monkeypatch.setenv("LOOPS_API_KEY", "key_123")

    fake_client = MagicMock()
    with patch.object(loops_mod, "get_deployment_mode", return_value="saas"), patch.object(
        loops_mod.httpx, "AsyncClient", return_value=fake_client
    ) as ctor:
        first = loops_mod._get_loops_client()
        second = loops_mod._get_loops_client()

    assert first is fake_client
    # Memoized: second call returns the same instance (line ~64-65 hit).
    assert second is first
    # Constructor invoked exactly once despite two calls.
    ctor.assert_called_once()


def test_get_loops_client_none_when_not_saas(monkeypatch):
    monkeypatch.setenv("LOOPS_API_KEY", "key_123")
    with patch.object(loops_mod, "get_deployment_mode", return_value="oss"):
        assert loops_mod._get_loops_client() is None
    assert loops_mod._loops_client is None


def test_get_loops_client_none_when_key_missing(monkeypatch):
    monkeypatch.delenv("LOOPS_API_KEY", raising=False)
    with patch.object(loops_mod, "get_deployment_mode", return_value="saas"):
        assert loops_mod._get_loops_client() is None
    assert loops_mod._loops_client is None


# ---------------------------------------------------------------------------
# close_loops_client — shutdown hook (covers lines 77-79)
# ---------------------------------------------------------------------------


async def test_close_loops_client_closes_and_resets(monkeypatch):
    monkeypatch.setenv("LOOPS_API_KEY", "key_123")

    fake_client = MagicMock()
    fake_client.aclose = AsyncMock()

    with patch.object(loops_mod, "get_deployment_mode", return_value="saas"), patch.object(
        loops_mod.httpx, "AsyncClient", return_value=fake_client
    ):
        # Build the singleton first.
        assert loops_mod._get_loops_client() is fake_client

    await loops_mod.close_loops_client()

    fake_client.aclose.assert_awaited_once()
    assert loops_mod._loops_client is None


async def test_close_loops_client_noop_when_unset():
    # No client built — close is a harmless no-op (guards the `if` at line 77).
    assert loops_mod._loops_client is None
    await loops_mod.close_loops_client()
    assert loops_mod._loops_client is None


# ---------------------------------------------------------------------------
# _record_org_admin — optional-field branches + event-without-org_slug
# ---------------------------------------------------------------------------


async def test_record_org_admin_omits_optional_fields(monkeypatch):
    """No org_slug/first/last → those keys are absent from the payload, and
    the event carries no eventProperties (covers the skipped `if` branches at
    lines ~124-129 and ~144-145)."""
    monkeypatch.setenv("LOOPS_API_KEY", "key_123")

    fake_client = MagicMock()
    fake_client.put = AsyncMock(return_value=_fake_response(200))
    fake_client.post = AsyncMock(return_value=_fake_response(200))

    with patch.object(loops_mod, "get_deployment_mode", return_value="saas"), patch.object(
        loops_mod.httpx, "AsyncClient", return_value=fake_client
    ):
        await loops_mod._record_org_admin("solo@test.com", None, None, None)

    put_body = fake_client.put.call_args.kwargs["json"]
    # Required fields always present.
    assert put_body["email"] == "solo@test.com"
    assert put_body["is_org_admin"] is True
    assert put_body["userGroup"] == "signed-users"
    assert put_body["source"] == "learnhouse.io"
    # Optional fields OMITTED when their source value is falsy.
    assert "org_slug" not in put_body
    assert "firstName" not in put_body
    assert "lastName" not in put_body

    # Event: no org_slug → no eventProperties key.
    post_body = fake_client.post.call_args.kwargs["json"]
    assert post_body["email"] == "solo@test.com"
    assert post_body["eventName"] == "became_org_admin"
    assert "eventProperties" not in post_body


async def test_record_org_admin_includes_only_first_name(monkeypatch):
    """firstName present but lastName absent → asymmetric optional branches."""
    monkeypatch.setenv("LOOPS_API_KEY", "key_123")

    fake_client = MagicMock()
    fake_client.put = AsyncMock(return_value=_fake_response(200))
    fake_client.post = AsyncMock(return_value=_fake_response(200))

    with patch.object(loops_mod, "get_deployment_mode", return_value="saas"), patch.object(
        loops_mod.httpx, "AsyncClient", return_value=fake_client
    ):
        await loops_mod._record_org_admin("dev@test.com", "team-x", "Grace", None)

    put_body = fake_client.put.call_args.kwargs["json"]
    assert put_body["org_slug"] == "team-x"
    assert put_body["firstName"] == "Grace"
    assert "lastName" not in put_body

    post_body = fake_client.post.call_args.kwargs["json"]
    assert post_body["eventProperties"] == {"org_slug": "team-x"}


# ---------------------------------------------------------------------------
# _record_org_admin — >=400 warning branches (covers lines 134 and 149)
# ---------------------------------------------------------------------------


async def test_record_org_admin_logs_warning_on_contact_4xx(monkeypatch):
    """PUT returns 500 → contact-upsert warning branch (line ~133-138)."""
    monkeypatch.setenv("LOOPS_API_KEY", "key_123")

    fake_client = MagicMock()
    fake_client.put = AsyncMock(return_value=_fake_response(500))
    fake_client.post = AsyncMock(return_value=_fake_response(200))

    with patch.object(loops_mod, "get_deployment_mode", return_value="saas"), patch.object(
        loops_mod.httpx, "AsyncClient", return_value=fake_client
    ), patch.object(loops_mod.logger, "warning") as warn:
        await loops_mod._record_org_admin("boss@test.com", "team-y", None, None)

    # At least the contact-upsert warning fired; must not raise.
    fake_client.put.assert_awaited_once()
    fake_client.post.assert_awaited_once()
    assert warn.call_count >= 1


async def test_record_org_admin_logs_warning_on_event_4xx(monkeypatch):
    """POST returns 400 → event-send warning branch (line ~148-153)."""
    monkeypatch.setenv("LOOPS_API_KEY", "key_123")

    fake_client = MagicMock()
    fake_client.put = AsyncMock(return_value=_fake_response(200))
    fake_client.post = AsyncMock(return_value=_fake_response(400))

    with patch.object(loops_mod, "get_deployment_mode", return_value="saas"), patch.object(
        loops_mod.httpx, "AsyncClient", return_value=fake_client
    ), patch.object(loops_mod.logger, "warning") as warn:
        await loops_mod._record_org_admin("boss@test.com", "team-z", None, None)

    fake_client.post.assert_awaited_once()
    assert warn.call_count >= 1
    # Confirm the failing status code was surfaced in a warning call.
    assert any(400 in call.args for call in warn.call_args_list)


async def test_record_org_admin_only_event_errors(monkeypatch):
    """POST raises (put ok) → event exception branch swallowed (line ~154-155)."""
    monkeypatch.setenv("LOOPS_API_KEY", "key_123")

    fake_client = MagicMock()
    fake_client.put = AsyncMock(return_value=_fake_response(200))
    fake_client.post = AsyncMock(side_effect=RuntimeError("network blip"))

    with patch.object(loops_mod, "get_deployment_mode", return_value="saas"), patch.object(
        loops_mod.httpx, "AsyncClient", return_value=fake_client
    ):
        # Must not propagate.
        await loops_mod._record_org_admin("boss@test.com", "team-q", None, None)

    fake_client.put.assert_awaited_once()
    fake_client.post.assert_awaited_once()


# ---------------------------------------------------------------------------
# _record_org_admin — early return when the client resolves to None
# ---------------------------------------------------------------------------


async def test_record_org_admin_in_loops_schedules_background_task(monkeypatch):
    """The public entrypoint schedules _record_org_admin as a background task
    and tracks it via _background_tasks (covers lines ~99-103). We patch
    _record_org_admin with an AsyncMock so no real HTTP task dangles, and await
    the scheduled task to drain it cleanly."""
    import asyncio

    monkeypatch.setenv("LOOPS_API_KEY", "key_123")

    fake_client = MagicMock()
    recorded = AsyncMock()

    with patch.object(loops_mod, "get_deployment_mode", return_value="saas"), patch.object(
        loops_mod.httpx, "AsyncClient", return_value=fake_client
    ), patch.object(loops_mod, "_record_org_admin", recorded):
        loops_mod.record_org_admin_in_loops(
            "promoted@test.com", org_slug="team-bg", first_name="A", last_name="B"
        )
        # A task was created and registered for GC-protection.
        assert len(loops_mod._background_tasks) == 1
        # Drain the scheduled task so the coroutine actually runs.
        await asyncio.gather(*list(loops_mod._background_tasks))

    recorded.assert_awaited_once_with(
        "promoted@test.com", "team-bg", "A", "B"
    )
    # done-callback removed it from the tracking set.
    assert len(loops_mod._background_tasks) == 0


async def test_record_org_admin_returns_when_client_none(monkeypatch):
    """Not in SaaS mode → _get_loops_client() is None → early return
    (covers line ~113-114); no HTTP call is attempted."""
    monkeypatch.setenv("LOOPS_API_KEY", "key_123")

    with patch.object(loops_mod, "get_deployment_mode", return_value="oss"):
        # Should simply return without constructing a client / raising.
        await loops_mod._record_org_admin("nobody@test.com", "acme", "A", "B")

    assert loops_mod._loops_client is None
