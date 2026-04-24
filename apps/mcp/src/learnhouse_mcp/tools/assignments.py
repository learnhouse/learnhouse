from __future__ import annotations

from typing import Annotated, Any, Literal

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from ..client import LearnHouseClient

GradingType = Literal["ALPHABET", "NUMERIC", "PERCENTAGE", "PASS_FAIL", "GPA_SCALE"]
TaskType = Literal[
    "FILE_SUBMISSION",
    "QUIZ",
    "FORM",
    "CODE",
    "SHORT_ANSWER",
    "NUMBER_ANSWER",
    "OTHER",
]


def register(mcp: FastMCP, client: LearnHouseClient) -> None:
    # ---- Assignments ----

    @mcp.tool(
        name="list_course_assignments",
        description=(
            "List every assignment attached to any activity under the given course. "
            "Each entry includes the assignment UUID, parent activity UUID, grading "
            "type, due date, and published flag."
        ),
    )
    async def list_course_assignments(course_uuid: str) -> list[dict]:
        return await client.get(f"/assignments/course/{course_uuid}")

    @mcp.tool(
        name="get_assignment",
        description="Fetch one assignment by its UUID.",
    )
    async def get_assignment(assignment_uuid: str) -> dict:
        return await client.get(f"/assignments/{assignment_uuid}")

    @mcp.tool(
        name="get_assignment_by_activity",
        description=(
            "Fetch the assignment attached to a given activity UUID. An activity has "
            "at most one assignment; returns 404 if none exists."
        ),
    )
    async def get_assignment_by_activity(activity_uuid: str) -> dict:
        return await client.get(f"/assignments/activity/{activity_uuid}")

    @mcp.tool(
        name="create_assignment",
        description=(
            "Attach a new assignment to an activity. The parent activity must be an "
            "ASSIGNMENT-type activity. course_id / chapter_id / activity_id are the "
            "numeric IDs (not UUIDs) of the parent chain — use get_course_structure "
            "first to resolve them from UUIDs. grading_type is one of ALPHABET, "
            "NUMERIC, PERCENTAGE, PASS_FAIL, GPA_SCALE."
        ),
    )
    async def create_assignment(
        title: str,
        description: str,
        due_date: Annotated[
            str,
            Field(description="ISO-8601 date/datetime string, e.g. '2026-06-15' or '2026-06-15T23:59:00Z'."),
        ],
        grading_type: GradingType,
        course_id: int,
        chapter_id: int,
        activity_id: int,
        published: bool = False,
        auto_grading: bool = False,
        anti_copy_paste: bool = False,
        show_correct_answers: bool = False,
    ) -> dict:
        body = {
            "title": title,
            "description": description,
            "due_date": due_date,
            "grading_type": grading_type,
            "published": published,
            "auto_grading": auto_grading,
            "anti_copy_paste": anti_copy_paste,
            "show_correct_answers": show_correct_answers,
            "org_id": client.org_id,
            "course_id": course_id,
            "chapter_id": chapter_id,
            "activity_id": activity_id,
        }
        return await client.post("/assignments/", json=body)

    @mcp.tool(
        name="update_assignment",
        description=(
            "Update fields on an existing assignment by UUID. Pass only the fields "
            "you want to change; omitted fields are left untouched."
        ),
    )
    async def update_assignment(
        assignment_uuid: str,
        title: str | None = None,
        description: str | None = None,
        due_date: str | None = None,
        published: bool | None = None,
        grading_type: GradingType | None = None,
        auto_grading: bool | None = None,
        anti_copy_paste: bool | None = None,
        show_correct_answers: bool | None = None,
    ) -> dict:
        payload = {
            k: v
            for k, v in {
                "title": title,
                "description": description,
                "due_date": due_date,
                "published": published,
                "grading_type": grading_type,
                "auto_grading": auto_grading,
                "anti_copy_paste": anti_copy_paste,
                "show_correct_answers": show_correct_answers,
            }.items()
            if v is not None
        }
        if not payload:
            raise ValueError("update_assignment requires at least one field to change.")
        return await client.put(f"/assignments/{assignment_uuid}", json=payload)

    @mcp.tool(
        name="delete_assignment",
        description=(
            "DESTRUCTIVE: permanently delete an assignment and all of its tasks and "
            "submissions. This cannot be undone. Always confirm with the user."
        ),
    )
    async def delete_assignment(assignment_uuid: str) -> dict:
        return await client.delete(f"/assignments/{assignment_uuid}")

    @mcp.tool(
        name="delete_assignment_by_activity",
        description=(
            "DESTRUCTIVE: delete the assignment attached to a given activity UUID, "
            "including all of its tasks and submissions. Always confirm with the user."
        ),
    )
    async def delete_assignment_by_activity(activity_uuid: str) -> dict:
        return await client.delete(f"/assignments/activity/{activity_uuid}")

    # ---- Assignment tasks ----

    @mcp.tool(
        name="list_assignment_tasks",
        description="List every task under the given assignment.",
    )
    async def list_assignment_tasks(assignment_uuid: str) -> list[dict]:
        return await client.get(f"/assignments/{assignment_uuid}/tasks")

    @mcp.tool(
        name="get_assignment_task",
        description="Fetch one assignment task by its UUID.",
    )
    async def get_assignment_task(assignment_task_uuid: str) -> dict:
        return await client.get(f"/assignments/task/{assignment_task_uuid}")

    @mcp.tool(
        name="create_assignment_task",
        description=(
            "Add a new task under an assignment. `assignment_type` is one of "
            "FILE_SUBMISSION, QUIZ, FORM, CODE, SHORT_ANSWER, NUMBER_ANSWER, OTHER. "
            "`contents` is the grading spec — a JSON dict whose shape depends on "
            "the task type. Use one of the shapes below (shape names and keys are "
            "case-sensitive):\n\n"
            "- QUIZ: "
            "{\"questions\": [{\"questionUUID\": str, \"options\": "
            "[{\"optionUUID\": str, \"assigned_right_answer\": bool}, ...]}, ...]}.\n"
            "- FORM (fill-in-the-blank): "
            "{\"questions\": [{\"questionUUID\": str, \"blanks\": "
            "[{\"blankUUID\": str, \"correctAnswer\": str}, ...]}, ...]}.\n"
            "- SHORT_ANSWER: {\"correct_answers\": [str, ...], "
            "\"match_mode\": \"exact\" | \"case_insensitive\" | \"contains\" | \"regex\"}.\n"
            "- NUMBER_ANSWER: {\"correct_value\": number, \"tolerance\": number}.\n"
            "- CODE: {\"language_id\": int (Judge0 language id, e.g. 71 for Python), "
            "\"test_cases\": [{\"stdin\": str, \"expectedStdout\": str, "
            "\"weight\": int}, ...], \"grading_mode\": "
            "\"binary\" | \"equal_weight\" | \"custom_weights\"}.\n"
            "- FILE_SUBMISSION: {}  (teacher grades manually).\n"
            "- OTHER: {}  (ungraded catch-all).\n\n"
            "max_grade_value defaults to 100 — leave it alone unless you have a "
            "legacy reason."
        ),
    )
    async def create_assignment_task(
        assignment_uuid: str,
        title: str,
        description: str,
        assignment_type: TaskType,
        hint: str = "",
        contents: dict[str, Any] | None = None,
        max_grade_value: Annotated[int, Field(ge=1)] = 100,
    ) -> dict:
        body = {
            "title": title,
            "description": description,
            "hint": hint,
            "assignment_type": assignment_type,
            "contents": contents or {},
            "max_grade_value": max_grade_value,
        }
        return await client.post(f"/assignments/{assignment_uuid}/tasks", json=body)

    @mcp.tool(
        name="update_assignment_task",
        description=(
            "Update fields on an existing assignment task. Pass only fields you want "
            "to change. When changing `contents`, use the per-type JSON shapes "
            "documented on create_assignment_task."
        ),
    )
    async def update_assignment_task(
        assignment_uuid: str,
        assignment_task_uuid: str,
        title: str | None = None,
        description: str | None = None,
        hint: str | None = None,
        assignment_type: TaskType | None = None,
        contents: dict[str, Any] | None = None,
        max_grade_value: int | None = None,
    ) -> dict:
        payload = {
            k: v
            for k, v in {
                "title": title,
                "description": description,
                "hint": hint,
                "assignment_type": assignment_type,
                "contents": contents,
                "max_grade_value": max_grade_value,
            }.items()
            if v is not None
        }
        if not payload:
            raise ValueError(
                "update_assignment_task requires at least one field to change."
            )
        return await client.put(
            f"/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}",
            json=payload,
        )

    @mcp.tool(
        name="delete_assignment_task",
        description=(
            "DESTRUCTIVE: delete an assignment task and every submission attached to "
            "it. Always confirm with the user."
        ),
    )
    async def delete_assignment_task(
        assignment_uuid: str,
        assignment_task_uuid: str,
    ) -> dict:
        return await client.delete(
            f"/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}"
        )

    # ---- Task submissions (instructor view) ----

    @mcp.tool(
        name="list_task_submissions",
        description="List every submission for a given assignment task (instructor view).",
    )
    async def list_task_submissions(
        assignment_uuid: str,
        assignment_task_uuid: str,
        limit: Annotated[int, Field(ge=1, le=500)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> list[dict]:
        return await client.get(
            f"/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions",
            params={"limit": limit, "offset": offset},
        )

    @mcp.tool(
        name="list_user_task_submissions",
        description=(
            "List the task submissions that a specific user made for the given "
            "assignment task."
        ),
    )
    async def list_user_task_submissions(
        assignment_uuid: str,
        assignment_task_uuid: str,
        user_id: int,
    ) -> list[dict]:
        return await client.get(
            f"/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}"
            f"/submissions/user/{user_id}"
        )

    @mcp.tool(
        name="delete_task_submission",
        description=(
            "DESTRUCTIVE: delete one task submission by its UUID. Always confirm "
            "with the user."
        ),
    )
    async def delete_task_submission(
        assignment_uuid: str,
        assignment_task_uuid: str,
        assignment_task_submission_uuid: str,
    ) -> dict:
        return await client.delete(
            f"/assignments/{assignment_uuid}/tasks/{assignment_task_uuid}"
            f"/submissions/{assignment_task_submission_uuid}"
        )

    # ---- Assignment-level submissions & grading ----

    @mcp.tool(
        name="list_assignment_submissions",
        description=(
            "List every assignment-level submission for the given assignment "
            "(instructor view). Each entry includes user_id, submission_status, "
            "grade, and overall_feedback."
        ),
    )
    async def list_assignment_submissions(
        assignment_uuid: str,
        limit: Annotated[int, Field(ge=1, le=500)] = 50,
        offset: Annotated[int, Field(ge=0)] = 0,
    ) -> list[dict]:
        return await client.get(
            f"/assignments/{assignment_uuid}/submissions",
            params={"limit": limit, "offset": offset},
        )

    @mcp.tool(
        name="get_user_assignment_submission",
        description=(
            "Read a specific user's assignment-level submission for the given "
            "assignment."
        ),
    )
    async def get_user_assignment_submission(
        assignment_uuid: str,
        user_id: int,
    ) -> dict:
        return await client.get(f"/assignments/{assignment_uuid}/submissions/{user_id}")

    @mcp.tool(
        name="delete_user_assignment_submission",
        description=(
            "DESTRUCTIVE: delete a user's assignment-level submission. This also "
            "removes all of their task submissions for that assignment. Always "
            "confirm with the user."
        ),
    )
    async def delete_user_assignment_submission(
        assignment_uuid: str,
        user_id: int,
    ) -> dict:
        return await client.delete(
            f"/assignments/{assignment_uuid}/submissions/{user_id}"
        )

    @mcp.tool(
        name="get_user_assignment_grade",
        description=(
            "Read the computed grade (and any stored overall feedback) for a user's "
            "assignment submission."
        ),
    )
    async def get_user_assignment_grade(
        assignment_uuid: str,
        user_id: int,
    ) -> dict:
        return await client.get(
            f"/assignments/{assignment_uuid}/submissions/{user_id}/grade"
        )

    @mcp.tool(
        name="grade_user_assignment_submission",
        description=(
            "Finalize the grade on a user's assignment submission. Aggregates each "
            "task's stored grade into the overall submission grade and stores the "
            "optional overall_feedback note alongside it."
        ),
    )
    async def grade_user_assignment_submission(
        assignment_uuid: str,
        user_id: int,
        overall_feedback: str | None = None,
    ) -> dict:
        body: dict[str, Any] = {}
        if overall_feedback is not None:
            body["overall_feedback"] = overall_feedback
        return await client.post(
            f"/assignments/{assignment_uuid}/submissions/{user_id}/grade",
            json=body or None,
        )

    @mcp.tool(
        name="mark_assignment_done_for_user",
        description=(
            "Mark the underlying activity as completed for a user, once their "
            "assignment submission is accepted. Typically called after "
            "grade_user_assignment_submission."
        ),
    )
    async def mark_assignment_done_for_user(
        assignment_uuid: str,
        user_id: int,
    ) -> dict:
        return await client.post(
            f"/assignments/{assignment_uuid}/submissions/{user_id}/done"
        )
