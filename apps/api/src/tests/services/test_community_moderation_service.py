"""Tests for src/services/communities/moderation.py."""

import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.communities.communities import Community
from src.services.communities.moderation import (
    check_content_moderation,
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
            "Title", moderated_community.id, db, content_type="discussion title"
        )
        mocked_validate.assert_any_await(
            "Body", moderated_community.id, db, content_type="discussion"
        )
        mocked_validate.assert_any_await(
            "Title Only", moderated_community.id, db, content_type="discussion title"
        )
        mocked_validate.assert_any_await(
            "Comment body", moderated_community.id, db, content_type="reply"
        )
