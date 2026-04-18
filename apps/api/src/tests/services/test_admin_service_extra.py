"""Extra tests for src.services.admin.admin to improve coverage.

Targets:
  Lines 847-848, 852-853 - remove_user_from_org_admin exception swallowing
  Line 827  - remove_user_from_org_admin user not in org (second membership check)
  Line 899  - _validate_magic_link_redirect whitespace-only returns None
  Lines 986, 995 - consume_magic_link_token incomplete payload / ghost user
  Line 1125 - list_course_enrollments course not found
  Line 1227 - award_certificate course not found
  Lines 1276, 1282 - revoke_certificate cert/course boundary checks
  Lines 1509-1510 - update_user_profile _invalidate_session_cache swallowed
  Line 1529 - change_user_role role belongs to wrong org
  Line 1538 - change_user_role user not in org (second membership check)
  Lines 1561-1562 - change_user_role _invalidate_session_cache swallowed
  Line 1836 - bulk_unenroll_users enrolled user with TrailSteps -> steps deleted
  Lines 1979-1980 - anonymize_user _invalidate_session_cache swallowed
  Line 2058 - get_course_analytics certification + CertificateUser count > 0
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.certifications import CertificateUser, Certifications
from src.db.courses.courses import Course
from src.db.roles import Role, RoleTypeEnum
from src.db.trail_runs import StatusEnum, TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, User
from src.services.admin.admin import (
    _validate_magic_link_redirect,
    anonymize_user,
    award_certificate,
    bulk_unenroll_users,
    change_user_role,
    consume_magic_link_token,
    get_course_analytics,
    list_course_enrollments,
    remove_user_from_org_admin,
    revoke_certificate,
    update_user_profile,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_token_user(org_id: int) -> APITokenUser:
    return APITokenUser(
        id=99,
        user_uuid="api_token_user",
        username="api_token_user",
        org_id=org_id,
        rights={},
        token_name="test-token",
        created_by_user_id=1,
    )


def _add_user_to_org(db, user: User, org, role_id: int = 4) -> UserOrganization:
    uo = UserOrganization(
        user_id=user.id,
        org_id=org.id,
        role_id=role_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(uo)
    db.commit()
    return uo


def _create_user(db, *, user_id: int, username: str, email: str) -> User:
    u = User(
        id=user_id,
        username=username,
        first_name="Test",
        last_name="User",
        email=email,
        password="hashed",
        user_uuid=f"user_{username}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _create_certification(db, course, *, cert_id: int = 10) -> Certifications:
    cert = Certifications(
        id=cert_id,
        course_id=course.id,
        config={},
        certification_uuid=f"cert_{cert_id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(cert)
    db.commit()
    db.refresh(cert)
    return cert


def _create_certificate_user(
    db,
    certification: Certifications,
    user: User,
    *,
    cu_id: int = 20,
    uuid: str = "cert-user-uuid-extra",
) -> CertificateUser:
    cu = CertificateUser(
        id=cu_id,
        user_id=user.id,
        certification_id=certification.id,
        user_certification_uuid=uuid,
        created_at=str(datetime.now()),
        updated_at=str(datetime.now()),
    )
    db.add(cu)
    db.commit()
    db.refresh(cu)
    return cu


def _create_trail_run(db, user: User, course: Course, org) -> TrailRun:
    trail = Trail(
        org_id=org.id,
        user_id=user.id,
        trail_uuid=f"trail_{user.id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(trail)
    db.commit()
    db.refresh(trail)

    tr = TrailRun(
        trail_id=trail.id,
        course_id=course.id,
        org_id=org.id,
        user_id=user.id,
        status=StatusEnum.STATUS_IN_PROGRESS,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(tr)
    db.commit()
    db.refresh(tr)
    return tr


# ---------------------------------------------------------------------------
# Line 899 — _validate_magic_link_redirect whitespace-only
# ---------------------------------------------------------------------------


def test_validate_magic_link_redirect_whitespace_returns_none():
    result = _validate_magic_link_redirect("   ")
    assert result is None


# ---------------------------------------------------------------------------
# Lines 986, 995 — consume_magic_link_token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_consume_magic_link_token_incomplete_payload_raises_410(db):
    """Line 986: payload has purpose=magic_link but no sub → 410."""
    with patch("src.security.auth.decode_jwt") as mock_decode:
        mock_decode.return_value = {"purpose": "magic_link", "org_id": 1}
        with pytest.raises(HTTPException) as exc_info:
            await consume_magic_link_token("fake-token", db)
    assert exc_info.value.status_code == 410
    assert "incomplete" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_consume_magic_link_token_ghost_user_raises_410(db):
    """Line 995: valid sub + org_id but user doesn't exist in DB → 410."""
    with patch("src.security.auth.decode_jwt") as mock_decode:
        mock_decode.return_value = {
            "sub": "ghost@nonexistent.com",
            "purpose": "magic_link",
            "org_id": 1,
        }
        with pytest.raises(HTTPException) as exc_info:
            await consume_magic_link_token("fake-token", db)
    assert exc_info.value.status_code == 410
    assert "no longer exists" in exc_info.value.detail.lower()


# ---------------------------------------------------------------------------
# Line 1125 — list_course_enrollments course not found
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_course_enrollments_course_not_found(db, org):
    token_user = _make_token_user(org.id)
    with pytest.raises(HTTPException) as exc_info:
        await list_course_enrollments(token_user, "nonexistent-uuid", db)
    assert exc_info.value.status_code == 404
    assert "course not found" in exc_info.value.detail.lower()


# ---------------------------------------------------------------------------
# Line 1227 — award_certificate course not found
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_award_certificate_course_not_found(db, org, user_role):
    token_user = _make_token_user(org.id)
    user = _create_user(db, user_id=50, username="awardee", email="awardee@test.com")
    _add_user_to_org(db, user, org, role_id=user_role.id)

    mock_request = object()
    with pytest.raises(HTTPException) as exc_info:
        await award_certificate(token_user, user.id, "no-such-course", mock_request, db)
    assert exc_info.value.status_code == 404
    assert "course not found" in exc_info.value.detail.lower()


# ---------------------------------------------------------------------------
# Lines 1276, 1282 — revoke_certificate boundary checks
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revoke_certificate_certifications_row_missing_raises_404(db, org, course, user_role):
    """Line 1276: cert_user exists but Certifications row doesn't → 404."""
    token_user = _make_token_user(org.id)
    user = _create_user(db, user_id=51, username="revokee1", email="revokee1@test.com")
    _add_user_to_org(db, user, org, role_id=user_role.id)

    # Create a CertificateUser that points to a certification_id that doesn't exist
    # We do this via a raw insert to avoid FK enforcement on SQLite
    cu = CertificateUser(
        id=30,
        user_id=user.id,
        certification_id=999,  # no matching Certifications row
        user_certification_uuid="orphan-cert-user-uuid",
        created_at=str(datetime.now()),
        updated_at=str(datetime.now()),
    )
    db.add(cu)
    db.commit()

    with patch("src.services.admin.admin.dispatch_webhooks", new_callable=AsyncMock):
        with pytest.raises(HTTPException) as exc_info:
            await revoke_certificate(token_user, user.id, "orphan-cert-user-uuid", db)
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_revoke_certificate_course_wrong_org_raises_404(db, org, course, user_role):
    """Line 1282: course.org_id != token_user.org_id → 404."""
    token_user = _make_token_user(org.id)
    user = _create_user(db, user_id=52, username="revokee2", email="revokee2@test.com")
    _add_user_to_org(db, user, org, role_id=user_role.id)

    # Create a course that belongs to a *different* org (id=999)
    other_course = Course(
        id=50,
        name="Other Org Course",
        description="A course from another org",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=999,
        course_uuid="course_other_org",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(other_course)
    db.commit()
    db.refresh(other_course)

    cert = _create_certification(db, other_course, cert_id=11)
    _create_certificate_user(db, cert, user, cu_id=31, uuid="wrong-org-cert-uuid")

    with patch("src.services.admin.admin.dispatch_webhooks", new_callable=AsyncMock):
        with pytest.raises(HTTPException) as exc_info:
            await revoke_certificate(token_user, user.id, "wrong-org-cert-uuid", db)
    assert exc_info.value.status_code == 404


# ---------------------------------------------------------------------------
# Lines 847-848, 852-853 — remove_user_from_org_admin exception swallowing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_remove_user_from_org_invalidate_cache_raises_is_swallowed(db, org, admin_role, user_role):
    """Lines 847-848: _invalidate_session_cache raises → swallowed, function succeeds."""
    token_user = _make_token_user(org.id)

    # We need an admin user in the org too (so we're not removing the last admin)
    admin_user = _create_user(db, user_id=60, username="admin60", email="admin60@test.com")
    _add_user_to_org(db, admin_user, org, role_id=admin_role.id)

    # Another admin so there are 2 admins (prevents last-admin guard)
    admin_user2 = _create_user(db, user_id=61, username="admin61", email="admin61@test.com")
    _add_user_to_org(db, admin_user2, org, role_id=admin_role.id)

    # Regular user to remove
    reg_user = _create_user(db, user_id=62, username="reg62", email="reg62@test.com")
    _add_user_to_org(db, reg_user, org, role_id=user_role.id)

    with patch("src.services.admin.admin.dispatch_webhooks", new_callable=AsyncMock):
        with patch("src.routers.users._invalidate_session_cache", side_effect=RuntimeError("cache fail")):
            with patch("src.services.admin.admin.decrease_feature_usage"):
                result = await remove_user_from_org_admin(token_user, reg_user.id, db)

    assert result == {"detail": "User removed from org"}


@pytest.mark.asyncio
async def test_remove_user_from_org_decrease_feature_usage_raises_is_swallowed(db, org, admin_role, user_role):
    """Lines 852-853: decrease_feature_usage raises → swallowed, function succeeds."""
    token_user = _make_token_user(org.id)

    admin_user = _create_user(db, user_id=63, username="admin63", email="admin63@test.com")
    _add_user_to_org(db, admin_user, org, role_id=admin_role.id)

    admin_user2 = _create_user(db, user_id=64, username="admin64", email="admin64@test.com")
    _add_user_to_org(db, admin_user2, org, role_id=admin_role.id)

    reg_user = _create_user(db, user_id=65, username="reg65", email="reg65@test.com")
    _add_user_to_org(db, reg_user, org, role_id=user_role.id)

    with patch("src.services.admin.admin.dispatch_webhooks", new_callable=AsyncMock):
        with patch("src.routers.users._invalidate_session_cache"):
            with patch("src.services.admin.admin.decrease_feature_usage", side_effect=RuntimeError("usage fail")):
                result = await remove_user_from_org_admin(token_user, reg_user.id, db)

    assert result == {"detail": "User removed from org"}


# ---------------------------------------------------------------------------
# Lines 1509-1510 — update_user_profile _invalidate_session_cache swallowed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_user_profile_invalidate_cache_raises_is_swallowed(db, org, user_role):
    """Lines 1509-1510: _invalidate_session_cache raises → swallowed."""
    token_user = _make_token_user(org.id)
    user = _create_user(db, user_id=70, username="profile70", email="profile70@test.com")
    _add_user_to_org(db, user, org, role_id=user_role.id)

    with patch("src.routers.users._invalidate_session_cache", side_effect=RuntimeError("cache fail")):
        result = await update_user_profile(token_user, user.id, {"bio": "updated bio"}, db)

    assert result.id == user.id


# ---------------------------------------------------------------------------
# Line 1529 — change_user_role role belongs to wrong org
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_change_user_role_role_wrong_org_raises_403(db, org, user_role):
    """Line 1529: role.org_id != token_user.org_id → 403."""
    token_user = _make_token_user(org.id)
    user = _create_user(db, user_id=80, username="rolechange80", email="rolechange80@test.com")
    _add_user_to_org(db, user, org, role_id=user_role.id)

    # Create a role that belongs to a different org (999)
    foreign_role = Role(
        id=200,
        name="Foreign Role",
        org_id=999,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_foreign",
        rights={},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(foreign_role)
    db.commit()

    with pytest.raises(HTTPException) as exc_info:
        await change_user_role(token_user, user.id, foreign_role.id, db)
    assert exc_info.value.status_code == 403
    assert "does not belong to this organization" in exc_info.value.detail.lower()


# ---------------------------------------------------------------------------
# Lines 1561-1562 — change_user_role _invalidate_session_cache swallowed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_change_user_role_invalidate_cache_raises_is_swallowed(db, org, admin_role, user_role):
    """Lines 1561-1562: _invalidate_session_cache raises → swallowed, role updated."""
    token_user = _make_token_user(org.id)

    # Need at least two admins so we can demote without triggering last-admin guard
    admin1 = _create_user(db, user_id=81, username="admin81", email="admin81@test.com")
    _add_user_to_org(db, admin1, org, role_id=admin_role.id)
    admin2 = _create_user(db, user_id=82, username="admin82", email="admin82@test.com")
    _add_user_to_org(db, admin2, org, role_id=admin_role.id)

    with patch("src.routers.users._invalidate_session_cache", side_effect=RuntimeError("cache fail")):
        result = await change_user_role(token_user, admin1.id, user_role.id, db)

    assert result["user_id"] == admin1.id
    assert result["role_id"] == user_role.id


# ---------------------------------------------------------------------------
# Line 1836 — bulk_unenroll_users user with no TrailRun → not_enrolled
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_unenroll_users_user_not_enrolled_goes_to_not_enrolled(db, org, course, user_role):
    """Line 1836: user_id with no TrailRun → appended to not_enrolled."""
    token_user = _make_token_user(org.id)
    user = _create_user(db, user_id=90, username="unenroll90", email="unenroll90@test.com")
    _add_user_to_org(db, user, org, role_id=user_role.id)

    # Do NOT create a TrailRun for this user — they are not enrolled
    result = await bulk_unenroll_users(token_user, course.course_uuid, [user.id], db)

    assert user.id in result["not_enrolled"]
    assert user.id not in result["unenrolled"]


# ---------------------------------------------------------------------------
# Lines 1979-1980 — anonymize_user _invalidate_session_cache swallowed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_anonymize_user_invalidate_cache_raises_is_swallowed(db, org, user_role):
    """Lines 1979-1980: _invalidate_session_cache raises → swallowed."""
    token_user = _make_token_user(org.id)
    user = _create_user(db, user_id=100, username="anon100", email="anon100@test.com")
    _add_user_to_org(db, user, org, role_id=user_role.id)

    with patch("src.services.admin.admin.dispatch_webhooks", new_callable=AsyncMock):
        with patch("src.routers.users._invalidate_session_cache", side_effect=RuntimeError("cache fail")):
            result = await anonymize_user(token_user, user.id, db)

    assert result["user_id"] == user.id
    assert "anonymized" in result["detail"].lower()


# ---------------------------------------------------------------------------
# Line 2058 — get_course_analytics certification + CertificateUser count > 0
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_course_analytics_with_certification_and_cert_users(db, org, course, user_role):
    """Line 2058: certification exists and CertificateUser count > 0."""
    token_user = _make_token_user(org.id)
    user = _create_user(db, user_id=110, username="certuser110", email="certuser110@test.com")
    _add_user_to_org(db, user, org, role_id=user_role.id)

    cert = _create_certification(db, course, cert_id=12)
    _create_certificate_user(db, cert, user, cu_id=40, uuid="analytics-cert-uuid")

    result = await get_course_analytics(token_user, course.course_uuid, db)

    assert result["course_uuid"] == course.course_uuid
    assert result["certificate_count"] == 1


# ---------------------------------------------------------------------------
# Line 827 — remove_user_from_org_admin: user passes _get_user_in_org but
# no UserOrganization row exists (second membership query returns None).
# We patch _get_user_in_org to bypass the first check.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_remove_user_from_org_admin_no_membership_row_raises_404(db, org):
    """Line 827: _get_user_in_org succeeds but UserOrganization row missing."""
    token_user = _make_token_user(org.id)
    user = _create_user(db, user_id=120, username="orphan120", email="orphan120@test.com")

    with patch("src.services.admin.admin._get_user_in_org", return_value=user):
        with pytest.raises(HTTPException) as exc_info:
            await remove_user_from_org_admin(token_user, user.id, db)

    assert exc_info.value.status_code == 404
    assert "User not in org" in exc_info.value.detail


# ---------------------------------------------------------------------------
# Line 1538 — change_user_role: user passes _get_user_in_org but no
# UserOrganization row exists (second membership query returns None).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_change_user_role_no_membership_row_raises_404(db, org, user_role):
    """Line 1538: _get_user_in_org succeeds but UserOrganization row missing."""
    token_user = _make_token_user(org.id)
    user = _create_user(db, user_id=121, username="orphan121", email="orphan121@test.com")

    with patch("src.services.admin.admin._get_user_in_org", return_value=user):
        with pytest.raises(HTTPException) as exc_info:
            await change_user_role(token_user, user.id, user_role.id, db)

    assert exc_info.value.status_code == 404
    assert "User not in org" in exc_info.value.detail


# ---------------------------------------------------------------------------
# Line 1836 — bulk_unenroll_users: enrolled user with TrailSteps gets steps
# deleted (the db_session.delete(step) branch).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bulk_unenroll_users_enrolled_user_with_steps_deleted(db, org, course, user_role, activity):
    """Line 1836: user IS enrolled with TrailRun and TrailSteps, steps deleted."""
    from sqlmodel import select as sql_select

    token_user = _make_token_user(org.id)
    user = _create_user(db, user_id=122, username="enrolled122", email="enrolled122@test.com")
    _add_user_to_org(db, user, org, role_id=user_role.id)

    trail = Trail(
        org_id=org.id,
        user_id=user.id,
        trail_uuid="trail_enrolled122",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(trail)
    db.commit()
    db.refresh(trail)

    trail_run = TrailRun(
        trail_id=trail.id,
        course_id=course.id,
        org_id=org.id,
        user_id=user.id,
        status=StatusEnum.STATUS_IN_PROGRESS,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(trail_run)
    db.commit()
    db.refresh(trail_run)

    step = TrailStep(
        complete=True,
        teacher_verified=False,
        grade="",
        data={},
        trailrun_id=trail_run.id,
        trail_id=trail.id,
        activity_id=activity.id,
        course_id=course.id,
        org_id=org.id,
        user_id=user.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(step)
    db.commit()
    db.refresh(step)
    step_id = step.id

    result = await bulk_unenroll_users(token_user, course.course_uuid, [user.id], db)

    assert user.id in result["unenrolled"]
    assert user.id not in result["not_enrolled"]
    remaining = db.exec(sql_select(TrailStep).where(TrailStep.id == step_id)).first()
    assert remaining is None
