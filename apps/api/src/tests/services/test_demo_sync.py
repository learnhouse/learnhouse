"""The demo sync must be idempotent, and must undo what visitors change.

The idempotence test is the load-bearing one. The whole design rests on the
claim that an hourly refresh is nearly free — if that regresses, the demo
quietly starts rewriting thousands of rows every hour, and nothing else in the
suite would notice.
"""

from datetime import date

import pytest
from sqlalchemy import event, func, select

from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from src.db.demo_entities import DemoEntity, DemoEntityKind
from src.db.demo_state import DEMO_STATE_ID, DemoState, DemoStateEnum
from src.db.organizations import Organization
from src.db.trail_steps import TrailStep
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.services.demo import flags
from src.services.demo.sync import sync_demo

EPOCH_DAY = date(2026, 8, 9)


@pytest.fixture
def no_uploads(monkeypatch):
    """Skip real file writes.

    The upload path is exercised against a real database in the CLI run; here
    it would scatter files through content/ on every test.
    """
    from src.services.demo import sync as sync_module

    async def _fake_upload(**kwargs):
        # Must return the same name the real helper would: the sync compares
        # the stored filename against the derived one to decide whether a
        # visitor replaced an image, so a double that invents its own name
        # makes every refresh look like tampering.
        return sync_module._upload_name(
            uuid=kwargs["uuid"],
            directory=kwargs["directory"],
            name=kwargs["name"],
            version=kwargs.get("version", ""),
        )

    monkeypatch.setattr(sync_module, "_upload", _fake_upload)


@pytest.fixture
async def synced(db, no_uploads):
    """A demo organization built once, ready to be refreshed."""
    stats = await sync_demo(db, today=EPOCH_DAY)
    return stats


class _WriteCounter:
    """Counts INSERT/UPDATE/DELETE statements issued on a session."""

    def __init__(self, session):
        self.session = session
        self.statements: list[str] = []

    def __enter__(self):
        engine = self.session.get_bind()
        self._engine = getattr(engine, "sync_engine", engine)
        event.listen(self._engine, "before_cursor_execute", self._on_execute)
        return self

    def __exit__(self, *exc):
        event.remove(self._engine, "before_cursor_execute", self._on_execute)

    def _on_execute(self, conn, cursor, statement, params, context, executemany):
        head = statement.lstrip().split(" ", 1)[0].upper()
        if head in ("INSERT", "UPDATE", "DELETE"):
            self.statements.append(statement.strip().split("\n")[0])

    def touching_tables_other_than(self, allowed: set[str]) -> list[str]:
        out = []
        for statement in self.statements:
            lowered = statement.lower()
            if not any(table in lowered for table in allowed):
                out.append(statement)
        return out


# ---------------------------------------------------------------------------
# provisioning
# ---------------------------------------------------------------------------

async def test_sync_builds_the_demo_organization(db, synced):
    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()

    assert org is not None
    assert org.slug == flags.demo_slug()
    assert org.explore is False
    assert synced.provisioned is True
    assert synced.created > 0


async def test_students_are_created_and_cannot_log_in(db, synced):
    students = (
        await db.execute(
            select(User).where(User.signup_method == flags.DEMO_SIGNUP_METHOD)
        )
    ).scalars().all()

    assert len(students) == 40
    for student in students:
        # example.com is RFC 2606 reserved and has no MX record, so this is
        # undeliverable — and unlike ".invalid" it survives EmailStr validation,
        # which every endpoint returning a user depends on.
        assert student.email.endswith("@demo.example.com")
        # A valid Argon2 hash of a discarded secret. Empty would make a login
        # attempt a 500 rather than a 401 — pwdlib raises on a hash it cannot
        # identify, and authenticate_user does not guard that call.
        assert student.password.startswith("$argon2")


async def test_student_records_survive_api_serialisation(db, synced):
    """Every endpoint that returns a user validates it through UserRead.

    Regression guard for a real outage: the students were originally given
    `@demo.invalid` addresses — undeliverable by RFC 2606, and exactly what you
    would reach for. But email-validator, behind pydantic's EmailStr, rejects
    `.invalid` as a special-use name, so the members list, the course learner
    lists and the grading inbox all answered 500 for the demo organization.
    Undeliverable is necessary; being a *valid* address is equally necessary.
    """
    from src.db.users import UserRead

    students = (
        await db.execute(
            select(User).where(User.signup_method == flags.DEMO_SIGNUP_METHOD)
        )
    ).scalars().all()

    for student in students:
        UserRead.model_validate(student.model_dump())


async def test_students_cannot_authenticate(db, synced):
    """The failure mode must be a clean rejection, not a server error."""
    from src.security.security import security_verify_password

    student = (
        await db.execute(
            select(User).where(User.signup_method == flags.DEMO_SIGNUP_METHOD).limit(1)
        )
    ).scalars().first()

    assert security_verify_password("password", student.password) is False
    assert security_verify_password("", student.password) is False


async def test_content_is_created_from_the_bundle(db, synced):
    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()

    courses = (
        await db.execute(select(func.count()).select_from(Course).where(Course.org_id == org.id))
    ).scalar_one()
    activities = (
        await db.execute(
            select(func.count()).select_from(Activity).where(Activity.org_id == org.id)
        )
    ).scalar_one()

    assert courses == 6
    assert activities == 54


async def test_everything_created_is_registered(db, synced):
    """Anything unregistered would be deleted as drift on the next refresh."""
    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()

    registered_courses = (
        await db.execute(
            select(DemoEntity.entity_uuid).where(
                DemoEntity.kind == DemoEntityKind.COURSE
            )
        )
    ).scalars().all()
    actual_courses = (
        await db.execute(select(Course.course_uuid).where(Course.org_id == org.id))
    ).scalars().all()

    assert set(actual_courses) == set(registered_courses)


async def test_progress_is_seeded(db, synced):
    steps = (await db.execute(select(func.count()).select_from(TrailStep))).scalar_one()
    assert steps > 100


async def test_demo_runs_on_pro_with_everything_unlocked(db, synced):
    """The demo exists to show the product, so nothing may be hidden.

    A feature a prospect cannot see is a feature they will not buy. This is
    only safe because the demo is excluded from every money path — see
    test_demo_exclusions.py, in particular the free-org cap test.
    """
    from src.db.organization_config import OrganizationConfig

    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()
    config = (
        await db.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        )
    ).scalars().first()

    assert config.config["plan"] == "pro"
    # The tiers pro itself withholds, and that the demo can safely serve.
    # audit_logs, scorm and sso are excluded on purpose — see
    # test_the_demo_does_not_unlock_what_it_cannot_clean_up.
    for enterprise_only in ("analytics_advanced", "custom_domains"):
        assert config.config["overrides"][enterprise_only]["force_enabled"] is True


async def test_every_showcase_feature_resolves_as_available(db, synced):
    """Resolve each feature the way the application does, not by reading config.

    Asserting on the config only proves what was written; this proves the demo
    org actually reports the features as usable, which is what the dashboard
    and the plan gates consult.
    """
    from src.db.organization_config import OrganizationConfig
    from src.security.features_utils.resolve import resolve_feature

    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()
    config = (
        await db.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        )
    ).scalars().first()

    # Everything the demo must show on any deployment.
    showcase = [
        "boards", "playgrounds", "communities", "podcasts", "collaboration",
        "certifications", "roles", "versioning", "webhooks", "usergroups",
        "seo", "analytics", "api",
    ]

    unavailable = [
        feature
        for feature in showcase
        if not resolve_feature(feature, config.config, org.id).get("available")
    ]
    assert not unavailable, f"hidden from the demo: {unavailable}"


async def test_the_demo_does_not_unlock_what_it_cannot_clean_up(db, synced):
    """Three Enterprise surfaces are deliberately left off.

    audit_logs, scorm and sso are served by Enterprise routers that know
    nothing about the demo: no is_demo guard, and none of their tables in the
    drift sweep. Every visitor is an admin of this shared org, so turning them
    on would publish surfaces nothing reverts — and the audit one would hand
    back exactly the visitor identities the audit router was taught to hide.

    A prospect losing three settings pages is the cheaper loss, and this test
    is what stops somebody restoring them for completeness.
    """
    from src.db.organization_config import OrganizationConfig

    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()
    config = (
        await db.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        )
    ).scalars().first()

    overrides = config.config["overrides"]
    for feature in ("audit_logs", "scorm", "sso"):
        assert feature not in overrides, (
            f"{feature} is force-enabled but nothing sweeps what it creates"
        )


async def test_payments_is_only_unlocked_where_the_storefront_can_be_swept(db, synced):
    """The feature follows the build's capability, not a hardcoded True.

    Regression test for a hole opened while fixing another: the storefront
    seeding and its drift sweep were both switched off on an Enterprise build
    too old to support them, while the payments feature stayed force-enabled.
    That combination is worse than no storefront — a visitor-admin could point
    the demo's payments config at their own account and publish an offer, and
    nothing would ever take it down.
    """
    from src.db.organization_config import OrganizationConfig
    from src.services.demo.sync import _store_unsupported_reason

    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()
    config = (
        await db.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        )
    ).scalars().first()

    unlocked = config.config["overrides"]["payments"]["force_enabled"]
    assert unlocked is (_store_unsupported_reason() is None)

    # The suite pins oss mode, where there is no storefront to sweep.
    assert unlocked is False


async def test_enterprise_only_features_follow_the_deployment_not_the_config(db, synced):
    """Deployment mode has the last word, whatever the config asks for.

    The suite pins OSS (conftest sets LEARNHOUSE_DISABLE_EE), so this documents
    where the ceiling actually is: an Enterprise-only feature stays unavailable
    on a self-hosted OSS install however the demo is configured.
    """
    from src.core.deployment_mode import EE_ONLY_FEATURES
    from src.db.organization_config import OrganizationConfig
    from src.security.features_utils.resolve import resolve_feature

    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()
    config = (
        await db.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        )
    ).scalars().first()

    for feature in EE_ONLY_FEATURES:
        resolved = resolve_feature(feature, config.config, org.id)
        assert resolved["available"] is False


async def test_no_usage_events_are_written(db, synced):
    """UsageEvent is the billing ledger. The demo must never appear in it."""
    from src.db.billing_usage import UsageEvent

    rows = (await db.execute(select(func.count()).select_from(UsageEvent))).scalar_one()
    assert rows == 0


# ---------------------------------------------------------------------------
# idempotence — the property the design rests on
# ---------------------------------------------------------------------------

async def test_second_sync_writes_nothing_but_its_own_state_row(db, synced):
    """A settled demo must cost nothing to refresh.

    Asserted on emitted SQL rather than on the sync's own counters, because the
    counters are exactly what would be wrong if this regressed.
    """
    with _WriteCounter(db) as counter:
        stats = await sync_demo(db, today=EPOCH_DAY)

    assert stats.created == 0
    assert stats.updated == 0
    assert stats.drift_deleted == 0

    # demo_state records when the refresh ran, so one UPDATE there is expected
    # and is the only write allowed.
    unexpected = counter.touching_tables_other_than({"demo_state"})
    assert not unexpected, f"refresh wrote to content tables: {unexpected}"


async def test_third_sync_is_also_a_no_op(db, synced):
    await sync_demo(db, today=EPOCH_DAY)
    stats = await sync_demo(db, today=EPOCH_DAY)
    assert (stats.created, stats.updated, stats.drift_deleted) == (0, 0, 0)


# ---------------------------------------------------------------------------
# editing the bundle
# ---------------------------------------------------------------------------

async def test_a_course_removed_from_the_bundle_is_removed_from_the_demo(
    db, synced, monkeypatch
):
    """Deleting content from the bundle has to actually delete it.

    A registry entry is what marks a row as bundle-owned and so shields it from
    drift deletion. If the entry outlives its bundle entry, nothing recreates
    the course and nothing removes it either — it sits in the demo forever,
    unmanaged.
    """
    from src.services.demo import sync as sync_module
    from src.services.demo.bundle_loader import get_bundle

    full = get_bundle()
    dropped = full.courses[0].slug

    trimmed = full.model_copy(
        update={
            "courses": [c for c in full.courses if c.slug != dropped],
            "manifest": full.manifest.model_copy(
                update={"courses": [k for k in full.manifest.courses if k != dropped]}
            ),
            "assignments": {
                k: v for k, v in full.assignments.items() if k != dropped
            },
        }
    )
    monkeypatch.setattr(sync_module, "get_bundle", lambda: trimmed)

    stats = await sync_demo(db, today=EPOCH_DAY)

    entry = (
        await db.execute(
            select(DemoEntity).where(
                DemoEntity.kind == DemoEntityKind.COURSE,
                DemoEntity.bundle_key == dropped,
            )
        )
    ).scalars().first()
    assert entry is None, "the registry still claims a course the bundle dropped"

    course_names = {
        c.name for c in (await db.execute(select(Course))).scalars().all()
    }
    assert full.courses[0].name not in course_names
    assert stats.drift_deleted >= 1


async def test_dropping_the_bundle_does_not_sweep_a_skipped_phase(db, synced):
    """Kinds this run never claimed are left alone.

    Several phases are conditional — the storefront needs the Enterprise
    Edition. A phase that was skipped rather than emptied must not have its
    registry entries pruned, or the rows it created would survive with nothing
    tracking them.
    """
    from src.services.demo.registry import Registry

    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()

    registry = await Registry.load(org.id, db)
    before = len(registry._by_identity)

    # A run that claimed nothing at all: nothing may be pruned.
    forgotten = await registry.prune_removed_from_bundle(db)

    assert forgotten == 0
    assert len(registry._by_identity) == before


# ---------------------------------------------------------------------------
# putting things back
# ---------------------------------------------------------------------------

async def test_visitor_edits_are_reverted_without_changing_identity(db, synced):
    """A renamed course goes back, and keeps its primary key and uuid.

    Keeping the uuid is what lets the thumbnail stay put in storage.
    """
    course = (await db.execute(select(Course).limit(1))).scalars().first()
    original_name, original_id, original_uuid = (
        course.name,
        course.id,
        course.course_uuid,
    )

    course.name = "Vandalised by a visitor"
    course.published = False
    db.add(course)
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)
    await db.refresh(course)

    assert course.name == original_name
    assert course.published is True
    assert course.id == original_id
    assert course.course_uuid == original_uuid


async def test_visitor_created_content_is_deleted_as_drift(db, synced):
    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()

    db.add(
        Course(
            name="A course a visitor made",
            description="",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_visitor_made",
            creation_date="2026-08-09",
            update_date="2026-08-09",
        )
    )
    await db.commit()

    stats = await sync_demo(db, today=EPOCH_DAY)

    survivor = (
        await db.execute(
            select(Course).where(Course.course_uuid == "course_visitor_made")
        )
    ).scalars().first()
    assert survivor is None
    assert stats.drift_deleted >= 1


async def test_visitor_comments_on_seeded_discussions_are_removed(db, synced):
    """A comment on a bundle discussion is drift too.

    Its discussion is bundle-owned and survives the refresh, so unlike a
    visitor's own discussion there is nothing for the comment to disappear
    with. Whatever the last prospect typed would otherwise greet the next one.
    """
    from src.db.communities.discussion_comments import DiscussionComment
    from src.db.communities.discussions import Discussion

    discussion = (await db.execute(select(Discussion).limit(1))).scalars().first()
    assert discussion is not None, "the bundle seeds discussions"

    student = (
        await db.execute(select(User).where(User.signup_method == "demo").limit(1))
    ).scalars().first()

    db.add(
        DiscussionComment(
            discussion_id=discussion.id,
            author_id=student.id,
            content="something a visitor typed",
            comment_uuid="discussioncomment_visitor",
            creation_date="2026-08-09",
            update_date="2026-08-09",
        )
    )
    await db.commit()

    stats = await sync_demo(db, today=EPOCH_DAY)

    survivor = (
        await db.execute(
            select(DiscussionComment).where(
                DiscussionComment.comment_uuid == "discussioncomment_visitor"
            )
        )
    ).scalars().first()
    assert survivor is None
    assert stats.drift_deleted >= 1

    # The seeded comments must still be there — this sweep is not a purge.
    remaining = (await db.execute(select(DiscussionComment))).scalars().all()
    assert remaining, "the bundle's own comments were deleted too"


async def test_a_second_certification_added_to_a_course_is_removed(db, synced):
    """The sync finds its own certification by registry entry, never by course.

    So a second one added through the UI is invisible to it, and the course
    would go on offering two certificates indefinitely.
    """
    from src.db.courses.certifications import Certifications

    course = (await db.execute(select(Course).limit(1))).scalars().first()

    db.add(
        Certifications(
            certification_uuid="certification_visitor",
            course_id=course.id,
            config={"certification_name": "A certificate a visitor added"},
            creation_date="2026-08-09",
            update_date="2026-08-09",
        )
    )
    await db.commit()

    stats = await sync_demo(db, today=EPOCH_DAY)

    survivor = (
        await db.execute(
            select(Certifications).where(
                Certifications.certification_uuid == "certification_visitor"
            )
        )
    ).scalars().first()
    assert survivor is None
    assert stats.drift_deleted >= 1

    # The bundle's own certifications must survive.
    remaining = (await db.execute(select(Certifications))).scalars().all()
    assert remaining, "the seeded certifications were swept too"


async def test_a_replaced_org_logo_is_put_back(db, synced):
    """Branding is the first thing a prospect sees, and it was permanent.

    Every media write used to be guarded on the column being empty, so a logo
    a visitor uploaded through org settings — which leaves the column full —
    was never reverted.
    """
    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()
    bundle_logo = org.logo_image

    org.logo_image = "whatever_the_visitor_uploaded.webp"
    db.add(org)
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)
    await db.refresh(org)

    assert org.logo_image == bundle_logo


async def test_a_replaced_course_thumbnail_is_put_back(db, synced):
    course = (await db.execute(select(Course).limit(1))).scalars().first()
    bundle_thumbnail = course.thumbnail_image

    course.thumbnail_image = "visitor_thumbnail.webp"
    db.add(course)
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)
    await db.refresh(course)

    assert course.thumbnail_image == bundle_thumbnail


async def test_new_bundle_artwork_reaches_an_existing_demo(db, synced, monkeypatch):
    """Bumping bundle_version has to move every media reference.

    Derived filenames are what make a replaced image detectable, but they also
    mean redrawn artwork shipped under the same bundle filename computes to the
    same name — so without the version in the key it would match, and the demo
    would keep showing the old picture forever.
    """
    from src.services.demo import sync as sync_module
    from src.services.demo.bundle_loader import get_bundle

    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()
    before = org.logo_image

    full = get_bundle()
    bumped = full.model_copy(
        update={"manifest": full.manifest.model_copy(update={"bundle_version": "9.9.9"})}
    )
    monkeypatch.setattr(sync_module, "get_bundle", lambda: bumped)

    await sync_demo(db, today=EPOCH_DAY)
    await db.refresh(org)

    assert org.logo_image != before


async def test_visitor_progress_is_removed_but_seeded_progress_is_kept(db, synced):
    """A prospect's own trail must not greet the next prospect.

    Everyone in the demo is an admin, so one visitor's course history was
    readable by the next under their real name — in the learners table, the
    grading inbox and the certificate list.
    """
    from datetime import datetime

    from src.db.trail_runs import TrailRun
    from src.db.trails import Trail

    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()
    course = (await db.execute(select(Course).limit(1))).scalars().first()

    visitor = User(
        id=777,
        username="prospect",
        first_name="Pro",
        last_name="Spect",
        email="prospect@example.com",
        password="hashed",
        user_uuid="user_prospect",
        signup_method="email",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(visitor)
    await db.flush()

    trail = Trail(
        user_id=visitor.id, org_id=org.id, trail_uuid="trail_visitor",
        creation_date="2026-08-09", update_date="2026-08-09",
    )
    db.add(trail)
    await db.flush()
    db.add(
        TrailRun(
            trail_id=trail.id, user_id=visitor.id, org_id=org.id,
            course_id=course.id, trailrun_uuid="trailrun_visitor",
            creation_date="2026-08-09", update_date="2026-08-09",
        )
    )
    await db.commit()

    seeded_before = (
        await db.execute(select(func.count()).select_from(TrailRun))
    ).scalar_one()

    await sync_demo(db, today=EPOCH_DAY)

    left = (
        await db.execute(select(TrailRun).where(TrailRun.user_id == visitor.id))
    ).scalars().all()
    assert left == []

    seeded_after = (
        await db.execute(select(func.count()).select_from(TrailRun))
    ).scalar_one()
    assert seeded_after == seeded_before - 1, "the seeded learners lost progress too"


async def test_deleted_content_is_restored_with_its_original_uuid(db, synced):
    """The case that makes stable identities worth having.

    A restored course keeps its uuid, so the thumbnail already in storage still
    resolves and does not need re-uploading.
    """
    course = (await db.execute(select(Course).limit(1))).scalars().first()
    original_uuid = course.course_uuid
    original_name = course.name

    await db.delete(course)
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)

    restored = (
        await db.execute(select(Course).where(Course.course_uuid == original_uuid))
    ).scalars().first()
    assert restored is not None
    assert restored.name == original_name


async def test_api_tokens_and_webhooks_created_by_visitors_are_removed(db, synced):
    """A visitor is an admin here, so they can mint credentials.

    Every visitor joins the shared demo with the admin role, which lets them
    create an API token scoped to the organization or point a webhook at a
    server they control. The bundle owns neither, so both are drift — and
    without that, a token minted once would survive every refresh and keep
    working indefinitely against a public sandbox.
    """
    from src.db.api_tokens import APIToken
    from src.db.webhooks import WebhookEndpoint

    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()

    db.add(
        APIToken(
            token_uuid="apitoken_visitor_made",
            org_id=org.id,
            name="Left behind by a visitor",
            token_hash="x" * 64,
            created_by_user_id=1,
            creation_date="2026-08-09",
            update_date="2026-08-09",
        )
    )
    db.add(
        WebhookEndpoint(
            webhook_uuid="webhook_visitor_made",
            org_id=org.id,
            name="Points at somewhere else",
            url="https://example.invalid/collect",
            created_by_user_id=1,
            creation_date="2026-08-09",
            update_date="2026-08-09",
        )
    )
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)

    token = (
        await db.execute(
            select(APIToken).where(APIToken.token_uuid == "apitoken_visitor_made")
        )
    ).scalars().first()
    hook = (
        await db.execute(
            select(WebhookEndpoint).where(
                WebhookEndpoint.webhook_uuid == "webhook_visitor_made"
            )
        )
    ).scalars().first()

    assert token is None, "a visitor's API token survived the refresh"
    assert hook is None, "a visitor's webhook survived the refresh"


async def test_visitor_membership_survives_a_refresh(db, synced):
    """Visitors are not drift. Their content is; their account is not."""
    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()

    visitor = User(
        username="real_visitor",
        first_name="Real",
        last_name="Visitor",
        email="visitor@example.com",
        password="$argon2id$v=19$m=65536,t=3,p=4$fake",
        user_uuid="user_real_visitor",
        signup_method="password",
        creation_date="2026-08-09",
        update_date="2026-08-09",
    )
    db.add(visitor)
    await db.flush()
    db.add(
        UserOrganization(
            user_id=visitor.id,
            org_id=org.id,
            role_id=1,
            creation_date="2026-08-09",
            update_date="2026-08-09",
        )
    )
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)

    still_there = (
        await db.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == visitor.id,
                UserOrganization.org_id == org.id,
            )
        )
    ).scalars().first()
    assert still_there is not None
    assert still_there.role_id == 1


async def test_completed_step_added_by_a_visitor_is_removed(db, synced):
    """Progress is reconciled to the target, not merely topped up."""
    before = (await db.execute(select(func.count()).select_from(TrailStep))).scalar_one()

    step = (await db.execute(select(TrailStep).limit(1))).scalars().first()
    db.add(
        TrailStep(
            complete=True,
            teacher_verified=False,
            grade="",
            trailrun_id=step.trailrun_id,
            trail_id=step.trail_id,
            # An activity the learner has not reached.
            activity_id=step.activity_id + 10_000,
            course_id=step.course_id,
            org_id=step.org_id,
            user_id=step.user_id,
            creation_date="2026-08-09",
            update_date="2026-08-09",
        )
    )
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)

    after = (await db.execute(select(func.count()).select_from(TrailStep))).scalar_one()
    assert after == before


# ---------------------------------------------------------------------------
# state
# ---------------------------------------------------------------------------

async def test_rolling_the_epoch_reconciles_progress(db, no_uploads):
    """The demo must be a function of (bundle, epoch), not of how long it ran.

    The daily epoch roll re-draws every persona, so learners change which
    courses they are enrolled in. Progress for a dropped course used to be left
    behind, and because it only ever accumulated, within a fortnight all forty
    learners appeared enrolled in the whole catalogue with frozen progress bars
    and certificates their plan says they never earned — the persona design
    erasing itself.

    Building at a late epoch directly, versus rolling day by day to the same
    epoch, must produce identical counts.
    """
    from src.db.courses.assignments import AssignmentUserSubmission
    from src.db.courses.certifications import CertificateUser
    from src.db.trail_runs import TrailRun

    async def counts(session):
        out = {}
        for model in (TrailRun, TrailStep, AssignmentUserSubmission, CertificateUser):
            out[model.__name__] = (
                await session.execute(select(func.count()).select_from(model))
            ).scalar_one()
        return out

    # Roll day by day.
    reconciled = 0
    for day in range(9, 16):
        stats = await sync_demo(db, today=date(2026, 8, day))
        reconciled += stats.drift_deleted
    rolled = await counts(db)

    # The reconcile must actually have run. Without this the assertions below
    # could pass on a build that never rolled at all.
    assert reconciled > 0, (
        "rolling the epoch removed nothing — progress for dropped courses is "
        "not being reconciled"
    )

    # Every trail run must correspond to a course in that learner's CURRENT plan.
    from src.services.demo.bundle_loader import get_bundle
    from src.services.demo.progress import plan_students

    plans = {p.bundle_key: p for p in plan_students(get_bundle(), "2026-08-15")}
    students = (
        await db.execute(
            select(User).where(User.signup_method == flags.DEMO_SIGNUP_METHOD)
        )
    ).scalars().all()
    by_id = {s.id: s for s in students}

    course_key_by_id = {}
    for entry in (
        await db.execute(
            select(DemoEntity).where(DemoEntity.kind == DemoEntityKind.COURSE)
        )
    ).scalars().all():
        course_key_by_id[entry.entity_id] = entry.bundle_key

    runs = (await db.execute(select(TrailRun))).scalars().all()
    orphans = []
    for run in runs:
        student = by_id.get(run.user_id)
        if student is None:
            continue
        index = int(student.email.split("@")[0].split("-")[1])
        plan = plans.get(f"student-{index:02d}")
        course_key = course_key_by_id.get(run.course_id)
        if plan and course_key and course_key not in plan.course_keys:
            orphans.append((student.email, course_key))

    assert not orphans, (
        f"{len(orphans)} trail run(s) survive for courses the learner's current "
        f"plan does not include, e.g. {orphans[:3]}"
    )
    assert rolled["TrailRun"] < 240, (
        "trail runs have saturated at 40 students x 6 courses — every learner "
        "now appears enrolled in the entire catalogue"
    )


async def test_state_row_records_the_result(db, synced):
    state = (
        await db.execute(select(DemoState).where(DemoState.id == DEMO_STATE_ID))
    ).scalars().first()

    assert state.state == DemoStateEnum.READY
    assert state.bundle_version
    assert state.content_epoch == EPOCH_DAY.isoformat()
    assert state.last_error is None


async def test_epoch_rolls_forward_daily_not_hourly(db, synced):
    """Timestamps are anchored to the epoch so hourly refreshes are no-ops."""
    state = (
        await db.execute(select(DemoState).where(DemoState.id == DEMO_STATE_ID))
    ).scalars().first()
    assert state.content_epoch == EPOCH_DAY.isoformat()

    # Same day, later hour: the epoch must not move.
    await sync_demo(db, today=EPOCH_DAY)
    await db.refresh(state)
    assert state.content_epoch == EPOCH_DAY.isoformat()

    # Next day: it rolls, and the timeline shifts with it.
    await sync_demo(db, today=date(2026, 8, 10))
    await db.refresh(state)
    assert state.content_epoch == "2026-08-10"


async def test_refusing_to_take_over_a_real_organization(db, no_uploads):
    """The demo slug may already belong to someone. Never convert it."""
    db.add(
        Organization(
            name="Somebody's real school",
            slug=flags.demo_slug(),
            email="real@example.com",
            org_uuid="org_real",
            is_demo=False,
            creation_date="2026-08-09",
            update_date="2026-08-09",
        )
    )
    await db.commit()

    with pytest.raises(RuntimeError, match="not a demo org"):
        await sync_demo(db, today=EPOCH_DAY)


# ---------------------------------------------------------------------------
# a visitor edits it; the refresh puts it back
#
# Each entity reverts through its own branch, so they are listed rather than
# sampled. `field` is set to `value`, the sync runs, and the original must
# return — with the row's identity intact, since the whole design rests on
# keeping primary keys and uuids stable.
# ---------------------------------------------------------------------------

_TAMPERINGS = [
    ("chapter", "src.db.courses.chapters", "Chapter", "name", "Renamed chapter"),
    ("activity", "src.db.courses.activities", "Activity", "name", "Renamed activity"),
    ("activity_published", "src.db.courses.activities", "Activity", "published", False),
    ("assignment", "src.db.courses.assignments", "Assignment", "title", "Renamed assignment"),
    ("assignment_task", "src.db.courses.assignments", "AssignmentTask", "title", "Renamed task"),
    ("usergroup", "src.db.usergroups", "UserGroup", "name", "Renamed cohort"),
    ("folder", "src.db.folders.folders", "Folder", "name", "Renamed section"),
    ("course_update", "src.db.courses.course_updates", "CourseUpdate", "title", "Renamed update"),
    ("board", "src.db.boards", "Board", "name", "Renamed board"),
    ("playground", "src.db.playgrounds", "Playground", "name", "Renamed playground"),
    ("community", "src.db.communities.communities", "Community", "name", "Renamed community"),
    ("discussion", "src.db.communities.discussions", "Discussion", "title", "Renamed discussion"),
    ("discussion_locked", "src.db.communities.discussions", "Discussion", "is_locked", True),
    ("podcast", "src.db.podcasts.podcasts", "Podcast", "name", "Renamed podcast"),
    ("episode", "src.db.podcasts.episodes", "PodcastEpisode", "title", "Renamed episode"),
    ("certification", "src.db.courses.certifications", "Certifications", "config", {"certification_name": "Tampered"}),
]


@pytest.mark.parametrize(
    "label,module,model_name,field,tampered",
    _TAMPERINGS,
    ids=[t[0] for t in _TAMPERINGS],
)
async def test_a_visitor_edit_is_reverted(
    db, synced, label, module, model_name, field, tampered
):
    import importlib

    model = getattr(importlib.import_module(module), model_name)

    row = (await db.execute(select(model).limit(1))).scalars().first()
    assert row is not None, f"the bundle seeds no {model_name}"

    original_id = row.id
    original = getattr(row, field)
    assert original != tampered, "the tampered value must differ from the bundle's"

    setattr(row, field, tampered)
    db.add(row)
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)

    restored = (await db.execute(select(model).where(model.id == original_id))).scalars().first()
    assert restored is not None, "the row was deleted rather than reverted"
    assert getattr(restored, field) == original
    assert restored.id == original_id, "reverting must not change the row's identity"


async def test_a_visitor_cannot_keep_an_extra_author_on_a_bundle_course(db, synced):
    """Adding a contributor is an ordinary admin action, and everyone is admin.

    The contributor endpoint resolves usernames globally with no org scoping,
    so without this any username on the platform could be left on a demo
    course's byline.
    """
    from src.db.resource_authors import (
        ResourceAuthor,
        ResourceAuthorshipEnum,
        ResourceAuthorshipStatusEnum,
    )

    course = (await db.execute(select(Course).limit(1))).scalars().first()
    visitor = (
        await db.execute(select(User).where(User.signup_method != "demo").limit(1))
    ).scalars().first()
    if visitor is None:
        from datetime import datetime as _dt

        visitor = User(
            id=606, username="claimant", first_name="Clai", last_name="Mant",
            email="claimant@example.com", password="hashed",
            user_uuid="user_claimant", signup_method="email",
            creation_date=str(_dt.now()), update_date=str(_dt.now()),
        )
        db.add(visitor)
        await db.flush()

    db.add(
        ResourceAuthor(
            resource_uuid=course.course_uuid,
            user_id=visitor.id,
            authorship=ResourceAuthorshipEnum.CREATOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
            creation_date="2026-08-09",
            update_date="2026-08-09",
        )
    )
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)

    remaining = (
        await db.execute(
            select(ResourceAuthor).where(
                ResourceAuthor.resource_uuid == course.course_uuid,
                ResourceAuthor.user_id == visitor.id,
            )
        )
    ).scalars().all()
    assert remaining == []


async def test_custom_scripts_and_previews_are_cleared(db, synced):
    """Stored XSS, and the org's public landing imagery.

    OrgScripts injects every entry as a real script element for every visitor
    to the org, and every visitor here is an admin.
    """
    org = (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()

    org.scripts = {"scripts": [{"name": "pwn", "content": "alert(1)"}]}
    org.previews = {"images": ["something-a-visitor-uploaded.webp"]}
    db.add(org)
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)
    await db.refresh(org)

    assert org.scripts == {}
    assert org.previews == {}


# Chapter is absent on purpose. Deleting one in Postgres cascades to its
# activities and, through them, to the trail steps recorded against them. This
# suite runs on SQLite, which does not enforce foreign keys, so the delete
# leaves orphaned progress behind and the restore then collides with it — a
# state the production schema cannot reach. test_demo_teardown.py asserts those
# cascades directly on the schema instead.
_RESTORABLE = [
    ("activity", "src.db.courses.activities", "Activity", "activity_uuid"),
    ("assignment", "src.db.courses.assignments", "Assignment", "assignment_uuid"),
    ("assignment_task", "src.db.courses.assignments", "AssignmentTask", "assignment_task_uuid"),
    ("usergroup", "src.db.usergroups", "UserGroup", "usergroup_uuid"),
    ("folder", "src.db.folders.folders", "Folder", "folder_uuid"),
    ("course_update", "src.db.courses.course_updates", "CourseUpdate", "courseupdate_uuid"),
    ("board", "src.db.boards", "Board", "board_uuid"),
    ("playground", "src.db.playgrounds", "Playground", "playground_uuid"),
    ("community", "src.db.communities.communities", "Community", "community_uuid"),
    ("discussion", "src.db.communities.discussions", "Discussion", "discussion_uuid"),
    ("podcast", "src.db.podcasts.podcasts", "Podcast", "podcast_uuid"),
    ("episode", "src.db.podcasts.episodes", "PodcastEpisode", "episode_uuid"),
    ("certification", "src.db.courses.certifications", "Certifications", "certification_uuid"),
]


@pytest.mark.parametrize(
    "label,module,model_name,uuid_field",
    _RESTORABLE,
    ids=[r[0] for r in _RESTORABLE],
)
async def test_a_deleted_entity_is_restored_with_its_uuid(
    db, synced, label, module, model_name, uuid_field
):
    import importlib

    model = getattr(importlib.import_module(module), model_name)

    row = (await db.execute(select(model).limit(1))).scalars().first()
    assert row is not None, f"the bundle seeds no {model_name}"
    original_uuid = getattr(row, uuid_field)

    await db.delete(row)
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)

    restored = (
        await db.execute(
            select(model).where(getattr(model, uuid_field) == original_uuid)
        )
    ).scalars().first()
    assert restored is not None, f"{model_name} was not restored"
    assert getattr(restored, uuid_field) == original_uuid


async def test_restoring_does_not_duplicate_anything(db, synced):
    """The registry entry has to follow the row to its new primary key.

    If it did not, the next refresh would treat the restored row as drift and
    delete it, then create another — a demo that churns instead of settling.
    """
    from src.db.boards import Board

    before = (await db.execute(select(func.count()).select_from(Board))).scalar_one()

    board = (await db.execute(select(Board).limit(1))).scalars().first()
    await db.delete(board)
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)
    stats = await sync_demo(db, today=EPOCH_DAY)

    after = (await db.execute(select(func.count()).select_from(Board))).scalar_one()
    assert after == before
    assert (stats.created, stats.updated, stats.drift_deleted) == (0, 0, 0), (
        "the demo did not settle after a restore"
    )
