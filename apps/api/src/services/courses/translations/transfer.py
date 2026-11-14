"""Language versions in course export/import (inside course.json).

Pages are exported as translated *segments* rather than whole documents:
import rewrites media/block ids in the imported page, and applying the
segments to the imported page keeps those new ids in the translation too.
A translation whose structure no longer matches its source (outdated) is
exported as a whole document instead.
"""

from __future__ import annotations

from typing import Any, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.courses.translations import (
    ActivityTranslation,
    ChapterTranslation,
    CourseTranslation,
    TranslationStatus,
)
from src.services.courses.translations.content import apply_segments, current_translations, iter_segments
from src.services.courses.translations.locales import normalize_locale
from src.services.courses.translations.service import (
    activity_hash,
    chapter_hash,
    course_hash,
    is_page,
    utcnow,
)

_STATUSES = {s.value for s in TranslationStatus}
_FIELDS = ("name", "description", "about", "learnings", "tags", "seo", "slug")


async def export_translations(db: AsyncSession, course: Course) -> Optional[dict]:
    langs = (await db.execute(select(CourseTranslation).where(CourseTranslation.course_id == course.id))).scalars().all()
    if not langs:
        return None
    chapters = (await db.execute(
        select(ChapterTranslation, Chapter.chapter_uuid)
        .join(Chapter, Chapter.id == ChapterTranslation.chapter_id)
        .where(ChapterTranslation.course_id == course.id)
    )).all()
    activities = (await db.execute(
        select(ActivityTranslation, Activity)
        .join(Activity, Activity.id == ActivityTranslation.activity_id)
        .where(ActivityTranslation.course_id == course.id)
    )).all()
    out: dict[str, Any] = {
        "version": 1,
        "default_locale": course.default_locale,
        "languages": [
            {"locale": t.locale, "status": t.status, "translated_by": t.translated_by,
             **{f: getattr(t, f) for f in _FIELDS}}
            for t in langs
        ],
        "chapters": {},
        "activities": {},
    }
    for t, chapter_uuid in chapters:
        out["chapters"].setdefault(chapter_uuid, {})[t.locale] = {
            "name": t.name, "description": t.description, "status": t.status, "translated_by": t.translated_by,
        }
    for t, activity in activities:
        entry: dict[str, Any] = {
            "name": t.name, "status": t.status, "translated_by": t.translated_by, "extra": t.extra,
        }
        if is_page(activity) and t.content:
            segments = current_translations(activity.content or {}, t.content)
            if segments and len(segments) == len(iter_segments(activity.content or {})):
                entry["segments"] = segments
            else:
                entry["content"] = t.content
        out["activities"].setdefault(activity.activity_uuid, {})[t.locale] = entry
    return out


def _status(value: Any) -> str:
    return value if value in _STATUSES else TranslationStatus.DRAFT.value


async def import_translations(db: AsyncSession, course: Course, data: Any, uuid_map: dict) -> int:
    """Recreates the language versions of an imported course. ``uuid_map``
    maps exported chapter/activity uuids to the imported rows. Returns the
    number of rows created. Unknown or malformed entries are skipped."""
    if not isinstance(data, dict):
        return 0
    created = 0
    now = utcnow()
    locales: set[str] = set()
    for lang in data.get("languages") or []:
        if not isinstance(lang, dict):
            continue
        code = normalize_locale(lang.get("locale"))
        if not code or code in locales or code == course.default_locale:
            continue
        locales.add(code)
        seo = lang.get("seo") if isinstance(lang.get("seo"), dict) else None
        db.add(CourseTranslation(
            course_id=course.id, org_id=course.org_id, locale=code, status=_status(lang.get("status")),
            translated_by=lang.get("translated_by") if lang.get("translated_by") in ("user", "atlas") else None,
            name=_text(lang.get("name")), description=_text(lang.get("description")), about=_text(lang.get("about")),
            learnings=_text(lang.get("learnings")), tags=_text(lang.get("tags")), seo=seo,
            # Slugs are per org: not carried over (they could clash).
            slug=None, source_hash=course_hash(course), created_at=now, updated_at=now,
        ))
        created += 1
    for old_uuid, per_locale in (data.get("chapters") or {}).items():
        chapter = uuid_map.get(old_uuid)
        if not isinstance(chapter, Chapter) or not isinstance(per_locale, dict):
            continue
        for raw, entry in per_locale.items():
            code = normalize_locale(raw)
            if code not in locales or not isinstance(entry, dict):
                continue
            db.add(ChapterTranslation(
                chapter_id=chapter.id, course_id=course.id, org_id=course.org_id, locale=code,
                status=_status(entry.get("status")), translated_by=entry.get("translated_by"),
                name=_text(entry.get("name")), description=_text(entry.get("description")),
                source_hash=chapter_hash(chapter), updated_at=now,
            ))
            created += 1
    for old_uuid, per_locale in (data.get("activities") or {}).items():
        activity = uuid_map.get(old_uuid)
        if not isinstance(activity, Activity) or not isinstance(per_locale, dict):
            continue
        for raw, entry in per_locale.items():
            code = normalize_locale(raw)
            if code not in locales or not isinstance(entry, dict):
                continue
            content = None
            if is_page(activity):
                if isinstance(entry.get("segments"), dict):
                    content, _ = apply_segments(activity.content or {}, entry["segments"])
                elif isinstance(entry.get("content"), dict) and entry["content"].get("type") == "doc":
                    content = entry["content"]
            db.add(ActivityTranslation(
                activity_id=activity.id, course_id=course.id, org_id=course.org_id, locale=code,
                status=_status(entry.get("status")), translated_by=entry.get("translated_by"),
                name=_text(entry.get("name")), content=content,
                extra=entry.get("extra") if isinstance(entry.get("extra"), dict) else None,
                source_version=activity.current_version or 1, source_hash=activity_hash(activity),
                version=1, created_at=now, updated_at=now,
            ))
            created += 1
    await db.flush()
    return created


def _text(value: Any) -> Optional[str]:
    return value[:100_000] if isinstance(value, str) else None
