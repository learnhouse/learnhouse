"""Course audit: a quality check of a whole course in one read, so an agent
can see what to fix before it starts editing.

It reads the course as stored (drafts and answer keys included, so editors
only) and reports figures (pages, words, reading time, practice blocks) plus
issues ranked high, medium or low: empty or placeholder pages, quiz
questions without a right answer, media without a file, empty links, pages
with no practice or no headings, empty chapters, assignments without tasks
or a due date, a missing or broken cover, and what learners of a live course
cannot see. The checks are plain rules over the stored content; nothing is
judged by a model. With check_links, external links are also visited
(link_check.py) and dead ones reported.

`audit_courses` runs the same checks over many courses at once and returns
only what matters per course, so "find broken links in my courses" or
"which drafts are ready" is one call.
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
from src.services.ai.tools.link_check import check_links as check_links_of
from src.services.ai.tools.results import clip
from src.services.courses.thumbnails import thumbnail_status

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


_CHECK_LINKS = Field(
    False,
    description="Also visit every external link (text links and buttons) and report dead ones as broken_link. Slower.",
)


class AuditCourseParams(BaseModel):
    course_uuid: str = Field(..., min_length=1, max_length=100, description="The course (course_...).")
    chapter_uuids: list[str] | None = Field(
        None, min_length=1, max_length=100, description="Only these chapters (course checks are skipped)."
    )
    min_severity: Literal["high", "medium", "low"] = Field(
        "low", description="Leave out issues below this level."
    )
    check_links: bool = _CHECK_LINKS


MAX_AUDITED = 100
MAX_ISSUES_PER_COURSE = 25


class AuditCoursesParams(BaseModel):
    course_uuids: list[str] | None = Field(
        None, min_length=1, max_length=MAX_AUDITED, description="Only these courses; omit for every course you can edit."
    )
    published: bool | None = Field(None, description="true: only published courses; false: only drafts.")
    codes: list[str] | None = Field(
        None,
        max_length=30,
        description=(
            "Only these issue codes, e.g. empty_link, broken_link, broken_thumbnail, no_thumbnail, empty_page, "
            "empty_chapter, quiz_no_correct, media_missing, assignment_no_due_date, hidden_from_learners."
        ),
    )
    min_severity: Literal["high", "medium", "low"] = Field("low", description="Leave out issues below this level.")
    check_links: bool = _CHECK_LINKS


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


def _check_page(doc: dict, where: dict, issues: _Issues, stats: Counter, links: list | None = None) -> None:
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
        elif t == "button" and links is not None:
            links.append((str(a.get("link")).strip(), where, spot))
        if t in d.TEXT_HOLDERS:
            for href in _links(node):
                if not str(href or "").strip() or str(href).strip() == "#":
                    issues.add("medium", "empty_link", "A link has no address.", where, path=spot)
                elif links is not None:
                    links.append((str(href).strip(), where, spot))
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
    return await _audit(ctx, course, p.chapter_uuids, p.min_severity, p.check_links)


async def _audit(
    ctx: ToolContext, course: Any, chapter_uuids: list[str] | None, min_severity: str, check_links: bool
) -> dict[str, Any]:
    order, chapter_ids, _ = await current_order(ctx, course)
    if chapter_uuids:
        wanted = set()
        for uuid in chapter_uuids:
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

    links: list | None = [] if check_links else None
    if not chapter_uuids:
        if not (course.description or "").strip():
            issues.add("medium", "no_description", "The course has no description.", here)
        if not (course.learnings or "").strip():
            issues.add("low", "no_learnings", "The course lists no learning outcomes.", here)
        cover = await thumbnail_status(ctx.org.org_uuid, course)
        if cover == "missing":
            issues.add("low", "no_thumbnail", "The course has no cover image.", here)
        elif cover == "broken":
            issues.add(
                "medium",
                "broken_thumbnail",
                "The course's cover image file is missing from storage, so a placeholder shows.",
                here,
            )

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
                _check_page(d.normalize_legacy(d.ensure_doc(activity.content)), where, issues, stats, links)
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

    if live and not chapter_uuids and not published_activities:
        issues.add("high", "nothing_published", "The course is live but has no published activities.", here)

    if links:
        # Shared links are visited once: link_check keeps recent answers.
        results = await check_links_of([u for u, _w, _s in links])
        for url, where, spot in links:
            verdict = results.get(url) or {}
            if verdict.get("state") == "broken":
                issues.add(
                    "medium", "broken_link", f"Link to {clip(url, 120)} is broken: {verdict.get('reason')}.",
                    where, path=spot, url=url,
                )
        stats["links_checked"] = len({u for u, _w, _s in links})

    cutoff = SEVERITY[min_severity]
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
            **({"links_checked": stats["links_checked"]} if check_links else {}),
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


async def _audit_courses(ctx: ToolContext, p: AuditCoursesParams):
    from src.db.courses.courses import Course

    if p.course_uuids:
        courses = [await refs.load(ctx, "course", u) for u in p.course_uuids]
        if p.published is not None:
            courses = [c for c in courses if bool(c.published) == p.published]
    else:
        stmt = select(Course).where(Course.org_id == ctx.org.id)
        if p.published is not None:
            stmt = stmt.where(Course.published.is_(p.published))
        stmt = stmt.order_by(Course.creation_date.desc()).limit(MAX_AUDITED)
        courses = list((await ctx.db_session.execute(stmt)).scalars())
    editable, skipped = [], []
    for course in courses:
        decision = await check_resource_access(
            ctx.request, ctx.db_session, ctx.user, course.course_uuid, AccessAction.UPDATE, raise_on_deny=False
        )
        (editable if decision.allowed else skipped).append(course)

    wanted = set(p.codes or [])
    totals: Counter = Counter()
    found = []
    links = 0
    for course in editable:
        report = await _audit(ctx, course, None, p.min_severity, p.check_links)
        links += report["figures"].get("links_checked", 0)
        issues = [i for i in report["issues"] if not wanted or i["code"] in wanted]
        totals.update(i["code"] for i in issues)
        if not issues:
            continue
        entry: dict[str, Any] = {
            "course": report["course"],
            "live": report["live"],
            "issue_counts": dict(Counter(i["severity"] for i in issues)),
            "issues": issues[:MAX_ISSUES_PER_COURSE],
        }
        if len(issues) > MAX_ISSUES_PER_COURSE:
            entry["issues_not_shown"] = len(issues) - MAX_ISSUES_PER_COURSE
        found.append(entry)
    out: dict[str, Any] = {
        "courses_checked": len(editable),
        "courses_with_issues": len(found),
        "issue_totals": dict(totals),
        "courses": found,
    }
    if p.check_links:
        out["links_checked"] = links
    if skipped:
        out["skipped"] = [{"course": refs.ref("course", c.course_uuid, c.name), "reason": "no edit access"} for c in skipped]
    what = ", ".join(sorted(wanted)) if wanted else "issue"
    out["summary"] = f"Checked {len(editable)} course(s): {sum(totals.values())} {what} found in {len(found)} course(s)."
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
    ToolSpec(
        name="audit_courses",
        title="Audit many courses",
        description=(
            "Run audit_course's checks over every course you can edit (or the ones given) in ONE call "
            "and get, per course, only the issues that matter: filter with codes (e.g. ['empty_link', "
            "'broken_link'] for broken links, ['broken_thumbnail','no_thumbnail'] for covers) and "
            "min_severity; check_links visits external links to find dead ones. Use it for questions "
            "about all courses instead of auditing them one by one."
        ),
        params_model=AuditCoursesParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.READ,
        execute=_audit_courses,
        idempotent=True,
    ),
]
