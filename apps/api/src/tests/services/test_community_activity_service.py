"""Tests for src/services/communities/activity.py."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.communities.communities import Community
from src.db.communities.discussion_comments import DiscussionComment
from src.db.communities.discussions import Discussion
from src.db.users import AnonymousUser, APITokenUser
from src.services.communities.activity import (
    _parse,
    get_community_discussions_activity,
    get_org_communities_activity,
)


async def _community(db, org, uuid, **overrides):
    community = Community(
        org_id=org.id,
        name=overrides.pop("name", uuid),
        description="Desc",
        public=True,
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


async def _discussion(db, community, org, author_id, uuid, created="2024-01-01T00:00:00+00:00"):
    discussion = Discussion(
        title=uuid,
        content="Content",
        label="general",
        community_id=community.id,
        org_id=org.id,
        author_id=author_id,
        discussion_uuid=uuid,
        upvote_count=0,
        creation_date=created,
        update_date=created,
    )
    db.add(discussion)
    await db.commit()
    await db.refresh(discussion)
    return discussion


async def _comment(db, discussion, author_id, uuid, created):
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
    return comment


@pytest.fixture
async def seeded(db, org, admin_user, regular_user):
    """Two communities: one with an answered and an unanswered thread, one empty."""
    busy = await _community(db, org, "community_busy")
    await _community(db, org, "community_quiet")
    answered = await _discussion(db, busy, org, regular_user.id, "discussion_answered")
    await _discussion(db, busy, org, regular_user.id, "discussion_open", created="2024-02-01T00:00:00+00:00")
    await _comment(db, answered, admin_user.id, "comment_1", "2024-03-01 10:00:00.000000")
    await _comment(db, answered, regular_user.id, "comment_2", "2024-03-02 09:00:00.000000")
    return busy


class TestParse:
    def test_unparseable_date_is_none(self):
        assert _parse("not a date") is None


class TestCommunityDiscussionsActivity:
    @pytest.mark.asyncio
    async def test_community_without_discussions_is_empty(self, db, seeded, admin_user, mock_request):
        with patch(
            "src.services.communities.activity.check_resource_access", new_callable=AsyncMock
        ), patch(
            "src.services.communities.activity.require_ee_resource_paid_access", new_callable=AsyncMock
        ):
            result = await get_community_discussions_activity(
                mock_request, "community_quiet", admin_user, db
            )
        assert result == []

    @pytest.mark.asyncio
    async def test_counts_replies_per_discussion(self, db, seeded, admin_user, mock_request):
        with patch(
            "src.services.communities.activity.check_resource_access", new_callable=AsyncMock
        ) as access, patch(
            "src.services.communities.activity.require_ee_resource_paid_access", new_callable=AsyncMock
        ):
            result = await get_community_discussions_activity(
                mock_request, "community_busy", admin_user, db
            )
        access.assert_awaited_once()
        by_uuid = {r.discussion_uuid: r for r in result}
        assert by_uuid["discussion_answered"].comment_count == 2
        assert by_uuid["discussion_answered"].last_comment_date == "2024-03-02 09:00:00.000000"
        assert by_uuid["discussion_open"].comment_count == 0
        assert by_uuid["discussion_open"].last_comment_date is None

    @pytest.mark.asyncio
    async def test_access_denied_propagates(self, db, seeded, regular_user, mock_request):
        with patch(
            "src.services.communities.activity.check_resource_access",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=403, detail="no"),
        ):
            with pytest.raises(HTTPException) as exc:
                await get_community_discussions_activity(mock_request, "community_busy", regular_user, db)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_unknown_community_is_404(self, db, org, admin_user, mock_request):
        with patch(
            "src.services.communities.activity.check_resource_access", new_callable=AsyncMock
        ), patch(
            "src.services.communities.activity.require_ee_resource_paid_access", new_callable=AsyncMock
        ):
            with pytest.raises(HTTPException) as exc:
                await get_community_discussions_activity(mock_request, "community_missing", admin_user, db)
        assert exc.value.status_code == 404


class TestOrgCommunitiesActivity:
    @pytest.mark.asyncio
    async def test_admin_gets_summary_per_community(self, db, org, seeded, admin_user, mock_request):
        result = await get_org_communities_activity(mock_request, org.id, admin_user, db)
        by_uuid = {r.community_uuid: r for r in result}
        busy = by_uuid["community_busy"]
        assert busy.discussion_count == 2
        assert busy.unanswered_count == 1
        # The latest reply is newer than either thread.
        assert busy.last_activity_date == "2024-03-02 09:00:00.000000"
        quiet = by_uuid["community_quiet"]
        assert (quiet.discussion_count, quiet.unanswered_count, quiet.last_activity_date) == (0, 0, None)

    @pytest.mark.asyncio
    async def test_regular_member_is_refused(self, db, org, seeded, regular_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await get_org_communities_activity(mock_request, org.id, regular_user, db)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_anonymous_is_refused(self, db, org, seeded, mock_request):
        with pytest.raises(HTTPException) as exc:
            await get_org_communities_activity(mock_request, org.id, AnonymousUser(), db)
        assert exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_other_org_admin_sees_nothing_of_this_org(self, db, org, other_org, seeded, admin_user, mock_request):
        # admin_user is not a member of other_org, so the role check refuses.
        with pytest.raises(HTTPException) as exc:
            await get_org_communities_activity(mock_request, other_org.id, admin_user, db)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_api_token_from_another_org_is_refused(self, db, org, other_org, seeded, mock_request):
        token = APITokenUser(org_id=other_org.id, rights={"communities": {"action_read": True}})
        with pytest.raises(HTTPException) as exc:
            await get_org_communities_activity(mock_request, org.id, token, db)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_api_token_without_read_right_is_refused(self, db, org, seeded, mock_request):
        token = APITokenUser(org_id=org.id, rights={"communities": {"action_read": False}})
        with pytest.raises(HTTPException) as exc:
            await get_org_communities_activity(mock_request, org.id, token, db)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_api_token_reads_its_own_org(self, db, org, seeded, mock_request):
        token = APITokenUser(org_id=org.id, rights={"communities": {"action_read": True}})
        result = await get_org_communities_activity(mock_request, org.id, token, db)
        assert {r.community_uuid for r in result} == {"community_busy", "community_quiet"}

    @pytest.mark.asyncio
    async def test_org_without_communities_is_empty(self, db, other_org, seeded, mock_request):
        token = APITokenUser(org_id=other_org.id, rights={"courses": {"action_read": True}})
        assert await get_org_communities_activity(mock_request, other_org.id, token, db) == []
