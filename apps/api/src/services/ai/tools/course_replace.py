"""Course-wide find and replace: change a word or phrase on every page of a
course (or some chapters) in one call, optionally in page and chapter names.

Matching is exact and case-sensitive, the same as edit_activity_content's
replace_text: text in paragraphs, headings, lists, tables and callouts, plus
quiz, flipcard and scenario texts. Formatting of each match is kept.
Replacements run in the order given, on every page in course order. Each
changed page is saved as one new version, so restore_activity_version undoes
it page by page. A preview counts and shows matches without saving.
"""

from __future__ import annotations

import copy
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import select

from src.db.courses.activities import Activity, ActivityTypeEnum, ActivityUpdate
from src.db.courses.chapters import Chapter, ChapterUpdate
from src.security.rbac import AccessAction, check_resource_access
from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, require_approval
from src.services.ai.tools.chapters import activity_ref, course_ref, current_order
from src.services.ai.tools.content_edit import load_editable, save
from src.services.ai.tools.results import changed, clip
from src.services.courses.activities.activities import update_activity
from src.services.courses.chapters import update_chapter

MAX_PAGES_SHOWN = 100
SNIPPETS_PER_PAGE = 3
SNIPPET = 60
_UNSUPPORTED = "￼"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Replacement(_Strict):
    find: str = Field(..., min_length=1, max_length=500, description="Exact text to find (case-sensitive).")
    replace: str = Field(..., max_length=2000, description="Replacement text; empty removes the match.")


class ReplaceInCourseParams(BaseModel):
    course_uuid: str = Field(..., min_length=1, max_length=100, description="The course (course_...).")
    replacements: list[Replacement] = Field(
        ..., min_length=1, max_length=50, description="Run in this order on every page."
    )
    chapter_uuids: list[str] | None = Field(
        None, min_length=1, max_length=100, description="Only pages in these chapters."
    )
    titles: bool = Field(False, description="Also rename pages and chapters whose names contain a find.")
    preview: bool = Field(False, description="Only count and show the matches; change nothing.")


def _swap(text: str, pairs: list[Replacement]) -> tuple[str, list[int]]:
    counts = []
    for pair in pairs:
        counts.append(text.count(pair.find))
        text = text.replace(pair.find, pair.replace)
    return text, counts


def _snippet(text: str, find: str) -> str | None:
    at = text.find(find)
    if at < 0:
        return None
    start = max(0, at - SNIPPET)
    end = min(len(text), at + len(find) + SNIPPET)
    return ("…" if start else "") + text[start:end].replace("\n", " ") + ("…" if end < len(text) else "")


def _replace_doc(doc: dict, pairs: list[Replacement], snippets: list[str] | None) -> list[int]:
    """Apply every pair to the document in place; matches per pair."""
    counts = []
    for pair in pairs:
        n = 0
        for _path, node in d.text_targets(doc, ()):
            found = d.count_in(node, pair.find)
            if not found:
                continue
            if snippets is not None and len(snippets) < SNIPPETS_PER_PAGE:
                shown = _snippet(d.block_text(node), pair.find)
                if shown:
                    snippets.append(shown)
            n += d.replace_in(node, pair.find, pair.replace, None)
        counts.append(n)
    return counts


def _working_copy(activity: Activity) -> dict:
    return d.normalize_legacy(copy.deepcopy(d.ensure_doc(activity.content)))


def _is_page(activity: Activity) -> bool:
    kind = getattr(activity.activity_type, "value", activity.activity_type)
    return kind == ActivityTypeEnum.TYPE_DYNAMIC.value


async def _scope(ctx: ToolContext, p: ReplaceInCourseParams):
    """The course, then its chapters and activities in course order, limited
    to the chapters asked for."""
    course = await refs.load(ctx, "course", p.course_uuid)
    await check_resource_access(ctx.request, ctx.db_session, ctx.user, course.course_uuid, AccessAction.UPDATE)
    order, chapter_ids, _activity_ids = await current_order(ctx, course)
    if p.chapter_uuids:
        wanted = set()
        for uuid in p.chapter_uuids:
            if uuid not in chapter_ids:
                raise refs.not_found("chapter", uuid)
            wanted.add(chapter_ids[uuid])
        order = [(chapter_id, acts) for chapter_id, acts in order if chapter_id in wanted]
    chapter_rows = {
        c.id: c
        for c in (
            await ctx.db_session.execute(select(Chapter).where(Chapter.id.in_([cid for cid, _a in order])))
        ).scalars()
    }
    activity_ids = [a for _cid, acts in order for a in acts]
    activity_rows = {
        a.id: a
        for a in (await ctx.db_session.execute(select(Activity).where(Activity.id.in_(activity_ids)))).scalars()
    }
    chapters = [chapter_rows[cid] for cid, _a in order if cid in chapter_rows]
    activities = [activity_rows[a] for a in activity_ids if a in activity_rows]
    return course, chapters, activities


async def _replace_in_course(ctx: ToolContext, p: ReplaceInCourseParams):
    for pair in p.replacements:
        if _UNSUPPORTED in pair.find:
            raise HTTPException(status_code=400, detail="find contains an unsupported character.")
    course, chapters, activities = await _scope(ctx, p)

    # First pass on copies: what would change, without locking or saving.
    totals = [0] * len(p.replacements)
    hits: list[tuple[Activity, int, list[str]]] = []
    texts: list[str] = []
    other_kinds = 0
    for activity in activities:
        if not _is_page(activity):
            other_kinds += 1
            continue
        doc = _working_copy(activity)
        texts.append(d.block_text(doc))
        snippets: list[str] = []
        counts = _replace_doc(doc, p.replacements, snippets)
        totals = [t + c for t, c in zip(totals, counts)]
        if sum(counts):
            hits.append((activity, sum(counts), snippets))

    renames: list[tuple[str, Any, str, str]] = []
    if p.titles:
        for kind, rows in (("chapter", chapters), ("page", activities)):
            for row in rows:
                name, counts = _swap(row.name or "", p.replacements)
                totals = [t + c for t, c in zip(totals, counts)]
                if name != row.name and name.strip():
                    renames.append((kind, row, row.name, name.strip()))

    if not hits and not renames:
        return {
            "summary": f"No matches in '{course.name}'.",
            "course": await course_ref(ctx, course),
            "replaced": 0,
            "not_found": _not_found(p.replacements, totals, texts),
            "skipped_activities": other_kinds,
        }

    live_pages = sum(1 for a, _n, _s in hits if course.published and a.published)
    live_names = sum(1 for kind, row, _old, _new in renames if course.published and (kind == "chapter" or row.published))
    if not p.preview and (live_pages or live_names):
        parts = [f"{live_pages} live page{'s' if live_pages != 1 else ''}"] if live_pages else []
        if live_names:
            parts.append(f"{live_names} name{'s' if live_names != 1 else ''}")
        require_approval(ctx, f"Changes text learners see now in '{course.name}': {' and '.join(parts)}.")

    pages: list[dict] = []
    undo: list[dict] = []
    replaced = 0
    for activity, found, snippets in hits:
        entry: dict[str, Any] = {"page": await activity_ref(ctx, course.course_uuid, activity), "matches": found}
        if p.preview:
            entry["snippets"] = [clip(s, 2 * SNIPPET + 60) for s in snippets]
        else:
            # Re-read under the row lock, so an edit made since is kept.
            page, doc = await load_editable(ctx, activity.activity_uuid)
            found = sum(_replace_doc(doc, p.replacements, None))
            if not found:
                continue
            before, after, page_undo = await save(ctx, page, doc)
            entry.update(matches=found, version_before=before, version_after=after)
            if page_undo:
                undo.append(page_undo)
        replaced += found
        pages.append(entry)

    renamed = []
    for kind, row, old, name in renames:
        if not p.preview:
            if kind == "chapter":
                await update_chapter(ctx.request, ChapterUpdate(name=name), row.id, ctx.user, ctx.db_session)
            else:
                await update_activity(ctx.request, ActivityUpdate(name=name), row.activity_uuid, ctx.user, ctx.db_session)
        uuid = row.chapter_uuid if kind == "chapter" else row.activity_uuid
        renamed.append({"kind": kind, "uuid": uuid, "from": old, "to": name})

    where = f"{len(pages)} page{'s' if len(pages) != 1 else ''}"
    if renamed:
        where += f" and {len(renamed)} name{'s' if len(renamed) != 1 else ''}"
    out: dict[str, Any] = {
        "course": await course_ref(ctx, course),
        "replaced": replaced,
        "per_find": [{"find": clip(r.find, 80), "matches": n} for r, n in zip(p.replacements, totals)],
        "pages": pages[:MAX_PAGES_SHOWN],
    }
    if len(pages) > MAX_PAGES_SHOWN:
        out["pages_not_shown"] = len(pages) - MAX_PAGES_SHOWN
    if renamed:
        out["renamed"] = renamed
    if other_kinds:
        out["skipped_activities"] = other_kinds
    missing = _not_found(p.replacements, totals, texts)
    if missing:
        out["not_found"] = missing
    if p.preview:
        out["preview"] = True
        out["summary"] = f"Would change {where} in '{course.name}'. Nothing was saved."
        return out
    out["undo"] = undo
    return changed(f"Replaced text on {where} in '{course.name}'.", **out)


def _not_found(pairs: list[Replacement], totals: list[int], texts: list[str]) -> list[dict]:
    """Finds with no match, with a hint when only the capitalization differs."""
    out = []
    lowered = "\n".join(texts).lower()
    for pair, n in zip(pairs, totals):
        if n:
            continue
        item: dict[str, Any] = {"find": clip(pair.find, 80)}
        if pair.find.lower() in lowered:
            item["hint"] = "It occurs with different capitalization; matching is exact."
        out.append(item)
    return out


def _summary(p: ReplaceInCourseParams) -> str:
    first = p.replacements[0]
    more = f" and {len(p.replacements) - 1} more" if len(p.replacements) > 1 else ""
    verb = "Preview replacing" if p.preview else "Replace"
    return f"{verb} '{clip(first.find, 40)}' with '{clip(first.replace, 40)}'{more} across course {p.course_uuid}"


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="replace_in_course",
        title="Find and replace in a course",
        description=(
            "Find and replace exact text on every page of a course (or some chapters) in one call: "
            "up to 50 find/replace pairs, run in order, formatting kept, quiz, flipcard and scenario "
            "texts included. titles=true also renames pages and chapters. preview=true only counts "
            "and shows matches. Changing what learners see in a live course needs approval. Each "
            "page is saved as one version; returns an undo per page."
        ),
        params_model=ReplaceInCourseParams,
        tier=ActionTier.EDIT,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_replace_in_course,
        target_param="course_uuid",
        target_kind="course",
        approval_in_call=True,
        summarize=_summary,
    ),
]
