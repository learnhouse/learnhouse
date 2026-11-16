"""Landing page builder: pages, drafts, publishing, history and the public read.

There is one landing system. Classic landing configs (``config.landing``) are
converted into builder pages by ``migrate_legacy``; until an org's home page
is published, visitors see ``home_fallback_doc`` (the converted classic
landing, or the default template built from the org's own data).

Rights: building pages is an organization setting, so every write (and every
draft read) needs the org ``update`` right, like the legacy landing route.
Visitors read published pages; a preview link reads the draft.

Plan gates (decided here, shown in the builder):

* every plan: the builder, every element except custom code, templates,
  drafts, history, preview links, contact forms and Atlas/AI tools;
* Standard and up: extra pages (/p/<slug>), up to MAX_EXTRA_PAGES;
* Pro and up: the custom HTML/CSS element.
"""

from __future__ import annotations

import copy
import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.landing_pages import LandingFormSubmission, LandingPage, LandingPageVersion, LandingSavedSection
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.security.features_utils.plans import plan_meets_requirement
from src.services.landing import recipes
from src.services.landing.convert import convert_landing
from src.services.landing.schema import DocError, check_slug, element_types_used, empty_doc, validate_doc

logger = logging.getLogger(__name__)

CUSTOM_CODE_PLAN = "pro"
EXTRA_PAGES_PLAN = "standard"
MAX_EXTRA_PAGES = 20
MAX_VERSIONS = 100
CHECKPOINT_EVERY = timedelta(minutes=10)
MAX_SUBMISSIONS_PER_ORG = 10_000
RESERVED_SLUGS = {"home", "p", "dash", "admin", "api", "login", "signup", "courses", "course", "store"}

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_id(user: Any) -> Optional[int]:
    from src.security.auth import resolve_acting_user_id

    try:
        uid = resolve_acting_user_id(user)
    except Exception:  # noqa: BLE001 - anonymous / internal callers
        return None
    return uid if isinstance(uid, int) and uid > 0 else None


# ─── org, rights, plan ────────────────────────────────────────────────────────


async def get_org(db: AsyncSession, org_id: int) -> Organization:
    org = (await db.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


async def require_editor(request: Request, db: AsyncSession, user: Any, org: Organization) -> None:
    from src.services.orgs.orgs import rbac_check

    await rbac_check(request, org.org_uuid, user, "update", db)


async def _org_config(db: AsyncSession, org_id: int) -> Optional[OrganizationConfig]:
    return (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))).scalars().first()


def _plan_of(config: dict) -> str:
    if str(config.get("config_version", "1.0")).startswith("2"):
        return config.get("plan", "free") or "free"
    return (config.get("cloud") or {}).get("plan", "free") or "free"


async def plan_caps(db: AsyncSession, org_id: int) -> dict:
    cfg = await _org_config(db, org_id)
    plan = _plan_of((cfg.config if cfg else None) or {})
    extra = plan_meets_requirement(plan, EXTRA_PAGES_PLAN)
    return {
        "plan": plan,
        "custom_code": plan_meets_requirement(plan, CUSTOM_CODE_PLAN),
        "extra_pages": extra,
        "max_extra_pages": MAX_EXTRA_PAGES if extra else 0,
        "custom_code_plan": CUSTOM_CODE_PLAN,
        "extra_pages_plan": EXTRA_PAGES_PLAN,
    }


def caps_set(caps: dict) -> set[str]:
    return {"custom_code"} if caps.get("custom_code") else set()


def _legacy_landing(config: dict) -> dict:
    if str(config.get("config_version", "1.0")).startswith("2"):
        value = (config.get("customization") or {}).get("landing")
    else:
        value = config.get("landing")
    return value if isinstance(value, dict) else {}


def legacy_has_sections(legacy: dict) -> bool:
    return any(isinstance(s, dict) for s in legacy.get("sections") or [])


def legacy_doc(legacy: dict) -> Optional[dict]:
    """The classic custom landing as a builder document, or None when the
    classic config would have shown the default home (off or empty)."""
    if not legacy.get("enabled") or not legacy_has_sections(legacy):
        return None
    try:
        return validate_doc(convert_landing(legacy))
    except Exception:  # noqa: BLE001 - one odd classic config falls back to the default home
        logger.warning("landing: classic landing did not convert", exc_info=True)
        return None


async def org_context(db: AsyncSession, org: Organization) -> dict:
    """What recipes may weave into copy: the org's name, description and
    newest public courses."""
    from src.db.courses.courses import Course

    rows = (await db.execute(
        select(Course.course_uuid).where(Course.org_id == org.id, Course.public == True, Course.published == True)  # noqa: E712
        .order_by(Course.id.desc()).limit(6)
    )).scalars().all()
    return {
        "org_name": org.name or "",
        "org_description": (org.description or "")[:300],
        "year": datetime.now().year,
        "course_uuids": list(rows),
    }


async def org_brand(db: AsyncSession, org_id: int) -> dict:
    """Whether the org theme sets a brand color and fonts (for "use my brand"
    when applying a template)."""
    cfg = await _org_config(db, org_id)
    config = (cfg.config if cfg else None) or {}
    general = ((config.get("customization") or {}).get("general") if str(config.get("config_version", "1.0")).startswith("2") else config.get("general")) or {}
    theme = ((config.get("customization") or {}).get("theme") if str(config.get("config_version", "1.0")).startswith("2") else (config.get("general") or {}).get("theme")) or {}
    return {
        "has_color": bool(general.get("color")),
        "font": bool(general.get("font") or (theme.get("heading_font") if isinstance(theme, dict) else "")),
    }


async def template_for_org(db: AsyncSession, org: Organization, template: str, palette: str = "template") -> dict:
    """A template built with this org's details, optionally in the org's own
    brand colors and fonts, validated."""
    from src.services.landing import templates as gallery

    ctx = await org_context(db, org)
    try:
        doc = recipes.build_template(template, ctx)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No template '{template}'.")
    if palette == "org":
        doc = gallery.adopt_org_brand(doc, await org_brand(db, org.id))
    return validate_doc(doc)


# ─── site chrome (navigation shared by pages) ─────────────────────────────────


def _has_type(node: dict, etype: str) -> bool:
    return node.get("type") == etype or any(_has_type(c, etype) for c in node.get("children") or [])


def site_chrome(doc: dict) -> tuple[list[dict], list[dict]]:
    """The navbar sections at the top of a page and the footer sections at
    its bottom, so a new page can start with the same navigation."""
    root = doc.get("root") or []
    top: list[dict] = []
    for node in root:
        if _has_type(node, "navbar"):
            top.append(node)
        else:
            break
    bottom: list[dict] = []
    for node in reversed(root[len(top):]):
        if _has_type(node, "footer"):
            bottom.insert(0, node)
        else:
            break
    return top, bottom


def with_chrome(doc: dict, home: dict) -> dict:
    """``doc`` with the home page's navigation and footer around it (fresh
    ids), unless it already has its own."""
    top, bottom = site_chrome(home)
    if not top and not bottom:
        return doc
    out = copy.deepcopy(doc)
    own_top, own_bottom = site_chrome(out)
    root = out.get("root") or []
    new_top = [] if own_top else [recipes.reid(n) for n in top]
    new_bottom = [] if own_bottom else [recipes.reid(n) for n in bottom]
    out["root"] = new_top + root + new_bottom
    return out


def add_nav_link(doc: dict, label: str, href: str) -> Optional[dict]:
    """``doc`` with a link added to its first navbar, or None when it has no
    navbar or already links there."""
    out = copy.deepcopy(doc)
    found: list[dict] = []

    def visit(n: dict) -> None:
        if not found and n.get("type") == "navbar":
            found.append(n)
        for c in n.get("children") or []:
            visit(c)

    for n in out.get("root") or []:
        visit(n)
    if not found:
        return None
    links = found[0].setdefault("props", {}).setdefault("links", [])
    if any(isinstance(lk, dict) and lk.get("href") == href for lk in links) or len(links) >= 12:
        return None
    links.append({"label": label[:120], "href": href})
    return out


# ─── serialization ────────────────────────────────────────────────────────────


def page_summary(page: LandingPage) -> dict:
    return {
        "page_uuid": page.page_uuid,
        "slug": page.slug,
        "title": page.title,
        "is_home": page.slug == "",
        "published": page.published is not None,
        "published_version": page.published_version,
        "published_at": page.published_at,
        "draft_revision": page.draft_revision,
        "draft_updated_at": page.draft_updated_at,
        "has_unpublished_changes": page.published != page.draft,
        "review": page.review,
        "update_date": page.update_date,
    }


def page_detail(page: LandingPage) -> dict:
    return {**page_summary(page), "draft": page.draft, "published_doc": page.published, "preview_token": page.preview_token}


def version_summary(v: LandingPageVersion) -> dict:
    return {
        "version_uuid": v.version_uuid,
        "kind": v.kind,
        "label": v.label,
        "number": v.number,
        "created_by": v.created_by,
        "creation_date": v.creation_date,
        "sections": len(v.doc.get("root") or []) if isinstance(v.doc, dict) else 0,
    }


# ─── pages ────────────────────────────────────────────────────────────────────


async def _pages(db: AsyncSession, org_id: int) -> list[LandingPage]:
    return list((await db.execute(select(LandingPage).where(LandingPage.org_id == org_id).order_by(LandingPage.id))).scalars().all())


async def get_page_row(db: AsyncSession, page_uuid: str, org_id: Optional[int] = None) -> LandingPage:
    stmt = select(LandingPage).where(LandingPage.page_uuid == page_uuid)
    if org_id is not None:
        stmt = stmt.where(LandingPage.org_id == org_id)
    page = (await db.execute(stmt)).scalars().first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    return page


async def _home(db: AsyncSession, org_id: int) -> Optional[LandingPage]:
    return (await db.execute(select(LandingPage).where(LandingPage.org_id == org_id, LandingPage.slug == ""))).scalars().first()


def _new_page(org_id: int, slug: str, title: str, doc: dict, user_id: Optional[int]) -> LandingPage:
    now = _now()
    return LandingPage(
        page_uuid=f"landingpage_{uuid4()}",
        org_id=org_id,
        slug=slug,
        title=title,
        draft=doc,
        draft_revision=1,
        draft_updated_at=now,
        draft_updated_by=user_id,
        preview_token=secrets.token_urlsafe(24),
        creation_date=now,
        update_date=now,
    )


async def default_doc(db: AsyncSession, org: Organization) -> dict:
    return validate_doc(recipes.build_template(recipes.DEFAULT_TEMPLATE, await org_context(db, org)))


async def home_fallback_doc(db: AsyncSession, org: Organization) -> dict:
    """What the home shows before its first publish: the classic landing
    converted on the fly, else the default template."""
    cfg = await _org_config(db, org.id)
    return legacy_doc(_legacy_landing((cfg.config if cfg else None) or {})) or await default_doc(db, org)


async def ensure_home(db: AsyncSession, org: Organization, user: Any) -> LandingPage:
    page = await _home(db, org.id)
    if page:
        return page
    page = _new_page(org.id, "", "Home", await home_fallback_doc(db, org), _user_id(user))
    db.add(page)
    await db.commit()
    await db.refresh(page)
    return page


async def site_overview(request: Request, db: AsyncSession, user: Any, org_id: int) -> dict:
    org = await get_org(db, org_id)
    await require_editor(request, db, user, org)
    await ensure_home(db, org, user)
    return {
        "pages": [page_summary(p) for p in await _pages(db, org_id)],
        "caps": await plan_caps(db, org_id),
    }


async def create_page(
    request: Request, db: AsyncSession, user: Any, org_id: int, *, slug: str, title: str = "", template: Optional[str] = None,
    palette: str = "template", copy_chrome: bool = True, add_to_nav: bool = False,
) -> dict:
    org = await get_org(db, org_id)
    await require_editor(request, db, user, org)
    try:
        slug = check_slug(slug)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not slug:
        raise HTTPException(status_code=400, detail="The home page already exists; give the new page an address like 'about'.")
    if slug in RESERVED_SLUGS:
        raise HTTPException(status_code=400, detail=f"'{slug}' is reserved; pick another address.")
    caps = await plan_caps(db, org_id)
    if not caps["extra_pages"]:
        raise HTTPException(status_code=403, detail=f"Extra pages need the {EXTRA_PAGES_PLAN.capitalize()} plan or higher.")
    extra = [p for p in await _pages(db, org_id) if p.slug]
    if len(extra) >= MAX_EXTRA_PAGES:
        raise HTTPException(status_code=403, detail=f"An organization can have up to {MAX_EXTRA_PAGES} extra pages.")
    if any(p.slug == slug for p in extra):
        raise HTTPException(status_code=409, detail="A page with this address already exists.")
    doc = empty_doc()
    if template:
        doc = await template_for_org(db, org, template, palette)
    home = await _home(db, org_id)
    if copy_chrome and home is not None:
        doc = validate_doc(with_chrome(doc, home.draft), caps=caps_set(caps))
    page_title = (title or slug.replace("-", " ").capitalize())[:120]
    page = _new_page(org_id, slug, page_title, doc, _user_id(user))
    db.add(page)
    await db.commit()
    await db.refresh(page)
    if add_to_nav and home is not None:
        linked = add_nav_link(home.draft, page_title, f"/p/{slug}")
        if linked is not None:
            await write_draft(db, home, validate_doc(linked, caps=caps_set(caps)), _user_id(user), checkpoint=True)
    return page_detail(page)


async def get_page(request: Request, db: AsyncSession, user: Any, page_uuid: str) -> dict:
    page = await get_page_row(db, page_uuid)
    org = await get_org(db, page.org_id)
    await require_editor(request, db, user, org)
    return page_detail(page)


async def update_page_meta(request: Request, db: AsyncSession, user: Any, page_uuid: str, *, title: Optional[str] = None, slug: Optional[str] = None) -> dict:
    page = await get_page_row(db, page_uuid)
    org = await get_org(db, page.org_id)
    await require_editor(request, db, user, org)
    if title is not None:
        page.title = title.strip()[:120]
    if slug is not None and page.slug != "":
        try:
            new = check_slug(slug)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if not new or new in RESERVED_SLUGS:
            raise HTTPException(status_code=400, detail="Pick another address for this page.")
        clash = (await db.execute(select(LandingPage).where(LandingPage.org_id == page.org_id, LandingPage.slug == new, LandingPage.id != page.id))).scalars().first()
        if clash:
            raise HTTPException(status_code=409, detail="A page with this address already exists.")
        page.slug = new
    page.update_date = _now()
    db.add(page)
    await db.commit()
    await db.refresh(page)
    return page_summary(page)


async def delete_page(request: Request, db: AsyncSession, user: Any, page_uuid: str) -> dict:
    page = await get_page_row(db, page_uuid)
    org = await get_org(db, page.org_id)
    await require_editor(request, db, user, org)
    if page.slug == "":
        raise HTTPException(status_code=400, detail="The home page cannot be deleted.")
    await db.delete(page)
    await db.commit()
    return {"detail": "Page deleted"}


# ─── drafts and versions ──────────────────────────────────────────────────────


async def _validated(db: AsyncSession, org_id: int, doc: Any) -> dict:
    caps = await plan_caps(db, org_id)
    try:
        return validate_doc(doc, caps=caps_set(caps))
    except DocError as e:
        raise HTTPException(status_code=422, detail=e.as_detail())


async def _add_version(db: AsyncSession, page: LandingPage, kind: str, doc: dict, user_id: Optional[int], *, label: str = "", number: int = 0) -> LandingPageVersion:
    v = LandingPageVersion(
        version_uuid=f"landingversion_{uuid4()}",
        page_id=page.id,
        org_id=page.org_id,
        kind=kind,
        label=label[:120],
        number=number,
        doc=copy.deepcopy(doc),
        created_by=user_id,
        creation_date=_now(),
    )
    db.add(v)
    await db.flush()
    await _prune(db, page)
    return v


async def _prune(db: AsyncSession, page: LandingPage) -> None:
    count = (await db.execute(select(func.count()).select_from(LandingPageVersion).where(LandingPageVersion.page_id == page.id))).scalar() or 0
    if count <= MAX_VERSIONS:
        return
    old = (await db.execute(
        select(LandingPageVersion).where(LandingPageVersion.page_id == page.id).order_by(LandingPageVersion.id).limit(count - MAX_VERSIONS)
    )).scalars().all()
    for v in old:
        await db.delete(v)


async def _last_version(db: AsyncSession, page: LandingPage) -> Optional[LandingPageVersion]:
    return (await db.execute(
        select(LandingPageVersion).where(LandingPageVersion.page_id == page.id).order_by(LandingPageVersion.id.desc()).limit(1)
    )).scalars().first()


def _revision_conflict(page: LandingPage) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "draft_conflict",
            "message": "This page was changed somewhere else (another tab or person) since you opened it.",
            "draft_revision": page.draft_revision,
            "draft_updated_at": page.draft_updated_at,
            "draft_updated_by": page.draft_updated_by,
        },
    )


async def write_draft(db: AsyncSession, page: LandingPage, doc: dict, user_id: Optional[int], *, base_revision: Optional[int] = None, checkpoint: bool = True) -> LandingPage:
    """Store an already validated draft (revision check, checkpoints)."""
    if base_revision is not None and base_revision != page.draft_revision:
        raise _revision_conflict(page)
    if doc == page.draft:
        return page
    if checkpoint and page.draft and (page.draft.get("root") or page.draft.get("symbols")):
        last = await _last_version(db, page)
        stale = True
        if last is not None:
            try:
                stale = datetime.fromisoformat(last.creation_date) < datetime.now(timezone.utc) - CHECKPOINT_EVERY
            except ValueError:
                stale = True
        if stale:
            await _add_version(db, page, "checkpoint", page.draft, user_id, label="Autosave")
    page.draft = doc
    page.draft_revision += 1
    page.draft_updated_at = _now()
    page.draft_updated_by = user_id
    page.update_date = page.draft_updated_at
    db.add(page)
    await db.commit()
    await db.refresh(page)
    return page


async def save_draft(request: Request, db: AsyncSession, user: Any, page_uuid: str, doc: Any, base_revision: Optional[int]) -> dict:
    page = await get_page_row(db, page_uuid)
    org = await get_org(db, page.org_id)
    await require_editor(request, db, user, org)
    clean = await _validated(db, page.org_id, doc)
    page = await write_draft(db, page, clean, _user_id(user), base_revision=base_revision)
    return {"draft_revision": page.draft_revision, "draft_updated_at": page.draft_updated_at, "draft": page.draft}


async def publish(request: Request, db: AsyncSession, user: Any, page_uuid: str, *, label: str = "", base_revision: Optional[int] = None) -> dict:
    page = await get_page_row(db, page_uuid)
    org = await get_org(db, page.org_id)
    await require_editor(request, db, user, org)
    if base_revision is not None and base_revision != page.draft_revision:
        raise _revision_conflict(page)
    # Re-validated against today's plan: a downgrade must not keep custom code live.
    clean = await _validated(db, page.org_id, page.draft)
    if page.slug and not (await plan_caps(db, page.org_id))["extra_pages"]:
        raise HTTPException(status_code=403, detail=f"Extra pages need the {EXTRA_PAGES_PLAN.capitalize()} plan or higher.")
    return page_detail(await publish_doc(db, page, clean, _user_id(user), label=label))


async def publish_doc(db: AsyncSession, page: LandingPage, clean: dict, uid: Optional[int], *, label: str = "", kind: str = "publish") -> LandingPage:
    """Make an already validated document the live page (and the draft)."""
    now = _now()
    if page.draft != clean:
        page.draft_revision += 1
        page.draft_updated_at = now
        page.draft_updated_by = uid
    page.published_version += 1
    page.published = clean
    page.draft = clean
    page.published_at = now
    page.published_by = uid
    page.review = None
    page.update_date = page.published_at
    await _add_version(db, page, kind, clean, uid, label=label or f"Version {page.published_version}", number=page.published_version)
    db.add(page)
    await db.commit()
    await db.refresh(page)
    return page


async def unpublish(request: Request, db: AsyncSession, user: Any, page_uuid: str) -> dict:
    page = await get_page_row(db, page_uuid)
    org = await get_org(db, page.org_id)
    await require_editor(request, db, user, org)
    if page.slug == "":
        raise HTTPException(status_code=400, detail="The home page is always live; publish a new version instead.")
    page.published = None
    page.update_date = _now()
    db.add(page)
    await db.commit()
    await db.refresh(page)
    return page_detail(page)


async def list_versions(request: Request, db: AsyncSession, user: Any, page_uuid: str) -> list[dict]:
    page = await get_page_row(db, page_uuid)
    org = await get_org(db, page.org_id)
    await require_editor(request, db, user, org)
    rows = (await db.execute(
        select(LandingPageVersion).where(LandingPageVersion.page_id == page.id).order_by(LandingPageVersion.id.desc())
    )).scalars().all()
    return [version_summary(v) for v in rows]


async def _version(db: AsyncSession, version_uuid: str) -> LandingPageVersion:
    v = (await db.execute(select(LandingPageVersion).where(LandingPageVersion.version_uuid == version_uuid))).scalars().first()
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")
    return v


async def get_version(request: Request, db: AsyncSession, user: Any, version_uuid: str) -> dict:
    v = await _version(db, version_uuid)
    org = await get_org(db, v.org_id)
    await require_editor(request, db, user, org)
    return {**version_summary(v), "doc": v.doc}


async def restore_version(request: Request, db: AsyncSession, user: Any, version_uuid: str) -> dict:
    v = await _version(db, version_uuid)
    org = await get_org(db, v.org_id)
    await require_editor(request, db, user, org)
    page = (await db.execute(select(LandingPage).where(LandingPage.id == v.page_id))).scalars().first()
    if page is None:  # pragma: no cover - cascade keeps versions with their page
        raise HTTPException(status_code=404, detail="Page not found")
    clean = await _validated(db, page.org_id, v.doc)
    uid = _user_id(user)
    await _add_version(db, page, "restore", page.draft, uid, label="Before restore")
    page = await write_draft(db, page, clean, uid, checkpoint=False)
    return page_detail(page)


async def save_variant(request: Request, db: AsyncSession, user: Any, page_uuid: str, *, label: str, doc: Any = None) -> dict:
    page = await get_page_row(db, page_uuid)
    org = await get_org(db, page.org_id)
    await require_editor(request, db, user, org)
    clean = await _validated(db, page.org_id, doc if doc is not None else page.draft)
    v = await _add_version(db, page, "variant", clean, _user_id(user), label=label or "Variant")
    await db.commit()
    return version_summary(v)


async def apply_template(request: Request, db: AsyncSession, user: Any, page_uuid: str, template: str, base_revision: Optional[int] = None,
                         palette: str = "template", keep_chrome: bool = True) -> dict:
    page = await get_page_row(db, page_uuid)
    org = await get_org(db, page.org_id)
    await require_editor(request, db, user, org)
    doc = await template_for_org(db, org, template, palette)
    if keep_chrome:
        # The page's own navigation and footer survive a change of template.
        doc = validate_doc(with_chrome(doc, page.draft), caps=caps_set(await plan_caps(db, page.org_id)))
    # Reusable components the page already had stay available.
    if page.draft.get("symbols") and not doc.get("symbols"):
        doc["symbols"] = copy.deepcopy(page.draft["symbols"])
    uid = _user_id(user)
    if page.draft.get("root"):
        await _add_version(db, page, "template", page.draft, uid, label="Before template")
    page = await write_draft(db, page, doc, uid, base_revision=base_revision, checkpoint=False)
    return page_detail(page)


async def rotate_preview(request: Request, db: AsyncSession, user: Any, page_uuid: str) -> dict:
    page = await get_page_row(db, page_uuid)
    org = await get_org(db, page.org_id)
    await require_editor(request, db, user, org)
    page.preview_token = secrets.token_urlsafe(24)
    db.add(page)
    await db.commit()
    return {"preview_token": page.preview_token}


async def resolve_review(request: Request, db: AsyncSession, user: Any, page_uuid: str, action: Literal["keep", "discard"]) -> dict:
    page = await get_page_row(db, page_uuid)
    org = await get_org(db, page.org_id)
    await require_editor(request, db, user, org)
    review = page.review or {}
    if action == "discard" and review.get("base_version_uuid"):
        v = (await db.execute(select(LandingPageVersion).where(LandingPageVersion.version_uuid == review["base_version_uuid"]))).scalars().first()
        if v is not None:
            page.draft = copy.deepcopy(v.doc)
            page.draft_revision += 1
            page.draft_updated_at = _now()
            page.draft_updated_by = _user_id(user)
    page.review = None
    db.add(page)
    await db.commit()
    await db.refresh(page)
    return page_detail(page)


async def agent_write(db: AsyncSession, page: LandingPage, doc: dict, user: Any, *, summary: str, by: str = "atlas") -> LandingPage:
    """An agent's change to the draft. The draft before the first unreviewed
    change is kept, so the builder can show the diff and discard it all."""
    if doc == page.draft:
        return page
    uid = _user_id(user)
    review = dict(page.review or {})
    if not review.get("base_version_uuid"):
        base = await _add_version(db, page, "atlas", page.draft, uid, label="Before Atlas edits" if by == "atlas" else "Before API edits")
        review = {"by": by, "at": _now(), "base_version_uuid": base.version_uuid, "changes": []}
    review["changes"] = (review.get("changes") or [])[-19:] + [{"summary": summary[:300], "at": _now()}]
    page.review = review
    return await write_draft(db, page, doc, uid, checkpoint=False)


# ─── saved sections (reusable across pages) ───────────────────────────────────

MAX_SAVED_SECTIONS = 60


def saved_section_out(row: LandingSavedSection) -> dict:
    return {
        "section_uuid": row.section_uuid,
        "name": row.name,
        "node": row.node,
        "symbols": row.symbols or {},
        "created_by": row.created_by,
        "creation_date": row.creation_date,
        "update_date": row.update_date,
    }


def _used_symbols(node: dict, symbols: dict) -> dict:
    used: dict = {}

    def visit(n: dict) -> None:
        if n.get("type") == "symbol":
            sid = (n.get("props") or {}).get("symbolId")
            if sid in symbols:
                used[sid] = symbols[sid]
        for c in n.get("children") or []:
            visit(c)

    visit(node)
    return used


async def list_saved_sections(request: Request, db: AsyncSession, user: Any, org_id: int) -> list[dict]:
    org = await get_org(db, org_id)
    await require_editor(request, db, user, org)
    rows = (await db.execute(select(LandingSavedSection).where(LandingSavedSection.org_id == org_id).order_by(LandingSavedSection.id.desc()))).scalars().all()
    return [saved_section_out(r) for r in rows]


async def save_section(request: Request, db: AsyncSession, user: Any, org_id: int, *, name: str, node: Any, symbols: Any = None) -> dict:
    """Store a top-level section (validated like a one-section page)."""
    org = await get_org(db, org_id)
    await require_editor(request, db, user, org)
    count = (await db.execute(select(func.count()).select_from(LandingSavedSection).where(LandingSavedSection.org_id == org_id))).scalar() or 0
    if count >= MAX_SAVED_SECTIONS:
        raise HTTPException(status_code=403, detail=f"An organization can keep up to {MAX_SAVED_SECTIONS} saved sections. Delete one first.")
    symbols = symbols if isinstance(symbols, dict) else {}
    if isinstance(node, dict):
        symbols = _used_symbols(node, symbols)
    clean = await _validated(db, org_id, {"root": [node], "symbols": symbols})
    section = clean["root"][0]
    if section.get("type") != "section":
        raise HTTPException(status_code=422, detail={"code": "invalid_page", "message": "Only whole sections can be saved.", "errors": [{"path": "root[0].type", "message": "must be a section"}]})
    now = _now()
    row = LandingSavedSection(
        section_uuid=f"landingsection_{uuid4()}", org_id=org_id, name=(name or section.get("name") or "Section").strip()[:80],
        node=section, symbols=clean.get("symbols") or {}, created_by=_user_id(user), creation_date=now, update_date=now,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return saved_section_out(row)


async def _saved_row(db: AsyncSession, org_id: int, section_uuid: str) -> LandingSavedSection:
    row = (await db.execute(select(LandingSavedSection).where(LandingSavedSection.org_id == org_id, LandingSavedSection.section_uuid == section_uuid))).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Saved section not found")
    return row


async def rename_saved_section(request: Request, db: AsyncSession, user: Any, org_id: int, section_uuid: str, name: str) -> dict:
    org = await get_org(db, org_id)
    await require_editor(request, db, user, org)
    row = await _saved_row(db, org_id, section_uuid)
    row.name = (name or "").strip()[:80] or row.name
    row.update_date = _now()
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return saved_section_out(row)


async def delete_saved_section(request: Request, db: AsyncSession, user: Any, org_id: int, section_uuid: str) -> dict:
    org = await get_org(db, org_id)
    await require_editor(request, db, user, org)
    row = await _saved_row(db, org_id, section_uuid)
    await db.delete(row)
    await db.commit()
    return {"detail": "Deleted"}


# ─── classic landing configs ──────────────────────────────────────────────────


async def import_legacy(request: Request, db: AsyncSession, user: Any, org_id: int, landing: Any) -> dict:
    """Old clients still PUT a classic landing config. It is converted and
    published as the home page (the default home when it is off or empty)."""
    org = await get_org(db, org_id)
    await require_editor(request, db, user, org)
    legacy = landing if isinstance(landing, dict) else {}
    doc = legacy_doc(legacy) or await default_doc(db, org)
    page = await ensure_home(db, org, user)
    uid = _user_id(user)
    if page.draft != page.published and (page.draft.get("root") or page.draft.get("symbols")):
        await _add_version(db, page, "checkpoint", page.draft, uid, label="Before classic import")
    page = await publish_doc(db, page, doc, uid, label="Imported classic landing", kind="convert")
    return page_detail(page)


# ─── public ───────────────────────────────────────────────────────────────────


async def public_page(db: AsyncSession, org_slug: str, slug: str = "", preview: Optional[str] = None) -> dict:
    org = (await db.execute(select(Organization).where(Organization.slug == org_slug))).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Not found")
    try:
        slug = check_slug(slug)
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found")
    page = (await db.execute(select(LandingPage).where(LandingPage.org_id == org.id, LandingPage.slug == slug))).scalars().first()
    if slug == "" and not preview and (page is None or page.published is None):
        return {
            "page_uuid": page.page_uuid if page else None,
            "slug": "",
            "title": page.title if page else "Home",
            "mode": "fallback",
            "version": 0,
            "doc": await home_fallback_doc(db, org),
        }
    if page is None:
        raise HTTPException(status_code=404, detail="Not found")
    if preview:
        if not page.preview_token or not secrets.compare_digest(preview, page.preview_token):
            raise HTTPException(status_code=404, detail="Not found")
        doc, mode = page.draft, "preview"
    else:
        if page.published is None:
            raise HTTPException(status_code=404, detail="Not found")
        if slug and not (await plan_caps(db, org.id))["extra_pages"]:
            raise HTTPException(status_code=404, detail="Not found")
        doc, mode = page.published, "published"
    return {
        "page_uuid": page.page_uuid,
        "slug": page.slug,
        "title": page.title,
        "mode": mode,
        "version": page.published_version,
        "doc": doc,
    }


async def submit_form(request: Request, db: AsyncSession, org_slug: str, slug: str, form_id: str, data: dict) -> dict:
    from src.services.security.rate_limiting import check_rate_limit, get_client_ip

    org = (await db.execute(select(Organization).where(Organization.slug == org_slug))).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Not found")
    try:
        slug = check_slug(slug)
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found")
    page = (await db.execute(select(LandingPage).where(LandingPage.org_id == org.id, LandingPage.slug == slug))).scalars().first()
    if page is None or page.published is None:
        raise HTTPException(status_code=404, detail="Not found")
    form = _find_form(page.published, form_id)
    if form is None:
        raise HTTPException(status_code=404, detail="Form not found")
    if form.get("type") == "newsletter":
        # A newsletter block not linked to a newsletter yet keeps the signups
        # with the form messages, so a published page never loses one.
        form = {"props": {"fields": [{"key": "email", "label": "Email", "type": "email", "required": True}]}}
    ip = get_client_ip(request) or "unknown"
    try:
        allowed, _, retry = check_rate_limit(f"landing_form:{org.id}:{hashlib.sha256(ip.encode()).hexdigest()[:16]}", 8, 3600)
    except Exception:  # noqa: BLE001 - Redis down: accept rather than lose leads
        allowed, retry = True, 0
    if not allowed:
        raise HTTPException(status_code=429, detail=f"Too many messages. Try again in {retry // 60 + 1} minutes.")
    if isinstance(data.get("website"), str) and data.get("website"):
        # Honeypot filled in: a bot. Pretend it worked.
        return {"detail": "Thanks!"}
    clean: dict[str, Any] = {}
    errors = []
    for field in (form.get("props") or {}).get("fields") or []:
        key = field.get("key")
        raw = data.get(key)
        if field.get("type") == "checkbox":
            value: Any = bool(raw)
        else:
            value = (raw if isinstance(raw, str) else "" if raw is None else str(raw)).strip()[: 5000 if field.get("type") == "textarea" else 500]
            if field.get("type") == "email" and value and ("@" not in value or " " in value or len(value) > 254):
                errors.append(f"{field.get('label') or key}: enter a valid email")
            if field.get("type") == "select" and value and value not in (field.get("options") or []):
                errors.append(f"{field.get('label') or key}: pick one of the options")
        if field.get("required") and not value:
            errors.append(f"{field.get('label') or key} is required")
        clean[key] = value
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    count = (await db.execute(select(func.count()).select_from(LandingFormSubmission).where(LandingFormSubmission.org_id == org.id))).scalar() or 0
    if count >= MAX_SUBMISSIONS_PER_ORG:
        raise HTTPException(status_code=429, detail="This form is not accepting messages right now.")
    db.add(LandingFormSubmission(
        submission_uuid=f"landingform_{uuid4()}", org_id=org.id, page_id=page.id, form_id=form_id, data=clean, creation_date=_now(),
    ))
    await db.commit()
    return {"detail": "Thanks!"}


def _find_form(doc: dict, form_id: str) -> Optional[dict]:
    found: list[dict] = []

    def visit(n: dict) -> None:
        if n.get("id") == form_id and n.get("type") in ("form", "newsletter"):
            found.append(n)
        for c in n.get("children") or []:
            visit(c)

    for n in doc.get("root") or []:
        visit(n)
    for sym in (doc.get("symbols") or {}).values():
        visit(sym.get("node") or {})
    return found[0] if found else None


async def list_submissions(request: Request, db: AsyncSession, user: Any, org_id: int, *, page_uuid: Optional[str] = None, limit: int = 100, offset: int = 0) -> dict:
    org = await get_org(db, org_id)
    await require_editor(request, db, user, org)
    stmt = select(LandingFormSubmission).where(LandingFormSubmission.org_id == org_id)
    if page_uuid:
        page = await get_page_row(db, page_uuid, org_id)
        stmt = stmt.where(LandingFormSubmission.page_id == page.id)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    rows = (await db.execute(stmt.order_by(LandingFormSubmission.id.desc()).offset(max(0, offset)).limit(max(1, min(500, limit))))).scalars().all()
    return {
        "total": total,
        "items": [{"submission_uuid": r.submission_uuid, "form_id": r.form_id, "data": r.data, "creation_date": r.creation_date} for r in rows],
    }


async def delete_submission(request: Request, db: AsyncSession, user: Any, org_id: int, submission_uuid: str) -> dict:
    org = await get_org(db, org_id)
    await require_editor(request, db, user, org)
    row = (await db.execute(select(LandingFormSubmission).where(LandingFormSubmission.org_id == org_id, LandingFormSubmission.submission_uuid == submission_uuid))).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    await db.delete(row)
    await db.commit()
    return {"detail": "Deleted"}


def uses_custom_code(doc: dict) -> bool:
    return "html" in element_types_used(doc)
