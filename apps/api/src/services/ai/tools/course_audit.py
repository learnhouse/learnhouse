"""Course audit: a quality check of a whole course in one read, so an agent
can see what to fix before it starts editing.

It reads the course as stored (drafts and answer keys included, so editors
only) and reports figures (pages, words, reading time, practice blocks) plus
issues ranked high, medium or low: empty or placeholder pages, quiz
questions without a right answer, media without a file, empty links, pages
with no practice or no headings, empty chapters, assignments without tasks
or a due date, and what learners of a live course cannot see. The checks are
plain rules over the stored content; nothing is judged by a model.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlmodel import select

from src.db.courses.activities import Activity, ActivityTypeEnum
from src.db.courses.assignments import Assignment, AssignmentTask
from src.db.courses.chapters import Chapter
from src.security.rbac import AccessAction, check_resource_access
from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.chapters import activity_ref, course_ref, current_order
from src.services.ai.tools.results import clip

MAX_ISSUES = 150
WORDS_PER_MINUTE = 200
EMPTY_WORDS = 10
LONG_WORDS = 2500
HEADINGS_FROM = 600
PRACTICE_FROM = 300
PRACTICE = ("blockQuiz", "flipcard", "flipcardGrid", "blockCode", "scenarios")
SEVERITY = {"high": 0, "medium": 1, "low": 2}
_PLACEHOLDER = re.compile(r"lorem ipsum|\bTODO\b|\bTBD\b|\[insert[^\]]*\]|\bxxx\b", re.IGNORECASE)
_WORD = re.compile(r"\w+")


class AuditCourseParams(BaseModel):
    course_uuid: str = Field(..., min_length=1, max_length=100, description="The course (course_...).")
    chapter_uuids: list[str] | None = Field(
        None, min_length=1, max_length=100, description="Only these chapters (course checks are skipped)."
    )
    min_severity: Literal["high", "medium", "low"] = Field(
        "low", description="Leave out issues below this level."
    )


class _Issues:
    def __init__(self) -> None:
        self.items: list[tuple[int, int, dict]] = []

    def add(self, severity: str, code: str, message: str, where: dict, **extra: Any) -> None:
        issue = {"severity": severity, "code": code, "message": message, "where": where, **extra}
        self.items.append((SEVERITY[severity], len(self.items), issue))


def _kind(activity: Activity) -> str:
    return str(getattr(activity.activity_type, "value", activity.activity_type))


def _links(node: dict):
    for child in d.children(node):
        if not isinstance(child, dict):
            continue
        for mark in child.get("marks") or []:
            if isinstance(mark, dict) and mark.get("type") == "link":
                yield (mark.get("attrs") or {}).get("href")


def _check_page(doc: dict, where: dict, issues: _Issues, stats: Counter) -> None:
    text = d.block_text(doc)
    words = len(_WORD.findall(text))
    stats["words"] += words
    blocks = Counter()
    headings = 0
    for path, node, _parent in d.walk_blocks(doc):
        t = d.kind(node)
        blocks[t] += 1
        spot = list(path)
        a = node.get("attrs") or {}
        if t == "heading":
            headings += 1
        elif t == "blockQuiz":
            for n, q in enumerate(a.get("questions") or [], 1):
                if not isinstance(q, dict):
                    continue
                answers = [x for x in q.get("answers") or [] if isinstance(x, dict)]
                if not str(q.get("question") or "").strip():
                    issues.add("high", "quiz_empty_question", f"Quiz question {n} has no text.", where, path=spot)
                if len(answers) < 2:
                    issues.add("medium", "quiz_few_options", f"Quiz question {n} has fewer than two options.", where, path=spot)
                elif not any(x.get("correct") for x in answers):
                    issues.add("high", "quiz_no_correct", f"Quiz question {n} has no right answer marked.", where, path=spot)
        elif t == "blockCode" and not a.get("testCases"):
            issues.add("low", "exercise_no_tests", "Coding exercise has no tests, so answers are not checked.", where, path=spot)
        elif t in d.MEDIA_TYPES:
            obj = a.get("blockObject") if isinstance(a.get("blockObject"), dict) else {}
            if not obj and not a.get("unsplash_url"):
                label = t.removeprefix("block").lower()
                issues.add("high", "media_missing", f"The {label} block has no file.", where, path=spot)
        elif t == "button" and not str(a.get("link") or "").strip():
            issues.add("medium", "empty_link", "Button has no link.", where, path=spot)
        if t in d.TEXT_HOLDERS:
            for href in _links(node):
                if not str(href or "").strip() or str(href).strip() == "#":
                    issues.add("medium", "empty_link", "A link has no address.", where, path=spot)
    practice = sum(blocks[t] for t in PRACTICE)
    media = sum(blocks[t] for t in d.MEDIA_TYPES) + blocks["blockEmbed"]
    stats["practice_blocks"] += practice
    stats["media_blocks"] += media
    for t in PRACTICE:
        stats[f"practice:{t}"] += blocks[t]

    found = _PLACEHOLDER.search(text)
    if found:
        issues.add("high", "placeholder_text", f"Placeholder text left in: '{clip(found.group(0), 40)}'.", where)
    if words < EMPTY_WORDS and not practice and not media:
        issues.add("high", "empty_page", "The page is empty or nearly empty.", where, words=words)
    if words > LONG_WORDS:
        issues.add("low", "long_page", f"{words} words: consider splitting it into several pages.", where, words=words)
    if words >= HEADINGS_FROM and not headings:
        issues.add("low", "no_headings", f"{words} words with no headings to scan by.", where, words=words)
    if words >= PRACTICE_FROM and not practice:
        issues.add("low", "no_practice", "No quiz, flipcards, exercise or scenario to practice with.", where, words=words)


async def _audit_course(ctx: ToolContext, p: AuditCourseParams):
    course = await refs.load(ctx, "course", p.course_uuid)
    await check_resource_access(ctx.request, ctx.db_session, ctx.user, course.course_uuid, AccessAction.UPDATE)
    order, chapter_ids, _ = await current_order(ctx, course)
    if p.chapter_uuids:
        wanted = set()
        for uuid in p.chapter_uuids:
            if uuid not in chapter_ids:
                raise refs.not_found("chapter", uuid)
            wanted.add(chapter_ids[uuid])
        order = [(cid, acts) for cid, acts in order if cid in wanted]

    chapter_rows = {
        c.id: c
        for c in (
            await ctx.db_session.execute(select(Chapter).where(Chapter.id.in_([cid for cid, _ in order])))
        ).scalars()
    }
    activity_ids = [a for _, acts in order for a in acts]
    activity_rows = {
        a.id: a
        for a in (await ctx.db_session.execute(select(Activity).where(Activity.id.in_(activity_ids)))).scalars()
    }
    assignments: dict[int, Assignment] = {
        a.activity_id: a
        for a in (
            await ctx.db_session.execute(select(Assignment).where(Assignment.activity_id.in_(activity_ids)))
        ).scalars()
    }
    with_tasks = set(
        (
            await ctx.db_session.execute(
                select(AssignmentTask.assignment_id).where(
                    AssignmentTask.assignment_id.in_([a.id for a in assignments.values()])
                )
            )
        ).scalars()
    )

    issues = _Issues()
    stats: Counter = Counter()
    kinds: Counter = Counter()
    here = await course_ref(ctx, course)
    live = bool(course.published)

    if not p.chapter_uuids:
        if not (course.description or "").strip():
            issues.add("medium", "no_description", "The course has no description.", here)
        if not (course.learnings or "").strip():
            issues.add("low", "no_learnings", "The course lists no learning outcomes.", here)
        if not (course.thumbnail_image or "").strip() and not (course.thumbnail_video or "").strip():
            issues.add("low", "no_thumbnail", "The course has no cover image.", here)

    published_activities = 0
    for chapter_id, acts in order:
        chapter = chapter_rows.get(chapter_id)
        if chapter is None:
            continue
        chapter_where = refs.ref("chapter", chapter.chapter_uuid, chapter.name)
        stats["chapters"] += 1
        if not acts:
            issues.add("medium", "empty_chapter", "The chapter has no activities.", chapter_where)
        for activity_id in acts:
            activity = activity_rows.get(activity_id)
            if activity is None:
                continue
            kind = _kind(activity)
            kinds[kind.removeprefix("TYPE_").lower()] += 1
            where = await activity_ref(ctx, course.course_uuid, activity)
            if activity.published:
                published_activities += 1
            elif live:
                issues.add("medium", "hidden_from_learners", "Draft in a live course: learners cannot see it.", where)
            if kind == ActivityTypeEnum.TYPE_DYNAMIC.value:
                _check_page(d.normalize_legacy(d.ensure_doc(activity.content)), where, issues, stats)
            elif kind == ActivityTypeEnum.TYPE_ASSIGNMENT.value:
                assignment = assignments.get(activity.id)
                if assignment is None:
                    continue
                if assignment.id not in with_tasks:
                    issues.add("high", "assignment_no_tasks", "The assignment has no tasks.", where)
                if not assignment.due_date:
                    issues.add("low", "assignment_no_due_date", "The assignment has no due date.", where)
                if live and activity.published and not assignment.published:
                    issues.add("medium", "hidden_from_learners", "The assignment itself is unpublished.", where)

    if live and not p.chapter_uuids and not published_activities:
        issues.add("high", "nothing_published", "The course is live but has no published activities.", here)

    cutoff = SEVERITY[p.min_severity]
    ranked = [issue for sev, _n, issue in sorted(issues.items, key=lambda x: x[:2]) if sev <= cutoff]
    counts = Counter(issue["severity"] for _s, _n, issue in issues.items)
    words = stats["words"]
    out: dict[str, Any] = {
        "course": here,
        "live": live,
        "figures": {
            "chapters": stats["chapters"],
            "activities": dict(kinds),
            "words": words,
            "reading_minutes": round(words / WORDS_PER_MINUTE),
            "practice_blocks": {t: stats[f"practice:{t}"] for t in PRACTICE if stats[f"practice:{t}"]},
            "media_blocks": stats["media_blocks"],
        },
        "issue_counts": {s: counts.get(s, 0) for s in SEVERITY},
        "issues": ranked[:MAX_ISSUES],
    }
    if len(ranked) > MAX_ISSUES:
        out["issues_not_shown"] = len(ranked) - MAX_ISSUES
    out["summary"] = (
        f"'{course.name}': {counts.get('high', 0)} high, {counts.get('medium', 0)} medium and "
        f"{counts.get('low', 0)} low issues." if issues.items else f"'{course.name}': no issues found."
    )
    return out


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="audit_course",
        title="Audit a course",
        description=(
            "Check a whole course for problems in one read: empty or placeholder pages, quiz "
            "questions with no right answer, media without a file, empty links, exercises without "
            "tests, pages with no practice or headings, empty chapters, assignments without tasks "
            "or due date, drafts learners of a live course cannot see. Returns issues ranked high, "
            "medium, low with block paths, plus figures (words, reading time, practice blocks). "
            "Editors only."
        ),
        params_model=AuditCourseParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_audit_course,
        target_param="course_uuid",
        target_kind="course",
        idempotent=True,
    ),
]
