"""Signing up from a page (a course someone tried to start) keeps that page
through the verification email: it is stored with the token, validated as a
same-host relative path, and returned when the email is verified."""

import json
from datetime import datetime
from unittest.mock import AsyncMock, patch

import fakeredis
import pytest

from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.services.users.email_verification import (
    resend_verification_email,
    safe_next_path,
    send_verification_email,
    verification_next_path,
)


@pytest.mark.parametrize("value", ["/course/abc", "/course/abc/activity/x?tab=1#top", "/", "/checkout?offer=a%20b"])
def test_relative_paths_are_kept(value):
    assert safe_next_path(value) == value


@pytest.mark.parametrize(
    "value",
    [None, "", 7, "course/abc", "//evil.com/x", "/\\evil.com", "https://evil.com", "/ok\\..\\x",
     "/a b", "/x\nSet-Cookie: y", "javascript:alert(1)", "/" + "a" * 600],
)
def test_anything_that_could_leave_the_host_is_dropped(value):
    assert safe_next_path(value) is None


@pytest.fixture
def fake_redis():
    r = fakeredis.FakeRedis()
    with patch("src.services.users.email_verification.get_redis_connection", return_value=r):
        yield r


async def _user(db, org, verified=False):
    u = User(id=40, username="nx", first_name="N", last_name="X", email="nx@test.com", password="x",
             user_uuid="user_nx", email_verified=verified, creation_date=str(datetime.now()), update_date=str(datetime.now()))
    db.add(u)
    await db.commit()
    db.add(UserOrganization(user_id=40, org_id=org.id, role_id=4, creation_date="x", update_date="x"))
    await db.commit()
    return u


def _patched_send():
    return patch("src.services.users.email_verification.send_email_verification_email", return_value=True)


async def test_next_is_stored_with_the_token_and_read_back(mock_request, db, org, fake_redis):
    user = await _user(db, org)
    with _patched_send(), patch(
        "src.services.users.email_verification.generate_verification_token", return_value="tok"
    ), patch("src.services.email.utils.get_org_signup_base_url", new=AsyncMock(return_value="https://test-org.lh.io")):
        await send_verification_email(mock_request, db, user, org.id, next_path="/course/abc")
        await send_verification_email(mock_request, db, user, None, next_path="//evil.com")
    record = json.loads(fake_redis.get("email_verification:user_nx:org:org_test:token:tok"))
    assert record["next"] == "/course/abc"
    assert verification_next_path("user_nx", "org_test", "tok") == "/course/abc"
    # An unsafe destination is never stored.
    assert "next" not in json.loads(fake_redis.get("email_verification:user_nx:org:none:token:tok"))
    assert verification_next_path("user_nx", "none", "tok") is None


def test_missing_or_unreadable_records_give_no_destination(fake_redis):
    assert verification_next_path("user_nx", "org_test", "nope") is None
    fake_redis.set("email_verification:user_nx:org:org_test:token:bad", "{oops")
    assert verification_next_path("user_nx", "org_test", "bad") is None
    # A tampered record cannot smuggle an external destination either.
    fake_redis.set("email_verification:user_nx:org:org_test:token:t2", json.dumps({"next": "https://evil.com"}))
    assert verification_next_path("user_nx", "org_test", "t2") is None


async def test_resend_keeps_the_destination(mock_request, db, org):
    await _user(db, org)
    send = AsyncMock()
    with patch("src.services.users.email_verification.check_verification_resend_rate_limit", return_value=(True, 0)), patch(
        "src.services.users.email_verification.send_verification_email", new=send
    ):
        await resend_verification_email(mock_request, db, "nx@test.com", org.id, next_path="/course/abc")
    assert send.await_args.kwargs["next_path"] == "/course/abc"


async def test_signup_passes_next_to_the_verification_email(mock_request, db, org, user_role):
    from src.db.users import AnonymousUser, UserCreate
    from src.services.users.users import create_user, create_user_without_org

    send = AsyncMock()
    with patch("src.services.users.users.check_limits_with_usage", new=AsyncMock()), patch(
        "src.services.users.users.increase_feature_usage", new=AsyncMock()
    ), patch("src.services.users.users.track", new=AsyncMock()), patch(
        "src.services.users.users.dispatch_webhooks", new=AsyncMock()
    ), patch("src.services.users.users.get_deployment_mode", return_value="saas"), patch(
        "src.services.users.users.rbac_check", new=AsyncMock()
    ), patch("src.services.feature_notifications.notify_member_joined", new=AsyncMock()), patch(
        "src.services.users.email_verification.send_verification_email", new=send
    ):
        await create_user(mock_request, db, AnonymousUser(), UserCreate(
            email="a1@test.com", username="aone1", first_name="", last_name="", password="blue river 42"
        ), org.id, next_path="/course/abc")
        assert send.await_args.kwargs["next_path"] == "/course/abc"
        await create_user_without_org(mock_request, db, AnonymousUser(), UserCreate(
            email="a2@test.com", username="atwo2", first_name="", last_name="", password="blue river 42"
        ), next_path="/start")
        assert send.await_args.kwargs["next_path"] == "/start"
