"""Tests for src/services/communities/*.py."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.communities.communities import Community, CommunityCreate, CommunityUpdate
from src.db.communities.discussions import Discussion, DiscussionUpdate
from src.db.communities.discussion_votes import DiscussionVote
from src.db.courses.courses import Course
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.services.communities.communities import (
    create_community,
    delete_community,
    get_communities_by_org,
    get_community,
    get_community_by_course,
    get_community_user_rights,
    link_community_to_course,
    unlink_community_from_course,
    update_community,
)
from src.services.communities.discussions import (
    DiscussionSortBy,
    calculate_hot_score,
    create_discussion,
    delete_discussion,
    get_discussion,
    get_discussions_by_community,
    lock_discussion,
    pin_discussion,
    update_discussion,
    validate_label,
)


def _make_course(db, org, **overrides):
    course = Course(
        id=overrides.pop("id", None),
        name=overrides.pop("name", "Course"),
        description=overrides.pop("description", "Desc"),
        public=overrides.pop("public", True),
        published=overrides.pop("published", True),
        open_to_contributors=overrides.pop("open_to_contributors", False),
        org_id=org.id,
        course_uuid=overrides.pop("course_uuid", "course_test"),
        creation_date=overrides.pop("creation_date", "2024-01-01"),
        update_date=overrides.pop("update_date", "2024-01-01"),
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


def _make_community(db, org, **overrides):
    community = Community(
        id=overrides.pop("id", None),
        org_id=org.id,
        name=overrides.pop("name", "Community"),
        description=overrides.pop("description", "Desc"),
        public=overrides.pop("public", True),
        thumbnail_image=overrides.pop("thumbnail_image", ""),
        course_id=overrides.pop("course_id", None),
        community_uuid=overrides.pop("community_uuid", "community_test"),
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
        discussion_uuid=overrides.pop("discussion_uuid", "discussion_test"),
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


def _make_usergroup(db, org, **overrides):
    usergroup = UserGroup(
        id=overrides.pop("id", None),
        org_id=org.id,
        name=overrides.pop("name", "UG"),
        description=overrides.pop("description", "Desc"),
        usergroup_uuid=overrides.pop("usergroup_uuid", "ug_test"),
        creation_date=overrides.pop("creation_date", str(datetime.now())),
        update_date=overrides.pop("update_date", str(datetime.now())),
    )
    db.add(usergroup)
    db.commit()
    db.refresh(usergroup)
    return usergroup


class TestCommunitiesService:
    @pytest.mark.asyncio
    async def test_community_crud_link_and_lookup(
        self, db, org, admin_user, mock_request
    ):
        course = _make_course(db, org)
        with patch(
            "src.services.communities.communities.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.communities.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.communities.communities.check_resource_access",
            new_callable=AsyncMock,
        ):
            created = await create_community(
                mock_request,
                org.id,
                CommunityCreate(name="Community", description="Desc", public=True),
                admin_user,
                db,
            )
            fetched = await get_community(
                mock_request, created.community_uuid, admin_user, db
            )
            linked = await link_community_to_course(
                mock_request, created.community_uuid, course.course_uuid, admin_user, db
            )
            by_course = await get_community_by_course(
                mock_request, course.course_uuid, admin_user, db
            )
            updated = await update_community(
                mock_request,
                created.community_uuid,
                CommunityUpdate(
                    name="Updated",
                    description="Updated Desc",
                    public=False,
                    moderation_words=["x"],
                    moderation_settings={"max_post_length": 500},
                ),
                admin_user,
                db,
            )
            unlinked = await unlink_community_from_course(
                mock_request, created.community_uuid, admin_user, db
            )
            deleted = await delete_community(
                mock_request, created.community_uuid, admin_user, db
            )

        assert fetched.community_uuid == created.community_uuid
        assert linked.course_id == course.id
        assert by_course.community_uuid == created.community_uuid
        assert updated.name == "Updated"
        assert updated.description == "Updated Desc"
        assert updated.public is False
        assert updated.moderation_words == ["x"]
        assert unlinked.course_id is None
        assert deleted == {"detail": "Community deleted"}

    @pytest.mark.asyncio
    async def test_get_communities_by_org_variants_and_rights(
        self, db, org, admin_user, regular_user, anonymous_user, mock_request
    ):
        public_community = _make_community(
            db, org, id=1, community_uuid="community_public", public=True
        )
        private_community = _make_community(
            db, org, id=2, community_uuid="community_private", public=False
        )
        usergroup = _make_usergroup(db, org, id=50)
        db.add(
            UserGroupResource(
                usergroup_id=usergroup.id,
                resource_uuid=private_community.community_uuid,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.add(
            UserGroupUser(
                usergroup_id=usergroup.id,
                user_id=regular_user.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.services.communities.communities.is_user_superadmin",
            return_value=False,
        ), patch(
            "src.services.communities.communities.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.services.communities.communities.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            anon_result = await get_communities_by_org(
                mock_request, org.id, anonymous_user, db
            )
            regular_result = await get_communities_by_org(
                mock_request, org.id, regular_user, db
            )
            rights = await get_community_user_rights(
                mock_request, private_community.community_uuid, regular_user, db
            )

        with patch(
            "src.services.communities.communities.is_user_superadmin",
            return_value=True,
        ):
            admin_result = await get_communities_by_org(
                mock_request, org.id, admin_user, db
            )

        assert [community.community_uuid for community in anon_result] == [
            public_community.community_uuid
        ]
        assert {community.community_uuid for community in regular_result} == {
            public_community.community_uuid,
            private_community.community_uuid,
        }
        assert rights["permissions"]["read"] is True
        assert rights["access"]["via_usergroups"] == [usergroup.id]
        assert len(admin_result) == 2

    @pytest.mark.asyncio
    async def test_community_admin_and_error_branches(
        self, db, org, other_org, admin_user, anonymous_user, mock_request
    ):
        course = _make_course(db, org, id=20, course_uuid="course_admin")
        community = _make_community(
            db,
            org,
            id=21,
            community_uuid="community_admin",
            public=False,
        )
        _linked_community = _make_community(
            db,
            org,
            id=22,
            community_uuid="community_linked",
            public=False,
            course_id=course.id,
        )
        other_org_community = _make_community(
            db,
            org,
            id=23,
            community_uuid="community_other_org",
            public=False,
        )

        with patch(
            "src.services.communities.communities.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.communities.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.communities.communities.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.services.communities.communities.check_resource_access",
            new_callable=AsyncMock,
        ):
            admin_rights_result = await get_community_user_rights(
                mock_request, community.community_uuid, admin_user, db
            )
            anon_rights_result = await get_community_user_rights(
                mock_request, community.community_uuid, anonymous_user, db
            )
            admin_list_result = await get_communities_by_org(
                mock_request, org.id, admin_user, db
            )
            orphan_course = _make_course(
                db,
                org,
                id=24,
                course_uuid="course_orphan",
            )
            no_link_result = await get_community_by_course(
                mock_request, orphan_course.course_uuid, admin_user, db
            )
            with pytest.raises(HTTPException) as create_missing_org_exc:
                await create_community(
                    mock_request,
                    9999,
                    CommunityCreate(name="Missing Org", description="Desc", public=True),
                    admin_user,
                    db,
                )
            with pytest.raises(HTTPException) as get_missing_exc:
                await get_community(mock_request, "missing-community", admin_user, db)
            with pytest.raises(HTTPException) as course_missing_exc:
                await get_community_by_course(
                    mock_request, "missing-course", admin_user, db
                )
            with pytest.raises(HTTPException) as update_missing_exc:
                await update_community(
                    mock_request,
                    "missing-community",
                    CommunityUpdate(name="Missing"),
                    admin_user,
                    db,
                )
            with pytest.raises(HTTPException) as delete_missing_exc:
                await delete_community(
                    mock_request, "missing-community", admin_user, db
                )
            with pytest.raises(HTTPException) as link_missing_community_exc:
                await link_community_to_course(
                    mock_request, "missing-community", course.course_uuid, admin_user, db
                )
            with pytest.raises(HTTPException) as link_missing_course_exc:
                await link_community_to_course(
                    mock_request, community.community_uuid, "missing-course", admin_user, db
                )
            with pytest.raises(HTTPException) as unlink_missing_exc:
                await unlink_community_from_course(
                    mock_request, "missing-community", admin_user, db
                )

        with patch(
            "src.services.communities.communities.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.communities.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.services.communities.communities.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.services.communities.communities.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as create_denied_exc:
                await create_community(
                    mock_request,
                    org.id,
                    CommunityCreate(name="Denied", description="Desc", public=True),
                    admin_user,
                    db,
                )
            existing_linked_community = _make_community(
                db,
                org,
                id=24,
                community_uuid="community_existing_link",
                course_id=course.id,
            )
            with pytest.raises(HTTPException) as link_same_org_exc:
                await link_community_to_course(
                    mock_request,
                    community.community_uuid,
                    course.course_uuid,
                    admin_user,
                    db,
                )
            assert existing_linked_community.course_id == course.id

        other_course = _make_course(
            db,
            other_org,
            id=25,
            course_uuid="course_other_org",
        )
        with patch(
            "src.services.communities.communities.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as link_org_exc:
                await link_community_to_course(
                    mock_request,
                    other_org_community.community_uuid,
                    other_course.course_uuid,
                    admin_user,
                    db,
                )

        assert admin_rights_result["permissions"]["create"] is True
        assert admin_rights_result["permissions"]["update"] is True
        assert admin_rights_result["permissions"]["delete"] is True
        assert admin_rights_result["ownership"]["is_admin"] is True
        assert admin_rights_result["ownership"]["is_maintainer_role"] is True
        assert admin_rights_result["permissions"]["read"] is True
        assert anon_rights_result["permissions"]["read"] is False
        assert len(admin_list_result) == 3
        assert no_link_result is None
        assert create_missing_org_exc.value.status_code == 404
        assert get_missing_exc.value.status_code == 404
        assert course_missing_exc.value.status_code == 404
        assert update_missing_exc.value.status_code == 404
        assert delete_missing_exc.value.status_code == 404
        assert link_missing_community_exc.value.status_code == 404
        assert link_missing_course_exc.value.status_code == 404
        assert unlink_missing_exc.value.status_code == 404
        assert create_denied_exc.value.status_code == 403
        assert link_same_org_exc.value.status_code == 400
        assert link_org_exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_community_user_rights_anonymous_and_no_access(
        self, db, org, anonymous_user, regular_user, mock_request
    ):
        public_community = _make_community(
            db,
            org,
            id=30,
            community_uuid="community_public_rights",
            public=True,
        )
        private_community = _make_community(
            db,
            org,
            id=31,
            community_uuid="community_private_rights",
            public=False,
        )
        usergroup = _make_usergroup(db, org, id=32, usergroup_uuid="ug_private_rights")
        db.add(
            UserGroupResource(
                usergroup_id=usergroup.id,
                resource_uuid=private_community.community_uuid,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()
        private_group = _make_usergroup(db, org, id=51)
        db.add(
            UserGroupResource(
                usergroup_id=private_group.id,
                resource_uuid=private_community.community_uuid,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.services.communities.communities.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.services.communities.communities.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            anonymous_rights = await get_community_user_rights(
                mock_request, public_community.community_uuid, anonymous_user, db
            )
            private_rights = await get_community_user_rights(
                mock_request, private_community.community_uuid, regular_user, db
            )

        assert anonymous_rights["permissions"]["read"] is True
        assert anonymous_rights["access"]["via_public"] is True
        assert private_rights["permissions"]["read"] is False
        assert private_rights["permissions"]["create_discussion"] is False
        assert private_rights["access"]["via_public"] is False
        assert private_rights["access"]["has_usergroup_restriction"] is True

    @pytest.mark.asyncio
    async def test_community_error_paths(self, db, org, admin_user, mock_request):
        course = _make_course(db, org, id=2, course_uuid="course_two")
        community = _make_community(db, org, id=10, course_id=course.id)
        _make_community(db, org, id=11, community_uuid="community_two", course_id=course.id)

        with patch(
            "src.services.communities.communities.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.communities.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(HTTPException) as create_exc:
                await create_community(
                    mock_request,
                    org.id,
                    CommunityCreate(name="Denied", description="Desc", public=True),
                    admin_user,
                    db,
                )
        assert create_exc.value.status_code == 403

        with patch(
            "src.services.communities.communities.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as link_exc:
                await link_community_to_course(
                    mock_request, community.community_uuid, course.course_uuid, admin_user, db
                )
        assert link_exc.value.status_code == 400

        with pytest.raises(HTTPException) as rights_exc:
            await get_community_user_rights(mock_request, "missing", admin_user, db)
        assert rights_exc.value.status_code == 404


class TestDiscussionsService:
    def test_hot_score_and_label_validation(self):
        now = datetime.now(timezone.utc).isoformat()
        naive = datetime.now().replace(tzinfo=None).isoformat()
        old = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        assert calculate_hot_score(10, now) > calculate_hot_score(10, old)
        assert isinstance(calculate_hot_score(5, naive), float)
        assert isinstance(calculate_hot_score(5, "not-a-timestamp"), float)
        assert validate_label("question") == "question"
        assert validate_label("nope") == "general"

    @pytest.mark.asyncio
    async def test_discussion_crud_and_sorting(
        self, db, org, admin_user, anonymous_user, mock_request
    ):
        community = _make_community(db, org)
        with patch(
            "src.services.communities.discussions.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.discussions.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.discussions.validate_discussion_content",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.discussions.track",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.discussions.dispatch_webhooks",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.discussions.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=True,
        ):
            created = await create_discussion(
                mock_request,
                community.community_uuid,
                "First",
                "Body",
                "question",
                admin_user,
                db,
                emoji="🔥",
            )
            fetched = await get_discussion(
                mock_request, created.discussion_uuid, admin_user, db
            )
            updated = await update_discussion(
                mock_request,
                created.discussion_uuid,
                DiscussionUpdate(
                    title="Updated", content="Updated body", label="idea", emoji=""
                ),
                admin_user,
                db,
            )
            pinned = await pin_discussion(
                mock_request, created.discussion_uuid, True, admin_user, db
            )
            locked = await lock_discussion(
                mock_request, created.discussion_uuid, True, admin_user, db
            )
            upvotes = await get_discussions_by_community(
                mock_request,
                community.community_uuid,
                admin_user,
                db,
                sort_by=DiscussionSortBy.UPVOTES,
                label="idea",
            )

        older = _make_discussion(
            db,
            community,
            org,
            admin_user.id,
            id=20,
            discussion_uuid="discussion_old",
            upvote_count=5,
            creation_date=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
        )
        db.add(
            DiscussionVote(
                discussion_id=older.id,
                user_id=admin_user.id,
                vote_uuid="vote_x",
                creation_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch(
            "src.services.communities.discussions.check_resource_access",
            new_callable=AsyncMock,
        ):
            recent = await get_discussions_by_community(
                mock_request,
                community.community_uuid,
                admin_user,
                db,
                sort_by=DiscussionSortBy.RECENT,
            )
            hot = await get_discussions_by_community(
                mock_request,
                community.community_uuid,
                admin_user,
                db,
                sort_by=DiscussionSortBy.HOT,
            )
            empty_community = _make_community(
                db, org, id=21, community_uuid="community_empty"
            )
            empty = await get_discussions_by_community(
                mock_request,
                empty_community.community_uuid,
                admin_user,
                db,
                limit=0,
            )

        with patch(
            "src.services.communities.discussions.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.discussions.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=True,
        ):
            deleted = await delete_discussion(
                mock_request, created.discussion_uuid, admin_user, db
            )

        assert fetched.has_voted is True
        assert updated.label == "idea"
        assert updated.emoji is None
        assert updated.content == "Updated body"
        assert pinned.is_pinned is True
        assert locked.is_locked is True
        assert upvotes[0].discussion_uuid == created.discussion_uuid
        assert recent[0].is_pinned is True
        assert hot[0].is_pinned is True
        assert empty == []
        assert deleted == {"detail": "Discussion deleted"}

    @pytest.mark.asyncio
    async def test_discussion_error_paths(self, db, org, admin_user, regular_user, mock_request):
        community = _make_community(db, org)
        discussion = _make_discussion(
            db,
            community,
            org,
            admin_user.id,
            edit_count=2,
            discussion_uuid="discussion_limit",
        )

        with patch(
            "src.services.communities.discussions.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.discussions.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(HTTPException) as update_exc:
                await update_discussion(
                    mock_request,
                    discussion.discussion_uuid,
                    DiscussionUpdate(content="Nope"),
                    regular_user,
                    db,
                )
        assert update_exc.value.status_code == 403

        with patch(
            "src.services.communities.discussions.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.discussions.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(HTTPException) as limit_exc:
                await update_discussion(
                    mock_request,
                    discussion.discussion_uuid,
                    DiscussionUpdate(content="Still nope"),
                    admin_user,
                    db,
                )
        assert limit_exc.value.status_code == 403

        with patch(
            "src.services.communities.discussions.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.discussions.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(HTTPException) as pin_exc:
                await pin_discussion(
                    mock_request, discussion.discussion_uuid, True, regular_user, db
                )
        assert pin_exc.value.status_code == 403

        with patch(
            "src.services.communities.discussions.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as list_missing_exc:
                await get_discussions_by_community(
                    mock_request,
                    "community_missing_discussions",
                    admin_user,
                    db,
                )
        assert list_missing_exc.value.status_code == 404

        with patch(
            "src.services.communities.discussions.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.discussions.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(HTTPException) as update_missing_discussion_exc:
                await update_discussion(
                    mock_request,
                    "discussion_missing",
                    DiscussionUpdate(content="No such discussion"),
                    admin_user,
                    db,
                )
        assert update_missing_discussion_exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_discussion_missing_and_permission_paths(
        self, db, org, admin_user, regular_user, mock_request
    ):
        community = _make_community(db, org, id=30, community_uuid="community_discussion_paths")
        discussion = _make_discussion(
            db,
            community,
            org,
            admin_user.id,
            discussion_uuid="discussion_discussion_paths",
        )
        orphan_discussion = Discussion(
            title="Orphan",
            content="Body",
            label="general",
            emoji=None,
            community_id=987654,
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
        db.refresh(orphan_discussion)

        with patch(
            "src.services.communities.discussions.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.discussions.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.discussions.validate_discussion_content",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as create_exc:
                await create_discussion(
                    mock_request,
                    "community_missing",
                    "Title",
                    "Body",
                    "question",
                    admin_user,
                    db,
                )
        assert create_exc.value.status_code == 404

        with pytest.raises(HTTPException) as missing_discussion_exc:
            await get_discussion(mock_request, "discussion_missing", admin_user, db)
        assert missing_discussion_exc.value.status_code == 404

        with patch(
            "src.services.communities.discussions.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as orphan_get_exc:
                await get_discussion(
                    mock_request, orphan_discussion.discussion_uuid, admin_user, db
                )
        assert orphan_get_exc.value.status_code == 404

        with patch(
            "src.services.communities.discussions.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.discussions.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(HTTPException) as update_forbidden_exc:
                await update_discussion(
                    mock_request,
                    discussion.discussion_uuid,
                    DiscussionUpdate(content="No permission"),
                    regular_user,
                    db,
                )
            with pytest.raises(HTTPException) as pin_forbidden_exc:
                await pin_discussion(
                    mock_request, discussion.discussion_uuid, True, regular_user, db
                )
            with pytest.raises(HTTPException) as lock_forbidden_exc:
                await lock_discussion(
                    mock_request, discussion.discussion_uuid, True, regular_user, db
                )
            with pytest.raises(HTTPException) as delete_forbidden_exc:
                await delete_discussion(
                    mock_request, discussion.discussion_uuid, regular_user, db
                )
        assert update_forbidden_exc.value.status_code == 403
        assert pin_forbidden_exc.value.status_code == 403
        assert lock_forbidden_exc.value.status_code == 403
        assert delete_forbidden_exc.value.status_code == 403

        with patch(
            "src.services.communities.discussions.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as pin_missing_exc:
                await pin_discussion(
                    mock_request, "discussion_missing", True, admin_user, db
                )
            with pytest.raises(HTTPException) as lock_missing_exc:
                await lock_discussion(
                    mock_request, "discussion_missing", True, admin_user, db
                )
            with pytest.raises(HTTPException) as delete_missing_exc:
                await delete_discussion(
                    mock_request, "discussion_missing", admin_user, db
                )
        assert pin_missing_exc.value.status_code == 404
        assert lock_missing_exc.value.status_code == 404
        assert delete_missing_exc.value.status_code == 404

        with patch(
            "src.services.communities.discussions.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ), patch(
            "src.services.communities.discussions.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(HTTPException) as update_orphan_exc:
                await update_discussion(
                    mock_request,
                    orphan_discussion.discussion_uuid,
                    DiscussionUpdate(content="Still no community"),
                    admin_user,
                    db,
                )
            with pytest.raises(HTTPException) as pin_orphan_exc:
                await pin_discussion(
                    mock_request, orphan_discussion.discussion_uuid, True, admin_user, db
                )
            with pytest.raises(HTTPException) as lock_orphan_exc:
                await lock_discussion(
                    mock_request, orphan_discussion.discussion_uuid, True, admin_user, db
                )
            with pytest.raises(HTTPException) as delete_orphan_exc:
                await delete_discussion(
                    mock_request, orphan_discussion.discussion_uuid, admin_user, db
                )
        assert update_orphan_exc.value.status_code == 404
        assert pin_orphan_exc.value.status_code == 404
        assert lock_orphan_exc.value.status_code == 404
        assert delete_orphan_exc.value.status_code == 404
