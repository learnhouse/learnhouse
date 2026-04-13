"""Tests for src/services/communities/reactions.py."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.communities.communities import Community
from src.db.communities.discussion_reactions import DiscussionReaction
from src.db.communities.discussions import Discussion
from src.services.communities.reactions import get_reactions, toggle_reaction


def _make_community(db, org, **overrides):
    community = Community(
        id=overrides.pop("id", None),
        org_id=org.id,
        name=overrides.pop("name", "Community"),
        description=overrides.pop("description", "Desc"),
        public=overrides.pop("public", True),
        thumbnail_image=overrides.pop("thumbnail_image", ""),
        course_id=overrides.pop("course_id", None),
        community_uuid=overrides.pop("community_uuid", "community_reactions"),
        moderation_words=overrides.pop("moderation_words", []),
        creation_date=overrides.pop("creation_date", "2024-01-01"),
        update_date=overrides.pop("update_date", "2024-01-01"),
    )
    db.add(community)
    db.commit()
    db.refresh(community)
    return community


def _make_discussion(db, community, org, author_id, **overrides):
    discussion = Discussion(
        id=overrides.pop("id", None),
        title=overrides.pop("title", "Title"),
        content=overrides.pop("content", "Content"),
        label=overrides.pop("label", "general"),
        emoji=overrides.pop("emoji", None),
        community_id=community.id,
        org_id=org.id,
        author_id=author_id,
        discussion_uuid=overrides.pop("discussion_uuid", "discussion_reactions"),
        upvote_count=overrides.pop("upvote_count", 0),
        edit_count=overrides.pop("edit_count", 0),
        is_pinned=overrides.pop("is_pinned", False),
        is_locked=overrides.pop("is_locked", False),
        creation_date=overrides.pop("creation_date", "2024-01-01T00:00:00+00:00"),
        update_date=overrides.pop("update_date", "2024-01-01T00:00:00+00:00"),
    )
    db.add(discussion)
    db.commit()
    db.refresh(discussion)
    return discussion


class TestCommunityReactionsService:
    @pytest.mark.asyncio
    async def test_get_reactions_groups_users_and_sorts(
        self, db, org, admin_user, regular_user, anonymous_user, mock_request
    ):
        community = _make_community(db, org)
        discussion = _make_discussion(
            db, community, org, author_id=admin_user.id, discussion_uuid="discussion_a"
        )

        db.add(
            DiscussionReaction(
                discussion_id=discussion.id,
                user_id=admin_user.id,
                emoji="👍",
                reaction_uuid="reaction_admin_thumb",
                creation_date=str(datetime.now()),
            )
        )
        db.add(
            DiscussionReaction(
                discussion_id=discussion.id,
                user_id=regular_user.id,
                emoji="👍",
                reaction_uuid="reaction_regular_thumb",
                creation_date=str(datetime.now()),
            )
        )
        db.add(
            DiscussionReaction(
                discussion_id=discussion.id,
                user_id=admin_user.id,
                emoji="❤️",
                reaction_uuid="reaction_admin_heart",
                creation_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.services.communities.reactions.check_resource_access",
            new_callable=AsyncMock,
        ):
            summaries = await get_reactions(
                mock_request, discussion.discussion_uuid, regular_user, db
            )
            anon_summaries = await get_reactions(
                mock_request, discussion.discussion_uuid, anonymous_user, db
            )

        assert [summary.emoji for summary in summaries] == ["👍", "❤️"]
        assert summaries[0].count == 2
        assert {user.username for user in summaries[0].users} == {"admin", "regular"}
        assert summaries[0].has_reacted is True
        assert summaries[1].count == 1
        assert summaries[1].has_reacted is False
        assert anon_summaries[0].has_reacted is False

    @pytest.mark.asyncio
    async def test_get_reactions_missing_records(self, db, org, admin_user, mock_request):
        community = _make_community(db, org)
        _make_discussion(
            db, community, org, author_id=admin_user.id, discussion_uuid="discussion_b"
        )
        orphan_discussion = Discussion(
            id=999,
            title="Orphan",
            content="Content",
            label="general",
            emoji=None,
            community_id=9999,
            org_id=org.id,
            author_id=admin_user.id,
            discussion_uuid="discussion_orphan",
            upvote_count=0,
            edit_count=0,
            is_pinned=False,
            is_locked=False,
            creation_date="2024-01-01T00:00:00+00:00",
            update_date="2024-01-01T00:00:00+00:00",
        )
        db.add(orphan_discussion)
        db.commit()

        with patch(
            "src.services.communities.reactions.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as missing_discussion_exc:
                await get_reactions(mock_request, "missing", admin_user, db)

            with pytest.raises(HTTPException) as missing_community_exc:
                await get_reactions(
                    mock_request, orphan_discussion.discussion_uuid, admin_user, db
                )

        assert missing_discussion_exc.value.status_code == 404
        assert missing_community_exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_toggle_reaction_add_remove_and_auth_guard(
        self, db, org, admin_user, regular_user, anonymous_user, mock_request
    ):
        community = _make_community(db, org)
        discussion = _make_discussion(
            db, community, org, author_id=admin_user.id, discussion_uuid="discussion_c"
        )

        with patch(
            "src.services.communities.reactions.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.reactions.check_resource_access",
            new_callable=AsyncMock,
        ):
            added = await toggle_reaction(
                mock_request, discussion.discussion_uuid, "🔥", regular_user, db
            )
            removed = await toggle_reaction(
                mock_request, discussion.discussion_uuid, "🔥", regular_user, db
            )

        reaction_count = db.exec(
            DiscussionReaction.__table__.select()
        ).all()  # type: ignore[attr-defined]

        assert added == {"action": "added", "emoji": "🔥"}
        assert removed == {"action": "removed", "emoji": "🔥"}
        assert reaction_count == []

        with patch(
            "src.services.communities.reactions.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=401, detail="Authentication required"),
        ), patch(
            "src.services.communities.reactions.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as anon_exc:
                await toggle_reaction(
                    mock_request,
                    discussion.discussion_uuid,
                    "🔥",
                    anonymous_user,
                    db,
                )

        assert anon_exc.value.status_code == 401
