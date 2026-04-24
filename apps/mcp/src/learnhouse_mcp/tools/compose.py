"""Macro tools that bundle common multi-step course-authoring flows into a
single MCP tool call with rollback-on-failure semantics.

These are pure orchestration: each step reuses the same HTTP plumbing the
single-purpose tools use, through `LearnHouseClient`. No business logic
lives here — just "create A, then B under A, then C under B; on failure,
undo in reverse."
"""

from __future__ import annotations

from typing import Annotated, Any, Awaitable, Callable, Literal

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from ..client import LearnHouseAPIError, LearnHouseClient
from .activities import _markdown_to_tiptap

ActivityKind = Literal["dynamic", "external_video", "video_shell", "pdf_shell"]
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


class _Unwind:
    """Cleanup stack for best-effort rollback.

    Each entry is a zero-arg async callable that undoes one step. On
    failure, pop and run them in reverse order; swallow individual
    rollback failures into the `errors` list so a single flaky delete
    can't leave the rest of the tree orphaned.
    """

    def __init__(self) -> None:
        self._stack: list[tuple[str, Callable[[], Awaitable[None]]]] = []
        self.rollback_errors: list[dict[str, str]] = []

    def push(self, label: str, undo: Callable[[], Awaitable[None]]) -> None:
        self._stack.append((label, undo))

    async def rollback(self) -> None:
        while self._stack:
            label, undo = self._stack.pop()
            try:
                await undo()
            except Exception as exc:  # noqa: BLE001
                self.rollback_errors.append({"step": f"rollback:{label}", "message": str(exc)})


async def _create_activity_of_kind(
    client: LearnHouseClient,
    chapter_id: int,
    kind: ActivityKind,
    name: str,
    uri: str | None,
    video_type: str | None,
    publish: bool,
) -> dict:
    """Create one activity using the route appropriate to its kind. Returns
    the created activity dict (including activity_uuid)."""
    if kind == "dynamic":
        body = {
            "chapter_id": chapter_id,
            "name": name,
            "activity_type": "TYPE_DYNAMIC",
            "activity_sub_type": "SUBTYPE_DYNAMIC_PAGE",
            "content": {},
            "details": {},
            "published": publish,
            "lock_type": "public",
        }
        return await client.post("/activities/", json=body)

    if kind == "external_video":
        if not uri:
            raise ValueError("external_video activity requires `uri`.")
        vtype = (video_type or "youtube").lower()
        if vtype not in {"youtube", "vimeo"}:
            raise ValueError("video_type must be 'youtube' or 'vimeo'.")
        body = {
            "chapter_id": str(chapter_id),
            "name": name,
            "uri": uri,
            "type": vtype,
            "details": "{}",
        }
        return await client.post("/activities/external_video", json=body)

    if kind == "video_shell":
        return await client.post_form(
            "/activities/video",
            form={"name": name, "chapter_id": str(chapter_id), "details": "{}"},
        )

    if kind == "pdf_shell":
        return await client.post_form(
            "/activities/documentpdf",
            form={"name": name, "chapter_id": str(chapter_id)},
        )

    raise ValueError(f"Unknown activity kind: {kind!r}")


def register(mcp: FastMCP, client: LearnHouseClient) -> None:
    # ─── compose_course ────────────────────────────────────────────────────

    @mcp.tool(
        name="compose_course",
        description=(
            "Create a whole course — metadata + nested chapters + activities "
            "(optionally with markdown content) — in a single call. Each "
            "activity `kind` picks its creator: 'dynamic' (markdown body), "
            "'external_video' (YouTube/Vimeo URL in `uri` + `video_type`), "
            "'video_shell' (empty upload slot), 'pdf_shell' (empty upload "
            "slot).\n\n"
            "IMPORTANT: if the user asks for a course with substantial "
            "content in each activity, LEAVE `markdown` EMPTY on each "
            "activity here and follow up with "
            "`set_activity_content_from_markdown` per activity. One "
            "compose_course call with 10+ rich markdown blobs is a token-"
            "budget trap — per-activity calls produce far better content. "
            "Use `markdown` inside compose_course only for short stub "
            "content (under 100 words per activity).\n\n"
            "On any step failure, rolls back in reverse order by default "
            "(set rollback_on_failure=False to keep whatever was created). "
            "Returns {status: 'ok'|'partial', created: {...}, errors: [...]}."
        ),
    )
    async def compose_course(
        name: str,
        description: str,
        chapters: Annotated[
            list[dict[str, Any]],
            Field(
                min_length=1,
                description=(
                    "Chapters in order. Each: {name, description?, activities: "
                    "[{kind, name, markdown?, uri?, video_type?, publish?}, ...]}."
                ),
            ),
        ],
        about: str | None = None,
        tags: str | None = None,
        public: bool = False,
        publish_course: bool = False,
        rollback_on_failure: bool = True,
    ) -> dict:
        unwind = _Unwind()
        created: dict[str, Any] = {"chapters": []}
        errors: list[dict[str, str]] = []

        try:
            # 1) Create the course itself.
            course_form = {
                "name": name,
                "description": description,
                "about": about if about is not None else description,
                "public": "true" if public else "false",
                "thumbnail_type": "image",
            }
            if tags is not None:
                course_form["tags"] = tags
            course = await client.post_form(
                f"/courses/?org_id={client.org_id}", form=course_form
            )
            course_uuid = course.get("course_uuid")
            course_id = course.get("id")
            if not course_uuid or not course_id:
                raise LearnHouseAPIError(502, "Course creation returned no UUID/id")
            created["course"] = {
                "uuid": course_uuid,
                "id": course_id,
                "name": course.get("name"),
            }
            unwind.push(
                f"delete_course:{course_uuid}",
                lambda uuid=course_uuid: _discard(client.delete(f"/courses/{uuid}")),
            )

            # 2) Walk chapters → activities → optional markdown content.
            for ch_idx, ch_spec in enumerate(chapters):
                ch_name = ch_spec.get("name")
                if not ch_name:
                    raise ValueError(f"chapters[{ch_idx}].name is required")
                chapter = await client.post(
                    "/chapters/",
                    json={
                        "name": ch_name,
                        "description": ch_spec.get("description") or "",
                        "course_id": course_id,
                        "org_id": client.org_id,
                    },
                )
                chapter_id = chapter.get("id")
                if not chapter_id:
                    raise LearnHouseAPIError(502, "Chapter creation returned no id")
                chapter_entry = {
                    "id": chapter_id,
                    "name": chapter.get("name"),
                    "activities": [],
                }
                created["chapters"].append(chapter_entry)
                unwind.push(
                    f"delete_chapter:{chapter_id}",
                    lambda cid=chapter_id: _discard(client.delete(f"/chapters/{cid}")),
                )

                for a_idx, a_spec in enumerate(ch_spec.get("activities") or []):
                    kind = (a_spec.get("kind") or "dynamic").lower()
                    a_name = a_spec.get("name")
                    if not a_name:
                        raise ValueError(
                            f"chapters[{ch_idx}].activities[{a_idx}].name is required"
                        )
                    activity = await _create_activity_of_kind(
                        client,
                        chapter_id=chapter_id,
                        kind=kind,  # type: ignore[arg-type]
                        name=a_name,
                        uri=a_spec.get("uri"),
                        video_type=a_spec.get("video_type"),
                        publish=bool(a_spec.get("publish", False)),
                    )
                    activity_uuid = activity.get("activity_uuid")
                    if not activity_uuid:
                        raise LearnHouseAPIError(502, "Activity creation returned no UUID")
                    activity_entry = {
                        "uuid": activity_uuid,
                        "id": activity.get("id"),
                        "name": activity.get("name"),
                        "kind": kind,
                    }
                    chapter_entry["activities"].append(activity_entry)
                    unwind.push(
                        f"delete_activity:{activity_uuid}",
                        lambda uid=activity_uuid: _discard(
                            client.delete(f"/activities/{uid}")
                        ),
                    )

                    md = a_spec.get("markdown")
                    if kind == "dynamic" and md:
                        doc = _markdown_to_tiptap(md)
                        await client.put(
                            f"/activities/{activity_uuid}",
                            json={"content": doc, "published": activity_entry.get("publish", False) or bool(a_spec.get("publish"))},
                        )

            # 3) Optional final publish of the course.
            if publish_course:
                await client.put(
                    f"/courses/{course_uuid}", json={"published": True}
                )
                created["course"]["published"] = True

            return {"status": "ok", "created": created}

        except Exception as exc:
            errors.append({"step": "compose_course", "message": _describe(exc)})
            if rollback_on_failure:
                await unwind.rollback()
                errors.extend(unwind.rollback_errors)
                return {"status": "partial", "created": {}, "errors": errors}
            # Keep partial creations if rollback was disabled.
            return {"status": "partial", "created": created, "errors": errors}

    # ─── compose_chapter ───────────────────────────────────────────────────

    @mcp.tool(
        name="compose_chapter",
        description=(
            "Append a new chapter + nested activities (+ per-activity markdown "
            "content) to an existing course in one call. Same activity spec "
            "shape and rollback semantics as compose_course. Pass course_id "
            "(numeric) — use describe_course to resolve from a UUID."
        ),
    )
    async def compose_chapter(
        course_id: int,
        name: str,
        activities: Annotated[
            list[dict[str, Any]],
            Field(min_length=1),
        ],
        description: str | None = None,
        rollback_on_failure: bool = True,
    ) -> dict:
        unwind = _Unwind()
        created: dict[str, Any] = {"activities": []}
        errors: list[dict[str, str]] = []

        try:
            chapter = await client.post(
                "/chapters/",
                json={
                    "name": name,
                    "description": description or "",
                    "course_id": course_id,
                    "org_id": client.org_id,
                },
            )
            chapter_id = chapter.get("id")
            if not chapter_id:
                raise LearnHouseAPIError(502, "Chapter creation returned no id")
            created["chapter"] = {"id": chapter_id, "name": chapter.get("name")}
            unwind.push(
                f"delete_chapter:{chapter_id}",
                lambda cid=chapter_id: _discard(client.delete(f"/chapters/{cid}")),
            )

            for a_idx, a_spec in enumerate(activities):
                kind = (a_spec.get("kind") or "dynamic").lower()
                a_name = a_spec.get("name")
                if not a_name:
                    raise ValueError(f"activities[{a_idx}].name is required")
                activity = await _create_activity_of_kind(
                    client,
                    chapter_id=chapter_id,
                    kind=kind,  # type: ignore[arg-type]
                    name=a_name,
                    uri=a_spec.get("uri"),
                    video_type=a_spec.get("video_type"),
                    publish=bool(a_spec.get("publish", False)),
                )
                activity_uuid = activity.get("activity_uuid")
                if not activity_uuid:
                    raise LearnHouseAPIError(502, "Activity creation returned no UUID")
                entry = {
                    "uuid": activity_uuid,
                    "id": activity.get("id"),
                    "name": activity.get("name"),
                    "kind": kind,
                }
                created["activities"].append(entry)
                unwind.push(
                    f"delete_activity:{activity_uuid}",
                    lambda uid=activity_uuid: _discard(
                        client.delete(f"/activities/{uid}")
                    ),
                )

                md = a_spec.get("markdown")
                if kind == "dynamic" and md:
                    doc = _markdown_to_tiptap(md)
                    await client.put(
                        f"/activities/{activity_uuid}",
                        json={"content": doc, "published": bool(a_spec.get("publish"))},
                    )

            return {"status": "ok", "created": created}

        except Exception as exc:
            errors.append({"step": "compose_chapter", "message": _describe(exc)})
            if rollback_on_failure:
                await unwind.rollback()
                errors.extend(unwind.rollback_errors)
                return {"status": "partial", "created": {}, "errors": errors}
            return {"status": "partial", "created": created, "errors": errors}

    # ─── compose_assignment ────────────────────────────────────────────────

    @mcp.tool(
        name="compose_assignment",
        description=(
            "Create an ASSIGNMENT-type activity + its assignment + its tasks "
            "in a single call. Pass chapter_id (numeric). grading_type is one "
            "of ALPHABET, NUMERIC, PERCENTAGE, PASS_FAIL, GPA_SCALE. Each "
            "task: {title, description, hint?, assignment_type, contents, "
            "max_grade_value?}. See create_assignment_task's description for "
            "the per-type `contents` JSON shape. Rolls back in reverse (tasks "
            "→ assignment → activity) on failure."
        ),
    )
    async def compose_assignment(
        chapter_id: int,
        activity_name: str,
        title: str,
        description: str,
        due_date: Annotated[
            str,
            Field(description="ISO-8601 date/datetime string, e.g. '2026-06-15'."),
        ],
        grading_type: GradingType,
        tasks: list[dict[str, Any]],
        published: bool = False,
        auto_grading: bool = False,
        anti_copy_paste: bool = False,
        show_correct_answers: bool = False,
        rollback_on_failure: bool = True,
    ) -> dict:
        unwind = _Unwind()
        created: dict[str, Any] = {"tasks": []}
        errors: list[dict[str, str]] = []

        try:
            # 1) Resolve course_id (needed for the assignment body). Cheapest
            # path is the chapter read which includes course_id.
            chapter = await client.get(f"/chapters/{chapter_id}")
            course_id = chapter.get("course_id")
            if not course_id:
                raise LearnHouseAPIError(
                    404, f"Chapter {chapter_id} did not report a course_id"
                )

            # 2) Create the ASSIGNMENT-type activity.
            activity = await client.post(
                "/activities/",
                json={
                    "chapter_id": chapter_id,
                    "name": activity_name,
                    "activity_type": "TYPE_ASSIGNMENT",
                    "activity_sub_type": "SUBTYPE_ASSIGNMENT_ANY",
                    "content": {},
                    "details": {},
                    "published": published,
                    "lock_type": "public",
                },
            )
            activity_uuid = activity.get("activity_uuid")
            activity_id = activity.get("id")
            if not activity_uuid or not activity_id:
                raise LearnHouseAPIError(502, "Activity creation returned no UUID/id")
            created["activity"] = {
                "uuid": activity_uuid,
                "id": activity_id,
                "name": activity.get("name"),
            }
            unwind.push(
                f"delete_activity:{activity_uuid}",
                lambda uid=activity_uuid: _discard(client.delete(f"/activities/{uid}")),
            )

            # 3) Create the assignment row pointing at that activity.
            assignment = await client.post(
                "/assignments/",
                json={
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
                },
            )
            assignment_uuid = assignment.get("assignment_uuid")
            if not assignment_uuid:
                raise LearnHouseAPIError(502, "Assignment creation returned no UUID")
            created["assignment"] = {
                "uuid": assignment_uuid,
                "id": assignment.get("id"),
                "title": assignment.get("title"),
            }
            unwind.push(
                f"delete_assignment:{assignment_uuid}",
                lambda au=assignment_uuid: _discard(
                    client.delete(f"/assignments/{au}")
                ),
            )

            # 4) Create each task. The delete_assignment cascade handles task
            # cleanup on its own, but we still push per-task cleanup so a
            # partial run with rollback_on_failure=False leaves a coherent set.
            for t_idx, t_spec in enumerate(tasks):
                required = {"title", "description", "assignment_type"}
                missing = [k for k in required if not t_spec.get(k)]
                if missing:
                    raise ValueError(
                        f"tasks[{t_idx}] missing required fields: {missing}"
                    )
                task_body = {
                    "title": t_spec["title"],
                    "description": t_spec["description"],
                    "hint": t_spec.get("hint", ""),
                    "assignment_type": t_spec["assignment_type"],
                    "contents": t_spec.get("contents") or {},
                    "max_grade_value": int(t_spec.get("max_grade_value", 100)),
                }
                task = await client.post(
                    f"/assignments/{assignment_uuid}/tasks", json=task_body
                )
                task_uuid = task.get("assignment_task_uuid")
                created["tasks"].append(
                    {
                        "uuid": task_uuid,
                        "id": task.get("id"),
                        "title": task.get("title"),
                        "assignment_type": task.get("assignment_type"),
                    }
                )
                # Per-task cleanup is best-effort; parent assignment delete
                # will catch any stragglers.
                if task_uuid:
                    unwind.push(
                        f"delete_task:{task_uuid}",
                        lambda au=assignment_uuid, tu=task_uuid: _discard(
                            client.delete(f"/assignments/{au}/tasks/{tu}")
                        ),
                    )

            return {"status": "ok", "created": created}

        except Exception as exc:
            errors.append({"step": "compose_assignment", "message": _describe(exc)})
            if rollback_on_failure:
                await unwind.rollback()
                errors.extend(unwind.rollback_errors)
                return {"status": "partial", "created": {}, "errors": errors}
            return {"status": "partial", "created": created, "errors": errors}


async def _discard(awaitable: Any) -> None:
    """Await a coroutine and ignore its return value. Lets us use small
    lambdas in the unwind stack without `async def` wrappers at every site."""
    await awaitable


def _describe(exc: Exception) -> str:
    """Short one-line description of any exception, with LearnHouse API
    errors rendered compactly."""
    if isinstance(exc, LearnHouseAPIError):
        return f"{exc.status_code} {str(exc)[:300]}"
    return f"{type(exc).__name__}: {exc}"
