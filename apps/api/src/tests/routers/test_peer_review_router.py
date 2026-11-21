"""Peer review router: every endpoint wired, shapes, the file response."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.peer_reviews import AssignmentPeerReview
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.routers.courses.peer_review import router as peer_review_router
from src.security.auth import get_current_user

M = "src.services.courses.activities.peer_review"
RUBRIC = [
    {"id": "c1", "title": "Clarity", "levels": [
        {"id": "l0", "points": 0, "label": "Weak"}, {"id": "l1", "points": 2, "label": "Strong"}]},
]
SAMPLES = [{"id": "s1", "title": "Sample", "content": "Text", "scores": {"c1": "l1"}, "explanation": "Because"}]
LONG = "A comment that is clearly long enough to pass the minimum."


def _now() -> str:
    return str(datetime.now())


@pytest.fixture
async def setup(db, org, user_role, admin_user, course, chapter, activity):
    a = Assignment(
        id=1, title="Essay", description="", due_date="2030-01-01", published=True,
        grading_type=GradingTypeEnum.NUMERIC, org_id=org.id, course_id=course.id, chapter_id=chapter.id,
        activity_id=activity.id, assignment_uuid="assignment_pr", creation_date=_now(), update_date=_now(),
    )
    db.add(a)
    learners = []
    for uid in (11, 12):
        db.add(User(id=uid, username=f"u{uid}", first_name=f"F{uid}", last_name="L", email=f"u{uid}@x.com",
                    password="x", user_uuid=f"user_{uid}", creation_date=_now(), update_date=_now()))
        db.add(UserOrganization(user_id=uid, org_id=org.id, role_id=user_role.id, creation_date=_now(), update_date=_now()))
        db.add(AssignmentUserSubmission(
            user_id=uid, assignment_id=1, grade=0, submission_status=AssignmentUserSubmissionStatus.SUBMITTED,
            attempt_number=1, assignmentusersubmission_uuid=f"aus_{uid}", creation_date=_now(), update_date=_now()))
        learners.append(PublicUser(id=uid, username=f"u{uid}", first_name=f"F{uid}", last_name="L",
                                   email=f"u{uid}@x.com", user_uuid=f"user_{uid}"))
    task = AssignmentTask(
        id=1, title="Upload", description="", hint="", assignment_type=AssignmentTaskTypeEnum.FILE_SUBMISSION,
        contents={}, assignment_id=1, org_id=org.id, course_id=course.id, chapter_id=chapter.id,
        activity_id=activity.id, assignment_task_uuid="assignmenttask_up", order=0,
        creation_date=_now(), update_date=_now(),
    )
    db.add(task)
    db.add(AssignmentTaskSubmission(
        assignment_task_submission_uuid="ats_1", task_submission={"fileUUID": "x_submission_u12.pdf"}, grade=0,
        task_submission_grade_feedback="", assignment_type=AssignmentTaskTypeEnum.FILE_SUBMISSION, user_id=12,
        activity_id=activity.id, course_id=course.id, chapter_id=chapter.id, assignment_task_id=1,
        creation_date=_now(), update_date=_now()))
    await db.commit()
    return {"admin": admin_user, "learners": learners}


@pytest.fixture
def state():
    return {"user": None}


@pytest.fixture
async def client(db, state):
    app = FastAPI()
    app.include_router(peer_review_router, prefix="/assignments")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: state["user"]

    async def is_instructor(request, user, course_uuid, db_session):
        return getattr(user, "id", None) == 1

    with patch(f"{M}.authorize_assignment_access", new=AsyncMock()), \
         patch(f"{M}._is_assignment_instructor", new=AsyncMock(side_effect=is_instructor)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c


async def test_full_flow_through_http(client, setup, state, db):
    admin, (l11, l12) = setup["admin"], setup["learners"]
    base = "/assignments/assignment_pr/peer-review"

    state["user"] = l11
    r = await client.get(f"{base}/me")
    assert r.status_code == 404  # off until enabled

    state["user"] = admin
    r = await client.put(f"{base}/settings", json={
        "enabled": True, "rubric": RUBRIC, "calibration_samples": SAMPLES, "reviews_required": 1,
        "min_reviews_for_score": 1, "anonymity": "double_blind",
    })
    assert r.status_code == 200 and r.json()["enabled"] is True
    r = await client.put(f"{base}/settings", json={"reviews_required": 0})
    assert r.status_code == 422
    assert (await client.get(f"{base}/settings")).json()["calibration_samples"][0]["scores"] == {"c1": "l1"}

    for learner in (l11, l12):
        state["user"] = learner
        assert (await client.get(f"{base}/settings")).json()["calibration_samples"][0].get("scores") is None
        r = await client.post(f"{base}/me/next")
        assert r.status_code == 409  # practice first
        r = await client.get(f"{base}/me/calibration")
        assert r.json()["samples"][0]["done"] is False
        r = await client.post(f"{base}/me/calibration/s1", json={"scores": {"c1": "l1"}})
        assert r.status_code == 200 and r.json()["criteria"][0]["match"] is True
        r = await client.post(f"{base}/me/self", json={"scores": {"c1": "l1"}, "comments": {}})
        assert r.status_code == 200 and r.json()["kind"] == "self"

    state["user"] = l11
    r = await client.post(f"{base}/me/next")
    review_uuid = r.json()["review"]["review_uuid"]
    assert r.json()["reason"] is None

    r = await client.get(f"/assignments/peer-review/reviews/{review_uuid}")
    body = r.json()
    assert r.status_code == 200 and body["reviewee"]["user_id"] is None
    assert "x_submission_u12" not in r.text
    file_url = body["tasks"][0]["file_url"]

    with patch("src.services.utils.upload_content.read_content", new=AsyncMock(return_value=b"%PDF-1.4")):
        r = await client.get(f"/{file_url}")
    assert r.status_code == 200 and r.content == b"%PDF-1.4"
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"] == 'attachment; filename="submission-1.pdf"'
    assert r.headers["cache-control"] == "private, no-store"

    r = await client.put(f"/assignments/peer-review/reviews/{review_uuid}", json={
        "scores": {"c1": "l1"}, "comments": {"strength": LONG, "suggestion": LONG}, "submit": True})
    assert r.status_code == 200 and r.json()["status"] == "submitted"

    state["user"] = l12
    r = await client.post(f"{base}/me/next")
    other_uuid = r.json()["review"]["review_uuid"]
    await client.put(f"/assignments/peer-review/reviews/{other_uuid}", json={
        "scores": {"c1": "l0"}, "comments": {"strength": LONG, "suggestion": LONG}, "submit": True})
    me = (await client.get(f"{base}/me")).json()
    assert me["steps"]["feedback"]["unlocked"] is True and me["received"][0]["reviewer_label"] == "Reviewer 1"
    assert me["peer_score"]["percentage"] == 100.0
    r = await client.post(f"/assignments/peer-review/reviews/{review_uuid}/rate", json={"helpfulness": 5, "note": "Great"})
    assert r.status_code == 200 and r.json()["helpfulness"] == 5
    r = await client.post(f"/assignments/peer-review/reviews/{review_uuid}/rate", json={"helpfulness": 9})
    assert r.status_code == 422
    r = await client.post(f"/assignments/peer-review/reviews/{review_uuid}/flag", json={"reason": "Too harsh"})
    assert r.status_code == 200 and r.json()["flagged"] is True
    r = await client.put(f"{base}/me/reflection", json={"plan": "Rewrite the intro"})
    assert r.status_code == 200 and r.json()["plan"] == "Rewrite the intro"

    state["user"] = admin
    overview = (await client.get(f"{base}/overview")).json()
    assert overview["totals"]["flagged"] == 1 and overview["totals"]["reviews_submitted"] == 2
    detail = (await client.get(f"{base}/submissions/12")).json()
    assert detail["reviews"][0]["reviewer"]["user_id"] == 11 and detail["reflection"]["plan"] == "Rewrite the intro"
    r = await client.post(f"{base}/reviews/{review_uuid}/discard", json={"reason": "Harsh"})
    assert r.json()["status"] == "discarded"
    r = await client.post(f"{base}/reviews/{review_uuid}/restore")
    assert r.json()["status"] == "submitted"

    rows = (await db.execute(AssignmentPeerReview.__table__.select())).all()
    assert len(rows) == 6  # 2 calibration, 2 self, 2 peer
