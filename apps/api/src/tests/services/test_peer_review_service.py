"""Peer review service: access, allocation, scoring, unlock rules, anonymity."""

from contextlib import contextmanager
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus as S,
    GradingTypeEnum,
)
from src.db.courses.peer_reviews import (
    AssignmentPeerReflection,
    AssignmentPeerReview,
    AssignmentPeerReviewSettings,
    PeerCalibrationBody,
    PeerDiscardBody,
    PeerFlagBody,
    PeerRateBody,
    PeerReflectionBody,
    PeerReviewSaveBody,
    PeerReviewSettingsUpdate,
    PeerSelfReviewBody,
)
from src.db.notifications import Notification
from src.db.organization_config import OrganizationConfig
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, APITokenUser, PublicUser, User
from src.services.courses.activities import peer_review as pr

M = "src.services.courses.activities.peer_review"

RUBRIC = [
    {"id": "c1", "title": "Clarity", "levels": [
        {"id": "l0", "points": 0, "label": "Weak"},
        {"id": "l1", "points": 2, "label": "OK"},
        {"id": "l2", "points": 4, "label": "Strong"},
    ]},
    {"id": "c2", "title": "Evidence", "levels": [
        {"id": "e0", "points": 0, "label": "None"},
        {"id": "e1", "points": 5, "label": "Some"},
        {"id": "e2", "points": 10, "label": "Plenty"},
    ]},
]
SAMPLES = [
    {"id": "s1", "title": "Sample one", "content": "Text", "scores": {"c1": "l2", "c2": "e1"}, "explanation": "Why"},
]
LONG = "This is a thoughtful comment that is long enough."
GOOD_COMMENTS = {"strength": LONG, "suggestion": LONG}
FULL = {"c1": "l2", "c2": "e2"}


def _ts(minutes_ago: float = 0) -> str:
    return str(datetime.now() - timedelta(minutes=minutes_ago))


def _pub(u: User) -> PublicUser:
    return PublicUser(
        id=u.id, username=u.username, first_name=u.first_name, last_name=u.last_name,
        email=u.email, user_uuid=u.user_uuid,
    )


async def _user(db, org, user_role, uid: int) -> PublicUser:
    u = User(
        id=uid, username=f"learner{uid}", first_name=f"First{uid}", last_name=f"Last{uid}",
        email=f"l{uid}@test.com", password="x", user_uuid=f"user_{uid}",
        creation_date=_ts(), update_date=_ts(),
    )
    db.add(u)
    db.add(UserOrganization(user_id=uid, org_id=org.id, role_id=user_role.id, creation_date=_ts(), update_date=_ts()))
    await db.commit()
    return _pub(u)


async def _sub(db, assignment, uid, status=S.SUBMITTED, attempt=1, minutes_ago=60.0):
    s = AssignmentUserSubmission(
        user_id=uid, assignment_id=assignment.id, grade=0, submission_status=status,
        attempt_number=attempt, assignmentusersubmission_uuid=f"aus_{uid}",
        creation_date=_ts(minutes_ago), update_date=_ts(minutes_ago),
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


async def _settings(db, assignment, **kw):
    data = dict(
        assignment_id=assignment.id, org_id=assignment.org_id, enabled=True, rubric=RUBRIC,
        calibration_samples=[], calibration_enabled=False, creation_date=_ts(), update_date=_ts(),
    )
    data.update(kw)
    row = AssignmentPeerReviewSettings(**data)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def _review(db, assignment, reviewer, reviewee, *, kind="peer", status="submitted", attempt=1,
                  scores=None, minutes_ago=10.0, sample=None, **kw):
    r = AssignmentPeerReview(
        review_uuid=f"peerreview_{reviewer}_{reviewee}_{kind}_{attempt}_{sample}",
        assignment_id=assignment.id, org_id=assignment.org_id,
        reviewer_user_id=reviewer, reviewee_user_id=reviewee, kind=kind,
        calibration_sample_id=sample, attempt_number=attempt, status=status,
        scores=scores if scores is not None else dict(FULL), comments={}, criterion_comments={},
        assigned_at=_ts(minutes_ago), submitted_at=_ts(minutes_ago) if status == "submitted" else None,
        creation_date=_ts(minutes_ago), update_date=_ts(minutes_ago), **kw,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


@contextmanager
def access(instructors=()):
    ids = set(instructors)

    async def is_instructor(request, user, course_uuid, db):
        return getattr(user, "id", None) in ids

    with patch(f"{M}.authorize_assignment_access", new=AsyncMock()) as auth, \
         patch(f"{M}._is_assignment_instructor", new=AsyncMock(side_effect=is_instructor)):
        yield auth


@pytest.fixture
async def world(db, org, user_role, admin_user, course, chapter, activity, assignment):
    """Assignment with peer review on and five learners (ids 101-105)."""
    learners = [await _user(db, org, user_role, uid) for uid in range(101, 106)]
    settings = await _settings(db, assignment)
    return {"assignment": assignment, "settings": settings, "learners": learners, "admin": admin_user}


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_percentage_and_scores():
    assert pr.review_percentage({"c1": "l2", "c2": "e1"}, RUBRIC) == pytest.approx(9 / 14 * 100)
    assert pr.review_percentage({}, RUBRIC) is None
    assert pr.review_percentage({"zz": "l1"}, RUBRIC) is None


def test_peer_score_median_spread_and_min():
    def rv(scores, i):
        return AssignmentPeerReview(id=i, review_uuid=str(i), assignment_id=1, org_id=1, reviewer_user_id=i,
                                    kind="peer", scores=scores, creation_date="", update_date="")

    reviews = [rv({"c1": "l0", "c2": "e0"}, 1), rv({"c1": "l2", "c2": "e2"}, 2), rv({"c1": "l1", "c2": "e1"}, 3)]
    score = pr.peer_score(reviews, RUBRIC, 3)
    assert score["criteria"] == [
        {"criterion_id": "c1", "median": 2.0, "max_points": 4.0},
        {"criterion_id": "c2", "median": 5.0, "max_points": 10.0},
    ]
    assert score["percentage"] == pytest.approx(50.0)
    assert score["review_count"] == 3
    assert score["spread"] == 100.0
    assert pr.peer_score(reviews, RUBRIC, 4) is None
    assert pr.peer_score(reviews, [], 1) is None
    # A criterion nobody scored is left out; an all-zero rubric has no percentage.
    zero = [{"id": "z", "title": "Z", "levels": [{"id": "a", "points": 0, "label": "A"}, {"id": "b", "points": 0, "label": "B"}]},
            {"id": "c9", "title": "Unscored", "levels": [{"id": "x", "points": 1, "label": "X"}, {"id": "y", "points": 2, "label": "Y"}]}]
    out = pr.peer_score([rv({"z": "a"}, 4)], zero, 1)
    assert out["criteria"] == [{"criterion_id": "z", "median": 0.0, "max_points": 0.0}]
    assert out["percentage"] is None and out["spread"] is None
    assert pr.score_spread(reviews[:1], RUBRIC) is None


def test_validation_helpers():
    with pytest.raises(HTTPException) as e:
        pr._validate_scores({"nope": "l1"}, RUBRIC, require_all=False)
    assert e.value.status_code == 422
    with pytest.raises(HTTPException):
        pr._validate_scores({"c1": "bad"}, RUBRIC, require_all=False)
    with pytest.raises(HTTPException):
        pr._validate_scores({"c1": "l1"}, RUBRIC, require_all=True)
    with pytest.raises(HTTPException):
        pr._validate_scores({}, [], require_all=True)
    assert pr._validate_scores({"c1": "l1"}, RUBRIC, require_all=False) == {"c1": "l1"}

    prompts = pr.effective_prompts(None)
    assert [p["key"] for p in prompts] == ["strength", "suggestion", "question"]
    with pytest.raises(HTTPException):
        pr._validate_comments({"other": "x"}, prompts, enforce_min=False)
    with pytest.raises(HTTPException):
        pr._validate_comments({"strength": "x" * 6000}, prompts, enforce_min=False)
    with pytest.raises(HTTPException) as e:
        pr._validate_comments({"strength": "too short"}, prompts, enforce_min=True)
    assert "What works well" in e.value.detail
    assert pr._validate_comments(GOOD_COMMENTS, prompts, enforce_min=True) == GOOD_COMMENTS

    with pytest.raises(HTTPException):
        pr._validate_criterion_comments({"zz": "x"}, RUBRIC)
    with pytest.raises(HTTPException):
        pr._validate_criterion_comments({"c1": "x" * 3000}, RUBRIC)
    assert pr._validate_criterion_comments(None, RUBRIC) == {}


def test_party_and_anonymity_helpers():
    u = User(id=7, username="u", first_name="F", last_name="L", email="u@x.com", user_uuid="user_7")
    assert pr._party(u)["user_id"] == 7
    assert pr._party(u, label="Reviewer 1", hidden=True)["user_id"] is None
    assert pr._party(None) is None
    assert pr._party(None, label="Classmate")["label"] == "Classmate"
    assert pr._hide_reviewer(None) and pr._hide_reviewee(None)


def test_parse_and_misc():
    assert pr._parse("garbage") is None
    assert pr._parse(None) is None
    assert pr._parse("2026-01-01T10:00:00+02:00") == datetime(2026, 1, 1, 10, 0)
    assert pr._avg([]) is None
    assert pr._reflection_dict(None) is None
    assert pr.file_path("r", "t") == "assignments/peer-review/reviews/r/files/t"
    assert pr._sanitize_answer("text") == ("text", False)
    assert pr._sanitize_answer({"fileUUID": "a_submission_u3.pdf", "x": 1}) == ({"x": 1}, True)
    stale = AssignmentPeerReview(review_uuid="x", assignment_id=1, org_id=1, reviewer_user_id=1, kind="peer",
                                 creation_date="", update_date="", assigned_at=None)
    assert pr._is_fresh(stale, datetime.now()) is False


def test_feedback_state_rules():
    s = AssignmentPeerReviewSettings(assignment_id=1, org_id=1, creation_date="", update_date="",
                                     require_reviews_to_see_feedback=False)
    assert pr.feedback_state(s, 0, 3) == (True, None)
    s.require_reviews_to_see_feedback = True
    assert pr.feedback_state(s, 3, 3) == (True, "reviews")
    assert pr.feedback_state(s, 1, 3) == (False, None)
    s.review_due_date = "2000-01-01"
    assert pr.feedback_state(s, 1, 3) == (True, "due_date")
    s.review_due_date = "2999-01-01"
    assert pr.feedback_state(s, 1, 3) == (False, None)


async def test_lock_allocation_postgres_only():
    sqlite = MagicMock()
    sqlite.get_bind.return_value.dialect.name = "sqlite"
    sqlite.execute = AsyncMock()
    await pr._lock_allocation(sqlite, 5)
    sqlite.execute.assert_not_called()

    pg = MagicMock()
    pg.get_bind.return_value.dialect.name = "postgresql"
    pg.execute = AsyncMock()
    await pr._lock_allocation(pg, 5)
    stmt, params = pg.execute.call_args.args
    assert "pg_advisory_xact_lock(hashtext(:key))" in str(stmt)
    assert params == {"key": "peer_review:5"}


# ---------------------------------------------------------------------------
# Plan gate
# ---------------------------------------------------------------------------


async def test_feature_available_by_mode_and_plan(db, org):
    assert await pr.feature_available(db, org.id) is True  # OSS
    with patch("src.security.features_utils.resolve.get_deployment_mode", return_value="saas"):
        assert await pr.feature_available(db, org.id) is False  # no config: free
        db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "plan": "personal"},
                                  creation_date="", update_date=""))
        await db.commit()
        assert await pr.feature_available(db, org.id) is False
        row = (await db.execute(select(OrganizationConfig))).scalars().first()
        row.config = {"config_version": "2.0", "plan": "standard"}
        db.add(row)
        await db.commit()
        assert await pr.feature_available(db, org.id) is True


async def test_plan_lost_learner_endpoints_403_but_settings_readable(db, world, mock_request):
    a, learner = world["assignment"], world["learners"][0]
    await _sub(db, a, learner.id)
    with access(), patch(f"{M}.feature_available", new=AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as e:
            await pr.get_learner_state(mock_request, db, learner, a.assignment_uuid)
        assert e.value.status_code == 403 and "Standard" in e.value.detail
        view = await pr.get_settings(mock_request, db, learner, a.assignment_uuid)
        assert view["feature_available"] is False and view["enabled"] is True


async def test_enabling_requires_plan(db, world, mock_request):
    a, admin = world["assignment"], world["admin"]
    with access(instructors=[admin.id]), patch(f"{M}.feature_available", new=AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as e:
            await pr.update_settings(mock_request, db, admin, a.assignment_uuid, PeerReviewSettingsUpdate(enabled=True))
        assert e.value.status_code == 403
        # Turning it off still works without the plan.
        out = await pr.update_settings(mock_request, db, admin, a.assignment_uuid, PeerReviewSettingsUpdate(enabled=False))
        assert out["enabled"] is False


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------


async def test_learner_access_denials(db, world, mock_request, org):
    a, learner = world["assignment"], world["learners"][0]
    with access():
        with pytest.raises(HTTPException) as e:
            await pr.get_learner_state(mock_request, db, APITokenUser(org_id=org.id), a.assignment_uuid)
        assert e.value.status_code == 403
        with pytest.raises(HTTPException) as e:
            await pr.get_learner_state(mock_request, db, AnonymousUser(), a.assignment_uuid)
        assert e.value.status_code == 401
        with pytest.raises(HTTPException) as e:
            await pr.get_learner_state(mock_request, db, learner, "assignment_missing")
        assert e.value.status_code == 404
        world["settings"].enabled = False
        db.add(world["settings"])
        await db.commit()
        with pytest.raises(HTTPException) as e:
            await pr.get_learner_state(mock_request, db, learner, a.assignment_uuid)
        assert e.value.status_code == 404


async def test_missing_course_404(db, org, mock_request, admin_user):
    a = Assignment(id=99, title="T", description="", grading_type=GradingTypeEnum.NUMERIC, org_id=org.id,
                   course_id=999, chapter_id=1, activity_id=1, assignment_uuid="assignment_orphan")
    db.add(a)
    await db.commit()
    with access(instructors=[admin_user.id]):
        with pytest.raises(HTTPException) as e:
            await pr.get_overview(mock_request, db, admin_user, "assignment_orphan")
    assert e.value.status_code == 404 and e.value.detail == "Course not found"


async def test_instructor_endpoints_require_instructor(db, world, mock_request):
    a, learner = world["assignment"], world["learners"][0]
    with access():
        with pytest.raises(HTTPException) as e:
            await pr.get_overview(mock_request, db, learner, a.assignment_uuid)
    assert e.value.status_code == 403


async def test_instructors_cannot_take_learner_steps(db, world, mock_request):
    a, admin = world["assignment"], world["admin"]
    await _sub(db, a, admin.id)
    with access(instructors=[admin.id]):
        for call in (
            pr.next_review(mock_request, db, admin, a.assignment_uuid),
            pr.submit_self_review(mock_request, db, admin, a.assignment_uuid, PeerSelfReviewBody(scores=FULL)),
            pr.submit_calibration(mock_request, db, admin, a.assignment_uuid, "s1", PeerCalibrationBody(scores=FULL)),
        ):
            with pytest.raises(HTTPException) as e:
                await call
            assert e.value.status_code == 403
        state = await pr.get_learner_state(mock_request, db, admin, a.assignment_uuid)
        assert state["is_instructor"] is True and state["steps"]["reviews"]["available"] is False


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


async def test_settings_defaults_and_learner_strip(db, org, user_role, assignment, admin_user, mock_request):
    learner = await _user(db, org, user_role, 150)
    with access(instructors=[admin_user.id]):
        view = await pr.get_settings(mock_request, db, learner, assignment.assignment_uuid)
        assert view["enabled"] is False and view["id"] is None and view["prompts"] is None
        assert len(view["effective_prompts"]) == 3 and view["reviews_required"] == 3
        assert view["anonymity"] == "double_blind" and view["score_mode"] == "feedback_only"

        out = await pr.update_settings(mock_request, db, admin_user, assignment.assignment_uuid, PeerReviewSettingsUpdate(
            enabled=True, rubric=RUBRIC, calibration_samples=SAMPLES, review_due_date="2030-01-01",
            prompts=[{"key": "k", "label": "Say something", "min_chars": 5}],
        ))
        assert out["enabled"] is True and out["calibration_samples"][0]["scores"] == {"c1": "l2", "c2": "e1"}
        assert out["prompts"][0]["key"] == "k"

        learner_view = await pr.get_settings(mock_request, db, learner, assignment.assignment_uuid)
        assert learner_view["calibration_samples"] == [{"id": "s1", "title": "Sample one", "content": "Text"}]

        out = await pr.update_settings(mock_request, db, admin_user, assignment.assignment_uuid,
                                       PeerReviewSettingsUpdate(prompts=None, review_due_date=None))
        assert out["prompts"] is None and out["review_due_date"] is None and out["rubric"] == RUBRIC


async def test_settings_validation(db, assignment, admin_user, mock_request):
    with access(instructors=[admin_user.id]):
        with pytest.raises(HTTPException) as e:
            await pr.update_settings(mock_request, db, admin_user, assignment.assignment_uuid,
                                     PeerReviewSettingsUpdate(enabled=True))
        assert e.value.status_code == 422
        with pytest.raises(HTTPException) as e:
            await pr.update_settings(mock_request, db, admin_user, assignment.assignment_uuid, PeerReviewSettingsUpdate(
                rubric=RUBRIC, calibration_samples=[{"id": "s", "title": "S", "scores": {"c1": "nope"}}],
            ))
        assert e.value.status_code == 422 and "Practice sample" in e.value.detail


def test_settings_body_validators():
    from pydantic import ValidationError

    level = {"id": "a", "points": 1, "label": "A"}
    with pytest.raises(ValidationError):
        PeerReviewSettingsUpdate(rubric=[{"id": "c", "title": "C", "levels": [level, level]}])
    with pytest.raises(ValidationError):
        PeerReviewSettingsUpdate(rubric=[{"id": "c", "title": "C", "levels": [level]}])
    with pytest.raises(ValidationError):
        PeerReviewSettingsUpdate(rubric=RUBRIC + [RUBRIC[0]])
    with pytest.raises(ValidationError):
        PeerReviewSettingsUpdate(prompts=[{"key": "a", "label": "A"}, {"key": "a", "label": "B"}])
    with pytest.raises(ValidationError):
        PeerReviewSettingsUpdate(calibration_samples=[{"id": "s", "title": "S"}, {"id": "s", "title": "T"}])
    with pytest.raises(ValidationError):
        PeerReviewSettingsUpdate(reviews_required=11)
    with pytest.raises(ValidationError):
        PeerReviewSettingsUpdate(prompts=[{"key": "a", "label": "A", "min_chars": 2001}])
    assert PeerReviewSettingsUpdate(prompts=None, rubric=None, calibration_samples=None).prompts is None


# ---------------------------------------------------------------------------
# Allocation
# ---------------------------------------------------------------------------


async def test_next_requires_own_submission_and_calibration(db, world, mock_request):
    a, l1 = world["assignment"], world["learners"][0]
    with access():
        with pytest.raises(HTTPException) as e:
            await pr.next_review(mock_request, db, l1, a.assignment_uuid)
        assert e.value.status_code == 403
        await _sub(db, a, l1.id)
        world["settings"].calibration_enabled = True
        world["settings"].calibration_samples = SAMPLES
        db.add(world["settings"])
        await db.commit()
        with pytest.raises(HTTPException) as e:
            await pr.next_review(mock_request, db, l1, a.assignment_uuid)
        assert e.value.status_code == 409
        await pr.submit_calibration(mock_request, db, l1, a.assignment_uuid, "s1", PeerCalibrationBody(scores=FULL))
        out = await pr.next_review(mock_request, db, l1, a.assignment_uuid)
        assert out == {"review": None, "reason": "none_available"}


async def test_allocation_order_least_reviewed_then_earliest(db, world, mock_request):
    a, ls = world["assignment"], world["learners"]
    me = ls[0]
    await _sub(db, a, me.id)
    await _sub(db, a, ls[1].id, minutes_ago=300)  # earliest, but has 2 reviews
    await _sub(db, a, ls[2].id, minutes_ago=100)  # 1 fresh assigned review
    await _sub(db, a, ls[3].id, minutes_ago=50)   # 1 stale assigned review: counts 0
    await _sub(db, a, ls[4].id, minutes_ago=40)   # 0 reviews, later than ls[3]
    await _review(db, a, ls[2].id, ls[1].id)
    await _review(db, a, ls[3].id, ls[1].id)
    await _review(db, a, ls[1].id, ls[2].id, status="assigned", minutes_ago=30)
    await _review(db, a, ls[4].id, ls[3].id, status="assigned", minutes_ago=60 * 25)
    with access():
        first = await pr.next_review(mock_request, db, me, a.assignment_uuid)
        r1 = (await db.execute(select(AssignmentPeerReview).where(
            AssignmentPeerReview.review_uuid == first["review"]["review_uuid"]))).scalars().one()
        assert r1.reviewee_user_id == ls[3].id and r1.status == "assigned"
        # Double-blind: no identity in the payload.
        assert first["review"]["reviewee"]["user_id"] is None
        assert first["review"]["reviewee"]["label"] == "Classmate"
        # Asking again returns the same open review.
        again = await pr.next_review(mock_request, db, me, a.assignment_uuid)
        assert again["review"]["review_uuid"] == r1.review_uuid

        r1.status = "submitted"
        db.add(r1)
        await db.commit()
        second = await pr.next_review(mock_request, db, me, a.assignment_uuid)
        r2 = (await db.execute(select(AssignmentPeerReview).where(
            AssignmentPeerReview.review_uuid == second["review"]["review_uuid"]))).scalars().one()
        assert r2.reviewee_user_id == ls[4].id


async def test_allocation_excludes_unsubmitted_and_already_reviewed_and_allows_extra(db, world, mock_request):
    a, ls = world["assignment"], world["learners"]
    me = ls[0]
    await _sub(db, a, me.id)
    await _sub(db, a, ls[1].id)
    await _sub(db, a, ls[2].id, status=S.PENDING)
    await _sub(db, a, ls[3].id, status=S.GRADED)
    await _review(db, a, me.id, ls[1].id)
    world["settings"].reviews_required = 1
    db.add(world["settings"])
    await db.commit()
    with access():
        out = await pr.next_review(mock_request, db, me, a.assignment_uuid)
        r = (await db.execute(select(AssignmentPeerReview).where(
            AssignmentPeerReview.review_uuid == out["review"]["review_uuid"]))).scalars().one()
        assert r.reviewee_user_id == ls[3].id  # extra review beyond the required one


async def test_retry_closes_open_review_and_new_attempt_is_reviewable(db, world, mock_request):
    a, ls = world["assignment"], world["learners"]
    me, peer = ls[0], ls[1]
    await _sub(db, a, me.id)
    peer_sub = await _sub(db, a, peer.id)
    with access():
        out = await pr.next_review(mock_request, db, me, a.assignment_uuid)
        uuid1 = out["review"]["review_uuid"]
        # Peer retries: attempt 2, PENDING. The open review is moot.
        peer_sub.attempt_number = 2
        peer_sub.submission_status = S.PENDING
        db.add(peer_sub)
        await db.commit()
        out = await pr.next_review(mock_request, db, me, a.assignment_uuid)
        assert out["review"] is None
        old = (await db.execute(select(AssignmentPeerReview).where(
            AssignmentPeerReview.review_uuid == uuid1))).scalars().one()
        assert old.status == "discarded" and old.discard_reason == "submission_changed" and old.discarded_by is None
        # Resubmitted attempt 2 can be reviewed again by the same reviewer.
        peer_sub.submission_status = S.SUBMITTED
        db.add(peer_sub)
        await db.commit()
        out = await pr.next_review(mock_request, db, me, a.assignment_uuid)
        new = (await db.execute(select(AssignmentPeerReview).where(
            AssignmentPeerReview.review_uuid == out["review"]["review_uuid"]))).scalars().one()
        assert new.attempt_number == 2


async def test_close_superseded_reviews_hook(db, world):
    a, ls = world["assignment"], world["learners"]
    await _review(db, a, ls[0].id, ls[1].id, status="assigned", attempt=1)
    await _review(db, a, ls[2].id, ls[1].id, status="submitted", attempt=1)
    assert await pr.close_superseded_reviews(db, a.id, ls[1].id, 2) == 1
    assert await pr.close_superseded_reviews(db, a.id, ls[1].id, 2) == 0
    rows = await pr._reviews(db, a, reviewee_user_id=ls[1].id)
    assert sorted(r.status for r in rows) == ["discarded", "submitted"]
    broken = MagicMock()
    broken.execute = AsyncMock(side_effect=RuntimeError("db down"))
    broken.rollback = AsyncMock()
    assert await pr.close_superseded_reviews(broken, 1, 1, 2) == 0


async def test_next_integrity_error_is_409(db, world, mock_request):
    a, ls = world["assignment"], world["learners"]
    await _sub(db, a, ls[0].id)
    await _sub(db, a, ls[1].id)
    with access(), patch.object(db, "commit", new=AsyncMock(side_effect=IntegrityError("x", {}, Exception()))):
        with pytest.raises(HTTPException) as e:
            await pr.next_review(mock_request, db, ls[0], a.assignment_uuid)
    assert e.value.status_code == 409


async def test_unparseable_creation_date_sorts_last():
    subs = [
        AssignmentUserSubmission(user_id=2, assignment_id=1, grade=0, submission_status=S.SUBMITTED,
                                 attempt_number=1, assignmentusersubmission_uuid="a", creation_date="junk", update_date=""),
        AssignmentUserSubmission(user_id=3, assignment_id=1, grade=0, submission_status=S.SUBMITTED,
                                 attempt_number=1, assignmentusersubmission_uuid="b", creation_date=_ts(), update_date=""),
    ]
    assert [s.user_id for s in pr._candidates(subs, [], 1, datetime.now())] == [3, 2]


# ---------------------------------------------------------------------------
# Reading and writing a review
# ---------------------------------------------------------------------------


@pytest.fixture
async def tasks(db, org, course, chapter, activity, assignment):
    common = dict(hint="", assignment_id=assignment.id, org_id=org.id, course_id=course.id,
                  chapter_id=chapter.id, activity_id=activity.id, creation_date=_ts(), update_date=_ts())
    # A short answer marked "manual" is a writing task: shown to reviewers.
    t1 = AssignmentTask(id=201, title="Essay", description="Write", assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
                        contents={"prompt": "Argue", "correct_answers": ["secret"], "explanation": "key",
                                  "match_mode": "manual"},
                        assignment_task_uuid="assignmenttask_essay", order=0, **common)
    t2 = AssignmentTask(id=202, title="Upload", description="File", assignment_type=AssignmentTaskTypeEnum.FILE_SUBMISSION,
                        contents={}, assignment_task_uuid="assignmenttask_file", order=1, **common)
    t3 = AssignmentTask(id=203, title="Quiz", description="Pick", assignment_type=AssignmentTaskTypeEnum.QUIZ,
                        contents={"questions": [{"questionUUID": "q1", "options": [
                            {"optionUUID": "o1", "text": "A", "assigned_right_answer": True}]}]},
                        assignment_task_uuid="assignmenttask_quiz", order=2, **common)
    t4 = AssignmentTask(id=204, title="Number", description="Compute", assignment_type=AssignmentTaskTypeEnum.NUMBER_ANSWER,
                        contents={"prompt": "6x7", "correct_value": 42},
                        assignment_task_uuid="assignmenttask_number", order=3, **common)
    t5 = AssignmentTask(id=205, title="Code", description="Run", assignment_type=AssignmentTaskTypeEnum.CODE,
                        contents={"test_cases": [{"stdin": "", "expectedStdout": "42", "hidden": True}]},
                        assignment_task_uuid="assignmenttask_code", order=4, **common)
    db.add_all([t1, t2, t3, t4, t5])
    await db.commit()
    return t1, t2, t3, t4, t5


async def _answer(db, task, uid, data):
    db.add(AssignmentTaskSubmission(
        assignment_task_submission_uuid=f"ats_{task.id}_{uid}", task_submission=data, grade=77,
        task_submission_grade_feedback="Teacher note", assignment_type=task.assignment_type, user_id=uid,
        activity_id=task.activity_id, course_id=task.course_id, chapter_id=task.chapter_id,
        assignment_task_id=task.id, creation_date=_ts(), update_date=_ts(),
    ))
    await db.commit()


async def test_get_review_strips_keys_and_identity(db, world, tasks, mock_request):
    a, ls = world["assignment"], world["learners"]
    me, peer, other = ls[0], ls[1], ls[2]
    await _sub(db, a, me.id)
    await _sub(db, a, other.id)
    await _sub(db, a, peer.id)
    t1, t2 = tasks[:2]
    await _answer(db, t1, peer.id, {"answer": "My essay"})
    await _answer(db, t2, peer.id, {"fileUUID": f"abc_submission_u{peer.id}.pdf"})
    r = await _review(db, a, me.id, peer.id, status="assigned")
    with access():
        out = await pr.get_review(mock_request, db, me, r.review_uuid)
        text = str(out)
        assert "secret" not in text and "Teacher note" not in text and f"_u{peer.id}" not in text
        assert out["tasks"][0]["task_submission"] == {"answer": "My essay"}
        assert out["tasks"][0]["contents"] == {"prompt": "Argue", "match_mode": "manual"}
        assert out["tasks"][1]["file_url"] == pr.file_path(r.review_uuid, "assignmenttask_file")
        assert out["reviewee"]["user_id"] is None and out["submission_changed"] is False
        assert out["review"]["flagged"] is False and len(out["effective_prompts"]) == 3

        world["settings"].anonymity = "anonymous_reviewer"
        db.add(world["settings"])
        await db.commit()
        out = await pr.get_review(mock_request, db, me, r.review_uuid)
        assert out["reviewee"]["user_id"] == peer.id

        # Someone else can't read it; it looks missing.
        with pytest.raises(HTTPException) as e:
            await pr.get_review(mock_request, db, other, r.review_uuid)
        assert e.value.status_code == 404
        with pytest.raises(HTTPException) as e:
            await pr.get_review(mock_request, db, me, "peerreview_missing")
        assert e.value.status_code == 404
        with pytest.raises(HTTPException) as e:
            await pr.get_review(mock_request, db, AnonymousUser(), r.review_uuid)
        assert e.value.status_code == 401


async def test_get_review_after_retry_hides_new_attempt(db, world, tasks, mock_request):
    a, ls = world["assignment"], world["learners"]
    await _sub(db, a, ls[0].id)
    sub = await _sub(db, a, ls[1].id, attempt=2, status=S.PENDING)
    await _answer(db, tasks[0], ls[1].id, {"answer": "half-written second attempt"})
    r = await _review(db, a, ls[0].id, ls[1].id, status="submitted", attempt=1)
    with access():
        out = await pr.get_review(mock_request, db, ls[0], r.review_uuid)
    assert out["submission_changed"] is True
    assert all(t["task_submission"] is None for t in out["tasks"])
    assert sub.attempt_number == 2


async def test_review_disabled_gate(db, world, mock_request):
    a, ls = world["assignment"], world["learners"]
    r = await _review(db, a, ls[0].id, ls[1].id, status="assigned")
    world["settings"].enabled = False
    db.add(world["settings"])
    await db.commit()
    with access():
        with pytest.raises(HTTPException) as e:
            await pr.get_review(mock_request, db, ls[0], r.review_uuid)
    assert e.value.status_code == 404


async def test_save_review_draft_submit_and_notify(db, world, mock_request):
    a, ls = world["assignment"], world["learners"]
    me, peer = ls[0], ls[1]
    await _sub(db, a, me.id)
    await _sub(db, a, peer.id)
    r = await _review(db, a, me.id, peer.id, status="assigned", scores={})
    with access():
        draft = await pr.save_review(mock_request, db, me, r.review_uuid,
                                     PeerReviewSaveBody(scores={"c1": "l1"}, comments={"strength": "short"}))
        assert draft["status"] == "assigned" and draft["scores"] == {"c1": "l1"}
        with pytest.raises(HTTPException) as e:
            await pr.save_review(mock_request, db, me, r.review_uuid,
                                 PeerReviewSaveBody(scores={"c1": "l1"}, comments=GOOD_COMMENTS, submit=True))
        assert e.value.status_code == 422
        done = await pr.save_review(mock_request, db, me, r.review_uuid, PeerReviewSaveBody(
            scores=FULL, comments=GOOD_COMMENTS, criterion_comments={"c1": "Nice"}, submit=True))
        assert done["status"] == "submitted" and done["submitted_at"] and done["percentage"] == 100.0
        with pytest.raises(HTTPException) as e:
            await pr.save_review(mock_request, db, me, r.review_uuid, PeerReviewSaveBody(scores=FULL, submit=True))
        assert e.value.status_code == 409
    notes = (await db.execute(select(Notification).where(Notification.user_id == peer.id))).scalars().all()
    assert [n.type for n in notes] == ["peer_review_received"]
    assert notes[0].actor_id is None and f"First{me.id}" not in str(notes[0].data)


async def test_save_review_withdrawn_and_superseded(db, world, mock_request):
    a, ls = world["assignment"], world["learners"]
    me = ls[0]
    await _sub(db, a, me.id)
    peer_sub = await _sub(db, a, ls[1].id)
    gone = await _review(db, a, me.id, ls[2].id, status="discarded")
    open_r = await _review(db, a, me.id, ls[1].id, status="assigned")
    with access():
        with pytest.raises(HTTPException) as e:
            await pr.save_review(mock_request, db, me, gone.review_uuid, PeerReviewSaveBody())
        assert e.value.status_code == 409
        peer_sub.attempt_number = 2
        db.add(peer_sub)
        await db.commit()
        with pytest.raises(HTTPException) as e:
            await pr.save_review(mock_request, db, me, open_r.review_uuid, PeerReviewSaveBody())
        assert e.value.status_code == 409
    await db.refresh(open_r)
    assert open_r.status == "discarded"


async def test_save_review_without_activity_skips_notification(db, world, mock_request):
    a, ls = world["assignment"], world["learners"]
    await _sub(db, a, ls[0].id)
    await _sub(db, a, ls[1].id)
    r = await _review(db, a, ls[0].id, ls[1].id, status="assigned")
    a.activity_id = 9999
    db.add(a)
    await db.commit()
    with access(), patch("src.services.feature_notifications.notify_peer_review_received", new=AsyncMock()) as notify:
        out = await pr.save_review(mock_request, db, ls[0], r.review_uuid,
                                   PeerReviewSaveBody(scores=FULL, comments=GOOD_COMMENTS, submit=True))
    assert out["status"] == "submitted"
    notify.assert_not_called()


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------


async def test_review_file_access(db, world, tasks, mock_request, org):
    a, ls = world["assignment"], world["learners"]
    me, peer, other = ls[0], ls[1], ls[2]
    await _sub(db, a, me.id)
    await _sub(db, a, other.id)
    peer_sub = await _sub(db, a, peer.id)
    await _answer(db, tasks[1], peer.id, {"fileUUID": f"abc_submission_u{peer.id}.pdf"})
    await _answer(db, tasks[0], peer.id, {"fileUUID": "noext"})
    r = await _review(db, a, me.id, peer.id, status="assigned")
    cal = await _review(db, a, me.id, None, kind="calibration", sample="s1")
    read = AsyncMock(return_value=b"%PDF")
    with access(instructors=[world["admin"].id]), patch("src.services.utils.upload_content.read_content", new=read):
        content, name = await pr.get_review_file(mock_request, db, me, r.review_uuid, "assignmenttask_file")
        assert content == b"%PDF" and name == "submission-2.pdf"
        assert read.call_args.args[3] == f"abc_submission_u{peer.id}.pdf"
        _, name = await pr.get_review_file(mock_request, db, world["admin"], r.review_uuid, "assignmenttask_essay")
        assert name == "submission-1"

        for user, review_uuid, task_uuid, code in (
            (AnonymousUser(), r.review_uuid, "assignmenttask_file", 401),
            (APITokenUser(org_id=org.id), r.review_uuid, "assignmenttask_file", 403),
            (me, cal.review_uuid, "assignmenttask_file", 404),
            (other, r.review_uuid, "assignmenttask_file", 404),
            (me, r.review_uuid, "assignmenttask_missing", 404),
        ):
            with pytest.raises(HTTPException) as e:
                await pr.get_review_file(mock_request, db, user, review_uuid, task_uuid)
            assert e.value.status_code == code

        peer_sub.attempt_number = 2
        db.add(peer_sub)
        await db.commit()
        with pytest.raises(HTTPException) as e:
            await pr.get_review_file(mock_request, db, me, r.review_uuid, "assignmenttask_file")
        assert e.value.status_code == 404


async def test_review_file_wrong_owner_and_missing_activity(db, world, tasks, mock_request):
    a, ls = world["assignment"], world["learners"]
    admin = world["admin"]
    await _sub(db, a, ls[1].id)
    await _answer(db, tasks[1], ls[1].id, {"fileUUID": "abc_submission_u999.pdf"})
    await _answer(db, tasks[0], ls[1].id, {"fileUUID": f"ok_submission_u{ls[1].id}.pdf"})
    r = await _review(db, a, ls[0].id, ls[1].id, status="assigned")
    with access(instructors=[admin.id]):
        with pytest.raises(HTTPException) as e:
            await pr.get_review_file(mock_request, db, admin, r.review_uuid, "assignmenttask_file")
        assert e.value.status_code == 404
        a.activity_id = 9999
        db.add(a)
        await db.commit()
        with pytest.raises(HTTPException) as e:
            await pr.get_review_file(mock_request, db, admin, r.review_uuid, "assignmenttask_essay")
        assert e.value.status_code == 404


# ---------------------------------------------------------------------------
# Learner state, unlock, scores
# ---------------------------------------------------------------------------


async def test_learner_state_locked_then_unlocked_by_reviews(db, world, mock_request):
    a, ls = world["assignment"], world["learners"]
    me = ls[0]
    for learner in ls:
        await _sub(db, a, learner.id)
    world["settings"].min_reviews_for_score = 2
    db.add(world["settings"])
    await db.commit()
    await _review(db, a, ls[1].id, me.id, scores={"c1": "l2", "c2": "e2"})
    await _review(db, a, ls[2].id, me.id, scores={"c1": "l0", "c2": "e0"}, minutes_ago=5)
    await _review(db, a, ls[3].id, me.id, status="discarded")
    with access():
        state = await pr.get_learner_state(mock_request, db, me, a.assignment_uuid)
        assert state["enabled"] is True and state["my_submission_status"] == "SUBMITTED"
        assert state["steps"]["reviews"] == {"required": 3, "configured": 3, "done": 0,
                                             "open_review_uuid": None, "available": True}
        assert state["steps"]["feedback"] == {"unlocked": False, "reason": None, "count": 2}
        assert state["received"] == [] and state["peer_score"] is None

        for peer in ls[1:4]:
            await _review(db, a, me.id, peer.id)
        state = await pr.get_learner_state(mock_request, db, me, a.assignment_uuid)
        assert state["steps"]["feedback"] == {"unlocked": True, "reason": "reviews", "count": 2}
        labels = [r["reviewer_label"] for r in state["received"]]
        assert labels == ["Reviewer 1", "Reviewer 2"]
        assert all(r["reviewer"]["user_id"] is None for r in state["received"])
        assert f"First{ls[1].id}" not in str(state["received"])
        assert state["peer_score"]["review_count"] == 2 and state["peer_score"]["spread"] == 100.0
        assert state["given_stats"] == {"done": 3, "avg_helpfulness": None}

        world["settings"].anonymity = "named"
        db.add(world["settings"])
        await db.commit()
        state = await pr.get_learner_state(mock_request, db, me, a.assignment_uuid)
        assert state["received"][0]["reviewer"]["user_id"] == ls[1].id
        assert state["received"][0]["reviewer_label"] is None


async def test_learner_state_small_class_caps_required(db, world, mock_request):
    a, ls = world["assignment"], world["learners"]
    await _sub(db, a, ls[0].id)
    await _sub(db, a, ls[1].id)
    await _review(db, a, ls[0].id, ls[1].id)
    with access():
        state = await pr.get_learner_state(mock_request, db, ls[0], a.assignment_uuid)
    assert state["steps"]["reviews"]["required"] == 1 and state["steps"]["reviews"]["configured"] == 3
    assert state["steps"]["feedback"]["unlocked"] is True
    assert state["steps"]["reviews"]["available"] is False


async def test_learner_state_due_date_unlock_and_no_submission(db, world, mock_request):
    a, ls = world["assignment"], world["learners"]
    for learner in ls[:4]:
        await _sub(db, a, learner.id)
    world["settings"].review_due_date = "2000-01-01"
    db.add(world["settings"])
    await db.commit()
    with access():
        state = await pr.get_learner_state(mock_request, db, ls[0], a.assignment_uuid)
        assert state["steps"]["feedback"]["reason"] == "due_date"
        state = await pr.get_learner_state(mock_request, db, ls[4], a.assignment_uuid)
        assert state["my_submission_status"] is None and state["attempt_number"] is None
        assert state["received"] == [] and state["steps"]["reviews"]["available"] is False


async def test_learner_state_open_review_and_retry_uses_current_attempt(db, world, mock_request):
    a, ls = world["assignment"], world["learners"]
    me = ls[0]
    my_sub = await _sub(db, a, me.id)
    await _sub(db, a, ls[1].id)
    open_r = await _review(db, a, me.id, ls[1].id, status="assigned")
    await _review(db, a, ls[1].id, me.id, attempt=1)
    world["settings"].require_reviews_to_see_feedback = False
    db.add(world["settings"])
    await db.commit()
    with access():
        state = await pr.get_learner_state(mock_request, db, me, a.assignment_uuid)
        assert state["steps"]["reviews"]["open_review_uuid"] == open_r.review_uuid
        assert state["steps"]["reviews"]["available"] is True
        assert state["steps"]["feedback"] == {"unlocked": True, "reason": None, "count": 1}
        my_sub.attempt_number = 2
        db.add(my_sub)
        await db.commit()
        state = await pr.get_learner_state(mock_request, db, me, a.assignment_uuid)
        assert state["steps"]["feedback"]["count"] == 0 and state["received"] == []


# ---------------------------------------------------------------------------
# Self review, calibration, reflection
# ---------------------------------------------------------------------------


async def test_self_review_upsert_and_rules(db, world, mock_request):
    a, me = world["assignment"], world["learners"][0]
    with access():
        with pytest.raises(HTTPException) as e:
            await pr.submit_self_review(mock_request, db, me, a.assignment_uuid, PeerSelfReviewBody(scores=FULL))
        assert e.value.status_code == 403
        sub = await _sub(db, a, me.id)
        first = await pr.submit_self_review(mock_request, db, me, a.assignment_uuid,
                                            PeerSelfReviewBody(scores=FULL, comments={"strength": "ok"}))
        assert first["kind"] == "self" and first["status"] == "submitted"
        sub.attempt_number = 2
        db.add(sub)
        await db.commit()
        state = await pr.get_learner_state(mock_request, db, me, a.assignment_uuid)
        assert state["steps"]["self"]["done"] is False and state["self_review"] is None
        second = await pr.submit_self_review(mock_request, db, me, a.assignment_uuid,
                                             PeerSelfReviewBody(scores={"c1": "l0", "c2": "e0"}))
        assert second["review_uuid"] == first["review_uuid"] and second["attempt_number"] == 2
        state = await pr.get_learner_state(mock_request, db, me, a.assignment_uuid)
        assert state["steps"]["self"]["done"] is True and state["self_review"]["percentage"] == 0.0

        world["settings"].self_review_enabled = False
        db.add(world["settings"])
        await db.commit()
        with pytest.raises(HTTPException) as e:
            await pr.submit_self_review(mock_request, db, me, a.assignment_uuid, PeerSelfReviewBody(scores=FULL))
        assert e.value.status_code == 400


async def test_calibration_flow(db, world, mock_request):
    a, me = world["assignment"], world["learners"][0]
    with access():
        with pytest.raises(HTTPException) as e:
            await pr.submit_calibration(mock_request, db, me, a.assignment_uuid, "s1", PeerCalibrationBody(scores=FULL))
        assert e.value.status_code == 400
        assert await pr.list_calibration(mock_request, db, me, a.assignment_uuid) == {"enabled": False, "samples": []}

        world["settings"].calibration_enabled = True
        world["settings"].calibration_samples = SAMPLES
        db.add(world["settings"])
        await db.commit()
        listed = await pr.list_calibration(mock_request, db, me, a.assignment_uuid)
        assert listed["samples"] == [{"id": "s1", "title": "Sample one", "content": "Text", "done": False,
                                      "my_scores": None, "explanation": None}]
        with pytest.raises(HTTPException) as e:
            await pr.submit_calibration(mock_request, db, me, a.assignment_uuid, "nope", PeerCalibrationBody(scores=FULL))
        assert e.value.status_code == 404
        result = await pr.submit_calibration(mock_request, db, me, a.assignment_uuid, "s1",
                                             PeerCalibrationBody(scores={"c1": "l2", "c2": "e2"}))
        assert result["explanation"] == "Why"
        assert result["criteria"][0] == {"criterion_id": "c1", "title": "Clarity", "your_level_id": "l2",
                                         "instructor_level_id": "l2", "your_points": 4.0,
                                         "instructor_points": 4.0, "match": True}
        assert result["criteria"][1]["match"] is False and result["criteria"][1]["your_points"] == 10.0
        with pytest.raises(HTTPException) as e:
            await pr.submit_calibration(mock_request, db, me, a.assignment_uuid, "s1", PeerCalibrationBody(scores=FULL))
        assert e.value.status_code == 409
        listed = await pr.list_calibration(mock_request, db, me, a.assignment_uuid)
        assert listed["samples"][0]["done"] is True and listed["samples"][0]["scores"] == {"c1": "l2", "c2": "e1"}
        state = await pr.get_learner_state(mock_request, db, me, a.assignment_uuid)
        assert state["steps"]["calibration"] == {"enabled": True, "total": 1, "done": 1}


async def test_calibration_race_integrity_error(db, world, mock_request):
    a, me = world["assignment"], world["learners"][0]
    world["settings"].calibration_enabled = True
    world["settings"].calibration_samples = SAMPLES
    db.add(world["settings"])
    await db.commit()
    with access(), patch.object(db, "commit", new=AsyncMock(side_effect=IntegrityError("x", {}, Exception()))):
        with pytest.raises(HTTPException) as e:
            await pr.submit_calibration(mock_request, db, me, a.assignment_uuid, "s1", PeerCalibrationBody(scores=FULL))
    assert e.value.status_code == 409


def test_calibration_comparison_unscored():
    out = pr.calibration_comparison({"id": "s", "scores": {}}, {}, RUBRIC)
    assert out["criteria"][0]["your_points"] is None and out["criteria"][0]["instructor_points"] is None


async def test_reflection(db, world, mock_request):
    a, me = world["assignment"], world["learners"][0]
    with access():
        with pytest.raises(HTTPException) as e:
            await pr.save_reflection(mock_request, db, me, a.assignment_uuid, PeerReflectionBody(plan="x"))
        assert e.value.status_code == 403
        await _sub(db, a, me.id)
        out = await pr.save_reflection(mock_request, db, me, a.assignment_uuid, PeerReflectionBody(plan="Fix intro"))
        assert out["plan"] == "Fix intro"
        out = await pr.save_reflection(mock_request, db, me, a.assignment_uuid, PeerReflectionBody(plan="Fix outro"))
        assert out["plan"] == "Fix outro"
        rows = (await db.execute(select(AssignmentPeerReflection))).scalars().all()
        assert len(rows) == 1
        state = await pr.get_learner_state(mock_request, db, me, a.assignment_uuid)
        assert state["reflection"]["plan"] == "Fix outro"
        world["settings"].revision_plan_enabled = False
        db.add(world["settings"])
        await db.commit()
        with pytest.raises(HTTPException) as e:
            await pr.save_reflection(mock_request, db, me, a.assignment_uuid, PeerReflectionBody(plan="x"))
        assert e.value.status_code == 400


# ---------------------------------------------------------------------------
# Rate and flag
# ---------------------------------------------------------------------------


async def test_rate_and_flag(db, world, mock_request):
    a, ls = world["assignment"], world["learners"]
    me, reviewer = ls[0], ls[1]
    await _sub(db, a, me.id)
    await _sub(db, a, reviewer.id)
    r = await _review(db, a, reviewer.id, me.id)
    with access():
        with pytest.raises(HTTPException) as e:  # feedback still locked
            await pr.rate_review(mock_request, db, me, r.review_uuid, PeerRateBody(helpfulness=4))
        assert e.value.status_code == 403
        await _review(db, a, me.id, reviewer.id)
        out = await pr.rate_review(mock_request, db, me, r.review_uuid, PeerRateBody(helpfulness=4, note=" Useful "))
        assert out["helpfulness"] == 4 and out["helpfulness_note"] == "Useful"
        assert out["reviewer_label"] == "Reviewer 1" and out["reviewer"]["user_id"] is None

        with pytest.raises(HTTPException) as e:  # the reviewer can't rate their own review
            await pr.rate_review(mock_request, db, reviewer, r.review_uuid, PeerRateBody(helpfulness=5))
        assert e.value.status_code == 404
        with pytest.raises(HTTPException) as e:
            await pr.rate_review(mock_request, db, AnonymousUser(), r.review_uuid, PeerRateBody(helpfulness=5))
        assert e.value.status_code == 401

        with pytest.raises(HTTPException) as e:
            await pr.flag_review(mock_request, db, me, r.review_uuid, PeerFlagBody(reason="   "))
        assert e.value.status_code == 422
        out = await pr.flag_review(mock_request, db, me, r.review_uuid, PeerFlagBody(reason="Rude and off-topic"))
        assert out["flagged"] is True and out["flag_reason"] == "Rude and off-topic"
        await pr.flag_review(mock_request, db, me, r.review_uuid, PeerFlagBody(reason="Still rude"))

        # The reviewer's own view of their review never shows the flag.
        detail = await pr.get_review(mock_request, db, reviewer, r.review_uuid)
        assert detail["review"]["flagged"] is False and detail["review"]["flag_reason"] is None

        world["settings"].helpfulness_enabled = False
        db.add(world["settings"])
        await db.commit()
        with pytest.raises(HTTPException) as e:
            await pr.rate_review(mock_request, db, me, r.review_uuid, PeerRateBody(helpfulness=4))
        assert e.value.status_code == 400

    flags = (await db.execute(select(Notification).where(Notification.type == "peer_review_flagged"))).scalars().all()
    assert [n.user_id for n in flags] == [world["admin"].id]  # once, to the admin fallback

    assigned = await _review(db, a, ls[2].id, me.id, status="assigned")
    with access():
        with pytest.raises(HTTPException) as e:
            await pr.rate_review(mock_request, db, me, assigned.review_uuid, PeerRateBody(helpfulness=3))
    assert e.value.status_code == 409


# ---------------------------------------------------------------------------
# Instructor views
# ---------------------------------------------------------------------------


async def test_overview_and_quality_metrics(db, world, mock_request):
    a, ls, admin = world["assignment"], world["learners"], world["admin"]
    s = world["settings"]
    s.calibration_samples = SAMPLES
    s.min_reviews_for_score = 2
    db.add(s)
    await db.commit()
    for learner in ls[:4]:
        await _sub(db, a, learner.id)
    await _sub(db, a, ls[4].id, status=S.PENDING)
    # Reviews of learner 0: 100% and 0% from l1 and l2, 50% from l3.
    await _review(db, a, ls[1].id, ls[0].id, scores={"c1": "l2", "c2": "e2"}, helpfulness=5)
    await _review(db, a, ls[2].id, ls[0].id, scores={"c1": "l0", "c2": "e0"}, helpfulness=1, flagged=True,
                  flag_reason="Lazy")
    await _review(db, a, ls[3].id, ls[0].id, scores={"c1": "l1", "c2": "e1"})
    await _review(db, a, ls[0].id, ls[1].id, status="assigned")
    await _review(db, a, ls[0].id, ls[0].id, kind="self", scores={"c1": "l2", "c2": "e1"})
    await _review(db, a, ls[1].id, None, kind="calibration", sample="s1", scores={"c1": "l0", "c2": "e1"})
    await _review(db, a, ls[2].id, None, kind="calibration", sample="gone", scores={"c1": "l0"})
    await _review(db, a, ls[3].id, ls[1].id, scores={"zz": "bad"})  # unscoreable: no bias data
    with access(instructors=[admin.id]):
        out = await pr.get_overview(mock_request, db, admin, a.assignment_uuid)
    assert out["totals"] == {"submitted_learners": 4, "reviews_submitted": 4, "reviews_assigned": 1,
                             "flagged": 1, "below_target": 3}
    row0 = next(r for r in out["submissions"] if r["user_id"] == ls[0].id)
    assert row0["user"]["first_name"] == f"First{ls[0].id}"
    assert row0["reviews_received"] == 3 and row0["peer_score"]["percentage"] == 50.0
    assert row0["spread"] == 100.0 and row0["self_score"] == pytest.approx(64.29, abs=0.01)
    assert row0["flagged_count"] == 1 and row0["submission_status"] == "SUBMITTED"
    reviewers = {r["user_id"]: r for r in out["reviewers"]}
    assert reviewers[ls[1].id]["avg_helpfulness"] == 5.0
    assert reviewers[ls[1].id]["bias"] == 75.0  # |100 - median(0, 50)|
    assert reviewers[ls[1].id]["calibration_deviation"] == 2.0  # |0-4| and |5-5|
    assert reviewers[ls[2].id]["calibration_deviation"] is None
    assert reviewers[ls[3].id]["bias"] == 0.0  # 50% vs median(100, 0)
    assert reviewers[ls[0].id]["reviews_done"] == 0 and reviewers[ls[0].id]["reviews_required"] == 3
    assert out["flagged"][0]["flag_reason"] == "Lazy" and out["flagged"][0]["reviewer"]["user_id"] == ls[2].id


async def test_overview_without_settings(db, org, assignment, admin_user, mock_request):
    with access(instructors=[admin_user.id]):
        out = await pr.get_overview(mock_request, db, admin_user, assignment.assignment_uuid)
    assert out["totals"]["submitted_learners"] == 0 and out["submissions"] == []
    assert pr._calibration_deviation(1, [], None) is None


async def test_submission_detail_discard_restore(db, world, mock_request, org):
    a, ls, admin = world["assignment"], world["learners"], world["admin"]
    me = ls[0]
    await _sub(db, a, me.id)
    r1 = await _review(db, a, ls[1].id, me.id)
    r2 = await _review(db, a, ls[2].id, me.id, status="assigned")
    selfr = await _review(db, a, me.id, me.id, kind="self")
    db.add(AssignmentPeerReflection(assignment_id=a.id, org_id=org.id, user_id=me.id, plan="Plan",
                                    creation_date=_ts(), update_date=_ts()))
    await db.commit()
    with access(instructors=[admin.id]):
        with pytest.raises(HTTPException) as e:
            await pr.get_submission_detail(mock_request, db, admin, a.assignment_uuid, ls[4].id)
        assert e.value.status_code == 404
        detail = await pr.get_submission_detail(mock_request, db, admin, a.assignment_uuid, me.id)
        assert {r["review_uuid"] for r in detail["reviews"]} == {r1.review_uuid, r2.review_uuid}
        assert detail["reviews"][0]["reviewer"]["first_name"] == f"First{ls[1].id}"
        assert detail["self_review"]["review_uuid"] == selfr.review_uuid
        assert detail["reflection"]["plan"] == "Plan" and detail["peer_score"] is None

        out = await pr.discard_review(mock_request, db, admin, a.assignment_uuid, r1.review_uuid,
                                      PeerDiscardBody(reason="Off topic"))
        assert out["status"] == "discarded" and out["discarded_by"] == admin.id and out["discard_reason"] == "Off topic"
        out = await pr.restore_review(mock_request, db, admin, a.assignment_uuid, r1.review_uuid)
        assert out["status"] == "submitted" and out["discarded_by"] is None
        with pytest.raises(HTTPException) as e:
            await pr.restore_review(mock_request, db, admin, a.assignment_uuid, r1.review_uuid)
        assert e.value.status_code == 409

        token = APITokenUser(id=admin.id, org_id=org.id)
        out = await pr.discard_review(mock_request, db, token, a.assignment_uuid, r2.review_uuid, PeerDiscardBody())
        assert out["discarded_by"] is None and out["discard_reason"] is None
        out = await pr.restore_review(mock_request, db, admin, a.assignment_uuid, r2.review_uuid)
        assert out["status"] == "assigned"

        with pytest.raises(HTTPException) as e:
            await pr.discard_review(mock_request, db, admin, a.assignment_uuid, selfr.review_uuid, PeerDiscardBody())
        assert e.value.status_code == 400
        with pytest.raises(HTTPException) as e:
            await pr.discard_review(mock_request, db, admin, a.assignment_uuid, "peerreview_x", PeerDiscardBody())
        assert e.value.status_code == 404


async def test_peer_review_never_touches_grades(db, world, mock_request):
    a, ls = world["assignment"], world["learners"]
    subs = [await _sub(db, a, learner.id, status=S.GRADED) for learner in ls[:2]]
    before = [(s.grade, s.submission_status, s.attempt_number) for s in subs]
    with access():
        out = await pr.next_review(mock_request, db, ls[0], a.assignment_uuid)
        await pr.save_review(mock_request, db, ls[0], out["review"]["review_uuid"],
                             PeerReviewSaveBody(scores=FULL, comments=GOOD_COMMENTS, submit=True))
    for s in subs:
        await db.refresh(s)
    assert [(s.grade, s.submission_status, s.attempt_number) for s in subs] == before


# ---------------------------------------------------------------------------
# Objective answers and reviewers who started a retry
# ---------------------------------------------------------------------------


def test_is_auto_graded_rules():
    def task(kind, contents):
        return AssignmentTask(title="t", description="", hint="", assignment_type=kind, contents=contents,
                              assignment_task_uuid="x", creation_date="", update_date="")

    T = AssignmentTaskTypeEnum
    assert pr.is_auto_graded(task(T.QUIZ, {}))
    assert pr.is_auto_graded(task(T.NUMBER_ANSWER, {}))
    assert pr.is_auto_graded(task(T.SHORT_ANSWER, {"correct_answers": ["Paris"]}))
    assert pr.is_auto_graded(task(T.SHORT_ANSWER, {"correct_answers": ["Paris"], "match_mode": "regex"}))
    assert not pr.is_auto_graded(task(T.SHORT_ANSWER, {"correct_answers": ["Paris"], "match_mode": "manual"}))
    assert not pr.is_auto_graded(task(T.SHORT_ANSWER, {"correct_answers": ["", "  "]}))
    assert not pr.is_auto_graded(task(T.SHORT_ANSWER, {"prompt": "Write an essay"}))
    assert pr.is_auto_graded(task(T.FORM, {"questions": [{"blanks": [{"correctAnswer": "x"}]}]}))
    assert not pr.is_auto_graded(task(T.FORM, {"questions": [{"blanks": [{"correctAnswer": " "}]}, "junk"]}))
    assert pr.is_auto_graded(task(T.CODE, {"test_cases": [{"stdin": "1"}]}))
    assert not pr.is_auto_graded(task(T.CODE, {"test_cases": []}))
    assert not pr.is_auto_graded(task(T.FILE_SUBMISSION, {}))
    assert not pr.is_auto_graded(task(T.CUSTOM, None))


async def test_objective_answers_hidden_from_reviewer_not_instructor(db, world, tasks, mock_request):
    a, ls, admin = world["assignment"], world["learners"], world["admin"]
    me, peer = ls[0], ls[1]
    await _sub(db, a, me.id)
    await _sub(db, a, peer.id)
    essay, _upload, quiz, number, code = tasks
    await _answer(db, essay, peer.id, {"answer": "My essay"})
    await _answer(db, quiz, peer.id, {"answers": [{"optionUUID": "o1"}]})
    await _answer(db, number, peer.id, {"answer": "42"})
    await _answer(db, code, peer.id, {"source": "print(42)", "fileUUID": f"c_submission_u{peer.id}.py"})
    r = await _review(db, a, me.id, peer.id, status="assigned")
    read = AsyncMock(return_value=b"print(42)")
    with access(instructors=[admin.id]), patch("src.services.utils.upload_content.read_content", new=read):
        out = await pr.get_review(mock_request, db, me, r.review_uuid)
        by_uuid = {t["assignment_task_uuid"]: t for t in out["tasks"]}
        assert by_uuid["assignmenttask_essay"]["task_submission"] == {"answer": "My essay"}
        assert by_uuid["assignmenttask_essay"]["answer_hidden"] is False
        for uuid in ("assignmenttask_quiz", "assignmenttask_number", "assignmenttask_code"):
            assert by_uuid[uuid]["task_submission"] is None and by_uuid[uuid]["answer_hidden"] is True
            assert by_uuid[uuid]["file_url"] is None
        assert "print(42)" not in str(out) and "42'" not in str(out)
        assert "assigned_right_answer" not in str(by_uuid["assignmenttask_quiz"]["contents"])

        # The reviewer can't pull the hidden task's file either; an instructor can.
        with pytest.raises(HTTPException) as e:
            await pr.get_review_file(mock_request, db, me, r.review_uuid, "assignmenttask_code")
        assert e.value.status_code == 404
        content, name = await pr.get_review_file(mock_request, db, admin, r.review_uuid, "assignmenttask_code")
        assert content == b"print(42)" and name == "submission-5.py"


async def test_reviewer_who_retries_is_blocked_until_resubmitting(db, world, tasks, mock_request):
    a, ls = world["assignment"], world["learners"]
    me, peer = ls[0], ls[1]
    my_sub = await _sub(db, a, me.id)
    await _sub(db, a, peer.id)
    await _answer(db, tasks[0], peer.id, {"answer": "Peer essay"})
    await _answer(db, tasks[1], peer.id, {"fileUUID": f"f_submission_u{peer.id}.pdf"})
    r = await _review(db, a, me.id, peer.id, status="assigned")
    my_sub.submission_status = S.PENDING
    my_sub.attempt_number = 2
    db.add(my_sub)
    await db.commit()
    with access(), patch("src.services.utils.upload_content.read_content", new=AsyncMock(return_value=b"x")):
        for call in (
            pr.get_review(mock_request, db, me, r.review_uuid),
            pr.save_review(mock_request, db, me, r.review_uuid, PeerReviewSaveBody()),
            pr.get_review_file(mock_request, db, me, r.review_uuid, "assignmenttask_file"),
            pr.next_review(mock_request, db, me, a.assignment_uuid),
        ):
            with pytest.raises(HTTPException) as e:
                await call
            assert e.value.status_code == 409
            assert e.value.detail == "Hand in your new attempt before reviewing again"
        state = await pr.get_learner_state(mock_request, db, me, a.assignment_uuid)
        assert state["steps"]["reviews"]["available"] is False

        my_sub.submission_status = S.SUBMITTED
        db.add(my_sub)
        await db.commit()
        out = await pr.get_review(mock_request, db, me, r.review_uuid)
        assert out["tasks"][0]["task_submission"] == {"answer": "Peer essay"}
