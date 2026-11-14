"""list_podcasts through the pipeline: shows and episodes as the podcast pages
give them (unpublished ones only to staff), and the feature switch."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from src.db.podcasts.episodes import PodcastEpisode
from src.db.podcasts.podcasts import Podcast
from src.services.ai.tools import ToolContext, ToolRegistry, make_synthetic_request, refs, run_tool
from src.services.ai.tools import podcasts as podcast_tools

NOW = str(datetime.now())


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(podcast_tools.SPECS)
    return r


@pytest.fixture(autouse=True)
def feature_on():
    with patch("src.services.podcasts.podcasts._is_podcasts_feature_enabled", new=AsyncMock(return_value=True)), \
            patch.object(refs, "web_base", new=AsyncMock(return_value="https://acme.test")):
        yield


def ctx_for(db, org, user):
    return ToolContext(request=make_synthetic_request(), db_session=db, user=user, org=org,
                       org_slug=org.slug, mode="execute", surface="mcp")


@pytest.fixture
async def shows(db, org, other_org):
    db.add_all([
        Podcast(id=1, name="The Kitebase Show", description="Weekly talks", public=True, published=True,
                org_id=org.id, podcast_uuid="podcast_show", creation_date="2026-01-02", update_date=NOW),
        Podcast(id=2, name="Checkout Clinic", description="", public=True, published=False,
                org_id=org.id, podcast_uuid="podcast_clinic", creation_date="2026-01-01", update_date=NOW),
        Podcast(id=3, name="Elsewhere", public=True, published=True, org_id=other_org.id,
                podcast_uuid="podcast_far", creation_date="2026-01-03", update_date=NOW),
    ])
    await db.commit()
    for i, (title, published) in enumerate([("Pilot", True), ("Pricing", True), ("Draft talk", False)]):
        db.add(PodcastEpisode(id=10 + i, title=title, published=published, order=i, episode_number=i + 1,
                              duration_seconds=1500, podcast_id=1, org_id=org.id, episode_uuid=f"episode_{i}",
                              creation_date=NOW, update_date=NOW))
    await db.commit()


async def test_staff_see_every_show_with_episode_titles(registry, db, org, admin_user, shows):
    out = await run_tool(registry, "list_podcasts", {"episodes_per_podcast": 2}, ctx_for(db, org, admin_user))
    assert out.status == "executed", out.reason
    data = out.result
    names = [p["name"] for p in data["items"]]
    assert names == ["The Kitebase Show", "Checkout Clinic"] and data["has_more"] is False
    show = data["items"][0]
    assert show["episode_count"] == 3 and [e["title"] for e in show["episodes"]] == ["Pilot", "Pricing"]
    assert show["more_episodes"] == 1 and show["episodes"][0]["minutes"] == 25
    assert show["url"] == "https://acme.test/podcast/show"
    assert show["editor_url"].endswith("/dash/podcasts/podcast/show/general")
    assert data["items"][1]["published"] is False and data["items"][1]["description"] is None
    assert "untrusted_fields" in data


async def test_limit_and_counts_only(registry, db, org, admin_user, shows):
    out = await run_tool(registry, "list_podcasts", {"limit": 1, "episodes_per_podcast": 0}, ctx_for(db, org, admin_user))
    data = out.result
    assert len(data["items"]) == 1 and data["has_more"] is True and "episodes" not in data["items"][0]


async def test_feature_off_lists_nothing(registry, db, org, admin_user, shows):
    with patch("src.services.podcasts.podcasts._is_podcasts_feature_enabled", new=AsyncMock(return_value=False)):
        out = await run_tool(registry, "list_podcasts", {}, ctx_for(db, org, admin_user))
    assert out.result["items"] == []


async def test_no_web_address_means_no_links(registry, db, org, admin_user, shows):
    with patch.object(refs, "web_base", new=AsyncMock(return_value="")):
        out = await run_tool(registry, "list_podcasts", {"limit": 1}, ctx_for(db, org, admin_user))
    assert out.result["items"][0]["url"] is None and out.result["items"][0]["editor_url"] is None
