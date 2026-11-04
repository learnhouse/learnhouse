"""Legacy SHA-256 token hashes are upgraded on first successful use.

Tokens minted before the argon2id switch were stored as pepperless SHA-256
hex. They keep authenticating, and the first validation re-hashes them with
the current scheme so the weak hash does not linger in the database. One
argon2 hash per test, no loops.
"""

import hashlib
from datetime import datetime

from src.db.api_tokens import APIToken
from src.db.superadmin_api_tokens import SuperadminAPIToken
from src.security.security import security_token_needs_rehash, security_verify_token
from src.services.api_tokens.api_tokens import validate_api_token_for_auth
from src.services.api_tokens.superadmin_api_tokens import validate_superadmin_token_for_auth


def _legacy_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class TestOrgTokenLegacyHashUpgrade:
    async def test_legacy_hash_authenticates_and_is_upgraded(self, db, org, admin_user):
        token = "lh_legacytok0123456789"  # fake test token  gitleaks:allow
        record = APIToken(
            token_uuid="apitoken_legacy",
            name="Legacy",
            description="minted before argon2id",
            token_prefix=token[:12],
            token_hash=_legacy_hash(token),
            org_id=org.id,
            created_by_user_id=admin_user.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
            is_active=True,
        )
        db.add(record)
        await db.commit()

        validated = await validate_api_token_for_auth(token, db)

        assert validated is not None
        assert validated.token_uuid == "apitoken_legacy"
        await db.refresh(record)
        assert record.last_used_at is not None
        assert not security_token_needs_rehash(record.token_hash)
        assert record.token_hash != _legacy_hash(token)
        assert security_verify_token(token, record.token_hash)


class TestSuperadminTokenLegacyHashUpgrade:
    async def test_legacy_hash_authenticates_and_is_upgraded(self, db, admin_user):
        token = "lh_sa_legacytok0123456789"  # fake test token  gitleaks:allow
        record = SuperadminAPIToken(
            token_uuid="satoken_legacy",
            name="Legacy SA",
            token_prefix=token[:15],
            token_hash=_legacy_hash(token),
            created_by_user_id=admin_user.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
            is_active=True,
        )
        db.add(record)
        await db.commit()

        validated = await validate_superadmin_token_for_auth(token, db)

        assert validated is not None
        assert validated.token_uuid == "satoken_legacy"
        await db.refresh(record)
        assert not security_token_needs_rehash(record.token_hash)
        assert security_verify_token(token, record.token_hash)
