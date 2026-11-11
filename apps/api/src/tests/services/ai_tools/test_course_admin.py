"""Course certificate and contributor tools, run through the full tool
pipeline (validation, scope, rights pre-flight, approval gate, execute)."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlmodel import select

from src.db.courses.certifications import CertificateUser, Certifications
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.services.ai.tools import (
    ToolContext,
    ToolRegistry,
    make_synthetic_request,
    run_tool,
)
from src.services.ai.tools import course_admin, refs

NOW = str(datetime.now())
CERTS = "src.services.courses.certifications"
PLAN = "src.security.features_utils.plan_check"


# ─── fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(course_admin.SPECS)
    return r


@pytest.fixture(autouse=True)
def quiet_services():
    """Keep analytics, webhooks, audit rows and links local; run the plan gate
    as on the cloud (SaaS mode), with the org on Pro."""
    hooks = AsyncMock()
    with patch(f"{PLAN}._check_mode_bypass", return_value=None), \
            patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"), \
            patch(f"{PLAN}.get_org_plan", new=AsyncMock(return_value="pro")), \
            patch(f"{CERTS}.track", new=AsyncMock()), \
            patch(f"{CERTS}.dispatch_webhooks", new=hooks), \
            patch(f"{CERTS}.record_audit_event", new=AsyncMock()), \
            patch("src.services.courses.contributors.dispatch_webhooks", new=AsyncMock()), \
            patch.object(refs, "web_base", new=AsyncMock(return_value="https://acme.test")):
        yield hooks


def ctx_for(db, org, user, *, approved=False, mode="execute"):
    return ToolContext(
        request=make_synthetic_request(),
        db_session=db,
        user=user,
        org=org,
        org_slug=org.slug,
        mode=mode,
        surface="mcp",
        approved=approved,
    )


async def call(registry, ctx, name, args):
    return await run_tool(registry, name, args, ctx)


def ok(out):
    assert out.status == "executed", (out.denied_code, out.reason)
    return out.result


async def _member(db, org, role, *, id, username, first="", last=""):
    u = User(
        id=id,
        username=username,
        first_name=first,
        last_name=last,
        email=f"{username}@test.com",
        password="hashed_password",
        user_uuid=f"user_{username}",
        creation_date=NOW,
        update_date=NOW,
    )
    db.add(u)
    await db.commit()
    db.add(UserOrganization(user_id=u.id, org_id=org.id, role_id=role.id, creation_date=NOW, update_date=NOW))
    await db.commit()
    return PublicUser(
        id=u.id, username=u.username, first_name=first, last_name=last, email=u.email, user_uuid=u.user_uuid
    )


async def _author(db, course, user, role, status=ResourceAuthorshipStatusEnum.ACTIVE):
    db.add(
        ResourceAuthor(
            resource_uuid=course.course_uuid,
            user_id=user.id,
            authorship=role,
            authorship_status=status,
            creation_date=NOW,
            update_date=NOW,
        )
    )
    await db.commit()


@pytest.fixture
async def teacher(db, org, user_role, course):
    """A plain member who created the course."""
    t = await _member(db, org, user_role, id=3, username="teacher", first="Tess", last="Cher")
    await _author(db, course, t, ResourceAuthorshipEnum.CREATOR)
    return t


@pytest.fixture
async def alice(db, org, user_role):
    return await _member(db, org, user_role, id=5, username="alice", first="Alice", last="A")


@pytest.fixture
async def bob(db, org, user_role):
    return await _member(db, org, user_role, id=6, username="bob")


async def _cert(db):
    return (await db.execute(select(Certifications))).scalars().first()


async def _issue(db, cert, user):
    db.add(
        CertificateUser(
            user_id=user.id,
            certification_id=cert.id,
            user_certification_uuid=f"AB-20260101-{user.id:04d}-cafe",
            created_at=NOW,
            updated_at=NOW,
        )
    )
    await db.commit()


async def _authorship(db, course, user):
    return (
        await db.execute(
            select(ResourceAuthor).where(
                ResourceAuthor.resource_uuid == course.course_uuid, ResourceAuthor.user_id == user.id
            )
        )
    ).scalars().first()


# ─── certificates ────────────────────────────────────────────────────────────


async def test_certificate_on_configure_off(registry, db, org, admin_user, course, teacher):
    ctx = ctx_for(db, org, admin_user)
    before = ok(await call(registry, ctx, "get_course_admin", {"course_uuid": course.course_uuid}))
    assert before["certificate"]["enabled"] is False
    assert "every assignment" in before["certificate"]["award_rule"]

    on = ok(await call(registry, ctx, "set_course_certificate", {
        "course_uuid": course.course_uuid, "enabled": True, "pattern": "royal",
    }))
    assert "turned certificates on" in on["summary"]
    cert = await _cert(db)
    # Unset fields default the way the dashboard prefills them.
    assert cert.config == {
        "certification_name": "Test Course",
        "certification_description": "A test course",
        "certification_type": "completion",
        "certificate_pattern": "royal",
        "certificate_instructor": "Tess Cher",
    }
    assert on["certificate"]["enabled"] is True and on["certificate"]["issued_count"] == 0
    assert on["certificate"]["settings_url"] == (
        "https://acme.test/dash/courses/course/test/certification"
    )

    again = ok(await call(registry, ctx, "set_course_certificate", {
        "course_uuid": course.course_uuid, "enabled": True,
    }))
    assert "already on" in again["summary"]

    ok(await call(registry, ctx, "set_course_certificate", {
        "course_uuid": course.course_uuid, "name": "DNS Expert", "type": "mastery", "instructor": "",
    }))
    await db.refresh(cert)
    assert cert.config["certification_name"] == "DNS Expert"
    assert cert.config["certification_type"] == "mastery"
    assert cert.config["certificate_instructor"] == ""
    assert cert.config["certificate_pattern"] == "royal"  # untouched

    read = ok(await call(registry, ctx, "get_course_admin", {"course_uuid": course.course_uuid}))
    assert read["certificate"]["name"] == "DNS Expert" and read["certificate"]["issued_count"] == 0

    # Nothing issued yet: turning off needs no approval.
    off = ok(await call(registry, ctx, "set_course_certificate", {
        "course_uuid": course.course_uuid, "enabled": False,
    }))
    assert off["certificate"] == {"enabled": False}
    assert await _cert(db) is None


async def test_certificate_argument_checks(registry, db, org, admin_user, course):
    ctx = ctx_for(db, org, admin_user)
    nothing = await call(registry, ctx, "set_course_certificate", {"course_uuid": course.course_uuid})
    assert nothing.denied_code == "http_400"
    off_course = await call(registry, ctx, "set_course_certificate", {
        "course_uuid": course.course_uuid, "name": "X",
    })
    assert off_course.denied_code == "http_400" and "enabled=true" in off_course.reason
    stray = await call(registry, ctx, "set_course_certificate", {
        "course_uuid": course.course_uuid, "revoke_issued": True,
    })
    assert stray.denied_code == "http_400"
    bad = await call(registry, ctx, "set_course_certificate", {
        "course_uuid": course.course_uuid, "enabled": True, "pattern": "neon",
    })
    assert bad.denied_code == "invalid_args"
    already_off = ok(await call(registry, ctx, "set_course_certificate", {
        "course_uuid": course.course_uuid, "enabled": False,
    }))
    assert "already off" in already_off["summary"]


async def test_turning_off_with_issued_certificates(
    registry, db, org, admin_user, course, alice, bob, quiet_services
):
    ctx = ctx_for(db, org, admin_user)
    ok(await call(registry, ctx, "set_course_certificate", {"course_uuid": course.course_uuid, "enabled": True}))
    cert = await _cert(db)
    await _issue(db, cert, alice)
    await _issue(db, cert, bob)

    assert ok(await call(registry, ctx, "get_course_admin", {"course_uuid": course.course_uuid}))[
        "certificate"
    ]["issued_count"] == 2

    refused = await call(registry, ctx, "set_course_certificate", {
        "course_uuid": course.course_uuid, "enabled": False,
    })
    assert refused.denied_code == "http_409" and "2 learner(s)" in refused.reason
    assert "revoke_issued=true" in refused.reason

    args = {"course_uuid": course.course_uuid, "enabled": False, "revoke_issued": True}
    gated = await call(registry, ctx, "set_course_certificate", args)
    assert gated.denied_code == "approval_required"
    assert "revokes the 2 certificate(s)" in gated.reason
    assert await _cert(db) is not None
    assert len((await db.execute(select(CertificateUser))).scalars().all()) == 2

    done = ok(await call(registry, ctx_for(db, org, admin_user, approved=True), "set_course_certificate", args))
    assert done["revoked"] == 2 and "revoked 2" in done["summary"]
    assert await _cert(db) is None
    assert (await db.execute(select(CertificateUser))).scalars().all() == []
    # Each revocation went out as its own certificate_revoked event.
    events = [c.kwargs["event_name"] for c in quiet_services.await_args_list]
    assert events.count("certificate_revoked") == 2


async def test_revoke_one_learner(registry, db, org, admin_user, course, alice, bob):
    ctx = ctx_for(db, org, admin_user)
    ok(await call(registry, ctx, "set_course_certificate", {"course_uuid": course.course_uuid, "enabled": True}))
    cert = await _cert(db)
    await _issue(db, cert, alice)

    # Nobody named holds one: nothing to approve.
    none_held = ok(await call(registry, ctx, "set_course_certificate", {
        "course_uuid": course.course_uuid, "revoke_from": ["bob", "ghost"],
    }))
    assert {r["member"]: r["result"] for r in none_held["revoke_results"]} == {
        "bob": "no_certificate", "ghost": "not_a_member",
    }

    args = {"course_uuid": course.course_uuid, "revoke_from": ["alice", "bob"]}
    gated = await call(registry, ctx, "set_course_certificate", args)
    assert gated.denied_code == "approval_required" and "1 learner(s) (alice)" in gated.reason
    assert len((await db.execute(select(CertificateUser))).scalars().all()) == 1

    done = ok(await call(registry, ctx_for(db, org, admin_user, approved=True), "set_course_certificate", args))
    assert {r["member"]: r["result"] for r in done["revoke_results"]} == {
        "alice": "revoked", "bob": "no_certificate",
    }
    assert (await db.execute(select(CertificateUser))).scalars().all() == []
    assert await _cert(db) is not None  # the certificate itself stays on


async def test_certificate_refused_without_rights(registry, db, org, admin_user, regular_user, course):
    learner = await call(registry, ctx_for(db, org, regular_user, approved=True), "set_course_certificate", {
        "course_uuid": course.course_uuid, "enabled": True,
    })
    assert learner.status == "denied" and learner.denied_code in ("rbac_denied", "http_403")
    assert await _cert(db) is None

    # A learner can see that a certificate exists, but not how many were issued.
    ok(await call(registry, ctx_for(db, org, admin_user), "set_course_certificate", {
        "course_uuid": course.course_uuid, "enabled": True,
    }))
    seen = ok(await call(registry, ctx_for(db, org, regular_user), "get_course_admin", {
        "course_uuid": course.course_uuid,
    }))
    assert seen["certificate"]["enabled"] is True and "issued_count" not in seen["certificate"]


async def test_certificate_needs_pro_plan(registry, db, org, admin_user, course):
    with patch(f"{PLAN}.get_org_plan", new=AsyncMock(return_value="standard")):
        out = await call(registry, ctx_for(db, org, admin_user), "set_course_certificate", {
            "course_uuid": course.course_uuid, "enabled": True,
        })
        assert out.denied_code == "http_403" and "Pro plan" in out.reason
        read = ok(await call(registry, ctx_for(db, org, admin_user), "get_course_admin", {
            "course_uuid": course.course_uuid,
        }))
    assert read["certificate"]["available"] is False
    assert await _cert(db) is None


# ─── contributors ────────────────────────────────────────────────────────────


async def test_contributors_add_list_change_remove(registry, db, org, admin_user, course, teacher, alice, bob):
    args = {"course_uuid": course.course_uuid, "add": ["alice", "user_bob", "ghost"]}
    gated = await call(registry, ctx_for(db, org, admin_user), "manage_course_contributors", args)
    assert gated.denied_code == "approval_required"
    assert await _authorship(db, course, alice) is None

    approved = ctx_for(db, org, admin_user, approved=True)
    added = ok(await call(registry, approved, "manage_course_contributors", args))
    by_member = {r["member"]: r for r in added["results"]}
    assert by_member["alice"]["result"] == "added" and by_member["alice"]["status"] == "active"
    assert by_member["user_bob"]["result"] == "added"
    assert by_member["ghost"]["result"] == "not_a_member"
    row = await _authorship(db, course, alice)
    assert row.authorship == ResourceAuthorshipEnum.CONTRIBUTOR
    assert row.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE

    listed = ok(await call(registry, ctx_for(db, org, admin_user), "get_course_admin", {
        "course_uuid": course.course_uuid,
    }))
    people = listed["contributors"]["items"]
    assert [p["username"] for p in people] == ["teacher", "alice", "bob"]  # creator first
    assert people[0]["role"] == "creator" and people[0]["manages_contributors"] is True
    assert people[1]["name"] == "Alice A" and people[1]["can_edit"] is True
    assert people[1]["email"] == "alice@test.com"  # managers see emails
    assert "contributors" in listed["untrusted_fields"]
    assert listed["contributors_url"].endswith("/dash/courses/course/test/contributors")

    again = ok(await call(registry, approved, "manage_course_contributors", {
        "course_uuid": course.course_uuid, "add": ["alice"],
    }))
    assert again["results"][0]["result"] == "already_contributor"

    changed = ok(await call(registry, approved, "manage_course_contributors", {
        "course_uuid": course.course_uuid,
        "update": [
            {"member": "alice", "role": "maintainer"},
            {"member": "bob", "status": "inactive"},
            {"member": "teacher", "role": "reporter"},
        ],
    }))
    results = {r["member"]: r for r in changed["results"]}
    assert results["alice"]["result"] == "updated" and results["alice"]["role"] == "maintainer"
    assert results["bob"]["status"] == "inactive" and results["bob"]["role"] == "contributor"
    assert results["teacher"]["result"] == "refused" and "creator" in results["teacher"]["reason"]
    assert (await _authorship(db, course, alice)).authorship == ResourceAuthorshipEnum.MAINTAINER
    assert (await _authorship(db, course, bob)).authorship_status == ResourceAuthorshipStatusEnum.INACTIVE

    removed = ok(await call(registry, approved, "manage_course_contributors", {
        "course_uuid": course.course_uuid, "remove": ["alice", "teacher"],
    }))
    results = {r["member"]: r["result"] for r in removed["results"]}
    assert results == {"alice": "removed", "teacher": "is_creator"}
    assert await _authorship(db, course, alice) is None
    assert await _authorship(db, course, teacher) is not None


async def test_add_with_role_and_status(registry, db, org, admin_user, course, alice):
    ok(await call(registry, ctx_for(db, org, admin_user, approved=True), "manage_course_contributors", {
        "course_uuid": course.course_uuid, "add": ["alice"], "role": "reporter", "status": "pending",
    }))
    row = await _authorship(db, course, alice)
    assert row.authorship == ResourceAuthorshipEnum.REPORTER
    assert row.authorship_status == ResourceAuthorshipStatusEnum.PENDING


async def test_contributor_argument_checks(registry, db, org, admin_user, course, alice):
    approved = ctx_for(db, org, admin_user, approved=True)
    empty = await call(registry, approved, "manage_course_contributors", {"course_uuid": course.course_uuid})
    assert empty.denied_code == "http_400"
    twice = await call(registry, approved, "manage_course_contributors", {
        "course_uuid": course.course_uuid, "add": ["alice"], "remove": ["user_alice"],
    })
    assert twice.denied_code == "http_400" and "same member" in twice.reason
    no_creator = await call(registry, approved, "manage_course_contributors", {
        "course_uuid": course.course_uuid, "add": ["alice"], "role": "creator",
    })
    assert no_creator.denied_code == "invalid_args"


async def test_course_creator_manages_own_contributors(registry, db, org, course, teacher, alice):
    out = ok(await call(registry, ctx_for(db, org, teacher, approved=True), "manage_course_contributors", {
        "course_uuid": course.course_uuid, "add": ["alice"],
    }))
    assert out["results"][0]["result"] == "added"
    # Email lookups stay with staff.
    by_email = await call(registry, ctx_for(db, org, teacher, approved=True), "manage_course_contributors", {
        "course_uuid": course.course_uuid, "remove": ["alice@test.com"],
    })
    assert by_email.denied_code == "http_403"


async def test_contributor_management_refused_without_rights(
    registry, db, org, regular_user, course, teacher, alice, bob
):
    learner = await call(registry, ctx_for(db, org, regular_user, approved=True), "manage_course_contributors", {
        "course_uuid": course.course_uuid, "add": ["bob"],
    })
    assert learner.status == "denied" and learner.denied_code in ("rbac_denied", "http_403")

    # An active contributor can edit the course but not change who else can.
    await _author(db, course, alice, ResourceAuthorshipEnum.CONTRIBUTOR)
    contributor = await call(registry, ctx_for(db, org, alice, approved=True), "manage_course_contributors", {
        "course_uuid": course.course_uuid, "add": ["bob"],
    })
    assert contributor.denied_code == "http_403"
    assert await _authorship(db, course, bob) is None


async def test_in_app_agent_proposes_contributor_changes(registry, db, org, admin_user, course, alice):
    out = await call(registry, ctx_for(db, org, admin_user, mode="confirm"), "manage_course_contributors", {
        "course_uuid": course.course_uuid, "add": ["alice"], "role": "maintainer",
    })
    assert out.status == "proposed"
    assert "add alice as active maintainer" in out.proposal.summary
    assert await _authorship(db, course, alice) is None
    # Reading never waits for confirmation.
    read = await call(registry, ctx_for(db, org, admin_user, mode="confirm"), "get_course_admin", {
        "course_uuid": course.course_uuid,
    })
    assert read.status == "executed"
