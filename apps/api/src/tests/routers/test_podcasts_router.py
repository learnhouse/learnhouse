"""Router tests for src/routers/podcasts/*.py."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.podcasts.episodes import PodcastEpisodeRead
from src.db.podcasts.podcasts import Podcast
from src.db.podcasts.podcasts import PodcastRead, PodcastReadWithEpisodeCount
from src.routers.podcasts.episodes import router as episodes_router
from src.routers.podcasts.podcasts import router as podcasts_router
from src.security.auth import get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(podcasts_router, prefix="/api/v1/podcasts")
    app.include_router(episodes_router, prefix="/api/v1/podcasts")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _mock_podcast(**overrides) -> PodcastRead:
    data = dict(
        id=1, org_id=1, name="Podcast", description="Desc", about="About", tags="tag",
        thumbnail_image="", public=True, published=True, authors=[], podcast_uuid="podcast_test",
        creation_date="2024-01-01", update_date="2024-01-01", seo=None
    )
    data.update(overrides)
    return PodcastRead(**data)


def _mock_podcast_count(**overrides) -> PodcastReadWithEpisodeCount:
    data = _mock_podcast().model_dump()
    data["episode_count"] = 2
    data.update(overrides)
    return PodcastReadWithEpisodeCount(**data)


def _mock_episode(**overrides) -> PodcastEpisodeRead:
    data = dict(
        id=1, podcast_id=1, org_id=1, title="Episode", description="Desc", audio_file="",
        duration_seconds=0, episode_number=1, thumbnail_image="", published=True, order=0,
        episode_uuid="episode_test", creation_date="2024-01-01", update_date="2024-01-01"
    )
    data.update(overrides)
    return PodcastEpisodeRead(**data)


class TestPodcastsRouter:
    async def test_podcast_endpoints(self, client, db, org):
        podcast_row = Podcast(
            id=1,
            org_id=org.id,
            name="Podcast",
            description="Desc",
            about="About",
            tags="tag",
            thumbnail_image="",
            public=True,
            published=True,
            podcast_uuid="podcast_test",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(podcast_row)
        db.commit()

        with patch("src.routers.podcasts.podcasts.create_podcast", new_callable=AsyncMock, return_value=_mock_podcast()):
            response = await client.post("/api/v1/podcasts/?org_id=1", data={"name": "Podcast", "public": "true"})
        assert response.status_code == 200

        with patch("src.routers.podcasts.podcasts.get_podcast", new_callable=AsyncMock, return_value=_mock_podcast()):
            response = await client.get("/api/v1/podcasts/podcast_test")
        assert response.status_code == 200

        with patch("src.routers.podcasts.podcasts.get_podcast_meta", new_callable=AsyncMock, return_value={"podcast_uuid": "podcast_test"}):
            response = await client.get("/api/v1/podcasts/podcast_test/meta")
        assert response.status_code == 200

        with patch("src.routers.podcasts.podcasts.get_podcasts_orgslug", new_callable=AsyncMock, return_value=[_mock_podcast_count()]):
            response = await client.get("/api/v1/podcasts/org_slug/test-org/page/1/limit/10")
        assert response.status_code == 200

        with patch("src.routers.podcasts.podcasts.get_podcasts_count_orgslug", new_callable=AsyncMock, return_value=5):
            response = await client.get("/api/v1/podcasts/org_slug/test-org/count")
        assert response.status_code == 200

        with patch("src.routers.podcasts.podcasts.update_podcast", new_callable=AsyncMock, return_value=_mock_podcast(name="Updated")):
            response = await client.put("/api/v1/podcasts/podcast_test", json={"name": "Updated"})
        assert response.status_code == 200

        with patch("src.routers.podcasts.podcasts.update_podcast_thumbnail", new_callable=AsyncMock, return_value=_mock_podcast(thumbnail_image="thumb.png")):
            response = await client.put("/api/v1/podcasts/podcast_test/thumbnail", files={"thumbnail": ("t.png", b"img", "image/png")})
        assert response.status_code == 200

        with patch("src.routers.podcasts.podcasts.delete_podcast", new_callable=AsyncMock, return_value={"deleted": True}):
            response = await client.delete("/api/v1/podcasts/podcast_test")
        assert response.status_code == 200

        with patch("src.routers.podcasts.podcasts.get_podcast_user_rights", new_callable=AsyncMock, return_value={"read": True}):
            response = await client.get("/api/v1/podcasts/podcast_test/rights")
        assert response.status_code == 200

        with patch("src.routers.podcasts.podcasts.get_episodes_by_podcast", new_callable=AsyncMock, return_value=[_mock_episode()]):
            response = await client.get("/api/v1/podcasts/podcast_test/episodes")
        assert response.status_code == 200

        with patch("src.routers.podcasts.podcasts.create_episode", new_callable=AsyncMock, return_value=_mock_episode()):
            response = await client.post("/api/v1/podcasts/podcast_test/episodes", data={"title": "Episode"})
        assert response.status_code == 200

        with patch("src.routers.podcasts.podcasts.reorder_episodes", new_callable=AsyncMock, return_value={"ok": True}):
            response = await client.put("/api/v1/podcasts/podcast_test/episodes/reorder", json=[{"episode_uuid": "episode_test", "order": 1}])
        assert response.status_code == 200

    async def test_episode_endpoints(self, client):
        with patch("src.routers.podcasts.episodes.get_episode", new_callable=AsyncMock, return_value=_mock_episode()):
            response = await client.get("/api/v1/podcasts/episodes/episode_test")
        assert response.status_code == 200

        with patch("src.routers.podcasts.episodes.update_episode", new_callable=AsyncMock, return_value=_mock_episode(title="Updated")):
            response = await client.put("/api/v1/podcasts/episodes/episode_test", json={"title": "Updated"})
        assert response.status_code == 200

        with patch("src.routers.podcasts.episodes.delete_episode", new_callable=AsyncMock, return_value={"deleted": True}):
            response = await client.delete("/api/v1/podcasts/episodes/episode_test")
        assert response.status_code == 200

        with patch("src.routers.podcasts.episodes.upload_episode_audio_file", new_callable=AsyncMock, return_value=_mock_episode(audio_file="audio.mp3")):
            response = await client.put("/api/v1/podcasts/episodes/episode_test/audio", files={"audio": ("a.mp3", b"audio", "audio/mpeg")})
        assert response.status_code == 200

        with patch("src.routers.podcasts.episodes.upload_episode_thumbnail_file", new_callable=AsyncMock, return_value=_mock_episode(thumbnail_image="thumb.png")):
            response = await client.put("/api/v1/podcasts/episodes/episode_test/thumbnail", files={"thumbnail": ("t.png", b"img", "image/png")})
        assert response.status_code == 200
