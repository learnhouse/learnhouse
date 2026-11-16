"""SQL filters for multilingual courses."""

from __future__ import annotations

from sqlalchemy import and_, or_
from sqlmodel import select

from src.db.courses.courses import Course
from src.db.courses.translations import CourseTranslation, TranslationStatus
from src.services.courses.translations.locales import base_language


def _matches(column, code: str):
    base = base_language(code)
    return or_(column == code, column == base, column.like(f"{base}-%"))


def available_in_language(code: str):
    """Courses written in ``code`` (a course without a default language
    counts as English) or with a published language version in it."""
    written = _matches(Course.default_locale, code)
    if base_language(code) == "en":
        written = or_(written, Course.default_locale.is_(None))  # type: ignore[union-attr]
    translated = Course.id.in_(  # type: ignore[union-attr]
        select(CourseTranslation.course_id).where(
            and_(CourseTranslation.status == TranslationStatus.PUBLISHED.value, _matches(CourseTranslation.locale, code))
        )
    )
    return or_(written, translated)
