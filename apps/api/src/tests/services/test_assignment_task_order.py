"""Tests for assignment task ordering.

Covers create_assignment_task appending to the end, read_assignment_tasks
returning tasks in their stored order (with an id fallback for rows created
before ordering existed), and reorder_assignment_tasks plus its route.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.courses.assignments import (
    AssignmentTask,
    AssignmentTaskCreate,
    AssignmentTaskOrder,
    AssignmentTaskTypeEnum,
)
from src.routers.courses.assignments import router as assignments_router
from src.security.auth import get_current_user
from src.security.rbac import AccessAction
from src.services.courses.activities.assignments import (
    create_assignment_task,
    delete_assignment_task,
    read_assignment_tasks,
    reorder_assignment_tasks,
)

_PATCH_RBAC = "src.services.courses.activities.assignments.check_resource_access"


async def _add_task(db, assignment, task_id, order=None):
    task = AssignmentTask(
        id=task_id,
        title=f"Task {task_id}",
        description="",
        hint="",
        assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
        contents={},
        max_grade_value=100,
        order=order,
        assignment_id=assignment.id,
        org_id=assignment.org_id,
        course_id=assignment.course_id,
        chapter_id=assignment.chapter_id,
        activity_id=assignment.activity_id,
        assignment_task_uuid=f"assignmenttask_{task_id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


def _new_task(title):
    return AssignmentTaskCreate(
        title=title,
        description="",
        hint="",
        assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
        contents={},
    )


async def _read_titles(mock_request, assignment, user, db):
    with patch(_PATCH_RBAC, new_callable=AsyncMock):
        tasks = await read_assignment_tasks(
            mock_request, assignment.assignment_uuid, user, db
        )
    return [t.title for t in tasks]


class TestTaskOrderOnCreateAndRead:
    async def test_new_tasks_are_appended_in_creation_order(
        self, mock_request, db, assignment, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            first = await create_assignment_task(
                mock_request, assignment.assignment_uuid, _new_task("First"), admin_user, db
            )
            second = await create_assignment_task(
                mock_request, assignment.assignment_uuid, _new_task("Second"), admin_user, db
            )
            third = await create_assignment_task(
                mock_request, assignment.assignment_uuid, _new_task("Third"), admin_user, db
            )

        assert [first.order, second.order, third.order] == [0, 1, 2]
        assert await _read_titles(mock_request, assignment, admin_user, db) == [
            "First",
            "Second",
            "Third",
        ]

    async def test_new_task_after_a_delete_does_not_reuse_a_position(
        self, mock_request, db, assignment, admin_user
    ):
        await _add_task(db, assignment, 101, order=0)
        doomed = await _add_task(db, assignment, 102, order=1)
        await _add_task(db, assignment, 103, order=2)

        with patch(_PATCH_RBAC, new_callable=AsyncMock), patch(
            "src.services.courses.activities.assignments._regrade_graded_submissions",
            new_callable=AsyncMock,
        ):
            await delete_assignment_task(
                mock_request, doomed.assignment_task_uuid, admin_user, db
            )
            created = await create_assignment_task(
                mock_request, assignment.assignment_uuid, _new_task("Newest"), admin_user, db
            )

        assert created.order == 3
        assert await _read_titles(mock_request, assignment, admin_user, db) == [
            "Task 101",
            "Task 103",
            "Newest",
        ]

    async def test_read_follows_stored_order_not_id(
        self, mock_request, db, assignment, admin_user
    ):
        await _add_task(db, assignment, 101, order=2)
        await _add_task(db, assignment, 102, order=0)
        await _add_task(db, assignment, 103, order=1)

        assert await _read_titles(mock_request, assignment, admin_user, db) == [
            "Task 102",
            "Task 103",
            "Task 101",
        ]

    async def test_unordered_legacy_rows_fall_back_to_id_order(
        self, mock_request, db, assignment, admin_user
    ):
        await _add_task(db, assignment, 103)
        await _add_task(db, assignment, 101)
        await _add_task(db, assignment, 102)

        assert await _read_titles(mock_request, assignment, admin_user, db) == [
            "Task 101",
            "Task 102",
            "Task 103",
        ]


class TestReorderAssignmentTasks:
    async def test_reorders_tasks(self, mock_request, db, assignment, admin_user):
        for task_id, order in ((101, 0), (102, 1), (103, 2)):
            await _add_task(db, assignment, task_id, order=order)

        new_order = ["assignmenttask_103", "assignmenttask_101", "assignmenttask_102"]
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await reorder_assignment_tasks(
                mock_request,
                assignment.assignment_uuid,
                AssignmentTaskOrder(task_uuids=new_order),
                admin_user,
                db,
            )

        assert [t.assignment_task_uuid for t in result] == new_order
        assert [t.order for t in result] == [0, 1, 2]
        assert await _read_titles(mock_request, assignment, admin_user, db) == [
            "Task 103",
            "Task 101",
            "Task 102",
        ]

    async def test_reorder_assigns_positions_to_legacy_rows(
        self, mock_request, db, assignment, admin_user
    ):
        await _add_task(db, assignment, 101)
        await _add_task(db, assignment, 102)

        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            await reorder_assignment_tasks(
                mock_request,
                assignment.assignment_uuid,
                AssignmentTaskOrder(
                    task_uuids=["assignmenttask_102", "assignmenttask_101"]
                ),
                admin_user,
                db,
            )

        rows = (
            await db.execute(select(AssignmentTask).order_by(AssignmentTask.id))
        ).scalars().all()
        assert [(r.id, r.order) for r in rows] == [(101, 1), (102, 0)]

    @pytest.mark.parametrize(
        "task_uuids",
        [
            ["assignmenttask_101"],
            ["assignmenttask_101", "assignmenttask_101"],
            ["assignmenttask_101", "assignmenttask_102", "assignmenttask_other"],
            ["assignmenttask_101", "assignmenttask_other"],
        ],
        ids=["missing", "duplicate", "extra", "foreign"],
    )
    async def test_rejects_a_list_that_does_not_match_the_tasks(
        self, mock_request, db, assignment, admin_user, task_uuids
    ):
        await _add_task(db, assignment, 101, order=0)
        await _add_task(db, assignment, 102, order=1)

        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await reorder_assignment_tasks(
                    mock_request,
                    assignment.assignment_uuid,
                    AssignmentTaskOrder(task_uuids=task_uuids),
                    admin_user,
                    db,
                )

        assert exc.value.status_code == 400
        assert await _read_titles(mock_request, assignment, admin_user, db) == [
            "Task 101",
            "Task 102",
        ]

    async def test_raises_404_when_assignment_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await reorder_assignment_tasks(
                    mock_request,
                    "nonexistent",
                    AssignmentTaskOrder(task_uuids=[]),
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 404

    async def test_requires_update_permission(
        self, mock_request, db, assignment, regular_user
    ):
        await _add_task(db, assignment, 101, order=0)

        with patch(
            _PATCH_RBAC,
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=403, detail="Forbidden"),
        ) as rbac:
            with pytest.raises(HTTPException) as exc:
                await reorder_assignment_tasks(
                    mock_request,
                    assignment.assignment_uuid,
                    AssignmentTaskOrder(task_uuids=["assignmenttask_101"]),
                    regular_user,
                    db,
                )

        assert exc.value.status_code == 403
        assert rbac.await_args.args[-1] == AccessAction.UPDATE


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(assignments_router, prefix="/api/v1/assignments")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class TestReorderRoute:
    async def test_put_order_reorders_instead_of_hitting_the_task_update_route(
        self, client, db, assignment
    ):
        await _add_task(db, assignment, 101, order=0)
        await _add_task(db, assignment, 102, order=1)

        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            response = await client.put(
                f"/api/v1/assignments/{assignment.assignment_uuid}/tasks/order",
                json={"task_uuids": ["assignmenttask_102", "assignmenttask_101"]},
            )

        assert response.status_code == 200
        body = response.json()
        assert [t["assignment_task_uuid"] for t in body] == [
            "assignmenttask_102",
            "assignmenttask_101",
        ]
        assert [t["order"] for t in body] == [0, 1]
