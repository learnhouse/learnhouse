"""Edge branches of the demo sync, driven through its phase helpers.

test_demo_sync.py and test_demo_drift.py run the whole sync against the real
bundle, which only ever takes the paths that bundle happens to need. The
branches here are the ones a visitor, a bundle edit or an Enterprise build
reaches: rows tampered with between refreshes, bundle entries pointing at
things that are gone, and the storefront. Each phase is called directly with a
tiny hand-written bundle, so none of these pay for a full build.
"""

import enum
import sys
import types
from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, select
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from src.db.boards import Board, BoardMember
from src.db.communities.discussion_comments import DiscussionComment
from src.db.communities.discussions import Discussion
from src.db.courses.activities import Activity, ActivityTypeEnum
from src.db.courses.assignments import Assignment, AssignmentUserSubmission
from src.db.courses.certifications import CertificateUser, Certifications
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.course_updates import CourseUpdate
from src.db.demo_entities import DemoEntity, DemoEntityKind
from src.db.demo_state import DEMO_STATE_ID, DemoState, DemoStateEnum
from src.db.organization_config import OrganizationConfig
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail
from src.db.usergroup_user import UserGroupUser
from src.services.demo import sync as sync_module
from src.services.demo.bundle_loader import (
    ActivitySpec,
    BoardSpec,
    ChapterSpec,
    CohortSpec,
    CommentSpec,
    CommunitySpec,
    CourseSpec,
    DiscussionSpec,
    PersonaSpec,
    StoreEnrollmentSpec,
    StoreGroupSpec,
    StoreOfferSpec,
    StoreSpec,
    get_bundle,
)
from src.services.demo.progress import StudentPlan
from src.services.demo.registry import Registry
from src.services.demo.sync import SyncStats

EPOCH = "2026-08-09"
VERSION = "test-1"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

@pytest.fixture
def no_uploads(monkeypatch):
    """Skip real file writes, returning the name the real helper would."""

    async def _fake_upload(**kwargs):
        return sync_module._upload_name(
            uuid=kwargs["uuid"],
            directory=kwargs["directory"],
            name=kwargs["name"],
            version=kwargs.get("version", ""),
        )

    monkeypatch.setattr(sync_module, "_upload", _fake_upload)


def _stats() -> SyncStats:
    return SyncStats(epoch=EPOCH)


_PERSONA = PersonaSpec(
    id="steady",
    weight=1,
    min_courses=1,
    max_courses=1,
    min_completion=1.0,
    max_completion=1.0,
    assignments="pending",
)


def _plan(index: int, *, cohort="co-one", course_keys=(), completion=None) -> StudentPlan:
    return StudentPlan(
        index=index,
        bundle_key=f"student-{index}",
        first_name=f"First{index}",
        last_name="Learner",
        email=f"student{index}@demo.example.com",
        username=f"demo-student-{index}",
        avatar=None,
        persona=_PERSONA,
        cohort_key=cohort,
        course_keys=list(course_keys),
        completion=dict(completion or {}),
        joined_days_ago=30,
    )


def _course_spec(slug="c-one", *, chapters=None, certification=False) -> CourseSpec:
    return CourseSpec(
        slug=slug,
        name=f"Course {slug}",
        description="A course",
        thumbnail="thumb.webp",
        section="s-one",
        certification=certification,
        chapters=chapters
        if chapters is not None
        else [
            ChapterSpec(
                slug="ch-one",
                name="Chapter one",
                activities=[
                    ActivitySpec(slug="a-doc", name="Doc"),
                    ActivitySpec(slug="a-quiz", name="Quiz", kind="assignment"),
                    ActivitySpec(slug="a-orphan", name="Orphan"),
                ],
            )
        ],
    )


def _bundle(**kwargs) -> SimpleNamespace:
    defaults = dict(
        manifest=SimpleNamespace(bundle_version=VERSION, cohorts=[], sections=[]),
        courses=[],
        assignments={},
        store=StoreSpec(),
        media_path=lambda *parts: "/nonexistent/" + "/".join(parts),
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


async def _students(db, org, registry, plans):
    return await sync_module._sync_students(
        db, None, org, registry, plans, _stats()
    )


async def _mini_course(db, org, registry, spec=None):
    """One course built through the real phase, with uploads stubbed."""
    spec = spec or _course_spec()
    courses = await sync_module._sync_courses(
        db, _bundle(courses=[spec]), org, registry, EPOCH, _stats()
    )
    await db.flush()
    return spec, courses[spec.slug]


def _task(slug: str) -> dict:
    answer = {"submissions": []}
    return {
        "slug": slug,
        "title": f"Task {slug}",
        "type": "QUIZ",
        "contents": {"questions": []},
        "max_grade_value": 50,
        "submissions": {"correct": answer, "partial": answer, "incorrect": answer},
    }


def _sidecar(activity_key: str, tasks=None) -> dict:
    return {
        "activity_key": activity_key,
        "title": "Exercise",
        "description": "Do the thing",
        "tasks": tasks if tasks is not None else [_task("t-one")],
    }


# ---------------------------------------------------------------------------
# failure recording and the org row
# ---------------------------------------------------------------------------

async def test_a_failure_does_not_mark_a_demo_another_run_made_ready(db, caplog):
    """The first-provision race: a READY row now means somebody else won.

    With no state row at the start (started_from None), a READY row after the
    rollback is another replica's success, so the error is recorded but the
    demo is not flipped to FAILED and hidden.
    """
    db.add(
        DemoState(id=DEMO_STATE_ID, state=DemoStateEnum.READY, update_date="earlier")
    )
    await db.commit()

    with caplog.at_level("WARNING", logger=sync_module.logger.name):
        await sync_module._record_sync_failure(
            db, ValueError("boom"), started_from=None
        )

    state = (await db.execute(select(DemoState))).scalars().one()
    assert state.state == DemoStateEnum.READY
    assert state.last_error == "ValueError: boom"
    assert "another run has since succeeded" in caplog.text


async def test_a_tampered_org_config_is_put_back(db):
    """Every visitor is an admin, so the plan config is theirs to change."""
    bundle = get_bundle()
    org, created = await sync_module._sync_org(db, bundle, _stats())
    assert created is True

    config = (
        await db.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        )
    ).scalars().one()
    config.config = {"plan": "free"}
    db.add(config)
    await db.flush()

    stats = _stats()
    _, created = await sync_module._sync_org(db, bundle, stats)

    assert created is False
    assert stats.updated == 1
    assert config.config == sync_module._demo_org_config()


# ---------------------------------------------------------------------------
# students and cohorts
# ---------------------------------------------------------------------------

async def test_a_renamed_student_and_a_planted_avatar_are_reverted(db, org):
    registry = Registry(org.id, [])
    users = await _students(db, org, registry, [_plan(1)])
    user = users["student-1"]

    user.first_name = "Visitor"
    user.avatar_image = "visitor.png"
    db.add(user)
    await db.flush()

    stats = _stats()
    await sync_module._sync_students(db, None, org, registry, [_plan(1)], stats)

    assert user.first_name == "First1"
    # The persona has no picture on purpose, so anything here was planted.
    assert user.avatar_image == ""
    assert stats.updated == 2
    assert stats.created == 0


async def test_a_learner_moved_out_of_a_cohort_leaves_its_group(db, org):
    registry = Registry(org.id, [])
    plans = [_plan(1), _plan(2)]
    users = await _students(db, org, registry, plans)
    bundle = _bundle(
        manifest=SimpleNamespace(
            bundle_version=VERSION,
            cohorts=[CohortSpec(slug="co-one", name="One", share=1.0)],
        )
    )

    await sync_module._sync_cohorts(db, bundle, org, registry, plans, users, _stats())
    await db.flush()

    moved = [_plan(1), _plan(2, cohort="co-two")]
    stats = _stats()
    await sync_module._sync_cohorts(db, bundle, org, registry, moved, users, stats)

    members = (await db.execute(select(UserGroupUser.user_id))).scalars().all()
    assert members == [users["student-1"].id]
    assert stats.updated == 1


# ---------------------------------------------------------------------------
# courses, chapters and activities
# ---------------------------------------------------------------------------

async def test_no_byline_is_written_before_any_student_exists(db, org):
    """The author is a seeded student; with none yet, nobody is attributed."""
    from src.db.resource_authors import ResourceAuthor

    stats = _stats()
    await sync_module._sync_resource_author_for(db, "course_x", org, stats)

    assert (await db.execute(select(ResourceAuthor))).scalars().all() == []
    assert stats.created == 0


async def test_reordered_chapters_and_activities_follow_the_bundle(db, org, course):
    registry = Registry(org.id, [])

    def spec(chapter_order, activity_order):
        chapters = {
            "ch-a": ChapterSpec(
                slug="ch-a",
                name="A",
                activities=[
                    {"x": ActivitySpec(slug="act-x", name="X"),
                     "y": ActivitySpec(slug="act-y", name="Y")}[key]
                    for key in activity_order
                ],
            ),
            "ch-b": ChapterSpec(slug="ch-b", name="B", activities=[]),
        }
        return SimpleNamespace(chapters=[chapters[key] for key in chapter_order])

    await sync_module._sync_chapters(
        db, spec(["ch-a", "ch-b"], ["x", "y"]), course, org, registry, EPOCH, _stats()
    )
    await db.flush()

    stats = _stats()
    await sync_module._sync_chapters(
        db, spec(["ch-b", "ch-a"], ["y", "x"]), course, org, registry, EPOCH, stats
    )
    await db.flush()

    chapter_order = dict(
        (
            await db.execute(
                select(Chapter.name, CourseChapter.order).join(
                    CourseChapter, CourseChapter.chapter_id == Chapter.id
                )
            )
        ).all()
    )
    activity_order = dict(
        (
            await db.execute(
                select(Activity.name, ChapterActivity.order).join(
                    ChapterActivity, ChapterActivity.activity_id == Activity.id
                )
            )
        ).all()
    )
    assert chapter_order == {"A": 1, "B": 0}
    assert activity_order == {"Y": 0, "X": 1}
    assert stats.updated == 4


async def test_a_video_activity_stores_only_its_youtube_id(db, org, course, chapter):
    chapter_spec = SimpleNamespace(
        activities=[
            ActivitySpec(slug="a-vid", name="Video", kind="video", youtube_id="abc123")
        ]
    )

    await sync_module._sync_activities(
        db, chapter_spec, chapter, course, org, Registry(org.id, []), EPOCH, _stats()
    )

    activity = (
        await db.execute(select(Activity).where(Activity.name == "Video"))
    ).scalars().one()
    assert activity.content == {"youtube_id": "abc123"}
    assert activity.activity_type == ActivityTypeEnum.TYPE_VIDEO


# ---------------------------------------------------------------------------
# assignments and submissions
# ---------------------------------------------------------------------------

async def test_assignments_whose_anchors_are_gone_are_skipped(db, org, no_uploads):
    """A sidecar is only seeded when its course, activity and chapter link exist."""
    registry = Registry(org.id, [])
    _, course = await _mini_course(db, org, registry)

    # An activity registered but deleted, and one that lost its chapter link.
    for key in ("c-ghost", "c-orphan"):
        registry.register(
            db, kind=DemoEntityKind.COURSE, bundle_key=key,
            entity_id=course.id, entity_uuid=course.course_uuid, org_id=org.id,
        )
    registry.register(
        db, kind=DemoEntityKind.ACTIVITY, bundle_key="a-ghost",
        entity_id=999_999, entity_uuid="activity_ghost", org_id=org.id,
    )
    orphan = registry.get(DemoEntityKind.ACTIVITY, "a-orphan")
    link = (
        await db.execute(
            select(ChapterActivity).where(ChapterActivity.activity_id == orphan.entity_id)
        )
    ).scalars().one()
    await db.delete(link)
    await db.flush()

    bundle = _bundle(
        assignments={
            "c-one": _sidecar("a-quiz"),
            "c-unregistered": _sidecar("a-doc"),
            "c-ghost": _sidecar("a-ghost"),
            "c-orphan": _sidecar("a-orphan"),
        }
    )
    stats = _stats()
    await sync_module._sync_assignments(db, bundle, org, registry, EPOCH, stats)
    await db.flush()

    assignments = (await db.execute(select(Assignment))).scalars().all()
    assert [a.activity_id for a in assignments] == [
        registry.get(DemoEntityKind.ACTIVITY, "a-quiz").entity_id
    ]
    assert registry.get(DemoEntityKind.ASSIGNMENT, "c-ghost") is None
    assert registry.get(DemoEntityKind.ASSIGNMENT, "c-orphan") is None


async def test_submissions_skip_what_cannot_be_resolved(db, org, no_uploads):
    """Missing assignment, missing task, missing learner: none of them crash."""
    registry = Registry(org.id, [])
    await _mini_course(db, org, registry)
    await sync_module._sync_assignments(
        db, _bundle(assignments={"c-one": _sidecar("a-quiz")}), org, registry,
        EPOCH, _stats(),
    )
    registry.register(
        db, kind=DemoEntityKind.ASSIGNMENT, bundle_key="c-ghost",
        entity_id=999_999, entity_uuid="assignment_ghost", org_id=org.id,
    )
    present, absent = _plan(1, course_keys=["c-one"]), _plan(2, course_keys=["c-one"])
    users = await _students(db, org, registry, [present])
    await db.flush()

    bundle = _bundle(
        assignments={
            "c-none": _sidecar("a-doc"),
            "c-ghost": _sidecar("a-doc"),
            "c-one": _sidecar("a-quiz", tasks=[_task("t-one"), _task("t-missing")]),
        }
    )
    await sync_module._sync_submissions(
        db, bundle, org, registry, EPOCH, [present, absent], users, _stats()
    )
    await db.flush()

    submissions = (await db.execute(select(AssignmentUserSubmission))).scalars().all()
    assert [s.user_id for s in submissions] == [users["student-1"].id]
    assert submissions[0].submission_status == "SUBMITTED"


async def test_certifications_and_updates_skip_courses_that_were_not_built(db, org):
    spec = _course_spec(certification=True)
    spec.updates.append({"title": "News", "content": "Hello"})
    bundle = _bundle(courses=[spec], manifest=SimpleNamespace(org=SimpleNamespace(name="Org")))
    registry = Registry(org.id, [])

    await sync_module._sync_certifications(db, bundle, org, registry, {}, _stats())
    await sync_module._sync_course_updates(db, bundle, org, registry, EPOCH, {}, _stats())
    # No certification registered, so no learner can be issued one.
    users = await _students(db, org, registry, [_plan(1, course_keys=["c-one"])])
    await sync_module._sync_certificates(
        db, bundle, org, registry, EPOCH, [_plan(1, course_keys=["c-one"])],
        users, {"c-one": [1]}, _stats(),
    )
    await db.flush()

    assert (await db.execute(select(Certifications))).scalars().all() == []
    assert (await db.execute(select(CourseUpdate))).scalars().all() == []
    assert (await db.execute(select(CertificateUser))).scalars().all() == []


# ---------------------------------------------------------------------------
# community and boards
# ---------------------------------------------------------------------------

async def test_community_skips_missing_authors_and_restores_edited_comments(db, org):
    registry = Registry(org.id, [])
    users = await _students(db, org, registry, [_plan(1)])
    spec = CommunitySpec(
        slug="cm-one",
        name="Community",
        discussions=[
            DiscussionSpec(
                slug="d-one",
                title="Hello",
                content="First post",
                author="student-1",
                comments=[
                    CommentSpec(author="student-1", content="Reply", upvotes=2),
                    CommentSpec(author="student-gone", content="Lost"),
                ],
            ),
            DiscussionSpec(
                slug="d-two", title="Orphan", content="x", author="student-gone"
            ),
        ],
    )

    await sync_module._sync_community(db, spec, org, registry, EPOCH, users, _stats())
    await db.flush()

    discussions = (await db.execute(select(Discussion))).scalars().all()
    comments = (await db.execute(select(DiscussionComment))).scalars().all()
    assert [d.title for d in discussions] == ["Hello"]
    assert [c.content for c in comments] == ["Reply"]

    comments[0].content = "Visitor graffiti"
    comments[0].upvote_count = 99
    db.add(comments[0])
    await db.flush()

    stats = _stats()
    await sync_module._sync_community(db, spec, org, registry, EPOCH, users, stats)

    assert comments[0].content == "Reply"
    assert comments[0].upvote_count == 2
    assert stats.updated == 1


def test_a_board_without_a_shipped_canvas_has_none():
    assert sync_module._board_canvas("b-no-such-board-anywhere") is None


async def test_a_board_whose_owner_is_missing_is_not_created(db, org):
    spec = BoardSpec(slug="b-one", name="Board", owner="student-gone")

    await sync_module._sync_board(
        db, spec, org, Registry(org.id, []), EPOCH, {}, _stats()
    )

    assert (await db.execute(select(Board))).scalars().all() == []


async def test_a_drawn_on_board_and_its_extra_members_are_reset(db, org, monkeypatch):
    monkeypatch.setattr(sync_module, "_board_canvas", lambda slug: b"bundle-canvas")
    registry = Registry(org.id, [])
    users = await _students(db, org, registry, [_plan(1), _plan(2)])
    spec = BoardSpec(slug="b-one", name="Board", owner="student-1")

    await sync_module._sync_board(db, spec, org, registry, EPOCH, users, _stats())
    await db.flush()

    board = (await db.execute(select(Board))).scalars().one()
    assert board.ydoc_state == b"bundle-canvas"
    board.ydoc_state = b"visitor-scribble"
    db.add(board)
    db.add(BoardMember(board_id=board.id, user_id=users["student-2"].id, role="editor"))
    await db.flush()

    stats = _stats()
    await sync_module._sync_board(db, spec, org, registry, EPOCH, users, stats)
    await db.flush()

    members = (await db.execute(select(BoardMember.user_id))).scalars().all()
    assert board.ydoc_state == b"bundle-canvas"
    assert members == [users["student-1"].id]
    assert stats.updated == 1
    assert stats.drift_deleted == 1


# ---------------------------------------------------------------------------
# the storefront, against stand-in Enterprise models
# ---------------------------------------------------------------------------

class _EEBase(DeclarativeBase):
    """Own metadata, so these tables never join the shared test schema."""


class PaymentProviderEnum(str, enum.Enum):
    STRIPE = "stripe"
    CUSTOM = "custom"


class OfferTypeEnum(str, enum.Enum):
    ONE_TIME = "one_time"
    SUBSCRIPTION = "subscription"


class OfferPriceTypeEnum(str, enum.Enum):
    FIXED_PRICE = "fixed_price"
    CUSTOMER_CHOICE = "customer_choice"


class EnrollmentStatusEnum(str, enum.Enum):
    ACTIVE = "active"
    PENDING = "pending"


class PaymentsConfig(_EEBase):
    __tablename__ = "fake_payments_config"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer)
    enabled: Mapped[bool] = mapped_column(Boolean)
    active: Mapped[bool] = mapped_column(Boolean)
    provider: Mapped[PaymentProviderEnum] = mapped_column(SAEnum(PaymentProviderEnum))
    provider_config: Mapped[dict] = mapped_column(JSON)
    creation_date: Mapped[datetime] = mapped_column(DateTime)
    update_date: Mapped[datetime] = mapped_column(DateTime)


class PaymentsGroup(_EEBase):
    __tablename__ = "fake_payments_group"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(String)
    creation_date: Mapped[datetime] = mapped_column(DateTime)
    update_date: Mapped[datetime] = mapped_column(DateTime)


class PaymentsGroupResource(_EEBase):
    __tablename__ = "fake_payments_group_resource"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    payments_group_id: Mapped[int] = mapped_column(Integer)
    resource_uuid: Mapped[str] = mapped_column(String)
    org_id: Mapped[int] = mapped_column(Integer)
    creation_date: Mapped[datetime] = mapped_column(DateTime)
    update_date: Mapped[datetime] = mapped_column(DateTime)


class PaymentsOffer(_EEBase):
    __tablename__ = "fake_payments_offer"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(Integer)
    payments_config_id: Mapped[int] = mapped_column(Integer)
    offer_uuid: Mapped[str] = mapped_column(String)
    provider_product_id: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(String)
    offer_type: Mapped[OfferTypeEnum] = mapped_column(SAEnum(OfferTypeEnum))
    price_type: Mapped[OfferPriceTypeEnum] = mapped_column(SAEnum(OfferPriceTypeEnum))
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String)
    benefits: Mapped[str] = mapped_column(String)
    is_publicly_listed: Mapped[bool] = mapped_column(Boolean)
    payments_group_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    external_checkout_url: Mapped[str | None] = mapped_column(String, nullable=True)
    creation_date: Mapped[datetime] = mapped_column(DateTime)
    update_date: Mapped[datetime] = mapped_column(DateTime)


class PaymentsOfferResource(_EEBase):
    __tablename__ = "fake_payments_offer_resource"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    offer_id: Mapped[int] = mapped_column(Integer)
    resource_uuid: Mapped[str] = mapped_column(String)
    org_id: Mapped[int] = mapped_column(Integer)
    creation_date: Mapped[datetime] = mapped_column(DateTime)
    update_date: Mapped[datetime] = mapped_column(DateTime)


class PaymentsEnrollment(_EEBase):
    __tablename__ = "fake_payments_enrollment"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    enrollment_uuid: Mapped[str] = mapped_column(String)
    offer_id: Mapped[int] = mapped_column(Integer)
    user_id: Mapped[int] = mapped_column(Integer)
    org_id: Mapped[int] = mapped_column(Integer)
    status: Mapped[EnrollmentStatusEnum] = mapped_column(SAEnum(EnrollmentStatusEnum))
    creation_date: Mapped[datetime] = mapped_column(DateTime)
    update_date: Mapped[datetime] = mapped_column(DateTime)


def _module(name: str, **attrs) -> types.ModuleType:
    module = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    return module


@pytest.fixture
async def fake_ee(engine, monkeypatch):
    """A complete stand-in Enterprise payments package, with its tables."""
    async with engine.begin() as conn:
        await conn.run_sync(_EEBase.metadata.create_all)

    for name, module in (
        ("ee", _module("ee")),
        ("ee.db", _module("ee.db")),
        ("ee.db.payments", _module("ee.db.payments")),
        (
            "ee.db.payments.payments",
            _module(
                "ee.db.payments.payments",
                PaymentProviderEnum=PaymentProviderEnum,
                PaymentsConfig=PaymentsConfig,
            ),
        ),
        (
            "ee.db.payments.payments_enrollments",
            _module(
                "ee.db.payments.payments_enrollments",
                EnrollmentStatusEnum=EnrollmentStatusEnum,
                PaymentsEnrollment=PaymentsEnrollment,
            ),
        ),
        (
            "ee.db.payments.payments_groups",
            _module(
                "ee.db.payments.payments_groups",
                PaymentsGroup=PaymentsGroup,
                PaymentsGroupResource=PaymentsGroupResource,
                PaymentsOfferResource=PaymentsOfferResource,
            ),
        ),
        (
            "ee.db.payments.payments_offers",
            _module(
                "ee.db.payments.payments_offers",
                OfferPriceTypeEnum=OfferPriceTypeEnum,
                OfferTypeEnum=OfferTypeEnum,
                PaymentsOffer=PaymentsOffer,
            ),
        ),
    ):
        monkeypatch.setitem(sys.modules, name, module)
    monkeypatch.setattr("src.core.deployment_mode.get_deployment_mode", lambda: "saas")


@pytest.fixture
def no_ee(monkeypatch):
    """A build that claims a storefront but cannot import the models."""
    for name in list(sys.modules):
        if name == "ee" or name.startswith("ee."):
            monkeypatch.delitem(sys.modules, name, raising=False)
    monkeypatch.setitem(sys.modules, "ee", None)
    monkeypatch.setattr(sync_module, "_store_unsupported_reason", lambda: None)


_STORE = StoreSpec(
    groups=[
        StoreGroupSpec(slug="g-all", name="Everything", courses=["c-one", "c-unknown"])
    ],
    offers=[
        StoreOfferSpec(slug="o-course", name="One course", amount=10, course="c-one"),
        StoreOfferSpec(slug="o-group", name="Bundle", amount=30, group="g-all"),
    ],
    enrollments=[
        StoreEnrollmentSpec(offer="o-course", student="student-1"),
        StoreEnrollmentSpec(offer="o-course", student="student-gone"),
        StoreEnrollmentSpec(offer="o-gone", student="student-1"),
    ],
)


async def _all(db, model):
    return (await db.execute(select(model))).scalars().all()


async def test_an_empty_store_is_skipped(db, org):
    stats = _stats()
    await sync_module._sync_store(
        db, _bundle(), org, Registry(org.id, []), EPOCH, {}, stats
    )
    assert "store" not in stats.steps


async def test_a_store_whose_models_will_not_import_is_skipped(db, org, no_ee, caplog):
    stats = _stats()
    with caplog.at_level("INFO", logger=sync_module.logger.name):
        await sync_module._sync_store(
            db, _bundle(store=_STORE), org, Registry(org.id, []), EPOCH, {}, stats
        )
        await sync_module._delete_store_drift(db, org, Registry(org.id, []), stats)

    assert "store" not in stats.steps
    assert "payments models unavailable" in caplog.text
    assert stats.drift_deleted == 0


async def test_the_storefront_is_seeded_then_put_back(fake_ee, db, org, no_uploads):
    """Seed, let a visitor-admin rewrite every store row, then reconcile."""
    registry = Registry(org.id, [])
    _, course = await _mini_course(db, org, registry)
    users = await _students(db, org, registry, [_plan(1)])
    bundle = _bundle(store=_STORE)

    stats = _stats()
    await sync_module._sync_store(db, bundle, org, registry, EPOCH, users, stats)
    await db.flush()

    assert "store" in stats.steps
    [config] = await _all(db, PaymentsConfig)
    assert config.provider == PaymentProviderEnum.CUSTOM
    [group] = await _all(db, PaymentsGroup)
    # The unknown course key resolves to nothing and is dropped.
    assert [r.resource_uuid for r in await _all(db, PaymentsGroupResource)] == [
        course.course_uuid
    ]
    offers = {o.name: o for o in await _all(db, PaymentsOffer)}
    assert offers["Bundle"].payments_group_id == group.id
    assert offers["One course"].payments_group_id is None
    assert [r.resource_uuid for r in await _all(db, PaymentsOfferResource)] == [
        course.course_uuid
    ]
    # Only the enrolment whose offer and learner both exist.
    [enrolment] = await _all(db, PaymentsEnrollment)
    assert enrolment.user_id == users["student-1"].id
    assert enrolment.status == EnrollmentStatusEnum.ACTIVE

    # A visitor-admin's afternoon.
    now = datetime.now()
    config.enabled = False
    group.name = "Hacked"
    offers["One course"].external_checkout_url = "https://phish.example"
    enrolment.status = EnrollmentStatusEnum.PENDING
    db.add_all([
        PaymentsGroupResource(
            payments_group_id=group.id, resource_uuid="course_visitor",
            org_id=org.id, creation_date=now, update_date=now,
        ),
        PaymentsOfferResource(
            offer_id=offers["One course"].id, resource_uuid="course_visitor",
            org_id=org.id, creation_date=now, update_date=now,
        ),
    ])
    await db.flush()

    stats = _stats()
    await sync_module._sync_store(db, bundle, org, registry, EPOCH, users, stats)
    await db.flush()

    assert config.enabled is True
    assert group.name == "Everything"
    assert offers["One course"].external_checkout_url is None
    assert enrolment.status == EnrollmentStatusEnum.ACTIVE
    assert {r.resource_uuid for r in await _all(db, PaymentsGroupResource)} == {
        course.course_uuid
    }
    assert {r.resource_uuid for r in await _all(db, PaymentsOfferResource)} == {
        course.course_uuid
    }
    assert stats.updated == 4
    assert stats.drift_deleted == 2
    assert stats.created == 0


async def test_store_rows_a_visitor_created_are_swept(fake_ee, db, org, no_uploads):
    registry = Registry(org.id, [])
    await _mini_course(db, org, registry)
    users = await _students(db, org, registry, [_plan(1)])
    await sync_module._sync_store(
        db, _bundle(store=_STORE), org, registry, EPOCH, users, _stats()
    )
    await db.flush()
    [config] = await _all(db, PaymentsConfig)

    now = datetime.now()
    visitor_group = PaymentsGroup(
        org_id=org.id, name="Mine", description="", creation_date=now, update_date=now
    )
    visitor_offer = PaymentsOffer(
        org_id=org.id, payments_config_id=config.id, offer_uuid="offer_visitor",
        provider_product_id="", name="Cheap", description="",
        offer_type=OfferTypeEnum.ONE_TIME, price_type=OfferPriceTypeEnum.FIXED_PRICE,
        amount=1, currency="USD", benefits="", is_publicly_listed=True,
        creation_date=now, update_date=now,
    )
    db.add_all([visitor_group, visitor_offer])
    await db.flush()
    db.add(
        PaymentsEnrollment(
            enrollment_uuid="enrol_visitor", offer_id=visitor_offer.id,
            user_id=users["student-1"].id, org_id=org.id,
            status=EnrollmentStatusEnum.ACTIVE, creation_date=now, update_date=now,
        )
    )
    await db.flush()

    stats = _stats()
    await sync_module._delete_store_drift(db, org, registry, stats)

    assert {o.name for o in await _all(db, PaymentsOffer)} == {"One course", "Bundle"}
    assert {g.name for g in await _all(db, PaymentsGroup)} == {"Everything"}
    assert "enrol_visitor" not in {
        e.enrollment_uuid for e in await _all(db, PaymentsEnrollment)
    }
    assert stats.drift_deleted == 3


# ---------------------------------------------------------------------------
# drift guards
# ---------------------------------------------------------------------------

def test_a_drifted_podcast_reclaims_its_storage_directory():
    org = SimpleNamespace(org_uuid="org_demo")
    assert sync_module._storage_paths_for(
        DemoEntityKind.PODCAST, org, ["podcast_x"]
    ) == ["content/orgs/org_demo/podcasts/podcast_x"]


async def test_visitor_progress_is_left_alone_before_any_student_exists(
    db, org, admin_user
):
    """With no students to compare against, every row would look like a visitor's."""
    trail = Trail(org_id=org.id, user_id=admin_user.id, trail_uuid="trail_visitor")
    db.add(trail)
    await db.flush()

    stats = _stats()
    await sync_module._delete_visitor_progress_drift(
        db, org, Registry(org.id, []), stats
    )

    assert (await _all(db, Trail)) == [trail]
    assert stats.drift_deleted == 0


async def test_drift_passes_with_nothing_to_scope_return_quietly(db, org):
    """No courses means no certifications; no discussions means no comments."""
    stats = _stats()
    registry = Registry(org.id, [])

    await sync_module._delete_certification_drift(db, org, registry, stats)
    await sync_module._delete_comment_drift(db, org, registry, stats)
    await sync_module._delete_progress_drift(db, org, [], {}, {}, stats)

    assert stats.drift_deleted == 0


async def test_a_registry_row_outside_the_demo_org_aborts_the_sync(db, org, other_org):
    db.add(
        DemoEntity(
            kind=DemoEntityKind.COURSE, bundle_key="c-leak", entity_id=1,
            entity_uuid="course_leak", org_id=other_org.id,
        )
    )
    await db.flush()

    with pytest.raises(RuntimeError, match="outside the demo org"):
        await sync_module._assert_single_tenant(db, org)


# ---------------------------------------------------------------------------
# progress
# ---------------------------------------------------------------------------

async def test_progress_skips_the_unresolvable_and_recompletes_steps(
    db, org, no_uploads
):
    registry = Registry(org.id, [])
    spec, course = await _mini_course(db, org, registry)
    finisher = _plan(1, course_keys=["c-one", "c-unbuilt"], completion={"c-one": 1.0})
    missing = _plan(2, course_keys=["c-one"])
    users = await _students(db, org, registry, [finisher])
    bundle = _bundle(courses=[spec])

    await sync_module._sync_progress(
        db, bundle, org, registry, EPOCH, [finisher, missing], users, _stats()
    )
    await db.flush()

    runs = await _all(db, TrailRun)
    assert [(r.user_id, r.course_id) for r in runs] == [
        (users["student-1"].id, course.id)
    ]
    steps = await _all(db, TrailStep)
    assert len(steps) == 3

    steps[0].complete = False
    db.add(steps[0])
    await db.flush()

    stats = _stats()
    await sync_module._sync_progress(
        db, bundle, org, registry, EPOCH, [finisher, missing], users, stats
    )

    assert steps[0].complete is True
    assert stats.updated == 1
    assert stats.created == 0
