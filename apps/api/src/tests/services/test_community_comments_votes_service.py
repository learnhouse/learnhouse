"""Tests for community comment and vote services."""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.communities.communities import Community
from src.db.communities.discussion_comments import DiscussionComment, DiscussionCommentUpdate
from src.db.communities.discussions import Discussion
from src.services.communities.comment_votes import (
    get_user_votes_for_comments,
    remove_comment_upvote,
    upvote_comment,
)
from src.services.communities.comments import (
    create_comment,
    delete_comment,
    get_comment_count,
    get_comments_by_discussion,
    update_comment,
)
from src.services.communities.votes import (
    get_user_votes_for_discussions,
    remove_upvote,
    upvote_discussion,
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
        community_uuid=overrides.pop("community_uuid", "community_comments"),
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
        discussion_uuid=overrides.pop("discussion_uuid", "discussion_comments"),
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


def _make_comment(db, discussion, author_id, **overrides):
    comment = DiscussionComment(
        id=overrides.pop("id", None),
        discussion_id=discussion.id,
        author_id=author_id,
        content=overrides.pop("content", "Comment"),
        comment_uuid=overrides.pop("comment_uuid", "comment_test"),
        upvote_count=overrides.pop("upvote_count", 0),
        creation_date=overrides.pop("creation_date", "2024-01-01"),
        update_date=overrides.pop("update_date", "2024-01-01"),
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment


class TestCommunityCommentsAndVotes:
    @pytest.mark.asyncio
    async def test_create_get_update_and_count_comments(
        self, db, org, admin_user, regular_user, mock_request
    ):
        community = _make_community(db, org)
        discussion = _make_discussion(
            db, community, org, author_id=admin_user.id, discussion_uuid="discussion_a"
        )

        with patch(
            "src.services.communities.comments.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.comments.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.comments.validate_comment_content",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.comments.dispatch_webhooks",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.comments.get_user_votes_for_comments",
            new_callable=AsyncMock,
            return_value={},
        ):
            created = await create_comment(
                mock_request,
                discussion.discussion_uuid,
                "First comment",
                regular_user,
                db,
            )
            comments = await get_comments_by_discussion(
                mock_request,
                discussion.discussion_uuid,
                regular_user,
                db,
            )
            updated = await update_comment(
                mock_request,
                created.comment_uuid,
                DiscussionCommentUpdate(content="Edited comment"),
                regular_user,
                db,
            )

        assert created.content == "First comment"
        assert comments[0].author.username == regular_user.username
        assert updated.content == "Edited comment"
        assert await get_comment_count(discussion.discussion_uuid, db) == 1
        assert await get_comment_count("missing", db) == 0

    @pytest.mark.asyncio
    async def test_comment_error_and_delete_paths(
        self, db, org, admin_user, regular_user, mock_request
    ):
        community = _make_community(db, org, community_uuid="community_delete")
        locked_discussion = _make_discussion(
            db,
            community,
            org,
            author_id=admin_user.id,
            discussion_uuid="discussion_locked",
            is_locked=True,
        )
        discussion = _make_discussion(
            db,
            community,
            org,
            id=11,
            author_id=admin_user.id,
            discussion_uuid="discussion_delete",
        )
        comment = _make_comment(
            db,
            discussion,
            author_id=regular_user.id,
            comment_uuid="comment_delete",
        )

        with patch(
            "src.services.communities.comments.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.comments.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.comments.validate_comment_content",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.comments.get_user_votes_for_comments",
            new_callable=AsyncMock,
            return_value={comment.id: False},
        ):
            with pytest.raises(HTTPException) as locked_exc:
                await create_comment(
                    mock_request,
                    locked_discussion.discussion_uuid,
                    "Nope",
                    regular_user,
                    db,
                )

            with pytest.raises(HTTPException) as forbidden_update_exc:
                await update_comment(
                    mock_request,
                    comment.comment_uuid,
                    DiscussionCommentUpdate(content="Hijack"),
                    admin_user,
                    db,
                )

            with patch(
                "src.services.communities.comments.check_resource_access",
                new_callable=AsyncMock,
                side_effect=HTTPException(status_code=403, detail="forbidden"),
            ):
                with pytest.raises(HTTPException) as forbidden_delete_exc:
                    await delete_comment(
                        mock_request, comment.comment_uuid, admin_user, db
                    )

            deleted = await delete_comment(
                mock_request, comment.comment_uuid, regular_user, db
            )

        assert locked_exc.value.status_code == 403
        assert forbidden_update_exc.value.status_code == 403
        assert forbidden_delete_exc.value.status_code == 403
        assert deleted == {"detail": "Comment deleted"}

    @pytest.mark.asyncio
    async def test_discussion_votes(self, db, org, admin_user, regular_user, mock_request):
        community = _make_community(db, org, community_uuid="community_votes")
        discussion = _make_discussion(
            db, community, org, author_id=admin_user.id, discussion_uuid="discussion_votes"
        )

        with patch(
            "src.services.communities.votes.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.votes.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.votes.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            vote = await upvote_discussion(
                mock_request, discussion.discussion_uuid, regular_user, db
            )
            voted = await get_user_votes_for_discussions(
                mock_request, [discussion.discussion_uuid, "missing"], regular_user, db
            )
            removed = await remove_upvote(
                mock_request, discussion.discussion_uuid, regular_user, db
            )

            with pytest.raises(HTTPException) as duplicate_exc:
                await remove_upvote(
                    mock_request, discussion.discussion_uuid, regular_user, db
                )

        assert vote.user_id == regular_user.id
        assert voted == {discussion.discussion_uuid: True, "missing": False}
        assert removed == {"detail": "Upvote removed"}
        assert duplicate_exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_comment_votes(self, db, org, admin_user, regular_user, mock_request):
        community = _make_community(db, org, community_uuid="community_comment_votes")
        discussion = _make_discussion(
            db,
            community,
            org,
            author_id=admin_user.id,
            discussion_uuid="discussion_comment_votes",
        )
        comment = _make_comment(
            db, discussion, author_id=admin_user.id, comment_uuid="comment_votes"
        )

        with patch(
            "src.services.communities.comment_votes.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.comment_votes.check_resource_access",
            new_callable=AsyncMock,
        ):
            vote = await upvote_comment(
                mock_request, comment.comment_uuid, regular_user, db
            )
            user_votes = await get_user_votes_for_comments(
                [comment.id, 999], regular_user.id, db
            )
            removed = await remove_comment_upvote(
                mock_request, comment.comment_uuid, regular_user, db
            )

            with pytest.raises(HTTPException) as duplicate_exc:
                await remove_comment_upvote(
                    mock_request, comment.comment_uuid, regular_user, db
                )

        assert vote.user_id == regular_user.id
        assert user_votes == {comment.id: True, 999: False}
        assert removed == {"detail": "Upvote removed"}
        assert duplicate_exc.value.status_code == 400
