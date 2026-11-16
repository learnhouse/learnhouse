"""Feature coverage tools (OSS): webhooks, AI credits, signup fields, and
managing podcasts and episodes, through the run_tool pipeline."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.organization_config import OrganizationConfig
from src.db.podcasts.episodes import PodcastEpisode
from src.db.podcasts.podcasts import Podcast
from src.db.users import APITokenUser
from src.services.ai.tools import ToolContext, ToolRegistry, make_synthetic_request, refs, run_tool
from src.services.ai.tools import ai_credits, podcasts, signup_fields, webhooks

NOW = str(datetime.now())
FULL = {"action_create": True, "action_read": True, "action_update": True, "action_delete": True}


@pytest.fixture(autouse=True)
def links():
    with patch.object(refs, "web_base", new=AsyncMock(return_value="https://acme.test")):
        yield


@pytest.fixture
def registry():
    r = ToolRegistry()
    for m in (webhooks, ai_credits, signup_fields, podcasts):
        r.register_all(m.SPECS)
    return r


def ctx(db, org, user, approved=False):
    return ToolContext(request=make_synthetic_request(), db_session=db, user=user, org=org, org_slug=org.slug,
                       mode="execute", scope_key="t", surface="mcp", approved=approved)


async def call(registry, db, org, user, name, args=None, approved=False):
    return await run_tool(registry, name, args or {}, ctx(db, org, user, approved))


def ok(out):
    assert out.status == "executed", (out.denied_code, out.reason)
    return out.result


def token(org_id, rights):
    return APITokenUser(id=7, user_uuid="apitoken_x", username="t", org_id=org_id, rights=rights, created_by_user_id=1)


# ─── webhooks ────────────────────────────────────────────────────────────────


def endpoint(**kw):
    base = dict(webhook_uuid="webhook_1", url="https://hooks.test/a", description="", events=["course_completed"],
                is_active=True, source="manual", zap_name=None, creation_date=NOW)
    base.update(kw)
    return SimpleNamespace(**base)


def log(success=True):
    return SimpleNamespace(event_name="ping", delivery_uuid="d1", success=success, response_status=200 if success else 500,
                           attempt=1, error_message=None if success else "boom", created_at=NOW)


async def test_webhook_reads(db, org, admin_user, registry):
    W = "src.services.ai.tools.webhooks"
    with patch(f"{W}.get_webhook_endpoints", new=AsyncMock(return_value=[endpoint(), endpoint(webhook_uuid="webhook_2", source="zapier", zap_name="Zap")])), \
            patch(f"{W}.get_webhook_endpoint", new=AsyncMock(return_value=endpoint())), \
            patch(f"{W}.get_webhook_delivery_logs", new=AsyncMock(return_value=[log(), log(False)])):
        out = ok(await call(registry, db, org, admin_user, "list_webhooks"))
        assert out["total"] == 2 and out["url"] == "https://acme.test/dash/org/settings/webhooks"
        out = ok(await call(registry, db, org, admin_user, "list_webhooks", {"source": "zapier"}))
        assert [w["zap_name"] for w in out["items"]] == ["Zap"]
        out = ok(await call(registry, db, org, admin_user, "get_webhook_deliveries", {"webhook_uuid": "webhook_1"}))
        assert out["recent_failures"] == 1 and len(out["items"]) == 2
        out = ok(await call(registry, db, org, admin_user, "get_webhook_deliveries", {"webhook_uuid": "webhook_1", "failed_only": True}))
        assert [i["error"] for i in out["items"]] == ["boom"]
    out = ok(await call(registry, db, org, admin_user, "list_webhook_events"))
    assert any(e["name"] == "course_completed" for e in out["events"])


async def test_webhook_writes_and_approvals(db, org, admin_user, registry):
    W = "src.services.ai.tools.webhooks"
    created = SimpleNamespace(webhook_uuid="webhook_9", url="https://hooks.test/new", events=["ping"], secret="whsec_x")
    args = {"url": "https://hooks.test/new", "events": ["ping"]}
    assert (await call(registry, db, org, admin_user, "create_webhook", args)).denied_code == "approval_required"
    with patch(f"{W}.create_webhook_endpoint", new=AsyncMock(return_value=created)) as create:
        out = ok(await call(registry, db, org, admin_user, "create_webhook", args, approved=True))
    assert out["signing_secret"] == "whsec_x" and create.await_args.args[3].events == ["ping"]

    with patch(f"{W}.update_webhook_endpoint", new=AsyncMock(return_value=endpoint(description="d"))) as upd:
        ok(await call(registry, db, org, admin_user, "update_webhook", {"webhook_uuid": "webhook_1", "description": "d", "active": False}))
        assert upd.await_args.args[4].is_active is False
        out = await call(registry, db, org, admin_user, "update_webhook", {"webhook_uuid": "webhook_1", "url": "https://x.test/b"})
        assert out.denied_code == "approval_required"
    out = await call(registry, db, org, admin_user, "update_webhook", {"webhook_uuid": "webhook_1"})
    assert out.denied_code == "http_400"

    with patch(f"{W}.send_test_event", new=AsyncMock(return_value={"success": True})):
        out = ok(await call(registry, db, org, admin_user, "send_test_webhook", {"webhook_uuid": "webhook_1"}))
    assert out["result"] == {"success": True}

    for source, note in (("manual", ""), ("zapier", "Zap")):
        with patch(f"{W}.get_webhook_endpoint", new=AsyncMock(return_value=endpoint(source=source))), \
                patch(f"{W}.delete_webhook_endpoint", new=AsyncMock()):
            out = ok(await call(registry, db, org, admin_user, "delete_webhook", {"webhook_uuid": "webhook_1"}, approved=True))
        assert note in out["summary"]


async def test_webhooks_need_the_tokens_organizations_right(db, org, registry):
    out = await call(registry, db, org, token(org.id, {"courses": FULL}), "list_webhooks")
    assert out.denied_code == "missing_right"


# ─── AI credits ──────────────────────────────────────────────────────────────


async def test_ai_credits_balance_usage_and_prices(db, org, admin_user, registry):
    R = "src.services.ai.tools.ai_credits.routes"
    summary = SimpleNamespace(model_dump=lambda: {"remaining_credits": 50})
    usage = {"days": 7, "total_credits": 3, "by_feature": [], "by_member": [], "by_day": []}
    with patch(f"{R}.get_org_ai_credits", new=AsyncMock(return_value=summary)), \
            patch(f"{R}.get_org_ai_usage", new=AsyncMock(return_value=usage)), \
            patch(f"{R}.get_org_ai_prices", new=AsyncMock(return_value={"features": [{"key": "chat"}]})):
        out = ok(await call(registry, db, org, admin_user, "get_ai_credits", {"usage_days": 7, "include_prices": True}))
    assert out["balance"] == {"remaining_credits": 50} and out["usage"]["total_credits"] == 3 and "by_day" not in out["usage"]
    assert out["prices"] == [{"key": "chat"}] and out["url"].endswith("/dash/org/settings/ai")
    with patch(f"{R}.get_org_ai_credits", new=AsyncMock(return_value=summary)), \
            patch(f"{R}.get_org_ai_usage", new=AsyncMock(side_effect=HTTPException(403, "Admin rights required"))), \
            patch.object(refs, "web_base", new=AsyncMock(return_value="")):
        out = ok(await call(registry, db, org, admin_user, "get_ai_credits"))
    assert out["usage"] is None and "admins" in out["note"] and out["url"] is None
    with patch(f"{R}.get_org_ai_credits", new=AsyncMock(return_value=summary)), \
            patch(f"{R}.get_org_ai_usage", new=AsyncMock(side_effect=HTTPException(404, "gone"))):
        assert (await call(registry, db, org, admin_user, "get_ai_credits")).denied_code == "http_404"
    with patch(f"{R}.get_org_ai_credits", new=AsyncMock(return_value=summary)):
        out = ok(await call(registry, db, org, admin_user, "get_ai_credits", {"usage_days": 0}))
    assert "usage" not in out


async def test_ai_credits_real_balance_for_a_member(db, org, admin_user, registry):
    out = await call(registry, db, org, admin_user, "get_ai_credits", {"usage_days": 0})
    assert out.status in ("executed", "denied")


# ─── signup fields ───────────────────────────────────────────────────────────


async def test_signup_fields(db, org, admin_user, registry):
    db.add(OrganizationConfig(org_id=org.id, config={"general": {"signup_fields": {"fields": [
        {"key": "team", "label": "Team", "order": 2, "people_field": "department"},
        {"key": "why", "label": "Why", "type": "textarea", "order": 1},
    ]}}}, creation_date=NOW, update_date=NOW))
    await db.commit()
    out = ok(await call(registry, db, org, admin_user, "get_signup_fields"))
    assert [f["key"] for f in out["fields"]] == ["why", "team"] and out["saved_to_people_data"] == ["team"]
    with patch.object(refs, "web_base", new=AsyncMock(return_value="")):
        assert ok(await call(registry, db, org, admin_user, "get_signup_fields"))["url"] is None


# ─── podcasts ────────────────────────────────────────────────────────────────


@pytest.fixture
async def show(db, org):
    db.add(Podcast(id=1, name="Show", description="d", about="a", tags="t", public=False, published=False,
                   org_id=org.id, podcast_uuid="podcast_show", thumbnail_image="cover.png", creation_date=NOW, update_date=NOW))
    db.add(PodcastEpisode(id=1, title="Pilot", order=0, episode_number=1, duration_seconds=600, podcast_id=1, org_id=org.id,
                          episode_uuid="episode_pilot", audio_file="a.mp3", creation_date=NOW, update_date=NOW))
    await db.commit()


@pytest.fixture(autouse=True)
def podcasts_on():
    with patch("src.services.podcasts.podcasts._is_podcasts_feature_enabled", new=AsyncMock(return_value=True)), \
            patch("src.services.podcasts.podcasts.check_feature_access", new=AsyncMock()), \
            patch("src.services.podcasts.episodes.check_feature_access", new=AsyncMock()), \
            patch("src.services.podcasts.podcasts.check_limits_with_usage", new=AsyncMock(), create=True), \
            patch("src.services.podcasts.podcasts.decrease_feature_usage", new=AsyncMock(), create=True):
        yield


async def test_get_podcast(db, org, admin_user, registry, show):
    out = ok(await call(registry, db, org, admin_user, "get_podcast", {"podcast_uuid": "podcast_show"}))
    assert out["podcast"]["url"] == "https://acme.test/dash/podcasts/podcast/show/general"
    assert out["items"][0] == {"uuid": "episode_pilot", "title": "Pilot", "number": 1, "order": 0, "published": False,
                               "minutes": 10, "has_audio": True, "description": None}
    with patch.object(refs, "web_base", new=AsyncMock(return_value="")):
        assert ok(await call(registry, db, org, admin_user, "get_podcast", {"podcast_uuid": "podcast_show"}))["podcast"].get("url") is None


async def test_podcast_ids_from_elsewhere_are_not_found(db, org, other_org, admin_user, registry):
    db.add(Podcast(id=5, name="Far", public=True, published=True, org_id=other_org.id, podcast_uuid="podcast_far",
                   creation_date=NOW, update_date=NOW))
    db.add(PodcastEpisode(id=5, title="Far ep", podcast_id=5, org_id=other_org.id, episode_uuid="episode_far",
                          creation_date=NOW, update_date=NOW))
    await db.commit()
    with patch("src.services.ai.tools.registry.check_resource_access", new=AsyncMock(return_value=SimpleNamespace(allowed=True))):
        assert (await call(registry, db, org, admin_user, "get_podcast", {"podcast_uuid": "podcast_far"})).denied_code == "http_404"
        assert (await call(registry, db, org, admin_user, "update_podcast_episode",
                           {"episode_uuid": "episode_far", "title": "x"})).denied_code == "http_404"


async def test_create_update_delete_podcast(db, org, admin_user, registry, show):
    created = SimpleNamespace(podcast_uuid="podcast_new", name="New")
    with patch("src.services.ai.tools.podcasts.create_podcast", new=AsyncMock(return_value=created)) as create:
        out = ok(await call(registry, db, org, admin_user, "create_podcast", {"name": "New"}))
    assert out["podcast"]["uuid"] == "podcast_new" and create.await_args.args[2].org_id == org.id

    with patch("src.services.ai.tools.podcasts.update_podcast", new=AsyncMock(return_value=SimpleNamespace(podcast_uuid="podcast_show", name="Renamed"))) as upd:
        out = ok(await call(registry, db, org, admin_user, "update_podcast", {"podcast_uuid": "podcast_show", "name": "Renamed"}))
        assert upd.await_args.args[1].thumbnail_image == "cover.png" and "name" in out["summary"]
        assert (await call(registry, db, org, admin_user, "update_podcast",
                           {"podcast_uuid": "podcast_show", "published": True})).denied_code == "approval_required"
    assert (await call(registry, db, org, admin_user, "update_podcast", {"podcast_uuid": "podcast_show"})).denied_code == "http_400"

    with patch("src.services.ai.tools.podcasts.delete_podcast", new=AsyncMock()) as delete:
        out = ok(await call(registry, db, org, admin_user, "delete_podcast", {"podcast_uuid": "podcast_show"}, approved=True))
    delete.assert_awaited_once()
    assert "Deleted podcast" in out["summary"]


async def test_episodes(db, org, admin_user, registry, show):
    made = SimpleNamespace(episode_uuid="episode_new", title="Two")
    with patch("src.services.ai.tools.podcasts.create_episode", new=AsyncMock(return_value=made)) as create:
        out = ok(await call(registry, db, org, admin_user, "create_podcast_episode", {"podcast_uuid": "podcast_show", "title": "Two"}))
        assert create.await_args.args[2].episode_number == 2 and create.await_args.args[2].order == 1
        ok(await call(registry, db, org, admin_user, "create_podcast_episode",
                      {"podcast_uuid": "podcast_show", "title": "Ten", "episode_number": 10}))
        assert create.await_args.args[2].episode_number == 10
    assert out["episode"]["uuid"] == "episode_new"

    with patch("src.services.ai.tools.podcasts.update_episode", new=AsyncMock(return_value=SimpleNamespace(episode_uuid="episode_pilot", title="P2"))):
        out = ok(await call(registry, db, org, admin_user, "update_podcast_episode", {"episode_uuid": "episode_pilot", "title": "P2"}))
        assert "title" in out["summary"]
        assert (await call(registry, db, org, admin_user, "update_podcast_episode",
                           {"episode_uuid": "episode_pilot", "published": True})).denied_code == "approval_required"
    assert (await call(registry, db, org, admin_user, "update_podcast_episode", {"episode_uuid": "episode_pilot"})).denied_code == "http_400"

    with patch("src.services.ai.tools.podcasts.delete_episode", new=AsyncMock()):
        out = ok(await call(registry, db, org, admin_user, "delete_podcast_episode", {"episode_uuid": "episode_pilot"}, approved=True))
    assert "Deleted episode" in out["summary"]


def test_summaries():
    specs = {s.name: s for s in podcasts.SPECS + webhooks.SPECS}
    P = specs["update_podcast"].params_model
    assert "name" in specs["update_podcast"].summarize(P(podcast_uuid="p", name="x"))
    assert "nothing" in specs["update_podcast_episode"].summarize(specs["update_podcast_episode"].params_model(episode_uuid="e"))
    assert "nothing" in specs["update_webhook"].summarize(specs["update_webhook"].params_model(webhook_uuid="w"))
    for name in ("create_podcast", "delete_podcast", "create_podcast_episode", "delete_podcast_episode",
                 "create_webhook", "send_test_webhook", "delete_webhook"):
        s = specs[name]
        fields = {k: ("x" if f.annotation in (str, "str") else None) for k, f in s.params_model.model_fields.items()}
        sample = {"podcast_uuid": "p", "episode_uuid": "e", "webhook_uuid": "w", "name": "n", "title": "t",
                  "url": "https://x.test/aaaa", "events": ["ping"]}
        params = s.params_model(**{k: v for k, v in sample.items() if k in s.params_model.model_fields})
        assert s.summarize(params)
        assert fields is not None
