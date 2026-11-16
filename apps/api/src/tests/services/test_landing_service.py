"""Landing page builder: pages, drafts (revision checks), publishing, history,
classic landing configs (fallback, import), public reads, contact forms, plan
gates, the landing tools (Atlas / MCP / API tokens), the HTTP routes and the
AI endpoints (src/services/landing, src/routers/landing.py)."""

import contextlib
import copy
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.landing_pages import LandingFormSubmission, LandingPage, LandingPageVersion
from src.db.organization_config import OrganizationConfig
from src.db.users import APITokenUser
from src.routers import landing as router
from src.services.ai.tools import ToolRegistry, run_tool
from src.services.ai.tools.base import ToolContext, make_synthetic_request
from src.services.landing import ai as landing_ai
from src.services.landing import recipes, service, tools
from src.services.landing.schema import empty_doc

NOW = str(datetime.now())
LEGACY = {
    "enabled": True,
    "sections": [
        {"type": "hero", "title": "Hero", "background": {"type": "solid", "color": "#000000"}, "heading": {"text": "Old hero", "color": "#ffffff"},
         "subheading": {"text": "Sub", "color": "#eeeeee"}, "buttons": []},
        {"type": "faq", "title": "FAQ", "items": [{"question": "Q", "answer": "A"}]},
    ],
}


def _page_doc(text="Hello"):
    doc = empty_doc()
    doc["root"] = [{"id": "s1", "type": "section", "props": {}, "children": [{"id": "t1", "type": "heading", "props": {"text": text, "level": 1}}]}]
    return doc


def _form_doc():
    doc = empty_doc()
    doc["root"] = [{"id": "s1", "type": "section", "props": {}, "children": [{"id": "contact", "type": "form", "props": {"fields": [
        {"key": "name", "label": "Name", "type": "text", "required": True},
        {"key": "email", "label": "Email", "type": "email", "required": True},
        {"key": "topic", "label": "Topic", "type": "select", "options": ["a", "b"]},
        {"key": "ok", "label": "OK", "type": "checkbox"},
        {"key": "msg", "label": "Message", "type": "textarea"},
    ]}}]}]
    doc["symbols"] = {"sym": {"name": "S", "node": {"id": "symform", "type": "form", "props": {"fields": []}}}}
    doc["root"][0]["children"].append({"id": "news", "type": "newsletter", "props": {}})
    return doc


@pytest.fixture
async def config(db, org):
    cfg = OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "plan": "standard", "customization": {"landing": copy.deepcopy(LEGACY)}}, creation_date=NOW, update_date=NOW)
    db.add(cfg)
    await db.commit()
    await db.refresh(cfg)
    return cfg


@pytest.fixture
def saas_plans(monkeypatch):
    """Plan checks as on SaaS (the suite runs in OSS mode, where most pass)."""
    order = ["free", "personal", "personal-family", "standard", "pro", "enterprise"]

    def meets(current, required):
        return order.index(current if current in order else "free") >= order.index(required)

    monkeypatch.setattr(service, "plan_meets_requirement", meets)


async def _set_plan(db, cfg, plan):
    cfg.config = {**cfg.config, "plan": plan}
    db.add(cfg)
    await db.commit()


# ─── service ──────────────────────────────────────────────────────────────────


async def test_site_overview_creates_the_home_page(db, org, config, mock_request, admin_user, regular_user):
    site = await service.site_overview(mock_request, db, admin_user, org.id)
    assert set(site) == {"pages", "caps"}
    # A new home starts from the classic landing, converted.
    home = await service.get_page_row(db, site["pages"][0]["page_uuid"])
    assert len(home.draft["root"]) == 2
    assert len(site["pages"]) == 1 and site["pages"][0]["is_home"] and not site["pages"][0]["published"]
    again = await service.site_overview(mock_request, db, admin_user, org.id)
    assert again["pages"][0]["page_uuid"] == site["pages"][0]["page_uuid"]
    with pytest.raises(HTTPException) as e:
        await service.site_overview(mock_request, db, regular_user, org.id)
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        await service.get_org(db, 999)
    assert e.value.status_code == 404


async def test_v1_config_and_missing_config(db, org, mock_request, admin_user):
    assert service._plan_of({"cloud": {"plan": "pro"}}) == "pro"
    assert service._legacy_landing({"landing": {"enabled": True}}) == {"enabled": True}
    assert service._legacy_landing({"landing": "x"}) == {}
    assert (await service.plan_caps(db, org.id))["plan"] == "free"
    site = await service.site_overview(mock_request, db, admin_user, org.id)
    # No config at all: the default template (compact hero + course catalog).
    home = await service.get_page_row(db, site["pages"][0]["page_uuid"])
    assert [n["name"] for n in home.draft["root"]] == ["Hero", "Courses"]


def test_legacy_doc_only_for_an_enabled_classic_landing(monkeypatch):
    assert service.legacy_doc({}) is None
    assert service.legacy_doc({**LEGACY, "enabled": False}) is None
    assert service.legacy_doc({"enabled": True, "sections": ["x"]}) is None
    assert len(service.legacy_doc(LEGACY)["root"]) == 2
    monkeypatch.setattr(service, "convert_landing", MagicMock(side_effect=ValueError("odd")))
    assert service.legacy_doc(LEGACY) is None


async def test_draft_save_validation_conflicts_and_checkpoints(db, org, config, mock_request, admin_user):
    site = await service.site_overview(mock_request, db, admin_user, org.id)
    uuid = site["pages"][0]["page_uuid"]
    res = await service.save_draft(mock_request, db, admin_user, uuid, _page_doc(), 1)
    assert res["draft_revision"] == 2
    # Same document again: nothing to do, no new revision.
    assert (await service.save_draft(mock_request, db, admin_user, uuid, _page_doc(), 2))["draft_revision"] == 2
    # A stale tab is refused instead of overwriting.
    with pytest.raises(HTTPException) as e:
        await service.save_draft(mock_request, db, admin_user, uuid, _page_doc("Other tab"), 1)
    assert e.value.status_code == 409 and e.value.detail["code"] == "draft_conflict"
    # Invalid documents list their problems.
    with pytest.raises(HTTPException) as e:
        await service.save_draft(mock_request, db, admin_user, uuid, {"root": [{"id": "x", "type": "marquee"}]}, 2)
    assert e.value.status_code == 422 and e.value.detail["errors"]
    # The first save after content exists makes an autosave checkpoint of the previous draft.
    await service.save_draft(mock_request, db, admin_user, uuid, _page_doc("Second"), None)
    versions = await service.list_versions(mock_request, db, admin_user, uuid)
    assert [v["kind"] for v in versions] == ["checkpoint"]
    # A recent checkpoint is not repeated; an old one is.
    await service.save_draft(mock_request, db, admin_user, uuid, _page_doc("Third"), None)
    assert len(await service.list_versions(mock_request, db, admin_user, uuid)) == 1
    v = (await db.execute(select(LandingPageVersion))).scalars().first()
    v.creation_date = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    db.add(v)
    await db.commit()
    await service.save_draft(mock_request, db, admin_user, uuid, _page_doc("Fourth"), None)
    assert len(await service.list_versions(mock_request, db, admin_user, uuid)) == 2
    v.creation_date = "garbage"
    db.add(v)
    await db.commit()
    page = await service.get_page_row(db, uuid)
    last = await service._last_version(db, page)
    last.creation_date = "garbage"
    db.add(last)
    await db.commit()
    await service.save_draft(mock_request, db, admin_user, uuid, _page_doc("Fifth"), None)
    assert len(await service.list_versions(mock_request, db, admin_user, uuid)) == 3
    detail = await service.get_page(mock_request, db, admin_user, uuid)
    assert detail["draft"]["root"][0]["children"][0]["props"]["text"] == "Fifth" and detail["preview_token"]


async def test_versions_are_pruned(db, org, config, mock_request, admin_user, monkeypatch):
    monkeypatch.setattr(service, "MAX_VERSIONS", 3)
    page = await service.ensure_home(db, org, admin_user)
    for i in range(5):
        await service._add_version(db, page, "variant", _page_doc(str(i)), admin_user.id, label=f"v{i}")
    await db.commit()
    labels = [v["label"] for v in await service.list_versions(mock_request, db, admin_user, page.page_uuid)]
    assert labels == ["v4", "v3", "v2"]


async def test_publish_restore_variant_template_preview(db, org, config, mock_request, admin_user):
    page = await service.ensure_home(db, org, admin_user)
    await service.save_draft(mock_request, db, admin_user, page.page_uuid, _page_doc("Live"), None)
    with pytest.raises(HTTPException) as e:
        await service.publish(mock_request, db, admin_user, page.page_uuid, base_revision=1)
    assert e.value.status_code == 409
    detail = await service.publish(mock_request, db, admin_user, page.page_uuid, label="")
    assert detail["published"] and detail["published_version"] == 1 and not detail["has_unpublished_changes"]
    versions = await service.list_versions(mock_request, db, admin_user, page.page_uuid)
    assert versions[0]["kind"] == "publish" and versions[0]["label"] == "Version 1" and versions[0]["number"] == 1
    full = await service.get_version(mock_request, db, admin_user, versions[0]["version_uuid"])
    assert full["doc"]["root"][0]["children"][0]["props"]["text"] == "Live"
    # Variants keep the draft as it is.
    variant = await service.save_variant(mock_request, db, admin_user, page.page_uuid, label="", doc=_page_doc("Variant"))
    assert variant["kind"] == "variant" and variant["label"] == "Variant"
    # Template replaces the draft and keeps the previous one.
    tpl = await service.apply_template(mock_request, db, admin_user, page.page_uuid, "minimal")
    assert len(tpl["draft"]["root"]) == 3
    with pytest.raises(HTTPException) as e:
        await service.apply_template(mock_request, db, admin_user, page.page_uuid, "nope")
    assert e.value.status_code == 404
    # Restoring the variant puts it in the draft.
    restored = await service.restore_version(mock_request, db, admin_user, variant["version_uuid"])
    assert restored["draft"]["root"][0]["children"][0]["props"]["text"] == "Variant"
    kinds = [v["kind"] for v in await service.list_versions(mock_request, db, admin_user, page.page_uuid)]
    assert "restore" in kinds and "template" in kinds
    with pytest.raises(HTTPException):
        await service.get_version(mock_request, db, admin_user, "landingversion_missing")
    old = page.preview_token
    new = await service.rotate_preview(mock_request, db, admin_user, page.page_uuid)
    assert new["preview_token"] != old
    # The home page is always live: it cannot be unpublished.
    with pytest.raises(HTTPException) as e:
        await service.unpublish(mock_request, db, admin_user, page.page_uuid)
    assert e.value.status_code == 400


async def test_classic_config_put_is_converted_and_published(db, org, config, mock_request, admin_user):
    from src.services.orgs.orgs import update_org_landing

    page = await service.ensure_home(db, org, admin_user)
    await service.save_draft(mock_request, db, admin_user, page.page_uuid, _page_doc("Mine"), None)
    out = await update_org_landing(mock_request, LEGACY, org.id, admin_user, db)
    assert out["detail"] == "Landing object updated"
    detail = out["page"]
    assert detail["published"] and detail["published_version"] == 1 and len(detail["published_doc"]["root"]) == 2
    assert detail["draft"] == detail["published_doc"]
    versions = await service.list_versions(mock_request, db, admin_user, page.page_uuid)
    assert [(v["kind"], v["label"]) for v in versions[:2]] == [("convert", "Imported classic landing"), ("checkpoint", "Before classic import")]
    # The config itself is not written any more.
    await db.refresh(config)
    assert config.config["customization"]["landing"] == LEGACY
    # Off, empty or not an object: the default home page.
    for body in ({"enabled": False, "sections": LEGACY["sections"]}, {"hero": "x"}, ["x"]):
        detail = await service.import_legacy(mock_request, db, admin_user, org.id, body)
        assert [n["name"] for n in detail["published_doc"]["root"]] == ["Hero", "Courses"]
    # Same document again, nothing pending: no checkpoint.
    n = len(await service.list_versions(mock_request, db, admin_user, page.page_uuid))
    await service.import_legacy(mock_request, db, admin_user, org.id, {})
    assert len(await service.list_versions(mock_request, db, admin_user, page.page_uuid)) == n + 1


async def test_public_home_falls_back_until_published(db, org, config, mock_request, admin_user):
    # No home row yet: the classic landing, converted on the fly.
    fb = await service.public_page(db, org.slug, "")
    assert fb["mode"] == "fallback" and fb["page_uuid"] is None and fb["version"] == 0 and len(fb["doc"]["root"]) == 2
    page = await service.ensure_home(db, org, admin_user)
    fb = await service.public_page(db, org.slug, "")
    assert fb["mode"] == "fallback" and fb["page_uuid"] == page.page_uuid
    config.config = {**config.config, "customization": {"landing": {}}}
    db.add(config)
    await db.commit()
    fb = await service.public_page(db, org.slug, "")
    assert [n["name"] for n in fb["doc"]["root"]] == ["Hero", "Courses"]
    await service.publish(mock_request, db, admin_user, page.page_uuid)
    assert (await service.public_page(db, org.slug, ""))["mode"] == "published"


async def test_extra_pages_and_plan_gates(db, org, config, mock_request, admin_user, saas_plans):
    created = await service.create_page(mock_request, db, admin_user, org.id, slug="About-Us", title="", template="creator")
    assert created["slug"] == "about-us" and created["title"] == "About us" and created["draft"]["root"]
    for slug, code in (("", 400), ("bad slug", 400), ("dash", 400), ("about-us", 409)):
        with pytest.raises(HTTPException) as e:
            await service.create_page(mock_request, db, admin_user, org.id, slug=slug)
        assert e.value.status_code == code, slug
    with pytest.raises(HTTPException) as e:
        await service.create_page(mock_request, db, admin_user, org.id, slug="x", template="nope")
    assert e.value.status_code == 404
    meta = await service.update_page_meta(mock_request, db, admin_user, created["page_uuid"], title=" New ", slug="new-about")
    assert meta["title"] == "New" and meta["slug"] == "new-about"
    second = await service.create_page(mock_request, db, admin_user, org.id, slug="second")
    for slug, code in (("second", 409), ("api", 400), ("Bad Slug", 400)):
        with pytest.raises(HTTPException) as e:
            await service.update_page_meta(mock_request, db, admin_user, created["page_uuid"], slug=slug)
        assert e.value.status_code == code
    home = await service.ensure_home(db, org, admin_user)
    home_meta = await service.update_page_meta(mock_request, db, admin_user, home.page_uuid, slug="ignored")
    assert home_meta["slug"] == ""
    with pytest.raises(HTTPException) as e:
        await service.delete_page(mock_request, db, admin_user, home.page_uuid)
    assert e.value.status_code == 400
    assert (await service.delete_page(mock_request, db, admin_user, second["page_uuid"]))["detail"]
    # Custom code: Standard refuses it, Pro allows it.
    html_doc = _page_doc()
    html_doc["root"][0]["children"].append({"id": "code", "type": "html", "props": {"html": "<b>x</b>"}})
    with pytest.raises(HTTPException) as e:
        await service.save_draft(mock_request, db, admin_user, created["page_uuid"], html_doc, None)
    assert e.value.status_code == 422
    await _set_plan(db, config, "pro")
    assert (await service.plan_caps(db, org.id))["custom_code"]
    await service.save_draft(mock_request, db, admin_user, created["page_uuid"], html_doc, None)
    await service.publish(mock_request, db, admin_user, created["page_uuid"])
    public = await service.public_page(db, org.slug, "new-about")
    assert public["mode"] == "published"
    # A downgrade stops serving extra pages and blocks publishing custom code.
    await _set_plan(db, config, "free")
    with pytest.raises(HTTPException) as e:
        await service.public_page(db, org.slug, "new-about")
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        await service.publish(mock_request, db, admin_user, created["page_uuid"])
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        await service.create_page(mock_request, db, admin_user, org.id, slug="third")
    assert e.value.status_code == 403
    caps = await service.plan_caps(db, org.id)
    assert caps == {"plan": "free", "custom_code": False, "extra_pages": False, "max_extra_pages": 0, "custom_code_plan": "pro", "extra_pages_plan": "standard"}
    # An extra page without custom code still cannot be published on Free.
    await service.save_draft(mock_request, db, admin_user, created["page_uuid"], _page_doc(), None)
    with pytest.raises(HTTPException) as e:
        await service.publish(mock_request, db, admin_user, created["page_uuid"])
    assert e.value.status_code == 403


async def test_extra_page_limit(db, org, config, mock_request, admin_user, monkeypatch):
    monkeypatch.setattr(service, "MAX_EXTRA_PAGES", 1)
    await service.create_page(mock_request, db, admin_user, org.id, slug="one")
    with pytest.raises(HTTPException) as e:
        await service.public_page(db, org.slug, "one")
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        await service.create_page(mock_request, db, admin_user, org.id, slug="two")
    assert e.value.status_code == 403


async def test_public_page_and_preview(db, org, config, mock_request, admin_user):
    with pytest.raises(HTTPException):
        await service.public_page(db, org.slug, "about")
    with pytest.raises(HTTPException):
        await service.public_page(db, "nope", "")
    with pytest.raises(HTTPException):
        await service.public_page(db, org.slug, "Bad Slug")
    page = await service.ensure_home(db, org, admin_user)
    await service.save_draft(mock_request, db, admin_user, page.page_uuid, _page_doc("Draft"), None)
    assert (await service.public_page(db, org.slug, ""))["mode"] == "fallback"
    preview = await service.public_page(db, org.slug, "home", preview=page.preview_token)
    assert preview["mode"] == "preview" and preview["doc"]["root"][0]["children"][0]["props"]["text"] == "Draft"
    with pytest.raises(HTTPException):
        await service.public_page(db, org.slug, "", preview="wrong")
    await service.publish(mock_request, db, admin_user, page.page_uuid)
    live = await service.public_page(db, org.slug, "")
    assert live["mode"] == "published" and live["version"] == 1


async def test_contact_forms(db, org, config, mock_request, admin_user, regular_user, monkeypatch):
    allow = MagicMock(return_value=(True, 1, 3600))
    monkeypatch.setattr("src.services.security.rate_limiting.check_rate_limit", allow)
    with pytest.raises(HTTPException):
        await service.submit_form(mock_request, db, "nope", "", "contact", {})
    with pytest.raises(HTTPException):
        await service.submit_form(mock_request, db, org.slug, "Bad Slug", "contact", {})
    page = await service.ensure_home(db, org, admin_user)
    with pytest.raises(HTTPException):
        await service.submit_form(mock_request, db, org.slug, "", "contact", {})
    await service.save_draft(mock_request, db, admin_user, page.page_uuid, _form_doc(), None)
    await service.publish(mock_request, db, admin_user, page.page_uuid)
    with pytest.raises(HTTPException) as e:
        await service.submit_form(mock_request, db, org.slug, "", "missing", {})
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        await service.submit_form(mock_request, db, org.slug, "", "contact", {"email": "not an email", "topic": "z", "name": None})
    assert e.value.status_code == 400 and "valid email" in e.value.detail and "pick one" in e.value.detail and "Name is required" in e.value.detail
    ok = await service.submit_form(mock_request, db, org.slug, "", "contact", {"name": "Ann", "email": "ann@x.io", "topic": "a", "ok": 1, "msg": 5, "extra": "ignored"})
    assert ok["detail"] == "Thanks!"
    assert (await service.submit_form(mock_request, db, org.slug, "", "symform", {}))["detail"] == "Thanks!"
    # A newsletter block without a newsletter keeps signups with the form messages.
    with pytest.raises(HTTPException):
        await service.submit_form(mock_request, db, org.slug, "", "news", {})
    await service.submit_form(mock_request, db, org.slug, "", "news", {"email": "sub@x.io"})
    # Honeypot: pretends to work, stores nothing.
    await service.submit_form(mock_request, db, org.slug, "", "contact", {"website": "spam"})
    rows = (await db.execute(select(LandingFormSubmission))).scalars().all()
    assert len(rows) == 3 and rows[0].data == {"name": "Ann", "email": "ann@x.io", "topic": "a", "ok": True, "msg": "5"}
    assert rows[2].data == {"email": "sub@x.io"} and rows[2].form_id == "news"
    listed = await service.list_submissions(mock_request, db, admin_user, org.id, page_uuid=page.page_uuid, limit=1)
    assert listed["total"] == 3 and len(listed["items"]) == 1
    with pytest.raises(HTTPException):
        await service.list_submissions(mock_request, db, regular_user, org.id)
    await service.delete_submission(mock_request, db, admin_user, org.id, listed["items"][0]["submission_uuid"])
    with pytest.raises(HTTPException):
        await service.delete_submission(mock_request, db, admin_user, org.id, "landingform_missing")
    # Rate limited, Redis down, and the per-org cap.
    monkeypatch.setattr("src.services.security.rate_limiting.check_rate_limit", MagicMock(return_value=(False, 9, 120)))
    with pytest.raises(HTTPException) as e:
        await service.submit_form(mock_request, db, org.slug, "", "symform", {})
    assert e.value.status_code == 429
    monkeypatch.setattr("src.services.security.rate_limiting.check_rate_limit", MagicMock(side_effect=ConnectionError))
    monkeypatch.setattr(service, "MAX_SUBMISSIONS_PER_ORG", 1)
    with pytest.raises(HTTPException) as e:
        await service.submit_form(mock_request, db, org.slug, "", "symform", {})
    assert e.value.status_code == 429


async def test_agent_review_keep_and_discard(db, org, config, mock_request, admin_user):
    page = await service.ensure_home(db, org, admin_user)
    await service.save_draft(mock_request, db, admin_user, page.page_uuid, _page_doc("Mine"), None)
    page = await service.get_page_row(db, page.page_uuid)
    page = await service.agent_write(db, page, _page_doc("Atlas 1"), admin_user, summary="first")
    page = await service.agent_write(db, page, _page_doc("Atlas 2"), admin_user, summary="second", by="api")
    # An agent edit that changes nothing is not recorded.
    page = await service.agent_write(db, page, _page_doc("Atlas 2"), admin_user, summary="no-op")
    stored = (await db.execute(select(LandingPage.review).where(LandingPage.id == page.id))).scalar()
    assert stored["by"] == "atlas" and [c["summary"] for c in stored["changes"]] == ["first", "second"]
    kept = await service.resolve_review(mock_request, db, admin_user, page.page_uuid, "keep")
    assert kept["review"] is None and kept["draft"]["root"][0]["children"][0]["props"]["text"] == "Atlas 2"
    page = await service.get_page_row(db, page.page_uuid)
    page = await service.agent_write(db, page, _page_doc("Atlas 3"), admin_user, summary="third")
    discarded = await service.resolve_review(mock_request, db, admin_user, page.page_uuid, "discard")
    assert discarded["draft"]["root"][0]["children"][0]["props"]["text"] == "Atlas 2" and discarded["review"] is None
    # A review whose base version is gone just clears.
    page = await service.get_page_row(db, page.page_uuid)
    page.review = {"base_version_uuid": "landingversion_gone"}
    db.add(page)
    await db.commit()
    assert (await service.resolve_review(mock_request, db, admin_user, page.page_uuid, "discard"))["review"] is None


async def test_user_id_and_context_helpers(db, org, course):
    assert service._user_id(object()) is None
    token = APITokenUser(id=0, user_uuid="apitoken_x", username="t", org_id=org.id, rights={}, token_name="t", created_by_user_id=7)
    assert service._user_id(token) == 7
    ctx = await service.org_context(db, org)
    assert ctx["org_name"] == "Test Org" and ctx["course_uuids"] == ["course_test"]
    assert service.uses_custom_code({"root": [{"id": "x", "type": "html", "props": {}}]})
    with pytest.raises(HTTPException):
        await service.get_page_row(db, "landingpage_missing")


# ─── tools ────────────────────────────────────────────────────────────────────


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(tools.SPECS)
    return r


def _ctx(db, org, user, *, approved=False, surface="agent"):
    return ToolContext(request=make_synthetic_request(), db_session=db, user=user, org=org, org_slug=org.slug, mode="execute",
                       scope_key="test", surface=surface, approved=approved)


def _first(doc, type_):
    stack = list(doc["root"])
    while stack:
        n = stack.pop(0)
        if n["type"] == type_:
            return n
        stack[:0] = n.get("children") or []
    raise AssertionError(type_)


def ok(out):
    assert out.status == "executed", (out.denied_code, out.reason)
    return out.result


async def test_tools_design_edit_and_publish(db, org, config, admin_user, registry, course):
    ctx = _ctx(db, org, admin_user)
    schema_out = ok(await run_tool(registry, "get_landing_schema", {}, ctx))
    assert "hero" in schema_out["section_kinds"] and schema_out["templates"]
    first = ok(await run_tool(registry, "get_landing_page", {}, ctx))
    assert first["page"]["is_home"] and len(first["outline"]) == 2 and "home_engine" not in first and "hint" not in first
    gen = ok(await run_tool(registry, "generate_landing_page", {"brief": "A page", "sections": [
        {"kind": "hero", "heading": "Welcome to Test Org", "subheading": "Learn"},
        {"kind": "courses", "heading": "Our courses"},
        {"kind": "faq", "items": [{"question": "Why?", "answer": "Because."}]},
    ], "preset": "warm"}, ctx))
    assert len(gen["outline"]) == 3 and gen["review"]
    page = await service.ensure_home(db, org, admin_user)
    assert page.review and page.draft["theme"]["fonts"]["heading"] == "Fraunces"
    outline = ok(await run_tool(registry, "get_landing_page", {"page": "home"}, ctx))["outline"]
    hero_id = outline[0]["id"]
    heading_id = _first(page.draft, "heading")["id"]
    assert ok(await run_tool(registry, "get_landing_page", {"node_id": heading_id}, ctx))["node"]["type"] == "heading"
    assert ok(await run_tool(registry, "get_landing_page", {"full": True}, ctx))["doc"]["root"]
    added = ok(await run_tool(registry, "add_landing_section", {"section": {"kind": "cta", "heading": "Join"}, "after_id": hero_id}, ctx))
    assert ok(await run_tool(registry, "get_landing_page", {}, ctx))["outline"][1]["id"] == added["node_id"]
    ok(await run_tool(registry, "add_landing_section", {"section": {"kind": "stats"}, "index": 0}, ctx))
    el = ok(await run_tool(registry, "add_landing_element", {"parent_id": hero_id, "element": {"type": "container", "props": {}, "children": [{"type": "text", "props": {"text": "Hi"}}]}}, ctx))
    ok(await run_tool(registry, "update_landing_element", {"node_id": heading_id, "props": {"text": "Bigger"}, "style": {"mobile": {"fontSize": 28}, "base": {"color": "$primary"}},
                                                             "name": "Title", "hidden": {"tablet": True}, "visibility": "logged_out", "animation": {"type": "fade"}, "anchor": "title"}, ctx))
    ok(await run_tool(registry, "update_landing_element", {"node_id": heading_id, "style": {"mobile": None, "base": None}, "anchor": ""}, ctx))
    ok(await run_tool(registry, "move_landing_element", {"node_id": el["node_id"], "parent_id": added["node_id"], "index": 0}, ctx))
    ok(await run_tool(registry, "move_landing_element", {"node_id": added["node_id"], "index": 0}, ctx))
    dup = ok(await run_tool(registry, "duplicate_landing_element", {"node_id": added["node_id"]}, ctx))
    ok(await run_tool(registry, "remove_landing_element", {"node_id": dup["node_id"]}, ctx))
    ok(await run_tool(registry, "restyle_landing_page", {"preset": "minimal", "theme": {"radius": "xl"}}, ctx))
    page = await service.get_page_row(db, page.page_uuid)
    assert page.draft["theme"]["radius"] == "xl" and page.draft["theme"]["fonts"]["heading"] == "Inter"
    faq_id = [n["id"] for n in page.draft["root"] if n.get("name") == "FAQ"][0]
    faq_el = _first(page.draft, "faq")["id"]
    ok(await run_tool(registry, "set_landing_copy", {"changes": [{"node_id": heading_id, "field": "text", "value": "Final"}, {"node_id": faq_el, "field": "items.0.question", "value": "How?"}]}, ctx))
    page = await service.get_page_row(db, page.page_uuid)
    assert _first(page.draft, "faq")["props"]["items"][0]["question"] == "How?"
    variant = ok(await run_tool(registry, "create_landing_variant", {"label": "B", "preset": "dark", "changes": [{"node_id": heading_id, "field": "text", "value": "Variant B"}]}, ctx))
    assert variant["version"]["name"] == "B"
    ok(await run_tool(registry, "create_landing_variant", {"label": "C"}, ctx))
    versions = ok(await run_tool(registry, "list_landing_versions", {}, ctx))
    assert versions["items"][0]["kind"] == "variant"
    ok(await run_tool(registry, "restore_landing_version", {"version_uuid": variant["version"]["uuid"]}, ctx))
    # Publishing needs approval; with it, the page goes live on the home.
    out = await run_tool(registry, "publish_landing_page", {}, ctx)
    assert out.status != "executed"
    published = ok(await run_tool(registry, "publish_landing_page", {}, _ctx(db, org, admin_user, approved=True)))
    assert published["url"] == "/" and "note" not in published
    again = ok(await run_tool(registry, "publish_landing_page", {}, _ctx(db, org, admin_user, approved=True, surface="mcp")))
    assert "Published version 2" in again["summary"]
    assert faq_id


async def test_tools_errors_pages_and_templates(db, org, config, admin_user, regular_user, registry):
    ctx = _ctx(db, org, admin_user, surface="mcp")
    denied = await run_tool(registry, "get_landing_page", {}, _ctx(db, org, regular_user))
    assert denied.status == "denied"
    bad = [
        ("generate_landing_page", {}, "invalid_args"),
        ("generate_landing_page", {"template": "nope"}, "http_404"),
        ("get_landing_page", {"page": "missing-page"}, "http_404"),
        ("get_landing_page", {"page": "landingpage_missing"}, "http_404"),
        ("get_landing_page", {"node_id": "zz"}, "http_404"),
        ("update_landing_element", {"node_id": "zz"}, "invalid_args"),
        ("restyle_landing_page", {}, "invalid_args"),
        ("restyle_landing_page", {"theme": {"radius": "huge"}}, "http_400"),
        ("add_landing_section", {"section": {"kind": "faq"}, "after_id": "zz"}, "http_404"),
        ("add_landing_element", {"parent_id": "zz", "element": {"type": "text"}}, "http_404"),
        ("restore_landing_version", {"version_uuid": "landingversion_missing"}, "http_404"),
    ]
    for name, args, code in bad:
        out = await run_tool(registry, name, args, ctx)
        assert out.denied_code == code, (name, out.denied_code, out.reason)
    ok(await run_tool(registry, "generate_landing_page", {"template": "school", "preset": "bold"}, ctx))
    page = await service.ensure_home(db, org, admin_user)
    assert page.review["by"] == "api"
    sec = page.draft["root"][0]["id"]
    inner = page.draft["root"][0]["children"][0]["id"]
    for name, args, code in [
        ("add_landing_element", {"parent_id": inner, "element": {"type": "marquee"}}, "http_400"),
        ("add_landing_element", {"parent_id": inner, "element": "nope"}, "invalid_args"),
        ("move_landing_element", {"node_id": sec, "parent_id": inner}, "http_400"),
        ("move_landing_element", {"node_id": inner, "parent_id": "zz"}, "http_404"),
        ("set_landing_copy", {"changes": [{"node_id": inner, "field": "items.9.title", "value": "x"}]}, "http_400"),
    ]:
        out = await run_tool(registry, name, args, ctx)
        assert out.denied_code == code, (name, out.denied_code, out.reason)
    assert tools._with_ids({"type": "text", "children": ["x", {"type": "text"}]})["children"][1]["id"]
    with pytest.raises(HTTPException):
        tools._with_ids("x")
    # Extra pages by slug, "p/" prefix and uuid.
    extra = await service.create_page(make_synthetic_request(), db, admin_user, org.id, slug="about")
    for ref in ("about", "/p/about", extra["page_uuid"]):
        assert ok(await run_tool(registry, "get_landing_page", {"page": ref}, ctx))["page"]["slug"] == "about"
    pub = ok(await run_tool(registry, "publish_landing_page", {"page": "about"}, _ctx(db, org, admin_user, approved=True)))
    assert pub["url"] == "/p/about"
    for gone in ("convert_legacy_landing", "set_landing_engine"):
        assert (await run_tool(registry, gone, {}, ctx)).status != "executed"


# ─── routes ───────────────────────────────────────────────────────────────────


async def test_routes_delegate_to_the_service(db, org, config, mock_request, admin_user, monkeypatch):
    assert "elements" in await router.api_schema()
    lib = await router.api_templates(current_user=admin_user)
    assert lib["templates"] and lib["sections"] and lib["presets"]
    site = await router.api_site(mock_request, org.id, db, admin_user)
    uuid = site["pages"][0]["page_uuid"]
    prev = await router.api_template_preview(mock_request, "creator", org.id, db_session=db, current_user=admin_user)
    assert prev["doc"]["root"]
    assert (await router.api_get_page(mock_request, uuid, db, admin_user))["page_uuid"] == uuid
    saved = await router.api_save_draft(mock_request, uuid, router.DraftBody(doc=_page_doc(), base_revision=None), db, admin_user)
    await router.api_publish(mock_request, uuid, router.PublishBody(label="L"), db, admin_user)
    await router.api_apply_template(mock_request, uuid, router.TemplateBody(template="minimal", base_revision=saved["draft_revision"]), db, admin_user)
    versions = await router.api_versions(mock_request, uuid, db, admin_user)
    await router.api_version(mock_request, versions[0]["version_uuid"], db, admin_user)
    await router.api_restore(mock_request, versions[0]["version_uuid"], db, admin_user)
    await router.api_variant(mock_request, uuid, router.VariantBody(label="V"), db, admin_user)
    await router.api_rotate_preview(mock_request, uuid, db, admin_user)
    await router.api_review(mock_request, uuid, router.ReviewBody(action="keep"), db, admin_user)
    assert not hasattr(router, "api_engine") and not hasattr(router, "api_convert")
    good = await router.api_validate(mock_request, org.id, router.ValidateBody(doc=_page_doc()), db, admin_user)
    bad = await router.api_validate(mock_request, org.id, router.ValidateBody(doc={"root": "x"}), db, admin_user)
    assert good["ok"] and not bad["ok"] and bad["errors"]
    extra = await router.api_create_page(mock_request, org.id, router.CreatePageBody(slug="about"), db, admin_user)
    await router.api_update_page(mock_request, extra["page_uuid"], router.PageMetaBody(title="About"), db, admin_user)
    assert not (await router.api_unpublish(mock_request, extra["page_uuid"], db, admin_user))["published"]
    await router.api_delete_page(mock_request, extra["page_uuid"], db, admin_user)
    # Public read and form.
    await router.api_publish(mock_request, uuid, router.PublishBody(), db, admin_user)
    assert (await router.api_public_page(org.slug, "", None, db))["mode"] == "published"
    with pytest.raises(HTTPException) as e:
        await router.api_submit_form(mock_request, org.slug, "x", router.FormBody(data={str(i): i for i in range(31)}), "", db)
    assert e.value.status_code == 400
    with pytest.raises(HTTPException):
        await router.api_submit_form(mock_request, org.slug, "x", router.FormBody(), "", db)
    listed = await router.api_submissions(mock_request, org.id, None, 100, 0, db, admin_user)
    assert listed["total"] == 0
    with pytest.raises(HTTPException):
        await router.api_delete_submission(mock_request, org.id, "landingform_x", db, admin_user)


@contextlib.asynccontextmanager
async def _fake_charge(*args, **kwargs):
    _fake_charge.calls.append(args[0])
    yield MagicMock(credits=1)


_fake_charge.calls = []


@pytest.fixture
def ai_env(monkeypatch):
    _fake_charge.calls.clear()
    monkeypatch.setattr(router.metering, "charge", _fake_charge)
    monkeypatch.setattr(router, "enforce_ai_rate_limit", MagicMock())
    monkeypatch.setattr("src.services.ai.llm.resolve_model_for_org", AsyncMock(return_value="test-model"))


async def test_ai_generate_and_copy_routes(db, org, config, mock_request, admin_user, course, ai_env, monkeypatch):
    site = await service.site_overview(mock_request, db, admin_user, org.id)
    uuid = site["pages"][0]["page_uuid"]
    await service.save_draft(mock_request, db, admin_user, uuid, _page_doc(), None)
    plan = landing_ai.PagePlan(preset="bold", sections=[recipes.SectionSpec(kind="hero", heading="AI hero"), recipes.SectionSpec(kind="courses")])
    monkeypatch.setattr(landing_ai, "plan_page", AsyncMock(return_value=plan))
    detail = await router.api_ai_generate(mock_request, org.id, router.GenerateBody(page_uuid=uuid, brief="A school"), db, admin_user)
    assert len(detail["draft"]["root"]) == 2 and _fake_charge.calls == ["landing_generation"]
    kinds = [v["kind"] for v in await service.list_versions(mock_request, db, admin_user, uuid)]
    assert "template" in kinds
    monkeypatch.setattr(landing_ai, "rewrite_copy", AsyncMock(return_value="Better"))
    out = await router.api_ai_copy(mock_request, org.id, router.CopyBody(text="ok"), db, admin_user)
    assert out == {"text": "Better"} and _fake_charge.calls[-1] == "landing_copy"


@pytest.mark.parametrize("error,code", [("notconfigured", 403), (RuntimeError("boom"), 502)])
async def test_ai_routes_errors(db, org, config, mock_request, admin_user, ai_env, monkeypatch, error, code):
    from src.services.ai.llm import AINotConfiguredError

    exc = AINotConfiguredError("AI is off") if error == "notconfigured" else error
    page = await service.ensure_home(db, org, admin_user)
    monkeypatch.setattr(landing_ai, "plan_page", AsyncMock(side_effect=exc))
    monkeypatch.setattr(landing_ai, "rewrite_copy", AsyncMock(side_effect=exc))
    with pytest.raises(HTTPException) as e:
        await router.api_ai_generate(mock_request, org.id, router.GenerateBody(page_uuid=page.page_uuid, brief="xyz"), db, admin_user)
    assert e.value.status_code == code
    with pytest.raises(HTTPException) as e:
        await router.api_ai_copy(mock_request, org.id, router.CopyBody(text="ok"), db, admin_user)
    assert e.value.status_code == code


async def test_ai_routes_pass_http_errors_and_bad_plans(db, org, config, mock_request, admin_user, ai_env, monkeypatch):
    page = await service.ensure_home(db, org, admin_user)
    monkeypatch.setattr(landing_ai, "plan_page", AsyncMock(side_effect=HTTPException(status_code=402, detail="credits")))
    monkeypatch.setattr(landing_ai, "rewrite_copy", AsyncMock(side_effect=HTTPException(status_code=402, detail="credits")))
    for call in (
        router.api_ai_generate(mock_request, org.id, router.GenerateBody(page_uuid=page.page_uuid, brief="xyz"), db, admin_user),
        router.api_ai_copy(mock_request, org.id, router.CopyBody(text="ok"), db, admin_user),
    ):
        with pytest.raises(HTTPException) as e:
            await call
        assert e.value.status_code == 402
    monkeypatch.setattr(landing_ai, "plan_page", AsyncMock(return_value=landing_ai.PagePlan(sections=[recipes.SectionSpec(kind="faq")])))
    monkeypatch.setattr(landing_ai, "plan_to_doc", MagicMock(side_effect=ValueError("bad")))
    with pytest.raises(HTTPException) as e:
        await router.api_ai_generate(mock_request, org.id, router.GenerateBody(page_uuid=page.page_uuid, brief="xyz"), db, admin_user)
    assert e.value.status_code == 502


async def test_ai_module_builds_prompts_and_calls_the_model(monkeypatch):
    plan = landing_ai.PagePlan(sections=[recipes.SectionSpec(kind="hero")])
    gen = AsyncMock(return_value=plan)
    monkeypatch.setattr(landing_ai, "generate", gen)
    ctx = {"org_name": "Acme", "org_description": "We teach"}
    out = await landing_ai.plan_page(brief="School", ctx=ctx, courses=[{"name": "Py", "uuid": "course_1"}], model_name=None)
    assert out is plan and "Public courses: Py (course_1)" in gen.call_args.kwargs["user_prompt"]
    assert "About: We teach" in landing_ai.page_prompt("x", ctx, [])
    assert landing_ai.page_prompt("x", {"org_name": "A"}, []) == "Brief: x\nOrganization: A"
    doc = landing_ai.plan_to_doc(plan, ctx)
    assert doc["root"][0]["type"] == "section"
    gen2 = AsyncMock(return_value=landing_ai.CopyRewrite(text="  New  "))
    monkeypatch.setattr(landing_ai, "generate", gen2)
    assert await landing_ai.rewrite_copy(text="Old", instruction="Shorter", context="Hero", model_name="m") == "New"
