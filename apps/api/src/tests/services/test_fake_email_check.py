"""Fake email check at signup: syntax, throwaway lists, DNS (no domain, no
MX, null MX, MX at a temp-mail service or localhost), caching, fail-open on
resolver trouble, and the gate on every self-service signup path."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import dns.exception
import dns.resolver
import pytest
from fastapi import HTTPException

from src.db.users import UserCreate, UserUpdate
from src.services.users import email_check as ec
from src.services.users.users import create_user, create_user_without_org, update_user
from src.tests.services.test_signup_custom_fields_flow import _signup_patches


@pytest.fixture(autouse=True)
def fresh_cache(monkeypatch):
    ec._LOCAL_CACHE.clear()
    monkeypatch.setattr("src.core.redis.get_redis_client", lambda: None)
    monkeypatch.delenv("LEARNHOUSE_BLOCKED_EMAIL_DOMAINS", raising=False)
    monkeypatch.delenv("LEARNHOUSE_ALLOWED_EMAIL_DOMAINS", raising=False)
    yield
    ec._LOCAL_CACHE.clear()


def _mx(*hosts):
    return [SimpleNamespace(exchange=h) for h in hosts]


def _resolver(result=None, error=None):
    """Patch dns.asyncresolver.Resolver().resolve with a canned MX answer."""
    resolve = AsyncMock(side_effect=error) if error else AsyncMock(return_value=result)
    fake = SimpleNamespace(resolve=resolve, lifetime=None, timeout=None)
    return patch("dns.asyncresolver.Resolver", return_value=fake), resolve


# ── check_email ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("email,reason", [
    ("no-at-sign", "malformed"),
    ("@acme.com", "malformed"),
    ("a@b@acme.com", "malformed"),
    ("a@localhost", "malformed"),
    ("a@acme", "malformed"),
    ("a@acme.c0m", "malformed"),
    ("a@-acme.com", "malformed"),
    ("a@[127.0.0.1]", "ip_literal"),
    ("a@10.0.0.1", "ip_literal"),
    ("a@acme.test", "reserved_domain"),
    ("a@example.com", "reserved_domain"),
    ("a@corp.internal", "reserved_domain"),
    ("a@mailinator.com", "disposable"),
    ("a@yopmail.com", "disposable"),
])
async def test_refused_without_dns(email, reason):
    ctx, resolve = _resolver(_mx("mx.acme.com."))
    with ctx:
        assert await ec.check_email(email) == ec.EmailVerdict(False, reason)
    resolve.assert_not_called()


async def test_known_providers_skip_dns():
    ctx, resolve = _resolver(error=dns.resolver.NXDOMAIN())
    with ctx:
        assert (await ec.check_email("Someone@GMAIL.com")).ok
        assert (await ec.check_email("x@outlook.com")).ok
    resolve.assert_not_called()


@pytest.mark.parametrize("answer,error,reason", [
    (None, dns.resolver.NXDOMAIN(), "domain_not_found"),
    (None, dns.resolver.NoAnswer(), "no_mx"),
    (_mx("."), None, "null_mx"),
    (_mx("localhost."), None, "mx_localhost"),
    (_mx("127.0.0.1"), None, "mx_localhost"),
    (_mx("mx1.mailinator.com."), None, "disposable_mx"),
    (_mx("mail.yopmail.com."), None, "disposable_mx"),
    (_mx("mx.acme.com.", "mx.guerrillamail.com."), None, "disposable_mx"),
])
async def test_dns_refusals(answer, error, reason):
    ctx, _ = _resolver(answer, error)
    with ctx:
        assert await ec.check_email("jane@acme-widgets.io") == ec.EmailVerdict(False, reason)


def test_mx_reason_edges():
    assert ec._mx_reason([]) == "null_mx"
    # MX on a listed throwaway domain that isn't in the MX suffix list.
    assert ec._mx_reason(["mx.dropmail.me."]) == "disposable_mx"
    assert ec._mx_reason(["mx1.acme.com."]) is None


async def test_real_mx_passes_and_is_cached():
    ctx, resolve = _resolver(_mx("aspmx.l.google.com.", "alt1.aspmx.l.google.com."))
    with ctx:
        assert (await ec.check_email("jane@acme-widgets.io")).ok
        assert (await ec.check_email("bob@acme-widgets.io")).ok
    assert resolve.await_count == 1


async def test_bad_verdict_is_cached_too():
    ctx, resolve = _resolver(error=dns.resolver.NXDOMAIN())
    with ctx:
        assert not (await ec.check_email("a@nope-nope-nope.io")).ok
        assert not (await ec.check_email("b@nope-nope-nope.io")).ok
    assert resolve.await_count == 1


@pytest.mark.parametrize("error", [dns.exception.Timeout(), dns.resolver.NoNameservers(), RuntimeError("boom")])
async def test_resolver_trouble_fails_open_and_is_not_cached(error):
    ctx, resolve = _resolver(error=error)
    with ctx:
        assert (await ec.check_email("a@flaky-dns.io")).ok
        assert (await ec.check_email("a@flaky-dns.io")).ok
    assert resolve.await_count == 2


async def test_env_block_and_allow_lists(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_BLOCKED_EMAIL_DOMAINS", "spammy.io, @junk.net")
    monkeypatch.setenv("LEARNHOUSE_ALLOWED_EMAIL_DOMAINS", "intranet.corp")
    ctx, resolve = _resolver(error=dns.resolver.NXDOMAIN())
    with ctx:
        assert await ec.check_email("a@spammy.io") == ec.EmailVerdict(False, "disposable")
        assert await ec.check_email("a@mail.junk.net") == ec.EmailVerdict(False, "disposable")
        assert (await ec.check_email("a@intranet.corp")).ok
        assert (await ec.check_email("a@eu.intranet.corp")).ok
    resolve.assert_not_called()


async def test_redis_cache_round_trip(monkeypatch):
    store = {}
    client = SimpleNamespace(get=lambda k: store.get(k), setex=lambda k, ttl, v: store.__setitem__(k, v.encode()))
    monkeypatch.setattr("src.core.redis.get_redis_client", lambda: client)
    ctx, resolve = _resolver(error=dns.resolver.NoAnswer())
    with ctx:
        assert not (await ec.check_email("a@cached-domain.io")).ok
        ec._LOCAL_CACHE.clear()
        assert await ec.check_email("a@cached-domain.io") == ec.EmailVerdict(False, "no_mx")
    assert resolve.await_count == 1 and store[ec._CACHE_PREFIX + "cached-domain.io"] == b"no_mx"


async def test_redis_errors_fall_back_to_process_cache(monkeypatch):
    def broken():
        raise RuntimeError("redis down")

    client = SimpleNamespace(get=lambda k: broken(), setex=lambda *a: broken())
    monkeypatch.setattr("src.core.redis.get_redis_client", lambda: client)
    ctx, resolve = _resolver(_mx("mx.acme.com."))
    with ctx:
        assert (await ec.check_email("a@acme-redis.io")).ok
        assert (await ec.check_email("a@acme-redis.io")).ok
    assert resolve.await_count == 1


async def test_local_cache_is_bounded(monkeypatch):
    monkeypatch.setattr(ec, "_LOCAL_CACHE_MAX", 2)
    for d in ("a.io", "b.io", "c.io"):
        ec._cache_set(d, None)
    assert list(ec._LOCAL_CACHE) == ["c.io"]


# ── the gate ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("value,mode,on", [
    ("1", "oss", True), ("on", "oss", True), ("0", "saas", False), ("off", "saas", False),
    ("", "saas", True), ("", "oss", False), ("", "ee", False),
])
def test_check_enabled(monkeypatch, value, mode, on):
    monkeypatch.setenv("LEARNHOUSE_FAKE_EMAIL_CHECK", value)
    with patch("src.core.deployment_mode.get_deployment_mode", return_value=mode):
        assert ec.check_enabled() is on


async def test_ensure_real_email(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_FAKE_EMAIL_CHECK", "1")
    with pytest.raises(HTTPException) as e:
        await ec.ensure_real_email("x@mailinator.com")
    assert e.value.status_code == 400 and e.value.detail == ec.REJECT_MESSAGE
    await ec.ensure_real_email("x@gmail.com")
    monkeypatch.setenv("LEARNHOUSE_FAKE_EMAIL_CHECK", "0")
    await ec.ensure_real_email("x@mailinator.com")


def _new(email, username="fake_user"):
    return UserCreate(username=username, first_name="F", last_name="U", email=email, password="Password123!")


async def test_signup_paths_refuse_fake_email(monkeypatch, mock_request, db, anonymous_user, org):
    monkeypatch.setenv("LEARNHOUSE_FAKE_EMAIL_CHECK", "1")
    with _signup_patches():
        with pytest.raises(HTTPException) as e:
            await create_user(mock_request, db, anonymous_user, _new("x@mailinator.com"), org.id)
        assert e.value.detail == ec.REJECT_MESSAGE
        with pytest.raises(HTTPException) as e:
            await create_user_without_org(mock_request, db, anonymous_user, _new("x@yopmail.com"))
        assert e.value.detail == ec.REJECT_MESSAGE
        # Proven inboxes skip it: Google, an emailed invitation link, an admin's invitation.
        oauth = await create_user(mock_request, db, anonymous_user, _new("g@mailinator.com", "g1"), org.id,
                                  is_oauth=True, signup_provider="google")
        assert oauth.email == "g@mailinator.com"
        link = await create_user(mock_request, db, anonymous_user, _new("l@mailinator.com", "l1"), org.id,
                                 email_verified_by_link=True)
        assert link.email == "l@mailinator.com"
        invited = await create_user_without_org(mock_request, db, anonymous_user, _new("i@mailinator.com", "i1"),
                                                invited_org_id=org.id)
        assert invited.email == "i@mailinator.com"
        ok = await create_user_without_org(mock_request, db, anonymous_user, _new("real@gmail.com", "r1"))
        assert ok.email == "real@gmail.com"


async def test_owner_cannot_move_to_a_fake_email(monkeypatch, mock_request, db, regular_user):
    monkeypatch.setenv("LEARNHOUSE_FAKE_EMAIL_CHECK", "1")
    with pytest.raises(HTTPException) as e:
        await update_user(mock_request, db, regular_user.id, regular_user,
                          UserUpdate(username=regular_user.username, email="me@mailinator.com"))
    assert e.value.status_code == 400 and e.value.detail == ec.REJECT_MESSAGE
