"""Landing builder v2: the designed template gallery, applying a template in
the org's brand, site chrome shared by new pages, saved sections, the new
document fields (radial gradients, dark palette, social image) and the
matching routes and tools."""

import copy
from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.landing_pages import LandingSavedSection
from src.db.organization_config import OrganizationConfig
from src.routers import landing as router
from src.services.ai.tools import ToolRegistry, run_tool
from src.services.ai.tools.base import ToolContext, make_synthetic_request
from src.services.landing import recipes, service, templates, tools
from src.services.landing.schema import DocError, empty_doc, theme_dump, Theme, validate_doc
from src.services.landing.templates import kit

NOW = str(datetime.now())
CTX = {"org_name": "Kite Academy", "year": 2026, "course_uuids": []}


def _nav_doc():
    doc = empty_doc()
    doc["root"] = [
        {"id": "nav", "type": "section", "props": {"tag": "header"}, "children": [{"id": "nb", "type": "navbar", "props": {"links": [{"label": "Courses", "href": "/courses"}]}}]},
        {"id": "body", "type": "section", "props": {}, "children": [{"id": "h", "type": "heading", "props": {"text": "Hi", "level": 1}}]},
        {"id": "foot", "type": "section", "props": {"tag": "footer"}, "children": [{"id": "fb", "type": "footer", "props": {}}]},
    ]
    return doc


@pytest.fixture
async def config(db, org):
    cfg = OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "plan": "pro", "customization": {}}, creation_date=NOW, update_date=NOW)
    db.add(cfg)
    await db.commit()
    await db.refresh(cfg)
    return cfg


# ─── gallery ──────────────────────────────────────────────────────────────────


def test_every_template_is_valid_distinct_and_named():
    assert len(templates.GALLERY) == 15
    fonts, palettes = set(), set()
    for tpl in templates.GALLERY:
        doc = recipes.build_template(tpl["id"], CTX)
        clean = validate_doc(doc)
        assert len(clean["root"]) >= 5, tpl["id"]
        # Real copy, never placeholder text.
        assert "lorem" not in str(clean).lower()
        fonts.add((clean["theme"]["fonts"]["heading"], clean["theme"]["fonts"]["body"]))
        palettes.add(clean["theme"]["colors"]["primary"])
        # Data sections bind to the org's live content.
        used = {n["type"] for n in _walk(clean)}
        assert used & {"courses", "paths", "live_sessions", "communities", "course"}, tpl["id"]
        # Pictures are bundled art, never hotlinked.
        for n in _walk(clean):
            src = (n.get("props") or {}).get("src") or ""
            assert not src.startswith("http"), (tpl["id"], src)
    assert len(fonts) >= 12 and len(palettes) == 15
    # The org name is woven into the copy.
    assert "Kite Academy" in str(recipes.build_template("academy", CTX))


def _walk(doc):
    out = []

    def visit(n):
        out.append(n)
        for c in n.get("children") or []:
            visit(c)

    for n in doc["root"]:
        visit(n)
    return out


def test_gallery_helpers():
    assert templates.has("bootcamp") and not templates.has("nope")
    with pytest.raises(KeyError):
        templates.build("nope")
    first = templates.summaries()
    assert first[0]["palette"] and first[0]["fonts"] and first[0]["featured"]
    first[0]["name"] = "changed"
    # Cached, but callers get their own copy.
    assert templates.summaries()[0]["name"] == "Meridian"
    lib = templates.library_sections()
    assert len(lib) > 60 and {x["template"] for x in lib} == {t["id"] for t in templates.GALLERY}
    assert set(templates.CATEGORIES) >= {"academy", "bootcamp", "certification"}
    # Without an org name the copy still reads naturally.
    assert "the Academy" in str(templates.build("academy", {}))


def test_template_summaries_hide_legacy_unless_asked():
    ids = [t["id"] for t in recipes.template_summaries()]
    assert ids[:15] == [t["id"] for t in templates.GALLERY] and "default" in ids and "creator" not in ids
    legacy = recipes.template_summaries(include_legacy=True)
    assert "creator" in [t["id"] for t in legacy]
    assert set(recipes.template_ids()) >= {"academy", "default", "creator"}
    # Old recipe templates still build for old links and agents.
    assert validate_doc(recipes.build_template("creator", CTX))["root"]


def test_adopt_org_brand():
    doc = templates.build("academy", CTX)
    brand = templates.adopt_org_brand(doc, {"has_color": True, "font": True})
    assert brand["theme"]["colors"]["primary"] == "brand"
    assert brand["theme"]["fonts"] == {"heading": "brand", "body": "brand"}
    # Neutrals stay, so the design keeps its contrast.
    assert brand["theme"]["colors"]["background"] == doc["theme"]["colors"]["background"]
    plain = templates.adopt_org_brand(doc, {"has_color": False, "font": False})
    assert plain["theme"]["colors"]["primary"] == doc["theme"]["colors"]["primary"] and plain["theme"]["fonts"]["heading"] == "Fraunces"
    assert templates.adopt_org_brand({}, None)["theme"]["colors"]["primary"] == "brand"


def test_kit_helpers():
    assert kit.rs() is None
    assert kit.rs({"color": None}) is None
    assert kit.rs({"color": "$text"}, hover={"opacity": 0.5}) == {"base": {"color": "$text"}, "hover": {"opacity": 0.5}}
    assert kit.icon("Star")["props"]["name"] == "Star"
    assert kit.box([], href="/courses")["props"] == {"href": "/courses"}
    assert kit.theme(primary="#000000", secondary="#000000", accent="#000000", background="#ffffff", surface="#ffffff", text="#000000", muted="#000000",
                     border="#000000", heading="Inter", body="Inter", dark={"background": "#000000"})["dark"] == {"background": "#000000"}
    assert kit.page({}, [])["page"] == {}
    assert kit.page({}, [], background="#ffffff")["page"] == {"background": "#ffffff"}
    assert kit.art("x") == "/landing-t-x.svg"


# ─── document fields ──────────────────────────────────────────────────────────


def test_radial_gradient_dark_palette_and_social_image():
    doc = empty_doc()
    doc["theme"]["dark"] = {"background": "#000000", "surface": "#111111", "text": "#ffffff", "muted": "#999999", "border": "#222222", "primary": "#ff00ff"}
    doc["page"] = {"image": "/media/og.png", "noindex": True, "title": "T"}
    doc["root"] = [{"id": "s", "type": "section", "props": {}, "style": {"base": {"backgroundGradient": {"from": "$primary", "to": "#000000", "type": "radial"}}}, "children": []}]
    clean = validate_doc(doc)
    assert clean["theme"]["dark"]["primary"] == "#ff00ff"
    assert clean["page"] == {"image": "/media/og.png", "noindex": True, "title": "T"}
    assert clean["root"][0]["style"]["base"]["backgroundGradient"]["type"] == "radial"
    # A linear gradient stays as it was stored (no type key added).
    doc["root"][0]["style"]["base"]["backgroundGradient"] = {"from": "$primary", "to": "#000000"}
    doc["theme"]["dark"].pop("primary")
    clean = validate_doc(doc)
    assert "type" not in clean["root"][0]["style"]["base"]["backgroundGradient"] and "primary" not in clean["theme"]["dark"]
    # noindex false is dropped like other empty settings.
    doc["page"] = {"noindex": False}
    assert validate_doc(doc)["page"] == {}
    with pytest.raises(DocError):
        validate_doc({**doc, "theme": {"dark": {"background": "red"}}})
    with pytest.raises(DocError):
        validate_doc({**doc, "page": {"image": "javascript:alert(1)"}})
    assert "dark" not in validate_doc(empty_doc())["theme"]
    explicit = validate_doc({**empty_doc(), "theme": {"dark": {"primary": None}}})
    assert "primary" not in explicit["theme"]["dark"]
    assert "dark" not in theme_dump(Theme())


# ─── service ──────────────────────────────────────────────────────────────────


def test_site_chrome_and_nav_links():
    doc = _nav_doc()
    top, bottom = service.site_chrome(doc)
    assert [n["id"] for n in top] == ["nav"] and [n["id"] for n in bottom] == ["foot"]
    assert service.site_chrome(empty_doc()) == ([], [])
    page = empty_doc()
    page["root"] = [{"id": "x", "type": "section", "props": {}, "children": []}]
    wrapped = service.with_chrome(page, doc)
    assert len(wrapped["root"]) == 3 and wrapped["root"][1]["id"] == "x"
    # Fresh ids, so the copies never clash with the home page's.
    assert wrapped["root"][0]["id"] != "nav"
    # A page with its own navigation keeps it; without home chrome nothing changes.
    assert len(service.with_chrome(doc, doc)["root"]) == 3
    assert service.with_chrome(page, empty_doc()) is page
    linked = service.add_nav_link(doc, "About", "/p/about")
    assert linked["root"][0]["children"][0]["props"]["links"][-1] == {"label": "About", "href": "/p/about"}
    assert service.add_nav_link(linked, "About", "/p/about") is None
    assert service.add_nav_link(empty_doc(), "About", "/p/about") is None
    full = copy.deepcopy(doc)
    full["root"][0]["children"][0]["props"]["links"] = [{"label": str(i), "href": f"/{i}"} for i in range(12)]
    assert service.add_nav_link(full, "About", "/p/about") is None


async def test_org_brand_reads_v1_and_v2(db, org, config):
    assert await service.org_brand(db, org.id) == {"has_color": False, "font": False}
    config.config = {"config_version": "2.0", "plan": "pro", "customization": {"general": {"color": "#112233"}, "theme": {"heading_font": "Lora"}}}
    db.add(config)
    await db.commit()
    assert await service.org_brand(db, org.id) == {"has_color": True, "font": True}
    config.config = {"config_version": "1.4", "general": {"color": "", "font": "Inter", "theme": {}}}
    db.add(config)
    await db.commit()
    assert await service.org_brand(db, org.id) == {"has_color": False, "font": True}


async def test_apply_template_palette_chrome_and_symbols(db, org, config, mock_request, admin_user):
    config.config = {**config.config, "customization": {"general": {"color": "#0055ff", "font": "Inter"}}}
    db.add(config)
    await db.commit()
    page = await service.ensure_home(db, org, admin_user)
    doc = _nav_doc()
    doc["symbols"] = {"sym": {"name": "S", "node": {"id": "sn", "type": "text", "props": {"text": "x"}}}}
    await service.save_draft(mock_request, db, admin_user, page.page_uuid, doc, None)
    applied = await service.apply_template(mock_request, db, admin_user, page.page_uuid, "bootcamp", palette="org")
    draft = applied["draft"]
    assert draft["theme"]["colors"]["primary"] == "brand" and draft["theme"]["fonts"]["body"] == "brand"
    # The page's navigation and footer survive, around the template.
    assert service._has_type(draft["root"][0], "navbar") and service._has_type(draft["root"][-1], "footer")
    assert "sym" in draft["symbols"]
    bare = await service.apply_template(mock_request, db, admin_user, page.page_uuid, "academy", keep_chrome=False)
    assert not service._has_type(bare["draft"]["root"][0], "navbar")
    assert bare["draft"]["theme"]["colors"]["primary"] == "#1f4d3a"
    with pytest.raises(HTTPException) as e:
        await service.template_for_org(db, org, "nope")
    assert e.value.status_code == 404


async def test_new_page_copies_chrome_and_links_from_home(db, org, config, mock_request, admin_user):
    home = await service.ensure_home(db, org, admin_user)
    await service.save_draft(mock_request, db, admin_user, home.page_uuid, _nav_doc(), None)
    page = await service.create_page(mock_request, db, admin_user, org.id, slug="about", title="About us", template="cohort", palette="org", add_to_nav=True)
    assert service._has_type(page["draft"]["root"][0], "navbar")
    assert page["draft"]["theme"]["fonts"]["heading"] == "Instrument Serif"  # no org font: the template's stays
    home = await service.get_page_row(db, home.page_uuid)
    assert {"label": "About us", "href": "/p/about"} in home.draft["root"][0]["children"][0]["props"]["links"]
    plain = await service.create_page(mock_request, db, admin_user, org.id, slug="faq", copy_chrome=False)
    assert plain["draft"]["root"] == []
    # Already linked or no navbar: nothing to add, the home page stays as is.
    rev = (await service.get_page_row(db, home.page_uuid)).draft_revision
    await service.create_page(mock_request, db, admin_user, org.id, slug="team", add_to_nav=True, copy_chrome=False)
    assert (await service.get_page_row(db, home.page_uuid)).draft_revision == rev + 1
    await service.save_draft(mock_request, db, admin_user, home.page_uuid, empty_doc(), None)
    rev = (await service.get_page_row(db, home.page_uuid)).draft_revision
    await service.create_page(mock_request, db, admin_user, org.id, slug="jobs", add_to_nav=True)
    assert (await service.get_page_row(db, home.page_uuid)).draft_revision == rev


async def test_saved_sections_crud_isolation_and_rights(db, org, other_org, config, mock_request, admin_user, regular_user, monkeypatch):
    section = {"id": "s1", "type": "section", "name": "Hero band", "props": {}, "children": [
        {"id": "sym1", "type": "symbol", "props": {"symbolId": "badge"}},
    ]}
    symbols = {"badge": {"name": "Badge", "node": {"id": "b", "type": "text", "props": {"text": "New"}}}, "unused": {"name": "U", "node": {"id": "u", "type": "text", "props": {}}}}
    saved = await service.save_section(mock_request, db, admin_user, org.id, name="", node=section, symbols=symbols)
    assert saved["name"] == "Hero band" and set(saved["symbols"]) == {"badge"}
    listed = await service.list_saved_sections(mock_request, db, admin_user, org.id)
    assert [x["section_uuid"] for x in listed] == [saved["section_uuid"]]
    renamed = await service.rename_saved_section(mock_request, db, admin_user, org.id, saved["section_uuid"], "  Big hero ")
    assert renamed["name"] == "Big hero"
    assert (await service.rename_saved_section(mock_request, db, admin_user, org.id, saved["section_uuid"], "   "))["name"] == "Big hero"
    # Only whole, valid sections.
    with pytest.raises(HTTPException) as e:
        await service.save_section(mock_request, db, admin_user, org.id, name="x", node={"id": "t", "type": "symbol", "props": {"symbolId": "badge"}}, symbols=symbols)
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        await service.save_section(mock_request, db, admin_user, org.id, name="x", node="nope")
    assert e.value.status_code == 422
    # Another org cannot see or touch them.
    with pytest.raises(HTTPException) as e:
        await service.rename_saved_section(mock_request, db, admin_user, other_org.id, saved["section_uuid"], "x")
    assert e.value.status_code in (403, 404)
    with pytest.raises(HTTPException) as e:
        await service.list_saved_sections(mock_request, db, regular_user, org.id)
    assert e.value.status_code == 403
    monkeypatch.setattr(service, "MAX_SAVED_SECTIONS", 1)
    with pytest.raises(HTTPException) as e:
        await service.save_section(mock_request, db, admin_user, org.id, name="x", node=section)
    assert e.value.status_code == 403
    await service.delete_saved_section(mock_request, db, admin_user, org.id, saved["section_uuid"])
    assert (await db.execute(select(LandingSavedSection))).scalars().first() is None
    with pytest.raises(HTTPException) as e:
        await service.delete_saved_section(mock_request, db, admin_user, org.id, saved["section_uuid"])
    assert e.value.status_code == 404


# ─── routes ───────────────────────────────────────────────────────────────────


async def test_v2_routes(db, org, config, mock_request, admin_user):
    lib = await router.api_templates(include_legacy=False, current_user=admin_user)
    assert lib["categories"] and len([t for t in lib["templates"] if t.get("featured")]) == 16
    sections = await router.api_template_sections("membership", current_user=admin_user)
    assert sections["sections"] and sections["theme"]["colors"]["background"] == "#120a20"
    with pytest.raises(HTTPException):
        await router.api_template_sections("nope", current_user=admin_user)
    prev = await router.api_template_preview(mock_request, "kids", org.id, "org", db, admin_user)
    assert prev["doc"]["theme"]["colors"]["primary"] == "#ff6f61"  # no brand color set: template's stays
    site = await router.api_site(mock_request, org.id, db, admin_user)
    uuid = site["pages"][0]["page_uuid"]
    applied = await router.api_apply_template(mock_request, uuid, router.TemplateBody(template="health", palette="template", keep_chrome=False), db, admin_user)
    assert applied["draft"]["theme"]["fonts"]["heading"] == "Plus Jakarta Sans"
    page = await router.api_create_page(mock_request, org.id, router.CreatePageBody(slug="partners", template="partner", add_to_nav=True), db, admin_user)
    assert page["draft"]["root"]
    saved = await router.api_save_section(mock_request, org.id, router.SavedSectionBody(name="CTA", node=applied["draft"]["root"][-1]), db, admin_user)
    assert (await router.api_saved_sections(mock_request, org.id, db, admin_user))[0]["name"] == "CTA"
    assert (await router.api_rename_section(mock_request, org.id, saved["section_uuid"], router.RenameBody(name="Closing CTA"), db, admin_user))["name"] == "Closing CTA"
    assert (await router.api_delete_section(mock_request, org.id, saved["section_uuid"], db, admin_user))["detail"] == "Deleted"


# ─── tools ────────────────────────────────────────────────────────────────────


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(tools.SPECS)
    return r


def _ctx(db, org, user, *, approved=False):
    return ToolContext(request=make_synthetic_request(), db_session=db, user=user, org=org, org_slug=org.slug, mode="execute",
                       scope_key="test", surface="agent", approved=approved)


def ok(out):
    assert out.status == "executed", (out.denied_code, out.reason)
    return out.result


async def test_tools_list_and_apply_templates(db, org, config, admin_user, registry):
    ctx = _ctx(db, org, admin_user)
    listed = ok(await run_tool(registry, "list_landing_templates", {"category": "bootcamp"}, ctx))
    assert [t["id"] for t in listed["templates"]] == ["bootcamp"]
    assert [t["id"] for t in ok(await run_tool(registry, "list_landing_templates", {"scheme": "dark"}, ctx))["templates"]] == ["bootcamp", "membership"]
    assert len(ok(await run_tool(registry, "list_landing_templates", {}, ctx))["templates"]) == 16
    out = ok(await run_tool(registry, "apply_landing_template", {"template": "atelier", "palette": "org"}, ctx))
    assert "atelier" in out["summary"] and out["outline"]
    home = await service.ensure_home(db, org, admin_user)
    assert home.review and home.draft["theme"]["fonts"]["heading"] == "Syne"
    bad = await run_tool(registry, "apply_landing_template", {"template": "nope"}, ctx)
    assert bad.status != "executed"
    sections = ok(await run_tool(registry, "list_landing_template_sections", {"template": "coach"}, ctx))
    assert sections["sections"][0] == {"index": 0, "name": "Hero"}
    assert (await run_tool(registry, "list_landing_template_sections", {"template": "nope"}, ctx)).status != "executed"
    before = len(home.draft["root"])
    ok(await run_tool(registry, "add_landing_template_section", {"template": "coach", "index": 1, "position": 1}, ctx))
    ok(await run_tool(registry, "add_landing_template_section", {"template": "coach", "index": 0}, ctx))
    home = await service.ensure_home(db, org, admin_user)
    assert len(home.draft["root"]) == before + 2 and home.draft["root"][1]["name"] == "Featured programme"
    assert (await run_tool(registry, "add_landing_template_section", {"template": "coach", "index": 99}, ctx)).status != "executed"


async def test_theme_tools_need_approval(db, org, config, admin_user, registry):
    ctx = _ctx(db, org, admin_user)
    theme = ok(await run_tool(registry, "get_org_theme", {}, ctx))
    assert "noir" in theme["presets"] and "warm" in theme["options"]["neutral"] and theme["theme"]["color"] == ""
    pending = await run_tool(registry, "update_org_theme", {"preset": "noir"}, ctx)
    assert pending.status != "executed"
    done = ok(await run_tool(registry, "update_org_theme", {"preset": "noir", "theme": {"neutral": "warm"}}, _ctx(db, org, admin_user, approved=True)))
    assert done["theme"]["header_layout"] == "minimal" and done["theme"]["neutral"] == "warm" and done["color"] == "#0a0a0a"
    again = ok(await run_tool(registry, "update_org_theme", {"color": "#112233", "font": "Inter", "theme": {"radius": "round"}}, _ctx(db, org, admin_user, approved=True)))
    assert again["theme"]["radius"] == "round" and again["theme"]["preset"] == "custom" and again["theme"]["header_layout"] == "minimal"
    assert (await run_tool(registry, "update_org_theme", {"preset": "nope"}, _ctx(db, org, admin_user, approved=True))).status != "executed"
    assert (await run_tool(registry, "update_org_theme", {"theme": {"radius": "wobbly"}}, _ctx(db, org, admin_user, approved=True))).status != "executed"
