"""Tests for community comment and vote services."""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from src.db.communities.communities import Community
from src.db.communities.discussion_comments import DiscussionComment, DiscussionCommentUpdate
from src.db.communities.discussions import Discussion
from src.db.communities.discussion_comment_votes import DiscussionCommentVote
from src.db.communities.discussion_votes import DiscussionVote
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


async def _make_community(db, org, **overrides):
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
    await db.commit()
    await db.refresh(community)
    return community


async def _make_discussion(db, community, org, author_id, **overrides):
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
    await db.commit()
    await db.refresh(discussion)
    return discussion


async def _make_comment(db, discussion, author_id, **overrides):
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
    await db.commit()
    await db.refresh(comment)
    return comment


class TestCommunityCommentsAndVotes:
    @pytest.mark.asyncio
    async def test_create_get_update_and_count_comments(
        self, db, org, admin_user, regular_user, mock_request
    ):
        community = await _make_community(db, org)
        discussion = await _make_discussion(
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
        # get_comment_count now enforces community read access; mock it for the
        # count assertions. A missing discussion raises 404 (was: returned 0).
        with patch(
            "src.services.communities.comments.check_resource_access",
            new_callable=AsyncMock,
        ):
            assert await get_comment_count(
                mock_request, discussion.discussion_uuid, regular_user, db
            ) == 1
            with pytest.raises(HTTPException) as missing_exc:
                await get_comment_count(mock_request, "missing", regular_user, db)
            assert missing_exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_comment_error_and_delete_paths(
        self, db, org, admin_user, regular_user, mock_request
    ):
        community = await _make_community(db, org, community_uuid="community_delete")
        locked_discussion = await _make_discussion(
            db,
            community,
            org,
            author_id=admin_user.id,
            discussion_uuid="discussion_locked",
            is_locked=True,
        )
        discussion = await _make_discussion(
            db,
            community,
            org,
            id=11,
            author_id=admin_user.id,
            discussion_uuid="discussion_delete",
        )
        comment = await _make_comment(
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
        community = await _make_community(db, org, community_uuid="community_votes")
        discussion = await _make_discussion(
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
    async def test_comment_vote_error_branches(
        self, db, org, admin_user, regular_user, mock_request
    ):
        community = await _make_community(db, org, community_uuid="community_error_paths")
        discussion = await _make_discussion(
            db,
            community,
            org,
            author_id=admin_user.id,
            discussion_uuid="discussion_error_paths",
        )
        comment = await _make_comment(
            db,
            discussion,
            author_id=admin_user.id,
            comment_uuid="comment_error_paths",
            upvote_count=1,
        )
        orphan_discussion = Discussion(
            id=99,
            title="Orphan",
            content="Body",
            label="general",
            emoji=None,
            community_id=999,
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
        await db.commit()

        orphan_comment = DiscussionComment(
            id=999,
            discussion_id=9999,
            author_id=admin_user.id,
            content="Orphan comment",
            comment_uuid="comment_orphan",
            upvote_count=0,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(orphan_comment)
        await db.commit()

        discussion.community_id = 9999
        db.add(discussion)
        await db.commit()

        with patch(
            "src.services.communities.comment_votes.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.comment_votes.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as missing_comment_exc:
                await upvote_comment(mock_request, "missing_comment", regular_user, db)
            with pytest.raises(HTTPException) as missing_discussion_exc:
                await upvote_comment(
                    mock_request, orphan_comment.comment_uuid, regular_user, db
                )
            with pytest.raises(HTTPException) as missing_community_exc:
                await upvote_comment(mock_request, comment.comment_uuid, regular_user, db)

        assert missing_comment_exc.value.status_code == 404
        assert missing_discussion_exc.value.status_code == 404
        assert missing_community_exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_comment_vote_duplicate_and_lookup_paths(
        self, db, org, admin_user, regular_user, mock_request
    ):
        community = await _make_community(db, org, community_uuid="community_vote_lookup")
        discussion = await _make_discussion(
            db,
            community,
            org,
            author_id=admin_user.id,
            discussion_uuid="discussion_vote_lookup",
        )
        comment = await _make_comment(
            db,
            discussion,
            author_id=admin_user.id,
            comment_uuid="comment_vote_lookup",
            upvote_count=1,
        )

        with patch(
            "src.services.communities.comment_votes.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.comment_votes.check_resource_access",
            new_callable=AsyncMock,
        ):
            comment_vote = DiscussionCommentVote(
                comment_id=comment.id,
                user_id=regular_user.id,
                vote_uuid="vote_existing",
                creation_date="2024-01-01",
            )
            db.add(comment_vote)
            await db.commit()
            with pytest.raises(HTTPException) as duplicate_comment_vote_exc:
                await upvote_comment(
                    mock_request, comment.comment_uuid, regular_user, db
                )

            with pytest.raises(HTTPException) as missing_remove_comment_exc:
                await remove_comment_upvote(
                    mock_request, "missing_comment", regular_user, db
                )
            await db.delete(comment_vote)
            await db.commit()
            with pytest.raises(HTTPException) as missing_remove_vote_exc:
                await remove_comment_upvote(
                    mock_request, comment.comment_uuid, regular_user, db
                )

        anonymous_votes = await get_user_votes_for_comments([comment.id, 123], 0, db)
        known_votes = await get_user_votes_for_comments(
            [comment.id, 123], regular_user.id, db
        )

        assert duplicate_comment_vote_exc.value.status_code == 400
        assert missing_remove_comment_exc.value.status_code == 404
        assert missing_remove_vote_exc.value.status_code == 400
        assert anonymous_votes == {comment.id: False, 123: False}
        assert known_votes[comment.id] is False

    @pytest.mark.asyncio
    async def test_discussion_vote_error_branches_and_lookup_paths(
        self, db, org, admin_user, regular_user, mock_request
    ):
        community = await _make_community(db, org, community_uuid="community_discussion_votes")
        discussion = await _make_discussion(
            db,
            community,
            org,
            author_id=admin_user.id,
            discussion_uuid="discussion_votes_error_paths",
        )
        orphan_discussion = Discussion(
            id=99,
            title="Orphan",
            content="Body",
            label="general",
            emoji=None,
            community_id=999,
            org_id=org.id,
            author_id=admin_user.id,
            discussion_uuid="discussion_orphan_vote",
            upvote_count=0,
            edit_count=0,
            is_pinned=False,
            is_locked=False,
            creation_date="2024-01-01T00:00:00+00:00",
            update_date="2024-01-01T00:00:00+00:00",
        )
        db.add(orphan_discussion)
        await db.commit()

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
            with pytest.raises(HTTPException) as missing_discussion_vote_exc:
                await upvote_discussion(
                    mock_request, "missing_discussion", regular_user, db
                )
            with pytest.raises(HTTPException) as missing_community_vote_exc:
                await upvote_discussion(
                    mock_request, orphan_discussion.discussion_uuid, regular_user, db
                )

            discussion_vote = DiscussionVote(
                discussion_id=discussion.id,
                user_id=regular_user.id,
                vote_uuid="discussion_vote_existing",
                creation_date="2024-01-01",
            )
            db.add(discussion_vote)
            await db.commit()
            with pytest.raises(HTTPException) as duplicate_vote_exc:
                await upvote_discussion(
                    mock_request, discussion.discussion_uuid, regular_user, db
                )

            with pytest.raises(HTTPException) as missing_remove_discussion_exc:
                await remove_upvote(
                    mock_request, "missing_discussion", regular_user, db
                )
            await db.delete(discussion_vote)
            await db.commit()
            with pytest.raises(HTTPException) as missing_remove_vote_exc:
                await remove_upvote(
                    mock_request, discussion.discussion_uuid, regular_user, db
                )

        anonymous_discussion_votes = await get_user_votes_for_discussions(
            mock_request, [discussion.discussion_uuid, "missing"], regular_user.model_copy(update={"id": 0}), db
        )
        known_discussion_votes = await get_user_votes_for_discussions(
            mock_request, [discussion.discussion_uuid, "missing"], regular_user, db
        )

        assert missing_discussion_vote_exc.value.status_code == 404
        assert missing_community_vote_exc.value.status_code == 404
        assert duplicate_vote_exc.value.status_code == 400
        assert missing_remove_discussion_exc.value.status_code == 404
        assert missing_remove_vote_exc.value.status_code == 400
        assert anonymous_discussion_votes == {
            discussion.discussion_uuid: False,
            "missing": False,
        }
        assert known_discussion_votes[discussion.discussion_uuid] is False

    @pytest.mark.asyncio
    async def test_upvote_discussion_integrity_error_race_rolls_back_and_400(
        self, db, org, admin_user, regular_user, mock_request
    ):
        """Covers lines 81-86: if the INSERT+UPDATE commit hits an
        IntegrityError (concurrent duplicate vote race), the service rolls back
        and raises HTTPException 400 instead of leaking a 500."""
        community = await _make_community(db, org, community_uuid="community_race")
        discussion = await _make_discussion(
            db,
            community,
            org,
            author_id=admin_user.id,
            discussion_uuid="discussion_race",
        )

        original_rollback = db.rollback
        rollback_calls = []

        async def failing_commit(*args, **kwargs):
            raise IntegrityError("INSERT", {}, Exception("duplicate key"))

        async def tracking_rollback(*args, **kwargs):
            rollback_calls.append(True)
            return await original_rollback(*args, **kwargs)

        with patch(
            "src.services.communities.votes.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.votes.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.votes.dispatch_webhooks",
            new_callable=AsyncMock,
        ), patch.object(
            db, "commit", side_effect=failing_commit
        ), patch.object(
            db, "rollback", side_effect=tracking_rollback
        ):
            with pytest.raises(HTTPException) as exc:
                await upvote_discussion(
                    mock_request, discussion.discussion_uuid, regular_user, db
                )

        assert exc.value.status_code == 400
        assert "already upvoted" in exc.value.detail
        # safety-net rolled the failed transaction back
        assert rollback_calls, "expected db_session.rollback() to be called"

    @pytest.mark.asyncio
    async def test_upvote_comment_integrity_error_race_rolls_back_and_400(
        self, db, org, admin_user, regular_user, mock_request
    ):
        """Covers comment_votes lines 99,102,103: if the INSERT+UPDATE commit
        hits an IntegrityError (concurrent duplicate vote race), the service
        rolls back and raises HTTPException 400 instead of leaking a 500."""
        community = await _make_community(db, org, community_uuid="community_comment_race")
        discussion = await _make_discussion(
            db,
            community,
            org,
            author_id=admin_user.id,
            discussion_uuid="discussion_comment_race",
        )
        comment = await _make_comment(
            db, discussion, author_id=admin_user.id, comment_uuid="comment_race"
        )

        original_rollback = db.rollback
        rollback_calls = []

        async def failing_commit(*args, **kwargs):
            raise IntegrityError("INSERT", {}, Exception("duplicate key"))

        async def tracking_rollback(*args, **kwargs):
            rollback_calls.append(True)
            return await original_rollback(*args, **kwargs)

        with patch(
            "src.services.communities.comment_votes.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.comment_votes.check_resource_access",
            new_callable=AsyncMock,
        ), patch.object(
            db, "commit", side_effect=failing_commit
        ), patch.object(
            db, "rollback", side_effect=tracking_rollback
        ):
            with pytest.raises(HTTPException) as exc:
                await upvote_comment(
                    mock_request, comment.comment_uuid, regular_user, db
                )

        assert exc.value.status_code == 400
        assert "already upvoted" in exc.value.detail
        # safety-net rolled the failed transaction back
        assert rollback_calls, "expected db_session.rollback() to be called"

    @pytest.mark.asyncio
    async def test_get_comment_count_missing_community_raises_404(
        self, db, org, admin_user, regular_user, mock_request
    ):
        """Covers comments line 340: get_comment_count on a discussion whose
        parent community no longer exists raises 404 (Community not found)."""
        community = await _make_community(
            db, org, community_uuid="community_count_orphan"
        )
        discussion = await _make_discussion(
            db,
            community,
            org,
            author_id=admin_user.id,
            discussion_uuid="discussion_count_orphan",
        )
        # Point the discussion at a non-existent community so the community
        # lookup in get_comment_count returns None.
        discussion.community_id = 987654
        db.add(discussion)
        await db.commit()

        with patch(
            "src.services.communities.comments.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await get_comment_count(
                    mock_request, discussion.discussion_uuid, regular_user, db
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Community not found"

    @pytest.mark.asyncio
    async def test_comment_creation_and_delete_error_branches(
        self, db, org, admin_user, regular_user, mock_request
    ):
        community = await _make_community(db, org, community_uuid="community_comment_errors")
        discussion = await _make_discussion(
            db,
            community,
            org,
            author_id=admin_user.id,
            discussion_uuid="discussion_comment_errors",
        )
        comment = await _make_comment(
            db,
            discussion,
            author_id=admin_user.id,
            comment_uuid="comment_comment_errors",
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
            return_value={comment.id: False},
        ):
            with pytest.raises(HTTPException) as missing_discussion_comment_exc:
                await create_comment(
                    mock_request, "missing_discussion", "Hi", regular_user, db
                )
            locked = Discussion(
                id=199,
                title="Locked",
                content="Body",
                label="general",
                emoji=None,
                community_id=community.id,
                org_id=org.id,
                author_id=admin_user.id,
                discussion_uuid="discussion_locked_error",
                upvote_count=0,
                edit_count=0,
                is_pinned=False,
                is_locked=True,
                creation_date="2024-01-01T00:00:00+00:00",
                update_date="2024-01-01T00:00:00+00:00",
            )
            db.add(locked)
            await db.commit()
            with pytest.raises(HTTPException) as locked_comment_exc:
                await create_comment(
                    mock_request, locked.discussion_uuid, "Hi", regular_user, db
                )

            missing_community_discussion = await _make_discussion(
                db,
                community,
                org,
                author_id=admin_user.id,
                discussion_uuid="discussion_missing_community_comments",
            )
            missing_community_discussion.community_id = 9999
            db.add(missing_community_discussion)
            await db.commit()
            temp_comment_delete = await _make_comment(
                db,
                missing_community_discussion,
                author_id=admin_user.id,
                comment_uuid="comment_missing_community_delete",
            )
            with pytest.raises(HTTPException) as missing_community_comment_exc:
                await create_comment(
                    mock_request,
                    missing_community_discussion.discussion_uuid,
                    "Hi",
                    regular_user,
                    db,
                )

            with pytest.raises(HTTPException) as missing_get_comments_discussion_exc:
                await get_comments_by_discussion(
                    mock_request, "missing_discussion", regular_user, db
                )
            with pytest.raises(HTTPException) as missing_get_comments_community_exc:
                await get_comments_by_discussion(
                    mock_request,
                    missing_community_discussion.discussion_uuid,
                    regular_user,
                    db,
                )

            with pytest.raises(HTTPException) as missing_update_comment_exc:
                await update_comment(
                    mock_request,
                    "missing_comment",
                    DiscussionCommentUpdate(content="Nope"),
                    regular_user,
                    db,
                )
            with pytest.raises(HTTPException) as missing_delete_comment_exc:
                await delete_comment(
                    mock_request, "missing_comment", regular_user, db
                )
            with pytest.raises(HTTPException) as missing_community_delete_exc:
                await delete_comment(
                    mock_request, temp_comment_delete.comment_uuid, regular_user, db
                )

            with patch(
                "src.services.communities.comments.check_resource_access",
                new_callable=AsyncMock,
                side_effect=HTTPException(status_code=403, detail="forbidden"),
            ):
                with pytest.raises(HTTPException) as forbidden_delete_discussion_exc:
                    await delete_comment(
                        mock_request, comment.comment_uuid, regular_user, db
                    )

            orphan_delete_comment = DiscussionComment(
                id=3001,
                discussion_id=123456789,
                author_id=admin_user.id,
                content="Delete me",
                comment_uuid="comment_orphan_delete",
                upvote_count=0,
                creation_date="2024-01-01",
                update_date="2024-01-01",
            )
            db.add(orphan_delete_comment)
            await db.commit()
            with pytest.raises(HTTPException) as missing_discussion_delete_exc:
                await delete_comment(
                    mock_request, orphan_delete_comment.comment_uuid, regular_user, db
                )

        assert missing_discussion_comment_exc.value.status_code == 404
        assert locked_comment_exc.value.status_code == 403
        assert missing_community_comment_exc.value.status_code == 404
        assert missing_get_comments_discussion_exc.value.status_code == 404
        assert missing_get_comments_community_exc.value.status_code == 404
        assert missing_update_comment_exc.value.status_code == 404
        assert missing_delete_comment_exc.value.status_code == 404
        assert missing_community_delete_exc.value.status_code == 403
        assert forbidden_delete_discussion_exc.value.status_code == 403
        assert missing_discussion_delete_exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_comment_votes(self, db, org, admin_user, regular_user, mock_request):
        community = await _make_community(db, org, community_uuid="community_comment_votes")
        discussion = await _make_discussion(
            db,
            community,
            org,
            author_id=admin_user.id,
            discussion_uuid="discussion_comment_votes",
        )
        comment = await _make_comment(
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
