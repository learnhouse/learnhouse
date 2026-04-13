"""Tests for src/services/orgs/custom_domains.py."""

import builtins
import os
import sys
import types
from datetime import datetime
import ssl
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.custom_domains import CustomDomain
from src.db.users import PublicUser
from src.services.orgs import custom_domains as custom_domains_service
from src.services.orgs.custom_domains import (
    _get_subdomain_prefix,
    add_custom_domain,
    check_domain_ssl_status,
    delete_custom_domain,
    generate_verification_token,
    get_custom_domain,
    get_domain_verification_info,
    get_verification_instructions,
    is_reserved_domain,
    is_valid_domain,
    list_all_verified_domains,
    list_custom_domains,
    resolve_org_by_domain,
    verify_custom_domain,
    verify_domain_dns,
)


def _make_custom_domain(
    db,
    org_id,
    *,
    domain,
    status="pending",
    verification_token="verify-token",
    primary=False,
    domain_uuid=None,
    creation_date=None,
    update_date=None,
    verified_at=None,
    last_check_at=None,
    check_error=None,
):
    custom_domain = CustomDomain(
        domain_uuid=domain_uuid or f"domain_{uuid4()}",
        domain=domain,
        org_id=org_id,
        status=status,
        verification_token=verification_token,
        primary=primary,
        creation_date=creation_date or str(datetime.now()),
        update_date=update_date or str(datetime.now()),
        verified_at=verified_at,
        last_check_at=last_check_at,
        check_error=check_error,
    )
    db.add(custom_domain)
    db.commit()
    db.refresh(custom_domain)
    return custom_domain


def _make_public_user(user_id: int, username: str = "outsider") -> PublicUser:
    return PublicUser(
        id=user_id,
        username=username,
        first_name="Out",
        last_name="Sider",
        email=f"{username}@test.com",
        user_uuid=f"user_{username}",
    )


def _install_fake_dns_module(*, resolve_side_effect=None, resolve_return_value=None):
    resolver = types.ModuleType("dns.resolver")

    class NXDOMAIN(Exception):
        pass

    class NoAnswer(Exception):
        pass

    resolver.NXDOMAIN = NXDOMAIN
    resolver.NoAnswer = NoAnswer
    if resolve_side_effect is not None:
        resolver.resolve = Mock(side_effect=resolve_side_effect)
    else:
        resolver.resolve = Mock(return_value=resolve_return_value)

    dns = types.ModuleType("dns")
    dns.resolver = resolver
    return dns, resolver


class _FakeSocket:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeSSLSocket(_FakeSocket):
    def __init__(self, cert):
        self._cert = cert

    def getpeercert(self):
        return self._cert


class TestCustomDomainHelpers:
    def test_helper_functions_and_verification_instructions(self):
        with patch(
            "src.services.orgs.custom_domains.secrets.token_urlsafe",
            return_value="token123",
        ):
            token = generate_verification_token()

        assert token == "token123"
        assert is_valid_domain("docs.example.com") is True
        assert is_valid_domain("bad-domain") is False
        assert is_reserved_domain("learnhouse.io") is True
        assert is_reserved_domain("docs.example.com") is False
        assert _get_subdomain_prefix("contribhub.com") == ""
        assert _get_subdomain_prefix("docs.learn.contribhub.com") == "docs.learn"

        info = get_verification_instructions(
            "docs.example.com",
            "token123",
            "test-org",
        )

        assert info.domain == "docs.example.com"
        assert info.status == "pending"
        assert info.txt_record_host == "_learnhouse-verification.docs"
        assert info.txt_record_value == "learnhouse-verify=token123"
        assert info.cname_record_host == "docs"
        assert info.cname_record_value == f"test-org.{custom_domains_service.LEARNHOUSE_DOMAIN}"
        assert "DNS records" in info.instructions


class TestAddCustomDomain:
    @pytest.mark.asyncio
    async def test_add_custom_domain_success_and_persistence(
        self, mock_request, db, org, admin_user
    ):
        payload = {"domain": "HTTPS://Docs.Example.com/path"}

        with patch(
            "src.services.orgs.custom_domains.generate_verification_token",
            return_value="token-123",
        ):
            result = await add_custom_domain(
                mock_request,
                db,
                custom_domains_service.CustomDomainCreate(**payload),
                org.id,
                admin_user,
            )

        row = db.exec(
            select(CustomDomain).where(CustomDomain.domain == "docs.example.com")
        ).first()

        assert result.domain == "docs.example.com"
        assert result.org_id == org.id
        assert result.status == "pending"
        assert result.verification_token == "token-123"
        assert row is not None
        assert row.domain_uuid.startswith("domain_")

    @pytest.mark.asyncio
    async def test_add_custom_domain_rejects_anonymous_and_non_admin_users(
        self, mock_request, db, org, anonymous_user, regular_user
    ):
        with pytest.raises(HTTPException) as anon_exc:
            await add_custom_domain(
                mock_request,
                db,
                custom_domains_service.CustomDomainCreate(domain="docs.example.com"),
                org.id,
                anonymous_user,
            )

        with pytest.raises(HTTPException) as role_exc:
            await add_custom_domain(
                mock_request,
                db,
                custom_domains_service.CustomDomainCreate(domain="docs.example.com"),
                org.id,
                regular_user,
            )

        assert anon_exc.value.status_code == 403
        assert role_exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_add_custom_domain_validation_and_duplicate_paths(
        self, mock_request, db, org, admin_user
    ):
        _make_custom_domain(
            db,
            org.id,
            domain="already.example.com",
            verification_token="existing-token",
        )

        with pytest.raises(HTTPException) as invalid_exc:
            await add_custom_domain(
                mock_request,
                db,
                custom_domains_service.CustomDomainCreate(domain="not-a-domain"),
                org.id,
                admin_user,
            )

        with pytest.raises(HTTPException) as reserved_exc:
            await add_custom_domain(
                mock_request,
                db,
                custom_domains_service.CustomDomainCreate(domain="https://learnhouse.io/app"),
                org.id,
                admin_user,
            )

        with pytest.raises(HTTPException) as duplicate_exc:
            await add_custom_domain(
                mock_request,
                db,
                custom_domains_service.CustomDomainCreate(domain="already.example.com"),
                org.id,
                admin_user,
            )

        with pytest.raises(HTTPException) as missing_org_exc:
            await add_custom_domain(
                mock_request,
                db,
                custom_domains_service.CustomDomainCreate(domain="missing.example.com"),
                999,
                admin_user,
            )

        assert invalid_exc.value.status_code == 400
        assert reserved_exc.value.status_code == 400
        assert duplicate_exc.value.status_code == 409
        assert missing_org_exc.value.status_code == 404


class TestListAndGetCustomDomains:
    @pytest.mark.asyncio
    async def test_list_custom_domains_and_get_domain(
        self, mock_request, db, org, admin_user
    ):
        older = _make_custom_domain(
            db,
            org.id,
            domain="older.example.com",
            status="pending",
            creation_date="2024-01-01 00:00:00",
            update_date="2024-01-01 00:00:00",
        )
        newer = _make_custom_domain(
            db,
            org.id,
            domain="newer.example.com",
            status="verified",
            creation_date="2024-02-01 00:00:00",
            update_date="2024-02-01 00:00:00",
        )

        domains = await list_custom_domains(mock_request, db, org.id, admin_user)
        fetched = await get_custom_domain(
            mock_request,
            db,
            org.id,
            newer.domain_uuid,
            admin_user,
        )

        assert [domain.domain for domain in domains] == [
            newer.domain,
            older.domain,
        ]
        assert fetched.domain_uuid == newer.domain_uuid
        assert fetched.status == "verified"

    @pytest.mark.asyncio
    async def test_list_and_get_custom_domain_rejects_non_members(
        self, mock_request, db, org
    ):
        outsider = _make_public_user(999)

        with pytest.raises(HTTPException) as list_exc:
            await list_custom_domains(mock_request, db, org.id, outsider)

        with pytest.raises(HTTPException) as get_exc:
            await get_custom_domain(
                mock_request,
                db,
                org.id,
                "domain_missing",
                outsider,
            )

        assert list_exc.value.status_code == 403
        assert get_exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_get_custom_domain_not_found(self, mock_request, db, org, admin_user):
        with pytest.raises(HTTPException) as exc_info:
            await get_custom_domain(
                mock_request,
                db,
                org.id,
                "missing-domain",
                admin_user,
            )

        assert exc_info.value.status_code == 404


class TestVerificationInfoAndVerifyCustomDomain:
    @pytest.mark.asyncio
    async def test_get_domain_verification_info_and_verify_custom_domain(
        self, mock_request, db, org, admin_user
    ):
        domain = _make_custom_domain(
            db,
            org.id,
            domain="docs.example.com",
            status="pending",
            verification_token="token-verify",
        )

        info = await get_domain_verification_info(
            mock_request,
            db,
            org.id,
            domain.domain_uuid,
            admin_user,
        )

        with patch(
            "src.services.orgs.custom_domains.verify_domain_dns",
            new=AsyncMock(return_value=(True, "Domain verified successfully")),
        ) as mock_verify:
            result = await verify_custom_domain(
                mock_request,
                db,
                org.id,
                domain.domain_uuid,
                admin_user,
            )

        assert info.domain == domain.domain
        assert info.status == "pending"
        assert info.txt_record_host == "_learnhouse-verification.docs"
        assert info.cname_record_host == "docs"
        assert result["success"] is True
        assert result["status"] == "pending"
        mock_verify.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_verify_custom_domain_failure_and_missing_rows(
        self, mock_request, db, org, admin_user, regular_user
    ):
        domain = _make_custom_domain(
            db,
            org.id,
            domain="fail.example.com",
            status="pending",
            verification_token="token-verify",
        )

        with patch(
            "src.services.orgs.custom_domains.verify_domain_dns",
            new=AsyncMock(return_value=(False, "TXT record not found")),
        ):
            with pytest.raises(HTTPException) as verify_exc:
                await verify_custom_domain(
                    mock_request,
                    db,
                    org.id,
                    domain.domain_uuid,
                    admin_user,
                )

        with patch(
            "src.services.orgs.custom_domains.require_org_membership",
            return_value=None,
        ):
            with pytest.raises(HTTPException) as org_exc:
                await get_domain_verification_info(
                    mock_request,
                    db,
                    999,
                    domain.domain_uuid,
                    admin_user,
                )

        with pytest.raises(HTTPException) as missing_domain_exc:
            await verify_custom_domain(
                mock_request,
                db,
                org.id,
                "missing-domain",
                admin_user,
            )

        with pytest.raises(HTTPException) as forbidden_exc:
            await verify_custom_domain(
                mock_request,
                db,
                org.id,
                domain.domain_uuid,
                regular_user,
            )

        assert verify_exc.value.status_code == 400
        assert org_exc.value.status_code == 404
        assert missing_domain_exc.value.status_code == 404
        assert forbidden_exc.value.status_code == 403


class TestVerifyDomainDns:
    @pytest.mark.asyncio
    async def test_verify_domain_dns_success_and_dns_errors(self, db, org):
        domain = _make_custom_domain(
            db,
            org.id,
            domain="docs.example.com",
            status="pending",
            verification_token="token-123",
        )

        dns_module, resolver_module = _install_fake_dns_module(
            resolve_return_value=["learnhouse-verify=token-123"],
        )
        with patch.dict(sys.modules, {"dns": dns_module, "dns.resolver": resolver_module}):
            success, message = await verify_domain_dns(domain, db, org.slug)

        assert success is True
        assert message == "Domain verified successfully"
        assert domain.status == "verified"
        assert domain.verified_at is not None
        assert domain.last_check_at is not None
        resolver_module.resolve.assert_called_once_with(
            "_learnhouse-verification.docs.example.com",
            "TXT",
        )

        mismatch = _make_custom_domain(
            db,
            org.id,
            domain="mismatch.example.com",
            status="pending",
            verification_token="token-abc",
        )
        dns_module, resolver_module = _install_fake_dns_module(
            resolve_return_value=["learnhouse-verify=wrong"],
        )
        with patch.dict(sys.modules, {"dns": dns_module, "dns.resolver": resolver_module}):
            success, message = await verify_domain_dns(mismatch, db, org.slug)

        assert success is False
        assert "doesn't match" in message
        assert mismatch.status == "pending"
        assert mismatch.check_error == "TXT record found but value doesn't match"

        missing = _make_custom_domain(
            db,
            org.id,
            domain="missing.example.com",
            status="pending",
            verification_token="token-def",
        )
        dns_module, resolver_module = _install_fake_dns_module()
        nxdomain_error = resolver_module.NXDOMAIN("missing")
        resolver_module.resolve = Mock(side_effect=nxdomain_error)
        with patch.dict(sys.modules, {"dns": dns_module, "dns.resolver": resolver_module}):
            success, message = await verify_domain_dns(missing, db, org.slug)

        assert success is False
        assert "TXT record not found" in message
        assert missing.status == "pending"
        assert missing.check_error == "TXT record not found"

        unanswered = _make_custom_domain(
            db,
            org.id,
            domain="noanswer.example.com",
            status="pending",
            verification_token="token-ghi",
        )
        dns_module, resolver_module = _install_fake_dns_module()
        noanswer_error = resolver_module.NoAnswer("no answer")
        resolver_module.resolve = Mock(side_effect=noanswer_error)
        with patch.dict(sys.modules, {"dns": dns_module, "dns.resolver": resolver_module}):
            success, message = await verify_domain_dns(unanswered, db, org.slug)

        assert success is False
        assert "TXT record not found" in message
        assert unanswered.check_error == "TXT record not found (no answer)"

    @pytest.mark.asyncio
    async def test_verify_domain_dns_dev_mode_and_import_error(self, db, org):
        dev_domain = _make_custom_domain(
            db,
            org.id,
            domain="dev.example.com",
            status="pending",
            verification_token="token-dev",
        )

        with patch.dict(
            os.environ,
            {"LEARNHOUSE_CUSTOM_DOMAIN_DEV_MODE": "true"},
            clear=False,
        ):
            success, message = await verify_domain_dns(dev_domain, db, org.slug)

        assert success is True
        assert message == "Verified (dev mode)"
        assert dev_domain.status == "verified"

        import_error_domain = _make_custom_domain(
            db,
            org.id,
            domain="import-error.example.com",
            status="pending",
            verification_token="token-import",
        )

        original_import = builtins.__import__

        def fake_import(name, *args, **kwargs):
            if name == "dns" or name.startswith("dns."):
                raise ImportError("dnspython missing")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=fake_import):
            success, message = await verify_domain_dns(
                import_error_domain,
                db,
                org.slug,
            )

        assert success is False
        assert "temporarily unavailable" in message
        assert import_error_domain.check_error == "DNS verification unavailable"


class TestCustomDomainDeletionAndListing:
    @pytest.mark.asyncio
    async def test_delete_custom_domain_and_list_all_verified_domains(
        self, mock_request, db, org, admin_user
    ):
        verified = _make_custom_domain(
            db,
            org.id,
            domain="verified.example.com",
            status="verified",
            verification_token="token-verified",
        )
        pending = _make_custom_domain(
            db,
            org.id,
            domain="pending.example.com",
            status="pending",
            verification_token="token-pending",
        )

        listed = await list_all_verified_domains(db)
        deleted = await delete_custom_domain(
            mock_request,
            db,
            org.id,
            verified.domain_uuid,
            admin_user,
        )

        row = db.exec(
            select(CustomDomain).where(CustomDomain.domain_uuid == verified.domain_uuid)
        ).first()

        assert listed == [
            {
                "domain": verified.domain,
                "org_id": org.id,
                "domain_uuid": verified.domain_uuid,
            }
        ]
        assert deleted["message"] == "Custom domain deleted successfully"
        assert row is None
        assert db.exec(
            select(CustomDomain).where(CustomDomain.domain_uuid == pending.domain_uuid)
        ).first() is not None

    @pytest.mark.asyncio
    async def test_delete_custom_domain_not_found(self, mock_request, db, org, admin_user):
        with pytest.raises(HTTPException) as exc_info:
            await delete_custom_domain(
                mock_request,
                db,
                org.id,
                "missing-domain",
                admin_user,
            )

        assert exc_info.value.status_code == 404


class TestResolveAndSslStatus:
    @pytest.mark.asyncio
    async def test_resolve_org_by_domain_variants(self, db, org):
        verified = _make_custom_domain(
            db,
            org.id,
            domain="resolve.example.com",
            status="verified",
            verification_token="token-resolve",
        )
        orphan_verified = _make_custom_domain(
            db,
            999,
            domain="orphan.example.com",
            status="verified",
            verification_token="token-orphan",
        )
        _make_custom_domain(
            db,
            org.id,
            domain="pending.example.com",
            status="pending",
            verification_token="token-pending",
        )

        resolved = await resolve_org_by_domain(db, "  RESOLVE.EXAMPLE.COM  ")
        missing_domain = await resolve_org_by_domain(db, "unknown.example.com")
        missing_org = await resolve_org_by_domain(db, orphan_verified.domain)

        assert resolved is not None
        assert resolved.org_id == org.id
        assert resolved.org_slug == org.slug
        assert missing_domain is None
        assert missing_org is None

        listed = await list_all_verified_domains(db)
        assert {row["domain"] for row in listed} == {
            verified.domain,
            orphan_verified.domain,
        }

    @pytest.mark.asyncio
    async def test_check_domain_ssl_status_variants(
        self, mock_request, db, org, admin_user
    ):
        pending = _make_custom_domain(
            db,
            org.id,
            domain="pending-ssl.example.com",
            status="pending",
            verification_token="token-pending",
        )
        verified = _make_custom_domain(
            db,
            org.id,
            domain="active-ssl.example.com",
            status="verified",
            verification_token="token-active",
        )
        invalid = _make_custom_domain(
            db,
            org.id,
            domain="invalid-ssl.example.com",
            status="verified",
            verification_token="token-invalid",
        )
        provisioning = _make_custom_domain(
            db,
            org.id,
            domain="provisioning-ssl.example.com",
            status="verified",
            verification_token="token-provisioning",
        )

        pending_result = await check_domain_ssl_status(
            mock_request,
            db,
            org.id,
            pending.domain_uuid,
            admin_user,
        )

        fake_context = Mock()
        fake_context.minimum_version = None
        fake_context.wrap_socket.return_value = _FakeSSLSocket(
            {
                "notAfter": "Jan 01 00:00:00 2030 GMT",
                "issuer": ((("commonName", "Lets Encrypt"),),),
            }
        )

        with patch(
            "src.services.orgs.custom_domains.ssl.create_default_context",
            return_value=fake_context,
        ), patch(
            "src.services.orgs.custom_domains.socket.create_connection",
            return_value=_FakeSocket(),
        ) as mock_connect:
            active_result = await check_domain_ssl_status(
                mock_request,
                db,
                org.id,
                verified.domain_uuid,
                admin_user,
            )

        fake_context_invalid = Mock()
        fake_context_invalid.minimum_version = None
        fake_context_invalid.wrap_socket.side_effect = ssl.SSLCertVerificationError(
            "invalid certificate"
        )

        with patch(
            "src.services.orgs.custom_domains.ssl.create_default_context",
            return_value=fake_context_invalid,
        ), patch(
            "src.services.orgs.custom_domains.socket.create_connection",
            return_value=_FakeSocket(),
        ):
            invalid_result = await check_domain_ssl_status(
                mock_request,
                db,
                org.id,
                invalid.domain_uuid,
                admin_user,
            )

        with patch(
            "src.services.orgs.custom_domains.socket.create_connection",
            side_effect=ConnectionRefusedError("refused"),
        ):
            provisioning_result = await check_domain_ssl_status(
                mock_request,
                db,
                org.id,
                provisioning.domain_uuid,
                admin_user,
            )

        assert pending_result == {
            "has_ssl": False,
            "status": "pending_verification",
            "message": "Domain must be verified before SSL can be provisioned.",
        }
        assert active_result["has_ssl"] is True
        assert active_result["status"] == "active"
        assert active_result["expires"] == "Jan 01 00:00:00 2030 GMT"
        assert active_result["issuer"] == "Lets Encrypt"
        mock_connect.assert_called_once_with((verified.domain, 443), timeout=5)
        assert invalid_result["has_ssl"] is False
        assert invalid_result["status"] == "invalid"
        assert "invalid certificate" in invalid_result["message"]
        assert provisioning_result == {
            "has_ssl": False,
            "status": "provisioning",
            "message": "SSL certificate is being provisioned. This usually takes a few minutes after domain verification.",
        }
