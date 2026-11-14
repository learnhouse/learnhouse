"""Per-resource SEO: settings, slug resolution for public pages, sitemap data
and the org-wide SEO health report."""

from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.communities.communities import Community
from src.db.communities.discussions import Discussion
from src.db.courses.activities import Activity, ActivityLockType
from src.db.courses.courses import Course
from src.db.folders.folders import Folder
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.paths import Path
from src.db.podcasts.podcasts import Podcast
from src.db.seo import SeoSettingsUpdate, clean_seo
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.api_token_utils import require_token_right
from src.security.org_auth import require_org_role_permission
from src.security.rbac import AccessAction, AccessContext, check_resource_access
from src.services.seo.slugs import find_resource, resource_spec, set_slug

# Hard cap per sitemap section; the protocol allows 50,000 URLs per file.
SITEMAP_MAX_ITEMS = 10000


def bare_uuid(resource_type: str, value: str) -> str:
    prefix = resource_spec(resource_type).prefix
    return value[len(prefix):] if value.startswith(prefix) else value


def public_key(resource_type: str, resource: Any) -> str:
    """The URL key public pages use for a resource: its slug, else its uuid."""
    return resource.slug or bare_uuid(resource_type, getattr(resource, resource_spec(resource_type).uuid_field))


def _is_openly_public(resource_type: str, resource: Any) -> bool:
    if resource_type in ("course", "podcast", "path"):
        return bool(resource.public and resource.published)
    return bool(resource.public)


async def _get_org_by_slug(db_session: AsyncSession, org_slug: str) -> Organization:
    org = (
        await db_session.execute(select(Organization).where(Organization.slug == org_slug).order_by(Organization.id))
    ).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


async def org_seo_config(db_session: AsyncSession, org_id: int) -> dict:
    row = (
        await db_session.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))
    ).scalars().first()
    config = (row.config if row else None) or {}
    seo = (config.get("customization") or {}).get("seo") or config.get("seo") or {}
    return seo if isinstance(seo, dict) else {}


async def _can_read(request: Request, db_session: AsyncSession, current_user, resource_type: str, resource: Any) -> bool:
    """Whether the caller may read a resource that isn't openly public."""
    if resource_type == "path":
        from src.services.paths.paths import _require_view

        try:
            await _require_view(resource, current_user, db_session)
        except HTTPException:
            return False
        return True
    uuid = getattr(resource, resource_spec(resource_type).uuid_field)
    decision = await check_resource_access(
        request, db_session, current_user, uuid, AccessAction.READ,
        context=AccessContext.DASHBOARD, raise_on_deny=False,
    )
    return decision.allowed


async def resolve_public_key(
    request: Request,
    db_session: AsyncSession,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    org_slug: str,
    resource_type: str,
    key: str,
) -> dict:
    """Map a public URL key (slug, old slug or uuid) to the resource.

    Drafts resolve only for callers who can read them and 404 for everyone
    else, like a missing resource. A published members-only resource resolves
    with ``restricted: true`` so a signed-out visitor following a shared link
    gets the sign-in prompt (as with uuid links) instead of a 404; the page
    itself still enforces access and is never indexed.
    """
    resource_spec(resource_type)
    org = await _get_org_by_slug(db_session, org_slug)
    resource, match = await find_resource(db_session, resource_type, org.id, key)
    if resource is None:
        raise HTTPException(status_code=404, detail="Not found")
    restricted = False
    if not _is_openly_public(resource_type, resource) and not await _can_read(
        request, db_session, current_user, resource_type, resource
    ):
        if not getattr(resource, "published", True):
            raise HTTPException(status_code=404, detail="Not found")
        restricted = True
    uuid = getattr(resource, resource_spec(resource_type).uuid_field)
    canonical_key = public_key(resource_type, resource)
    return {
        "resource_type": resource_type,
        "uuid": uuid,
        "bare_uuid": bare_uuid(resource_type, uuid),
        "slug": resource.slug,
        "match": match,
        "restricted": restricted,
        "canonical_key": canonical_key,
        # The page should redirect when the requested key isn't the canonical one.
        "redirect": key.strip().lower() != canonical_key,
    }


# ----------------------------------------------------------------------------
# Editing
# ----------------------------------------------------------------------------

async def _load_by_uuid(db_session: AsyncSession, resource_type: str, resource_uuid: str):
    spec = resource_spec(resource_type)
    uuid = resource_uuid if resource_uuid.startswith(spec.prefix) else f"{spec.prefix}{resource_uuid}"
    row = (
        await db_session.execute(select(spec.model).where(getattr(spec.model, spec.uuid_field) == uuid))
    ).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    return row


async def require_edit(request: Request, db_session: AsyncSession, current_user, resource_type: str, resource: Any) -> None:
    """403 unless the caller may edit ``resource``."""
    if resource_type == "path":
        from src.services.paths.paths import _require_manage

        await _require_manage(current_user, resource.org_id, db_session, "action_update")
        return
    await check_resource_access(
        request, db_session, current_user,
        getattr(resource, resource_spec(resource_type).uuid_field),
        AccessAction.UPDATE, context=AccessContext.DASHBOARD,
    )


# Role/token rights bucket that governs each resource type's authoring.
RIGHTS_BUCKET = {"course": "courses", "path": "courses", "podcast": "podcasts", "community": "communities", "folder": "folders"}


async def require_author(
    request: Request,
    db_session: AsyncSession,
    current_user,
    org_id: int,
    resource_type: str,
    resource_uuid: Optional[str] = None,
) -> None:
    """403 unless the caller may author this kind of resource in ``org_id``.

    With ``resource_uuid`` (editing an existing resource) the caller needs edit
    rights on that resource; without it (naming a new one) the right to create
    the type in the org. API tokens are judged on their own rights, pinned to
    their org, never on their creator's role.
    """
    if resource_uuid:
        resource = await _load_by_uuid(db_session, resource_type, resource_uuid)
        if resource.org_id != org_id:
            raise HTTPException(status_code=404, detail="Not found")
        await require_edit(request, db_session, current_user, resource_type, resource)
        return
    bucket = RIGHTS_BUCKET[resource_type]
    if isinstance(current_user, APITokenUser):
        if current_user.org_id != org_id:
            raise HTTPException(status_code=403, detail="API token cannot access resources outside its organization")
        rights = current_user.rights or {}
        has_bucket = bucket in rights if isinstance(rights, dict) else getattr(rights, bucket, None) is not None
        require_token_right(current_user, bucket if has_bucket else "courses", "action_create")
        return
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    await require_org_role_permission(current_user.id, org_id, db_session, bucket, "action_create")


def _settings_payload(resource_type: str, resource: Any) -> dict:
    spec = resource_spec(resource_type)
    return {
        "resource_type": resource_type,
        "uuid": getattr(resource, spec.uuid_field),
        "org_id": resource.org_id,
        "slug": resource.slug,
        "name": resource.name,
        "description": getattr(resource, "description", None) or "",
        "thumbnail_image": getattr(resource, "thumbnail_image", None) or "",
        "seo": clean_seo(resource.seo or {}),
        "update_date": getattr(resource, "update_date", "") or "",
    }


async def get_seo_settings(request: Request, db_session: AsyncSession, current_user, resource_type: str, resource_uuid: str) -> dict:
    resource = await _load_by_uuid(db_session, resource_type, resource_uuid)
    await require_edit(request, db_session, current_user, resource_type, resource)
    return _settings_payload(resource_type, resource)


async def _invalidate_caches(resource_type: str, resource: Any) -> None:
    if resource_type == "course":
        from src.services.courses.cache import invalidate_course_meta_cache

        invalidate_course_meta_cache(resource.course_uuid)


async def update_seo_settings(
    request: Request,
    db_session: AsyncSession,
    current_user,
    resource_type: str,
    resource_uuid: str,
    body: SeoSettingsUpdate,
) -> dict:
    resource = await _load_by_uuid(db_session, resource_type, resource_uuid)
    await require_edit(request, db_session, current_user, resource_type, resource)
    if body.slug is not None:
        await set_slug(db_session, resource_type, resource, body.slug)
    if body.seo is not None:
        resource.seo = clean_seo(body.seo.model_dump(mode="json"))
    if hasattr(resource, "update_date"):
        resource.update_date = str(datetime.now())
    db_session.add(resource)
    await db_session.commit()
    await db_session.refresh(resource)
    await _invalidate_caches(resource_type, resource)
    return _settings_payload(resource_type, resource)


async def upload_seo_image(
    request: Request,
    db_session: AsyncSession,
    current_user,
    resource_type: str,
    resource_uuid: str,
    image: UploadFile,
) -> dict:
    """Store a social sharing image for a resource and return its file name.

    The file goes to the org's ``og_images`` folder (where the org default
    lives); the caller saves the name into ``seo.og_image``.
    """
    from src.services.orgs.uploads import upload_org_og_image

    resource = await _load_by_uuid(db_session, resource_type, resource_uuid)
    await require_edit(request, db_session, current_user, resource_type, resource)
    org = (await db_session.execute(select(Organization).where(Organization.id == resource.org_id))).scalars().first()
    filename = await upload_org_og_image(image, org.org_uuid)
    return {"filename": filename}


# ----------------------------------------------------------------------------
# Sitemap + health
# ----------------------------------------------------------------------------

def _noindexed(seo: Optional[dict]) -> bool:
    seo = seo or {}
    return bool(seo.get("robots_noindex")) or bool(seo.get("canonical_url"))


def _entry(resource_type: str, row: Any, image: Optional[str] = None, name: Optional[str] = None) -> dict:
    return {
        "key": public_key(resource_type, row),
        "uuid": getattr(row, resource_spec(resource_type).uuid_field),
        "name": name or row.name,
        "lastmod": row.update_date or row.creation_date or "",
        "image": image or "",
    }


async def sitemap_data(db_session: AsyncSession, org_slug: str) -> dict:
    """Everything the public sitemap lists for an org, in one round trip.

    Only content an anonymous visitor can open and that may be indexed:
    public + published, not marked noindex, not canonicalized elsewhere.
    """
    org = await _get_org_by_slug(db_session, org_slug)
    seo_config = await org_seo_config(db_session, org.id)
    result: dict[str, Any] = {
        "org": {
            "slug": org.slug,
            "org_uuid": org.org_uuid,
            "name": org.name,
            "indexing_disabled": bool(seo_config.get("indexing_disabled")),
            "noindex_communities": bool(seo_config.get("noindex_communities")),
        },
        "courses": [], "activities": [], "paths": [], "podcasts": [],
        "communities": [], "discussions": [], "folders": [],
    }
    if result["org"]["indexing_disabled"]:
        return result

    courses = (
        await db_session.execute(
            select(Course)
            .where(Course.org_id == org.id, Course.public == True, Course.published == True)  # noqa: E712
            .order_by(Course.id)
            .limit(SITEMAP_MAX_ITEMS)
        )
    ).scalars().all()
    listed = {c.id: c for c in courses if not _noindexed(c.seo)}
    result["courses"] = [_entry("course", c, c.thumbnail_image) for c in listed.values()]
    # Language versions (multilingual courses): hreflang alternates.
    from src.services.courses.translations.service import published_locales_by_course

    locales = await published_locales_by_course(db_session, list(listed))
    for entry, course in zip(result["courses"], listed.values()):
        entry["default_locale"] = course.default_locale
        entry["available_locales"] = locales.get(course.id, [])

    if listed:
        activities = (
            await db_session.execute(
                select(Activity.activity_uuid, Activity.course_id, Activity.update_date, Activity.creation_date)
                .where(
                    Activity.course_id.in_(list(listed)),
                    Activity.published == True,  # noqa: E712
                    Activity.lock_type == ActivityLockType.PUBLIC,
                )
                .order_by(Activity.id)
                .limit(SITEMAP_MAX_ITEMS * 2)
            )
        ).all()
        result["activities"] = [
            {
                "course_key": public_key("course", listed[course_id]),
                "key": activity_uuid.replace("activity_", "", 1),
                "lastmod": update_date or creation_date or "",
                "default_locale": listed[course_id].default_locale,
                "available_locales": locales.get(course_id, []),
            }
            for activity_uuid, course_id, update_date, creation_date in activities
        ]

    paths = (
        await db_session.execute(
            select(Path)
            .where(Path.org_id == org.id, Path.public == True, Path.published == True)  # noqa: E712
            .order_by(Path.id)
            .limit(SITEMAP_MAX_ITEMS)
        )
    ).scalars().all()
    result["paths"] = [_entry("path", p, p.thumbnail_image) for p in paths if not _noindexed(p.seo)]

    podcasts = (
        await db_session.execute(
            select(Podcast)
            .where(Podcast.org_id == org.id, Podcast.public == True, Podcast.published == True)  # noqa: E712
            .order_by(Podcast.id)
            .limit(SITEMAP_MAX_ITEMS)
        )
    ).scalars().all()
    result["podcasts"] = [_entry("podcast", p, p.thumbnail_image) for p in podcasts if not _noindexed(p.seo)]

    if not result["org"]["noindex_communities"]:
        communities = (
            await db_session.execute(
                select(Community)
                .where(Community.org_id == org.id, Community.public == True)  # noqa: E712
                .order_by(Community.id)
                .limit(SITEMAP_MAX_ITEMS)
            )
        ).scalars().all()
        listed_communities = {c.id: c for c in communities if not _noindexed(c.seo)}
        result["communities"] = [_entry("community", c, c.thumbnail_image) for c in listed_communities.values()]
        if listed_communities:
            discussions = (
                await db_session.execute(
                    select(Discussion.discussion_uuid, Discussion.community_id, Discussion.title,
                           Discussion.update_date, Discussion.creation_date)
                    .where(Discussion.community_id.in_(list(listed_communities)))
                    .order_by(Discussion.id.desc())
                    .limit(SITEMAP_MAX_ITEMS)
                )
            ).all()
            result["discussions"] = [
                {
                    "community_key": public_key("community", listed_communities[community_id]),
                    "key": discussion_uuid.replace("discussion_", "", 1),
                    "name": title,
                    "lastmod": update_date or creation_date or "",
                }
                for discussion_uuid, community_id, title, update_date, creation_date in discussions
            ]

    folders = (
        await db_session.execute(
            select(Folder)
            .where(Folder.org_id == org.id, Folder.public == True)  # noqa: E712
            .order_by(Folder.id)
            .limit(SITEMAP_MAX_ITEMS)
        )
    ).scalars().all()
    result["folders"] = [_entry("folder", f, f.thumbnail_image) for f in folders if not _noindexed(f.seo)]
    return result


async def seo_health(request: Request, db_session: AsyncSession, current_user, org_id: int) -> dict:
    """Raw SEO facts for every resource with a public page in the org.

    Org-level authorization (organizations ``update``) for every caller type:
    admins, and API tokens only with their own organizations update right.
    The dashboard scores the facts with the same rules as the editor
    checklist, so the scoring lives in one place (the web app).
    """
    from src.services.orgs.orgs import rbac_check

    org = (await db_session.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    items: list[dict] = []
    queries = [
        ("course", select(Course).where(Course.org_id == org_id)),
        ("path", select(Path).where(Path.org_id == org_id)),
        ("podcast", select(Podcast).where(Podcast.org_id == org_id)),
        ("community", select(Community).where(Community.org_id == org_id)),
        ("folder", select(Folder).where(Folder.org_id == org_id)),
    ]
    for resource_type, statement in queries:
        rows = (await db_session.execute(statement.limit(SITEMAP_MAX_ITEMS))).scalars().all()
        for row in rows:
            payload = _settings_payload(resource_type, row)
            payload["public"] = bool(getattr(row, "public", True))
            payload["published"] = bool(getattr(row, "published", True))
            payload["key"] = public_key(resource_type, row)
            items.append(payload)
    seo_config = await org_seo_config(db_session, org_id)
    return {"org_seo": seo_config, "items": items}
