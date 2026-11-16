"""Landing page tools: Atlas, MCP clients and API tokens design pages.

Every change lands in the page's draft, goes through the same validator as
the builder, and is recorded as unreviewed (``review``): the builder shows the
diff and the member keeps, discards or publishes it. Publishing and switching
the home page to the builder need a person's approval. Tools never call a
model: Atlas (or the MCP client) writes the copy; recipes turn short section
specs into well-styled nodes, so a page an agent builds always validates.

Registered as the ``landing`` toolset (MCP ``?toolsets=landing``, API token
routes ``/api/v1/tools/<name>`` under ``tools/landing``).
"""

from __future__ import annotations

import copy
from typing import Any, Literal, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlmodel import select

from src.db.landing_pages import LandingPage, LandingPageVersion
from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.results import changed
from src.services.landing import recipes, service, tree
from src.services.landing.recipes import PRESETS, SectionSpec
from src.services.landing.schema import DocError, schema_summary, validate_doc

TOOLSET = "landing"
PresetName = Literal["brand", "minimal", "warm", "bold", "elegant", "playful", "dark", "fresh"]
Breakpoint = Literal["base", "tablet", "mobile", "hover"]

BUILDER_PATH = "/dash/org/landing-builder"


class PageRef(BaseModel):
    page: str = Field("home", max_length=120, description="'home', an extra page's address (e.g. 'about') or its page_uuid.")


async def _page(ctx: ToolContext, ref: str) -> LandingPage:
    ref = (ref or "home").strip()
    if ref.startswith("landingpage_"):
        return await service.get_page_row(ctx.db_session, ref, ctx.org.id)
    slug = "" if ref.lower() in ("home", "", "/") else ref.lower().lstrip("/")
    if slug.startswith("p/"):
        slug = slug[2:]
    if slug == "":
        return await service.ensure_home(ctx.db_session, ctx.org, ctx.user)
    page = (await ctx.db_session.execute(select(LandingPage).where(LandingPage.org_id == ctx.org.id, LandingPage.slug == slug))).scalars().first()
    if page is None:
        raise HTTPException(status_code=404, detail=f"No page '{ref}'. Use 'home' or an address from get_landing_page.")
    return page


async def _require_editor(ctx: ToolContext, _p: BaseModel) -> Optional[str]:
    try:
        await service.require_editor(ctx.request, ctx.db_session, ctx.user, ctx.org)
    except HTTPException as e:
        return str(e.detail)
    return None


async def _validate(ctx: ToolContext, doc: dict) -> dict:
    caps = await service.plan_caps(ctx.db_session, ctx.org.id)
    try:
        return validate_doc(doc, caps=service.caps_set(caps))
    except DocError as e:
        raise HTTPException(status_code=400, detail=str(e))


async def _write(ctx: ToolContext, page: LandingPage, doc: dict, summary: str) -> dict:
    clean = await _validate(ctx, doc)
    by = "atlas" if ctx.surface == "agent" else "api"
    page = await service.agent_write(ctx.db_session, page, clean, ctx.user, summary=summary, by=by)
    return changed(
        summary,
        page={"kind": "landing_page", "uuid": page.page_uuid, "name": page.title or "Home", "url": BUILDER_PATH + (f"?page={page.page_uuid}" if page.slug else "")},
        draft_revision=page.draft_revision,
        review="Saved as a draft. The member reviews the changes in the page builder before publishing (publish_landing_page).",
    )


def _ctx_page(page: LandingPage) -> dict:
    return {"page_uuid": page.page_uuid, "slug": page.slug, "title": page.title, "is_home": page.slug == ""}


def _node_or_404(doc: dict, node_id: str) -> dict:
    try:
        return tree.get(doc, node_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No element '{node_id}' on this page. Read the outline with get_landing_page.")


# ─── read ─────────────────────────────────────────────────────────────────────


class GetPageParams(PageRef):
    node_id: Optional[str] = Field(None, max_length=40, description="Return this element in full (props and style).")
    full: bool = Field(False, description="Return the whole draft document instead of the outline.")


async def _get_page(ctx: ToolContext, p: GetPageParams) -> dict:
    page = await _page(ctx, p.page)
    db = ctx.db_session
    pages = await service._pages(db, ctx.org.id)
    out: dict[str, Any] = {
        "page": {**_ctx_page(page), "published": page.published is not None, "published_version": page.published_version,
                 "has_unpublished_changes": page.published != page.draft, "draft_revision": page.draft_revision},
        "pages": [{"slug": x.slug or "home", "title": x.title, "published": x.published is not None} for x in pages],
        "theme": page.draft.get("theme"),
        "symbols": {k: v.get("name") for k, v in (page.draft.get("symbols") or {}).items()},
        "caps": await service.plan_caps(db, ctx.org.id),
    }
    if page.review:
        out["unreviewed_changes"] = page.review.get("changes")
    if p.node_id:
        out["node"] = _node_or_404(page.draft, p.node_id)
    elif p.full:
        out["doc"] = page.draft
    else:
        out["outline"] = tree.outline(page.draft)
    return out


class SchemaParams(BaseModel):
    pass


async def _get_schema(ctx: ToolContext, p: SchemaParams) -> dict:
    return {
        **schema_summary(),
        "section_kinds": list(recipes.SECTION_KINDS),
        "section_spec": SectionSpec.model_json_schema(),
        "presets": {k: {kk: vv for kk, vv in v.items() if kk != "colors"} | {"colors": v.get("colors")} for k, v in PRESETS.items()},
        "templates": recipes.template_summaries(),
        "how_to": [
            "Build or rebuild a page: generate_landing_page with sections (section specs) or a template id.",
            "Add one section: add_landing_section. Fine-tune: update_landing_element (props, style per breakpoint).",
            "Change many texts at once: set_landing_copy. Change the look: restyle_landing_page.",
            "Everything lands in the draft; ask the member to review it in the builder, then publish_landing_page.",
        ],
    }


class VersionsParams(PageRef):
    pass


async def _list_versions(ctx: ToolContext, p: VersionsParams) -> dict:
    page = await _page(ctx, p.page)
    rows = (await ctx.db_session.execute(
        select(LandingPageVersion).where(LandingPageVersion.page_id == page.id).order_by(LandingPageVersion.id.desc()).limit(50)
    )).scalars().all()
    return {"items": [service.version_summary(v) for v in rows], "total": len(rows), "page": _ctx_page(page)}


# ─── build ────────────────────────────────────────────────────────────────────


class GenerateParams(PageRef):
    brief: str = Field("", max_length=3000, description="What the page is for, in the member's words (kept with the change).")
    sections: list[SectionSpec] = Field(default_factory=list, max_length=14, description="The page, top to bottom, as section specs. Write real copy for this org.")
    template: Optional[str] = Field(None, description="Start from a template id instead (see get_landing_schema).")
    preset: Optional[PresetName] = Field(None, description="Style preset; defaults to the template's or 'brand' (org colors).")

    @model_validator(mode="after")
    def _one(self):
        if not self.sections and not self.template:
            raise ValueError("Pass sections (recommended) or a template id.")
        return self


async def _generate(ctx: ToolContext, p: GenerateParams) -> dict:
    page = await _page(ctx, p.page)
    org_ctx = await service.org_context(ctx.db_session, ctx.org)
    if p.sections:
        doc = recipes.build_page(p.sections, ctx=org_ctx, preset=p.preset or "brand")
    else:
        try:
            doc = recipes.build_template(p.template or "", org_ctx)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"No template '{p.template}'. Templates: {', '.join(t['id'] for t in recipes.TEMPLATES)}")
        if p.preset:
            doc["theme"] = recipes.apply_theme(doc["theme"], PRESETS[p.preset])
    # Keep reusable components the page already had.
    doc["symbols"] = copy.deepcopy(page.draft.get("symbols") or {})
    out = await _write(ctx, page, doc, f"Designed a new {'page' if page.slug else 'home page'} with {len(doc['root'])} sections")
    out["outline"] = tree.outline(doc, depth=2)
    return out


class AddSectionParams(PageRef):
    section: SectionSpec
    index: Optional[int] = Field(None, ge=0, description="Position among the top-level sections; omit to append.")
    after_id: Optional[str] = Field(None, max_length=40, description="Insert right after this top-level section instead.")


async def _add_section(ctx: ToolContext, p: AddSectionParams) -> dict:
    page = await _page(ctx, p.page)
    org_ctx = await service.org_context(ctx.db_session, ctx.org)
    node = recipes.build_section(p.section, org_ctx)
    index = p.index
    if p.after_id:
        ids = [n.get("id") for n in page.draft.get("root") or []]
        if p.after_id not in ids:
            raise HTTPException(status_code=404, detail=f"No top-level section '{p.after_id}'.")
        index = ids.index(p.after_id) + 1
    doc = tree.insert(page.draft, node, None, index)
    out = await _write(ctx, page, doc, f"Added a {p.section.kind.replace('_', ' ')} section")
    out["node_id"] = node["id"]
    return out


class AddElementParams(PageRef):
    parent_id: str = Field(..., max_length=40, description="Container, columns or section to add into.")
    element: dict = Field(..., description="A node: {type, props, style?, children?}. Ids are filled in for you.")
    index: Optional[int] = Field(None, ge=0)


def _with_ids(node: Any) -> dict:
    if not isinstance(node, dict):
        raise HTTPException(status_code=400, detail="element must be an object {type, props, ...}")
    node = copy.deepcopy(node)

    def fill(n: dict) -> None:
        n["id"] = recipes.new_id()
        n.setdefault("props", {})
        for c in n.get("children") or []:
            if isinstance(c, dict):
                fill(c)

    fill(node)
    return node


async def _add_element(ctx: ToolContext, p: AddElementParams) -> dict:
    page = await _page(ctx, p.page)
    _node_or_404(page.draft, p.parent_id)
    node = _with_ids(p.element)
    doc = tree.insert(page.draft, node, p.parent_id, p.index)
    out = await _write(ctx, page, doc, f"Added a {node.get('type')} element")
    out["node_id"] = node["id"]
    return out


class UpdateElementParams(PageRef):
    node_id: str = Field(..., max_length=40)
    props: Optional[dict] = Field(None, description="Props to change (merged; other props stay).")
    style: Optional[dict] = Field(None, description="{base|tablet|mobile|hover: {key: value}}, merged; a null value removes a key. Use mobile/tablet to change only smaller screens.")
    name: Optional[str] = Field(None, max_length=80)
    hidden: Optional[dict] = Field(None, description="{desktop, tablet, mobile}: hide on those screens.")
    visibility: Optional[Literal["everyone", "logged_in", "logged_out"]] = None
    animation: Optional[dict] = Field(None, description="{type: none|fade|slide-up|slide-in|zoom, delay, duration}")
    anchor: Optional[str] = Field(None, max_length=64, description="Element id for links like #pricing; '' removes it.")

    @model_validator(mode="after")
    def _some(self):
        if all(getattr(self, k) is None for k in ("props", "style", "name", "hidden", "visibility", "animation", "anchor")):
            raise ValueError("Pass at least one of props, style, name, hidden, visibility, animation or anchor.")
        return self


async def _update_element(ctx: ToolContext, p: UpdateElementParams) -> dict:
    page = await _page(ctx, p.page)
    doc = copy.deepcopy(page.draft)
    node = _node_or_404(doc, p.node_id)
    if p.props is not None:
        node["props"] = {**(node.get("props") or {}), **p.props}
    if p.style is not None:
        merged = tree.merge_style(node.get("style"), p.style)
        if merged:
            node["style"] = merged
        else:
            node.pop("style", None)
    if p.name is not None:
        node["name"] = p.name
    if p.hidden is not None:
        node["hidden"] = p.hidden
    if p.visibility is not None:
        node["visibility"] = p.visibility
    if p.animation is not None:
        node["animation"] = p.animation
    if p.anchor is not None:
        if p.anchor:
            node["anchor"] = p.anchor
        else:
            node.pop("anchor", None)
    changed_keys = [k for k in ("props", "style", "name", "hidden", "visibility", "animation", "anchor") if getattr(p, k) is not None]
    return await _write(ctx, page, doc, f"Updated the {node.get('name') or node.get('type')} ({', '.join(changed_keys)})")


class MoveParams(PageRef):
    node_id: str = Field(..., max_length=40)
    parent_id: Optional[str] = Field(None, max_length=40, description="New parent; omit to move a section among the top-level sections.")
    index: Optional[int] = Field(None, ge=0, description="New position in the parent; omit for the end.")


async def _move(ctx: ToolContext, p: MoveParams) -> dict:
    page = await _page(ctx, p.page)
    node = _node_or_404(page.draft, p.node_id)
    if p.parent_id:
        _node_or_404(page.draft, p.parent_id)
    try:
        doc = tree.move(page.draft, p.node_id, p.parent_id, p.index)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return await _write(ctx, page, doc, f"Moved the {node.get('name') or node.get('type')}")


class NodeParams(PageRef):
    node_id: str = Field(..., max_length=40)


async def _remove(ctx: ToolContext, p: NodeParams) -> dict:
    page = await _page(ctx, p.page)
    node = _node_or_404(page.draft, p.node_id)
    doc, _ = tree.remove(page.draft, p.node_id)
    return await _write(ctx, page, doc, f"Removed the {node.get('name') or node.get('type')}")


async def _duplicate(ctx: ToolContext, p: NodeParams) -> dict:
    page = await _page(ctx, p.page)
    node = _node_or_404(page.draft, p.node_id)
    doc, clone = tree.duplicate(page.draft, p.node_id)
    out = await _write(ctx, page, doc, f"Duplicated the {node.get('name') or node.get('type')}")
    out["node_id"] = clone["id"]
    return out


class RestyleParams(PageRef):
    preset: Optional[PresetName] = Field(None, description="minimal, warm, bold, elegant, playful, dark, fresh or brand (org colors).")
    theme: Optional[dict] = Field(None, description="Theme fields to change: colors {primary, secondary, accent, background, surface, text, muted, border}, fonts {heading, body}, radius, buttonStyle, width, density, headingWeight.")

    @model_validator(mode="after")
    def _some(self):
        if self.preset is None and not self.theme:
            raise ValueError("Pass a preset or theme changes.")
        return self


def _restyled(theme: dict, preset: Optional[str], changes: Optional[dict]) -> dict:
    out = theme
    try:
        if preset:
            out = recipes.apply_theme(out, PRESETS[preset])
        if changes:
            out = recipes.apply_theme(out, changes)
    except Exception as e:  # pydantic ValidationError
        raise HTTPException(status_code=400, detail=f"Invalid theme: {e}")
    return out


async def _restyle(ctx: ToolContext, p: RestyleParams) -> dict:
    page = await _page(ctx, p.page)
    doc = copy.deepcopy(page.draft)
    doc["theme"] = _restyled(doc.get("theme") or {}, p.preset, p.theme)
    return await _write(ctx, page, doc, f"Restyled the page{f' ({p.preset})' if p.preset else ''}")


class CopyChange(BaseModel):
    node_id: str = Field(..., max_length=40)
    field: str = Field("text", max_length=80, description="Prop to set: text, label, markdown, caption... or a path into lists like items.0.title / plans.1.price.")
    value: Any


class CopyParams(PageRef):
    changes: list[CopyChange] = Field(..., min_length=1, max_length=80)


def _apply_copy(doc: dict, changes: list[CopyChange]) -> dict:
    doc = copy.deepcopy(doc)
    for c in changes:
        node = _node_or_404(doc, c.node_id)
        props = node.setdefault("props", {})
        try:
            tree.set_path(props, c.field, c.value)
        except KeyError:
            raise HTTPException(status_code=400, detail=f"{c.node_id}: no field '{c.field}' on this {node.get('type')}.")
    return doc


async def _set_copy(ctx: ToolContext, p: CopyParams) -> dict:
    page = await _page(ctx, p.page)
    doc = _apply_copy(page.draft, p.changes)
    return await _write(ctx, page, doc, f"Rewrote {len(p.changes)} text(s)")


class VariantParams(PageRef):
    label: str = Field(..., max_length=120, description="Name shown in the builder's history, e.g. 'Variant B: warmer'.")
    preset: Optional[PresetName] = None
    theme: Optional[dict] = None
    changes: list[CopyChange] = Field(default_factory=list, max_length=80, description="Copy changes for this variant.")


async def _variant(ctx: ToolContext, p: VariantParams) -> dict:
    page = await _page(ctx, p.page)
    doc = _apply_copy(page.draft, p.changes) if p.changes else copy.deepcopy(page.draft)
    if p.preset or p.theme:
        doc["theme"] = _restyled(doc.get("theme") or {}, p.preset, p.theme)
    clean = await _validate(ctx, doc)
    v = await service._add_version(ctx.db_session, page, "variant", clean, service._user_id(ctx.user), label=p.label)
    await ctx.db_session.commit()
    return changed(
        f"Saved the variant '{p.label}' (the draft is unchanged)",
        version={"kind": "landing_variant", "uuid": v.version_uuid, "name": p.label},
        next_step="The member previews variants in the builder's history and picks one (restore_landing_version).",
    )


class RestoreParams(PageRef):
    version_uuid: str = Field(..., max_length=100)


async def _restore(ctx: ToolContext, p: RestoreParams) -> dict:
    page = await _page(ctx, p.page)
    v = (await ctx.db_session.execute(select(LandingPageVersion).where(LandingPageVersion.version_uuid == p.version_uuid, LandingPageVersion.page_id == page.id))).scalars().first()
    if v is None:
        raise HTTPException(status_code=404, detail="No such version for this page (list_landing_versions).")
    return await _write(ctx, page, copy.deepcopy(v.doc), f"Restored '{v.label or v.kind}' into the draft")


class PublishParams(PageRef):
    pass


async def _publish(ctx: ToolContext, p: PublishParams) -> dict:
    page = await _page(ctx, p.page)
    detail = await service.publish(ctx.request, ctx.db_session, ctx.user, page.page_uuid, label="Published by Atlas" if ctx.surface == "agent" else "Published via API")
    url = "/" if not detail["slug"] else f"/p/{detail['slug']}"
    return changed(f"Published version {detail['published_version']} of {'the home page' if not detail['slug'] else detail['title']}", url=url)


# ─── templates ────────────────────────────────────────────────────────────────


class ListTemplatesParams(BaseModel):
    category: Optional[str] = Field(None, max_length=40, description="Only one kind of school (academy, bootcamp, corporate, university, creator, language, health, coding, kids, nonprofit, cohort, community, partner, art, certification).")
    scheme: Optional[Literal["light", "dark"]] = None


async def _list_templates(ctx: ToolContext, p: ListTemplatesParams) -> dict:
    from src.services.landing import templates as gallery

    items = [t for t in recipes.template_summaries() if (not p.category or t.get("category") == p.category) and (not p.scheme or t.get("scheme", "light") == p.scheme)]
    return {
        "templates": [{k: t.get(k) for k in ("id", "name", "description", "category", "scheme", "tags", "palette", "fonts", "sections")} for t in items],
        "categories": list(gallery.CATEGORIES),
        "how_to": "apply_landing_template replaces a page's draft with a template (palette='org' uses the organization's brand); "
                  "add_landing_template_section adds one designed section.",
    }


class ApplyTemplateParams(PageRef):
    template: str = Field(..., max_length=40, description="A template id from list_landing_templates.")
    palette: Literal["template", "org"] = Field("template", description="'org' swaps the template's colors and fonts for the organization's brand.")
    keep_chrome: bool = Field(True, description="Keep the page's own navigation and footer sections.")


async def _apply_template(ctx: ToolContext, p: ApplyTemplateParams) -> dict:
    page = await _page(ctx, p.page)
    doc = await service.template_for_org(ctx.db_session, ctx.org, p.template, p.palette)
    if p.keep_chrome:
        doc = service.with_chrome(doc, page.draft)
    doc["symbols"] = {**copy.deepcopy(page.draft.get("symbols") or {}), **(doc.get("symbols") or {})}
    out = await _write(ctx, page, doc, f"Applied the '{p.template}' template" + (" in the organization's brand" if p.palette == "org" else ""))
    out["outline"] = tree.outline(doc, depth=1)
    return out


class TemplateSectionsParams(BaseModel):
    template: str = Field(..., max_length=40)


def _template_or_404(template: str) -> dict:
    from src.services.landing import templates as gallery

    if not gallery.has(template):
        raise HTTPException(status_code=404, detail=f"No designed template '{template}'. See list_landing_templates.")
    return gallery.build(template, {})


async def _list_template_sections(ctx: ToolContext, p: TemplateSectionsParams) -> dict:
    doc = _template_or_404(p.template)
    return {"template": p.template, "sections": [{"index": i, "name": n.get("name") or n["type"]} for i, n in enumerate(doc["root"])]}


class AddTemplateSectionParams(PageRef):
    template: str = Field(..., max_length=40)
    index: int = Field(..., ge=0, description="The section's index in list_landing_template_sections.")
    position: Optional[int] = Field(None, ge=0, description="Where to insert among the page's top-level sections; omit to append.")


async def _add_template_section(ctx: ToolContext, p: AddTemplateSectionParams) -> dict:
    page = await _page(ctx, p.page)
    org_ctx = await service.org_context(ctx.db_session, ctx.org)
    from src.services.landing import templates as gallery

    _template_or_404(p.template)
    root = gallery.build(p.template, org_ctx)["root"]
    if p.index >= len(root):
        raise HTTPException(status_code=404, detail=f"The '{p.template}' template has {len(root)} sections (0-{len(root) - 1}).")
    node = recipes.reid(root[p.index])
    doc = copy.deepcopy(page.draft)
    items = doc.setdefault("root", [])
    items.insert(min(p.position, len(items)) if p.position is not None else len(items), node)
    return await _write(ctx, page, doc, f"Added the '{node.get('name') or node['type']}' section from the '{p.template}' template")


# ─── organization theme ───────────────────────────────────────────────────────


class GetThemeParams(BaseModel):
    pass


async def _get_theme(ctx: ToolContext, p: GetThemeParams) -> dict:
    from src.db.organization_config import ThemeCustomization
    from src.services.orgs.theme import THEME_PRESETS, current_theme_state

    cfg = await service._org_config(ctx.db_session, ctx.org.id)
    options = {
        name: list(getattr(field.annotation, "__args__", ()))
        for name, field in ThemeCustomization.model_fields.items()
        if getattr(field.annotation, "__args__", None)
    }
    return {
        "theme": current_theme_state((cfg.config if cfg else None) or {}),
        "presets": list(THEME_PRESETS),
        "options": options,
        "notes": "Colors are #rrggbb. 'color' is the brand color, 'font' the body font; theme.heading_font is the heading font. "
                 "Changes apply to every public page at once, so update_org_theme needs the member's approval.",
    }


class UpdateThemeParams(BaseModel):
    preset: Optional[str] = Field(None, max_length=20, description="Start from a preset (see get_org_theme), then apply the fields below.")
    color: Optional[str] = Field(None, max_length=7, description="Brand color #rrggbb ('' for none).")
    font: Optional[str] = Field(None, max_length=64, description="Body font (Google Fonts family name, '' for the default).")
    theme: dict = Field(default_factory=dict, description="Theme options to change (merged): accent_mode, accent_color, header_style, radius, heading_font, button_style, card_style, density, background, secondary_color, neutral, type_scale, heading_weight, button_shape, elevation, link_style, header_layout, footer_style, image_style, public_scheme, dark_accent.")


async def _update_theme(ctx: ToolContext, p: UpdateThemeParams) -> dict:
    from src.services.orgs.theme import THEME_PRESETS, current_theme_state, preset_state, update_org_theme_config

    cfg = await service._org_config(ctx.db_session, ctx.org.id)
    if p.preset is not None and p.preset not in THEME_PRESETS:
        raise HTTPException(status_code=400, detail=f"No preset '{p.preset}'. Presets: {', '.join(THEME_PRESETS)}")
    state = preset_state(p.preset) if p.preset else current_theme_state((cfg.config if cfg else None) or {})
    if p.color is not None:
        state["color"] = p.color
    if p.font is not None:
        state["font"] = p.font
    if p.theme:
        state["theme"] = {**state["theme"], **p.theme, "preset": p.theme.get("preset", "custom" if not p.preset else p.preset)}
    out = await update_org_theme_config(ctx.request, state, ctx.org.id, ctx.user, ctx.db_session)
    return changed("Updated the organization theme" + (f" from the '{p.preset}' preset" if p.preset else ""), theme=out["theme"], color=out["color"], font=out["font"],
                   page={"kind": "organization", "uuid": ctx.org.org_uuid, "name": "Branding", "url": "/dash/org/settings/branding"})


# ─── specs ────────────────────────────────────────────────────────────────────


def _spec(name: str, description: str, params, tier: ActionTier, fn, title: str, **kw) -> ToolSpec:
    return ToolSpec(
        name=name,
        description=description,
        params_model=params,
        tier=tier,
        rights_bucket="organizations",
        access_action=AccessAction.READ if tier is ActionTier.READ else AccessAction.UPDATE,
        execute=fn,
        preflight=_require_editor,
        access="admin",
        target_kind="landing_page",
        title=title,
        **kw,
    )


SPECS: list[ToolSpec] = [
    _spec("get_landing_page", "Read the organization's landing page draft: an outline of sections and elements with their ids, the theme, publish status, pages and plan limits. Pass node_id for one element in full, or full=true for the whole document.",
          GetPageParams, ActionTier.READ, _get_page, "Read landing page"),
    _spec("get_landing_schema", "The landing page format: element types and their props, style keys, theme tokens, section specs, style presets and templates. Read it before designing.",
          SchemaParams, ActionTier.READ, _get_schema, "Landing page format"),
    _spec("list_landing_versions", "A landing page's history: publishes, restores, Atlas edits, variants and autosave checkpoints.",
          VersionsParams, ActionTier.READ, _list_versions, "Landing page history"),
    _spec("generate_landing_page", "Design a whole landing page (replaces the draft): pass the sections top to bottom as section specs with real copy for this org (courses, paths and other data sections pull live content), or a template id, plus a style preset. Saved as a draft for review.",
          GenerateParams, ActionTier.EDIT, _generate, "Design landing page", summarize=lambda p: f"Design the {p.page} landing page"),
    _spec("add_landing_section", "Add one ready-made section (hero, features, courses, pricing, faq, testimonials, cta, contact...) from a section spec, at a position or after a section.",
          AddSectionParams, ActionTier.EDIT, _add_section, "Add landing section", summarize=lambda p: f"Add a {p.section.kind} section to the {p.page} page"),
    _spec("add_landing_element", "Add one element (heading, text, button, image, columns, container, any data block) inside a container or section.",
          AddElementParams, ActionTier.EDIT, _add_element, "Add landing element"),
    _spec("update_landing_element", "Change one element: props (merged), style per breakpoint (base, tablet, mobile, hover), name, hidden screens, visibility, animation or anchor.",
          UpdateElementParams, ActionTier.EDIT, _update_element, "Update landing element"),
    _spec("move_landing_element", "Move an element (or reorder sections) to a new parent and position.",
          MoveParams, ActionTier.EDIT, _move, "Move landing element"),
    _spec("remove_landing_element", "Remove an element or section from the draft.",
          NodeParams, ActionTier.EDIT, _remove, "Remove landing element"),
    _spec("duplicate_landing_element", "Duplicate an element or section right after itself.",
          NodeParams, ActionTier.EDIT, _duplicate, "Duplicate landing element"),
    _spec("restyle_landing_page", "Change the whole page's look: a style preset (warm, minimal, bold, elegant, playful, dark, fresh, brand) and/or theme tokens (colors, fonts, radius, button style, width, density).",
          RestyleParams, ActionTier.EDIT, _restyle, "Restyle landing page"),
    _spec("set_landing_copy", "Rewrite many texts at once: headings, paragraphs, button labels, list items (items.0.title), pricing (plans.1.price)...",
          CopyParams, ActionTier.EDIT, _set_copy, "Write landing copy"),
    _spec("create_landing_variant", "Save a variant of the page (other copy and/or style) to the history without changing the draft, so the member can compare and pick.",
          VariantParams, ActionTier.CREATE, _variant, "Create landing variant"),
    _spec("restore_landing_version", "Put an earlier version or a variant back into the draft.",
          RestoreParams, ActionTier.EDIT, _restore, "Restore landing version"),
    _spec("list_landing_templates", "The designed page templates (one per kind of school) with their palette, fonts and sections. Filter by category or light/dark.",
          ListTemplatesParams, ActionTier.READ, _list_templates, "List landing templates"),
    _spec("apply_landing_template", "Replace a page's draft with a designed template, built with the organization's name and live courses. palette='org' uses the organization's brand colors and fonts. Saved as a draft for review.",
          ApplyTemplateParams, ActionTier.EDIT, _apply_template, "Apply landing template", summarize=lambda p: f"Apply the {p.template} template to the {p.page} page"),
    _spec("list_landing_template_sections", "The sections of one designed template (index and name), to add one to a page with add_landing_template_section.",
          TemplateSectionsParams, ActionTier.READ, _list_template_sections, "List template sections"),
    _spec("add_landing_template_section", "Add one designed section from a template (by index) to a page's draft.",
          AddTemplateSectionParams, ActionTier.EDIT, _add_template_section, "Add template section", summarize=lambda p: f"Add a section from the {p.template} template to the {p.page} page"),
    _spec("get_org_theme", "The organization's theme (brand color, fonts, every theme option and its allowed values) and the presets.",
          GetThemeParams, ActionTier.READ, _get_theme, "Read organization theme"),
    _spec("update_org_theme", "Change the organization's theme for all public pages: apply a preset and/or change colors, fonts and options. Goes live at once, so it needs the member's approval.",
          UpdateThemeParams, ActionTier.EDIT, _update_theme, "Update organization theme", approval=True,
          summarize=lambda p: "Change the organization theme" + (f" to the {p.preset} preset" if p.preset else "")),
    _spec("publish_landing_page", "Publish a landing page's draft so visitors see it. Needs the member's approval.",
          PublishParams, ActionTier.EDIT, _publish, "Publish landing page", approval=True, summarize=lambda p: f"Publish the {p.page} landing page"),
]
