"""Course language versions: the editor side (languages, translations,
status, glossary) and the helpers the learner reads, Atlas, MCP and the
collab server use.

Rights: everything here that writes or shows drafts needs the course UPDATE
right (course editors); learners only ever get published translations,
through ``learner.py``.
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import delete as sa_delete
from sqlalchemy import func
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.courses.translations import (
    ActivityTranslation,
    ActivityTranslationCollabState,
    ChapterTranslation,
    CourseTranslation,
    TranslatedBy,
    TranslationStatus,
)
from src.db.users import AnonymousUser, APITokenUser, PublicUser, User
from src.security.auth import resolve_acting_user_id
from src.security.rbac import AccessAction, check_resource_access
from src.services.courses.translations.content import (
    apply_segments,
    current_translations,
    extract_segments,
    segments_hash,
    strip_dropped_marks,
    text_hash,
)
from src.services.courses.translations.locales import (
    RTL_LANGUAGES,
    is_valid_locale,
    language_name,
    normalize_locale,
)

AnyUser = PublicUser | AnonymousUser | APITokenUser
Status = Literal["draft", "published"]
GLOSSARY_KEY = "translation_glossary"
MAX_LANGUAGES = 40
COURSE_FIELDS = ("name", "description", "about", "learnings", "tags")
# SEO keys that hold text a translation localizes (the rest is shared).
SEO_TEXT_KEYS = (
    "title", "description", "keywords", "og_title", "og_description",
    "twitter_title", "twitter_description", "image_alt",
)
MAX_TEXT = 100_000


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


# ─── loading & rights ────────────────────────────────────────────────────────


def require_locale(raw: str) -> str:
    code = normalize_locale(raw)
    if not code:
        raise HTTPException(status_code=422, detail="Invalid locale code")
    return code


async def load_course(db: AsyncSession, course_uuid: str) -> Course:
    course = (await db.execute(select(Course).where(Course.course_uuid == course_uuid))).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


async def require_editor(request: Request, db: AsyncSession, user: AnyUser, course: Course) -> None:
    await check_resource_access(request, db, user, course.course_uuid, AccessAction.UPDATE)


async def load_activity(db: AsyncSession, activity_uuid: str) -> tuple[Activity, Course]:
    row = (await db.execute(
        select(Activity, Course).join(Course, Course.id == Activity.course_id).where(Activity.activity_uuid == activity_uuid)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Activity not found")
    return row[0], row[1]


async def get_course_translation_row(db: AsyncSession, course_id: int, locale: str) -> Optional[CourseTranslation]:
    return (await db.execute(
        select(CourseTranslation).where(CourseTranslation.course_id == course_id, CourseTranslation.locale == locale)
    )).scalars().first()


async def require_language(db: AsyncSession, course: Course, locale: str) -> CourseTranslation:
    row = await get_course_translation_row(db, course.id, locale)
    if row is None:
        raise HTTPException(status_code=404, detail="This language is not added to the course")
    return row


async def course_languages(db: AsyncSession, course_id: int) -> list[CourseTranslation]:
    return list((await db.execute(
        select(CourseTranslation).where(CourseTranslation.course_id == course_id).order_by(CourseTranslation.id)
    )).scalars().all())


def default_locale_of(course: Course) -> str:
    return course.default_locale or "en"


def is_page(activity: Activity) -> bool:
    return (
        activity.activity_type == ActivityTypeEnum.TYPE_DYNAMIC
        and activity.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE
    )


# ─── fingerprints ────────────────────────────────────────────────────────────


def seo_text(seo: Optional[dict]) -> dict:
    seo = seo or {}
    return {k: seo.get(k) for k in SEO_TEXT_KEYS if seo.get(k)}


def course_hash(course: Course) -> str:
    return text_hash(*(getattr(course, f) for f in COURSE_FIELDS), seo_text(course.seo))


def chapter_hash(chapter: Chapter) -> str:
    return text_hash(chapter.name, chapter.description or "")


def activity_hash(activity: Activity) -> str:
    if is_page(activity):
        return segments_hash(activity.content or {}, extra=activity.name or "")
    return text_hash(activity.name or "")


def activity_outdated(activity: Activity, t: ActivityTranslation) -> bool:
    if t.source_hash is None:
        return False
    return t.source_hash != activity_hash(activity)


# ─── course structure ────────────────────────────────────────────────────────


async def course_structure(db: AsyncSession, course_id: int) -> list[tuple[Chapter, list[Activity]]]:
    """Chapters in order, each with its activities in order."""
    chapters = (await db.execute(
        select(Chapter, CourseChapter.order)
        .join(CourseChapter, CourseChapter.chapter_id == Chapter.id)
        .where(CourseChapter.course_id == course_id)
        .order_by(CourseChapter.order, Chapter.id)
    )).all()
    rows = (await db.execute(
        select(ChapterActivity.chapter_id, Activity)
        .join(Activity, Activity.id == ChapterActivity.activity_id)
        .where(ChapterActivity.course_id == course_id)
        .order_by(ChapterActivity.order, Activity.id)
    )).all()
    by_chapter: dict[int, list[Activity]] = {}
    for chapter_id, activity in rows:
        by_chapter.setdefault(chapter_id, []).append(activity)
    seen: set[int] = set()
    out: list[tuple[Chapter, list[Activity]]] = []
    for chapter, _ in chapters:
        if chapter.id in seen:
            continue
        seen.add(chapter.id)
        out.append((chapter, by_chapter.get(chapter.id, [])))
    return out


# ─── reads (editor) ──────────────────────────────────────────────────────────


class LanguageProgress(BaseModel):
    activities_total: int = 0
    activities_translated: int = 0
    activities_published: int = 0
    activities_outdated: int = 0
    chapters_total: int = 0
    chapters_translated: int = 0
    course_translated: bool = False
    course_outdated: bool = False


class LanguageRead(BaseModel):
    locale: str
    status: Status
    translated_by: Optional[str] = None
    name: Optional[str] = None
    language_name: str = ""
    rtl: bool = False
    updated_at: Optional[str] = None
    progress: LanguageProgress = Field(default_factory=LanguageProgress)


class LanguagesOverview(BaseModel):
    course_uuid: str
    default_locale: str
    languages: list[LanguageRead]
    jobs: list[dict[str, Any]] = Field(default_factory=list)
    rtl_locales: list[str] = Field(default_factory=lambda: sorted(RTL_LANGUAGES))


def _course_translated(t: CourseTranslation) -> bool:
    return bool((t.name or "").strip())


async def language_progress(db: AsyncSession, course: Course, langs: list[CourseTranslation]) -> dict[str, LanguageProgress]:
    structure = await course_structure(db, course.id)
    activities = [a for _, acts in structure for a in acts]
    by_id = {a.id: a for a in activities}
    chapter_ids = {c.id for c, _ in structure}
    acts = (await db.execute(select(ActivityTranslation).where(ActivityTranslation.course_id == course.id))).scalars().all()
    chs = (await db.execute(select(ChapterTranslation).where(ChapterTranslation.course_id == course.id))).scalars().all()
    hash_now = course_hash(course)
    out: dict[str, LanguageProgress] = {}
    cache: dict[int, str] = {}
    for lang in langs:
        p = LanguageProgress(
            activities_total=len(activities),
            chapters_total=len(structure),
            course_translated=_course_translated(lang),
            course_outdated=bool(lang.source_hash and lang.source_hash != hash_now),
        )
        for t in acts:
            if t.locale != lang.locale or t.activity_id not in by_id:
                continue
            p.activities_translated += 1
            if t.status == TranslationStatus.PUBLISHED.value:
                p.activities_published += 1
            activity = by_id[t.activity_id]
            if t.source_hash:
                if activity.id not in cache:
                    cache[activity.id] = activity_hash(activity)
                if cache[activity.id] != t.source_hash:
                    p.activities_outdated += 1
        p.chapters_translated = sum(
            1 for c in chs if c.locale == lang.locale and c.chapter_id in chapter_ids and (c.name or "").strip()
        )
        out[lang.locale] = p
    return out


def language_read(t: CourseTranslation, progress: Optional[LanguageProgress] = None) -> LanguageRead:
    return LanguageRead(
        locale=t.locale,
        status=t.status,  # type: ignore[arg-type]
        translated_by=t.translated_by,
        name=t.name,
        language_name=language_name(t.locale),
        rtl=t.locale.split("-")[0] in RTL_LANGUAGES,
        updated_at=_iso(t.updated_at),
        progress=progress or LanguageProgress(),
    )


async def get_languages_overview(request: Request, db: AsyncSession, user: AnyUser, course_uuid: str) -> LanguagesOverview:
    course = await load_course(db, course_uuid)
    await require_editor(request, db, user, course)
    langs = await course_languages(db, course.id)
    progress = await language_progress(db, course, langs)
    from src.services.courses.translations.jobs import list_jobs

    return LanguagesOverview(
        course_uuid=course.course_uuid,
        default_locale=default_locale_of(course),
        languages=[language_read(t, progress.get(t.locale)) for t in langs],
        jobs=list_jobs(course.course_uuid),
    )


# ─── languages: add, remove, status, default ─────────────────────────────────


class AddLanguage(BaseModel):
    locale: str = Field(..., max_length=20)


class LanguageStatusWrite(BaseModel):
    status: Status
    include_items: bool = True


class DefaultLocaleWrite(BaseModel):
    locale: str = Field(..., max_length=20)


async def add_language(request: Request, db: AsyncSession, user: AnyUser, course_uuid: str, body: AddLanguage) -> LanguageRead:
    course = await load_course(db, course_uuid)
    await require_editor(request, db, user, course)
    locale = require_locale(body.locale)
    if locale == default_locale_of(course):
        raise HTTPException(status_code=409, detail="This is the course's default language")
    if await get_course_translation_row(db, course.id, locale):
        raise HTTPException(status_code=409, detail="This language is already added")
    count = (await db.execute(select(func.count()).select_from(CourseTranslation).where(CourseTranslation.course_id == course.id))).scalar_one()
    if count >= MAX_LANGUAGES:
        raise HTTPException(status_code=409, detail=f"A course can have at most {MAX_LANGUAGES} languages")
    now = utcnow()
    row = CourseTranslation(
        course_id=course.id, org_id=course.org_id, locale=locale, status=TranslationStatus.DRAFT.value,
        created_at=now, updated_at=now, updated_by_id=resolve_acting_user_id(user) or None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    if course.default_locale is None:
        # The language list needs a known source language from now on.
        course.default_locale = "en"
        db.add(course)
        await db.commit()
    return language_read(row)


async def remove_language(request: Request, db: AsyncSession, user: AnyUser, course_uuid: str, locale: str) -> dict:
    course = await load_course(db, course_uuid)
    await require_editor(request, db, user, course)
    locale = require_locale(locale)
    row = await require_language(db, course, locale)
    acts = (await db.execute(
        sa_delete(ActivityTranslation).where(ActivityTranslation.course_id == course.id, ActivityTranslation.locale == locale)
    )).rowcount
    chs = (await db.execute(
        sa_delete(ChapterTranslation).where(ChapterTranslation.course_id == course.id, ChapterTranslation.locale == locale)
    )).rowcount
    await db.delete(row)
    await db.commit()
    await _invalidate(course)
    return {"deleted": {"locale": locale, "chapters": chs or 0, "activities": acts or 0}}


async def set_language_status(
    request: Request, db: AsyncSession, user: AnyUser, course_uuid: str, locale: str, body: LanguageStatusWrite
) -> LanguageRead:
    course = await load_course(db, course_uuid)
    await require_editor(request, db, user, course)
    locale = require_locale(locale)
    row = await require_language(db, course, locale)
    if body.status == "published" and not _course_translated(row):
        raise HTTPException(status_code=409, detail="Translate the course name before publishing this language")
    row.status = body.status
    row.updated_at = utcnow()
    db.add(row)
    if body.include_items:
        for model in (ActivityTranslation, ChapterTranslation):
            items = (await db.execute(
                select(model).where(model.course_id == course.id, model.locale == locale)  # type: ignore[attr-defined]
            )).scalars().all()
            for item in items:
                item.status = body.status
                db.add(item)
    await db.commit()
    await db.refresh(row)
    await _invalidate(course)
    progress = await language_progress(db, course, [row])
    return language_read(row, progress.get(locale))


async def set_default_locale(request: Request, db: AsyncSession, user: AnyUser, course_uuid: str, body: DefaultLocaleWrite) -> dict:
    course = await load_course(db, course_uuid)
    await require_editor(request, db, user, course)
    locale = require_locale(body.locale)
    if await get_course_translation_row(db, course.id, locale):
        raise HTTPException(
            status_code=409,
            detail="A translation exists in this language. Remove it first: the default language is the course's own text.",
        )
    course.default_locale = locale
    db.add(course)
    await db.commit()
    await _invalidate(course)
    return {"default_locale": locale}


# ─── glossary ────────────────────────────────────────────────────────────────


class GlossaryTerm(BaseModel):
    source: str = Field(..., min_length=1, max_length=200)
    translations: dict[str, str] = Field(default_factory=dict)

    @field_validator("translations")
    @classmethod
    def _locales(cls, v: dict[str, str]) -> dict[str, str]:
        out: dict[str, str] = {}
        for k, text in list(v.items())[:MAX_LANGUAGES]:
            code = normalize_locale(k)
            if code and isinstance(text, str) and text.strip():
                out[code] = text.strip()[:200]
        return out


class Glossary(BaseModel):
    do_not_translate: list[str] = Field(default_factory=list, max_length=200)
    terms: list[GlossaryTerm] = Field(default_factory=list, max_length=300)
    notes: str = Field(default="", max_length=2000)

    @field_validator("do_not_translate")
    @classmethod
    def _clean(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for item in v:
            item = (item or "").strip()[:120]
            if item and item not in out:
                out.append(item)
        return out


def glossary_of(course: Course) -> Glossary:
    raw = (course.extra_metadata or {}).get(GLOSSARY_KEY)
    try:
        return Glossary.model_validate(raw or {})
    except ValidationError:
        return Glossary()


async def get_glossary(request: Request, db: AsyncSession, user: AnyUser, course_uuid: str) -> Glossary:
    course = await load_course(db, course_uuid)
    await require_editor(request, db, user, course)
    return glossary_of(course)


async def update_glossary(request: Request, db: AsyncSession, user: AnyUser, course_uuid: str, body: Glossary) -> Glossary:
    course = await load_course(db, course_uuid)
    await require_editor(request, db, user, course)
    meta = dict(course.extra_metadata or {})
    meta[GLOSSARY_KEY] = body.model_dump()
    course.extra_metadata = meta
    flag_modified(course, "extra_metadata")
    db.add(course)
    await db.commit()
    return body


# ─── course fields ───────────────────────────────────────────────────────────


class CourseFieldsRead(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    about: Optional[str] = None
    learnings: Optional[str] = None
    tags: Optional[str] = None
    seo: Optional[dict] = None


class CourseTranslationRead(CourseFieldsRead):
    locale: str
    status: Status
    translated_by: Optional[str] = None
    slug: Optional[str] = None
    outdated: bool = False
    updated_at: Optional[str] = None
    source: CourseFieldsRead


class CourseTranslationWrite(BaseModel):
    name: Optional[str] = Field(None, max_length=500)
    description: Optional[str] = Field(None, max_length=MAX_TEXT)
    about: Optional[str] = Field(None, max_length=MAX_TEXT)
    learnings: Optional[str] = Field(None, max_length=MAX_TEXT)
    tags: Optional[str] = Field(None, max_length=5000)
    seo: Optional[dict] = None
    slug: Optional[str] = Field(None, max_length=100)


def _source_fields(course: Course) -> CourseFieldsRead:
    return CourseFieldsRead(**{f: getattr(course, f) for f in COURSE_FIELDS}, seo=course.seo)


def course_translation_read(course: Course, t: CourseTranslation) -> CourseTranslationRead:
    return CourseTranslationRead(
        locale=t.locale,
        status=t.status,  # type: ignore[arg-type]
        translated_by=t.translated_by,
        name=t.name, description=t.description, about=t.about, learnings=t.learnings, tags=t.tags, seo=t.seo,
        slug=t.slug,
        outdated=bool(t.source_hash and t.source_hash != course_hash(course)),
        updated_at=_iso(t.updated_at),
        source=_source_fields(course),
    )


async def get_course_translation(request: Request, db: AsyncSession, user: AnyUser, course_uuid: str, locale: str) -> CourseTranslationRead:
    course = await load_course(db, course_uuid)
    await require_editor(request, db, user, course)
    t = await require_language(db, course, require_locale(locale))
    return course_translation_read(course, t)


def _clean_translation_seo(seo: dict) -> dict:
    from src.db.seo import clean_seo

    try:
        cleaned = clean_seo(seo)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid seo: {exc.errors()[0]['msg']}")
    return {k: v for k, v in cleaned.items() if k in SEO_TEXT_KEYS}


async def _check_slug(db: AsyncSession, course: Course, locale: str, slug: Optional[str]) -> Optional[str]:
    if slug is None or not slug.strip():
        return None
    from src.services.seo.slugify import slugify

    clean = slugify(slug)[:100]
    if not clean:
        raise HTTPException(status_code=422, detail="Invalid slug")
    taken = (await db.execute(
        select(CourseTranslation.id).where(
            CourseTranslation.org_id == course.org_id,
            CourseTranslation.slug == clean,
            CourseTranslation.course_id != course.id,
        )
    )).first()
    if taken:
        raise HTTPException(status_code=409, detail="This slug is already used by another course")
    return clean


async def write_course_translation(
    db: AsyncSession,
    course: Course,
    t: CourseTranslation,
    body: CourseTranslationWrite,
    *,
    user_id: Optional[int],
    translated_by: str = TranslatedBy.USER.value,
    mark_current: bool = True,
) -> CourseTranslation:
    """Writes the given course fields. ``mark_current`` records the current
    source as what the translation was made from (an SEO-only write passes
    False so an outdated translation stays flagged)."""
    data = body.model_dump(exclude_unset=True)
    for field in COURSE_FIELDS:
        if field in data:
            value = data[field]
            setattr(t, field, value.strip() if isinstance(value, str) and field == "name" else value)
    if "seo" in data:
        # Merged over the existing translated SEO: send null for a key to clear it.
        incoming = data["seo"] or {}
        merged = {**(t.seo or {}), **incoming}
        merged = {k: v for k, v in merged.items() if v not in (None, "")}
        t.seo = _clean_translation_seo(merged) or None
        flag_modified(t, "seo")
    if "slug" in data:
        t.slug = await _check_slug(db, course, t.locale, data["slug"])
    t.translated_by = translated_by
    if mark_current or not t.source_hash:
        t.source_hash = course_hash(course)
    t.updated_at = utcnow()
    t.updated_by_id = user_id
    db.add(t)
    await db.commit()
    await db.refresh(t)
    await _invalidate(course)
    return t


async def update_course_translation(
    request: Request, db: AsyncSession, user: AnyUser, course_uuid: str, locale: str, body: CourseTranslationWrite
) -> CourseTranslationRead:
    course = await load_course(db, course_uuid)
    await require_editor(request, db, user, course)
    t = await require_language(db, course, require_locale(locale))
    t = await write_course_translation(db, course, t, body, user_id=resolve_acting_user_id(user) or None)
    return course_translation_read(course, t)


# ─── outline & chapters ──────────────────────────────────────────────────────


class ChapterTranslationWrite(BaseModel):
    name: Optional[str] = Field(None, max_length=500)
    description: Optional[str] = Field(None, max_length=MAX_TEXT)
    status: Optional[Status] = None


async def get_outline(request: Request, db: AsyncSession, user: AnyUser, course_uuid: str, locale: str) -> dict:
    course = await load_course(db, course_uuid)
    await require_editor(request, db, user, course)
    locale = require_locale(locale)
    lang = await require_language(db, course, locale)
    structure = await course_structure(db, course.id)
    chs = {
        c.chapter_id: c for c in (await db.execute(
            select(ChapterTranslation).where(ChapterTranslation.course_id == course.id, ChapterTranslation.locale == locale)
        )).scalars().all()
    }
    acts = {
        a.activity_id: a for a in (await db.execute(
            select(ActivityTranslation).where(ActivityTranslation.course_id == course.id, ActivityTranslation.locale == locale)
        )).scalars().all()
    }
    chapters = []
    for chapter, activities in structure:
        ct = chs.get(chapter.id)
        items = []
        for a in activities:
            t = acts.get(a.id)
            items.append({
                "activity_uuid": a.activity_uuid,
                "activity_type": a.activity_type,
                "activity_sub_type": a.activity_sub_type,
                "name": a.name,
                "translatable": is_page(a),
                "translation": None if t is None else {
                    "name": t.name or "",
                    "status": t.status,
                    "translated_by": t.translated_by,
                    "source_version": t.source_version,
                    "current_source_version": a.current_version or 1,
                    "outdated": activity_outdated(a, t),
                    "updated_at": _iso(t.updated_at),
                },
            })
        chapters.append({
            "chapter_uuid": chapter.chapter_uuid,
            "source": {"name": chapter.name, "description": chapter.description},
            "translation": None if ct is None else {
                "name": ct.name or "",
                "description": ct.description,
                "status": ct.status,
                "outdated": bool(ct.source_hash and ct.source_hash != chapter_hash(chapter)),
            },
            "activities": items,
        })
    return {
        "locale": locale,
        "status": lang.status,
        "course": {
            "translated": _course_translated(lang),
            "outdated": bool(lang.source_hash and lang.source_hash != course_hash(course)),
        },
        "chapters": chapters,
    }


async def _course_chapter(db: AsyncSession, course: Course, chapter_uuid: str) -> Chapter:
    chapter = (await db.execute(select(Chapter).where(Chapter.chapter_uuid == chapter_uuid))).scalars().first()
    if not chapter or chapter.course_id != course.id:
        raise HTTPException(status_code=404, detail="Chapter not found in this course")
    return chapter


async def write_chapter_translation(
    db: AsyncSession,
    course: Course,
    chapter: Chapter,
    locale: str,
    body: ChapterTranslationWrite,
    *,
    translated_by: str = TranslatedBy.USER.value,
    commit: bool = True,
) -> ChapterTranslation:
    row = (await db.execute(
        select(ChapterTranslation).where(ChapterTranslation.chapter_id == chapter.id, ChapterTranslation.locale == locale)
    )).scalars().first()
    if row is None:
        row = ChapterTranslation(chapter_id=chapter.id, course_id=course.id, org_id=course.org_id, locale=locale)
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        row.name = data["name"].strip()
    if "description" in data:
        row.description = data["description"]
    if data.get("status"):
        row.status = data["status"]
    row.translated_by = translated_by
    row.source_hash = chapter_hash(chapter)
    row.updated_at = utcnow()
    db.add(row)
    if commit:
        await db.commit()
        await db.refresh(row)
        await _invalidate(course)
    return row


async def update_chapter_translation(
    request: Request, db: AsyncSession, user: AnyUser, course_uuid: str, locale: str, chapter_uuid: str, body: ChapterTranslationWrite
) -> dict:
    course = await load_course(db, course_uuid)
    await require_editor(request, db, user, course)
    locale = require_locale(locale)
    await require_language(db, course, locale)
    chapter = await _course_chapter(db, course, chapter_uuid)
    row = await write_chapter_translation(db, course, chapter, locale, body)
    return {
        "chapter_uuid": chapter.chapter_uuid, "locale": locale, "name": row.name, "description": row.description,
        "status": row.status, "outdated": False,
    }


# ─── activity translations ───────────────────────────────────────────────────


class ActivityTranslationRead(BaseModel):
    activity_uuid: str
    locale: str
    exists: bool
    name: str = ""
    content: Optional[dict] = None
    extra: Optional[dict] = None
    status: Status = "draft"
    translated_by: Optional[str] = None
    version: int = 0
    source_version: Optional[int] = None
    current_source_version: int = 1
    outdated: bool = False
    updated_at: Optional[str] = None
    updated_by: Optional[str] = None
    source: Optional[dict] = None


class ActivityTranslationWrite(BaseModel):
    name: Optional[str] = Field(None, max_length=500)
    content: Optional[dict] = None
    extra: Optional[dict] = None
    base_version: Optional[int] = None
    status: Optional[Status] = None


class SeedWrite(BaseModel):
    from_: Literal["source", "empty"] = Field("source", alias="from")

    model_config = {"populate_by_name": True}


class StatusWrite(BaseModel):
    status: Status


class SegmentsWrite(BaseModel):
    source_hash: Optional[str] = None
    name: Optional[str] = Field(None, max_length=500)
    segments: dict[str, str] = Field(default_factory=dict)


async def get_activity_translation_row(db: AsyncSession, activity_id: int, locale: str) -> Optional[ActivityTranslation]:
    return (await db.execute(
        select(ActivityTranslation).where(ActivityTranslation.activity_id == activity_id, ActivityTranslation.locale == locale)
    )).scalars().first()


async def _user_name(db: AsyncSession, user_id: Optional[int]) -> Optional[str]:
    if not user_id:
        return None
    user = await db.get(User, user_id)
    if not user:
        return None
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username


async def activity_translation_read(
    db: AsyncSession, activity: Activity, locale: str, t: Optional[ActivityTranslation], include_source: bool = False
) -> ActivityTranslationRead:
    out = ActivityTranslationRead(
        activity_uuid=activity.activity_uuid,
        locale=locale,
        exists=t is not None,
        current_source_version=activity.current_version or 1,
    )
    if t is not None:
        out.name = t.name or ""
        out.content = t.content
        out.extra = t.extra
        out.status = t.status  # type: ignore[assignment]
        out.translated_by = t.translated_by
        out.version = t.version or 1
        out.source_version = t.source_version
        out.outdated = activity_outdated(activity, t)
        out.updated_at = _iso(t.updated_at)
        out.updated_by = await _user_name(db, t.updated_by_id)
    if include_source:
        out.source = {"name": activity.name, "content": activity.content if is_page(activity) else None}
    return out


async def _activity_for_editor(
    request: Request, db: AsyncSession, user: AnyUser, activity_uuid: str, locale: str
) -> tuple[Activity, Course, str]:
    activity, course = await load_activity(db, activity_uuid)
    await require_editor(request, db, user, course)
    locale = require_locale(locale)
    await require_language(db, course, locale)
    return activity, course, locale


async def list_activity_translations(request: Request, db: AsyncSession, user: AnyUser, activity_uuid: str) -> list[dict]:
    activity, course = await load_activity(db, activity_uuid)
    await require_editor(request, db, user, course)
    rows = (await db.execute(
        select(ActivityTranslation).where(ActivityTranslation.activity_id == activity.id).order_by(ActivityTranslation.locale)
    )).scalars().all()
    return [
        {"locale": t.locale, "status": t.status, "outdated": activity_outdated(activity, t),
         "translated_by": t.translated_by, "updated_at": _iso(t.updated_at)}
        for t in rows
    ]


async def get_activity_translation(
    request: Request, db: AsyncSession, user: AnyUser, activity_uuid: str, locale: str, include_source: bool = False
) -> ActivityTranslationRead:
    activity, course, locale = await _activity_for_editor(request, db, user, activity_uuid, locale)
    t = await get_activity_translation_row(db, activity.id, locale)
    return await activity_translation_read(db, activity, locale, t, include_source)


def _validate_content(content: Any) -> dict:
    if not isinstance(content, dict) or content.get("type") != "doc":
        raise HTTPException(status_code=422, detail="content must be a ProseMirror document")
    return content


async def write_activity_translation(
    db: AsyncSession,
    activity: Activity,
    course: Course,
    locale: str,
    *,
    name: Optional[str] = None,
    content: Optional[dict] = None,
    extra: Optional[dict] = None,
    status: Optional[str] = None,
    base_version: Optional[int] = None,
    translated_by: str = TranslatedBy.USER.value,
    user_id: Optional[int] = None,
    mark_current: bool = True,
    notify: bool = True,
    commit: bool = True,
) -> ActivityTranslation:
    """Creates or updates one activity translation. ``mark_current`` records
    the current source as what it was translated from (not outdated)."""
    t = await get_activity_translation_row(db, activity.id, locale)
    if t is not None and base_version is not None and base_version != (t.version or 1):
        raise HTTPException(
            status_code=409,
            detail={"code": "version_conflict", "current_version": t.version or 1,
                    "last_modified_by": await _user_name(db, t.updated_by_id), "update_date": _iso(t.updated_at)},
        )
    now = utcnow()
    created = t is None
    if t is None:
        t = ActivityTranslation(
            activity_id=activity.id, course_id=course.id, org_id=activity.org_id, locale=locale,
            status=TranslationStatus.DRAFT.value, version=0, created_at=now,
        )
    content_changed = False
    if name is not None:
        t.name = name.strip()
    if content is not None:
        if not is_page(activity):
            raise HTTPException(status_code=422, detail="Only page activities have translatable content")
        clean = strip_dropped_marks(copy.deepcopy(_validate_content(content)))
        content_changed = clean != t.content
        t.content = clean
        flag_modified(t, "content")
    if extra is not None:
        t.extra = extra
        flag_modified(t, "extra")
    if status is not None:
        t.status = status
    if created or content_changed:
        t.version = (t.version or 0) + 1
    t.translated_by = translated_by
    if mark_current or created:
        t.source_version = activity.current_version or 1
        t.source_hash = activity_hash(activity)
    t.updated_at = now
    t.updated_by_id = user_id
    db.add(t)
    if commit:
        await db.commit()
        await db.refresh(t)
        await _invalidate(course)
        if content_changed and notify and not created:
            notify_translation_changed(activity, t, user_id)
        from src.services.ai.rag.queue import index_activity

        index_activity(activity.id)
    return t


async def update_activity_translation(
    request: Request, db: AsyncSession, user: AnyUser, activity_uuid: str, locale: str, body: ActivityTranslationWrite
) -> ActivityTranslationRead:
    activity, course, locale = await _activity_for_editor(request, db, user, activity_uuid, locale)
    t = await write_activity_translation(
        db, activity, course, locale,
        name=body.name, content=body.content, extra=body.extra, status=body.status,
        base_version=body.base_version, user_id=resolve_acting_user_id(user) or None,
    )
    return await activity_translation_read(db, activity, locale, t)


async def seed_activity_translation(
    request: Request, db: AsyncSession, user: AnyUser, activity_uuid: str, locale: str, body: SeedWrite
) -> ActivityTranslationRead:
    activity, course, locale = await _activity_for_editor(request, db, user, activity_uuid, locale)
    t = await get_activity_translation_row(db, activity.id, locale)
    if t is None:
        content = None
        if is_page(activity):
            content = (
                copy.deepcopy(activity.content or {"type": "doc", "content": []})
                if body.from_ == "source"
                else {"type": "doc", "content": [{"type": "paragraph"}]}
            )
        t = await write_activity_translation(
            db, activity, course, locale,
            name=activity.name if body.from_ == "source" else "",
            content=content,
            user_id=resolve_acting_user_id(user) or None,
        )
    return await activity_translation_read(db, activity, locale, t)


async def set_activity_translation_status(
    request: Request, db: AsyncSession, user: AnyUser, activity_uuid: str, locale: str, body: StatusWrite
) -> ActivityTranslationRead:
    activity, course, locale = await _activity_for_editor(request, db, user, activity_uuid, locale)
    t = await get_activity_translation_row(db, activity.id, locale)
    if t is None:
        raise HTTPException(status_code=404, detail="This page has no translation in this language yet")
    t.status = body.status
    t.updated_at = utcnow()
    db.add(t)
    await db.commit()
    await db.refresh(t)
    await _invalidate(course)
    return await activity_translation_read(db, activity, locale, t)


async def delete_activity_translation(request: Request, db: AsyncSession, user: AnyUser, activity_uuid: str, locale: str) -> dict:
    activity, course, locale = await _activity_for_editor(request, db, user, activity_uuid, locale)
    t = await get_activity_translation_row(db, activity.id, locale)
    if t is None:
        raise HTTPException(status_code=404, detail="This page has no translation in this language")
    await db.delete(t)
    await db.commit()
    await _invalidate(course)
    return {"deleted": True}


async def get_segments(request: Request, db: AsyncSession, user: AnyUser, activity_uuid: str, locale: str) -> dict:
    activity, course, locale = await _activity_for_editor(request, db, user, activity_uuid, locale)
    if not is_page(activity):
        raise HTTPException(status_code=422, detail="Only page activities have translatable content")
    t = await get_activity_translation_row(db, activity.id, locale)
    segments = extract_segments(activity.content or {})
    if t is not None and t.content:
        existing = current_translations(activity.content or {}, t.content)
        for seg in segments:
            if seg["id"] in existing and existing[seg["id"]] != seg["text"]:
                seg["translated"] = existing[seg["id"]]
    return {
        "activity_uuid": activity.activity_uuid,
        "locale": locale,
        "source_hash": segments_hash(activity.content or {}),
        "name": activity.name,
        "translated_name": t.name if t else None,
        "segments": segments,
    }


async def put_segments(
    request: Request, db: AsyncSession, user: AnyUser, activity_uuid: str, locale: str, body: SegmentsWrite,
    translated_by: str = TranslatedBy.USER.value,
) -> ActivityTranslationRead:
    activity, course, locale = await _activity_for_editor(request, db, user, activity_uuid, locale)
    t = await write_segments(
        db, activity, course, locale, body.segments, name=body.name, source_hash=body.source_hash,
        translated_by=translated_by, user_id=resolve_acting_user_id(user) or None,
    )
    return await activity_translation_read(db, activity, locale, t)


async def write_segments(
    db: AsyncSession,
    activity: Activity,
    course: Course,
    locale: str,
    segments: dict[str, str],
    *,
    name: Optional[str] = None,
    source_hash: Optional[str] = None,
    translated_by: str = TranslatedBy.USER.value,
    user_id: Optional[int] = None,
    status: Optional[str] = None,
    keep_existing: bool = True,
    commit: bool = True,
) -> ActivityTranslation:
    """Builds the translation from the CURRENT source structure and the
    given segment texts. Segments not given keep the existing translation
    (when its structure still matches) or the source text."""
    if not is_page(activity):
        raise HTTPException(status_code=422, detail="Only page activities have translatable content")
    source = activity.content or {"type": "doc", "content": []}
    if source_hash and source_hash != segments_hash(source):
        raise HTTPException(status_code=409, detail={"code": "source_changed", "detail": "The source page changed: read the segments again."})
    texts: dict[str, str] = {}
    if keep_existing:
        existing = await get_activity_translation_row(db, activity.id, locale)
        if existing is not None and existing.content:
            texts.update(current_translations(source, existing.content))
    texts.update({k: v for k, v in segments.items() if isinstance(v, str)})
    doc, _report = apply_segments(source, texts)
    return await write_activity_translation(
        db, activity, course, locale, name=name, content=doc, status=status,
        translated_by=translated_by, user_id=user_id, commit=commit,
    )


# ─── collab (per-locale rooms) ───────────────────────────────────────────────


def notify_translation_changed(activity: Activity, t: ActivityTranslation, user_id: Optional[int]) -> None:
    """Tells the locale's collab room its content was written outside it."""
    from src.services.courses.activities import collab_notify as cn

    import os

    key = os.getenv("COLLAB_INTERNAL_KEY")
    if not key or not is_page(activity):
        return
    payload = {"content": t.content or {}, "current_version": t.version or 1, "by": None}
    cn._schedule(_post_locale_reset(activity.activity_uuid, t.locale, payload, key))


async def _post_locale_reset(activity_uuid: str, locale: str, payload: dict, key: str) -> None:
    import httpx

    from src.services.courses.activities import collab_notify as cn

    url = f"{cn._collab_url()}/internal/activity/{activity_uuid}/reset"
    try:
        async with httpx.AsyncClient(timeout=cn.NOTIFY_TIMEOUT_SECONDS) as client:
            await client.post(url, params={"locale": locale}, json=payload, headers={"X-Internal-Key": key})
    except httpx.HTTPError:
        pass


async def translation_collab_state(db: AsyncSession, activity: Activity, locale: str) -> tuple[ActivityTranslation, Optional[ActivityTranslationCollabState]]:
    if not is_valid_locale(locale):
        raise HTTPException(status_code=422, detail="Invalid locale")
    t = await get_activity_translation_row(db, activity.id, locale)
    if t is None:
        raise HTTPException(status_code=404, detail="This page has no translation in this language")
    state = await db.get(ActivityTranslationCollabState, t.id)
    return t, state


# ─── public language list ────────────────────────────────────────────────────


async def published_locales(db: AsyncSession, course_id: int) -> list[str]:
    return list((await db.execute(
        select(CourseTranslation.locale).where(
            CourseTranslation.course_id == course_id,
            CourseTranslation.status == TranslationStatus.PUBLISHED.value,
        ).order_by(CourseTranslation.locale)
    )).scalars().all())


async def published_locales_by_course(db: AsyncSession, course_ids: list[int]) -> dict[int, list[str]]:
    if not course_ids:
        return {}
    rows = (await db.execute(
        select(CourseTranslation.course_id, CourseTranslation.locale).where(
            CourseTranslation.course_id.in_(course_ids),  # type: ignore[attr-defined]
            CourseTranslation.status == TranslationStatus.PUBLISHED.value,
        ).order_by(CourseTranslation.locale)
    )).all()
    out: dict[int, list[str]] = {}
    for course_id, locale in rows:
        out.setdefault(course_id, []).append(locale)
    return out


async def get_public_languages(request: Request, db: AsyncSession, user: AnyUser, course_uuid: str) -> dict:
    course = await load_course(db, course_uuid)
    await check_resource_access(request, db, user, course.course_uuid, AccessAction.READ)
    rows = (await db.execute(
        select(CourseTranslation).where(
            CourseTranslation.course_id == course.id,
            CourseTranslation.status == TranslationStatus.PUBLISHED.value,
        ).order_by(CourseTranslation.locale)
    )).scalars().all()
    return {
        "default_locale": default_locale_of(course),
        "default": {"locale": default_locale_of(course), "name": course.name, "slug": course.slug},
        "locales": [{"locale": t.locale, "name": t.name or course.name, "slug": t.slug} for t in rows],
    }


async def _invalidate(course: Course) -> None:
    """Learner-facing caches of the course (anonymous meta cache)."""
    try:
        from src.services.courses.cache import invalidate_course_meta_cache

        invalidate_course_meta_cache(course.course_uuid)
    except Exception:  # pragma: no cover - cache is best effort
        pass
