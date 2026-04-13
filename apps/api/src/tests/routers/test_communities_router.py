"""Router tests for src/routers/communities/communities.py and discussions.py."""

from io import BytesIO
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.communities.communities import Community
from src.db.communities.communities import CommunityRead
from src.db.users import UserRead
from src.routers.communities.communities import router as communities_router
from src.routers.communities.discussions import router as discussions_router
from src.security.auth import get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(communities_router, prefix="/api/v1/communities")
    app.include_router(discussions_router, prefix="/api/v1")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _mock_community(**overrides) -> CommunityRead:
    data = dict(
        id=1,
        org_id=1,
        course_id=None,
        name="Community",
        description="Desc",
        public=True,
        thumbnail_image="",
        community_uuid="community_test",
        moderation_words=[],
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    data.update(overrides)
    return CommunityRead(**data)


def _mock_author():
    return UserRead(
        id=1,
        username="user",
        first_name="User",
        last_name="Test",
        email="user@test.com",
        avatar_image="",
        bio="",
        user_uuid="user_test",
        email_verified=True,
    )


def _mock_discussion(**overrides):
    data = {
        "id": 1,
        "title": "Discussion",
        "content": "Body",
        "label": "general",
        "emoji": None,
        "community_id": 1,
        "org_id": 1,
        "author_id": 1,
        "discussion_uuid": "d1",
        "upvote_count": 0,
        "edit_count": 0,
        "is_pinned": False,
        "is_locked": False,
        "creation_date": "2024-01-01",
        "update_date": "2024-01-01",
        "author": _mock_author().model_dump(),
        "has_voted": False,
    }
    data.update(overrides)
    return data


def _mock_comment(**overrides):
    data = {
        "id": 1,
        "discussion_id": 1,
        "author_id": 1,
        "content": "Hello",
        "comment_uuid": "c1",
        "upvote_count": 0,
        "creation_date": "2024-01-01",
        "update_date": "2024-01-01",
        "author": _mock_author().model_dump(),
        "has_voted": False,
    }
    data.update(overrides)
    return data


def _upload_file():
    return ("thumb.png", BytesIO(b"thumb"), "image/png")


class TestCommunitiesRouter:
    async def test_community_endpoints(self, client):
        with patch("src.routers.communities.communities.create_community", new_callable=AsyncMock, return_value=_mock_community()):
            response = await client.post("/api/v1/communities/?org_id=1", json={"name": "Community", "description": "Desc", "public": True})
        assert response.status_code == 200

        with patch("src.routers.communities.communities.get_community", new_callable=AsyncMock, return_value=_mock_community()):
            response = await client.get("/api/v1/communities/community_test")
        assert response.status_code == 200

        with patch("src.routers.communities.communities.get_communities_by_org", new_callable=AsyncMock, return_value=[_mock_community()]):
            response = await client.get("/api/v1/communities/org/1/page/1/limit/10")
        assert response.status_code == 200

        with patch("src.routers.communities.communities.get_community_by_course", new_callable=AsyncMock, return_value=_mock_community()):
            response = await client.get("/api/v1/communities/course/course_test")
        assert response.status_code == 200

        with patch("src.routers.communities.communities.update_community", new_callable=AsyncMock, return_value=_mock_community(name="Updated")):
            response = await client.put("/api/v1/communities/community_test", json={"name": "Updated"})
        assert response.status_code == 200

        with patch("src.routers.communities.communities.delete_community", new_callable=AsyncMock, return_value={"deleted": True}):
            response = await client.delete("/api/v1/communities/community_test")
        assert response.status_code == 200

        with patch("src.routers.communities.communities.link_community_to_course", new_callable=AsyncMock, return_value=_mock_community(course_id=1)):
            response = await client.put("/api/v1/communities/community_test/link-course/course_test")
        assert response.status_code == 200

        with patch("src.routers.communities.communities.unlink_community_from_course", new_callable=AsyncMock, return_value=_mock_community()):
            response = await client.delete("/api/v1/communities/community_test/unlink-course")
        assert response.status_code == 200

        with patch("src.routers.communities.communities.get_community_user_rights", new_callable=AsyncMock, return_value={"read": True}):
            response = await client.get("/api/v1/communities/community_test/rights")
        assert response.status_code == 200

    async def test_discussion_endpoints(self, client):
        with patch("src.routers.communities.discussions.create_discussion", new_callable=AsyncMock, return_value=_mock_discussion()):
            response = await client.post("/api/v1/communities/community_test/discussions", json={"title": "Hi"})
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.get_discussions_by_community", new_callable=AsyncMock, return_value=[_mock_discussion()]):
            response = await client.get("/api/v1/communities/community_test/discussions")
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.get_discussion", new_callable=AsyncMock, return_value=_mock_discussion()):
            response = await client.get("/api/v1/discussions/d1")
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.update_discussion", new_callable=AsyncMock, return_value=_mock_discussion(title="Updated")):
            response = await client.put("/api/v1/discussions/d1", json={"title": "Updated"})
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.pin_discussion", new_callable=AsyncMock, return_value=_mock_discussion(is_pinned=True)):
            response = await client.put("/api/v1/discussions/d1/pin", json={"is_pinned": True})
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.lock_discussion", new_callable=AsyncMock, return_value=_mock_discussion(is_locked=True)):
            response = await client.put("/api/v1/discussions/d1/lock", json={"is_locked": True})
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.delete_discussion", new_callable=AsyncMock, return_value={"deleted": True}):
            response = await client.delete("/api/v1/discussions/d1")
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.upvote_discussion", new_callable=AsyncMock, return_value={"id": 1, "discussion_id": 1, "user_id": 1, "vote_uuid": "vote1", "creation_date": "2024-01-01"}):
            response = await client.post("/api/v1/discussions/d1/vote")
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.remove_upvote", new_callable=AsyncMock, return_value={"removed": True}):
            response = await client.delete("/api/v1/discussions/d1/vote")
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.get_user_votes_for_discussions", new_callable=AsyncMock, return_value={"d1": True}):
            response = await client.post("/api/v1/discussions/votes/batch", json=["d1"])
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.create_comment", new_callable=AsyncMock, return_value=_mock_comment()):
            response = await client.post("/api/v1/discussions/d1/comments", json={"content": "Hello"})
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.get_comments_by_discussion", new_callable=AsyncMock, return_value=[_mock_comment()]):
            response = await client.get("/api/v1/discussions/d1/comments")
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.get_comment_count", new_callable=AsyncMock, return_value=3):
            response = await client.get("/api/v1/discussions/d1/comments/count")
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.update_comment", new_callable=AsyncMock, return_value=_mock_comment(content="Updated")):
            response = await client.put("/api/v1/comments/c1", json={"content": "Updated"})
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.upvote_comment", new_callable=AsyncMock, return_value={"id": 1, "comment_id": 1, "user_id": 1, "vote_uuid": "vote1", "creation_date": "2024-01-01"}):
            response = await client.post("/api/v1/comments/c1/vote")
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.remove_comment_upvote", new_callable=AsyncMock, return_value={"removed": True}):
            response = await client.delete("/api/v1/comments/c1/vote")
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.delete_comment", new_callable=AsyncMock, return_value={"deleted": True}):
            response = await client.delete("/api/v1/comments/c1")
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.get_reactions", new_callable=AsyncMock, return_value=[{"emoji": "👍", "count": 1, "users": [], "has_reacted": True}]):
            response = await client.get("/api/v1/discussions/d1/reactions")
        assert response.status_code == 200

        with patch("src.routers.communities.discussions.toggle_reaction", new_callable=AsyncMock, return_value={"toggled": True}):
            response = await client.post("/api/v1/discussions/d1/reactions", json={"emoji": "👍"})
        assert response.status_code == 200

    async def test_community_thumbnail_endpoint_branches(self, client, db, org, admin_user):
        community = Community(
            id=21,
            name="Community With Thumb",
            description="Desc",
            public=True,
            thumbnail_image="old-thumb.png",
            org_id=org.id,
            course_id=None,
            community_uuid="community_thumb",
            moderation_words=[],
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        orphan_community = Community(
            id=22,
            name="Orphan Community",
            description="Desc",
            public=True,
            thumbnail_image="",
            org_id=999,
            course_id=None,
            community_uuid="community_orphan",
            moderation_words=[],
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(community)
        db.add(orphan_community)
        db.commit()

        with patch("src.routers.communities.communities.check_resource_access", new_callable=AsyncMock), patch(
            "src.routers.communities.communities.upload_community_thumbnail",
            new_callable=AsyncMock,
            return_value="new-thumb.png",
        ):
            response = await client.put(
                "/api/v1/communities/community_thumb/thumbnail",
                files={"thumbnail": _upload_file()},
            )

        assert response.status_code == 200
        assert response.json()["thumbnail_image"] == "new-thumb.png"

        with patch("src.routers.communities.communities.check_resource_access", new_callable=AsyncMock):
            no_file_response = await client.put(
                "/api/v1/communities/community_thumb/thumbnail"
            )
            missing_community_response = await client.put(
                "/api/v1/communities/missing/thumbnail"
            )
            missing_org_response = await client.put(
                "/api/v1/communities/community_orphan/thumbnail"
            )

        assert no_file_response.status_code == 200
        assert no_file_response.json()["thumbnail_image"] == "new-thumb.png"
        assert missing_community_response.status_code == 404
        assert missing_org_response.status_code == 404
