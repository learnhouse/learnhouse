"""Names for the per-feature dashboard rows (services/analytics/enrichment.py).

Runs on the SQLite test schema: every uuid kind is created in the test org and,
under the same uuid, in another org, so a name can only come from the org the
dashboard belongs to.
"""

import pytest

from src.db.boards import Board
from src.db.communities.communities import Community
from src.db.folders.folders import Folder
from src.db.media.media import Media
from src.db.paths import Path as LearningPath
from src.db.playgrounds import Playground
from src.db.podcasts.episodes import PodcastEpisode
from src.db.podcasts.podcasts import Podcast
from src.services.analytics.enrichment import enrich_with_metadata


async def _seed(db, org_id: int, label: str) -> None:
    db.add(Community(org_id=org_id, community_uuid="community_x", name=f"{label} community"))
    db.add(LearningPath(org_id=org_id, path_uuid="path_x", name=f"{label} path"))
    podcast = Podcast(org_id=org_id, podcast_uuid="podcast_x", name=f"{label} podcast", public=True)
    db.add(podcast)
    await db.flush()
    db.add(PodcastEpisode(org_id=org_id, podcast_id=podcast.id, episode_uuid="episode_x", title=f"{label} episode"))
    db.add(Board(org_id=org_id, board_uuid="board_x", name=f"{label} board", created_by=None))
    db.add(Playground(org_id=org_id, playground_uuid="playground_x", name=f"{label} playground"))
    db.add(Media(org_id=org_id, media_uuid="media_x", name=f"{label} media"))
    db.add(Folder(org_id=org_id, folder_uuid="folder_x", name=f"{label} folder"))
    await db.commit()


@pytest.fixture
async def seeded(db, org, other_org):
    await _seed(db, org.id, "Mine")
    await _seed(db, other_org.id, "Theirs")
    return org


def _feature_rows() -> list[dict]:
    return [
        {"community_uuid": "community_x", "views": 3},
        {"path_uuid": "path_x", "views": 2},
        {"podcast_uuid": "podcast_x", "episode_uuid": "episode_x", "plays": 4},
        {"kind": "board", "uuid": "board_x", "views": 5},
        {"kind": "playground", "uuid": "playground_x", "views": 1},
        {"kind": "board", "uuid": "board_missing", "views": 1},
        {"kind": "signup", "method": "email", "events": 2},
        {"resource_uuid": "media_x", "resource_type": "media", "opens": 1},
        {"resource_uuid": "folder_x", "resource_type": "folder", "opens": 1},
        {"resource_uuid": "mystery_x", "resource_type": "other", "opens": 1},
        {"resource_uuid": "media_missing", "opens": 1},
        {"community_uuid": "community_missing", "views": 1},
        {"community_uuid": None, "path_uuid": "", "episode_uuid": ["not", "a", "uuid"]},
    ]


@pytest.mark.asyncio
async def test_feature_names_resolve_within_the_org(db, seeded):
    rows = await enrich_with_metadata(_feature_rows(), db, org_id=seeded.id)

    assert rows[0]["community_name"] == "Mine community"
    assert rows[1]["path_name"] == "Mine path"
    assert rows[2]["podcast_name"] == "Mine podcast"
    assert rows[2]["episode_title"] == "Mine episode"
    assert rows[3]["name"] == "Mine board"
    assert rows[4]["name"] == "Mine playground"
    assert "name" not in rows[5]
    assert "name" not in rows[6]
    assert rows[7]["resource_name"] == "Mine media"
    assert rows[8]["resource_name"] == "Mine folder"
    assert "resource_name" not in rows[9]
    assert "resource_name" not in rows[10]
    assert "community_name" not in rows[11]
    assert set(rows[12]) == {"community_uuid", "path_uuid", "episode_uuid"}


@pytest.mark.asyncio
async def test_feature_names_never_come_from_another_org(db, org, other_org):
    await _seed(db, other_org.id, "Theirs")

    rows = await enrich_with_metadata(_feature_rows(), db, org_id=org.id)

    for row in rows:
        assert not any(isinstance(value, str) and value.startswith("Theirs") for value in row.values()), row


@pytest.mark.asyncio
async def test_feature_names_without_org_scope(db, org):
    # The audit dossier and older callers may omit org_id: no org filter then.
    await _seed(db, org.id, "Only")

    rows = await enrich_with_metadata(
        [{"kind": "playground", "uuid": "playground_x"}, {"resource_uuid": "community_x"}], db
    )

    assert rows[0]["name"] == "Only playground"
    assert rows[1]["resource_name"] == "Only community"


@pytest.mark.asyncio
async def test_rows_without_feature_keys_run_no_extra_queries():
    from unittest.mock import AsyncMock

    db = AsyncMock()
    rows = [{"date": "2026-11-01", "events": 3, "kind": "quiz"}]

    assert await enrich_with_metadata(rows, db, org_id=1) == [{"date": "2026-11-01", "events": 3, "kind": "quiz"}]
    db.execute.assert_not_called()
