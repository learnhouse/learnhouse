"""The demo branch of each shared code path, exercised directly.

Every one of these is a one-line `if this is the demo` inside a function that
ordinary organizations also use. They are the whole safety story of the feature
and the easiest thing to delete by accident, so each gets a test that fails if
the branch stops firing — and, where the same call answers 403 for more than one
reason, an assertion pinned to this guard's own message.
"""

from datetime import datetime

import pytest
from fastapi import HTTPException

from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.security.rbac.constants import ADMIN_ROLE_ID


@pytest.fixture
async def demo_org(db):
    from src.db.organization_config import OrganizationConfig

    now = str(datetime.now())
    o = Organization(
        id=99,
        name="Demo Academy",
        slug="demo",
        email="demo@example.com",
        org_uuid="org_demo",
        is_demo=True,
        creation_date=now,
        update_date=now,
    )
    db.add(o)
    await db.flush()
    db.add(
        OrganizationConfig(
            org_id=o.id,
            config={"config_version": "2.0", "plan": "pro", "active": True},
            creation_date=now,
            update_date=now,
        )
    )
    await db.commit()
    await db.refresh(o)
    return o


@pytest.fixture
async def visitor(db, demo_org):
    """A real person who opened the demo, and so holds admin on it."""
    now = str(datetime.now())
    user = User(
        id=808,
        username="visitor",
        first_name="Vis",
        last_name="Itor",
        email="visitor@example.com",
        password="hashed",
        user_uuid="user_visitor808",
        signup_method="email",
        creation_date=now,
        update_date=now,
    )
    db.add(user)
    await db.flush()
    db.add(
        UserOrganization(
            user_id=user.id, org_id=demo_org.id, role_id=ADMIN_ROLE_ID,
            creation_date=now, update_date=now,
        )
    )
    await db.commit()
    return user


async def _seeded_student(db, demo_org, uid=810):
    now = str(datetime.now())
    student = User(
        id=uid,
        username=f"student{uid}",
        first_name="Stu",
        last_name="Dent",
        email=f"demo-{uid}@demo.example.com",
        password="hashed",
        user_uuid=f"user_student{uid}",
        signup_method="demo",
        creation_date=now,
        update_date=now,
    )
    db.add(student)
    await db.flush()
    db.add(
        UserOrganization(
            user_id=student.id, org_id=demo_org.id, role_id=4,
            creation_date=now, update_date=now,
        )
    )
    await db.commit()
    return student


# ---------------------------------------------------------------------------
# the org itself
# ---------------------------------------------------------------------------

async def test_the_demo_slug_cannot_be_changed(db, demo_org, visitor):
    """The slug is the address every entry point sends visitors to."""
    from src.db.organizations import OrganizationUpdate
    from src.services.orgs.orgs import update_org

    with pytest.raises(HTTPException) as exc:
        await update_org(
            request=None,  # type: ignore[arg-type]
            org_object=OrganizationUpdate(slug="not-the-demo"),
            org_id=demo_org.id,
            current_user=visitor,
            db_session=db,
        )
    assert exc.value.status_code == 403
    assert "demo" in str(exc.value.detail).lower()


async def test_the_demo_name_can_still_be_changed(db, demo_org, visitor, monkeypatch):
    """Only slug and scripts are refused; the demo is meant to be played with.

    Without this the two rejections above could be a blanket "no writes", which
    would be a different feature.
    """
    from src.db.organizations import OrganizationUpdate
    from src.services.orgs.orgs import update_org

    async def _allow(*args, **kwargs):
        return True

    monkeypatch.setattr("src.services.orgs.orgs.rbac_check", _allow)

    await update_org(
        request=None,  # type: ignore[arg-type]
        org_object=OrganizationUpdate(name="Renamed by a visitor"),
        org_id=demo_org.id,
        current_user=visitor,
        db_session=db,
    )

    await db.refresh(demo_org)
    assert demo_org.name == "Renamed by a visitor"


# ---------------------------------------------------------------------------
# plan and usage
# ---------------------------------------------------------------------------

async def test_the_plan_endpoint_refuses_the_demo(db, demo_org):
    """The demo runs on pro by configuration, not by anyone buying it."""
    from src.routers.orgs.org_plan import UpdateOrgPlanRequest, api_update_org_plan

    with pytest.raises(HTTPException) as exc:
        await api_update_org_plan(
            request=None,  # type: ignore[arg-type]
            body=UpdateOrgPlanRequest(org_id=demo_org.id, plan="free"),
            db_session=db,
        )
    assert exc.value.status_code == 403
    assert "demo" in str(exc.value.detail).lower()


async def test_admin_seats_are_unlimited_in_the_demo(db, demo_org, visitor):
    """Every visitor becomes an admin, so a seat limit would lock the demo.

    admin_seats has no feature config, so it cannot be raised by the overrides
    that unlock everything else — hence the branch this covers.
    """
    from src.services.orgs.usage import get_org_usage_and_limits

    usage = await get_org_usage_and_limits(
        request=None,  # type: ignore[arg-type]
        org_id=demo_org.id,
        current_user=visitor,
        db_session=db,
    )

    seats = usage.get("admin_seats") or {}
    assert seats.get("limit") in (0, None), f"admin seats are capped: {seats}"


# ---------------------------------------------------------------------------
# listings that reveal members
# ---------------------------------------------------------------------------

async def test_search_hides_other_visitors(db, demo_org, visitor):
    """A query matching several members was a roster of everyone who had tried
    the demo. The seeded students stay searchable; they are the point."""
    from src.services.search.search import search_across_org

    # One distinctive surname shared by a seeded student and a real visitor, so
    # a single query reaches both and the filter is the only thing separating
    # them.
    now = str(datetime.now())
    student = User(
        id=810, username="seededlearner", first_name="Stu", last_name="Quillfeather",
        email="demo-810@demo.example.com", password="hashed",
        user_uuid="user_student810", signup_method="demo",
        creation_date=now, update_date=now,
    )
    stranger = User(
        id=811, username="anothervisitor", first_name="Stran", last_name="Quillfeather",
        email="stranger.search@example.com", password="hashed",
        user_uuid="user_stranger811", signup_method="email",
        creation_date=now, update_date=now,
    )
    db.add(student)
    db.add(stranger)
    await db.flush()
    for member in (student, stranger):
        db.add(
            UserOrganization(
                user_id=member.id, org_id=demo_org.id,
                role_id=4 if member is student else ADMIN_ROLE_ID,
                creation_date=now, update_date=now,
            )
        )
    await db.commit()

    result = await search_across_org(
        request=None,  # type: ignore[arg-type]
        current_user=visitor,
        org_slug=demo_org.slug,
        search_query="Quillfeather",
        db_session=db,
        page=1,
        limit=50,
    )

    usernames = {u.username for u in result.users}
    assert "seededlearner" in usernames, "the seeded students are the point"
    assert "anothervisitor" not in usernames


async def test_search_is_unrestricted_in_a_real_org(db, org, admin_user):
    """The filter is demo-only; a real org still searches its own members."""
    from src.services.search.search import search_across_org

    result = await search_across_org(
        request=None,  # type: ignore[arg-type]
        current_user=admin_user,
        org_slug=org.slug,
        search_query=admin_user.username,
        db_session=db,
        page=1,
        limit=50,
    )

    assert admin_user.username in {u.username for u in result.users}


async def test_the_audit_dossier_refuses_another_visitor(db, demo_org, visitor):
    """A dossier carries an email address, login IPs and user agents."""
    from src.routers.audit import _org_member_ids

    student = await _seeded_student(db, demo_org, uid=812)

    stranger = User(
        id=813, username="strangeraudit", first_name="Stran", last_name="Ger",
        email="stranger.audit@example.com", password="hashed",
        user_uuid="user_stranger813", signup_method="email",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(stranger)
    await db.flush()
    db.add(
        UserOrganization(
            user_id=stranger.id, org_id=demo_org.id, role_id=ADMIN_ROLE_ID,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
    )
    await db.commit()

    allowed = await _org_member_ids(
        [student.id, stranger.id, visitor.id], demo_org.id, db, visitor.id
    )

    assert student.id in allowed
    assert visitor.id in allowed
    assert stranger.id not in allowed


async def test_the_audit_dossier_is_unrestricted_in_a_real_org(db, org, admin_user):
    """The filter is demo-only; a real admin still gets their whole org."""
    from src.routers.audit import _org_member_ids

    allowed = await _org_member_ids(
        [admin_user.id], org.id, db, admin_user.id
    )

    assert admin_user.id in allowed
