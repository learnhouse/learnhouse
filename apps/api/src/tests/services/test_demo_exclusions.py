"""The demo organization must be invisible to billing, nudges and Explore.

Each test here corresponds to a place where treating the demo like an ordinary
organization has a real cost: a prospect blocked from creating their own org, a
Stripe line item built from fictional activity, or forty undeliverable emails
handed to the provider.
"""

from datetime import datetime

import pytest
from sqlmodel import select

from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.services.demo.guards import demo_org_ids, is_demo_org


@pytest.fixture
async def demo_org(db):
    from src.db.organization_config import OrganizationConfig

    o = Organization(
        id=99,
        name="Demo Academy",
        slug="demo",
        email="demo@example.com",
        org_uuid="org_demo",
        is_demo=True,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(o)
    await db.flush()
    # On the pro plan, exactly as the sync configures it — the paid plan is
    # what makes several of the tests below meaningful.
    db.add(
        OrganizationConfig(
            org_id=o.id,
            config={"config_version": "2.0", "plan": "pro", "active": True},
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()
    await db.refresh(o)
    return o


# ---------------------------------------------------------------------------
# guards
# ---------------------------------------------------------------------------

async def test_is_demo_org_distinguishes_orgs(db, org, demo_org):
    assert await is_demo_org(demo_org.id, db) is True
    assert await is_demo_org(org.id, db) is False


async def test_is_demo_org_handles_missing_org(db):
    """A deleted or never-existent org is not a demo org, and must not raise.

    This runs on the billing path, where an exception would be a 500 on a
    money-handling endpoint rather than a quiet False.
    """
    assert await is_demo_org(4242, db) is False
    assert await is_demo_org(None, db) is False


async def test_demo_org_ids_returns_only_demo_orgs(db, org, other_org, demo_org):
    assert await demo_org_ids(db) == {demo_org.id}


# ---------------------------------------------------------------------------
# free-org cap — the exclusion that blocks real signups if it regresses
# ---------------------------------------------------------------------------

async def _make_admin_of(db, user_id: int, org_id: int) -> None:
    db.add(
        UserOrganization(
            user_id=user_id,
            org_id=org_id,
            role_id=ADMIN_ROLE_ID,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()


async def test_free_org_cap_ignores_demo_membership(db, org, other_org, demo_org):
    """Visiting the demo must not consume one of a user's three free orgs.

    The cap counts orgs where the user is admin, and entering the demo makes
    every visitor an admin of it. Without the filter, three visits would leave
    a user unable to create the organization they actually came to make.
    """
    from src.services.orgs.orgs import _enforce_free_org_cap

    class _User:
        id = 7

    # Two real orgs plus the demo: three admin memberships, but only two count.
    await _make_admin_of(db, 7, org.id)
    await _make_admin_of(db, 7, other_org.id)
    await _make_admin_of(db, 7, demo_org.id)

    # Must not raise — the user is at 2 of 3, not 3 of 3.
    await _enforce_free_org_cap(_User(), db)


async def test_paid_demo_does_not_exempt_a_user_from_the_free_org_cap(db, demo_org):
    """The exclusion that lets the demo run on a paid plan at all.

    The cap exempts anyone who owns at least one paid organization — "a
    customer, not free-tier". The demo is on pro and every visitor is an admin
    of it, so without the is_demo filter in the admin-org query, merely looking
    at the demo would grant that exemption permanently: unlimited free
    organizations for anyone who clicked the demo link once.
    """
    from fastapi import HTTPException

    from src.services.orgs.orgs import MAX_FREE_ORGS, _enforce_free_org_cap

    class _User:
        id = 11

    for i in range(MAX_FREE_ORGS):
        db.add(
            Organization(
                id=300 + i,
                name=f"Real {i}",
                slug=f"capped-{i}",
                email=f"c{i}@example.com",
                org_uuid=f"org_capped_{i}",
                is_demo=False,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
    await db.commit()
    for i in range(MAX_FREE_ORGS):
        await _make_admin_of(db, 11, 300 + i)
    # …and an admin membership of the paid demo org.
    await _make_admin_of(db, 11, demo_org.id)

    # Still capped: the pro demo must not count as their paid organization.
    with pytest.raises(HTTPException) as exc:
        await _enforce_free_org_cap(_User(), db)
    assert exc.value.status_code == 403


async def test_free_org_cap_still_fires_on_real_orgs(db):
    """The filter must not defeat the cap itself."""
    from fastapi import HTTPException

    from src.services.orgs.orgs import MAX_FREE_ORGS, _enforce_free_org_cap

    class _User:
        id = 8

    for i in range(MAX_FREE_ORGS):
        o = Organization(
            id=200 + i,
            name=f"Real {i}",
            slug=f"real-{i}",
            email=f"r{i}@example.com",
            org_uuid=f"org_real_{i}",
            is_demo=False,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(o)
    await db.commit()
    for i in range(MAX_FREE_ORGS):
        await _make_admin_of(db, 8, 200 + i)

    with pytest.raises(HTTPException) as exc:
        await _enforce_free_org_cap(_User(), db)
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# active-user overage — the money path
# ---------------------------------------------------------------------------

async def test_active_user_summary_is_zeroed_for_demo(db, demo_org):
    """Synthetic activity must never reach a Stripe invoice line.

    The demo seeds UserActivityDay rows so its dashboards are not empty. This
    is the function the platform reads to bill active-user overage.
    """
    from src.security.features_utils.active_users import get_active_user_summary

    summary = await get_active_user_summary(demo_org.id, db, year=2026, month=8)

    assert summary["overage_units"] == 0
    assert summary["overage_usd"] == 0
    assert summary["active_users"] == 0
    assert summary["members_beyond_included"] == 0
    # Second, independent barrier: the frontend only bills plans in
    # BILLABLE_PLANS ({standard, pro}). The demo runs on pro, so reporting the
    # real plan here would put it in that set — it reports "demo" instead.
    assert summary["plan"] == "demo"


async def test_usage_event_not_logged_for_demo(db, demo_org, org):
    """UsageEvent is the billing ledger; the demo must not write to it."""
    from src.db.billing_usage import UsageEvent
    from src.security.features_utils.usage import log_usage_event

    await log_usage_event(demo_org.id, "courses", "add", db)

    rows = (await db.execute(select(UsageEvent))).scalars().all()
    assert rows == []


# ---------------------------------------------------------------------------
# email
# ---------------------------------------------------------------------------

def test_demo_addresses_are_recognised():
    from src.services.demo.flags import is_demo_email

    assert is_demo_email("demo-01@demo.example.com") is True
    assert is_demo_email("DEMO-01@DEMO.EXAMPLE.COM") is True
    # The parent domain is not the demo domain — only the demo subdomain is.
    assert is_demo_email("someone@example.com") is False
    assert is_demo_email("") is False
    assert is_demo_email(None) is False
    # Not a suffix match: the address must actually be on the demo domain.
    assert is_demo_email("attacker@notdemo.example.com.evil.test") is False


def test_send_email_drops_demo_recipients(monkeypatch):
    """No provider call is made for a fake student's address."""
    from src.services.email import utils as email_utils

    calls = []
    monkeypatch.setattr(
        email_utils, "_send_email_resend",
        lambda *a, **k: calls.append(a),
    )
    monkeypatch.setattr(
        email_utils, "_send_email_smtp",
        lambda *a, **k: calls.append(a),
    )

    assert email_utils.send_email("demo-03@demo.example.com", "Subject", "<p>Body</p>") is None
    assert calls == []


def test_send_email_still_delivers_to_real_recipients(monkeypatch):
    """The guard must not swallow ordinary transactional mail."""
    from src.services.email import utils as email_utils

    calls = []
    monkeypatch.setattr(
        email_utils, "_send_email_resend",
        lambda *a, **k: calls.append(a) or "sent",
    )
    monkeypatch.setattr(
        email_utils, "_send_email_smtp",
        lambda *a, **k: calls.append(a) or "sent",
    )

    email_utils.send_email("real.person@example.com", "Subject", "<p>Body</p>")
    assert len(calls) == 1


# ---------------------------------------------------------------------------
# explore + nudges
# ---------------------------------------------------------------------------

async def test_explore_excludes_demo_org(db, demo_org, org):
    """Explore is a directory of real schools."""
    from src.services.explore.explore import get_orgs_for_explore

    # Both flagged for Explore; only the real one may be listed.
    demo_org.explore = True
    org.explore = True
    db.add(demo_org)
    db.add(org)
    await db.commit()

    results = await get_orgs_for_explore(request=None, db_session=db)  # type: ignore[arg-type]
    slugs = {r.slug for r in results}

    assert "demo" not in slugs
    assert org.slug in slugs


async def test_nudge_scan_skips_demo_org(db, demo_org, org):
    """No lifecycle email about an academy full of fictional learners."""
    from src.services.nudges.eligibility import iter_snapshots

    seen = [snapshot.org_id async for snapshot in iter_snapshots(db)]

    assert demo_org.id not in seen
    assert org.id in seen


# ---------------------------------------------------------------------------
# member privacy
# ---------------------------------------------------------------------------

async def _demo_member(db, org, *, uid, username, email, signup_method):
    """A member of the demo org: either a seeded student or a visiting admin."""
    from src.db.users import User

    user = User(
        id=uid,
        username=username,
        first_name=username.title(),
        last_name="Person",
        email=email,
        password="hashed",
        user_uuid=f"user_{username}",
        email_verified=True,
        signup_method=signup_method,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(user)
    await db.flush()
    db.add(
        UserOrganization(
            user_id=user.id,
            org_id=org.id,
            role_id=ADMIN_ROLE_ID,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()
    await db.refresh(user)
    return user


@pytest.fixture
async def demo_members(db, demo_org, admin_role):
    """One seeded student, the visitor doing the looking, and another visitor."""
    student = await _demo_member(
        db, demo_org, uid=901, username="student",
        email="demo-01@demo.example.com", signup_method="demo",
    )
    viewer = await _demo_member(
        db, demo_org, uid=902, username="viewer",
        email="viewer@real.example.com", signup_method="email",
    )
    stranger = await _demo_member(
        db, demo_org, uid=903, username="stranger",
        email="stranger@real.example.com", signup_method="email",
    )
    return student, viewer, stranger


async def test_members_page_hides_other_visitors_in_the_demo(
    db, demo_org, demo_members, mock_request
):
    """Every visitor is an admin here, so the members page is a mailing list.

    The seeded students are the point of the page and stay visible. Other
    visitors — real people, real addresses — must not be.
    """
    from unittest.mock import patch

    from src.services.orgs.users import get_organization_users

    student, viewer, stranger = demo_members

    with patch("src.services.orgs.users.is_org_member", return_value=True), patch(
        "src.security.superadmin.is_user_superadmin", return_value=False
    ), patch("src.security.org_auth.is_org_admin", return_value=True):
        result = await get_organization_users(
            mock_request, demo_org.id, db, viewer, limit=100
        )

    emails = {item.user.email for item in result["items"]}

    assert student.email in emails
    assert viewer.email in emails, "you can always see yourself"
    assert stranger.email not in emails
    assert result["total"] == len(result["items"]) == 2


async def test_members_csv_export_hides_other_visitors_in_the_demo(
    db, demo_org, demo_members, mock_request
):
    """The same leak, one button along: CSV export runs its own query."""
    from unittest.mock import patch

    from src.services.orgs.users import export_organization_users_csv

    student, viewer, stranger = demo_members

    with patch("src.services.orgs.users.is_org_member", return_value=True), patch(
        "src.security.superadmin.is_user_superadmin", return_value=False
    ), patch("src.security.org_auth.is_org_admin", return_value=True):
        response = await export_organization_users_csv(
            mock_request, demo_org.id, db, viewer
        )

    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk.decode() if isinstance(chunk, bytes) else str(chunk))
    csv_text = "".join(chunks)

    assert student.email in csv_text
    assert stranger.email not in csv_text


async def test_members_page_is_unfiltered_for_a_real_org(
    db, org, admin_user, mock_request
):
    """The filter is demo-only; a real org still lists all of its members."""
    from unittest.mock import patch

    from src.services.orgs.users import get_organization_users

    colleague = await _demo_member(
        db, org, uid=904, username="colleague",
        email="colleague@real.example.com", signup_method="email",
    )

    with patch("src.services.orgs.users.is_org_member", return_value=True), patch(
        "src.security.superadmin.is_user_superadmin", return_value=False
    ), patch("src.security.org_auth.is_org_admin", return_value=True):
        result = await get_organization_users(
            mock_request, org.id, db, admin_user, limit=100
        )

    emails = {item.user.email for item in result["items"]}
    assert colleague.email in emails
    assert admin_user.email in emails
