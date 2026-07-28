"""Tests for src/services/nudges/tokens.py."""

import pytest

from src.services.nudges import tokens as tokens_module
from src.services.nudges.tokens import (
    CATEGORY_LIFECYCLE,
    make_unsubscribe_token,
    verify_unsubscribe_token,
)


@pytest.fixture(autouse=True)
def _clear_secret_cache():
    """The signing key is lru_cached; clear it around tests that swap config."""
    tokens_module._unsub_secret.cache_clear()
    yield
    tokens_module._unsub_secret.cache_clear()


class TestRoundTrip:
    def test_token_verifies_back_to_the_same_uuid(self):
        token = make_unsubscribe_token("user_abc123")
        assert verify_unsubscribe_token(token) == "user_abc123"

    def test_token_is_url_safe(self):
        # Base64url + a hex signature: nothing here needs percent-encoding, so
        # the link survives mail clients that rewrite URLs.
        token = make_unsubscribe_token("user_abc123")
        assert all(c.isalnum() or c in "-_." for c in token)

    def test_distinct_users_get_distinct_tokens(self):
        assert make_unsubscribe_token("user_a") != make_unsubscribe_token("user_b")

    def test_uuid_with_padding_characters_round_trips(self):
        # b64 padding is stripped at mint time and restored on verify; a uuid
        # whose length lands on each padding case must survive.
        for uuid in ("a", "ab", "abc", "abcd"):
            assert verify_unsubscribe_token(make_unsubscribe_token(uuid)) == uuid


class TestRejection:
    def test_tampered_payload_is_rejected(self):
        token = make_unsubscribe_token("user_abc123")
        payload, _, signature = token.rpartition(".")
        forged = make_unsubscribe_token("user_victim").split(".")[0]
        assert verify_unsubscribe_token(f"{forged}.{signature}") is None

    def test_tampered_signature_is_rejected(self):
        token = make_unsubscribe_token("user_abc123")
        payload, _, signature = token.rpartition(".")
        flipped = ("0" if signature[0] != "0" else "1") + signature[1:]
        assert verify_unsubscribe_token(f"{payload}.{flipped}") is None

    @pytest.mark.parametrize(
        "garbage",
        ["", "no-dot", ".", "..", "!!!.abc", "abc.", ".abc"],
    )
    def test_malformed_tokens_return_none(self, garbage):
        assert verify_unsubscribe_token(garbage) is None

    def test_non_utf8_payload_returns_none(self):
        # A b64 blob that decodes to invalid UTF-8 must not raise.
        assert verify_unsubscribe_token("_____w.deadbeef") is None

    def test_token_from_another_category_is_rejected(self):
        token = make_unsubscribe_token("user_abc123", category="product_updates")
        assert verify_unsubscribe_token(token, category=CATEGORY_LIFECYCLE) is None

    def test_rotated_secret_invalidates_existing_tokens(self, monkeypatch):
        token = make_unsubscribe_token("user_abc123")
        tokens_module._unsub_secret.cache_clear()

        real_config = tokens_module.get_learnhouse_config()

        class _Rotated:
            security_config = type(
                "S", (), {"auth_jwt_secret_key": "a-completely-different-secret"}
            )()

            def __getattr__(self, name):
                return getattr(real_config, name)

        monkeypatch.setattr(tokens_module, "get_learnhouse_config", lambda: _Rotated())
        assert verify_unsubscribe_token(token) is None
