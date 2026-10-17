"""A verified custom domain must still point at the platform before it is
handed credentials (OAuth code bounce, emailed reset/magic links).

Verification is a one-time TXT proof; a tenant could verify a domain and then
repoint it at their own server to receive OAuth codes or reset links."""

from datetime import datetime
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.custom_domains import CustomDomain
from src.routers.orgs.custom_domains import public_router
from src.services.orgs import custom_domains as cd


class _Rec:
    def __init__(self, value):
        self.target = value
        self.address = value


def _fake_resolver(records):
    """records: {(name, rdtype): [values] | Exception}."""
    import dns.resolver

    def resolve(name, rdtype, lifetime=None):
        val = records.get((name, rdtype))
        if isinstance(val, Exception):
            raise val
        if not val:
            raise dns.resolver.NoAnswer()
        return [_Rec(v) for v in val]

    return resolve


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    cd._POINTS_AT_PLATFORM_CACHE.clear()
    monkeypatch.setattr(cd, "LEARNHOUSE_DOMAIN", "platform.test")
    monkeypatch.delenv("LEARNHOUSE_CUSTOM_DOMAIN_DEV_MODE", raising=False)
    yield
    cd._POINTS_AT_PLATFORM_CACHE.clear()


def _patch_dns(records):
    return patch("dns.resolver.resolve", side_effect=_fake_resolver(records))


class TestLiveDnsCheck:
    def test_cname_to_org_slug_host_passes(self):
        with _patch_dns({("learn.acme.com", "CNAME"): ["acme.platform.test."]}):
            assert cd.domain_points_at_platform("learn.acme.com", "acme")

    def test_a_record_overlap_passes(self):
        with _patch_dns({
            ("acme.com", "A"): ["203.0.113.5"],
            ("acme.platform.test", "A"): ["203.0.113.5"],
        }):
            assert cd.domain_points_at_platform("acme.com", "acme")

    def test_repointed_domain_fails(self):
        with _patch_dns({
            ("evil.com", "CNAME"): ["attacker.example."],
            ("evil.com", "A"): ["198.51.100.66"],
            ("acme.platform.test", "A"): ["203.0.113.5"],
            ("platform.test", "A"): ["203.0.113.4"],
        }):
            assert not cd.domain_points_at_platform("evil.com", "acme")

    def test_dns_error_fails_closed(self):
        import dns.exception

        with _patch_dns({("learn.acme.com", "CNAME"): dns.exception.Timeout()}):
            assert not cd.domain_points_at_platform("learn.acme.com", "acme")

    def test_no_records_fails(self):
        with _patch_dns({}):
            assert not cd.domain_points_at_platform("gone.acme.com", "acme")

    def test_result_is_cached(self):
        with _patch_dns({("learn.acme.com", "CNAME"): ["acme.platform.test"]}) as m:
            assert cd.domain_points_at_platform("learn.acme.com", "acme")
            calls = m.call_count
            assert cd.domain_points_at_platform("LEARN.acme.com.", "acme")
            assert m.call_count == calls

    def test_dev_mode_bypasses(self, monkeypatch):
        monkeypatch.setenv("LEARNHOUSE_CUSTOM_DOMAIN_DEV_MODE", "true")
        with _patch_dns({}):
            assert cd.domain_points_at_platform("anything.example", "acme")


async def _verified_domain(db, org_id, domain):
    now = str(datetime.now())
    row = CustomDomain(
        domain_uuid=f"domain_{uuid4()}",
        domain=domain,
        org_id=org_id,
        status="verified",
        verification_token="t",
        primary=False,
        creation_date=now,
        update_date=now,
    )
    db.add(row)
    await db.commit()
    return row


class TestResolveForAuth:
    async def test_for_auth_requires_live_dns(self, db, org):
        await _verified_domain(db, org.id, "learn.acme.com")
        with patch.object(
            cd, "custom_domain_points_at_platform", new=AsyncMock(return_value=False)
        ) as live:
            # Normal page resolution is unaffected by the live check.
            assert await cd.resolve_org_by_domain(db, "learn.acme.com") is not None
            live.assert_not_called()
            assert await cd.resolve_org_by_domain(db, "learn.acme.com", for_auth=True) is None
            live.assert_awaited_once_with("learn.acme.com", org.slug)

        with patch.object(
            cd, "custom_domain_points_at_platform", new=AsyncMock(return_value=True)
        ):
            res = await cd.resolve_org_by_domain(db, "learn.acme.com", for_auth=True)
            assert res is not None and res.org_id == org.id

    async def test_router_for_auth_flag_returns_404(self, db, org):
        await _verified_domain(db, org.id, "learn.acme.com")
        app = FastAPI()
        app.include_router(public_router, prefix="/api/v1/public")
        app.dependency_overrides[get_db_session] = lambda: db
        with patch.object(
            cd, "custom_domain_points_at_platform", new=AsyncMock(return_value=False)
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
                ok = await c.get("/api/v1/public/resolve/domain/learn.acme.com")
                blocked = await c.get("/api/v1/public/resolve/domain/learn.acme.com?for_auth=1")
        assert ok.status_code == 200
        assert blocked.status_code == 404


class TestSignupBaseUrlFallsBack:
    async def test_repointed_custom_domain_falls_back_to_platform_host(self, monkeypatch):
        from types import SimpleNamespace
        from src.services.email import utils as email_utils

        cfg = SimpleNamespace(
            hosting_config=SimpleNamespace(tenancy="multi", ssl=True, domain="platform.test"),
        )
        monkeypatch.setattr(email_utils, "get_learnhouse_config", lambda: cfg)
        monkeypatch.setattr(
            email_utils,
            "_get_primary_verified_custom_domain",
            AsyncMock(return_value="evil.com"),
        )
        monkeypatch.setattr(
            cd, "custom_domain_points_at_platform", AsyncMock(return_value=False)
        )
        url = await email_utils.get_org_signup_base_url("acme", None, db_session=object(), org_id=1)
        assert url == "https://acme.platform.test"
