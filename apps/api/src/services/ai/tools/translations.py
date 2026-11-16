"""Course language tools: read and write a course's language versions.

One course, many languages: a language version translates the course
fields, chapter names and pages, and nothing else is copied (progress,
enrollments and certificates stay on the course). These tools wrap the
service behind the course editor's Languages section
(src/services/courses/translations/service.py), so its rights apply: every
call needs edit rights on the course.

Pages are translated as *segments* (see translations/content.py): read
them with ``get_activity_translation``, translate every text keeping its
``<mN>…</mN>`` and ``<xN/>`` tags, and write them back with
``write_activity_translation``. The structure of the page (blocks, quiz ids,
media) always stays the source's. Publishing a language makes it visible to
learners, so on MCP it needs a person's approval.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from src.security.rbac import AccessAction
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolDenied, ToolSpec
from src.services.ai.tools.results import changed
from src.services.courses.translations import service as svc

_COURSE = Field(..., min_length=1, max_length=100, description="The course (course_...).")
_ACTIVITY = Field(..., min_length=1, max_length=100, description="The activity (activity_...).")
_LOCALE = Field(..., min_length=2, max_length=20, description="Language code, e.g. fr, de, pt-BR, ar.")
MAX_SEGMENTS = 2000


class ListCourseLanguagesParams(BaseModel):
    course_uuid: str = _COURSE
    locale: Optional[str] = Field(
        None, max_length=20,
        description="Also list every chapter and activity with its translation status in this language.",
    )


async def _list_languages(ctx: ToolContext, p: ListCourseLanguagesParams) -> dict[str, Any]:
    overview = await svc.get_languages_overview(ctx.request, ctx.db_session, ctx.user, p.course_uuid)
    out: dict[str, Any] = {
        "course": refs.ref("course", overview.course_uuid, None),
        "default_locale": overview.default_locale,
        "languages": [lang.model_dump() for lang in overview.languages],
        "jobs": overview.jobs,
    }
    if not overview.languages:
        out["next_step"] = "Add a language with add_course_language, then translate the pages."
    if p.locale:
        outline = await svc.get_outline(ctx.request, ctx.db_session, ctx.user, p.course_uuid, p.locale)
        out["outline"] = outline
    if ctx.surface == "agent" and overview.languages:
        out["ui_block"] = languages_view(overview)
    return out


def languages_view(overview: svc.LanguagesOverview) -> dict[str, Any]:
    """The "Languages" view drawn in Atlas answers (generic view components)."""
    rows = []
    for lang in overview.languages:
        p = lang.progress
        rows.append({
            "language": f"{lang.language_name} ({lang.locale})",
            "status": "Published" if lang.status == "published" else "Draft",
            "pages": f"{p.activities_translated}/{p.activities_total}",
            "outdated": p.activities_outdated,
        })
    return {
        "type": "view",
        "title": f"Languages (default: {overview.default_locale})",
        "components": [
            {
                "type": "progress",
                "items": [
                    {"label": f"{lang.language_name} ({lang.locale})",
                     "value": lang.progress.activities_translated, "max": max(lang.progress.activities_total, 1)}
                    for lang in overview.languages[:12]
                ],
            },
            {
                "type": "table",
                "columns": [
                    {"key": "language", "label": "Language"},
                    {"key": "status", "label": "Status"},
                    {"key": "pages", "label": "Pages translated"},
                    {"key": "outdated", "label": "Outdated", "format": "number"},
                ],
                "rows": rows[:50],
            },
        ],
    }


class AddCourseLanguageParams(BaseModel):
    course_uuid: str = _COURSE
    locale: str = _LOCALE


async def _add_language(ctx: ToolContext, p: AddCourseLanguageParams) -> dict[str, Any]:
    lang = await svc.add_language(ctx.request, ctx.db_session, ctx.user, p.course_uuid, svc.AddLanguage(locale=p.locale))
    return changed(
        f"Added {lang.language_name} ({lang.locale}) to the course as a draft.",
        course=refs.ref("course", p.course_uuid, None),
        language=lang.model_dump(),
        undo={"tool": "remove_course_language", "args": {"course_uuid": p.course_uuid, "locale": lang.locale}},
    )


class RemoveCourseLanguageParams(BaseModel):
    course_uuid: str = _COURSE
    locale: str = _LOCALE


async def _remove_language(ctx: ToolContext, p: RemoveCourseLanguageParams) -> dict[str, Any]:
    out = await svc.remove_language(ctx.request, ctx.db_session, ctx.user, p.course_uuid, p.locale)
    return changed(f"Removed the {p.locale} language version and its translations.", course=refs.ref("course", p.course_uuid, None), **out)


class GetActivityTranslationParams(BaseModel):
    activity_uuid: str = _ACTIVITY
    locale: str = _LOCALE


async def _get_activity_translation(ctx: ToolContext, p: GetActivityTranslationParams) -> dict[str, Any]:
    activity, course = await svc.load_activity(ctx.db_session, p.activity_uuid)
    read = await svc.get_activity_translation(ctx.request, ctx.db_session, ctx.user, p.activity_uuid, p.locale)
    out: dict[str, Any] = {
        "activity": refs.ref("activity", activity.activity_uuid, activity.name),
        "locale": read.locale,
        "exists": read.exists,
        "status": read.status,
        "outdated": read.outdated,
        "source_name": activity.name,
        "translated_name": read.name or None,
    }
    if svc.is_page(activity):
        seg = await svc.get_segments(ctx.request, ctx.db_session, ctx.user, p.activity_uuid, p.locale)
        out["source_hash"] = seg["source_hash"]
        out["segments"] = seg["segments"][:MAX_SEGMENTS]
        out["how_to"] = (
            "Translate every segment's text (keep each <mN>…</mN> and <xN/> tag exactly; never translate code, "
            "URLs, variables or LaTeX) and call write_activity_translation with {id: translated text} and source_hash."
        )
    else:
        out["how_to"] = "Only the name of this activity type is translated: call write_activity_translation with name."
    return out


class WriteActivityTranslationParams(BaseModel):
    activity_uuid: str = _ACTIVITY
    locale: str = _LOCALE
    name: Optional[str] = Field(None, max_length=500, description="Translated activity title.")
    segments: dict[str, str] = Field(
        default_factory=dict,
        description="Translated segment texts by id (s0, s1, ...), from get_activity_translation. Omitted ids keep their current text.",
    )
    source_hash: Optional[str] = Field(None, max_length=64, description="source_hash from get_activity_translation (refused if the page changed since).")
    publish: Optional[bool] = Field(None, description="true: publish this page's translation; false: keep it a draft. Omit to leave as is.")


async def _write_activity_translation(ctx: ToolContext, p: WriteActivityTranslationParams) -> dict[str, Any]:
    activity, course = await svc.load_activity(ctx.db_session, p.activity_uuid)
    await svc.require_editor(ctx.request, ctx.db_session, ctx.user, course)
    locale = svc.require_locale(p.locale)
    await svc.require_language(ctx.db_session, course, locale)
    if len(p.segments) > MAX_SEGMENTS:
        raise ToolDenied("too_many_segments", f"At most {MAX_SEGMENTS} segments per call.")
    status = None if p.publish is None else ("published" if p.publish else "draft")
    user_id = getattr(ctx.user, "id", None) or None
    if p.segments:
        t = await svc.write_segments(
            ctx.db_session, activity, course, locale, p.segments, name=p.name, source_hash=p.source_hash,
            user_id=user_id, status=status,
        )
    elif p.name is not None or status is not None:
        t = await svc.write_activity_translation(
            ctx.db_session, activity, course, locale, name=p.name, status=status, user_id=user_id,
        )
    else:
        raise ToolDenied("nothing_to_write", "Pass segments, name or publish.")
    return changed(
        f"Saved the {locale} translation of '{activity.name}' ({t.status}).",
        activity=refs.ref("activity", activity.activity_uuid, activity.name),
        locale=locale,
        status=t.status,
    )


class ChapterNameIn(BaseModel):
    chapter_uuid: str = Field(..., min_length=1, max_length=100)
    name: Optional[str] = Field(None, max_length=500)
    description: Optional[str] = Field(None, max_length=5000)


class UpdateCourseTranslationParams(BaseModel):
    course_uuid: str = _COURSE
    locale: str = _LOCALE
    name: Optional[str] = Field(None, max_length=500)
    description: Optional[str] = Field(None, max_length=20000)
    about: Optional[str] = Field(None, max_length=50000)
    learnings: Optional[str] = Field(None, max_length=20000, description="Same format as the course's learnings (JSON list).")
    tags: Optional[str] = Field(None, max_length=2000, description="Comma separated.")
    seo_title: Optional[str] = Field(None, max_length=120)
    seo_description: Optional[str] = Field(None, max_length=320)
    seo_keywords: Optional[str] = Field(None, max_length=500)
    chapters: list[ChapterNameIn] = Field(default_factory=list, max_length=200)


async def _update_course_translation(ctx: ToolContext, p: UpdateCourseTranslationParams) -> dict[str, Any]:
    course = await svc.load_course(ctx.db_session, p.course_uuid)
    await svc.require_editor(ctx.request, ctx.db_session, ctx.user, course)
    locale = svc.require_locale(p.locale)
    lang = await svc.require_language(ctx.db_session, course, locale)
    fields = {k: getattr(p, k) for k in ("name", "description", "about", "learnings", "tags") if getattr(p, k) is not None}
    seo = {k: v for k, v in (("title", p.seo_title), ("description", p.seo_description), ("keywords", p.seo_keywords)) if v is not None}
    if seo:
        fields["seo"] = seo
    changed_parts: list[str] = []
    if fields:
        await svc.write_course_translation(
            ctx.db_session, course, lang, svc.CourseTranslationWrite(**fields),
            user_id=getattr(ctx.user, "id", None) or None, mark_current=bool(set(fields) - {"seo"}),
        )
        changed_parts.append("course fields")
    for item in p.chapters:
        chapter = await svc._course_chapter(ctx.db_session, course, item.chapter_uuid)
        body = svc.ChapterTranslationWrite(**item.model_dump(exclude={"chapter_uuid"}, exclude_none=True))
        await svc.write_chapter_translation(ctx.db_session, course, chapter, locale, body, commit=False)
    if p.chapters:
        await ctx.db_session.commit()
        changed_parts.append(f"{len(p.chapters)} chapter(s)")
    if not changed_parts:
        raise ToolDenied("nothing_to_write", "Pass at least one field or chapter.")
    return changed(
        f"Updated the {locale} translation: {', '.join(changed_parts)}.",
        course=refs.ref("course", course.course_uuid, course.name),
        locale=locale,
    )


class SetLanguageStatusParams(BaseModel):
    course_uuid: str = _COURSE
    locale: str = _LOCALE
    status: Literal["published", "draft"]
    include_items: bool = Field(True, description="Also publish/unpublish every chapter and page translation of this language.")


async def _set_language_status(ctx: ToolContext, p: SetLanguageStatusParams) -> dict[str, Any]:
    lang = await svc.set_language_status(
        ctx.request, ctx.db_session, ctx.user, p.course_uuid, p.locale,
        svc.LanguageStatusWrite(status=p.status, include_items=p.include_items),
    )
    other = "draft" if p.status == "published" else "published"
    return changed(
        f"{lang.language_name} is now {p.status}" + (" (learners see it)." if p.status == "published" else " (hidden from learners)."),
        course=refs.ref("course", p.course_uuid, None),
        language=lang.model_dump(),
        undo={"tool": "set_language_status", "args": {"course_uuid": p.course_uuid, "locale": lang.locale, "status": other, "include_items": p.include_items}},
    )


def _course_spec(**kw: Any) -> ToolSpec:
    return ToolSpec(rights_bucket="courses", target_param=kw.pop("target_param", "course_uuid"), target_kind="course", **kw)


SPECS: list[ToolSpec] = [
    _course_spec(
        name="list_course_languages",
        title="List course languages",
        description=(
            "A course's default language and its language versions (translations of the same course, not copies): "
            "status (draft/published), pages translated, outdated pages. With locale, also every chapter and page "
            "with its translation status in that language."
        ),
        params_model=ListCourseLanguagesParams,
        tier=ActionTier.READ,
        access_action=AccessAction.UPDATE,
        execute=_list_languages,
    ),
    _course_spec(
        name="add_course_language",
        title="Add a course language",
        description="Add a draft language version to a course (e.g. fr). Learners don't see it until it is published.",
        params_model=AddCourseLanguageParams,
        tier=ActionTier.EDIT,
        access_action=AccessAction.UPDATE,
        execute=_add_language,
        summarize=lambda p: f"Add the {p.locale} language to {p.course_uuid}",
    ),
    _course_spec(
        name="remove_course_language",
        title="Remove a course language",
        description="Delete a language version of a course and all of its translations.",
        params_model=RemoveCourseLanguageParams,
        tier=ActionTier.DESTRUCTIVE,
        access_action=AccessAction.UPDATE,
        execute=_remove_language,
        summarize=lambda p: f"Delete the {p.locale} translation of {p.course_uuid}",
    ),
    ToolSpec(
        name="get_activity_translation",
        title="Get a page translation",
        description=(
            "Read an activity's translation in one language. For pages: the source text as segments (with any "
            "existing translation), to translate and write back with write_activity_translation."
        ),
        params_model=GetActivityTranslationParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_get_activity_translation,
        target_param="activity_uuid",
        target_kind="activity",
    ),
    ToolSpec(
        name="write_activity_translation",
        title="Write a page translation",
        description=(
            "Save an activity's translation in one language: translated segments (pages keep the source structure, "
            "quiz ids and media), the translated title, and optionally publish it."
        ),
        params_model=WriteActivityTranslationParams,
        tier=ActionTier.EDIT,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_write_activity_translation,
        target_param="activity_uuid",
        target_kind="activity",
        approval_if=lambda p: bool(p.publish),
        summarize=lambda p: f"Save the {p.locale} translation of {p.activity_uuid}",
    ),
    _course_spec(
        name="update_course_translation",
        title="Update course translation",
        description=(
            "Write a language version's course fields (name, description, about, learnings, tags, search title/"
            "description/keywords) and chapter names/descriptions."
        ),
        params_model=UpdateCourseTranslationParams,
        tier=ActionTier.EDIT,
        access_action=AccessAction.UPDATE,
        execute=_update_course_translation,
        summarize=lambda p: f"Update the {p.locale} translation of {p.course_uuid}",
    ),
    _course_spec(
        name="set_language_status",
        title="Publish a course language",
        description="Publish a language version (learners in that language see it) or set it back to draft.",
        params_model=SetLanguageStatusParams,
        tier=ActionTier.EDIT,
        access_action=AccessAction.UPDATE,
        execute=_set_language_status,
        approval_if=lambda p: p.status == "published",
        summarize=lambda p: f"Set the {p.locale} version of {p.course_uuid} to {p.status}",
    ),
]
