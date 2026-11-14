"""Serving a course in the learner's language.

Reads take ``lang``: a preference list (``fr,en-US,en``), most preferred
first, built by the web app from the learner's explicit choice, UI language
and browser languages. The first PUBLISHED language version matching it is
served (exact code, then same base language), otherwise the course default.
Only published translations of published language versions are ever used:
a draft never reaches a learner.

Ids never change (chapter, activity, quiz question and answer ids are the
source's), so progress, grading, certificates and payments are untouched.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.translations import (
    ActivityTranslation,
    ChapterTranslation,
    CourseTranslation,
    TranslationStatus,
)
from src.services.courses.translations.locales import parse_preferences, resolve_locale
from src.services.courses.translations.service import SEO_TEXT_KEYS

PUBLISHED = TranslationStatus.PUBLISHED.value


def _set(obj: Any, key: str, value: Any) -> None:
    if isinstance(obj, dict):
        obj[key] = value
    else:
        setattr(obj, key, value)


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


async def _published_languages(db: AsyncSession, course_id: int) -> dict[str, CourseTranslation]:
    rows = (await db.execute(
        select(CourseTranslation).where(CourseTranslation.course_id == course_id, CourseTranslation.status == PUBLISHED)
    )).scalars().all()
    return {r.locale: r for r in rows}


def merged_seo(source: Optional[dict], translated: Optional[dict]) -> Optional[dict]:
    """The source SEO settings with the translated text keys over them."""
    if not translated:
        return source
    out = dict(source or {})
    for key in SEO_TEXT_KEYS:
        if translated.get(key):
            out[key] = translated[key]
    return out


def apply_course_fields(target: Any, t: CourseTranslation) -> None:
    for field in ("name", "description", "about", "learnings", "tags"):
        value = getattr(t, field)
        if value not in (None, ""):
            _set(target, field, value)
    _set(target, "seo", merged_seo(_get(target, "seo"), t.seo))


async def localize_course(
    db: AsyncSession,
    course: Any,
    *,
    course_id: int,
    default_locale: Optional[str],
    lang: Optional[str],
    chapters: Optional[list] = None,
) -> Any:
    """Localizes a course read (CourseRead / FullCourseRead / dict) in place.

    Always sets ``default_locale`` and ``available_locales``; with ``lang``
    also the served ``locale`` and the translated texts of the course, its
    chapters and their activities (names, and page content when present)."""
    langs = await _published_languages(db, course_id)
    default = default_locale or "en"
    _set(course, "default_locale", default_locale)
    _set(course, "available_locales", sorted(langs))
    prefs = parse_preferences(lang)
    if not prefs:
        return course
    locale, fallback = resolve_locale(prefs, default, langs.keys())
    _set(course, "locale", locale)
    _set(course, "requested_locale", prefs[0])
    _set(course, "translation_fallback", fallback)
    if locale == default or locale not in langs:
        _mark_items(chapters if chapters is not None else _get(course, "chapters") or [], default, False)
        return course
    apply_course_fields(course, langs[locale])
    await localize_chapters(
        db, chapters if chapters is not None else _get(course, "chapters") or [],
        course_id=course_id, locale=locale, default=default,
    )
    return course


def _mark_items(chapters: Iterable[Any], locale: str, fallback: bool) -> None:
    for chapter in chapters:
        for activity in _get(chapter, "activities") or []:
            _set(activity, "locale", locale)
            _set(activity, "translation_fallback", fallback)


async def localize_chapters(db: AsyncSession, chapters: list, *, course_id: int, locale: str, default: str) -> None:
    if not chapters:
        return
    chs = {
        c.chapter_id: c for c in (await db.execute(
            select(ChapterTranslation).where(
                ChapterTranslation.course_id == course_id,
                ChapterTranslation.locale == locale,
                ChapterTranslation.status == PUBLISHED,
            )
        )).scalars().all()
    }
    acts = {
        a.activity_id: a for a in (await db.execute(
            select(ActivityTranslation).where(
                ActivityTranslation.course_id == course_id,
                ActivityTranslation.locale == locale,
                ActivityTranslation.status == PUBLISHED,
            )
        )).scalars().all()
    }
    for chapter in chapters:
        ct = chs.get(_get(chapter, "id"))
        if ct is not None:
            if ct.name:
                _set(chapter, "name", ct.name)
            if ct.description:
                _set(chapter, "description", ct.description)
        for activity in _get(chapter, "activities") or []:
            t = acts.get(_get(activity, "id"))
            if t is None:
                _set(activity, "locale", default)
                _set(activity, "translation_fallback", True)
                continue
            # Names only: content in course reads has already been redacted
            # per reader (locks, paywall), and the activity read serves the
            # translated content through the same redaction.
            if t.name:
                _set(activity, "name", t.name)
            _set(activity, "locale", locale)
            _set(activity, "translation_fallback", False)


def apply_activity_translation(activity: Any, t: ActivityTranslation) -> None:
    """Translated name and page content on an activity read, BEFORE the
    reader redaction (locks, paywall, comment marks, variables) runs."""
    if t.name:
        _set(activity, "name", t.name)
    if t.content:
        _set(activity, "content", t.content)


async def serve_activity(
    db: AsyncSession,
    *,
    activity_id: int,
    course_id: int,
    default_locale: Optional[str],
    lang: Optional[str],
) -> tuple[Optional[ActivityTranslation], dict[str, Any]]:
    """The published translation to serve for one activity (or None) and
    the read fields describing it."""
    langs = await _published_languages(db, course_id)
    default = default_locale or "en"
    fields: dict[str, Any] = {"default_locale": default_locale, "available_locales": sorted(langs)}
    prefs = parse_preferences(lang)
    if not prefs:
        return None, fields
    locale, fallback = resolve_locale(prefs, default, langs.keys())
    fields.update(locale=default, translation_fallback=fallback)
    if locale == default:
        return None, fields
    t = (await db.execute(
        select(ActivityTranslation).where(
            ActivityTranslation.activity_id == activity_id,
            ActivityTranslation.locale == locale,
            ActivityTranslation.status == PUBLISHED,
        )
    )).scalars().first()
    if t is None:
        fields["translation_fallback"] = True
        return None, fields
    fields.update(locale=locale, translation_fallback=False)
    return t, fields


async def localize_course_list(db: AsyncSession, courses: list, lang: Optional[str]) -> list:
    """Catalog rows: ``default_locale``/``available_locales`` on each, and
    the course fields in the preferred language when published."""
    ids = [_get(c, "id") for c in courses if _get(c, "id") is not None]
    if not ids:
        return courses
    rows = (await db.execute(
        select(CourseTranslation).where(CourseTranslation.course_id.in_(ids), CourseTranslation.status == PUBLISHED)  # type: ignore[attr-defined]
    )).scalars().all()
    by_course: dict[int, dict[str, CourseTranslation]] = {}
    for r in rows:
        by_course.setdefault(r.course_id, {})[r.locale] = r
    prefs = parse_preferences(lang)
    for course in courses:
        langs = by_course.get(_get(course, "id"), {})
        default = _get(course, "default_locale") or "en"
        _set(course, "available_locales", sorted(langs))
        if not prefs:
            continue
        locale, fallback = resolve_locale(prefs, default, langs.keys())
        _set(course, "locale", locale)
        _set(course, "requested_locale", prefs[0])
        _set(course, "translation_fallback", fallback)
        if locale in langs:
            apply_course_fields(course, langs[locale])
    return courses


async def localized_course_name(db: AsyncSession, course_id: int, default_locale: Optional[str], name: str, lang: Optional[str]) -> str:
    """The course name in the preferred language (certificates)."""
    prefs = parse_preferences(lang)
    if not prefs:
        return name
    langs = await _published_languages(db, course_id)
    locale, _ = resolve_locale(prefs, default_locale or "en", langs.keys())
    t = langs.get(locale)
    return (t.name if t and t.name else name)


async def courses_in_language(db: AsyncSession, org_id: int, language: str) -> set[int]:
    """Ids of the org's courses with a published version in ``language``
    (same base language counts); the caller adds courses whose default it is."""
    from src.services.courses.translations.locales import base_language, normalize_locale

    code = normalize_locale(language)
    if not code:
        return set()
    rows = (await db.execute(
        select(CourseTranslation.course_id, CourseTranslation.locale).where(
            CourseTranslation.org_id == org_id, CourseTranslation.status == PUBLISHED
        )
    )).all()
    base = base_language(code)
    return {cid for cid, loc in rows if loc == code or base_language(loc) == base}
