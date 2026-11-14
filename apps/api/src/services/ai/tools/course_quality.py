"""Course quality loop: a scored review of a whole course and a learner's-eye
preview of a page, so an assistant can build, check and fix in a loop.

`score_course` runs audit_course's rule checks and adds what makes a course
teach well: how much of each stated objective the pages cover, assessment
density (practice blocks and graded work per chapter), readability (Flesch
reading ease, per page), accessibility (images without alt text, skipped or
duplicate top-level headings, tables without a header row, vague link text)
and, with check_links, dead links, embeds and previews. It returns a 0-100
score per area, an overall score and the fixes ranked by how much they raise it.

`preview_activity` shows a page the way a learner sees it: conditional blocks
applied for a chosen learner, variables filled in, quiz answers and solutions
hidden, toggles closed.

Plain rules over the stored content, no model involved.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Literal

from pydantic import BaseModel, Field
from sqlmodel import select

from src.db.courses.activities import Activity, ActivityTypeEnum
from src.db.courses.assignments import Assignment
from src.db.courses.chapters import Chapter
from src.security.rbac import AccessAction, check_resource_access
from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.chapters import activity_ref, current_order
from src.services.ai.tools.course_audit import PRACTICE, _audit
from src.services.ai.tools.courses import _learnings_out
from src.services.ai.tools.link_check import check_links
from src.services.ai.tools.markdown import inline_markdown, render_block

_WORD = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ']+")
_SENTENCE = re.compile(r"[.!?]+(?:\s|$)")
_VOWELS = re.compile(r"[aeiouyà-ÿ]+", re.I)
_VAGUE_LINKS = {"click here", "here", "this", "link", "read more", "more", "this link"}
_STOP = frozenset(
    "a an the and or of to in on for with by from at as is are be can will your you how what why when use "
    "using understand learn know able basic basics into about their them this that these those".split()
)
WEIGHTS = {"structure": 25, "objectives": 15, "assessment": 20, "readability": 10, "accessibility": 20, "links": 10}


def syllables(word: str) -> int:
    word = word.lower().strip("'")
    if len(word) <= 3:
        return 1
    word = re.sub(r"(?:es|ed|e)$", "", word) or word
    return max(1, len(_VOWELS.findall(word)))


def flesch(text: str) -> float | None:
    """Flesch reading ease (higher is easier; 60-70 is plain English). None
    for too little text to judge."""
    words = _WORD.findall(text)
    if len(words) < 30:
        return None
    sentences = max(1, len(_SENTENCE.findall(text)))
    syl = sum(syllables(w) for w in words)
    return round(206.835 - 1.015 * (len(words) / sentences) - 84.6 * (syl / len(words)), 1)


def _terms(text: str) -> set[str]:
    return {w.lower() for w in _WORD.findall(text) if len(w) > 3 and w.lower() not in _STOP}


def _a11y(doc: dict, where: dict, issues: list[dict]) -> None:
    last_level = 1
    for path, node, _parent in d.walk_blocks(doc):
        t = d.kind(node)
        a = node.get("attrs") or {}
        if t == "blockImage" and not str(a.get("alt") or "").strip():
            issues.append({"area": "accessibility", "code": "image_no_alt", "message": "Image has no alt text.", "where": where, "path": list(path)})
        elif t == "heading":
            level = a.get("level") if isinstance(a.get("level"), int) else 2
            if level == 1:
                issues.append({"area": "accessibility", "code": "heading_h1", "message": "Level-1 heading inside a page (the page name is its title); use ## instead.", "where": where, "path": list(path)})
            elif level > last_level + 1:
                issues.append({"area": "accessibility", "code": "heading_skip", "message": f"Heading jumps from level {last_level} to {level}.", "where": where, "path": list(path)})
            last_level = level
        elif t == "table":
            first = d.children(d.children(node)[0]) if d.children(node) else []
            if first and not any(d.kind(c) == "tableHeader" for c in first):
                issues.append({"area": "accessibility", "code": "table_no_header", "message": "Table has no header row.", "where": where, "path": list(path)})
        elif t == "blockVideo" and not str(a.get("caption") or "").strip():
            issues.append({"area": "accessibility", "code": "video_no_caption", "message": "Video has no caption or description.", "where": where, "path": list(path)})
        if t in d.TEXT_HOLDERS:
            for child in d.children(node):
                marks = (child.get("marks") or []) if isinstance(child, dict) else []
                if any(m.get("type") == "link" for m in marks if isinstance(m, dict)) and str(child.get("text", "")).strip().lower() in _VAGUE_LINKS:
                    issues.append({"area": "accessibility", "code": "vague_link_text", "message": f"Link text '{child.get('text')}' does not say where it goes.", "where": where, "path": list(path)})


def _outside_urls(doc: dict) -> list[str]:
    urls = []
    for _path, node, _parent in d.walk_blocks(doc):
        a = node.get("attrs") or {}
        for key in ("embedUrl", "url", "h5pUrl"):
            if d.kind(node) in ("blockEmbed", "blockWebPreview", "blockH5P") and d.is_web_url(a.get(key)):
                urls.append(a[key])
    return urls


class ScoreCourseParams(BaseModel):
    course_uuid: str = Field(..., min_length=1, max_length=100, description="The course (course_...).")
    check_links: bool = Field(False, description="Also visit external links, embeds and previews (slower).")
    max_fixes: int = Field(15, ge=1, le=60, description="How many ranked fixes to return.")


async def _score_course(ctx: ToolContext, p: ScoreCourseParams):
    course = await refs.load(ctx, "course", p.course_uuid)
    await check_resource_access(ctx.request, ctx.db_session, ctx.user, course.course_uuid, AccessAction.UPDATE)
    audit = await _audit(ctx, course, None, "low", p.check_links)
    order, _c, _a = await current_order(ctx, course)
    chapters = {c.id: c for c in (await ctx.db_session.execute(select(Chapter).where(Chapter.id.in_([cid for cid, _ in order])))).scalars()}
    act_ids = [a for _, acts in order for a in acts]
    acts = {a.id: a for a in (await ctx.db_session.execute(select(Activity).where(Activity.id.in_(act_ids)))).scalars()}
    graded = set((await ctx.db_session.execute(select(Assignment.activity_id).where(Assignment.activity_id.in_(act_ids)))).scalars())

    issues: list[dict] = []
    page_scores: list[dict] = []
    covered_text: list[str] = []
    chapter_practice: list[tuple[str, int]] = []
    pages = practice_pages = 0
    urls: list[tuple[str, dict]] = []
    for cid, ids in order:
        chapter = chapters.get(cid)
        if chapter is None:
            continue
        practice_here = 0
        covered_text.append(chapter.name)
        for aid in ids:
            activity = acts.get(aid)
            if activity is None:
                continue
            covered_text.append(activity.name)
            if aid in graded:
                practice_here += 1
                continue
            if str(getattr(activity.activity_type, "value", activity.activity_type)) != ActivityTypeEnum.TYPE_DYNAMIC.value:
                continue
            pages += 1
            doc = d.normalize_legacy(d.ensure_doc(activity.content))
            where = await activity_ref(ctx, course.course_uuid, activity)
            text = d.block_text(doc)
            covered_text.append(text)
            kinds = Counter(d.kind(n) for _p, n, _x in d.walk_blocks(doc))
            practice = sum(kinds[t] for t in PRACTICE)
            practice_here += practice
            practice_pages += bool(practice)
            ease = flesch(text)
            if ease is not None:
                page_scores.append({"where": where, "reading_ease": ease})
                if ease < 30:
                    issues.append({"area": "readability", "code": "hard_to_read", "message": f"Reading ease {ease}: very dense; use shorter sentences and plainer words.", "where": where})
            _a11y(doc, where, issues)
            urls.extend((u, where) for u in _outside_urls(doc))
        chapter_practice.append((chapter.name, practice_here))
        if practice_here == 0 and ids:
            issues.append({"area": "assessment", "code": "chapter_no_practice", "message": f"Chapter '{chapter.name}' has no quiz, exercise, scenario, flashcards or assignment.", "where": refs.ref("chapter", chapter.chapter_uuid, chapter.name)})

    objectives = _learnings_out(course.learnings)
    corpus = _terms(" ".join(covered_text))
    coverage = []
    for objective in objectives:
        terms = _terms(objective)
        hit = len(terms & corpus) / len(terms) if terms else 1.0
        coverage.append({"objective": objective, "covered": round(hit, 2)})
        if hit < 0.5:
            issues.append({"area": "objectives", "code": "objective_not_covered", "message": f"Objective '{objective[:80]}' is barely mentioned in the course.", "where": refs.ref("course", course.course_uuid, course.name)})
    if not objectives:
        issues.append({"area": "objectives", "code": "no_objectives", "message": "The course states no learning objectives.", "where": refs.ref("course", course.course_uuid, course.name)})

    if p.check_links and urls:
        verdicts = await check_links([u for u, _w in urls])
        for url, where in urls:
            v = verdicts.get(url) or {}
            if v.get("state") == "broken":
                issues.append({"area": "links", "code": "broken_embed", "message": f"Embedded {url[:100]} is unreachable: {v.get('reason')}.", "where": where, "url": url})
    audit_links = [i for i in audit["issues"] if i["code"] in ("broken_link", "empty_link")]
    structural = [i for i in audit["issues"] if i not in audit_links]

    def clamp(x: float) -> int:
        return max(0, min(100, round(x)))

    penalty = {"high": 18, "medium": 8, "low": 3}
    scores = {
        "structure": clamp(100 - sum(penalty[i["severity"]] for i in structural)),
        "objectives": clamp(100 * (sum(c["covered"] >= 0.5 for c in coverage) / len(coverage)) if coverage else 40),
        "assessment": clamp(
            (60 * (sum(1 for _n, k in chapter_practice if k) / len(chapter_practice)) if chapter_practice else 0)
            + (40 * min(1.0, practice_pages / max(1, pages) / 0.5))
        ),
        "readability": clamp(
            sum(min(100, max(0, (s["reading_ease"] - 10) * 100 / 50)) for s in page_scores) / len(page_scores)
        ) if page_scores else 70,
        "accessibility": clamp(100 - 6 * sum(1 for i in issues if i["area"] == "accessibility")),
        "links": clamp(100 - 15 * (len(audit_links) + sum(1 for i in issues if i["area"] == "links"))),
    }
    overall = clamp(sum(scores[k] * w for k, w in WEIGHTS.items()) / sum(WEIGHTS.values()))
    gain = {"structure": {"high": 18, "medium": 8, "low": 3}, "accessibility": 6, "links": 15, "assessment": 12, "objectives": 10, "readability": 5}
    ranked = [{**i, "area": "structure" if i in structural else "links"} for i in audit["issues"]] + issues

    def weight(issue: dict) -> float:
        area = issue["area"]
        g = gain[area][issue.get("severity", "low")] if area == "structure" else gain[area]
        return g * WEIGHTS[area]

    ranked.sort(key=weight, reverse=True)
    grade = "excellent" if overall >= 85 else "good" if overall >= 70 else "needs work" if overall >= 50 else "weak"
    hardest = sorted(page_scores, key=lambda s: s["reading_ease"])[:3]
    return {
        "course": audit["course"],
        "score": overall,
        "grade": grade,
        "scores": scores,
        "weights": WEIGHTS,
        "figures": {
            **audit["figures"],
            "pages": pages,
            "pages_with_practice": practice_pages,
            "practice_per_chapter": {name: n for name, n in chapter_practice},
            "average_reading_ease": round(sum(s["reading_ease"] for s in page_scores) / len(page_scores), 1) if page_scores else None,
            "hardest_pages": hardest or None,
        },
        "objectives": coverage or None,
        "fixes": ranked[: p.max_fixes],
        "fixes_not_shown": max(0, len(ranked) - p.max_fixes) or None,
        "summary": f"'{course.name}' scores {overall}/100 ({grade}). Weakest: {min(scores, key=scores.get)} ({min(scores.values())}).",
        "next_step": "Fix the top items (edit_activity_content, add_blocks), then score again.",
    }


# ─── learner preview ─────────────────────────────────────────────────────────


class Learner(BaseModel):
    signed_in: bool = True
    enrolled: bool = True
    progress_percent: int = Field(0, ge=0, le=100)
    locale: str = Field("en", max_length=20)
    role: Literal["member", "maintainer", "admin", "anonymous"] = "member"
    usergroup_uuids: list[str] = Field(default_factory=list, max_length=50)
    first_name: str = Field("Alex", max_length=60)


class PreviewActivityParams(BaseModel):
    activity_uuid: str = Field(..., min_length=1, max_length=100, description="The page (activity_...).")
    learner: Learner = Field(default_factory=Learner, description="Who to preview as: decides conditional blocks and variables.")


def _learner_lines(node: dict, depth: int = 0) -> list[str]:
    t = d.kind(node)
    a = node.get("attrs") or {}
    if t == "blockQuiz":
        lines = ["**Quiz**"]
        for n, q in enumerate(a.get("questions") or [], 1):
            lines.append(f"{n}. {q.get('question', '')}")
            box = "[ ]" if q.get("response_type") == "multiple" else "( )"
            lines += [f"   {box} {x.get('answer', '')}" for x in q.get("answers") or []]
        return lines
    if t == "flipcard":
        return [f"🂠 **{a.get('question', '')}** (flip to reveal)"]
    if t == "flipcardGrid":
        return [line for c in d.children(node) for line in _learner_lines(c, depth + 1)]
    if t == "blockCode":
        return ["**Coding exercise** (" + str(a.get("languageName") or "") + ")", str(a.get("description") or ""), "```", str(a.get("starterCode") or "").rstrip(), "```"] + (
            [f"{len(a.get('testCases') or [])} test(s) check the answer."] if a.get("testCases") else []
        )
    if t == "scenarios":
        steps = a.get("scenarios") or []
        first = steps[0] if steps else {}
        return [f"**Scenario: {a.get('title', '')}**", str(first.get("text", ""))] + [f"- [{o.get('text', '')}]" for o in first.get("options") or []]
    if t == "toggleBlock":
        if a.get("defaultOpen"):
            return [f"▾ {a.get('summary', '')}"] + [line for c in d.children(node) for line in _learner_lines(c, depth + 1)]
        return [f"▸ {a.get('summary', '')} (collapsed)"]
    if t == "blockMagic":
        return [f"[Interactive: {a.get('title', '')}]"]
    if t in d.MEDIA_TYPES:
        label = t.removeprefix("block")
        alt = a.get("alt") or a.get("caption") or ""
        return [f"[{label}{': ' + alt if alt else ''}]"]
    if t == "blockEmbed":
        return [f"[Embedded {a.get('embedProvider') or 'content'}: {a.get('embedSourceUrl') or a.get('embedUrl') or ''}]"]
    if t == "blockUser":
        return ["[Member card]"]
    if t == "paragraph":
        return [inline_markdown(d.children(node))]
    return render_block(node, [0], depth)


async def _preview_activity(ctx: ToolContext, p: PreviewActivityParams):
    from datetime import date

    from src.services.ai.tools.content_edit import load_page
    from src.services.courses.activities.dynamic_content import RenderContext, render_document

    page = await load_page(ctx, p.activity_uuid, AccessAction.UPDATE)
    doc = d.normalize_legacy(d.ensure_doc(page.activity.content))
    total = 100
    learner = p.learner
    rctx = RenderContext(
        signed_in=learner.signed_in and learner.role != "anonymous",
        first_name=learner.first_name,
        role=learner.role if learner.signed_in else "anonymous",
        group_uuids=frozenset(learner.usergroup_uuids),
        locale=learner.locale,
        org_name=ctx.org.name or "",
        course_name=page.course.name or "",
        activity_name=page.activity.name or "",
        activity_uuid=page.uuid,
        enrolled=learner.enrolled,
        progress_completed=learner.progress_percent,
        progress_total=total,
        bucket=0,
        today=date.today(),
    )
    rendered, stats = render_document(doc, rctx)
    lines: list[str] = []
    for node in (rendered or {}).get("content") or []:
        if lines:
            lines.append("")
        lines.extend(_learner_lines(node))
    return {
        "activity": await page.ref(ctx),
        "as": learner.model_dump(),
        "published": bool(page.activity.published),
        "preview": "\n".join(lines).strip()[:60_000],
        "conditional_blocks": {"shown": stats.shown_blocks, "hidden": stats.hidden_blocks},
        "note": "Answers, solutions and collapsed toggles are hidden as a learner sees them.",
    }


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="score_course",
        title="Score a course",
        description=(
            "Score a whole course 0-100 with a grade and per-area scores: structure (audit_course "
            "checks), objectives coverage, assessment density per chapter, readability (reading ease "
            "per page), accessibility (alt text, heading order, table headers, vague links) and links "
            "(check_links visits links, embeds and previews). Returns the fixes ranked by impact, "
            "with block paths. Read only; editors only."
        ),
        params_model=ScoreCourseParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_score_course,
        target_param="course_uuid",
        target_kind="course",
        idempotent=True,
    ),
    ToolSpec(
        name="preview_activity",
        title="Preview a page as a learner",
        description=(
            "Show a page the way a learner sees it: conditional blocks applied for the learner you "
            "describe (signed in, enrolled, progress, groups, language), variables filled in, quiz "
            "answers and solutions hidden, toggles closed. Editors only."
        ),
        params_model=PreviewActivityParams,
        tier=ActionTier.READ,
        rights_bucket="activities",
        access_action=AccessAction.READ,
        execute=_preview_activity,
        target_param="activity_uuid",
        target_kind="activity",
        idempotent=True,
    ),
]
