"""SEO endpoints: slug resolution for public pages, slug/SEO editing, sitemap
data, the org SEO report and AI snippet suggestions."""

import logging
from typing import Union

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.organizations import Organization
from src.db.seo import SLUG_RESOURCE_TYPES, SeoSettingsUpdate
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.api_token_utils import reject_api_token_access
from src.security.auth import get_authenticated_user, get_current_user
from src.services.ai import metering
from src.services.security.rate_limiting import enforce_ai_rate_limit
from src.services.seo import public as public_seo
from src.services.seo import seo as seo_service
from src.services.seo.slugs import check_slug, register_slug_listeners, suggest_slug

logger = logging.getLogger(__name__)

register_slug_listeners()

router = APIRouter()

ResourceTypeParam = Query(..., pattern="^(" + "|".join(SLUG_RESOURCE_TYPES) + ")$")


@router.get(
    "/resolve/{org_slug}/{resource_type}/{key}",
    summary="Resolve a public URL key",
    description=(
        "Maps the key in a public URL (current slug, a previous slug, or the uuid) to the resource. "
        "`redirect` is true when the page should permanently redirect to `canonical_key`. "
        "Private resources resolve only for callers who can read them."
    ),
)
async def api_resolve(
    request: Request,
    org_slug: str,
    resource_type: str,
    key: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: Union[PublicUser, AnonymousUser, APITokenUser] = Depends(get_current_user),
) -> dict:
    return await seo_service.resolve_public_key(request, db_session, current_user, org_slug, resource_type, key)


@router.get(
    "/sitemap/{org_slug}",
    summary="Public sitemap data for an organization",
    description="Indexable public content of the org (public, published, not noindex), with slugs and last-modified dates.",
)
async def api_sitemap_data(request: Request, org_slug: str, db_session: AsyncSession = Depends(get_db_session)) -> dict:
    return await seo_service.sitemap_data(db_session, org_slug, request)


@router.get(
    "/thread/{org_slug}/{community_key}/{ref}",
    summary="Resolve a community thread URL",
    description=(
        "Maps `<id>-<slug>` (or a legacy discussion uuid) inside a community to the thread, with its "
        "readable `segment`, whether this caller is shut out (`restricted`) and whether search engines may "
        "index it (`indexable`: public, not sold, org/community switches, thin-thread rule)."
    ),
)
async def api_thread_lookup(
    request: Request,
    org_slug: str,
    community_key: str,
    ref: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: Union[PublicUser, AnonymousUser, APITokenUser] = Depends(get_current_user),
) -> dict:
    return await public_seo.thread_lookup(request, db_session, current_user, org_slug, community_key, ref)


@router.get(
    "/thread-jsonld/{org_slug}/{community_key}/{ref}",
    summary="Structured data facts of an indexable thread",
    description="Thread, author and top replies as an anonymous visitor sees them; 404 unless the thread is indexable.",
)
async def api_thread_jsonld(
    request: Request,
    org_slug: str,
    community_key: str,
    ref: str,
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await public_seo.thread_jsonld_data(request, db_session, org_slug, community_key, ref)


@router.get(
    "/feed/{org_slug}",
    summary="Public feed items",
    description=(
        "Items of a public feed (`kind`: org, courses, communities, community, podcast, course_updates) as an "
        "anonymous visitor sees them. 404 when the org turned feeds off or the resource isn't public."
    ),
)
async def api_feed_data(
    request: Request,
    org_slug: str,
    kind: str = Query(..., max_length=32),
    key: str | None = Query(default=None, max_length=200),
    sort: str = Query(default="new", max_length=8),
    label: str | None = Query(default=None, max_length=50),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await public_seo.feed_data(request, db_session, org_slug, kind, key, sort, label)


@router.get(
    "/llms/{org_slug}",
    summary="Public content summary for llms.txt",
    description="The org and its indexable public content; `full=true` adds outlines. 404 when AI access is off.",
)
async def api_llms_data(
    request: Request,
    org_slug: str,
    full: bool = False,
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await public_seo.llms_data(request, db_session, org_slug, full)


@router.get(
    "/markdown/{org_slug}/{resource_type}/{key}",
    summary="One public page as data for its Markdown alternate",
    description="`sub` is the lesson key (activity) or the thread segment (thread). 404 unless the page is indexable.",
)
async def api_markdown_data(
    request: Request,
    org_slug: str,
    resource_type: str,
    key: str,
    sub: str | None = Query(default=None, max_length=200),
    db_session: AsyncSession = Depends(get_db_session),
) -> dict:
    return await public_seo.markdown_data(request, db_session, org_slug, resource_type, key, sub)


@router.get(
    "/indexnow-key/{org_slug}",
    summary="The org's IndexNow key (when IndexNow is on)",
    description="Served by the web app at `/{key}.txt` so search engines can verify submissions. 404 when off.",
)
async def api_indexnow_key(org_slug: str, db_session: AsyncSession = Depends(get_db_session)) -> dict:
    org = await seo_service._get_org_by_slug(db_session, org_slug)
    seo = await seo_service.org_seo_config(db_session, org.id)
    if not seo.get("indexnow_enabled") or not seo.get("indexnow_key"):
        raise HTTPException(status_code=404, detail="Not found")
    return {"key": seo["indexnow_key"]}


@router.get("/slug/check", summary="Check whether a slug is available")
async def api_check_slug(
    request: Request,
    org_id: int,
    slug: str = Query(..., max_length=200),
    resource_type: str = ResourceTypeParam,
    resource_uuid: str | None = None,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
) -> dict:
    await seo_service.require_author(request, db_session, current_user, org_id, resource_type, resource_uuid)
    return await check_slug(db_session, resource_type, org_id, slug, resource_uuid)


@router.get("/slug/suggest", summary="Suggest a free slug for a title")
async def api_suggest_slug(
    request: Request,
    org_id: int,
    title: str = Query(..., max_length=500),
    resource_type: str = ResourceTypeParam,
    resource_uuid: str | None = None,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
) -> dict:
    await seo_service.require_author(request, db_session, current_user, org_id, resource_type, resource_uuid)
    return {"slug": await suggest_slug(db_session, resource_type, org_id, title, resource_uuid)}


@router.get("/health/{org_id}", summary="SEO facts for every resource in the org (admins)")
async def api_seo_health(
    request: Request,
    org_id: int,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
) -> dict:
    return await seo_service.seo_health(request, db_session, current_user, org_id)


class SeoSuggestRequest(BaseModel):
    org_id: int
    resource_type: str = Field(pattern="^(" + "|".join(SLUG_RESOURCE_TYPES) + ")$")
    resource_uuid: str = Field(max_length=100)
    extra: str = Field(default="", max_length=2000)


@router.post("/ai/suggest", summary="Suggest a search title and description with AI")
async def api_ai_suggest(
    body: SeoSuggestRequest,
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_authenticated_user),
) -> dict:
    from src.services.ai.llm import AINotConfiguredError, resolve_model_for_org
    from src.services.seo.ai import suggest_snippet

    # Spends AI credits: people only, never API tokens.
    reject_api_token_access(current_user)
    settings = await seo_service.get_seo_settings(
        request, db_session, current_user, body.resource_type, body.resource_uuid
    )
    if settings["org_id"] != body.org_id:
        raise HTTPException(status_code=404, detail="Not found")
    org = (await db_session.execute(select(Organization).where(Organization.id == body.org_id))).scalars().first()
    enforce_ai_rate_limit(current_user.id, body.org_id)
    # Reserved up front, metered, refunded if the suggestion fails.
    async with metering.charge("seo_generation", org_id=body.org_id, db=db_session, user_id=current_user.id):
        try:
            model_name = await resolve_model_for_org(body.org_id, db_session, purpose="chat")
            suggestion = await suggest_snippet(
                resource_type=body.resource_type,
                name=settings["name"],
                description=settings["description"],
                extra=body.extra,
                org_name=org.name if org else "",
                model_name=model_name,
            )
        except AINotConfiguredError as e:
            raise HTTPException(status_code=403, detail=str(e))
        except Exception:
            logger.exception("SEO suggestion failed")
            raise HTTPException(status_code=502, detail="Suggestion failed. Please try again.")
    return suggestion.model_dump()


@router.get("/{resource_type}/{resource_uuid}", summary="SEO settings and slug of a resource")
async def api_get_seo_settings(
    request: Request,
    resource_type: str,
    resource_uuid: str,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
) -> dict:
    return await seo_service.get_seo_settings(request, db_session, current_user, resource_type, resource_uuid)


@router.put(
    "/{resource_type}/{resource_uuid}",
    summary="Update SEO settings and/or slug of a resource",
    description="The previous slug keeps redirecting to the new one. 409 when the slug is taken (with a suggestion).",
)
async def api_update_seo_settings(
    request: Request,
    resource_type: str,
    resource_uuid: str,
    body: SeoSettingsUpdate,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
) -> dict:
    return await seo_service.update_seo_settings(request, db_session, current_user, resource_type, resource_uuid, body)


@router.post("/{resource_type}/{resource_uuid}/image", summary="Upload a social sharing image for a resource")
async def api_upload_seo_image(
    request: Request,
    resource_type: str,
    resource_uuid: str,
    image: UploadFile,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: Union[PublicUser, APITokenUser] = Depends(get_authenticated_user),
) -> dict:
    return await seo_service.upload_seo_image(request, db_session, current_user, resource_type, resource_uuid, image)
