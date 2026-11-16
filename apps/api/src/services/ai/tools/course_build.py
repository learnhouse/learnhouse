"""Build or update a whole course from one structured spec.

`build_course` takes the course's details, its chapters and their activities
(pages written as Markdown or typed blocks, video and PDF activities, graded
assignments with tasks) and course settings (certificate, drip, SEO,
languages, publishing), and makes the course match it:

* everything is validated first (every page against the editor schema), so a
  bad block fails the call before anything is written;
* ``dry_run`` returns the plan as a diff (what would be created, changed or
  left alone) without writing or asking for approval;
* with ``course_uuid`` it updates that course: chapters and activities are
  matched by ``key`` (remembered per idempotency key), then by name; nothing
  is ever deleted;
* ``idempotency_key`` makes retries safe: the same key and spec replays the
  finished result or resumes an interrupted build, creating only what is
  missing;
* a failing item does not stop the build: the result lists what was created
  (with ids), what failed and why, and how to resume.

Every write runs as the caller with the services' own checks, and steps that
belong to other tools (assignments, certificate, drip, SEO, languages,
publishing, media activities) run through `run_tool`, so token rights and
approvals apply to them exactly as if called one by one. What needs a
person's yes (outside files, custom HTML, publishing) is asked once, up front.

`add_blocks` and `validate_content` expose the typed blocks (block_specs.py)
on their own. These tools are offered on MCP only (see TOOL_MODULES), so the
in-app agent's tool list does not grow.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError, model_validator
from sqlmodel import select

from src.core.redis import get_redis_client
from src.db.courses.activities import Activity, ActivityCreate, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapters import Chapter, ChapterCreate, ChapterUpdate
from src.db.courses.courses import CourseCreate, CourseUpdate
from src.security.auth import resolve_acting_user_id
from src.security.rbac import AccessAction, check_resource_access
from src.services.ai.tools import block_specs as bs
from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, require_approval
from src.services.ai.tools.chapters import activity_ref, course_ref, current_order, write_order
from src.services.ai.tools.content_assets import attach_media, check_media, media_reason
from src.services.ai.tools.content_edit import load_editable, save
from src.services.ai.tools.markdown import MAX_CHARS, Converted, convert, doc_to_markdown
from src.services.ai.tools.progress import report_progress
from src.services.ai.tools.results import changed

logger = logging.getLogger(__name__)

MAX_CHAPTERS = 60
MAX_ACTIVITIES = 200
MAX_SPEC_CHARS = 1_500_000
RECORD_TTL = 14 * 24 * 3600
DIFF_CHARS = 1500
_RECORD = "mcp:course-build:{org}:{who}:{key}"


# ─── the spec ────────────────────────────────────────────────────────────────


class CourseMeta(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200, description="Course name (required to create).")
    description: str | None = Field(None, max_length=1000, description="One or two sentences for the course card.")
    about: str | None = Field(None, max_length=10_000, description="Longer presentation (plain text).")
    objectives: list[str] | None = Field(
        None, max_length=20, description="Learning objectives: what learners will be able to do (shown as 'What you will learn')."
    )
    prerequisites: list[str] | None = Field(
        None, max_length=20, description="What learners should know first; added to the course presentation."
    )
    tags: list[str] | None = Field(None, max_length=20, description="Short keywords.")
    thumbnail_url: str | None = Field(
        None, min_length=8, max_length=2048, description="Public image URL to fetch as the cover (needs approval)."
    )

    @model_validator(mode="after")
    def _caps(self):
        for name, items, limit in (("objectives", self.objectives, 300), ("prerequisites", self.prerequisites, 300), ("tags", self.tags, 60)):
            if items and any(len(i) > limit or not i.strip() for i in items):
                raise ValueError(f"each of {name} is 1 to {limit} characters")
        return self


ActivityKind = Literal["page", "video", "youtube", "pdf", "assignment"]


class ActivitySpec(BaseModel):
    kind: ActivityKind = Field(
        "page",
        description=(
            "page: content from markdown and/or blocks; youtube/video/pdf: a media activity from url; "
            "assignment: a graded assignment with tasks (quiz, short_answer, number_answer, form, "
            "file_submission, code)."
        ),
    )
    key: str | None = Field(
        None, min_length=1, max_length=100,
        description="Your stable id for this activity, so a later build updates it instead of adding another.",
    )
    name: str = Field(..., min_length=1, max_length=200, description="Activity name (assignment title).")
    markdown: str | None = Field(None, max_length=MAX_CHARS, description="page: Markdown, rich fences included.")
    blocks: list[dict[str, Any]] | None = Field(
        None, max_length=bs.MAX_BLOCKS,
        description=(
            "page: typed blocks appended after the markdown, each {type, ...}: "
            + ", ".join(bs.BLOCK_TYPES)
            + ". Shapes and examples: resource learnhouse://blocks or validate_content."
        ),
    )
    url: str | None = Field(None, min_length=8, max_length=2048, description="youtube/video/pdf: the link or file URL.")
    description: str | None = Field(None, max_length=4000, description="assignment: instructions.")
    due_date: str | None = Field(None, max_length=40, description="assignment: ISO date or date-time.")
    grading_type: Literal["percentage", "alphabet", "numeric", "pass_fail", "gpa_scale"] | None = Field(
        None, description="assignment: how grades show (default percentage)."
    )
    auto_grading: bool | None = Field(None, description="assignment: grade on submit when every task has an answer key.")
    allow_retries: bool | None = None
    max_retries: int | None = Field(None, ge=0, le=100)
    show_correct_answers: bool | None = None
    tasks: list[dict[str, Any]] | None = Field(
        None, max_length=50,
        description=(
            "assignment: tasks, each {type, title, description?, hint?, points?, ...}; type quiz "
            "{questions:[{text, options:[{text, correct}]}], partial_credit?}, short_answer {prompt, "
            "accepted_answers}, number_answer {prompt, correct_value, tolerance?}, form {questions:[{text, "
            "blanks:[{answer}]}]}, file_submission {}, code {language_id, tests:[{stdin, expected_output}]}."
        ),
    )

    @model_validator(mode="after")
    def _fits_kind(self):
        page_only = ("markdown", "blocks")
        media_only = ("url",)
        assignment_only = ("description", "due_date", "grading_type", "auto_grading", "allow_retries", "max_retries", "show_correct_answers", "tasks")
        allowed = {"page": page_only, "assignment": assignment_only}.get(self.kind, media_only)
        stray = [f for f in (*page_only, *media_only, *assignment_only) if f not in allowed and getattr(self, f) is not None]
        if stray:
            raise ValueError(f"{', '.join(stray)} cannot be set on a {self.kind} activity")
        if self.kind in ("youtube", "video", "pdf") and not self.url:
            raise ValueError(f"a {self.kind} activity needs url")
        return self


class ChapterSpec(BaseModel):
    key: str | None = Field(None, min_length=1, max_length=100, description="Your stable id for this chapter.")
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=1000)
    activities: list[ActivitySpec] = Field(default_factory=list, max_length=MAX_ACTIVITIES)


class DripChapterSpec(BaseModel):
    chapter: str = Field(..., min_length=1, max_length=200, description="Chapter key or name from this spec.")
    mode: Literal["immediate", "delay", "date"]
    delay_days: int | None = Field(None, ge=0, le=3650)
    release_at: str | None = Field(None, max_length=40)
    require_previous: bool | None = None


class DripSpec(BaseModel):
    enabled: bool = True
    anchor: Literal["enrollment", "fixed_date"] | None = None
    start_date: str | None = Field(None, max_length=40)
    notify_email: bool | None = None
    chapters: list[DripChapterSpec] = Field(default_factory=list, max_length=MAX_CHAPTERS)


class SeoSpec(BaseModel):
    title: str | None = Field(None, max_length=120)
    description: str | None = Field(None, max_length=320)
    image_alt: str | None = Field(None, max_length=250)


class SettingsSpec(BaseModel):
    certificate: dict[str, Any] | None = Field(
        None, description="Certificate on completion: {enabled, name, description, type, pattern, instructor} (see set_course_certificate)."
    )
    drip: DripSpec | None = Field(None, description="Release chapters over time.")
    seo: SeoSpec | None = Field(None, description="Search result title and description.")
    languages: list[str] | None = Field(
        None, max_length=20, description="Extra language versions to add (locale codes like fr, es, pt-BR); translate them afterwards."
    )
    publish: bool | None = Field(None, description="true publishes the course and its activities (needs approval); default: keep it a draft.")


class BuildCourseParams(BaseModel):
    course_uuid: str | None = Field(
        None, max_length=100, description="Update this course instead of creating one (match by key, then by name; nothing is deleted)."
    )
    idempotency_key: str | None = Field(
        None, min_length=8, max_length=100,
        description="Any unique string for this build. Retrying with the same key and spec resumes or replays instead of duplicating.",
    )
    dry_run: bool = Field(False, description="Validate and return the plan as a diff; write nothing.")
    course: CourseMeta | None = Field(None, description="Course details. name is required when creating.")
    chapters: list[ChapterSpec] = Field(default_factory=list, max_length=MAX_CHAPTERS, description="Chapters in order.")
    settings: SettingsSpec | None = None

    @model_validator(mode="after")
    def _shape(self):
        if not self.course_uuid and not (self.course and self.course.name):
            raise ValueError("pass course.name to create a course, or course_uuid to update one")
        total = sum(len(c.activities) for c in self.chapters)
        if total > MAX_ACTIVITIES:
            raise ValueError(f"at most {MAX_ACTIVITIES} activities per build; build in parts with course_uuid")
        size = len(json.dumps(self.model_dump(mode="json"), ensure_ascii=False))
        if size > MAX_SPEC_CHARS:
            raise ValueError(f"the spec is {size} characters; at most {MAX_SPEC_CHARS} per build, build in parts with course_uuid")
        for kind, items in (("chapter", self.chapters), ("activity", [a for c in self.chapters for a in c.activities])):
            keys = [i.key for i in items if i.key]
            if len(keys) != len(set(keys)):
                raise ValueError(f"{kind} keys must be unique")
        return self


# ─── planning ────────────────────────────────────────────────────────────────


class StepFailed(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class PlannedActivity:
    spec: ActivitySpec
    item_key: str
    digest: str
    action: str = "create"  # create | update | unchanged
    uuid: str | None = None
    converted: Converted | None = None
    old_doc: dict | None = None
    changes: list[str] = field(default_factory=list)
    diff: str | None = None
    tasks: list[Any] = field(default_factory=list)


@dataclass
class PlannedChapter:
    spec: ChapterSpec
    item_key: str
    action: str = "create"
    uuid: str | None = None
    changes: list[str] = field(default_factory=list)
    activities: list[PlannedActivity] = field(default_factory=list)


@dataclass
class Plan:
    course_action: str
    course_uuid: str | None
    course_changes: dict[str, Any]
    chapters: list[PlannedChapter]
    calls: list[tuple[str, str, dict]]  # (label, tool, args) run after the content
    reasons: list[str]
    fetches: bool
    record: dict | None
    digest: str


def _digest(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def _who(ctx: ToolContext) -> str:
    from src.db.users import APITokenUser

    if isinstance(ctx.user, APITokenUser):
        return f"t{ctx.user.id}"
    return f"u{resolve_acting_user_id(ctx.user)}"


def _record_key(ctx: ToolContext, key: str) -> str:
    return _RECORD.format(org=ctx.org.id, who=_who(ctx), key=hashlib.sha256(key.encode()).hexdigest()[:32])


def _keys_key(ctx: ToolContext, course_uuid: str) -> str:
    return f"mcp:course-build-keys:{ctx.org.id}:{course_uuid}"


def load_course_keys(ctx: ToolContext, course_uuid: str) -> dict:
    """The spec keys every earlier build of this course used, so an update
    finds a renamed chapter or page by its key."""
    client = get_redis_client()
    try:
        raw = client.get(_keys_key(ctx, course_uuid)) if client is not None else None
    except Exception:
        logger.warning("course-build: could not read course keys", exc_info=True)
        return {}
    return json.loads(raw) if raw else {}


def save_course_keys(ctx: ToolContext, course_uuid: str, items: dict) -> None:
    client = get_redis_client()
    if client is None:
        return
    try:
        client.set(_keys_key(ctx, course_uuid), json.dumps({**load_course_keys(ctx, course_uuid), **items}), ex=RECORD_TTL * 26)
    except Exception:
        logger.warning("course-build: could not save course keys", exc_info=True)


def load_record(ctx: ToolContext, key: str | None) -> dict | None:
    if not key:
        return None
    client = get_redis_client()
    if client is None:
        return None
    try:
        raw = client.get(_record_key(ctx, key))
    except Exception:
        logger.warning("course-build: could not read idempotency record", exc_info=True)
        return None
    return json.loads(raw) if raw else None


def save_record(ctx: ToolContext, key: str | None, record: dict) -> bool:
    if not key:
        return False
    client = get_redis_client()
    if client is None:
        return False
    try:
        client.set(_record_key(ctx, key), json.dumps(record, default=str), ex=RECORD_TTL)
        return True
    except Exception:
        logger.warning("course-build: could not save idempotency record", exc_info=True)
        return False


def _learnings(items: list[str]) -> str:
    from src.services.ai.tools.courses import _learnings_in

    return _learnings_in(items)


def _about(meta: CourseMeta, current: str | None) -> str | None:
    if meta.about is None and not meta.prerequisites:
        return None
    about = meta.about if meta.about is not None else (current or "")
    if meta.prerequisites:
        marker = "Before you start:"
        about = about.split(f"\n\n{marker}")[0].removesuffix(marker).rstrip()
        lines = "\n".join(f"- {p}" for p in meta.prerequisites)
        about = f"{about}\n\n{marker}\n{lines}".strip()
    return about[:10_000]


def _course_fields(meta: CourseMeta | None, current: Any | None) -> dict[str, Any]:
    from src.services.ai.tools.courses import _tags_in

    if meta is None:
        return {}
    fields: dict[str, Any] = {}
    for key in ("name", "description"):
        value = getattr(meta, key)
        if value is not None:
            fields[key] = value
    about = _about(meta, getattr(current, "about", None))
    if about is not None:
        fields["about"] = about
    if meta.objectives is not None:
        fields["learnings"] = _learnings(meta.objectives)
    if meta.tags is not None:
        fields["tags"] = _tags_in(meta.tags)
    if current is not None:
        fields = {k: v for k, v in fields.items() if (getattr(current, k) or "") != v}
    return fields


async def _page_doc(ctx: ToolContext, spec: ActivitySpec, where: str) -> Converted:
    parts: list[Converted] = []
    try:
        if spec.markdown:
            parts.append(convert(spec.markdown, media=True))
        if spec.blocks:
            parts.append(await bs.convert_blocks(ctx, spec.blocks))
    except bs.BlockError as e:
        raise HTTPException(status_code=400, detail=f"{where}: {e}")
    except HTTPException as e:
        raise HTTPException(status_code=400, detail=f"{where}: {e.detail}")
    if not parts:
        return Converted({"type": "doc", "content": [d.paragraph()]})
    content = [n for p in parts for n in p.doc["content"] if not (len(parts) > 1 and n == d.paragraph())]
    doc = {"type": "doc", "content": content or [d.paragraph()]}
    try:
        d.check_loadable(doc)
    except d.DocError as e:
        raise HTTPException(status_code=400, detail=f"{where}: {e}")
    return Converted(doc, sorted({n for p in parts for n in p.notes}), [m for p in parts for m in p.media])


def _tasks(spec: ActivitySpec, where: str) -> list[Any]:
    from pydantic import TypeAdapter

    from src.services.ai.tools.assignments import TaskSpec

    if not spec.tasks:
        return []
    try:
        return TypeAdapter(list[TaskSpec]).validate_python(spec.tasks)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=f"{where}: tasks: {bs.validation_message(e)}")


def _markdown_of(doc: Any) -> str:
    try:
        return doc_to_markdown(d.normalize_legacy(d.ensure_doc(doc)))
    except Exception:  # pragma: no cover - rendering never fails on a loadable doc
        return ""


def _diff(old: str, new: str) -> tuple[str, str]:
    lines = list(difflib.unified_diff(old.splitlines(), new.splitlines(), "current", "new", lineterm="", n=1))
    added = sum(1 for x in lines if x.startswith("+") and not x.startswith("+++"))
    removed = sum(1 for x in lines if x.startswith("-") and not x.startswith("---"))
    text = "\n".join(lines)
    if len(text) > DIFF_CHARS:
        text = text[:DIFF_CHARS] + "\n... (diff clipped)"
    return f"content: +{added} -{removed} lines", text


def _match(items: list[tuple[str, str, int]], used: set[int], key_uuid: str | None, name: str) -> tuple[str, int] | None:
    """(uuid, index) of an existing item: the remembered uuid for the key
    first, then the first unused one with the same name."""
    if key_uuid:
        for i, (uuid, _n, _x) in enumerate(items):
            if uuid == key_uuid and i not in used:
                return uuid, i
    wanted = name.strip().lower()
    for i, (uuid, existing, _x) in enumerate(items):
        if i not in used and existing.strip().lower() == wanted:
            return uuid, i
    return None


async def _existing(ctx: ToolContext, course: Any) -> list[tuple[str, str, int, list[tuple[str, str, int]]]]:
    """[(chapter_uuid, name, id, [(activity_uuid, name, id)])] in order."""
    order, _chapters, _activities = await current_order(ctx, course)
    chapter_rows = {
        c.id: c for c in (await ctx.db_session.execute(select(Chapter).where(Chapter.id.in_([cid for cid, _ in order])))).scalars()
    }
    act_ids = [a for _, acts in order for a in acts]
    act_rows = {a.id: a for a in (await ctx.db_session.execute(select(Activity).where(Activity.id.in_(act_ids)))).scalars()}
    out = []
    for cid, acts in order:
        c = chapter_rows.get(cid)
        if c is None:
            continue
        out.append((c.chapter_uuid, c.name, cid, [(act_rows[a].activity_uuid, act_rows[a].name, a) for a in acts if a in act_rows]))
    return out


async def plan_build(ctx: ToolContext, p: BuildCourseParams) -> Plan:
    from src.services.ai.tools import get_registry

    spec_digest = _digest(p.model_dump(mode="json", exclude={"dry_run"}))
    record = load_record(ctx, p.idempotency_key)
    course_uuid = p.course_uuid
    if record:
        if record.get("digest") != spec_digest:
            raise HTTPException(
                status_code=409,
                detail=(
                    "This idempotency_key was used for a different spec. To change the course, call again with "
                    f"course_uuid={record.get('course_uuid')} (update mode) and a new idempotency_key."
                ),
            )
        course_uuid = course_uuid or record.get("course_uuid")
    keys: dict[str, str] = (record or {}).get("items", {})

    course = None
    existing: list = []
    if course_uuid:
        course = await refs.load(ctx, "course", course_uuid)
        await check_resource_access(ctx.request, ctx.db_session, ctx.user, course.course_uuid, AccessAction.UPDATE)
        existing = await _existing(ctx, course)
        keys = {**load_course_keys(ctx, course.course_uuid), **keys}

    # Pages, tasks and blocks: all validated before anything is written.
    planned: list[PlannedChapter] = []
    used_chapters: set[int] = set()
    chapter_items = [(u, n, cid) for u, n, cid, _a in existing]
    for ci, ch in enumerate(p.chapters, 1):
        ckey = f"c:{ch.key or ch.name.strip().lower()}"
        pc = PlannedChapter(ch, ckey)
        hit = _match(chapter_items, used_chapters, keys.get(ckey), ch.name) if existing else None
        old_acts: list[tuple[str, str, int]] = []
        if hit:
            used_chapters.add(hit[1])
            pc.uuid = hit[0]
            old_name = existing[hit[1]][1]
            old_acts = existing[hit[1]][3]
            pc.action = "unchanged"
            row = await refs.load(ctx, "chapter", pc.uuid)
            if old_name != ch.name:
                pc.changes.append(f"name: {old_name!r} -> {ch.name!r}")
            if ch.description is not None and (row.description or "") != ch.description:
                pc.changes.append("description")
            if pc.changes:
                pc.action = "update"
        used_acts: set[int] = set()
        for ai, act in enumerate(ch.activities, 1):
            where = f"Chapter {ci} '{ch.name}', activity {ai} '{act.name}'"
            akey = f"a:{ckey}/{act.key or act.name.strip().lower()}"
            pa = PlannedActivity(act, akey, _digest(act.model_dump(mode="json")))
            if act.kind == "page":
                pa.converted = await _page_doc(ctx, act, where)
            elif act.kind == "assignment":
                pa.tasks = _tasks(act, where)
            hit_a = _match(old_acts, used_acts, (keys.get(akey) or {}).get("uuid") if isinstance(keys.get(akey), dict) else None, act.name) if old_acts else None
            if hit_a:
                used_acts.add(hit_a[1])
                pa.uuid = hit_a[0]
                pa.action = "unchanged"
                remembered = keys.get(akey)
                if isinstance(remembered, dict) and remembered.get("digest") == pa.digest:
                    pc.activities.append(pa)
                    continue
                row = await refs.load(ctx, "activity", pa.uuid)
                if row.name != act.name:
                    pa.changes.append(f"name: {row.name!r} -> {act.name!r}")
                kind = str(getattr(row.activity_type, "value", row.activity_type))
                if act.kind == "page":
                    if kind != ActivityTypeEnum.TYPE_DYNAMIC.value:
                        raise HTTPException(status_code=400, detail=f"{where}: '{row.name}' exists and is not a page; give it another name or key.")
                    pa.old_doc = d.normalize_legacy(d.ensure_doc(row.content))
                    old_md, new_md = _markdown_of(pa.old_doc), _markdown_of(pa.converted.doc)
                    if pa.converted.media or old_md != new_md:
                        summary, pa.diff = _diff(old_md, new_md)
                        pa.changes.append(summary if old_md != new_md else "content: files to fetch again")
                elif act.kind == "assignment" and kind != ActivityTypeEnum.TYPE_ASSIGNMENT.value:
                    raise HTTPException(status_code=400, detail=f"{where}: '{row.name}' exists and is not an assignment.")
                elif act.kind == "assignment":
                    pa.changes.append("assignment settings")
                elif act.kind != "assignment":
                    pa.action = "unchanged"  # media activities are not re-fetched
                if pa.changes:
                    pa.action = "update"
            pc.activities.append(pa)
        planned.append(pc)

    course_changes = _course_fields(p.course, course)
    reasons: list[str] = []
    media = [m for pc in planned for pa in pc.activities if pa.converted and pa.action != "unchanged" for m in pa.converted.media]
    try:
        check_media(media)
    except HTTPException as e:
        raise HTTPException(status_code=400, detail=e.detail)
    if media:
        reasons.append(media_reason(media))
    risky = sorted({
        t for pc in planned for pa in pc.activities
        if pa.converted and pa.action != "unchanged"
        for t in d.added_risky(pa.old_doc or {}, pa.converted.doc)
    })
    if risky:
        reasons.append(f"Adds {', '.join(risky)} blocks (custom HTML or outside content).")
    fetch_acts = [pa for pc in planned for pa in pc.activities if pa.spec.kind in ("video", "pdf") and pa.action == "create"]
    if fetch_acts:
        reasons.append(f"Fetches {len(fetch_acts)} video or PDF file(s) for media activities.")
    if p.course and p.course.thumbnail_url:
        reasons.append("Fetches the cover image from an outside link.")

    calls = _setting_calls(p, planned)
    registry = get_registry()
    for label, tool, args in calls:
        spec = registry.get(tool)
        try:
            needs = spec is not None and spec.approval_for(spec.params_model.model_validate(_call_args(tool, args, "course_planned", {})))
        except ValidationError as e:
            raise HTTPException(status_code=400, detail=f"settings ({label}): {bs.validation_message(e)}")
        if needs:
            reasons.append(f"{label}.")
    fetches = bool(media or fetch_acts or (p.course and p.course.thumbnail_url))
    return Plan(
        course_action="update" if course else "create",
        course_uuid=course.course_uuid if course else None,
        course_changes=course_changes,
        chapters=planned,
        calls=calls,
        reasons=reasons,
        fetches=fetches,
        record=record,
        digest=spec_digest,
    )


def _call_args(tool: str, args: dict, course_uuid: str, chapter_ids: dict[str, str]) -> dict:
    """A setting call's arguments for a course (and its chapters once known)."""
    if tool == "update_seo":
        return {"resource_uuid": course_uuid, **args}
    args = {"course_uuid": course_uuid, **args}
    if tool == "set_drip_schedule":
        args["chapters"] = [
            {**c, "chapter_uuid": chapter_ids.get(c["chapter_uuid"].removeprefix("chapter_ref:"), c["chapter_uuid"])}
            for c in args.get("chapters", [])
        ]
    return args


def _setting_calls(p: BuildCourseParams, planned: list[PlannedChapter]) -> list[tuple[str, str, dict]]:
    """Settings as calls to their own tools; course_uuid is filled in at run
    time, chapter references once the chapters exist (as {"chapter": key})."""
    s = p.settings
    if s is None:
        return []
    calls: list[tuple[str, str, dict]] = []
    if s.certificate is not None:
        calls.append(("Set the certificate", "set_course_certificate", dict(s.certificate)))
    if s.drip is not None:
        known = {pc.spec.key for pc in planned if pc.spec.key} | {pc.spec.name for pc in planned}
        chapters = []
        for rule in s.drip.chapters:
            if rule.chapter not in known:
                raise HTTPException(status_code=400, detail=f"settings.drip: chapter '{rule.chapter}' is not a chapter key or name in this spec.")
            chapters.append({"chapter_uuid": f"chapter_ref:{rule.chapter}", **rule.model_dump(exclude={"chapter"}, exclude_none=True)})
        args = {**s.drip.model_dump(exclude={"chapters"}, exclude_none=True), "chapters": chapters}
        calls.append(("Set the drip schedule", "set_drip_schedule", args))
    if s.seo is not None and s.seo.model_dump(exclude_none=True):
        calls.append(("Set SEO", "update_seo", {"resource_type": "course", **s.seo.model_dump(exclude_none=True)}))
    for locale in s.languages or []:
        calls.append((f"Add the {locale} language version", "add_course_language", {"locale": locale}))
    if s.publish:
        calls.append(("Publish the course and its activities", "update_course", {"published": True, "publish_activities": True}))
    return calls


# ─── running ─────────────────────────────────────────────────────────────────


async def _sub(ctx: ToolContext, tool: str, args: dict) -> Any:
    from src.services.ai.tools import get_registry
    from src.services.ai.tools.registry import run_tool

    outcome = await run_tool(get_registry(), tool, args, ctx)
    if outcome.status != "executed":
        raise StepFailed(outcome.denied_code or "denied", outcome.reason or f"{tool} refused")
    return outcome.result


class _Run:
    def __init__(self, ctx: ToolContext, total: int):
        self.ctx = ctx
        self.total = max(total, 1)
        self.done = 0
        self.failed: list[dict] = []
        self.counts = {"created": 0, "updated": 0, "unchanged": 0}

    def tick(self, label: str) -> None:
        self.done += 1
        report_progress(min(self.done, self.total), self.total, label)

    async def fail(self, what: str, error: Exception, **extra: Any) -> None:
        if isinstance(error, StepFailed):
            code, message = error.code, error.message
        elif isinstance(error, HTTPException):
            code, message = f"http_{error.status_code}", str(error.detail)
        else:
            code, message = "internal_error", "failed unexpectedly"
            logger.exception("course-build: step failed: %s", what)
        self.failed.append({"item": what, "code": code, "message": message, **extra})
        # Steps commit as they go; a failed one may leave the transaction
        # unusable. Roll it back and reload the org row the rollback expired.
        try:
            await self.ctx.db_session.rollback()
            await self.ctx.db_session.refresh(self.ctx.org)
        except Exception:  # pragma: no cover - a broken session is reported by the next step
            logger.warning("course-build: could not reset the session", exc_info=True)


async def _create_course(ctx: ToolContext, p: BuildCourseParams, fields: dict) -> Any:
    from src.services.courses.courses import create_course

    created = await create_course(
        ctx.request,
        ctx.org.id,
        CourseCreate(
            **{"description": "", "about": "", **fields},
            public=False, published=False, open_to_contributors=False, org_id=ctx.org.id,
        ),
        ctx.user,
        ctx.db_session,
        creation_source="ai",
    )
    return await refs.load(ctx, "course", created.course_uuid)


async def _write_page(ctx: ToolContext, course: Any, chapter: Any, pa: PlannedActivity) -> dict:
    from src.services.courses.activities.activities import create_activity

    converted = pa.converted
    if pa.action == "create":
        ready = not course.published
        activity = await create_activity(
            ctx.request,
            ActivityCreate(
                name=pa.spec.name, chapter_id=chapter.id, activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
                activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE, content=converted.doc, published=ready,
            ),
            ctx.user,
            ctx.db_session,
        )
        uuid = activity.activity_uuid
    else:
        uuid = pa.uuid
        page, _doc = await load_editable(ctx, uuid)
        if pa.spec.name != page.activity.name:
            from src.db.courses.activities import ActivityUpdate
            from src.services.courses.activities.activities import update_activity

            await update_activity(ctx.request, ActivityUpdate(name=pa.spec.name), uuid, ctx.user, ctx.db_session)
            page, _doc = await load_editable(ctx, uuid)
        if any(c.startswith("content") for c in pa.changes):
            await save(ctx, page, converted.doc)
    out: dict[str, Any] = {}
    stored = await attach_media(ctx, uuid, converted.media)
    if stored:
        stored.pop("version_after", None)
        out["media"] = stored
    activity = await refs.load(ctx, "activity", uuid)
    out.update(await activity_ref(ctx, course.course_uuid, activity))
    return out


async def _write_assignment(ctx: ToolContext, chapter_uuid: str, pa: PlannedActivity) -> dict:
    a = pa.spec
    settings = {
        k: getattr(a, k) for k in ("description", "due_date", "grading_type", "auto_grading", "allow_retries", "max_retries", "show_correct_answers")
        if getattr(a, k) is not None
    }
    if pa.action == "create":
        created = await _sub(ctx, "create_assignment", {"chapter_uuid": chapter_uuid, "title": a.name, **settings})
        assignment = created.get("assignment") or {}
        assignment_uuid = assignment.get("uuid")
        out = {"assignment": assignment, **({"activity": created["activity"]} if created.get("activity") else {})}
        if a.tasks and assignment_uuid:
            tasks = await _sub(ctx, "create_assignment_tasks", {"assignment_uuid": assignment_uuid, "tasks": a.tasks})
            out["tasks"] = len(tasks.get("tasks") or a.tasks)
        return out
    found = await _sub(ctx, "get_assignment", {"activity_uuid": pa.uuid})
    assignment_uuid = found.get("uuid")
    await _sub(ctx, "update_assignment", {"assignment_uuid": assignment_uuid, "title": a.name, **settings})
    return {"assignment": {"kind": "assignment", "uuid": assignment_uuid, "name": a.name}, "tasks": "kept (edit them with update_assignment_task)"}


def merge_order(current: list[int], spec: list[int]) -> list[int]:
    """`current` with the ids in `spec` placed in spec order. Ids the spec
    does not list keep their position; spec ids already present take the
    present slots (in spec order); new spec ids go right after the spec item
    before them (or before the first one when they lead), so a partial spec
    never pushes untouched items around."""
    spec = [i for i in dict.fromkeys(spec)]
    wanted = set(spec)
    present = [i for i in spec if i in current]
    slots = iter(present)
    out = [next(slots) if i in wanted else i for i in current]
    for k, item in enumerate(spec):
        if item in out:
            continue
        before = next((spec[j] for j in range(k - 1, -1, -1) if spec[j] in out), None)
        if before is not None:
            out.insert(out.index(before) + 1, item)
            continue
        after = next((spec[j] for j in range(k + 1, len(spec)) if spec[j] in out), None)
        out.insert(out.index(after) if after is not None else len(out), item)
    return out


def _activity_uuid_of(result: dict) -> str | None:
    for key in ("activity", "assignment"):
        value = result.get(key)
        if isinstance(value, dict):
            uuid = value.get("activity_uuid") or (value.get("uuid") if str(value.get("uuid", "")).startswith("activity_") else None)
            if uuid:
                return uuid
    uuid = result.get("uuid")
    return uuid if isinstance(uuid, str) and uuid.startswith("activity_") else None


async def run_build(ctx: ToolContext, p: BuildCourseParams, plan: Plan) -> dict:
    from src.services.courses.chapters import create_chapter, update_chapter
    from src.services.courses.courses import update_course

    total = 1 + sum(1 + len(pc.activities) for pc in plan.chapters) + len(plan.calls) + 1
    run = _Run(ctx, total)
    record = plan.record or {"digest": plan.digest, "items": {}}
    record["digest"] = plan.digest
    items: dict[str, Any] = record.setdefault("items", {})

    # 1. The course.
    if plan.course_action == "create":
        course = await _create_course(ctx, p, plan.course_changes)
        run.counts["created"] += 1
    else:
        course = await refs.load(ctx, "course", plan.course_uuid)
        if plan.course_changes:
            await update_course(ctx.request, CourseUpdate(**plan.course_changes), course.course_uuid, ctx.user, ctx.db_session)
            run.counts["updated"] += 1
    course_uuid = course.course_uuid
    record["course_uuid"] = course_uuid
    save_record(ctx, p.idempotency_key, record)
    run.tick("course")
    if p.course and p.course.thumbnail_url:
        from src.services.ai.tools.courses import _set_thumbnail

        try:
            await _set_thumbnail(ctx, course, p.course.thumbnail_url)
        except Exception as e:  # noqa: BLE001 - reported, the build goes on
            await run.fail("course thumbnail", e)

    # 2. Chapters and their activities.
    chapter_ids: dict[str, str] = {}
    built: list[dict] = []
    for pc in plan.chapters:
        course = await refs.load(ctx, "course", course_uuid)
        label = f"chapter '{pc.spec.name}'"
        try:
            if pc.action == "create":
                chapter = await create_chapter(
                    ctx.request,
                    ChapterCreate(name=pc.spec.name, description=pc.spec.description or "", org_id=course.org_id, course_id=course.id),
                    ctx.user, ctx.db_session,
                )
                pc.uuid = chapter.chapter_uuid
                run.counts["created"] += 1
            elif pc.action == "update":
                row = await refs.load(ctx, "chapter", pc.uuid)
                await update_chapter(
                    ctx.request,
                    ChapterUpdate(name=pc.spec.name, **({"description": pc.spec.description} if pc.spec.description is not None else {})),
                    row.id, ctx.user, ctx.db_session,
                )
                run.counts["updated"] += 1
            else:
                run.counts["unchanged"] += 1
        except Exception as e:  # noqa: BLE001 - reported, the build goes on
            await run.fail(label, e)
            run.tick(label)
            for pa in pc.activities:
                run.failed.append({"item": f"activity '{pa.spec.name}'", "code": "skipped", "message": f"its chapter '{pc.spec.name}' failed"})
                run.tick(pa.spec.name)
            continue
        items[pc.item_key] = pc.uuid
        chapter_ids[pc.spec.key or pc.spec.name] = pc.uuid
        chapter_ids[pc.spec.name] = pc.uuid
        run.tick(label)
        entry = refs.ref("chapter", pc.uuid, pc.spec.name, action=pc.action, activities=[])
        built.append(entry)
        for pa in pc.activities:
            label = f"activity '{pa.spec.name}'"
            if pa.action == "unchanged":
                run.counts["unchanged"] += 1
                entry["activities"].append({"kind": "activity", "uuid": pa.uuid, "name": pa.spec.name, "action": "unchanged"})
                items[pa.item_key] = {"uuid": pa.uuid, "digest": pa.digest}
                run.tick(label)
                continue
            try:
                course = await refs.load(ctx, "course", course_uuid)
                chapter = await refs.load(ctx, "chapter", pc.uuid)
                if pa.spec.kind == "page":
                    result = await _write_page(ctx, course, chapter, pa)
                elif pa.spec.kind == "assignment":
                    result = await _write_assignment(ctx, pc.uuid, pa)
                else:
                    result = await _sub(ctx, "create_media_activity", {"chapter_uuid": pc.uuid, "name": pa.spec.name, "kind": pa.spec.kind, "url": pa.spec.url})
                uuid = pa.uuid or _activity_uuid_of(result)
                run.counts["created" if pa.action == "create" else "updated"] += 1
                items[pa.item_key] = {"uuid": uuid, "digest": pa.digest}
                entry["activities"].append({"action": pa.action, **({"uuid": uuid} if uuid else {}), **result})
            except Exception as e:  # noqa: BLE001 - reported, the build goes on
                await run.fail(label, e, chapter=pc.spec.name)
            save_record(ctx, p.idempotency_key, record)
            run.tick(label)

    # 3. Order: the spec's items in the spec's order; items it does not list
    #    keep their place (see merge_order).
    try:
        course = await refs.load(ctx, "course", course_uuid)
        order, chapter_map, activity_map = await current_order(ctx, course)
        by_id = {cid: acts for cid, acts in order}
        # Items made in this build sit at the end for now: place them as new.
        fresh_chapters = {chapter_map.get(pc.uuid or "") for pc in plan.chapters if pc.action == "create"}
        fresh_acts = {
            activity_map.get((items.get(pa.item_key) or {}).get("uuid") or "")
            for pc in plan.chapters for pa in pc.activities
            if pa.action == "create" and isinstance(items.get(pa.item_key), dict)
        }
        spec_chapters = [chapter_map[pc.uuid] for pc in plan.chapters if pc.uuid in chapter_map and chapter_map[pc.uuid] in by_id]
        merged_chapters = merge_order([cid for cid, _ in order if cid not in fresh_chapters], spec_chapters)
        merged_chapters += [cid for cid, _ in order if cid not in merged_chapters]
        wanted: list[tuple[int, list[int]]] = []
        for cid in merged_chapters:
            acts = by_id[cid]
            pc = next((c for c in plan.chapters if chapter_map.get(c.uuid or "") == cid), None)
            if pc is not None:
                uuids = [items.get(pa.item_key, {}).get("uuid") for pa in pc.activities if isinstance(items.get(pa.item_key), dict)]
                mine = [activity_map[u] for u in uuids if u in activity_map and activity_map[u] in acts]
                acts = merge_order([a for a in acts if a not in fresh_acts], mine) + [a for a in acts if a in fresh_acts and a not in mine]
            wanted.append((cid, acts))
        if wanted != order:
            await write_order(ctx, course, wanted)
    except Exception as e:  # noqa: BLE001 - reported, the build goes on
        await run.fail("order", e)
    run.tick("order")

    # 4. Settings, each through its own tool.
    applied: list[str] = []
    for label, tool, args in plan.calls:
        args = _call_args(tool, args, course_uuid, chapter_ids)
        try:
            await _sub(ctx, tool, args)
            applied.append(label)
        except Exception as e:  # noqa: BLE001 - reported, the build goes on
            await run.fail(label, e)
        run.tick(label)

    record["done"] = not run.failed
    remembered = save_record(ctx, p.idempotency_key, record)
    save_course_keys(ctx, course_uuid, items)
    course = await refs.load(ctx, "course", course_uuid)
    pages = sum(len(c["activities"]) for c in built)
    c = run.counts
    summary = (
        f"{'Created' if plan.course_action == 'create' else 'Updated'} course '{course.name}': "
        f"{c['created']} created, {c['updated']} updated, {c['unchanged']} unchanged"
        + (f", {len(run.failed)} failed" if run.failed else "")
        + ("." if course.published else ". It is a draft.")
    )
    out = changed(
        summary,
        course=await course_ref(ctx, course, published=bool(course.published)),
        editor_url=await refs.web_url(ctx, "course_editor", course=course_uuid),
        counts=c,
        chapters=built,
        settings_applied=applied or None,
        failed=run.failed or None,
        ids={
            "course_uuid": course_uuid,
            "chapters": {k.removeprefix("c:"): v for k, v in items.items() if k.startswith("c:")},
            "activities": {k.split("/", 1)[1]: v["uuid"] for k, v in items.items() if k.startswith("a:") and isinstance(v, dict) and v.get("uuid")},
        },
    )
    out["activities_listed"] = pages
    if run.failed:
        out["ok"] = False
        out["resume"] = {
            "how": (
                "Fix what failed if needed, then call build_course again: with the same idempotency_key and "
                "spec to retry only what is missing, or with course_uuid to update."
            ),
            "course_uuid": course_uuid,
            "idempotency_key": p.idempotency_key,
        }
    if p.idempotency_key and not remembered:
        out["note"] = "The idempotency record could not be saved; retry with course_uuid to avoid duplicates."
    return out


def _plan_view(plan: Plan, p: BuildCourseParams) -> dict:
    steps: list[dict] = []
    if plan.course_action == "create":
        steps.append({"action": "create", "what": "course", "name": p.course.name if p.course else None})
    elif plan.course_changes:
        steps.append({"action": "update", "what": "course", "uuid": plan.course_uuid, "changes": sorted(plan.course_changes)})
    counts = {"create": 0, "update": 0, "unchanged": 0}
    if plan.course_action == "create":
        counts["create"] += 1
    elif plan.course_changes:
        counts["update"] += 1
    for pc in plan.chapters:
        counts[pc.action] += 1
        steps.append({
            "action": pc.action, "what": "chapter", "name": pc.spec.name,
            **({"uuid": pc.uuid} if pc.uuid else {}), **({"changes": pc.changes} if pc.changes else {}),
        })
        for pa in pc.activities:
            counts[pa.action] += 1
            step: dict[str, Any] = {"action": pa.action, "what": pa.spec.kind, "name": pa.spec.name, "chapter": pc.spec.name}
            if pa.uuid:
                step["uuid"] = pa.uuid
            if pa.converted is not None:
                blocks: dict[str, int] = {}
                for _path, node, _parent in d.walk_blocks(pa.converted.doc):
                    blocks[d.kind(node)] = blocks.get(d.kind(node), 0) + 1
                step["blocks"] = blocks
                if pa.converted.media:
                    step["files_to_fetch"] = [m.url for m in pa.converted.media]
                if pa.converted.notes:
                    step["notes"] = pa.converted.notes
            if pa.tasks:
                step["tasks"] = [getattr(t, "type", "?") for t in pa.tasks]
            if pa.changes:
                step["changes"] = pa.changes
            if pa.diff:
                step["diff"] = pa.diff
            steps.append(step)
    for label, tool, _args in plan.calls:
        steps.append({"action": "apply", "what": "setting", "name": label, "tool": tool})
    return {
        "ok": True,
        "dry_run": True,
        "summary": (
            f"Plan: {counts['create']} to create, {counts['update']} to update, {counts['unchanged']} unchanged, "
            f"{len(plan.calls)} setting(s). Nothing was written."
        ),
        "counts": counts,
        "steps": steps,
        "needs_approval": plan.reasons or None,
        "next_step": "Call build_course again with the same arguments and dry_run=false to apply it.",
    }


async def _build_course(ctx: ToolContext, p: BuildCourseParams):
    plan = await plan_build(ctx, p)
    if p.dry_run:
        return _plan_view(plan, p)
    if plan.record and plan.record.get("done") and plan.record.get("result"):
        replay = dict(plan.record["result"])
        replay["replayed"] = True
        replay["summary"] = "Already built with this idempotency_key and spec: " + str(replay.get("summary", ""))
        return replay
    if plan.reasons:
        require_approval(ctx, " ".join(plan.reasons), person=plan.fetches)
    out = await run_build(ctx, p, plan)
    if p.idempotency_key and out.get("ok"):
        record = load_record(ctx, p.idempotency_key) or {}
        record["result"] = {k: v for k, v in out.items() if k not in ("resolved",)}
        save_record(ctx, p.idempotency_key, record)
    return out


def _summarize_build(p: BuildCourseParams) -> str:
    acts = sum(len(c.activities) for c in p.chapters)
    name = (p.course.name if p.course and p.course.name else None) or p.course_uuid
    what = f"Build course '{name}'" if not p.course_uuid else f"Update course {name}"
    extras = []
    files = 0
    for c in p.chapters:
        for a in c.activities:
            files += sum(1 for b in a.blocks or [] if isinstance(b, dict) and b.get("type") in ("image", "audio", "pdf"))
            files += (a.markdown or "").count("![")
            files += 1 if a.kind in ("video", "pdf") else 0
    if files:
        extras.append(f"fetch about {files} outside file(s)")
    if p.course and p.course.thumbnail_url:
        extras.append("fetch a cover image")
    if p.settings and p.settings.publish:
        extras.append("publish it")
    return f"{what} ({len(p.chapters)} chapters, {acts} activities)" + (f" and {', '.join(extras)}" if extras else "")


# ─── add_blocks and validate_content ─────────────────────────────────────────


class AddBlocksParams(BaseModel):
    activity_uuid: str = Field(..., min_length=1, max_length=100, description="The page (activity_...).")
    blocks: list[bs.Block] = Field(..., min_length=1, max_length=bs.MAX_BLOCKS, description="Typed blocks to add, in order.")
    at: Literal["start", "end", "after"] = Field("end", description="Where: start or end of the page, or after the block at path.")
    path: list[int] | None = Field(None, max_length=10, description="With at=after: the block to follow (from get_activity_content outline).")
    expected_version: int | None = Field(None, ge=1, description="The version you read; refused if the page changed since.")


async def _add_blocks(ctx: ToolContext, p: AddBlocksParams):
    from src.services.ai.tools.content_edit import require_risky_approval
    from src.services.ai.tools.results import changed as done

    if p.at == "after" and not p.path:
        raise HTTPException(status_code=400, detail="at=after needs the path of the block to follow.")
    try:
        members = await bs.resolve_members(ctx, bs.member_keys(p.blocks))
        converted = bs.to_converted(p.blocks, members)
    except bs.BlockError as e:
        raise HTTPException(status_code=400, detail=str(e))
    check_media(converted.media)
    page, doc = await load_editable(ctx, p.activity_uuid, p.expected_version)
    nodes = converted.doc["content"]
    top = doc.setdefault("content", [])
    if p.at == "start":
        index = 0
    elif p.at == "end":
        index = len(top)
    else:
        if len(p.path) != 1:
            raise HTTPException(status_code=400, detail="at=after takes a top-level path like [3].")
        if not 0 <= p.path[0] < len(top):
            raise HTTPException(status_code=400, detail=f"No block at [{p.path[0]}]; the page has {len(top)} top-level blocks.")
        index = p.path[0] + 1
    if top == [d.paragraph()]:
        top.clear()
        index = 0
    new_doc = {**doc, "content": top[:index] + nodes + top[index:]}
    require_risky_approval(ctx, doc, new_doc, media_reason(converted.media))
    before, after, undo = await save(ctx, page, new_doc)
    out = done(
        f"Added {len(nodes)} block(s) to '{page.activity.name}'.",
        activity=await page.ref(ctx),
        paths=[[index + i] for i in range(len(nodes))],
        version_before=before,
        version_after=after,
        notes=converted.notes or None,
    )
    stored = await attach_media(ctx, page.uuid, converted.media)
    if stored:
        out["media"] = stored
        out["version_after"] = stored.pop("version_after", after)
    if undo:
        out["undo"] = undo
    return out


class ValidateContentParams(BaseModel):
    blocks: list[dict[str, Any]] | None = Field(None, max_length=bs.MAX_BLOCKS, description="Typed blocks to check (see learnhouse://blocks).")
    markdown: str | None = Field(None, max_length=MAX_CHARS, description="Markdown (with fences) to check.")
    doc: dict[str, Any] | None = Field(None, description="A raw editor document {type: doc, content: [...]} to check.")
    include_doc: bool = Field(False, description="Return the editor JSON the content becomes.")

    @model_validator(mode="after")
    def _one(self):
        if sum(x is not None for x in (self.blocks, self.markdown, self.doc)) != 1:
            raise ValueError("pass exactly one of blocks, markdown or doc")
        return self


async def _validate_content(ctx: ToolContext, p: ValidateContentParams):
    problems: list[str] = []
    converted: Converted | None = None
    try:
        if p.blocks is not None:
            converted = await bs.convert_blocks(ctx, p.blocks)
        elif p.markdown is not None:
            converted = convert(p.markdown, media=True)
            bs.check_doc(converted.doc)
        else:
            bs.check_doc(p.doc)
            converted = Converted(p.doc)
    except bs.BlockError as e:
        problems.append(str(e))
    except HTTPException as e:
        problems.append(str(e.detail))
    out: dict[str, Any] = {"valid": not problems}
    if problems:
        out["problems"] = problems
        out["hint"] = "Fix these and validate again; read learnhouse://blocks/<type> for a block's shape."
        return out
    blocks: dict[str, int] = {}
    for _path, node, _parent in d.walk_blocks(converted.doc):
        blocks[d.kind(node)] = blocks.get(d.kind(node), 0) + 1
    out["blocks"] = blocks
    risky = d.added_risky({}, converted.doc)
    if converted.media or risky:
        out["needs_approval"] = [r for r in (media_reason(converted.media), f"Adds {', '.join(risky)} blocks." if risky else None) if r]
    if converted.notes:
        out["notes"] = converted.notes
    out["markdown"] = _markdown_of(converted.doc)[:4000]
    if p.include_doc:
        out["doc"] = converted.doc
    return out


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="build_course",
        title="Build or update a whole course",
        description=(
            "Create a complete course, or update one, from ONE structured spec: course details "
            "(objectives, prerequisites, tags, cover), chapters in order, and activities: pages "
            "(markdown and/or typed blocks: quiz, flashcards, scenario, exercise, callout, code, table, "
            "math, embed for 18 services, video, image, audio, pdf, h5p, web_preview, toggle, "
            "conditional, widget, user, divider, button, badge), youtube/video/pdf activities and graded "
            "assignments with tasks; plus settings (certificate, drip, SEO, languages, publish). "
            "Everything is validated before writing. dry_run=true returns the plan as a diff. Give "
            "chapters and activities a key and an idempotency_key so retries resume instead of "
            "duplicating; with course_uuid it updates matching items (never deletes). A failing item "
            "does not stop the rest: the result lists created ids, failures and how to resume. Read "
            "learnhouse://guide/course-spec for the format and an example."
        ),
        params_model=BuildCourseParams,
        tier=ActionTier.CREATE,
        rights_bucket="courses",
        access_action=AccessAction.CREATE,
        execute=_build_course,
        target_kind="course",
        approval_in_call=True,
        open_world=True,
        summarize=_summarize_build,
    ),
    ToolSpec(
        name="add_blocks",
        title="Add typed blocks to a page",
        description=(
            "Insert typed blocks into a page (start, end, or after a top-level block): every editor "
            "block with documented fields (quiz, flashcards, scenario, exercise, callout, code, table, "
            "math, embed, video, image, audio, pdf, h5p, web_preview, toggle, conditional, widget, "
            "user, divider, button, badge, markdown, raw node). Checked against the editor schema "
            "before saving (one new version). Files, custom HTML and outside frames need approval."
        ),
        params_model=AddBlocksParams,
        tier=ActionTier.EDIT,
        rights_bucket="activities",
        access_action=AccessAction.UPDATE,
        execute=_add_blocks,
        target_param="activity_uuid",
        target_kind="activity",
        approval_in_call=True,
        open_world=True,
        summarize=lambda p: f"Add {len(p.blocks)} block(s) to the page {p.activity_uuid}",
    ),
    ToolSpec(
        name="validate_content",
        title="Validate page content",
        description=(
            "Check typed blocks, Markdown or raw editor JSON against the real editor schema without "
            "writing anything. Returns valid, the problems with how to fix them, block counts, what "
            "would need approval, and the content as Markdown (include_doc for the editor JSON)."
        ),
        params_model=ValidateContentParams,
        tier=ActionTier.READ,
        rights_bucket=None,
        access_action=AccessAction.READ,
        execute=_validate_content,
        idempotent=True,
    ),
]
