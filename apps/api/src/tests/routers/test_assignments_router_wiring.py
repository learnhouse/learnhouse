"""Wiring tests for src/routers/courses/assignments.py.

Each assignment endpoint is a thin shell over a service function. These tests
drive every endpoint through a real FastAPI app with the service patched out,
and check that the HTTP layer forwards the right path/query/body values (and
the authenticated user and DB session) to the service, and returns what the
service returned. The service behaviour itself is covered in
src/tests/services/test_assignments_*.py.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.assignments import AssignmentRead, GradingTypeEnum
from src.db.users import PublicUser
from src.routers.courses.assignments import router as assignments_router
from src.security.auth import get_current_user

_ROUTER = "src.routers.courses.assignments"

_DB = object()
_USER = PublicUser(
    id=7,
    username="learner",
    first_name="L",
    last_name="R",
    email="learner@test.com",
    user_uuid="user_learner",
)

_ASSIGNMENT_READ = AssignmentRead(
    id=1,
    assignment_uuid="assignment_x",
    title="T",
    description="D",
    grading_type=GradingTypeEnum.NUMERIC,
    org_id=1,
    course_id=1,
    chapter_id=1,
    activity_id=1,
)

_ASSIGNMENT_CREATE_BODY = {
    "title": "T",
    "description": "D",
    "grading_type": "NUMERIC",
    "org_id": 1,
    "course_id": 1,
    "chapter_id": 1,
    "activity_id": 1,
}

_TASK_CREATE_BODY = {
    "title": "Task",
    "description": "D",
    "hint": "",
    "assignment_type": "SHORT_ANSWER",
}


@pytest.fixture
async def client():
    app = FastAPI()
    app.include_router(assignments_router, prefix="/api/v1/assignments")
    app.dependency_overrides[get_db_session] = lambda: _DB
    app.dependency_overrides[get_current_user] = lambda: _USER
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


# (method, path, service name, json body, return value, expected positional
# args after `request`, expected kwargs). The args list uses the module-level
# _USER / _DB sentinels so we check the dependencies were threaded through.
_CASES = [
    (
        "post", "/", "create_assignment", _ASSIGNMENT_CREATE_BODY,
        _ASSIGNMENT_READ, None, {},
    ),
    (
        "get", "/assignment_x", "read_assignment", None,
        _ASSIGNMENT_READ, ["assignment_x", _USER, _DB], {},
    ),
    (
        "get", "/activity/activity_x", "read_assignment_from_activity_uuid", None,
        _ASSIGNMENT_READ, ["activity_x", _USER, _DB], {},
    ),
    (
        "put", "/assignment_x", "update_assignment", {"title": "New"},
        _ASSIGNMENT_READ, None, {},
    ),
    (
        "delete", "/assignment_x", "delete_assignment", None,
        {"message": "Assignment deleted"}, ["assignment_x", _USER, _DB], {},
    ),
    (
        "delete", "/activity/activity_x", "delete_assignment_from_activity_uuid",
        None, {"message": "Assignment deleted"}, ["activity_x", _USER, _DB], {},
    ),
    (
        "post", "/assignment_x/tasks", "create_assignment_task", _TASK_CREATE_BODY,
        {"ok": "created"}, None, {},
    ),
    (
        "get", "/assignment_x/tasks", "read_assignment_tasks", None,
        [{"ok": 1}], ["assignment_x", _USER, _DB], {},
    ),
    (
        "get", "/task/task_x", "read_assignment_task", None,
        {"ok": "task"}, ["task_x", _USER, _DB], {},
    ),
    (
        "put", "/assignment_x/tasks/task_x", "update_assignment_task",
        {"title": "Renamed"}, {"ok": "updated"}, None, {},
    ),
    (
        "post", "/assignment_x/tasks/task_x/ref_file",
        "put_assignment_task_reference_file", None,
        {"ok": "ref"}, [_DB, "task_x", _USER, None], {},
    ),
    (
        "post", "/assignment_x/tasks/task_x/sub_file",
        "put_assignment_task_submission_file", None,
        {"file_uuid": "f"}, [_DB, "task_x", _USER, None], {},
    ),
    (
        "delete", "/assignment_x/tasks/task_x", "delete_assignment_task", None,
        {"message": "Assignment Task deleted"}, ["task_x", _USER, _DB], {},
    ),
    (
        "get", "/assignment_x/tasks/task_x/submissions/user/5",
        "read_user_assignment_task_submissions", None,
        {"ok": "user-subs"}, ["task_x", 5, _USER, _DB], {},
    ),
    (
        "get", "/assignment_x/tasks/submissions/me",
        "read_user_assignment_task_submissions_me_batch", None,
        {"task_x": None}, ["assignment_x", _USER, _DB], {},
    ),
    (
        "get", "/assignment_x/tasks/task_x/submissions?limit=5&offset=10",
        "read_assignment_task_submissions", None,
        [], ["task_x", _USER, _DB, 5, 10], {},
    ),
    (
        "delete", "/assignment_x/tasks/task_x/submissions/sub_x",
        "delete_assignment_task_submission", None,
        {"message": "deleted"}, ["sub_x", _USER, _DB], {},
    ),
    (
        "get", "/assignment_x/submissions?limit=3&offset=6",
        "read_assignment_submissions", None,
        [], ["assignment_x", _USER, _DB, 3, 6], {},
    ),
    (
        "get", "/assignment_x/submissions/me",
        "read_user_assignment_submissions_me", None,
        [], ["assignment_x", _USER, _DB], {},
    ),
    (
        "get", "/assignment_x/submissions/5",
        "read_user_assignment_submissions", None,
        [], ["assignment_x", 5, _USER, _DB], {},
    ),
    (
        "put", "/assignment_x/submissions/5", "update_assignment_submission",
        {"assignment_id": 1}, {"ok": "sub-updated"}, None, {},
    ),
    (
        "delete", "/assignment_x/submissions/5", "delete_assignment_submission",
        None, {"message": "deleted"}, [5, "assignment_x", _USER, _DB], {},
    ),
    (
        "get", "/assignment_x/submissions/5/grade",
        "get_grade_assignment_submission", None,
        {"grade": 80}, [5, "assignment_x", _USER, _DB], {},
    ),
    (
        "post", "/assignment_x/submissions/5/done", "mark_activity_as_done_for_user",
        None, {"message": "done"}, [5, "assignment_x", _USER, _DB], {},
    ),
    (
        "get", "/course/course_x", "get_assignments_from_course", None,
        [], ["course_x", _USER, _DB], {},
    ),
]


@pytest.mark.parametrize(
    "method,path,service,body,returned,expected_args,expected_kwargs",
    _CASES,
    ids=[c[2] for c in _CASES],
)
async def test_endpoint_forwards_to_service(
    client, method, path, service, body, returned, expected_args, expected_kwargs
):
    """The endpoint calls its service with the request's values and returns its result."""
    mock = AsyncMock(return_value=returned)
    with patch(f"{_ROUTER}.{service}", mock):
        kwargs = {"json": body} if body is not None else {}
        resp = await client.request(
            method.upper(), f"/api/v1/assignments{path}", **kwargs
        )

    assert resp.status_code == 200, resp.text
    if isinstance(returned, AssignmentRead):
        assert resp.json()["assignment_uuid"] == returned.assignment_uuid
    else:
        assert resp.json() == returned
    mock.assert_awaited_once()
    args, kwargs = mock.call_args
    if expected_args is not None:
        # args[0] is the Starlette Request; the rest must match exactly.
        assert list(args[1:]) == expected_args
    assert kwargs == expected_kwargs


async def test_create_assignment_passes_parsed_body(client):
    """The JSON body is parsed into AssignmentCreate before reaching the service."""
    mock = AsyncMock(return_value=_ASSIGNMENT_READ)
    with patch(f"{_ROUTER}.create_assignment", mock):
        resp = await client.post("/api/v1/assignments/", json=_ASSIGNMENT_CREATE_BODY)
    assert resp.status_code == 200
    _, obj, user, db = mock.call_args.args
    assert obj.title == "T" and obj.course_id == 1
    assert user is _USER and db is _DB


async def test_update_assignment_passes_uuid_and_body(client):
    mock = AsyncMock(return_value=_ASSIGNMENT_READ)
    with patch(f"{_ROUTER}.update_assignment", mock):
        resp = await client.put(
            "/api/v1/assignments/assignment_x", json={"title": "New"}
        )
    assert resp.status_code == 200
    _, uuid, obj, user, db = mock.call_args.args
    assert uuid == "assignment_x" and obj.title == "New"
    assert user is _USER and db is _DB


async def test_create_task_passes_uuid_and_body(client):
    mock = AsyncMock(return_value={"ok": 1})
    with patch(f"{_ROUTER}.create_assignment_task", mock):
        resp = await client.post(
            "/api/v1/assignments/assignment_x/tasks", json=_TASK_CREATE_BODY
        )
    assert resp.status_code == 200
    _, uuid, obj, user, db = mock.call_args.args
    assert uuid == "assignment_x" and obj.title == "Task"
    assert user is _USER and db is _DB


async def test_update_task_passes_uuid_and_body(client):
    mock = AsyncMock(return_value={"ok": 1})
    with patch(f"{_ROUTER}.update_assignment_task", mock):
        resp = await client.put(
            "/api/v1/assignments/assignment_x/tasks/task_x",
            json={"title": "Renamed"},
        )
    assert resp.status_code == 200
    _, uuid, obj, user, db = mock.call_args.args
    assert uuid == "task_x" and obj.title == "Renamed"
    assert user is _USER and db is _DB


async def test_task_submission_upsert_passes_on_behalf_of(client):
    """The optional on_behalf_of_user_id query param reaches the service."""
    mock = AsyncMock(return_value={"ok": 1})
    with patch(f"{_ROUTER}.handle_assignment_task_submission", mock):
        resp = await client.put(
            "/api/v1/assignments/assignment_x/tasks/task_x/submissions"
            "?on_behalf_of_user_id=42",
            json={"task_submission": {"answer": "4"}},
        )
    assert resp.status_code == 200
    assert resp.json() == {"ok": 1}
    args, kwargs = mock.call_args
    assert args[1] == "task_x"
    assert args[2].task_submission == {"answer": "4"}
    assert args[3] is _USER and args[4] is _DB
    assert kwargs == {"on_behalf_of_user_id": 42}


async def test_create_assignment_submission_passes_on_behalf_of(client):
    mock = AsyncMock(return_value={"ok": "submitted"})
    with patch(f"{_ROUTER}.create_assignment_submission", mock):
        resp = await client.post(
            "/api/v1/assignments/assignment_x/submissions?on_behalf_of_user_id=9"
        )
    assert resp.status_code == 200
    assert resp.json() == {"ok": "submitted"}
    args, kwargs = mock.call_args
    assert list(args[1:]) == ["assignment_x", _USER, _DB]
    assert kwargs == {"on_behalf_of_user_id": 9}


async def test_update_assignment_submission_passes_user_and_body(client):
    mock = AsyncMock(return_value={"ok": 1})
    with patch(f"{_ROUTER}.update_assignment_submission", mock):
        resp = await client.put(
            "/api/v1/assignments/assignment_x/submissions/5",
            json={"assignment_id": 1, "grade": 50},
        )
    assert resp.status_code == 200
    _, user_id, uuid, obj, user, db = mock.call_args.args
    assert user_id == 5 and uuid == "assignment_x"
    assert obj.grade == 50
    assert user is _USER and db is _DB


class TestReadMyTaskSubmission:
    """GET .../tasks/{task}/submissions/me maps a missing submission to 404."""

    async def test_returns_submission(self, client):
        mock = AsyncMock(return_value={"assignment_task_submission_uuid": "s1"})
        with patch(f"{_ROUTER}.read_user_assignment_task_submissions_me", mock):
            resp = await client.get(
                "/api/v1/assignments/assignment_x/tasks/task_x/submissions/me"
            )
        assert resp.status_code == 200
        assert resp.json() == {"assignment_task_submission_uuid": "s1"}
        assert list(mock.call_args.args[1:]) == ["task_x", _USER, _DB]

    async def test_no_submission_is_404(self, client):
        mock = AsyncMock(return_value=None)
        with patch(f"{_ROUTER}.read_user_assignment_task_submissions_me", mock):
            resp = await client.get(
                "/api/v1/assignments/assignment_x/tasks/task_x/submissions/me"
            )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Assignment Task Submission not found"


class TestFinalGrade:
    async def test_forwards_overall_feedback(self, client):
        mock = AsyncMock(return_value={"message": "graded"})
        with patch(f"{_ROUTER}.grade_assignment_submission", mock):
            resp = await client.post(
                "/api/v1/assignments/assignment_x/submissions/5/grade",
                json={"overall_feedback": "Nice"},
            )
        assert resp.status_code == 200
        args, kwargs = mock.call_args
        assert list(args[1:]) == [5, "assignment_x", _USER, _DB]
        assert kwargs == {"overall_feedback": "Nice"}

    async def test_no_body_means_no_feedback(self, client):
        mock = AsyncMock(return_value={"message": "graded"})
        with patch(f"{_ROUTER}.grade_assignment_submission", mock):
            resp = await client.post(
                "/api/v1/assignments/assignment_x/submissions/5/grade"
            )
        assert resp.status_code == 200
        assert mock.call_args.kwargs == {"overall_feedback": None}


async def test_sub_file_upload_with_file_checks_rate_limit(client):
    """A real file upload is rate-limited per user before reaching the service."""
    mock = AsyncMock(return_value={"file_uuid": "stored.pdf"})
    with patch(f"{_ROUTER}.put_assignment_task_submission_file", mock), \
         patch(f"{_ROUTER}.check_rate_limit", return_value=(True, 1, 0)) as rl:
        resp = await client.post(
            "/api/v1/assignments/assignment_x/tasks/task_x/sub_file",
            files={"sub_file": ("a.pdf", b"%PDF-1.4", "application/pdf")},
        )
    assert resp.status_code == 200
    assert resp.json() == {"file_uuid": "stored.pdf"}
    assert rl.call_args.kwargs["key"] == f"sub_file_upload:{_USER.id}"
    upload = mock.call_args.args[4]
    assert upload.filename == "a.pdf"
