"""Course language versions (multilingual courses).

``course_router`` is mounted under /courses, ``activity_router`` under
/activities. Everything except ``/languages/public`` is for course editors
(the course UPDATE right); learners read published translations through the
usual course and activity reads with ``?lang=``.
"""

from fastapi import APIRouter, Depends, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import AnonymousUser, PublicUser
from src.security.auth import get_current_user
from src.services.courses.translations import service as svc

course_router = APIRouter()
activity_router = APIRouter()

_EDITOR = {401: {"description": "Authentication required"}, 403: {"description": "Not a course editor"}, 404: {"description": "Not found"}}


# ── languages ────────────────────────────────────────────────────────────────


@course_router.get(
    "/{course_uuid}/languages",
    response_model=svc.LanguagesOverview,
    summary="List a course's language versions",
    description="The course's default language and its language versions with status, progress and running translation jobs.",
    responses=_EDITOR,
)
async def api_get_languages(
    request: Request, course_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.get_languages_overview(request, db_session, current_user, course_uuid)


@course_router.post(
    "/{course_uuid}/languages",
    response_model=svc.LanguageRead,
    status_code=201,
    summary="Add a language to a course",
    description="Adds a draft language version. 409 when it exists or is the default language.",
    responses={**_EDITOR, 409: {"description": "Already added, or the default language"}, 422: {"description": "Invalid locale"}},
)
async def api_add_language(
    request: Request, course_uuid: str, body: svc.AddLanguage,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.add_language(request, db_session, current_user, course_uuid, body)


@course_router.delete(
    "/{course_uuid}/languages/{locale}",
    summary="Remove a language from a course",
    description="Deletes the language version and every chapter and activity translation in it.",
    responses=_EDITOR,
)
async def api_remove_language(
    request: Request, course_uuid: str, locale: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.remove_language(request, db_session, current_user, course_uuid, locale)


@course_router.put(
    "/{course_uuid}/languages/{locale}/status",
    response_model=svc.LanguageRead,
    summary="Publish or unpublish a language",
    description="Learners only see published languages. include_items applies the status to every chapter and activity translation too.",
    responses={**_EDITOR, 409: {"description": "The course name isn't translated yet"}},
)
async def api_set_language_status(
    request: Request, course_uuid: str, locale: str, body: svc.LanguageStatusWrite,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.set_language_status(request, db_session, current_user, course_uuid, locale, body)


@course_router.put(
    "/{course_uuid}/default-locale",
    summary="Set a course's default language",
    description="The language the course's own texts are written in.",
    responses={**_EDITOR, 409: {"description": "A translation exists in that language"}},
)
async def api_set_default_locale(
    request: Request, course_uuid: str, body: svc.DefaultLocaleWrite,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.set_default_locale(request, db_session, current_user, course_uuid, body)


@course_router.get(
    "/{course_uuid}/languages/public",
    summary="Published languages of a course",
    description="The default language and the published language versions (names and localized slugs), for language switchers and SEO alternates.",
    responses={403: {"description": "No access to the course"}, 404: {"description": "Course not found"}},
)
async def api_public_languages(
    request: Request, course_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.get_public_languages(request, db_session, current_user, course_uuid)


@course_router.get(
    "/{course_uuid}/translation-glossary",
    response_model=svc.Glossary,
    summary="Get a course's translation glossary",
    description="Terms translators (and Atlas) keep as they are, term mappings per language and notes.",
    responses=_EDITOR,
)
async def api_get_glossary(
    request: Request, course_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.get_glossary(request, db_session, current_user, course_uuid)


@course_router.put(
    "/{course_uuid}/translation-glossary",
    response_model=svc.Glossary,
    summary="Update a course's translation glossary",
    description="Replaces the glossary.",
    responses=_EDITOR,
)
async def api_put_glossary(
    request: Request, course_uuid: str, body: svc.Glossary,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.update_glossary(request, db_session, current_user, course_uuid, body)


# ── course fields, outline, chapters ─────────────────────────────────────────


@course_router.get(
    "/{course_uuid}/translations/{locale}",
    response_model=svc.CourseTranslationRead,
    summary="Get a course's translated fields",
    description="Name, description, about, learnings, tags, SEO and slug in one language, with the source fields.",
    responses=_EDITOR,
)
async def api_get_course_translation(
    request: Request, course_uuid: str, locale: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.get_course_translation(request, db_session, current_user, course_uuid, locale)


@course_router.put(
    "/{course_uuid}/translations/{locale}",
    response_model=svc.CourseTranslationRead,
    summary="Update a course's translated fields",
    description="Partial update; SEO keys are merged (a key sent empty is cleared). Marks the translation up to date with the source.",
    responses={**_EDITOR, 409: {"description": "Slug used by another course"}},
)
async def api_put_course_translation(
    request: Request, course_uuid: str, locale: str, body: svc.CourseTranslationWrite,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.update_course_translation(request, db_session, current_user, course_uuid, locale, body)


@course_router.get(
    "/{course_uuid}/translations/{locale}/outline",
    summary="Translation status of every chapter and activity",
    description="Chapters and activities in course order with their translation in one language (status, outdated).",
    responses=_EDITOR,
)
async def api_get_outline(
    request: Request, course_uuid: str, locale: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.get_outline(request, db_session, current_user, course_uuid, locale)


@course_router.put(
    "/{course_uuid}/translations/{locale}/chapters/{chapter_uuid}",
    summary="Update a chapter's translation",
    description="Translated chapter name and description, optionally its status.",
    responses=_EDITOR,
)
async def api_put_chapter_translation(
    request: Request, course_uuid: str, locale: str, chapter_uuid: str, body: svc.ChapterTranslationWrite,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.update_chapter_translation(request, db_session, current_user, course_uuid, locale, chapter_uuid, body)


# ── activity translations ────────────────────────────────────────────────────


@activity_router.get(
    "/{activity_uuid}/translations",
    summary="List an activity's translations",
    description="Every language the activity is translated into, with status and whether the source changed since.",
    responses=_EDITOR,
)
async def api_list_activity_translations(
    request: Request, activity_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.list_activity_translations(request, db_session, current_user, activity_uuid)


@activity_router.get(
    "/{activity_uuid}/translations/{locale}",
    response_model=svc.ActivityTranslationRead,
    summary="Get an activity's translation",
    description="Translated name and content in one language (exists=false when not started), optionally with the source.",
    responses=_EDITOR,
)
async def api_get_activity_translation(
    request: Request, activity_uuid: str, locale: str,
    include_source: bool = Query(False),
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.get_activity_translation(request, db_session, current_user, activity_uuid, locale, include_source)


@activity_router.put(
    "/{activity_uuid}/translations/{locale}",
    response_model=svc.ActivityTranslationRead,
    summary="Save an activity's translation",
    description="Creates or updates the translation (name, content, status). 409 when base_version is stale.",
    responses={**_EDITOR, 409: {"description": "Version conflict"}, 422: {"description": "Invalid content"}},
)
async def api_put_activity_translation(
    request: Request, activity_uuid: str, locale: str, body: svc.ActivityTranslationWrite,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.update_activity_translation(request, db_session, current_user, activity_uuid, locale, body)


@activity_router.post(
    "/{activity_uuid}/translations/{locale}/seed",
    response_model=svc.ActivityTranslationRead,
    summary="Start an activity's translation",
    description="Creates the translation from a copy of the source (without comments) or empty, when it doesn't exist.",
    responses=_EDITOR,
)
async def api_seed_activity_translation(
    request: Request, activity_uuid: str, locale: str, body: svc.SeedWrite,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.seed_activity_translation(request, db_session, current_user, activity_uuid, locale, body)


@activity_router.put(
    "/{activity_uuid}/translations/{locale}/status",
    response_model=svc.ActivityTranslationRead,
    summary="Publish or unpublish an activity's translation",
    description="Learners see it only when the language is published too.",
    responses=_EDITOR,
)
async def api_set_activity_translation_status(
    request: Request, activity_uuid: str, locale: str, body: svc.StatusWrite,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.set_activity_translation_status(request, db_session, current_user, activity_uuid, locale, body)


@activity_router.delete(
    "/{activity_uuid}/translations/{locale}",
    summary="Delete an activity's translation",
    description="Learners get the default language for this activity again.",
    responses=_EDITOR,
)
async def api_delete_activity_translation(
    request: Request, activity_uuid: str, locale: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.delete_activity_translation(request, db_session, current_user, activity_uuid, locale)


@activity_router.get(
    "/{activity_uuid}/translations/{locale}/segments",
    summary="Translatable segments of a page",
    description=(
        "The page's text as segments (running text with <mN>…</mN>/<xN/> tags to keep, and textual attributes), "
        "with existing translations. For translation tools."
    ),
    responses=_EDITOR,
)
async def api_get_segments(
    request: Request, activity_uuid: str, locale: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.get_segments(request, db_session, current_user, activity_uuid, locale)


@activity_router.put(
    "/{activity_uuid}/translations/{locale}/segments",
    response_model=svc.ActivityTranslationRead,
    summary="Save a page translation from segments",
    description="Builds the translation from the current source structure and the translated segments. 409 when the source changed.",
    responses={**_EDITOR, 409: {"description": "The source changed since the segments were read"}},
)
async def api_put_segments(
    request: Request, activity_uuid: str, locale: str, body: svc.SegmentsWrite,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser | AnonymousUser = Depends(get_current_user),
):
    return await svc.put_segments(request, db_session, current_user, activity_uuid, locale, body)
