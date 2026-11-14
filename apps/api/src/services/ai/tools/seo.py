"""SEO tools: find what keeps public pages from showing well in search, and
fix the title, description, URL slug or image text of one page.

Both wrap the SEO services behind the dashboard's SEO health page and the
editor's SEO tab (src/services/seo/seo.py), so the rights are theirs: the
audit needs the organization's update right (admins), a fix needs edit
rights on that page. Changing a slug changes the page's address, so it
needs a person's approval. Each fix returns the call that restores the old
values (`undo`).
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator

from src.db.seo import SeoSettingsUpdate
from src.security.rbac import AccessAction
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.results import changed
from src.services.seo.seo import _load_by_uuid, get_seo_settings, seo_health, update_seo_settings

ResourceType = Literal["course", "path", "podcast", "community", "folder"]

TITLE_MAX = 60
DESCRIPTION_MIN = 70
DESCRIPTION_MAX = 160
MAX_ITEMS = 50


def _issues(item: dict) -> list[str]:
    """What a search result would show badly for this page."""
    seo = item.get("seo") or {}
    out: list[str] = []
    title = seo.get("title") or item.get("name") or ""
    if len(title) > TITLE_MAX:
        out.append("title_too_long")
    description = seo.get("description") or item.get("description") or ""
    if not description:
        out.append("no_description")
    elif len(description) < DESCRIPTION_MIN:
        out.append("description_too_short")
    elif len(description) > DESCRIPTION_MAX:
        out.append("description_too_long")
    if not item.get("thumbnail_image") and not seo.get("og_image"):
        out.append("no_image")
    elif not seo.get("image_alt"):
        out.append("no_image_alt")
    if seo.get("robots_noindex"):
        out.append("hidden_from_search")
    return out


class AuditSeoParams(BaseModel):
    resource_type: ResourceType | None = Field(None, description="Only this kind of page; omit for all.")


async def _audit_seo(ctx: ToolContext, p: AuditSeoParams) -> dict:
    health = await seo_health(ctx.request, ctx.db_session, ctx.user, ctx.org.id)
    rows: list[dict[str, Any]] = []
    for item in health.get("items") or []:
        if p.resource_type and item.get("resource_type") != p.resource_type:
            continue
        if not (item.get("public") and item.get("published")):
            continue  # not in search results anyway
        issues = _issues(item)
        if issues:
            rows.append(
                {
                    "resource_type": item["resource_type"],
                    "uuid": item["uuid"],
                    "name": item.get("name"),
                    "slug": item.get("slug"),
                    "issues": issues,
                }
            )
    rows.sort(key=lambda r: -len(r["issues"]))
    out: dict[str, Any] = {
        "summary": f"{len(rows)} public page(s) with search issues.",
        "items": rows[:MAX_ITEMS],
        "total": len(rows),
        "limits": {"title_max": TITLE_MAX, "description_min": DESCRIPTION_MIN, "description_max": DESCRIPTION_MAX},
        "next_step": "Fix a page with update_seo (title, description, slug, image_alt).",
    }
    if len(rows) > MAX_ITEMS:
        out["truncated"] = True
    return out


class UpdateSeoParams(BaseModel):
    resource_type: ResourceType
    resource_uuid: str = Field(..., description="The page's uuid (course_..., path_..., ...).")
    title: str | None = Field(None, max_length=120, description="Search result title.")
    description: str | None = Field(None, max_length=320, description="Search result description.")
    slug: str | None = Field(None, max_length=200, description="New URL slug (changes the page address).")
    image_alt: str | None = Field(None, max_length=250, description="Alt text for the page image.")

    @model_validator(mode="after")
    def _something(self):
        if all(v is None for v in (self.title, self.description, self.slug, self.image_alt)):
            raise ValueError("Pass at least one of title, description, slug or image_alt.")
        return self


async def _update_seo(ctx: ToolContext, p: UpdateSeoParams) -> dict:
    row = await _load_by_uuid(ctx.db_session, p.resource_type, p.resource_uuid)
    if row.org_id != ctx.org.id:
        raise HTTPException(status_code=404, detail="Not found")
    before = await get_seo_settings(ctx.request, ctx.db_session, ctx.user, p.resource_type, p.resource_uuid)
    seo = dict(before.get("seo") or {})
    previous = {k: seo.get(k) for k in ("title", "description", "image_alt")}
    for key in ("title", "description", "image_alt"):
        value = getattr(p, key)
        if value is not None:
            seo[key] = value
    after = await update_seo_settings(
        ctx.request,
        ctx.db_session,
        ctx.user,
        p.resource_type,
        p.resource_uuid,
        SeoSettingsUpdate(seo=seo, slug=p.slug),
    )
    changed_fields = [k for k in ("title", "description", "slug", "image_alt") if getattr(p, k) is not None]
    undo_args: dict[str, Any] = {"resource_type": p.resource_type, "resource_uuid": after["uuid"]}
    for key in changed_fields:
        undo_args[key] = before.get("slug") if key == "slug" else (previous.get(key) or "")
    return changed(
        f"Updated the search {', '.join(changed_fields)} of '{after.get('name')}'.",
        **{p.resource_type: refs.ref(p.resource_type, after["uuid"], after.get("name"))},
        seo={k: (after.get("seo") or {}).get(k) for k in ("title", "description", "image_alt")},
        slug=after.get("slug"),
        undo={"tool": "update_seo", "args": undo_args},
    )


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="audit_seo",
        description=(
            "Check every public, published page (courses, paths, podcasts, communities, folders) for "
            "search issues: missing or short descriptions, long titles, no image or image alt text, "
            "pages hidden from search. Admins only."
        ),
        params_model=AuditSeoParams,
        tier=ActionTier.READ,
        rights_bucket="organizations",
        access_action=AccessAction.READ,
        execute=_audit_seo,
        access="admin",
        title="SEO audit",
    ),
    ToolSpec(
        name="update_seo",
        description=(
            "Fix how one page appears in search: its search title, description, image alt text or URL "
            "slug. Needs edit rights on the page; a new slug changes the address and needs approval."
        ),
        params_model=UpdateSeoParams,
        tier=ActionTier.EDIT,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_update_seo,
        target_param="resource_uuid",
        approval_if=lambda p: p.slug is not None,
        summarize=lambda p: f"Update the search settings of {p.resource_uuid}",
        title="Update SEO",
    ),
]
