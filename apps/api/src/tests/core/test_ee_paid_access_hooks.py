"""The paywall hooks: OSS asks EE whether a sold resource's content is locked."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.core.ee_hooks import is_ee_resource_locked, require_ee_resource_paid_access
from src.db.users import AnonymousUser, APITokenUser, PublicUser

USER = PublicUser(id=5, username="u", first_name="", last_name="", email="u@x.io", user_uuid="user_5")


def _hooks(side_effect=None):
    return SimpleNamespace(require_resource_paid_access=AsyncMock(side_effect=side_effect))


@pytest.mark.asyncio
async def test_without_ee_nothing_is_locked():
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=None):
        await require_ee_resource_paid_access(None, None, USER, "community_1")
        assert await is_ee_resource_locked(None, None, AnonymousUser(), "community_1") is False


@pytest.mark.asyncio
async def test_hook_gets_the_request_and_user():
    hooks = _hooks()
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
        await require_ee_resource_paid_access("req", "db", USER, "podcast_1")
    hooks.require_resource_paid_access.assert_awaited_once_with("req", "podcast_1", USER, "db")


@pytest.mark.asyncio
async def test_api_tokens_are_never_paywalled():
    hooks = _hooks(HTTPException(status_code=402))
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=hooks):
        await require_ee_resource_paid_access(None, None, APITokenUser(org_id=1), "board_1")
    hooks.require_resource_paid_access.assert_not_awaited()


@pytest.mark.asyncio
async def test_locked_is_a_402_and_other_errors_propagate():
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=_hooks(HTTPException(status_code=402))):
        assert await is_ee_resource_locked(None, None, USER, "podcast_1") is True
        with pytest.raises(HTTPException) as e:
            await require_ee_resource_paid_access(None, None, USER, "podcast_1")
        assert e.value.status_code == 402
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=_hooks(HTTPException(status_code=404))):
        with pytest.raises(HTTPException):
            await is_ee_resource_locked(None, None, USER, "podcast_1")
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=_hooks()):
        assert await is_ee_resource_locked(None, None, USER, "podcast_1") is False


@pytest.mark.asyncio
async def test_boards_open_for_buyers_and_stay_listed():
    from src.services.boards.boards import _passes_board_paywall

    board = SimpleNamespace(board_uuid="board_1")
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=_hooks(HTTPException(status_code=402))):
        with pytest.raises(HTTPException):
            await _passes_board_paywall(None, board, USER, None, True)
        assert await _passes_board_paywall(None, board, USER, None, False) is True
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=_hooks()):
        assert await _passes_board_paywall(None, board, USER, None, True) is True


@pytest.mark.asyncio
async def test_locked_podcast_lists_episodes_without_audio(db, org, admin_user, mock_request):
    from src.services.podcasts.episodes import get_episodes_by_podcast
    from src.tests.services.test_podcasts_service import _make_episode, _make_podcast

    podcast = await _make_podcast(db, org, public=True, published=True, podcast_uuid="podcast_sold")
    await _make_episode(db, podcast, org, id=31, episode_uuid="episode_sold", published=True)
    with patch("src.services.podcasts.episodes.check_resource_access", new_callable=AsyncMock), \
         patch("src.core.ee_hooks.is_ee_resource_locked", new=AsyncMock(return_value=True)):
        locked = await get_episodes_by_podcast(mock_request, podcast.id, db, admin_user)
    with patch("src.services.podcasts.episodes.check_resource_access", new_callable=AsyncMock), \
         patch("src.core.ee_hooks.is_ee_resource_locked", new=AsyncMock(return_value=False)):
        open_ = await get_episodes_by_podcast(mock_request, podcast.id, db, admin_user)
    assert [e.audio_file for e in locked] == [""]
    assert locked[0].title == open_[0].title


@pytest.mark.asyncio
async def test_sold_playgrounds_list_without_content_and_cannot_be_copied(db, org, admin_user, regular_user, mock_request):
    from src.db.playgrounds import PlaygroundAccessType
    from src.services.playgrounds.playgrounds import duplicate_playground, list_org_playgrounds
    from src.tests.services.test_playgrounds_service import _make_playground

    await _make_playground(
        db, org, admin_user, id=71, playground_uuid="9f-bare", published=True,
        access_type=PlaygroundAccessType.AUTHENTICATED, html_content="<p>paid</p>",
    )
    calls: list[str] = []

    async def locked(_request, _db, _user, resource_uuid):
        calls.append(resource_uuid)
        return True

    with patch("src.core.ee_hooks.is_ee_resource_locked", new=locked):
        learner_view = await list_org_playgrounds(mock_request, org.id, regular_user, db)
        admin_view = await list_org_playgrounds(mock_request, org.id, admin_user, db)
    assert [p.html_content for p in learner_view] == [None]
    assert [p.html_content for p in admin_view] == ["<p>paid</p>"]
    assert calls == ["playground_9f-bare"]

    with patch("src.core.ee_hooks.get_ee_hooks", return_value=_hooks(HTTPException(status_code=402))):
        with pytest.raises(HTTPException) as e:
            await duplicate_playground(mock_request, "9f-bare", admin_user, db)
    assert e.value.status_code == 402


@pytest.mark.asyncio
async def test_search_hides_sold_discussions_and_playground_content(db, org, admin_user, regular_user, mock_request):
    from datetime import datetime

    from src.db.communities.communities import Community
    from src.db.communities.discussions import Discussion
    from src.db.playgrounds import PlaygroundAccessType
    from src.services.search.search import search_across_org
    from src.tests.services.test_playgrounds_service import _make_playground

    now = str(datetime.now())
    for i, uuid in ((1, "community_sold"), (2, "community_free")):
        db.add(Community(id=i, name=f"Club {i}", public=True, org_id=org.id, community_uuid=uuid,
                         creation_date=now, update_date=now))
    await db.commit()
    for i, cid in ((1, 1), (2, 2)):
        db.add(Discussion(id=i, title=f"Zebra tips {i}", content="zebra body", label="general",
                          community_id=cid, org_id=org.id, author_id=admin_user.id,
                          discussion_uuid=f"discussion_{i}", creation_date=now, update_date=now))
    await db.commit()
    await _make_playground(
        db, org, admin_user, id=72, playground_uuid="playground_zebra", name="Zebra lab", published=True,
        access_type=PlaygroundAccessType.AUTHENTICATED, html_content="<p>zebra</p>",
    )

    async def locked(_request, _db, _user, resource_uuid):
        return resource_uuid in ("community_sold", "playground_zebra")

    with patch("src.core.ee_hooks.is_ee_resource_locked", new=locked):
        result = await search_across_org(
            request=mock_request, current_user=regular_user, org_slug=org.slug,
            search_query="zebra", db_session=db, page=1, limit=20,
        )
    assert [d.community_uuid for d in result.discussions] == ["community_free"]
    assert [p.html_content for p in result.playgrounds] == [None]


@pytest.mark.asyncio
@pytest.mark.parametrize("module", ["src.routers.content_files", "src.routers.local_content"])
async def test_sold_podcast_audio_files_need_a_purchase(module, db, org, admin_user, mock_request):
    import importlib

    from src.tests.services.test_podcasts_service import _make_episode, _make_podcast

    verify = importlib.import_module(module)._verify_episode_access
    podcast = await _make_podcast(db, org, public=True, published=True, podcast_uuid="podcast_audio")
    await _make_episode(db, podcast, org, id=41, episode_uuid="episode_audio", published=True)
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=_hooks(HTTPException(status_code=402))):
        with pytest.raises(HTTPException) as e:
            await verify(org.org_uuid, "podcast_audio", "episode_audio", USER, db, mock_request)
    assert e.value.status_code == 402
    with patch("src.core.ee_hooks.get_ee_hooks", return_value=_hooks()):
        await verify(org.org_uuid, "podcast_audio", "episode_audio", USER, db, mock_request)
