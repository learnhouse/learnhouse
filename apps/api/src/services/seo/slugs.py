"""Slug storage, lookup and history for resources with public URLs.

Every course, path, podcast, community and library folder gets a slug from its
name when it is created (``register_slug_listeners``), unique within its org
and type. Authors can change it; the previous slug is kept in
``resource_slug_redirect`` so links to it redirect permanently.

Public pages accept either the slug or the uuid (without its ``course_``-style
prefix). A uuid-shaped key is always read as a uuid: ``slug_error`` refuses
uuid-shaped slugs, so the two can't collide.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import delete, event, or_, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.communities.communities import Community
from src.db.courses.courses import Course
from src.db.folders.folders import Folder
from src.db.paths import Path
from src.db.podcasts.podcasts import Podcast
from src.db.seo import ResourceSlugRedirect
from src.services.seo.slugify import UUID_LIKE_RE, base_slug, first_free, slug_error, slugify


@dataclass(frozen=True)
class SlugResource:
    model: Any
    uuid_field: str
    prefix: str


RESOURCES: dict[str, SlugResource] = {
    "course": SlugResource(Course, "course_uuid", "course_"),
    "path": SlugResource(Path, "path_uuid", "path_"),
    "podcast": SlugResource(Podcast, "podcast_uuid", "podcast_"),
    "community": SlugResource(Community, "community_uuid", "community_"),
    "folder": SlugResource(Folder, "folder_uuid", "folder_"),
}


def resource_spec(resource_type: str) -> SlugResource:
    spec = RESOURCES.get(resource_type)
    if spec is None:
        raise HTTPException(status_code=404, detail="Unknown resource type")
    return spec


def full_uuid(resource_type: str, key: str) -> str:
    """``key`` with the type's uuid prefix (``course_...``), added if missing."""
    prefix = resource_spec(resource_type).prefix
    return key if key.startswith(prefix) else f"{prefix}{key}"


def _taken_statements(spec: SlugResource, resource_type: str, org_id: int, base: str, exclude_uuid: Optional[str]):
    model = spec.model
    uuid_col = getattr(model, spec.uuid_field)
    like = f"{base}-%"
    current = select(model.slug).where(
        model.org_id == org_id,
        or_(model.slug == base, model.slug.like(like)),
    )
    history = select(ResourceSlugRedirect.slug).where(
        ResourceSlugRedirect.org_id == org_id,
        ResourceSlugRedirect.resource_type == resource_type,
        or_(ResourceSlugRedirect.slug == base, ResourceSlugRedirect.slug.like(like)),
    )
    if exclude_uuid:
        current = current.where(uuid_col != exclude_uuid)
        history = history.where(ResourceSlugRedirect.resource_uuid != exclude_uuid)
    return current, history


async def taken_slugs(
    db_session: AsyncSession, resource_type: str, org_id: int, base: str, exclude_uuid: Optional[str] = None
) -> set[str]:
    """Slugs starting with ``base`` that another resource of the type uses now
    or used before (old slugs keep redirecting, so they stay reserved)."""
    current, history = _taken_statements(resource_spec(resource_type), resource_type, org_id, base, exclude_uuid)
    taken = set((await db_session.execute(current)).scalars().all())
    taken |= set((await db_session.execute(history)).scalars().all())
    taken.discard(None)
    return taken


async def suggest_slug(
    db_session: AsyncSession, resource_type: str, org_id: int, title: str, exclude_uuid: Optional[str] = None
) -> str:
    base = base_slug(title, exclude_uuid or "")
    return first_free(base, await taken_slugs(db_session, resource_type, org_id, base, exclude_uuid))


async def check_slug(
    db_session: AsyncSession, resource_type: str, org_id: int, slug: str, exclude_uuid: Optional[str] = None
) -> dict:
    """Whether ``slug`` (normalized first) is usable for a resource.

    ``exclude_uuid`` is the resource being edited: its own current and past
    slugs count as available.
    """
    normalized = slugify(slug)
    reason = slug_error(normalized)
    if reason:
        return {"slug": normalized, "available": False, "reason": reason, "suggestion": None}
    taken = await taken_slugs(db_session, resource_type, org_id, normalized, exclude_uuid)
    if normalized in taken:
        return {
            "slug": normalized,
            "available": False,
            "reason": "taken",
            "suggestion": first_free(normalized, taken),
        }
    return {"slug": normalized, "available": True, "reason": None, "suggestion": None}


async def set_slug(db_session: AsyncSession, resource_type: str, resource: Any, slug: str) -> str:
    """Give ``resource`` a new slug, keeping the old one as a redirect.

    Raises 400 for a malformed slug and 409 when it is taken. Does not commit.
    """
    spec = resource_spec(resource_type)
    resource_uuid = getattr(resource, spec.uuid_field)
    result = await check_slug(db_session, resource_type, resource.org_id, slug, resource_uuid)
    if not result["available"]:
        code = 409 if result["reason"] == "taken" else 400
        raise HTTPException(status_code=code, detail={"reason": result["reason"], "suggestion": result["suggestion"]})
    new_slug = result["slug"]
    old_slug = resource.slug
    if old_slug == new_slug:
        return new_slug
    # Taking back one of its own old slugs: that slug stops being a redirect.
    await db_session.execute(
        delete(ResourceSlugRedirect).where(
            ResourceSlugRedirect.org_id == resource.org_id,
            ResourceSlugRedirect.resource_type == resource_type,
            ResourceSlugRedirect.slug == new_slug,
        )
    )
    if old_slug:
        db_session.add(
            ResourceSlugRedirect(
                org_id=resource.org_id,
                resource_type=resource_type,
                resource_uuid=resource_uuid,
                slug=old_slug,
                creation_date=str(datetime.now()),
            )
        )
    resource.slug = new_slug
    db_session.add(resource)
    return new_slug


async def find_resource(db_session: AsyncSession, resource_type: str, org_id: int, key: str):
    """The resource a public URL key points at, and how it matched.

    Returns ``(resource, match)`` with match ``"slug"`` (current slug),
    ``"uuid"`` or ``"redirect"`` (an old slug), or ``(None, None)``.
    """
    spec = resource_spec(resource_type)
    model = spec.model
    key = (key or "").strip().lower()
    if not key:
        return None, None
    bare = key[len(spec.prefix):] if key.startswith(spec.prefix) else key
    if UUID_LIKE_RE.match(bare):
        row = (
            await db_session.execute(
                select(model).where(getattr(model, spec.uuid_field) == f"{spec.prefix}{bare}", model.org_id == org_id)
            )
        ).scalars().first()
        return (row, "uuid") if row else (None, None)

    row = (
        await db_session.execute(select(model).where(model.org_id == org_id, model.slug == key))
    ).scalars().first()
    if row:
        return row, "slug"

    redirect = (
        await db_session.execute(
            select(ResourceSlugRedirect).where(
                ResourceSlugRedirect.org_id == org_id,
                ResourceSlugRedirect.resource_type == resource_type,
                ResourceSlugRedirect.slug == key,
            )
        )
    ).scalars().first()
    if redirect:
        row = (
            await db_session.execute(
                select(model).where(getattr(model, spec.uuid_field) == redirect.resource_uuid, model.org_id == org_id)
            )
        ).scalars().first()
        if row:
            return row, "redirect"
    return None, None


# ----------------------------------------------------------------------------
# ORM listeners: a slug for every new row, history cleanup on delete
# ----------------------------------------------------------------------------

def _assign_slug_listener(resource_type: str):
    spec = RESOURCES[resource_type]

    def before_insert(mapper, connection, target):
        if getattr(target, "slug", None) or not getattr(target, "org_id", None):
            return
        resource_uuid = getattr(target, spec.uuid_field, "") or ""
        base = base_slug(getattr(target, "name", ""), resource_uuid)
        current, history = _taken_statements(spec, resource_type, target.org_id, base, None)
        taken = set(connection.execute(current).scalars().all())
        taken |= set(connection.execute(history).scalars().all())
        target.slug = first_free(base, taken)

    return before_insert


def _purge_history_listener(resource_type: str):
    spec = RESOURCES[resource_type]

    def after_delete(mapper, connection, target):
        resource_uuid = getattr(target, spec.uuid_field, None)
        if resource_uuid:
            connection.execute(
                delete(ResourceSlugRedirect).where(ResourceSlugRedirect.resource_uuid == resource_uuid)
            )

    return after_delete


_registered = False


def register_slug_listeners() -> None:
    """Attach the listeners once per process (idempotent)."""
    global _registered
    if _registered:
        return
    for resource_type, spec in RESOURCES.items():
        event.listen(spec.model, "before_insert", _assign_slug_listener(resource_type))
        event.listen(spec.model, "after_delete", _purge_history_listener(resource_type))
    _registered = True
