"""Integrations hardening: Zapier subscription limits, SSRF address policy.
(Org-scoped analytics enrichment is tested with EE analytics.)"""

import ipaddress
from datetime import datetime
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, User
from src.db.webhooks import WebhookEndpoint
from src.routers.integrations.zapier import (
    ZapierSubscriptionCreate,
    zapier_create_subscription,
)
from src.services.utils.ssrf_guard import (
    SSRFBlockedError,
    _embedded_ipv4,
    _is_ip_blocked,
    resolve_and_validate_url,
)
from src.services.webhooks import webhooks as webhooks_service
from src.services.webhooks.webhooks import MAX_WEBHOOK_ENDPOINTS_PER_ORG


def _now() -> str:
    return str(datetime.now())


def _addrinfo(ip: str):
    return [(None, None, None, None, (ip, 443))]


# ---------------------------------------------------------------------------
# Zapier subscriptions share the webhook cap and creation rate limit
# ---------------------------------------------------------------------------


@pytest.fixture
async def zap_token(db, org):
    db.add(Role(id=1, name="Admin", description="", rights={}, creation_date=_now(), update_date=_now()))
    db.add(User(id=1, username="admin", first_name="A", last_name="B", email="a@example.com",
                password="x", user_uuid="user_admin"))
    await db.commit()
    db.add(UserOrganization(user_id=1, org_id=org.id, role_id=1, creation_date=_now(), update_date=_now()))
    await db.commit()
    return APITokenUser(
        id=1, user_uuid="apitoken_z", username="api_token", org_id=org.id,
        token_name="Zap", created_by_user_id=1,
        rights={r: {"action_read": True} for r in ("courses", "users")},
    )


def _payload():
    return ZapierSubscriptionCreate(
        target_url="https://hooks.zapier.example/catch/1", event="course_completed"
    )


def _allow_rate(allowed=True):
    return patch(
        "src.routers.webhooks.check_webhook_mutation_rate_limit",
        return_value=(allowed, 0 if allowed else 1800),
    )


def _public_dns():
    return patch(
        "src.services.webhooks.webhooks.socket.getaddrinfo",
        return_value=_addrinfo("93.184.216.34"),
    )


class TestZapierSubscriptionLimits:
    async def test_create_under_cap_succeeds(self, db, zap_token, mock_request):
        with _allow_rate(), _public_dns():
            result = await zapier_create_subscription(
                request=mock_request, payload=_payload(), ctx=(zap_token, db)
            )
        assert result.id > 0

    async def test_create_is_rate_limited(self, db, zap_token, mock_request):
        with _allow_rate(False) as rate, _public_dns():
            with pytest.raises(HTTPException) as exc:
                await zapier_create_subscription(
                    request=mock_request, payload=_payload(), ctx=(zap_token, db)
                )
        assert exc.value.status_code == 429
        rate.assert_called_once_with(zap_token.org_id, "create")
        assert (await db.execute(select(WebhookEndpoint))).scalars().first() is None

    async def test_create_respects_endpoint_cap(self, db, zap_token, mock_request):
        for i in range(MAX_WEBHOOK_ENDPOINTS_PER_ORG):
            db.add(WebhookEndpoint(
                webhook_uuid=f"webhook_{i}", org_id=zap_token.org_id,
                url="https://hooks.example/x", secret_encrypted="x", events=["ping"],
                created_by_user_id=1, creation_date=_now(), update_date=_now(),
            ))
        await db.commit()
        with _allow_rate(), _public_dns():
            with pytest.raises(HTTPException) as exc:
                await zapier_create_subscription(
                    request=mock_request, payload=_payload(), ctx=(zap_token, db)
                )
        assert exc.value.status_code == 400
        assert "at most" in exc.value.detail


class TestEndpointCapHelper:
    async def test_cap_allows_below_limit(self, db, org):
        await webhooks_service.enforce_webhook_endpoint_cap(db, org.id)


# ---------------------------------------------------------------------------
# SSRF guard: only globally routable unicast, embedded IPv4 checked too
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "addr",
    [
        "::",                                      # unspecified
        "::1",
        "0.0.0.0",
        "64:ff9b::a9fe:a9fe",                     # NAT64 -> 169.254.169.254
        "64:ff9b::a00:1",                          # NAT64 -> 10.0.0.1
        "2002:a9fe:a9fe::",                        # 6to4 -> 169.254.169.254
        "2001:0:4136:e378:8000:63bf:f5ff:fffe",    # Teredo
        "::ffff:127.0.0.1",                        # IPv4-mapped
        "::7f00:1",                                # IPv4-compatible 127.0.0.1
        "100.64.0.1",                              # CGNAT
        "203.0.113.10",                            # documentation
        "224.0.0.1",                               # multicast
        "ff0e::1",
        "fec0::1",                                 # site-local
        "fd00::1",
    ],
)
def test_non_global_addresses_are_blocked(addr):
    assert _is_ip_blocked(ipaddress.ip_address(addr))


@pytest.mark.parametrize(
    "addr", ["93.184.216.34", "2606:4700::1", "::ffff:93.184.216.34", "64:ff9b::5db8:d822"]
)
def test_public_addresses_are_allowed(addr):
    assert not _is_ip_blocked(ipaddress.ip_address(addr))


def test_embedded_ipv4_extraction():
    assert _embedded_ipv4(ipaddress.ip_address("10.0.0.1")) == []
    assert _embedded_ipv4(ipaddress.ip_address("2606:4700::1")) == []
    assert ipaddress.ip_address("10.0.0.1") in _embedded_ipv4(ipaddress.ip_address("64:ff9b::a00:1"))
    assert ipaddress.ip_address("10.0.0.1") in _embedded_ipv4(ipaddress.ip_address("2002:a00:1::"))


def test_resolve_rejects_nat64_internal_target():
    with patch(
        "src.services.utils.ssrf_guard.socket.getaddrinfo",
        return_value=_addrinfo("64:ff9b::a9fe:a9fe"),
    ):
        with pytest.raises(SSRFBlockedError):
            resolve_and_validate_url("https://rebind.example/hook")


@pytest.mark.parametrize("addr", ["::", "64:ff9b::a00:1", "100.64.0.1"])
def test_webhook_create_validation_uses_guard_policy(addr):
    with patch(
        "src.services.webhooks.webhooks.socket.getaddrinfo", return_value=_addrinfo(addr)
    ):
        with pytest.raises(HTTPException) as exc:
            webhooks_service._validate_webhook_url("https://hooks.example/x")
    assert exc.value.status_code == 400
