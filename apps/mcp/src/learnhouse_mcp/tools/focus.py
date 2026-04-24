"""Focus + selector tools: the Atlas agent's primary surface.

Instead of threading UUIDs through every call, the agent focuses one
course with ``focus_course`` and then uses name-based selectors on its
chapters and activities. UUIDs live only on the server — the agent
speaks in the same language the user does.

These tools sit on top of the existing primitives (``create_chapter``,
``update_activity``, etc.) by calling the underlying HTTP endpoints
through the shared ``LearnHouseClient``. No API changes; external MCP
clients (Claude Desktop, etc.) keep using the primitives unchanged.
"""

from __future__ import annotations

import difflib
from typing import Annotated, Any, Literal

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from .. import atlas_context as ctx
from ..client import LearnHouseClient
from .activities import _markdown_to_tiptap


# ─── snapshot + selector plumbing ─────────────────────────────────────────


async def _fetch_snapshot(
    client: LearnHouseClient, course_uuid: str
) -> dict[str, Any]:
    """Pull the compact course shape we cache for selector resolution.

    Identical in shape to ``describe_course``'s output so the agent can
    receive it directly on ``focus_course`` without a second read.
    """
    meta = await client.get(
        f"/courses/{course_uuid}/meta",
        params={"slim": "true", "with_unpublished_activities": "true"},
    )
    chapters: list[dict[str, Any]] = []
    for ch in meta.get("chapters") or []:
        activities: list[dict[str, Any]] = []
        for a in ch.get("activities") or []:
            activities.append(
                {
                    "id": a.get("id"),
                    "uuid": a.get("activity_uuid"),
                    "name": a.get("name"),
                    "activity_type": a.get("activity_type"),
                    "activity_sub_type": a.get("activity_sub_type"),
                    "published": bool(a.get("published")),
                }
            )
        chapters.append(
            {
                "id": ch.get("id"),
                "name": ch.get("name"),
                "description": ch.get("description"),
                "activities": activities,
            }
        )
    return {
        "course": {
            "uuid": meta.get("course_uuid"),
            "id": meta.get("id"),
            "name": meta.get("name"),
            "description": meta.get("description"),
            "public": meta.get("public"),
            "published": meta.get("published"),
        },
        "chapters": chapters,
    }


async def _ensure_fresh_snapshot(client: LearnHouseClient) -> dict[str, Any]:
    """Return a snapshot of the focused course, refreshing if stale."""
    focused = ctx.require_focus()
    if not focused.snapshot_is_fresh():
        snap = await _fetch_snapshot(client, focused.course_uuid)
        ctx.update_snapshot(snap)
        return snap
    return focused.snapshot


def _normalize(s: str) -> str:
    return " ".join(s.strip().lower().split())


def _resolve_chapter(
    snapshot: dict[str, Any], name: str
) -> dict[str, Any]:
    """Exact-match first (case-insensitive + whitespace-normalized). If
    exactly one match, return it. More than one → ambiguous. Zero →
    not-found with a sorted list of available names for the agent to
    pick a correction."""
    target = _normalize(name)
    matches = [
        ch for ch in (snapshot.get("chapters") or [])
        if _normalize(ch.get("name") or "") == target
    ]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ctx.AmbiguousSelectorError(
            kind="chapter",
            name=name,
            candidates=[{"id": c["id"], "name": c["name"]} for c in matches],
        )
    available = [ch.get("name") for ch in (snapshot.get("chapters") or [])]
    raise ctx.NotFoundSelectorError(kind="chapter", name=name, available=available)


def _resolve_activity(
    snapshot: dict[str, Any],
    name: str,
    chapter_name: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return (chapter, activity). If a chapter scope is given, search
    only that chapter — otherwise search every chapter in the course."""
    target = _normalize(name)
    if chapter_name is not None:
        chapter = _resolve_chapter(snapshot, chapter_name)
        matches = [
            a for a in (chapter.get("activities") or [])
            if _normalize(a.get("name") or "") == target
        ]
        if len(matches) == 1:
            return chapter, matches[0]
        if len(matches) > 1:
            raise ctx.AmbiguousSelectorError(
                kind="activity",
                name=name,
                candidates=[{"uuid": a["uuid"], "name": a["name"]} for a in matches],
            )
        available = [a.get("name") for a in (chapter.get("activities") or [])]
        raise ctx.NotFoundSelectorError(kind="activity", name=name, available=available)

    # Global search across chapters.
    hits: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for ch in snapshot.get("chapters") or []:
        for a in ch.get("activities") or []:
            if _normalize(a.get("name") or "") == target:
                hits.append((ch, a))
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        raise ctx.AmbiguousSelectorError(
            kind="activity",
            name=name,
            candidates=[
                {"uuid": a["uuid"], "name": a["name"], "chapter": ch["name"]}
                for ch, a in hits
            ],
        )
    all_names: list[str] = []
    for ch in snapshot.get("chapters") or []:
        for a in ch.get("activities") or []:
            all_names.append(a.get("name") or "")
    raise ctx.NotFoundSelectorError(kind="activity", name=name, available=all_names)


def _error_payload(exc: Exception) -> dict[str, Any]:
    """Render a selector error as a structured tool response — the agent
    gets back candidates or suggestions instead of a raw traceback string."""
    if isinstance(exc, ctx.AmbiguousSelectorError):
        return {
            "error": "ambiguous_name",
            "kind": exc.kind,
            "name": exc.name,
            "candidates": exc.candidates,
            "hint": (
                "Multiple entries matched. For activities, pass chapter_name "
                "to scope the search; for other kinds, check the candidate "
                "names and refocus."
            ),
        }
    if isinstance(exc, ctx.NotFoundSelectorError):
        suggestions = difflib.get_close_matches(exc.name, exc.available or [], n=3, cutoff=0.5)
        return {
            "error": "not_found",
            "kind": exc.kind,
            "name": exc.name,
            "did_you_mean": suggestions,
            "available_sample": (exc.available or [])[:10],
        }
    if isinstance(exc, ctx.NoFocusError):
        return {
            "error": "no_focus",
            "hint": str(exc),
        }
    # Unknown failures propagate — the agent sees a real error.
    raise exc


# ─── tool registration ────────────────────────────────────────────────────


_COURSE_QUERY_STOPWORDS = {
    "a", "an", "the", "of", "for", "to", "and", "with", "my", "our",
    "course", "courses", "class", "classes", "lesson", "lessons",
    "module", "tutorial", "training",
}


def _course_match_score(query: str, name: str) -> int:
    """Cheap token-overlap score for fuzzy course resolution.

    Splits both strings on word boundaries (treating punctuation as
    separators), drops stopwords from the query, and counts how many
    remaining query tokens appear inside the candidate name. This is
    what makes "dns course" find "Understanding DNS: The Internet's
    Phonebook" — `dns` is a non-stopword query token and is present
    in the candidate.
    """
    import re as _re
    q_tokens = [
        t for t in _re.split(r"[^a-z0-9]+", query.lower()) if t and t not in _COURSE_QUERY_STOPWORDS
    ]
    if not q_tokens:
        return 0
    name_lower = name.lower()
    return sum(1 for t in q_tokens if t in name_lower)


async def _resolve_course(
    client: LearnHouseClient, name_or_uuid: str
) -> tuple[dict | None, dict | None]:
    """Resolve a name-or-uuid to a course dict.

    Returns (course, error_payload) — exactly one is non-None. The
    resolver tries, in order:
        1. Direct UUID lookup if the input starts with `course_`.
        2. Exact (normalized) name match against search results.
        3. Substring / token-overlap fuzzy match against search results
           (e.g. "dns course" → "Understanding DNS …").
    Multiple high-confidence matches return an `ambiguous_name` error.
    """
    if name_or_uuid.startswith("course_"):
        try:
            course = await client.get(f"/courses/{name_or_uuid}")
            if isinstance(course, dict) and course.get("course_uuid"):
                return course, None
        except Exception:
            pass

    try:
        results = await client.get(
            f"/courses/org_slug/{client.org_slug}/search",
            params={"query": name_or_uuid, "page": 1, "limit": 25},
        )
    except Exception as exc:  # noqa: BLE001
        return None, {"error": "search_failed", "message": str(exc)[:200]}
    results = results or []

    target = _normalize(name_or_uuid)
    exact = [r for r in results if _normalize(r.get("name") or "") == target]
    if len(exact) == 1:
        return exact[0], None
    if len(exact) > 1:
        return None, {
            "error": "ambiguous_name",
            "kind": "course",
            "name": name_or_uuid,
            "candidates": [
                {"uuid": r.get("course_uuid"), "name": r.get("name")} for r in exact
            ],
        }

    # Fuzzy fallback — score every candidate by token overlap; pick a
    # clear winner if there is one, otherwise list the top contenders.
    scored = [
        (_course_match_score(name_or_uuid, r.get("name") or ""), r) for r in results
    ]
    scored = [(s, r) for s, r in scored if s > 0]
    if not scored:
        return None, {
            "error": "not_found",
            "kind": "course",
            "name": name_or_uuid,
            "did_you_mean": [r.get("name") for r in results[:5]],
            "hint": (
                "No course matched that name. Pick one of the suggestions, "
                "or refer to it by UUID."
            ),
        }
    scored.sort(key=lambda x: -x[0])
    top_score = scored[0][0]
    leaders = [r for s, r in scored if s == top_score]
    if len(leaders) == 1:
        return leaders[0], None
    return None, {
        "error": "ambiguous_name",
        "kind": "course",
        "name": name_or_uuid,
        "candidates": [
            {"uuid": r.get("course_uuid"), "name": r.get("name")} for r in leaders[:8]
        ],
        "hint": (
            "Multiple courses partially matched. Pick one of the candidates "
            "(by name or UUID)."
        ),
    }


def register(mcp: FastMCP, client: LearnHouseClient) -> None:
    # ── locator: find an activity across courses ────────────────────────

    @mcp.tool(
        name="find_activity",
        description=(
            "Search the org for activities whose name matches the given "
            "string (case-insensitive, trims spaces). Returns matches with "
            "their course path so you can focus the right course and then "
            "use the focus_* selector tools. When the user refers to an "
            "activity by name without telling you which course, call this "
            "instead of asking — only fall back to asking the user if the "
            "result is ambiguous across multiple courses.\n\n"
            "If auto_focus=True (default) and exactly one course contains a "
            "match, the tool will also focus that course for you; "
            "subsequent focus_* tools will just work."
        ),
    )
    async def find_activity(
        name: Annotated[str, Field(min_length=1, max_length=200)],
        auto_focus: bool = True,
        max_courses_scanned: Annotated[int, Field(ge=1, le=200)] = 50,
    ) -> dict:
        target = _normalize(name)
        matches: list[dict[str, Any]] = []
        courses_containing_matches: set[str] = set()

        # Cap pages so a huge org doesn't spin forever. 50 courses at
        # default is usually enough.
        page = 1
        limit = min(max_courses_scanned, 50)
        scanned = 0
        while scanned < max_courses_scanned:
            try:
                courses = await client.get(
                    f"/courses/org_slug/{client.org_slug}/page/{page}/limit/{limit}",
                    params={"include_unpublished": "true"},
                )
            except Exception as exc:  # noqa: BLE001
                return {"error": "list_courses_failed", "message": str(exc)[:200]}
            if not courses:
                break
            for course in courses:
                if scanned >= max_courses_scanned:
                    break
                scanned += 1
                cuuid = course.get("course_uuid")
                if not cuuid:
                    continue
                try:
                    meta = await client.get(
                        f"/courses/{cuuid}/meta",
                        params={"slim": "true", "with_unpublished_activities": "true"},
                    )
                except Exception:
                    continue
                for ch in meta.get("chapters") or []:
                    for a in ch.get("activities") or []:
                        if _normalize(a.get("name") or "") == target:
                            matches.append(
                                {
                                    "activity_uuid": a.get("activity_uuid"),
                                    "activity_id": a.get("id"),
                                    "activity_name": a.get("name"),
                                    "activity_type": a.get("activity_type"),
                                    "published": bool(a.get("published")),
                                    "chapter_id": ch.get("id"),
                                    "chapter_name": ch.get("name"),
                                    "course_uuid": cuuid,
                                    "course_id": meta.get("id"),
                                    "course_name": meta.get("name"),
                                }
                            )
                            courses_containing_matches.add(cuuid)
            if len(courses) < limit:
                break
            page += 1

        result: dict[str, Any] = {"query": name, "matches": matches, "scanned": scanned}
        # Auto-focus when the match is unambiguous at the course level.
        if auto_focus and len(courses_containing_matches) == 1 and matches:
            only_course_uuid = next(iter(courses_containing_matches))
            m = next(x for x in matches if x["course_uuid"] == only_course_uuid)
            snapshot = await _fetch_snapshot(client, only_course_uuid)
            ctx.set_focus(
                course_uuid=only_course_uuid,
                course_id=int(m["course_id"]),
                course_name=m["course_name"] or "",
                snapshot=snapshot,
            )
            result["auto_focused"] = {
                "course_uuid": only_course_uuid,
                "course_name": m["course_name"],
            }
        return result

    # ── focus lifecycle ──────────────────────────────────────────────────

    @mcp.tool(
        name="focus_course",
        description=(
            "Start working on a course. Resolves the course by exact name, "
            "then by token-overlap fuzzy match (so 'dns course' finds "
            "'Understanding DNS: …'), then by UUID. Pins the result as the "
            "session's working course; every subsequent focus_* tool then "
            "operates on it by chapter/activity NAME, no UUIDs needed. "
            "Returns the course snapshot."
        ),
    )
    async def focus_course(name_or_uuid: str) -> dict:
        course, err = await _resolve_course(client, name_or_uuid)
        if err is not None:
            return err
        assert course is not None  # for type narrowing

        course_uuid = course.get("course_uuid")
        course_id = course.get("id")
        course_name = course.get("name") or ""
        if not course_uuid or not course_id:
            return {"error": "malformed_course", "raw": course}

        snapshot = await _fetch_snapshot(client, course_uuid)
        ctx.set_focus(
            course_uuid=course_uuid,
            course_id=int(course_id),
            course_name=course_name,
            snapshot=snapshot,
        )
        return {"focused": {"uuid": course_uuid, "name": course_name}, **snapshot}

    @mcp.tool(
        name="unfocus_course",
        description="Drop the session's course focus. Use before switching to a different course.",
    )
    async def unfocus_course() -> dict:
        ctx.clear_focus()
        return {"ok": True}

    @mcp.tool(
        name="describe_focused",
        description=(
            "Return the latest snapshot of the focused course — same shape "
            "as describe_course but with no argument. Refreshes from the API "
            "if the cached snapshot is older than 30 seconds."
        ),
    )
    async def describe_focused() -> dict:
        try:
            snap = await _ensure_fresh_snapshot(client)
        except ctx.NoFocusError as exc:
            return _error_payload(exc)
        focused = ctx.require_focus()
        return {
            "focused": {"uuid": focused.course_uuid, "name": focused.course_name},
            **snap,
        }

    # ── activity-level selectors ────────────────────────────────────────

    @mcp.tool(
        name="set_activities_published",
        description=(
            "Publish (or unpublish) activities in the focused course by "
            "selector. Scope is one of:\n"
            "- 'all' — every activity in the course\n"
            "- 'chapter' with chapter_name — every activity in one chapter\n"
            "- 'activities' with activity_names — named activities "
            "(optionally scoped to chapter_name)\n"
            "Returns {touched, skipped, errors} with names, not UUIDs."
        ),
    )
    async def set_activities_published(
        value: bool,
        scope: Literal["all", "chapter", "activities"] = "all",
        chapter_name: str | None = None,
        activity_names: list[str] | None = None,
    ) -> dict:
        try:
            snap = await _ensure_fresh_snapshot(client)
        except ctx.NoFocusError as exc:
            return _error_payload(exc)

        targets: list[tuple[str, dict[str, Any]]] = []  # (chapter_name, activity)

        try:
            if scope == "all":
                for ch in snap.get("chapters") or []:
                    for a in ch.get("activities") or []:
                        targets.append((ch.get("name") or "", a))
            elif scope == "chapter":
                if not chapter_name:
                    return {
                        "error": "missing_argument",
                        "hint": "scope='chapter' requires chapter_name.",
                    }
                chapter = _resolve_chapter(snap, chapter_name)
                for a in chapter.get("activities") or []:
                    targets.append((chapter.get("name") or "", a))
            elif scope == "activities":
                if not activity_names:
                    return {
                        "error": "missing_argument",
                        "hint": "scope='activities' requires activity_names.",
                    }
                for n in activity_names:
                    chapter, activity = _resolve_activity(snap, n, chapter_name)
                    targets.append((chapter.get("name") or "", activity))
        except (ctx.AmbiguousSelectorError, ctx.NotFoundSelectorError) as exc:
            return _error_payload(exc)

        touched: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        for ch_name, a in targets:
            name = a.get("name")
            auuid = a.get("uuid")
            if not auuid:
                errors.append({"name": name, "message": "missing activity uuid"})
                continue
            if bool(a.get("published")) == value:
                skipped.append(
                    {
                        "chapter": ch_name,
                        "name": name,
                        "reason": f"already {'published' if value else 'unpublished'}",
                    }
                )
                continue
            try:
                await client.put(f"/activities/{auuid}", json={"published": value})
                touched.append({"chapter": ch_name, "name": name, "published": value})
            except Exception as exc:  # noqa: BLE001
                errors.append({"chapter": ch_name, "name": name, "message": str(exc)[:200]})

        ctx.invalidate_snapshot()
        return {
            "touched": touched,
            "skipped": skipped,
            "errors": errors,
            "totals": {
                "touched": len(touched),
                "skipped": len(skipped),
                "errors": len(errors),
            },
        }

    @mcp.tool(
        name="add_quiz_to_activity",
        description=(
            "Append an inline quiz (multiple-choice questions) to the bottom "
            "of a DYNAMIC activity's content in the focused course. Quizzes "
            "are Tiptap `blockQuiz` nodes that render as interactive "
            "knowledge checks inside the page — NOT separate assignments. "
            "Use this for 'add a quiz about X' style requests.\n\n"
            "`questions` shape: a list of "
            "{question: str, answers: [{answer: str, correct: bool}, ...]}. "
            "Mark at least one answer `correct: true` per question. You can "
            "generate the questions yourself from the activity's topic — "
            "don't ask the user for them unless they explicitly want to "
            "write them.\n\n"
            "If the activity's current content is empty, the quiz becomes "
            "its first (and only) block. Scope with chapter_name if the "
            "activity name is ambiguous."
        ),
    )
    async def add_quiz_to_activity(
        activity_name: str,
        questions: Annotated[
            list[dict[str, Any]],
            Field(
                min_length=1,
                description=(
                    "List of {question, answers: [{answer, correct}, ...]}. "
                    "Each question needs >=2 answers with >=1 marked correct."
                ),
            ),
        ],
        chapter_name: str | None = None,
    ) -> dict:
        try:
            snap = await _ensure_fresh_snapshot(client)
            _, activity = _resolve_activity(snap, activity_name, chapter_name)
        except (ctx.NoFocusError, ctx.AmbiguousSelectorError, ctx.NotFoundSelectorError) as exc:
            return _error_payload(exc)

        from uuid import uuid4

        # Normalize + validate the question shape. Any question without a
        # correct answer is a no-op for the learner, so we reject rather
        # than silently accept.
        normalized_questions: list[dict[str, Any]] = []
        for i, q in enumerate(questions):
            text = (q.get("question") or "").strip()
            answers_in = q.get("answers") or []
            if not text or not isinstance(answers_in, list) or len(answers_in) < 2:
                return {
                    "error": "invalid_question",
                    "message": (
                        f"questions[{i}]: each question needs a non-empty "
                        "'question' and at least 2 answers."
                    ),
                }
            answers_out: list[dict[str, Any]] = []
            has_correct = False
            for a in answers_in:
                answer_text = (a.get("answer") or "").strip()
                if not answer_text:
                    continue
                correct = bool(a.get("correct", False))
                has_correct = has_correct or correct
                answers_out.append(
                    {
                        "answer_id": str(uuid4()),
                        "answer": answer_text,
                        "correct": correct,
                    }
                )
            if not has_correct:
                return {
                    "error": "invalid_question",
                    "message": f"questions[{i}]: at least one answer must be correct.",
                }
            normalized_questions.append(
                {
                    "question_id": str(uuid4()),
                    "question": text,
                    "type": "multiple_choice",
                    "answers": answers_out,
                }
            )

        quiz_node = {
            "type": "blockQuiz",
            "attrs": {
                "quizId": str(uuid4()),
                "questions": normalized_questions,
            },
        }

        # Fetch current content, append the quiz node, save.
        current = await client.get(f"/activities/{activity['uuid']}")
        content = current.get("content") or {"type": "doc", "content": []}
        if not isinstance(content, dict) or content.get("type") != "doc":
            content = {"type": "doc", "content": []}
        blocks = list(content.get("content") or [])
        blocks.append(quiz_node)
        content["content"] = blocks

        await client.put(
            f"/activities/{activity['uuid']}",
            json={"content": content},
        )
        ctx.invalidate_snapshot()
        return {
            "activity_name": activity.get("name"),
            "quiz": {
                "question_count": len(normalized_questions),
                "quiz_id": quiz_node["attrs"]["quizId"],
            },
        }

    @mcp.tool(
        name="fill_activity",
        description=(
            "DESTRUCTIVE: REPLACE the entire body of an activity in the "
            "focused course with new markdown. Wipes whatever was there — "
            "including any quizzes, images, or existing content. Use this "
            "for an empty activity's first fill, or when the user asks to "
            "'rewrite' / 'replace' the content. For 'add', 'append', 'add "
            "more about X' — use `append_to_activity` instead, which keeps "
            "existing content intact."
        ),
    )
    async def fill_activity(
        activity_name: str,
        markdown: Annotated[str, Field(min_length=1, max_length=80_000)],
        chapter_name: str | None = None,
        publish: bool = False,
    ) -> dict:
        try:
            snap = await _ensure_fresh_snapshot(client)
            _, activity = _resolve_activity(snap, activity_name, chapter_name)
        except (ctx.NoFocusError, ctx.AmbiguousSelectorError, ctx.NotFoundSelectorError) as exc:
            return _error_payload(exc)

        doc = _markdown_to_tiptap(markdown)
        payload: dict[str, Any] = {"content": doc}
        if publish:
            payload["published"] = True
        result = await client.put(f"/activities/{activity['uuid']}", json=payload)
        ctx.invalidate_snapshot()
        return {
            "name": activity.get("name"),
            "uuid": activity["uuid"],
            "published": result.get("published"),
            "version": result.get("current_version"),
        }

    @mcp.tool(
        name="append_to_activity",
        description=(
            "Add markdown content to the END of an activity's existing "
            "body, preserving everything already there (including quizzes, "
            "previous paragraphs, code blocks, etc.). This is the right "
            "tool for 'add more content', 'add a section about X', 'append "
            "an example'. Accepts the same markdown dialect as "
            "fill_activity (headings, lists, code blocks, tables, "
            "blockquotes, links, YouTube embeds, inline bold/italic/code)."
        ),
    )
    async def append_to_activity(
        activity_name: str,
        markdown: Annotated[str, Field(min_length=1, max_length=80_000)],
        chapter_name: str | None = None,
    ) -> dict:
        try:
            snap = await _ensure_fresh_snapshot(client)
            _, activity = _resolve_activity(snap, activity_name, chapter_name)
        except (ctx.NoFocusError, ctx.AmbiguousSelectorError, ctx.NotFoundSelectorError) as exc:
            return _error_payload(exc)

        # Fetch the activity's current Tiptap doc and splice in the new
        # blocks at the end. If the activity was never filled before, the
        # existing content may be {} or missing a `content` array — start
        # a clean doc in that case.
        current = await client.get(f"/activities/{activity['uuid']}")
        content = current.get("content")
        if not isinstance(content, dict) or content.get("type") != "doc":
            content = {"type": "doc", "content": []}
        blocks = list(content.get("content") or [])

        new_doc = _markdown_to_tiptap(markdown)
        new_blocks = new_doc.get("content") or []
        blocks.extend(new_blocks)
        content["content"] = blocks

        result = await client.put(
            f"/activities/{activity['uuid']}",
            json={"content": content},
        )
        ctx.invalidate_snapshot()
        return {
            "name": activity.get("name"),
            "uuid": activity["uuid"],
            "appended_block_count": len(new_blocks),
            "total_block_count": len(blocks),
            "version": result.get("current_version"),
        }

    @mcp.tool(
        name="rename_activity",
        description=(
            "Rename an activity in the focused course by its current name. "
            "Scope to a chapter with chapter_name if the name is ambiguous."
        ),
    )
    async def rename_activity(
        activity_name: str,
        new_name: str,
        chapter_name: str | None = None,
    ) -> dict:
        try:
            snap = await _ensure_fresh_snapshot(client)
            _, activity = _resolve_activity(snap, activity_name, chapter_name)
        except (ctx.NoFocusError, ctx.AmbiguousSelectorError, ctx.NotFoundSelectorError) as exc:
            return _error_payload(exc)
        await client.put(f"/activities/{activity['uuid']}", json={"name": new_name})
        ctx.invalidate_snapshot()
        return {"old_name": activity.get("name"), "new_name": new_name}

    @mcp.tool(
        name="delete_activity_by_name",
        description=(
            "DESTRUCTIVE: delete an activity from the focused course by name. "
            "Confirm with the user before calling. Scope with chapter_name "
            "if the name is ambiguous."
        ),
    )
    async def delete_activity_by_name(
        activity_name: str,
        chapter_name: str | None = None,
    ) -> dict:
        try:
            snap = await _ensure_fresh_snapshot(client)
            _, activity = _resolve_activity(snap, activity_name, chapter_name)
        except (ctx.NoFocusError, ctx.AmbiguousSelectorError, ctx.NotFoundSelectorError) as exc:
            return _error_payload(exc)
        await client.delete(f"/activities/{activity['uuid']}")
        ctx.invalidate_snapshot()
        return {"deleted": activity.get("name"), "uuid": activity["uuid"]}

    # ── chapter-level selectors ─────────────────────────────────────────

    @mcp.tool(
        name="rename_chapter",
        description=(
            "Rename a chapter in the focused course by its current name."
        ),
    )
    async def rename_chapter(chapter_name: str, new_name: str) -> dict:
        try:
            snap = await _ensure_fresh_snapshot(client)
            chapter = _resolve_chapter(snap, chapter_name)
        except (ctx.NoFocusError, ctx.AmbiguousSelectorError, ctx.NotFoundSelectorError) as exc:
            return _error_payload(exc)
        await client.put(f"/chapters/{chapter['id']}", json={"name": new_name})
        ctx.invalidate_snapshot()
        return {"old_name": chapter.get("name"), "new_name": new_name}

    @mcp.tool(
        name="delete_chapter_by_name",
        description=(
            "DESTRUCTIVE: delete a chapter (and detach its activities) from "
            "the focused course by name. Confirm with the user before calling."
        ),
    )
    async def delete_chapter_by_name(chapter_name: str) -> dict:
        try:
            snap = await _ensure_fresh_snapshot(client)
            chapter = _resolve_chapter(snap, chapter_name)
        except (ctx.NoFocusError, ctx.AmbiguousSelectorError, ctx.NotFoundSelectorError) as exc:
            return _error_payload(exc)
        await client.delete(f"/chapters/{chapter['id']}")
        ctx.invalidate_snapshot()
        return {"deleted": chapter.get("name"), "id": chapter["id"]}

    # ── course-wide selector ────────────────────────────────────────────

    @mcp.tool(
        name="reorder_structure",
        description=(
            "Reorder the focused course's chapters and their activities by "
            "name. Pass a nested outline where each chapter is "
            "{name, activities: [activity_name, ...]}. The whole tree "
            "position is set to match the outline order — any chapter or "
            "activity you omit keeps its existing position at the tail. "
            "Unknown names are reported in `errors`; resolved names become "
            "the new order."
        ),
    )
    async def reorder_structure(
        outline: Annotated[
            list[dict[str, Any]],
            Field(
                min_length=1,
                description=(
                    "Ordered list of chapters. Each entry: "
                    "{\"name\": str, \"activities\": [str, ...]}."
                ),
            ),
        ],
    ) -> dict:
        try:
            snap = await _ensure_fresh_snapshot(client)
        except ctx.NoFocusError as exc:
            return _error_payload(exc)

        errors: list[dict[str, Any]] = []
        resolved_chapters: list[dict[str, Any]] = []

        for ch_spec in outline:
            ch_name = ch_spec.get("name")
            if not ch_name:
                errors.append({"kind": "chapter", "error": "missing_name"})
                continue
            try:
                chapter = _resolve_chapter(snap, ch_name)
            except (ctx.AmbiguousSelectorError, ctx.NotFoundSelectorError) as exc:
                errors.append(
                    {"kind": "chapter", "name": ch_name, **_error_payload(exc)}
                )
                continue
            activity_ids: list[int] = []
            for a_name in ch_spec.get("activities") or []:
                try:
                    _, a = _resolve_activity(snap, a_name, ch_name)
                    activity_ids.append(int(a["id"]))
                except (ctx.AmbiguousSelectorError, ctx.NotFoundSelectorError) as exc:
                    errors.append(
                        {
                            "kind": "activity",
                            "chapter": ch_name,
                            "name": a_name,
                            **_error_payload(exc),
                        }
                    )
            resolved_chapters.append(
                {"chapter_id": int(chapter["id"]), "activities_order_by_ids": [
                    {"activity_id": aid} for aid in activity_ids
                ]}
            )

        focused = ctx.require_focus()
        if resolved_chapters:
            await client.put(
                f"/chapters/course/{focused.course_uuid}/order",
                json={"chapter_order_by_ids": resolved_chapters},
            )
            ctx.invalidate_snapshot()

        return {
            "status": "ok" if not errors else "partial",
            "reordered_chapter_count": len(resolved_chapters),
            "errors": errors,
        }
