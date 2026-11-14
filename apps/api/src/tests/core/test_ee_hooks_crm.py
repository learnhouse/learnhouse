"""Core → EE hooks for CRM integrations: webhook events, profile edits and
account deletions reach EE when it is there, and never break the caller."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from src.core import ee_hooks


def _boom(*_a, **_kw):
    raise RuntimeError("down")


def test_notify_ee_event_forwards_and_never_raises():
    calls = []
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(on_event=lambda *a: calls.append(a))):
        ee_hooks.notify_ee_event("course_completed", 1, {"x": 1})
    assert calls == [("course_completed", 1, {"x": 1})]
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(on_event=_boom)):
        ee_hooks.notify_ee_event("course_completed", 1, {})
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
        ee_hooks.notify_ee_event("course_completed", 1, {})


def test_notify_ee_user_changed_forwards_and_never_raises():
    calls = []
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(on_user_changed=calls.append)):
        ee_hooks.notify_ee_user_changed(7)
    assert calls == [7]
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(on_user_changed=_boom)):
        ee_hooks.notify_ee_user_changed(7)
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
        ee_hooks.notify_ee_user_changed(7)


async def test_notify_ee_user_deleting_awaits_and_never_raises():
    hook = AsyncMock()
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(on_user_deleting=hook)):
        await ee_hooks.notify_ee_user_deleting(7, "db")
    hook.assert_awaited_once_with(7, "db")
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(on_user_deleting=AsyncMock(side_effect=RuntimeError("x")))):
        await ee_hooks.notify_ee_user_deleting(7, "db")
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
        await ee_hooks.notify_ee_user_deleting(7, "db")


async def test_dispatch_hands_events_to_ee_but_not_test_pings():
    from src.services.webhooks import dispatch

    with patch("src.core.ee_hooks.notify_ee_event") as notify, \
         patch.object(dispatch, "_active_cache_get", return_value=False):
        await dispatch.dispatch_webhooks("course_completed", 1, {
            "user": {"user_uuid": "u", "email": "e", "username": "n"}, "course": {"course_uuid": "c", "name": "C"},
        })
        notify.assert_called_once()
        notify.reset_mock()
        with patch.object(dispatch, "_deliver_webhooks", new=AsyncMock()):
            await dispatch.dispatch_webhooks("ping", 1, {"message": "hi"}, webhook_ids=[3])
        notify.assert_not_called()


def test_crm_plan_features_and_token_scope():
    from src.security.features_utils.plans import FEATURE_PLAN_REQUIREMENTS, get_plan_feature_config, get_upgrade_plan
    from src.services.api_tokens.api_tokens import _TOKEN_BUCKET_CAPS
    from src.services.api_tokens.openapi_spec import build_api_token_openapi_spec

    assert FEATURE_PLAN_REQUIREMENTS["crm"] == "pro" and FEATURE_PLAN_REQUIREMENTS["crm_salesforce"] == "enterprise"
    assert not get_plan_feature_config("standard", "crm")["enabled"] and get_plan_feature_config("pro", "crm")["enabled"]
    assert not get_plan_feature_config("pro", "crm_salesforce")["enabled"]
    assert get_upgrade_plan("standard", "crm") == "pro" and get_upgrade_plan("pro", "crm_salesforce") == "enterprise"
    assert _TOKEN_BUCKET_CAPS["crm"] == "organizations"
    spec = build_api_token_openapi_spec({"paths": {
        "/api/v1/crm/org/{org_id}/integrations": {"get": {"tags": ["crm"]}},
        "/api/v1/crm/org/{org_id}/{provider}/sync": {"post": {"tags": ["crm"]}},
        "/api/v1/crm/org/{org_id}/{provider}/connect": {"post": {"tags": ["crm-admin"]}},
    }, "tags": []})
    assert set(spec["paths"]) == {"/api/v1/crm/org/{org_id}/integrations", "/api/v1/crm/org/{org_id}/{provider}/sync"}
    assert spec["paths"]["/api/v1/crm/org/{org_id}/integrations"]["get"]["x-learnhouse-scope"] == "crm.read"
    assert spec["paths"]["/api/v1/crm/org/{org_id}/{provider}/sync"]["post"]["x-learnhouse-scope"] == "crm.update"
    assert any(t["name"] == "crm" for t in spec["tags"])


def test_notify_ee_email_verified_forwards_and_never_raises():
    calls = []
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(on_email_verified=calls.append)):
        ee_hooks.notify_ee_email_verified(7)
    assert calls == [7]
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=SimpleNamespace(on_email_verified=_boom)):
        ee_hooks.notify_ee_email_verified(7)
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
        ee_hooks.notify_ee_email_verified(7)
