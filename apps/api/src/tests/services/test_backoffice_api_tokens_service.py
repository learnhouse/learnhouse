"""Tests for src/services/api_tokens/backoffice_api_tokens.py."""

from datetime import datetime, timedelta, timezone


from src.db.backoffice_api_tokens import BackofficeAPIToken
from src.services.api_tokens.backoffice_api_tokens import (
    TOKEN_PREFIX,
    generate_token,
    hash_token,
    validate_backoffice_token_for_auth,
    verify_token,
)


async def _seed_token(db, **overrides) -> BackofficeAPIToken:
    full_token, prefix, token_hash = generate_token()
    now = str(datetime.now())
    t = BackofficeAPIToken(
        token_uuid=overrides.pop("token_uuid", f"satoken_test_{now}"),
        name=overrides.pop("name", "Test SA Token"),
        description=overrides.pop("description", None),
        token_prefix=overrides.pop("token_prefix", prefix),
        token_hash=overrides.pop("token_hash", token_hash),
        created_by_user_id=overrides.pop("created_by_user_id", 1),
        creation_date=overrides.pop("creation_date", now),
        update_date=overrides.pop("update_date", now),
        last_used_at=overrides.pop("last_used_at", None),
        expires_at=overrides.pop("expires_at", None),
        is_active=overrides.pop("is_active", True),
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t, full_token


class TestTokenHelpers:
    def test_generate_token_prefix_and_shape(self):
        full, prefix, h = generate_token()
        assert full.startswith(TOKEN_PREFIX)
        assert len(prefix) == 15
        assert prefix == full[:15]
        assert verify_token(full, h) is True

    def test_generate_is_unique(self, monkeypatch):
        # Uniqueness comes from the random part; skip the Argon2 hash, which
        # made 200 calls take ten seconds.
        monkeypatch.setattr(
            "src.services.api_tokens.backoffice_api_tokens.security_hash_token",
            lambda token: "hashed",
        )
        seen = {generate_token()[0] for _ in range(200)}
        assert len(seen) == 200

    def test_hash_is_salted_and_verifies(self):
        h1 = hash_token("lh_sa_x")
        h2 = hash_token("lh_sa_x")
        assert h1 != h2
        assert verify_token("lh_sa_x", h1) is True
        assert verify_token("lh_sa_x", h2) is True
        assert verify_token("lh_sa_y", h1) is False

    def test_verify_token_happy_and_wrong(self):
        full, _prefix, h = generate_token()
        assert verify_token(full, h) is True
        assert verify_token("lh_sa_wrong", h) is False


class TestValidateForAuth:
    async def test_valid_token_returns_record_and_updates_last_used(self, db):
        token_row, full = await _seed_token(db)
        assert token_row.last_used_at is None
        result = await validate_backoffice_token_for_auth(full, db)
        assert result is not None
        assert result.id == token_row.id
        assert result.last_used_at is not None

    async def test_wrong_prefix_returns_none(self, db):
        result = await validate_backoffice_token_for_auth("lh_not_an_sa_token", db)
        assert result is None

    async def test_unknown_token_returns_none(self, db):
        result = await validate_backoffice_token_for_auth("lh_sa_bogus_value_here", db)
        assert result is None

    async def test_revoked_token_returns_none(self, db):
        token_row, full = await _seed_token(db, is_active=False)
        result = await validate_backoffice_token_for_auth(full, db)
        assert result is None

    async def test_expired_token_returns_none(self, db):
        past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        _, full = await _seed_token(db, expires_at=past)
        result = await validate_backoffice_token_for_auth(full, db)
        assert result is None

    async def test_future_expiry_still_valid(self, db):
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        _, full = await _seed_token(db, expires_at=future)
        result = await validate_backoffice_token_for_auth(full, db)
        assert result is not None

    async def test_unparseable_expiry_fails_closed(self, db):
        _, full = await _seed_token(db, expires_at="not-a-date")
        result = await validate_backoffice_token_for_auth(full, db)
        assert result is None

    async def test_last_used_update_failure_does_not_break_auth(self, db, monkeypatch):
        """If updating last_used_at raises, auth still succeeds; the timestamp
        is bookkeeping, not a security gate."""
        token_row, full = await _seed_token(db)

        original_commit = db.commit
        commit_calls = {"n": 0}

        async def flaky_commit():
            commit_calls["n"] += 1
            if commit_calls["n"] == 1:
                # First commit (the last_used_at update) raises; subsequent
                # commits behave normally.
                raise RuntimeError("simulated DB hiccup on last_used_at update")
            return await original_commit()

        monkeypatch.setattr(db, "commit", flaky_commit)

        result = await validate_backoffice_token_for_auth(full, db)
        assert result is not None
        assert result.id == token_row.id
