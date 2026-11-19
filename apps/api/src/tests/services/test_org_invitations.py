"""Organization invitations and invite codes (src/services/orgs/invitations).

Covers the admin side (send, preview, list, edit, resend, link, revoke,
bulk), what joining applies (role, groups, courses, inviter notification),
invite codes, and the shared policy helpers. The security rules have their
own file: src/tests/security/test_invitations_security.py.
"""

from datetime import timedelta
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.notifications import Notification
from src.db.org_invitations import OrgInvitation, OrgInviteCode
from src.db.organization_config import OrganizationConfig
from src.db.roles import Role
from src.db.trail_runs import TrailRun
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import APITokenUser, InternalUser, User
from src.services.orgs.invitations import apply, codes, policy, service
from src.tests.conftest import USER_RIGHTS
from src.tests.fixtures.invitations import (
    NOW,
    _REAL_SEND,
    _code,
    _invite,
    _membership,
    _rights,
    _row,
    _user,
    saas,
)

# ---------------------------------------------------------------------------
# Options and preview
# ---------------------------------------------------------------------------

pytestmark = pytest.mark.usefixtures("quiet")


async def test_options_for_admin_and_maintainer(world, mock_request, db):
    admin = await service.invitation_options(mock_request, db, world.org.id, world.admin)
    by_id = {r["id"]: r for r in admin["roles"]}
    assert 10 not in by_id  # another org's role is never offered
    assert all(r["grantable"] for r in admin["roles"])
    assert by_id[3]["occupies_seat"] and not by_id[3]["code_allowed"]
    assert by_id[9]["code_allowed"] and not by_id[8]["code_allowed"]
    assert admin["capacity"]["members"]["limit"] is None  # not SaaS
    assert admin["expiry"] == {"default_days": 14, "max_days": 90}

    maint = await service.invitation_options(mock_request, db, world.org.id, world.maintainer)
    by_id = {r["id"]: r for r in maint["roles"]}
    assert by_id[1]["refusal"] == "ADMIN_ONLY" and by_id[2]["refusal"] == "ADMIN_ONLY"
    assert by_id[4]["grantable"] and by_id[3]["grantable"]


async def test_preview_classifies_addresses(world, mock_request, db):
    await _invite(world, mock_request, db, "pending@test.com")
    out = await service.preview_invitations(
        mock_request, db, world.org.id,
        service.InvitationPreview(emails="pending@test.com regular@test.com, fresh@test.com\nnope", role_id=3),
        world.admin,
    )
    assert [(e["email"], e["status"]) for e in out["emails"]] == [
        ("pending@test.com", "pending"), ("regular@test.com", "member"), ("fresh@test.com", "new"), ("nope", "invalid"),
    ]
    assert out["counts"] == {"new": 1, "pending": 1, "member": 1, "invalid": 1}
    assert out["occupies_seat"] is True and out["blocked"] is None

    with saas():
        blocked = await service.preview_invitations(
            mock_request, db, world.org.id,
            service.InvitationPreview(emails=["fresh@test.com", "regular@test.com"], role_id=3, update_existing_members=True),
            world.admin,
        )
    # Free plan: 1 admin seat, already used by the admin.
    assert blocked["blocked"]["code"] == "ADMIN_SEAT_LIMIT_REACHED"
    assert blocked["blocked"]["requested"] == 2


# ---------------------------------------------------------------------------
# Send
# ---------------------------------------------------------------------------


async def test_send_with_role_groups_courses_note_and_expiry(world, mock_request, db, quiet, analytics_queue):
    with patch("src.services.orgs.invitations.service.audit_event") as audit:
        out = await _invite(
            world, mock_request, db, "Lea@Test.com\nsam@test.com; lea@test.com",
            role_id=3, usergroup_ids=[1], course_uuids=["course_test"], message="  Welcome aboard!\n", expires_in_days=7,
        )
    assert [r["status"] for r in out["results"]] == ["sent", "sent"]
    assert out["summary"]["sent"] == 2 and out["summary"]["total"] == 2
    lea = await _row(db, "lea@test.com")
    assert lea.role_id == 3 and lea.usergroup_ids == [1] and lea.course_uuids == ["course_test"]
    assert lea.message == "Welcome aboard!" and lea.invited_by_user_id == world.admin.id
    assert lea.email_sent and lea.send_count == 1 and lea.token_hash and len(lea.token_hash) == 64
    assert 6 <= (policy.aware(lea.expires_at) - policy.utcnow()).days <= 7
    # The email got the role, and its link token is never stored in clear.
    _req, _db, _org, sender, inv, token, role = quiet.send.await_args.args
    assert role.name == "Instructor" and policy.hash_token(token) == inv.token_hash != token
    assert audit.call_args.kwargs["action"] == "members.invited"
    assert audit.call_args.kwargs["details"]["role"] == "Instructor"
    assert quiet.hooks.await_args.kwargs["event_name"] == "user_invited_to_org"
    assert any(e["event_name"] == "user_invited" and e["properties"]["count"] == 2 for e in analytics_queue)
    quiet.rate.assert_called_once_with(world.org.id, world.admin.id, 2)


async def test_inviting_again_refreshes_the_pending_invitation(world, mock_request, db, quiet):
    await _invite(world, mock_request, db, "a@test.com")
    first = await _row(db, "a@test.com")
    old_hash = first.token_hash
    out = await _invite(world, mock_request, db, "a@test.com", role_id=9, usergroup_ids=[1])
    assert out["results"][0]["status"] == "resent"
    again = await _row(db, "a@test.com")
    assert again.id == first.id and again.role_id == 9 and again.usergroup_ids == [1]
    assert again.token_hash != old_hash and again.send_count == 2


async def test_existing_members_are_skipped_unless_asked(world, mock_request, db):
    out = await _invite(world, mock_request, db, "regular@test.com", role_id=9)
    assert out["results"] == [{"email": "regular@test.com", "status": "already_member"}]
    assert (await _row(db, "regular@test.com")) is None
    assert (await _membership(db, world.regular.id, world.org.id)).role_id == 4

    out = await _invite(
        world, mock_request, db, "regular@test.com", role_id=9, usergroup_ids=[1], course_uuids=["course_test"],
        update_existing_members=True,
    )
    assert out["results"][0]["status"] == "member_updated"
    assert (await _membership(db, world.regular.id, world.org.id)).role_id == 9
    assert (await db.execute(select(UserGroupUser).where(UserGroupUser.user_id == world.regular.id))).scalars().one().sources == ["manual"]
    assert (await db.execute(select(TrailRun).where(TrailRun.user_id == world.regular.id))).scalars().one()

    # Your own role can't change through an invitation either.
    me = await _invite(world, mock_request, db, "admin@test.com", role_id=4, update_existing_members=True)
    assert me["results"][0]["status"] == "member_update_failed"
    assert "own role" in me["results"][0]["reason"]


async def test_send_reports_failures_and_bad_input(world, mock_request, db, quiet):
    quiet.send.return_value = False
    out = await _invite(world, mock_request, db, "x@test.com bad-address")
    assert [r["status"] for r in out["results"]] == ["email_failed", "invalid_email"]
    row = await _row(db, "x@test.com")
    assert row.email_sent is False and row.send_count == 1

    only_bad = await _invite(world, mock_request, db, "nope")
    assert only_bad["results"] == [{"email": "nope", "status": "invalid_email"}]
    for emails, kw, code in (
        ("   ", {}, "INVITE_NO_EMAILS"),
        ("y@test.com", {"message": "see https://evil.example"}, "INVITE_MESSAGE_HAS_LINK"),
        ("y@test.com", {"message": "x" * 1200}, "INVITE_MESSAGE_TOO_LONG"),
    ):
        with pytest.raises(HTTPException) as exc:
            await _invite(world, mock_request, db, emails, **kw)
        assert exc.value.status_code == 400 and exc.value.detail["code"] == code


async def test_send_respects_plan_capacity(world, mock_request, db):
    with saas():
        with pytest.raises(HTTPException) as seat:
            await _invite(world, mock_request, db, "teacher@test.com", role_id=3)
        assert seat.value.status_code == 403 and seat.value.detail["code"] == "ADMIN_SEAT_LIMIT_REACHED"
        # Free plan: 10 members. 3 joined; 7 more fit, the 8th does not.
        await _invite(world, mock_request, db, " ".join(f"p{i}@test.com" for i in range(7)))
        with pytest.raises(HTTPException) as members:
            await _invite(world, mock_request, db, "one-too-many@test.com")
        assert members.value.detail["code"] == "MEMBER_LIMIT_REACHED"
        assert members.value.detail["pending"] == 7
        # Re-sending a pending invitation adds nobody.
        out = await _invite(world, mock_request, db, "p0@test.com")
        assert out["results"][0]["status"] == "resent"
        cap = await policy.capacity(db, world.org.id)
        assert cap["plan"] == "free" and cap["members"] == {"limit": 10, "used": 3, "pending": 7}

    config = (await db.execute(select(OrganizationConfig))).scalars().one()
    config.config = {"config_version": "2.0", "plan": "free", "admin_toggles": {"members": {"disabled": True}}}
    db.add(config)
    await db.commit()
    with saas(), patch(
        "src.security.features_utils.resolve.resolve_feature", return_value={"enabled": False, "limit": 5}
    ):
        cap = await policy.capacity(db, world.org.id)
    assert cap["members"]["limit"] == 0


# ---------------------------------------------------------------------------
# List and manage
# ---------------------------------------------------------------------------


async def test_list_filters_counts_and_expiry(world, mock_request, db):
    await _invite(world, mock_request, db, "a@test.com b@test.com c@test.com", role_id=9, usergroup_ids=[1], course_uuids=["course_test"])
    stale = await _row(db, "c@test.com")
    stale.expires_at = policy.utcnow() - timedelta(minutes=1)
    db.add(stale)
    await db.commit()

    out = await service.list_invitations(mock_request, db, world.org.id, world.admin)
    assert out["total"] == 3 and out["counts"]["pending"] == 2 and out["counts"]["expired"] == 1
    item = next(i for i in out["items"] if i["email"] == "a@test.com")
    assert item["role"]["name"] == "Learner Plus"
    assert item["usergroups"] == [{"id": 1, "usergroup_uuid": "usergroup_a", "name": "Cohort A"}]
    assert item["courses"] == [{"course_uuid": "course_test", "name": "Test Course"}]
    assert item["invited_by"]["username"] == "admin" and item["legacy"] is False

    pending = await service.list_invitations(mock_request, db, world.org.id, world.admin, status="pending", query="B@", page=1, limit=10)
    assert [i["email"] for i in pending["items"]] == ["b@test.com"]
    paged = await service.list_invitations(mock_request, db, world.org.id, world.admin, page=2, limit=2)
    assert len(paged["items"]) == 1 and paged["page"] == 2
    with pytest.raises(HTTPException) as bad:
        await service.list_invitations(mock_request, db, world.org.id, world.admin, status="weird")
    assert bad.value.status_code == 400


async def test_list_shows_legacy_redis_invitations(world, mock_request, db):
    import json

    redis = Mock()
    redis.scan_iter.return_value = ["k1", "k2", "k3"]
    records = {
        "k1": json.dumps({"email": "old@test.com", "pending": True, "created_at": "2026-01-01", "email_sent": True}),
        "k2": json.dumps({"email": "done@test.com", "pending": False}),
        "k3": None,
    }
    redis.get.side_effect = records.get
    with patch("src.core.redis.get_redis_client", return_value=redis):
        out = await service.list_invitations(mock_request, db, world.org.id, world.admin)
        searched = await service.list_invitations(mock_request, db, world.org.id, world.admin, query="zzz")
    assert out["legacy"] == [{"email": "old@test.com", "status": "pending", "created_at": "2026-01-01", "email_sent": True, "legacy": True}]
    assert searched["legacy"] == []
    broken = Mock()
    broken.scan_iter.side_effect = RuntimeError("down")
    with patch("src.core.redis.get_redis_client", return_value=broken):
        assert service.legacy_records(world.org) == []
        service._drop_legacy(world.org, ["a@test.com"])  # never raises


async def test_update_pending_invitation(world, mock_request, db):
    await _invite(world, mock_request, db, "a@test.com")
    inv = await _row(db, "a@test.com")
    with patch("src.services.orgs.invitations.service.audit_event") as audit:
        out = await service.update_invitation(
            mock_request, db, world.org.id, inv.invitation_uuid,
            service.InvitationUpdate(role_id=3, usergroup_ids=[1], course_uuids=["course_test"], message="Hi there", expires_in_days=30),
            world.admin,
        )
    assert out["role"]["name"] == "Instructor" and out["usergroups"][0]["id"] == 1 and out["message"] == "Hi there"
    changes = audit.call_args.kwargs["changes"]
    assert changes["role"] == {"from": "User", "to": "Instructor"} and "usergroup_ids" in changes and "course_uuids" in changes
    assert changes["message"] == {"from": False, "to": True} and "expires_at" in changes

    # Same values again: nothing to record.
    with patch("src.services.orgs.invitations.service.audit_event") as audit:
        await service.update_invitation(
            mock_request, db, world.org.id, inv.invitation_uuid,
            service.InvitationUpdate(role_id=3, usergroup_ids=[1], message="Hi there"), world.admin,
        )
    audit.assert_not_called()

    # Groups alone keep the courses, and the reverse.
    await service.update_invitation(mock_request, db, world.org.id, inv.invitation_uuid, service.InvitationUpdate(usergroup_ids=[]), world.admin)
    await db.refresh(inv)
    assert inv.usergroup_ids == [] and inv.course_uuids == ["course_test"]

    with saas():
        await _invite(world, mock_request, db, "b@test.com")
        b = await _row(db, "b@test.com")
        with pytest.raises(HTTPException) as seat:
            await service.update_invitation(mock_request, db, world.org.id, b.invitation_uuid, service.InvitationUpdate(role_id=3), world.admin)
    assert seat.value.detail["code"] == "ADMIN_SEAT_LIMIT_REACHED"

    await service.revoke_invitation(mock_request, db, world.org.id, inv.invitation_uuid, world.admin)
    with pytest.raises(HTTPException) as closed:
        await service.update_invitation(mock_request, db, world.org.id, inv.invitation_uuid, service.InvitationUpdate(message="x"), world.admin)
    assert closed.value.status_code == 409


async def test_resend_link_and_revoke(world, mock_request, db, quiet):
    await _invite(world, mock_request, db, "a@test.com")
    inv = await _row(db, "a@test.com")
    first = inv.token_hash

    out = await service.resend_invitation(mock_request, db, world.org.id, inv.invitation_uuid, service.InvitationResend(expires_in_days=3), world.admin)
    assert out["resent"] is True and out["send_count"] == 2
    await db.refresh(inv)
    assert inv.token_hash != first

    emailed = inv.token_hash
    link = await service.invitation_link(mock_request, db, world.org.id, inv.invitation_uuid, world.admin)
    await db.refresh(inv)
    token = link["url"].split("invite=", 1)[1]
    # A copied link has its own token: the emailed one keeps working.
    assert policy.hash_token(token) == inv.copy_token_hash and "/signup?invite=" in link["url"]
    assert inv.token_hash == emailed and inv.token_delivery == "email"
    copied = inv.copy_token_hash
    # Resending rotates the emailed link only.
    await service.resend_invitation(mock_request, db, world.org.id, inv.invitation_uuid, service.InvitationResend(), world.admin)
    await db.refresh(inv)
    assert inv.token_hash != emailed and inv.copy_token_hash == copied

    # An expired invitation comes back to pending when sent again.
    inv.expires_at = policy.utcnow() - timedelta(days=1)
    db.add(inv)
    await db.commit()
    with pytest.raises(HTTPException) as no_link:
        await service.invitation_link(mock_request, db, world.org.id, inv.invitation_uuid, world.admin)
    assert no_link.value.status_code == 409
    again = await service.resend_invitation(mock_request, db, world.org.id, inv.invitation_uuid, service.InvitationResend(), world.admin)
    assert again["status"] == "pending"

    revoked = await service.revoke_invitation(mock_request, db, world.org.id, inv.invitation_uuid, world.admin)
    assert revoked["status"] == "revoked"
    await db.refresh(inv)
    assert inv.status == "revoked"
    for call in (
        service.revoke_invitation(mock_request, db, world.org.id, inv.invitation_uuid, world.admin),
        service.resend_invitation(mock_request, db, world.org.id, inv.invitation_uuid, service.InvitationResend(), world.admin),
    ):
        with pytest.raises(HTTPException) as exc:
            await call
        assert exc.value.status_code == 409
    with pytest.raises(HTTPException) as missing:
        await service.revoke_invitation(mock_request, db, world.org.id, "invitation_nope", world.admin)
    assert missing.value.status_code == 404


async def test_bulk_resend_and_revoke(world, mock_request, db, quiet):
    await _invite(world, mock_request, db, "a@test.com b@test.com c@test.com")
    a, b, c = [await _row(db, e) for e in ("a@test.com", "b@test.com", "c@test.com")]
    await service.revoke_invitation(mock_request, db, world.org.id, c.invitation_uuid, world.admin)
    quiet.send.side_effect = [True, False]
    out = await service.bulk_invitations(
        mock_request, db, world.org.id,
        service.InvitationBulk(action="resend", invitation_uuids=[a.invitation_uuid, b.invitation_uuid, c.invitation_uuid, "invitation_x"]),
        world.admin,
    )
    assert [r["status"] for r in out["results"]] == ["resent", "email_failed", "skipped", "not_found"]
    quiet.rate.assert_called_with(world.org.id, world.admin.id, 2)

    with patch("src.services.orgs.invitations.service._revoke", AsyncMock(side_effect=HTTPException(status_code=403, detail="no"))):
        failed = await service.bulk_invitations(
            mock_request, db, world.org.id, service.InvitationBulk(action="revoke", invitation_uuids=[a.invitation_uuid]), world.admin
        )
    assert failed["results"] == [{"invitation_uuid": a.invitation_uuid, "status": "failed", "reason": "no"}]
    with patch("src.services.orgs.invitations.service._revoke", AsyncMock(side_effect=HTTPException(status_code=403, detail={"message": "nope"}))):
        failed = await service.bulk_invitations(
            mock_request, db, world.org.id, service.InvitationBulk(action="revoke", invitation_uuids=[a.invitation_uuid]), world.admin
        )
    assert failed["results"][0]["reason"] == "nope"
    out = await service.bulk_invitations(
        mock_request, db, world.org.id, service.InvitationBulk(action="revoke", invitation_uuids=[a.invitation_uuid, b.invitation_uuid]), world.admin
    )
    assert [r["status"] for r in out["results"]] == ["revoked", "revoked"]


async def test_revoke_by_email(world, mock_request, db):
    await _invite(world, mock_request, db, "a@test.com")
    assert await service.revoke_by_email(mock_request, db, world.org, " A@test.com ", world.admin) is True
    assert await service.revoke_by_email(mock_request, db, world.org, "a@test.com", world.admin) is False


async def test_real_email_sender(world, mock_request, db):
    """The email helper builds the personal link and never raises."""
    inv = OrgInvitation(
        invitation_uuid="invitation_mail", org_id=world.org.id, email="mail@test.com", message="Hello",
        expires_at=policy.utcnow() + timedelta(days=2), created_at=policy.utcnow(), updated_at=policy.utcnow(),
    )
    sender = await db.get(User, world.admin.id)
    role = await db.get(Role, 3)
    with patch("src.services.email.utils.get_org_signup_base_url", AsyncMock(return_value="https://acme.test")), patch(
        "src.services.users.emails.send_invitation_email", return_value={"id": "1"}
    ) as send:
        assert await _REAL_SEND(mock_request, db, world.org, sender, inv, "tok", role) is True
    kwargs = send.call_args.kwargs
    assert kwargs["signup_url"] == "https://acme.test/signup?invite=tok"
    assert kwargs["role_name"] == "Instructor" and kwargs["message"] == "Hello"
    with patch("src.services.email.utils.get_org_signup_base_url", AsyncMock(side_effect=RuntimeError("down"))):
        assert await _REAL_SEND(mock_request, db, world.org, sender, inv, "tok", None) is False


# ---------------------------------------------------------------------------
# Joining through an invitation
# ---------------------------------------------------------------------------


async def test_accept_creates_the_membership_with_everything(world, mock_request, db, quiet, analytics_queue):
    await _invite(world, mock_request, db, "lea@test.com", role_id=3, usergroup_ids=[1], course_uuids=["course_test"])
    inv = await _row(db, "lea@test.com")
    lea = await _user(db, 20, "lea@test.com")
    lea.first_name = "Lea"
    with patch("src.services.orgs.invitations.apply.audit_event") as audit:
        out = await apply.accept_invitation(mock_request, db, lea, world.org, inv, via="email_invite")
    assert out == {
        "org_id": world.org.id, "slug": world.org.slug, "name": world.org.name, "role": "Instructor",
        "usergroups": 1, "courses": 1, "already_member": False,
    }
    assert (await _membership(db, 20, world.org.id)).role_id == 3
    group_row = (await db.execute(select(UserGroupUser).where(UserGroupUser.user_id == 20))).scalars().one()
    assert group_row.sources == ["manual"] and group_row.added_by_id == world.admin.id
    assert (await db.execute(select(TrailRun).where(TrailRun.user_id == 20))).scalars().one().course_id == world.course.id
    await db.refresh(inv)
    assert inv.status == "accepted" and inv.accepted_user_id == 20
    actions = [c.kwargs["action"] for c in audit.call_args_list]
    assert actions == ["members.invitation.accepted", "members.invitation.role_applied"]
    quiet.joined.assert_awaited_once()
    assert any(e["event_name"] == "user_joined_org" and e["properties"] == {"join_method": "email_invite"} for e in analytics_queue)
    assert any(e["event_name"] == "course_enrolled" and e["properties"]["source"] == "invitation" for e in analytics_queue)
    note = (await db.execute(select(Notification).where(Notification.type == "invitation_accepted"))).scalars().one()
    assert note.user_id == world.admin.id and "accepted your invitation" in note.body

    # Single use.
    with pytest.raises(HTTPException) as again:
        await apply.accept_invitation(mock_request, db, lea, world.org, inv, via="email_invite")
    assert again.value.status_code == 404


async def test_accept_for_an_existing_member(world, mock_request, db):
    # The inviter left in the meantime: no notification.
    # Invited before they joined some other way (the invitation predates it).
    db.add(OrgInvitation(
        invitation_uuid="invitation_regular", org_id=world.org.id, email="regular@test.com", role_id=9,
        usergroup_ids=[1], course_uuids=["course_test"], invited_by_user_id=world.maintainer.id,
        expires_at=policy.utcnow() + timedelta(days=1), created_at=policy.utcnow(), updated_at=policy.utcnow(),
    ))
    db.add(OrgInvitation(
        invitation_uuid="invitation_admin", org_id=world.org.id, email="admin@test.com", role_id=4,
        invited_by_user_id=world.maintainer.id, expires_at=policy.utcnow() + timedelta(days=1),
        created_at=policy.utcnow(), updated_at=policy.utcnow(),
    ))
    await db.commit()
    maint_row = await _membership(db, world.maintainer.id, world.org.id)
    await db.delete(maint_row)
    await db.commit()
    regular = await db.get(User, world.regular.id)
    # Pre-existing group and enrollment are left alone.
    db.add(UserGroupUser(usergroup_id=1, user_id=regular.id, org_id=world.org.id, creation_date=NOW, update_date=NOW))
    db.add(TrailRun(trail_id=0, course_id=world.course.id, org_id=world.org.id, user_id=regular.id, creation_date=NOW, update_date=NOW))
    await db.commit()
    out = await apply.accept_invitation(
        mock_request, db, regular, world.org, await _row(db, "regular@test.com"), via="email_invite", ownership_proven=True
    )
    assert out["already_member"] is True and out["role"] == "Learner Plus" and out["usergroups"] == 0 and out["courses"] == 0
    assert (await _membership(db, regular.id, world.org.id)).role_id == 9
    assert (await db.execute(select(Notification).where(Notification.type == "invitation_accepted"))).scalars().first() is None

    # An Admin is never demoted by an invitation.
    admin = await db.get(User, world.admin.id)
    out = await apply.accept_invitation(
        mock_request, db, admin, world.org, await _row(db, "admin@test.com"), via="email_invite", ownership_proven=True
    )
    assert out["role"] is None and (await _membership(db, admin.id, world.org.id)).role_id == 1


async def test_accept_refusals_and_role_fallback(world, mock_request, db):
    await _invite(world, mock_request, db, "lea@test.com", role_id=9)
    inv = await _row(db, "lea@test.com")
    lea = await _user(db, 20, "lea@test.com")
    sam = await _user(db, 21, "sam@test.com")
    for user, org in ((sam, world.org), (lea, world.other_org)):
        with pytest.raises(HTTPException) as exc:
            await apply.accept_invitation(mock_request, db, user, org, inv, via="x")
        assert exc.value.status_code == 404

    # The custom role was deleted since: the person joins as a User.
    inv.role_id = None
    db.add(inv)
    await db.commit()
    out = await apply.accept_invitation(mock_request, db, lea, world.org, inv, via="x")
    assert out["role"] == "User"

    # Expired: the claim fails.
    await _invite(world, mock_request, db, "sam@test.com")
    late = await _row(db, "sam@test.com")
    late.expires_at = policy.utcnow() - timedelta(seconds=1)
    db.add(late)
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await apply.accept_invitation(mock_request, db, sam, world.org, late, via="x")
    assert exc.value.status_code == 404


async def test_serialize_without_a_role(world, db):
    inv = OrgInvitation(
        invitation_uuid="invitation_x", org_id=world.org.id, email="x@test.com", role_id=None,
        usergroup_ids=["junk", 2], course_uuids=["course_foreign", "gone"],
        expires_at=policy.utcnow(), created_at=policy.utcnow(), updated_at=policy.utcnow(),
    )
    out = await service._serialize_one(db, inv)
    # No role, and another org's group or course never shows.
    assert out["role"] is None and out["usergroups"] == [] and out["courses"] == []


async def test_lookups(world, mock_request, db):
    assert await apply.find_pending_invitation(db, "", world.org.id) is None
    assert await apply.has_pending_invitations(db, world.org.id) is False
    await _invite(world, mock_request, db, "a@test.com")
    assert (await apply.find_pending_invitation(db, " A@test.com", world.org.id)).email == "a@test.com"
    assert await apply.has_pending_invitations(db, world.org.id) is True
    assert await apply.invitation_by_token(db, "nope") is None


async def test_grants_and_side_effects_tolerate_gaps(world, mock_request, db):
    assert await apply._grant_groups(db, world.org.id, 2, [], "manual", None) == []
    assert await apply._grant_groups(db, world.org.id, 2, ["x", 2], "manual", None) == []  # foreign group skipped
    assert await apply._grant_courses(db, world.org.id, 2, []) == []
    assert await apply._grant_courses(db, world.org.id, 2, ["course_foreign"]) == []
    user = await db.get(User, world.regular.id)
    with patch("src.services.webhooks.dispatch.dispatch_webhooks", AsyncMock(side_effect=RuntimeError("down"))):
        group = await db.get(UserGroup, 1)
        await apply._after_grants(mock_request, db, world.org, user, [group], [], "invitation")  # never raises
    inv = OrgInvitation(invitation_uuid="i", org_id=world.org.id, email="x@test.com", invited_by_user_id=user.id)
    assert await apply.notify_inviter(db, inv, user) is None  # inviting yourself: no notice
    inv.invited_by_user_id = None
    assert await apply.notify_inviter(db, inv, user) is None


# ---------------------------------------------------------------------------
# Invite codes
# ---------------------------------------------------------------------------


async def test_code_with_role_groups_courses_cap_and_expiry(world, mock_request, db):
    with patch("src.services.orgs.invitations.codes.audit_event") as audit:
        out = await _code(world, mock_request, db, role_id=9, usergroup_ids=[1], course_uuids=["course_test"], max_uses=2, expires_in_days=10)
    assert out["role"]["name"] == "Learner Plus" and out["usergroups"][0]["name"] == "Cohort A"
    assert out["courses"][0]["name"] == "Test Course" and out["max_uses"] == 2 and out["uses"] == 0
    assert out["status"] == "active" and out["usergroup_id"] == 1 and out["created_by"] == "user_admin"
    assert audit.call_args.kwargs["action"] == "members.invite_code.created"
    data = await codes.find_active_code(db, world.org.id, out["invite_code"])
    assert data is not None and codes.as_join_data(data)["source"] == "db"
    assert await codes.find_active_code(db, world.org.id, "NOPE1234") is None


async def test_code_roles_are_limited(world, mock_request, db):
    for role_id in (1, 2, 3, 8):
        with pytest.raises(HTTPException) as exc:
            await _code(world, mock_request, db, role_id=role_id)
        assert exc.value.status_code == 400 and exc.value.detail["code"] == "CODE_ROLE_NOT_ALLOWED"
    with pytest.raises(HTTPException) as foreign:
        await _code(world, mock_request, db, role_id=10)
    assert foreign.value.status_code == 404


async def test_list_update_and_revoke_codes(world, mock_request, db):
    import json

    live = await _code(world, mock_request, db)
    used = await _code(world, mock_request, db, max_uses=1)
    row = (await db.execute(select(OrgInviteCode).where(OrgInviteCode.code_uuid == used["invite_code_uuid"]))).scalars().one()
    row.uses = 1
    db.add(row)
    await db.commit()
    legacy = Mock()
    legacy.scan_iter.return_value = ["k1", "k2", "k3"]
    legacy.get.side_effect = {
        "k1": json.dumps({"invite_code": "OLD1", "invite_code_uuid": "org_invite_code_old1", "usergroup_id": 1}),
        "k2": json.dumps({"invite_code": "OLD2", "invite_code_uuid": "org_invite_code_old2", "usergroup_id": 2}),
        "k3": None,
    }.get
    with patch("src.core.redis.get_redis_client", return_value=legacy):
        items = await codes.list_codes(mock_request, db, world.org.id, world.admin)
    assert [i["invite_code"] for i in items[:2]] == [live["invite_code"], used["invite_code"]]
    assert items[1]["status"] == "used_up"
    assert [(i["invite_code"], i["usergroup_name"]) for i in items[2:]] == [("OLD1", "Cohort A"), ("OLD2", None)]
    broken = Mock()
    broken.scan_iter.side_effect = RuntimeError("down")
    with patch("src.core.redis.get_redis_client", return_value=broken):
        assert codes._legacy_codes(world.org) == []

    with patch("src.services.orgs.invitations.codes.audit_event") as audit:
        out = await codes.update_code(
            mock_request, db, world.org.id, live["invite_code_uuid"],
            codes.InviteCodeUpdate(role_id=9, usergroup_ids=[1], max_uses=5, expires_in_days=3), world.admin,
        )
    assert out["role"]["id"] == 9 and out["max_uses"] == 5 and out["expires_at"]
    assert set(audit.call_args.kwargs["changes"]) == {"role_id", "usergroup_ids", "course_uuids", "max_uses", "expires_at"}
    cleared = await codes.update_code(
        mock_request, db, world.org.id, live["invite_code_uuid"],
        codes.InviteCodeUpdate(max_uses=None, expires_in_days=None, course_uuids=["course_test"]), world.admin,
    )
    assert cleared["max_uses"] is None and cleared["expires_at"] is None and cleared["usergroups"][0]["id"] == 1
    same = await codes.update_code(mock_request, db, world.org.id, live["invite_code_uuid"], codes.InviteCodeUpdate(role_id=9), world.admin)
    assert same["role"]["id"] == 9

    assert await codes.revoke_code(mock_request, db, world.org.id, live["invite_code_uuid"], world.admin) == {
        "invite_code_uuid": live["invite_code_uuid"], "revoked": True,
    }
    # Revoking twice is fine; the code is gone from the list and from edits.
    assert (await codes.revoke_code(mock_request, db, world.org.id, live["invite_code_uuid"], world.admin))["revoked"]
    assert await codes.revoke_code(mock_request, db, world.org.id, "org_invite_code_00000000-0000-0000-0000-000000000000", world.admin) is None
    for bad in ("org_invite_code_*", live["invite_code_uuid"]):
        with pytest.raises(HTTPException) as exc:
            await codes.update_code(mock_request, db, world.org.id, bad, codes.InviteCodeUpdate(max_uses=3), world.admin)
        assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        await codes.revoke_code(mock_request, db, world.org.id, "org_invite_code_*", world.admin)
    assert exc.value.status_code == 404


async def test_code_status_and_generation(world, mock_request, db):
    now = policy.utcnow()
    assert codes.code_status(OrgInviteCode(revoked_at=now, uses=0)) == "revoked"
    assert codes.code_status(OrgInviteCode(expires_at=now - timedelta(seconds=1), uses=0)) == "expired"
    assert codes.code_status(OrgInviteCode(max_uses=2, uses=2)) == "used_up"
    assert codes.code_status(OrgInviteCode(max_uses=2, uses=1, expires_at=now + timedelta(days=1))) == "active"
    taken = await _code(world, mock_request, db)
    with patch("src.services.orgs.invitations.codes.secrets.choice", side_effect=lambda _a: taken["invite_code"][0]):
        row = (await db.execute(select(OrgInviteCode))).scalars().one()
        row.code = taken["invite_code"][0] * codes.CODE_LENGTH
        db.add(row)
        await db.commit()
        with pytest.raises(HTTPException) as exc:
            await codes._new_code(db, world.org.id)
    assert exc.value.status_code == 500


async def test_joining_with_a_code(world, mock_request, db, analytics_queue):
    code = await _code(world, mock_request, db, role_id=9, usergroup_ids=[1], course_uuids=["course_test"], max_uses=1)
    data = codes.as_join_data(await codes.find_active_code(db, world.org.id, code["invite_code"]))
    lea = await _user(db, 20, "lea@test.com", world.org, 4)
    with patch("src.services.orgs.invitations.apply.audit_event") as audit:
        await apply.apply_invite_code(mock_request, db, lea, world.org, data)
    assert (await _membership(db, 20, world.org.id)).role_id == 9
    assert (await db.execute(select(UserGroupUser).where(UserGroupUser.user_id == 20))).scalars().one().sources == ["code"]
    assert (await db.execute(select(TrailRun).where(TrailRun.user_id == 20))).scalars().one()
    assert audit.call_args.kwargs["details"]["role"] == "Learner Plus"
    assert any(e["event_name"] == "course_enrolled" and e["properties"]["source"] == "invite_code" for e in analytics_queue)
    row = (await db.execute(select(OrgInviteCode))).scalars().one()
    assert row.uses == 1

    # Used up: the next person joins (elsewhere) but gets nothing from it.
    sam = await _user(db, 21, "sam@test.com", world.org, 4)
    await apply.apply_invite_code(mock_request, db, sam, world.org, data)
    assert (await _membership(db, 21, world.org.id)).role_id == 4
    assert await apply.claim_code_use(db, row.id) is False

    # A role edited into a management role since falls back to User.
    row.max_uses = None
    db.add(row)
    reviewer = await db.get(Role, 9)
    reviewer.rights = _rights(USER_RIGHTS, users={"action_update": True})
    db.add(reviewer)
    await db.commit()
    await apply.apply_invite_code(mock_request, db, sam, world.org, data)
    assert (await _membership(db, 21, world.org.id)).role_id == 4

    # Wrong org, unknown code, nothing at all, a failure: no effect, no error.
    await apply.apply_invite_code(mock_request, db, sam, world.other_org, data)
    await apply.apply_invite_code(mock_request, db, sam, world.org, {**data, "id": 999})
    await apply.apply_invite_code(mock_request, db, sam, world.org, None)
    with patch("src.services.orgs.invitations.apply.claim_code_use", AsyncMock(side_effect=RuntimeError("x"))):
        await apply.apply_invite_code(mock_request, db, sam, world.org, data)

    # A Redis code: its user group, as before.
    with patch("src.services.users.usergroups.add_users_to_usergroup", new_callable=AsyncMock) as add:
        await apply.apply_invite_code(mock_request, db, sam, world.org, {"usergroup_id": "1"})
        await apply.apply_invite_code(mock_request, db, sam, world.org, {"invite_code": "OLD"})
    add.assert_awaited_once()
    assert add.await_args.args[3:] == (1, "21")


# ---------------------------------------------------------------------------
# Policy helpers
# ---------------------------------------------------------------------------


def test_parsing_and_cleaning():
    assert policy.parse_emails(["A@x.io, b@x.io", "a@x.io  bad"]) == (["a@x.io", "b@x.io"], ["bad"])
    assert policy.parse_emails(None) == ([], [])
    assert policy.parse_emails("x:y@x.io bad bad") == ([], ["x:y@x.io", "bad"])
    assert policy.looks_like_email("") is False and policy.looks_like_email("a\x01@x.io") is False
    assert policy.looks_like_email("a@" + "x" * 260 + ".io") is False
    assert policy.clean_message(None) is None and policy.clean_message(" \x00 ") is None
    assert policy.clean_message("Hi\n\tthere\x07") == "Hi\n\tthere"
    with pytest.raises(HTTPException):
        policy.expiry_from_days(0)
    with pytest.raises(HTTPException):
        policy.expiry_from_days(91)
    assert policy.expiry_from_days(None) > policy.utcnow()
    assert policy.aware(None) is None and policy.iso(None) is None
    with pytest.raises(HTTPException):
        policy.dedupe_ints(["x"])
    assert policy.dedupe_ints([1, "1", 2]) == [1, 2] and policy.dedupe_strs(["a", " a ", "", None, "b"]) == ["a", "b"]


def test_rights_helpers():
    assert policy.rights_dict(None) == {}
    assert policy.rights_dict(USER_RIGHTS) == USER_RIGHTS.model_dump()
    assert policy.rights_within({"note": "x", "users": {"action_read": True}}, {"users": "broken"}) is False
    assert policy.rights_within({"note": "x"}, {}) is True
    assert policy.occupies_seat(None) is False and policy.has_management_rights(None) is False
    assert policy.has_management_rights(Role(id=50, name="x", rights={"roles": {"action_delete": True}})) is True
    assert policy.has_management_rights(Role(id=51, name="x", rights={"users": "odd"})) is False
    assert policy.code_role_allowed(None, Role(id=4, name='User', rights={})) is False
    assert policy.code_role_allowed(Role(id=60, name='x', rights={}), None) is False


async def test_targets_roles_and_callers(world, mock_request, db):
    with pytest.raises(HTTPException) as many:
        await policy.validate_targets(db, world.org, list(range(1, 30)), [])
    assert many.value.status_code == 400
    for groups, courses in (([2], []), ([], ["course_foreign"])):
        with pytest.raises(HTTPException) as exc:
            await policy.validate_targets(db, world.org, groups, courses)
        assert exc.value.status_code == 404
    assert (await policy.resolve_role(db, world.org, role_uuid="role_global_instructor")).id == 3
    assert (await policy.resolve_role(db, world.org)).id == 4
    assert (await policy.role_for_grant(db, world.org.id, 10)).id == 4
    assert (await policy.role_for_grant(db, world.org.id, None)).id == 4

    assert await policy.caller_grant_ceiling(db, world.org, InternalUser(id=0)) == (True, None)
    with patch("src.security.backoffice.is_user_backoffice_staff", AsyncMock(return_value=True)):
        assert await policy.caller_grant_ceiling(db, world.org, world.regular) == (True, None)
    token = APITokenUser(org_id=world.org.id, rights=USER_RIGHTS.model_dump(), created_by_user_id=world.admin.id)
    unrestricted, role = await policy.caller_grant_ceiling(db, world.org, token)
    assert unrestricted is True and role.id == 1
    assert policy.grant_refusal(await db.get(Role, 3), True, None, token) == "ABOVE_TOKEN"
    assert policy.grant_refusal(await db.get(Role, 4), True, None, token) is None
    with pytest.raises(HTTPException) as exc:
        await policy.assert_can_grant_role(db, world.org, token, await db.get(Role, 3))
    assert exc.value.detail["code"] == "ROLE_ABOVE_TOKEN"

    from src.db.users import AnonymousUser

    with pytest.raises(HTTPException) as anon:
        await policy.require_invite_manager(mock_request, db, world.org, AnonymousUser())
    assert anon.value.status_code == 401
    with pytest.raises(HTTPException) as missing:
        await policy.load_org(db, 999)
    assert missing.value.status_code == 404


async def test_capacity_without_a_config_row(world, mock_request, db, other_org):
    with saas():
        cap = await policy.capacity(db, other_org.id)
    assert cap["plan"] is None and cap["members"]["limit"] is None
    assert policy.capacity_refusal(cap, 5, 5) is None


async def test_an_unproven_address_cannot_claim_an_invitation(world, mock_request, db):
    # Signing up with an invited address proves nothing until it's verified.
    db.add(OrgInvitation(
        invitation_uuid="invitation_unverified", org_id=world.org.id, email="regular@test.com", role_id=4,
        invited_by_user_id=world.admin.id, expires_at=policy.utcnow() + timedelta(days=1),
        created_at=policy.utcnow(), updated_at=policy.utcnow(),
    ))
    await db.commit()
    regular = await db.get(User, world.regular.id)
    regular.email_verified = False
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await apply.accept_invitation(mock_request, db, regular, world.org, await _row(db, "regular@test.com"), via="open_join")
    assert exc.value.status_code == 404
    regular.email_verified = True
    await db.commit()
    out = await apply.accept_invitation(mock_request, db, regular, world.org, await _row(db, "regular@test.com"), via="open_join")
    assert out["role"]
