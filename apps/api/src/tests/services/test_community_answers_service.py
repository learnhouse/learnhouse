"""Accepted answers, discussion paging past pinned threads, and the public
community summary."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.communities.communities import Community
from src.db.communities.discussion_comments import DiscussionComment
from src.db.communities.discussions import Discussion
from src.services.communities.activity import get_org_communities_summary
from src.services.communities.comments import delete_comment
from src.services.communities.discussions import (
    DiscussionSortBy,
    get_discussions_by_community,
    set_discussion_answer,
)


async def _community(db, org, uuid, public=True):
    community = Community(
        org_id=org.id,
        name=uuid,
        description="Desc",
        public=public,
        thumbnail_image="",
        community_uuid=uuid,
        moderation_words=[],
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    db.add(community)
    await db.commit()
    await db.refresh(community)
    return community


async def _discussion(
    db, community, author_id, uuid, created="2024-01-01T00:00:00+00:00", pinned=False, label="general"
):
    discussion = Discussion(
        title=uuid,
        content="Content",
        label=label,
        community_id=community.id,
        org_id=community.org_id,
        author_id=author_id,
        discussion_uuid=uuid,
        upvote_count=0,
        is_pinned=pinned,
        creation_date=created,
        update_date=created,
    )
    db.add(discussion)
    await db.commit()
    await db.refresh(discussion)
    return discussion


async def _comment(db, discussion, author_id, uuid, created="2024-02-01 10:00:00"):
    comment = DiscussionComment(
        discussion_id=discussion.id,
        author_id=author_id,
        content="Reply",
        comment_uuid=uuid,
        upvote_count=0,
        creation_date=created,
        update_date=created,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return comment


def _moderator(allowed: bool):
    return patch(
        "src.services.communities.discussions._can_moderate",
        new_callable=AsyncMock,
        return_value=allowed,
    )


def _author_may_post():
    return patch(
        "src.services.communities.discussions.require_author_may_still_post",
        new_callable=AsyncMock,
    )


class TestDiscussionAnswer:
    @pytest.mark.asyncio
    async def test_author_marks_and_clears_answer(self, db, org, admin_user, regular_user, mock_request):
        community = await _community(db, org, "community_answers")
        thread = await _discussion(db, community, regular_user.id, "discussion_q")
        reply = await _comment(db, thread, admin_user.id, "comment_a")

        with _moderator(False), _author_may_post() as gate:
            marked = await set_discussion_answer(mock_request, "discussion_q", "comment_a", regular_user, db)
            assert marked.answer_comment_id == reply.id
            gate.assert_awaited()
            cleared = await set_discussion_answer(mock_request, "discussion_q", None, regular_user, db)
        assert cleared.answer_comment_id is None
        # Choosing an answer is not an edit of the post.
        assert cleared.edit_count == 0

    @pytest.mark.asyncio
    async def test_moderator_may_mark_someone_elses_thread(self, db, org, admin_user, regular_user, mock_request):
        community = await _community(db, org, "community_mod")
        thread = await _discussion(db, community, regular_user.id, "discussion_mod")
        reply = await _comment(db, thread, regular_user.id, "comment_mod")

        with _moderator(True), _author_may_post() as gate:
            marked = await set_discussion_answer(mock_request, "discussion_mod", "comment_mod", admin_user, db)
        assert marked.answer_comment_id == reply.id
        # Moderators skip the author-only checks (locked threads, membership).
        gate.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_other_member_is_refused(self, db, org, admin_user, regular_user, mock_request):
        community = await _community(db, org, "community_refuse")
        thread = await _discussion(db, community, admin_user.id, "discussion_refuse")
        await _comment(db, thread, regular_user.id, "comment_refuse")

        with _moderator(False), _author_may_post():
            with pytest.raises(HTTPException) as exc:
                await set_discussion_answer(mock_request, "discussion_refuse", "comment_refuse", regular_user, db)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_reply_from_another_thread_is_not_found(self, db, org, regular_user, mock_request):
        community = await _community(db, org, "community_cross")
        mine = await _discussion(db, community, regular_user.id, "discussion_mine")
        other = await _discussion(db, community, regular_user.id, "discussion_other")
        await _comment(db, other, regular_user.id, "comment_elsewhere")

        with _moderator(False), _author_may_post():
            with pytest.raises(HTTPException) as exc:
                await set_discussion_answer(mock_request, mine.discussion_uuid, "comment_elsewhere", regular_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_missing_discussion_is_404(self, db, org, regular_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await set_discussion_answer(mock_request, "discussion_nope", None, regular_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_discussion_whose_community_is_gone_is_404(self, db, org, regular_user, mock_request):
        # SQLite in tests does not enforce the FK, so an orphan row stands in
        # for a community removed underneath the thread.
        orphan = Discussion(
            title="Orphan",
            content="Content",
            label="general",
            community_id=987654,
            org_id=org.id,
            author_id=regular_user.id,
            discussion_uuid="discussion_orphan",
            upvote_count=0,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(orphan)
        await db.commit()

        with pytest.raises(HTTPException) as exc:
            await set_discussion_answer(mock_request, "discussion_orphan", None, regular_user, db)
        assert exc.value.status_code == 404
        assert exc.value.detail == "Community not found"

    @pytest.mark.asyncio
    async def test_deleting_the_answer_clears_it(self, db, org, admin_user, regular_user, mock_request):
        community = await _community(db, org, "community_delete")
        thread = await _discussion(db, community, regular_user.id, "discussion_del")
        reply = await _comment(db, thread, regular_user.id, "comment_del")
        thread.answer_comment_id = reply.id
        db.add(thread)
        await db.commit()

        with patch(
            "src.services.communities.comments.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ):
            await delete_comment(mock_request, "comment_del", regular_user, db)

        await db.refresh(thread)
        assert thread.answer_comment_id is None


class TestDiscussionPaging:
    @pytest.mark.asyncio
    async def test_second_page_continues_after_pinned_threads(self, db, org, regular_user, mock_request):
        community = await _community(db, org, "community_paging")
        await _discussion(db, community, regular_user.id, "discussion_pinned", pinned=True)
        base = datetime(2024, 1, 1, tzinfo=timezone.utc)
        for i in range(5):
            await _discussion(
                db, community, regular_user.id, f"discussion_{i}", created=(base + timedelta(days=i)).isoformat()
            )

        with patch(
            "src.services.communities.discussions.check_resource_access", new_callable=AsyncMock
        ), patch(
            "src.services.communities.discussions.require_ee_resource_paid_access", new_callable=AsyncMock
        ):
            page1 = await get_discussions_by_community(
                mock_request, "community_paging", regular_user, db, DiscussionSortBy.RECENT, 1, 3
            )
            page2 = await get_discussions_by_community(
                mock_request, "community_paging", regular_user, db, DiscussionSortBy.RECENT, 2, 3
            )
            page3 = await get_discussions_by_community(
                mock_request, "community_paging", regular_user, db, DiscussionSortBy.RECENT, 3, 3
            )

        seen = [d.discussion_uuid for d in page1 + page2 + page3]
        # Every thread exactly once: the pinned one first, nothing skipped.
        assert seen[0] == "discussion_pinned"
        assert sorted(seen) == sorted(["discussion_pinned"] + [f"discussion_{i}" for i in range(5)])
        assert len(seen) == len(set(seen))


    @pytest.mark.asyncio
    async def test_label_filter_counts_only_matching_pinned_threads(self, db, org, regular_user, mock_request):
        community = await _community(db, org, "community_labels")
        # A pinned thread under another label must not shift the labelled pages.
        await _discussion(db, community, regular_user.id, "discussion_pinned_other", pinned=True, label="other")
        await _discussion(db, community, regular_user.id, "discussion_pinned_q", pinned=True, label="question")
        base = datetime(2024, 1, 1, tzinfo=timezone.utc)
        for i in range(4):
            await _discussion(
                db,
                community,
                regular_user.id,
                f"discussion_q{i}",
                created=(base + timedelta(days=i)).isoformat(),
                label="question",
            )

        with patch(
            "src.services.communities.discussions.check_resource_access", new_callable=AsyncMock
        ), patch(
            "src.services.communities.discussions.require_ee_resource_paid_access", new_callable=AsyncMock
        ):
            page1 = await get_discussions_by_community(
                mock_request, "community_labels", regular_user, db, DiscussionSortBy.RECENT, 1, 3, "question"
            )
            page2 = await get_discussions_by_community(
                mock_request, "community_labels", regular_user, db, DiscussionSortBy.RECENT, 2, 3, "question"
            )

        seen = [d.discussion_uuid for d in page1 + page2]
        assert seen[0] == "discussion_pinned_q"
        assert sorted(seen) == sorted(["discussion_pinned_q"] + [f"discussion_q{i}" for i in range(4)])
        assert len(seen) == len(set(seen))


class TestPublicCommunitySummary:
    @pytest.mark.asyncio
    async def test_counts_for_visible_communities(self, db, org, admin_user, regular_user, mock_request):
        busy = await _community(db, org, "community_busy")
        recent = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        answered = await _discussion(db, busy, regular_user.id, "discussion_answered")
        await _discussion(db, busy, regular_user.id, "discussion_new", created=recent)
        await _comment(db, answered, admin_user.id, "comment_busy")

        with patch(
            "src.services.communities.activity.get_communities_by_org",
            new_callable=AsyncMock,
            return_value=[busy],
        ):
            result = await get_org_communities_summary(mock_request, org.id, regular_user, db)

        assert len(result) == 1
        summary = result[0]
        assert summary.community_uuid == "community_busy"
        assert summary.discussion_count == 2
        assert summary.unanswered_count == 1
        assert summary.participant_count == 2  # the poster and the replier
        assert summary.new_discussions_week == 1
        assert summary.last_activity_date == recent

    @pytest.mark.asyncio
    async def test_anonymous_only_sees_public_communities(self, db, org, regular_user, anonymous_user, mock_request):
        public = await _community(db, org, "community_open", public=True)
        private = await _community(db, org, "community_closed", public=False)
        await _discussion(db, public, regular_user.id, "discussion_open")
        await _discussion(db, private, regular_user.id, "discussion_closed")

        result = await get_org_communities_summary(mock_request, org.id, anonymous_user, db)

        assert [s.community_uuid for s in result] == ["community_open"]
        assert result[0].discussion_count == 1

    @pytest.mark.asyncio
    async def test_no_visible_communities(self, db, org, anonymous_user, mock_request):
        assert await get_org_communities_summary(mock_request, org.id, anonymous_user, db) == []
