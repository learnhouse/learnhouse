"""Tests for src/services/communities/moderation.py."""

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.communities.communities import Community
from src.db.communities.discussions import Discussion
from src.db.users import User
from src.services.communities.moderation import (
    _parse_iso_datetime,
    check_content_moderation,
    content_has_link,
    enforce_auto_lock,
    enforce_posting_limits,
    extract_text_from_tiptap,
    parse_content_for_moderation,
    validate_comment_content,
    validate_content_for_community,
    validate_discussion_content,
)


def _make_community(db, org, **overrides):
    community = Community(
        id=overrides.pop("id", None),
        org_id=org.id,
        name=overrides.pop("name", "Community"),
        description=overrides.pop("description", "Desc"),
        public=overrides.pop("public", True),
        thumbnail_image=overrides.pop("thumbnail_image", ""),
        course_id=overrides.pop("course_id", None),
        community_uuid=overrides.pop("community_uuid", "community_moderation"),
        moderation_words=overrides.pop("moderation_words", []),
        creation_date=overrides.pop("creation_date", "2024-01-01"),
        update_date=overrides.pop("update_date", "2024-01-01"),
    )
    db.add(community)
    db.commit()
    db.refresh(community)
    return community


class TestCommunityModerationService:
    def test_extract_parse_and_match_helpers(self):
        doc = {
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "Hello"}]},
                {"type": "paragraph", "content": [{"type": "text", "text": "World"}]},
            ],
        }

        assert extract_text_from_tiptap(None) == ""
        assert extract_text_from_tiptap("plain") == "plain"
        assert extract_text_from_tiptap({"type": "text", "text": "leaf"}) == "leaf"
        assert extract_text_from_tiptap(doc) == "Hello World"

        assert parse_content_for_moderation("plain text") == "plain text"
        assert parse_content_for_moderation(json.dumps(doc)) == "Hello World"
        assert parse_content_for_moderation("{not-json}") == "{not-json}"
        assert parse_content_for_moderation(json.dumps({"type": "paragraph"})) == (
            '{"type": "paragraph"}'
        )

        assert check_content_moderation("", []) == (True, None)
        assert check_content_moderation("safe content", ["blocked"]) == (True, None)
        assert check_content_moderation("This has BANNED text", ["banned"]) == (
            False,
            "banned",
        )

    @pytest.mark.asyncio
    async def test_validate_content_branches_and_wrappers(self, db, org):
        open_community = _make_community(db, org, id=1, moderation_words=[])
        moderated_community = _make_community(
            db, org, id=2, community_uuid="community_blocked", moderation_words=["bad"]
        )
        json_content = json.dumps(
            {
                "type": "doc",
                "content": [
                    {"type": "paragraph", "content": [{"type": "text", "text": "bad"}]}
                ],
            }
        )

        await validate_content_for_community("anything", 999, db)
        await validate_content_for_community("clean", open_community.id, db)
        await validate_content_for_community(
            json.dumps({"type": "doc", "content": []}), moderated_community.id, db
        )

        with pytest.raises(HTTPException) as blocked_exc:
            await validate_content_for_community(
                json_content, moderated_community.id, db, content_type="reply"
            )

        assert blocked_exc.value.status_code == 400
        assert blocked_exc.value.detail["code"] == "MODERATION_BLOCKED"

        with patch(
            "src.services.communities.moderation.validate_content_for_community",
            new_callable=AsyncMock,
            return_value=None,
        ) as mocked_validate:
            await validate_discussion_content("Title", "Body", moderated_community.id, db)
            await validate_discussion_content("Title Only", "", moderated_community.id, db)
            await validate_comment_content("Comment body", moderated_community.id, db)

        assert mocked_validate.await_count == 4
        mocked_validate.assert_any_await(
            "Title", moderated_community.id, db, content_type="discussion title",
            block_links=False,
        )
        mocked_validate.assert_any_await(
            "Body", moderated_community.id, db, content_type="discussion",
            min_length=0, max_length=0, block_links=False,
        )
        mocked_validate.assert_any_await(
            "Title Only", moderated_community.id, db, content_type="discussion title",
            block_links=False,
        )
        mocked_validate.assert_any_await(
            "Comment body", moderated_community.id, db, content_type="reply",
            max_length=0, block_links=False,
        )


class TestContentHasLink:
    def test_empty_string_returns_false(self):
        assert content_has_link("") is False

    def test_none_like_falsy_returns_false(self):
        # Any falsy value handled by `if not text` guard
        assert content_has_link("   no link here   ") is False

    def test_http_url_detected(self):
        assert content_has_link("visit http://example.com today") is True

    def test_https_url_detected(self):
        assert content_has_link("see https://example.com/path?q=1") is True

    def test_www_url_detected(self):
        assert content_has_link("go to www.example.com for info") is True

    def test_plain_text_no_link(self):
        assert content_has_link("just some plain text without any URL") is False


class TestParseIsoDatetime:
    def test_valid_utc_iso_string(self):
        result = _parse_iso_datetime("2024-01-15T10:30:00+00:00")
        assert result is not None
        assert result.tzinfo is not None
        assert result.year == 2024

    def test_valid_z_suffix(self):
        result = _parse_iso_datetime("2024-06-01T00:00:00Z")
        assert result is not None
        assert result.tzinfo == timezone.utc

    def test_naive_datetime_gets_utc_attached(self):
        # No timezone info — should be assigned UTC
        result = _parse_iso_datetime("2024-03-20T12:00:00")
        assert result is not None
        assert result.tzinfo is not None

    def test_invalid_string_returns_none(self):
        assert _parse_iso_datetime("not-a-date") is None

    def test_none_returns_none(self):
        assert _parse_iso_datetime(None) is None

    def test_empty_string_returns_none(self):
        assert _parse_iso_datetime("") is None


class TestEnforcePostingLimits:
    def _make_community_with_settings(self, db, org, community_id, settings, uuid_suffix=""):
        community = Community(
            id=community_id,
            org_id=org.id,
            name="Limits Community",
            description="Desc",
            public=True,
            thumbnail_image="",
            course_id=None,
            community_uuid=f"community_limits_{uuid_suffix}",
            moderation_words=[],
            moderation_settings=settings,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(community)
        db.commit()
        db.refresh(community)
        return community

    def _make_user(self, db, user_id, email_verified=True, creation_date=None):
        if creation_date is None:
            creation_date = datetime.now(timezone.utc).isoformat()
        user = User(
            id=user_id,
            username=f"user_{user_id}",
            first_name="Test",
            last_name="User",
            email=f"user{user_id}@test.com",
            password="hashed",
            user_uuid=f"user_uuid_{user_id}",
            email_verified=email_verified,
            creation_date=creation_date,
            update_date=datetime.now(timezone.utc).isoformat(),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    def _make_discussion(self, db, org, community, author_id, discussion_id, creation_date=None):
        if creation_date is None:
            creation_date = datetime.now(timezone.utc).isoformat()
        discussion = Discussion(
            id=discussion_id,
            community_id=community.id,
            org_id=org.id,
            author_id=author_id,
            discussion_uuid=f"disc_{discussion_id}",
            title="Test Discussion",
            upvote_count=0,
            edit_count=0,
            is_pinned=False,
            is_locked=False,
            creation_date=creation_date,
            update_date=creation_date,
        )
        db.add(discussion)
        db.commit()
        db.refresh(discussion)
        return discussion

    @pytest.mark.asyncio
    async def test_no_community_returns_early(self, db):
        # Should not raise — community=None is a no-op
        await enforce_posting_limits(user_id=1, community=None, db_session=db)

    @pytest.mark.asyncio
    async def test_email_not_verified_raises_403(self, db, org):
        community = self._make_community_with_settings(
            db, org, community_id=10,
            settings={"require_email_verified": True},
            uuid_suffix="email_check",
        )
        user = self._make_user(db, user_id=10, email_verified=False)

        with pytest.raises(HTTPException) as exc_info:
            await enforce_posting_limits(
                user_id=user.id, community=community, db_session=db
            )

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail["code"] == "MODERATION_EMAIL_UNVERIFIED"

    @pytest.mark.asyncio
    async def test_account_too_new_raises_403(self, db, org):
        community = self._make_community_with_settings(
            db, org, community_id=11,
            settings={"min_account_age_days": 30},
            uuid_suffix="acct_age",
        )
        # Account created 1 day ago — younger than 30-day requirement
        recent_creation = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        user = self._make_user(db, user_id=11, email_verified=True, creation_date=recent_creation)

        with pytest.raises(HTTPException) as exc_info:
            await enforce_posting_limits(
                user_id=user.id, community=community, db_session=db
            )

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail["code"] == "MODERATION_ACCOUNT_TOO_NEW"

    @pytest.mark.asyncio
    async def test_slow_mode_raises_429(self, db, org):
        community = self._make_community_with_settings(
            db, org, community_id=12,
            settings={"slow_mode_seconds": 3600},
            uuid_suffix="slow_mode",
        )
        user = self._make_user(db, user_id=12, email_verified=True)
        # Insert a discussion posted 10 seconds ago
        recent_creation = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat()
        self._make_discussion(
            db, org, community, author_id=user.id,
            discussion_id=100, creation_date=recent_creation,
        )

        with pytest.raises(HTTPException) as exc_info:
            await enforce_posting_limits(
                user_id=user.id, community=community, db_session=db
            )

        assert exc_info.value.status_code == 429
        assert exc_info.value.detail["code"] == "MODERATION_SLOW_MODE"

    @pytest.mark.asyncio
    async def test_max_posts_per_day_raises_429(self, db, org):
        community = self._make_community_with_settings(
            db, org, community_id=13,
            settings={"max_posts_per_day": 2},
            uuid_suffix="daily_limit",
        )
        user = self._make_user(db, user_id=13, email_verified=True)
        # Insert 2 discussions within the past 24 hours (at the limit)
        for i in range(2):
            creation = (datetime.now(timezone.utc) - timedelta(hours=i + 1)).isoformat()
            self._make_discussion(
                db, org, community, author_id=user.id,
                discussion_id=200 + i, creation_date=creation,
            )

        with pytest.raises(HTTPException) as exc_info:
            await enforce_posting_limits(
                user_id=user.id, community=community, db_session=db
            )

        assert exc_info.value.status_code == 429
        assert exc_info.value.detail["code"] == "MODERATION_DAILY_LIMIT"

    @pytest.mark.asyncio
    async def test_discussion_with_invalid_date_skipped_in_max_posts_count(self, db, org):
        # Line 119: if created is None: continue
        community = self._make_community_with_settings(
            db, org, community_id=50,
            settings={"max_posts_per_day": 1},
            uuid_suffix="nulldate",
        )
        # Create a discussion with un-parseable date - it should be skipped (not counted)
        disc = Discussion(
            title="Old post",
            content="content",
            label="general",
            community_id=community.id,
            org_id=org.id,
            author_id=1,
            discussion_uuid="disc_nulldate",
            creation_date="",  # empty, unparseable
            update_date="",
        )
        db.add(disc)
        db.commit()
        # Should NOT raise since the discussion with empty date is skipped
        await enforce_posting_limits(1, community, db)


class TestEnforceAutoLock:
    @pytest.mark.asyncio
    async def test_inactive_discussion_gets_locked(self, db, org):
        community = Community(
            id=20,
            org_id=org.id,
            name="AutoLock Community",
            description="Desc",
            public=True,
            thumbnail_image="",
            course_id=None,
            community_uuid="community_autolock",
            moderation_words=[],
            moderation_settings={"auto_lock_days": 7},
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(community)
        db.commit()
        db.refresh(community)

        # Create a user to satisfy the author_id FK
        author = User(
            id=20,
            username="autolock_author",
            first_name="Auto",
            last_name="Lock",
            email="autolock@test.com",
            password="hashed",
            user_uuid="user_autolock",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(author)
        db.commit()

        # Discussion last updated 10 days ago — older than the 7-day threshold
        old_date = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
        discussion = Discussion(
            id=300,
            community_id=community.id,
            org_id=org.id,
            author_id=author.id,
            discussion_uuid="disc_autolock",
            title="Old Discussion",
            upvote_count=0,
            edit_count=0,
            is_pinned=False,
            is_locked=False,
            creation_date=old_date,
            update_date=old_date,
        )
        db.add(discussion)
        db.commit()
        db.refresh(discussion)

        assert discussion.is_locked is False

        await enforce_auto_lock(discussion=discussion, community=community, db_session=db)

        assert discussion.is_locked is True

    @pytest.mark.asyncio
    async def test_enforce_auto_lock_skips_when_no_parseable_date(self, db, org):
        # Line 149: if reference is None: return
        community = Community(
            id=51,
            org_id=org.id,
            name="AutoLock NoDate Community",
            description="Desc",
            public=True,
            thumbnail_image="",
            course_id=None,
            community_uuid="community_autolock_nodate",
            moderation_words=[],
            moderation_settings={"auto_lock_days": 1},
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(community)
        db.commit()
        db.refresh(community)

        disc = Discussion(
            title="Test",
            content="content",
            label="general",
            community_id=community.id,
            org_id=org.id,
            author_id=1,
            discussion_uuid="disc_nodate",
            creation_date="",  # empty, unparseable
            update_date="",
            is_locked=False,
        )
        db.add(disc)
        db.commit()
        db.refresh(disc)

        await enforce_auto_lock(disc, community, db)
        db.refresh(disc)
        assert disc.is_locked is False  # Should NOT be locked since date is unparseable


class TestExtractTextEdgeCases:
    def test_non_dict_non_str_node_returns_empty(self):
        # An integer node is not a dict and not a str — hits `return ""`
        assert extract_text_from_tiptap(123) == ""

    def test_list_node_returns_empty(self):
        # A plain list is not a dict and not a str — hits `return ""`
        assert extract_text_from_tiptap([1, 2, 3]) == ""


class TestParseContentEdgeCases:
    def test_empty_string_returns_empty(self):
        # `if not content: return ""` branch (line 185)
        assert parse_content_for_moderation("") == ""


class TestCheckContentModerationEdgeCases:
    def test_empty_word_in_list_is_skipped(self):
        # The `if not word: continue` guard ensures empty strings are skipped
        # and the non-empty "bad" word still triggers a block.
        is_clean, matched = check_content_moderation("bad content", ["", "bad"])
        assert is_clean is False
        assert matched == "bad"

    def test_only_empty_words_passes(self):
        # If every word entry is empty, none match and content is clean.
        is_clean, matched = check_content_moderation("anything goes", ["", ""])
        assert is_clean is True
        assert matched is None


class TestValidateContentLengthAndLinks:
    def _make_community(self, db, org, community_id, uuid_suffix=""):
        community = Community(
            id=community_id,
            org_id=org.id,
            name="Validation Community",
            description="Desc",
            public=True,
            thumbnail_image="",
            course_id=None,
            community_uuid=f"community_validation_{uuid_suffix}",
            moderation_words=[],
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(community)
        db.commit()
        db.refresh(community)
        return community

    @pytest.mark.asyncio
    async def test_content_below_min_length_raises(self, db, org):
        community = self._make_community(db, org, community_id=30, uuid_suffix="minlen")

        with pytest.raises(HTTPException) as exc_info:
            await validate_content_for_community(
                "Hi",
                community.id,
                db,
                content_type="discussion",
                min_length=10,
            )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["code"] == "MODERATION_TOO_SHORT"

    @pytest.mark.asyncio
    async def test_content_above_max_length_raises(self, db, org):
        community = self._make_community(db, org, community_id=31, uuid_suffix="maxlen")
        long_content = "x" * 200

        with pytest.raises(HTTPException) as exc_info:
            await validate_content_for_community(
                long_content,
                community.id,
                db,
                content_type="discussion",
                max_length=100,
            )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["code"] == "MODERATION_TOO_LONG"

    @pytest.mark.asyncio
    async def test_block_links_raises_when_link_present(self, db, org):
        community = self._make_community(db, org, community_id=32, uuid_suffix="blocklinks")

        with pytest.raises(HTTPException) as exc_info:
            await validate_content_for_community(
                "Check out https://example.com for details",
                community.id,
                db,
                content_type="reply",
                block_links=True,
            )

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["code"] == "MODERATION_LINKS_BLOCKED"
