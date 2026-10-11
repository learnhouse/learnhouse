"""Editor-AI content cap, org-scoped member view, Zapier webhook cache
invalidation, and the demo org's per-visitor AI cap."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src.security.features_utils import usage
from src.services.security import rate_limiting


# --- Editor AI current_content cap ------------------------------------------


def test_editor_ai_content_within_cap_accepted():
    from src.services.ai.schemas.editor import StartEditorAIChatSession

    body = StartEditorAIChatSession(
        activity_uuid="a", message="m", current_content={"type": "doc", "content": []}
    )
    assert body.current_content["type"] == "doc"


@pytest.mark.parametrize("schema", ["StartEditorAIChatSession", "SendEditorAIChatMessage"])
def test_editor_ai_content_over_cap_rejected(schema):
    from src.services.ai.schemas import editor
    from src.services.ai.schemas.limits import AI_EDITOR_CONTENT_MAX_CHARS

    cls = getattr(editor, schema)
    huge = {"type": "text", "text": "x" * AI_EDITOR_CONTENT_MAX_CHARS}
    with pytest.raises(ValidationError):
        cls(aichat_uuid="c", activity_uuid="a", message="m", current_content=huge)


def test_editor_ai_content_none_allowed():
    from src.services.ai.schemas.editor import StartEditorAIChatSession

    assert StartEditorAIChatSession(
        activity_uuid="a", message="m", current_content=None
    ).current_content is None


# --- Org member view ----------------------------------------------------------


def test_organization_user_is_typed_as_org_member_view():
    from src.db.organizations import OrganizationUser
    from src.db.roles import RoleRead
    from src.db.users import OrgMemberUserRead

    assert OrganizationUser.model_fields["user"].annotation is OrgMemberUserRead
    role = RoleRead.model_construct(id=1, name="r")
    member = OrgMemberUserRead(
        id=1, user_uuid="u", username="n", first_name="f", last_name="l", email="e@x.io"
    )
    ou = OrganizationUser.model_construct(user=member, role=role)
    dumped = OrganizationUser.model_validate(
        {"user": {**member.model_dump(), "is_superadmin": True}, "role": role}
    ).model_dump()
    assert "is_superadmin" not in dumped["user"]
    assert ou.user.email == "e@x.io"


# --- Zapier webhook cache invalidation ----------------------------------------


def _zapier_session(endpoint=None):
    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.delete = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.first.return_value = endpoint
    session.execute = AsyncMock(return_value=result)
    return session


def test_zapier_subscribe_invalidates_active_cache():
    from src.routers.integrations import zapier

    api_user = SimpleNamespace(
        org_id=7, created_by_user_id=3,
        rights={"users": {"action_read": True}, "courses": {"action_read": True}},
    )
    session = _zapier_session()
    payload = zapier.ZapierSubscriptionCreate(
        target_url="https://hooks.zapier.com/x", event="course_created", zap_id="z", zap_name="n"
    )
    with patch.object(zapier, "require_org_admin", new=AsyncMock()), patch.object(
        zapier, "_validate_webhook_url"
    ), patch.object(zapier, "_validate_event"), patch.object(
        zapier, "encrypt_secret", return_value="enc"
    ), patch.object(zapier, "invalidate_active_endpoint_cache") as inv:
        asyncio.run(
            zapier.zapier_create_subscription(MagicMock(), payload, ctx=(api_user, session))
        )
    inv.assert_called_once_with(7)


def test_zapier_unsubscribe_invalidates_active_cache():
    from src.routers.integrations import zapier

    api_user = SimpleNamespace(org_id=7, created_by_user_id=3, rights={"users": {"action_read": True}})
    session = _zapier_session(endpoint=MagicMock())
    with patch.object(zapier, "require_org_admin", new=AsyncMock()), patch.object(
        zapier, "invalidate_active_endpoint_cache"
    ) as inv:
        asyncio.run(zapier.zapier_delete_subscription(5, ctx=(api_user, session)))
    inv.assert_called_once_with(7)


# --- Demo org per-visitor AI cap ----------------------------------------------


class _Redis:
    def __init__(self):
        self.store: dict[str, int] = {}

    def incr(self, key):
        self.store[key] = self.store.get(key, 0) + 1
        return self.store[key]

    def expire(self, key, ttl):
        return True


def _run_cap(org_id, *, demo, acting, redis):
    async def go():
        token = rate_limiting.ai_acting_user.set(acting)
        try:
            with patch(
                "src.services.demo.guards.is_demo_org", new=AsyncMock(return_value=demo)
            ), patch.object(usage, "_get_redis_client", return_value=redis):
                await usage._enforce_demo_visitor_ai_cap(org_id, MagicMock())
        finally:
            rate_limiting.ai_acting_user.reset(token)

    asyncio.run(go())


def test_demo_visitor_capped_after_daily_limit():
    redis = _Redis()
    for _ in range(usage.DEMO_AI_DAILY_REQUESTS_PER_USER):
        _run_cap(1, demo=True, acting=(42, 1), redis=redis)
    with pytest.raises(HTTPException) as exc:
        _run_cap(1, demo=True, acting=(42, 1), redis=redis)
    assert exc.value.status_code == 429
    # Another visitor still has their own allowance.
    _run_cap(1, demo=True, acting=(43, 1), redis=redis)


def test_non_demo_org_not_capped():
    redis = _Redis()
    for _ in range(usage.DEMO_AI_DAILY_REQUESTS_PER_USER + 5):
        _run_cap(1, demo=False, acting=(42, 1), redis=redis)
    assert redis.store == {}


def test_no_acting_user_or_other_org_skips_cap():
    redis = _Redis()
    _run_cap(1, demo=True, acting=None, redis=redis)
    _run_cap(1, demo=True, acting=(42, 2), redis=redis)
    assert redis.store == {}


def test_enforce_ai_rate_limit_records_acting_user():
    async def go():
        with patch.object(rate_limiting, "check_ai_rate_limit", return_value=(True, 60)):
            rate_limiting.enforce_ai_rate_limit(42, 1)
        return rate_limiting.ai_acting_user.get()

    assert asyncio.run(go()) == (42, 1)


def test_reserve_ai_credit_applies_demo_cap():
    resolved = {"enabled": True}
    with patch.object(
        usage, "_load_org_config_for_ai", new=AsyncMock(return_value=MagicMock(config={}))
    ), patch(
        "src.security.features_utils.resolve.resolve_feature", return_value=resolved
    ), patch.object(
        usage,
        "_enforce_demo_visitor_ai_cap",
        new=AsyncMock(side_effect=HTTPException(status_code=429)),
    ):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(usage.reserve_ai_credit(1, MagicMock()))
    assert exc.value.status_code == 429
