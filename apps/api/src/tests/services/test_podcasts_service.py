"""Tests for src/services/podcasts/*.py."""

from datetime import datetime
from io import BytesIO
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException, UploadFile

from src.db.podcasts.episodes import PodcastEpisode, PodcastEpisodeCreate, PodcastEpisodeUpdate
from src.db.podcasts.podcasts import Podcast, PodcastCreate, PodcastUpdate
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.users import APITokenUser
from src.services.podcasts.episodes import (
    create_episode,
    delete_episode,
    get_episode,
    get_episodes_by_podcast,
    reorder_episodes,
    update_episode,
    upload_episode_audio_file,
    upload_episode_thumbnail_file,
)
from src.services.podcasts.podcasts import (
    create_podcast,
    delete_podcast,
    get_podcast,
    get_podcast_meta,
    get_podcast_user_rights,
    get_podcasts_count_orgslug,
    get_podcasts_orgslug,
    update_podcast,
    update_podcast_thumbnail,
)


def _make_podcast(db, org, **overrides):
    podcast = Podcast(
        id=overrides.pop("id", None),
        org_id=org.id,
        name=overrides.pop("name", "Podcast"),
        description=overrides.pop("description", "Desc"),
        about=overrides.pop("about", "About"),
        tags=overrides.pop("tags", "tag"),
        thumbnail_image=overrides.pop("thumbnail_image", ""),
        public=overrides.pop("public", True),
        published=overrides.pop("published", True),
        podcast_uuid=overrides.pop("podcast_uuid", "podcast_test"),
        creation_date=overrides.pop("creation_date", "2024-01-01"),
        update_date=overrides.pop("update_date", "2024-01-01"),
        seo=overrides.pop("seo", None),
    )
    db.add(podcast)
    db.commit()
    db.refresh(podcast)
    return podcast


def _make_episode(db, podcast, org, **overrides):
    episode = PodcastEpisode(
        id=overrides.pop("id", None),
        podcast_id=podcast.id,
        org_id=org.id,
        title=overrides.pop("title", "Episode"),
        description=overrides.pop("description", "Desc"),
        audio_file=overrides.pop("audio_file", ""),
        duration_seconds=overrides.pop("duration_seconds", 0),
        episode_number=overrides.pop("episode_number", 1),
        thumbnail_image=overrides.pop("thumbnail_image", ""),
        published=overrides.pop("published", True),
        order=overrides.pop("order", 0),
        episode_uuid=overrides.pop("episode_uuid", "episode_test"),
        creation_date=overrides.pop("creation_date", "2024-01-01"),
        update_date=overrides.pop("update_date", "2024-01-01"),
    )
    db.add(episode)
    db.commit()
    db.refresh(episode)
    return episode


def _make_author(db, resource_uuid, user_id, authorship=ResourceAuthorshipEnum.CREATOR):
    author = ResourceAuthor(
        resource_uuid=resource_uuid,
        user_id=user_id,
        authorship=authorship,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(author)
    db.commit()
    db.refresh(author)
    return author


def _upload_file(name):
    return UploadFile(filename=name, file=BytesIO(b"content"))


class TestPodcastsService:
    @pytest.mark.asyncio
    async def test_get_podcast_meta_list_and_count(
        self, db, org, admin_user, anonymous_user, mock_request
    ):
        podcast = _make_podcast(db, org)
        _make_author(db, podcast.podcast_uuid, admin_user.id)
        _make_episode(db, podcast, org, id=1, published=True, episode_uuid="episode_one")
        _make_episode(db, podcast, org, id=2, published=False, episode_uuid="episode_two")

        with patch(
            "src.services.podcasts.podcasts._is_podcasts_feature_enabled",
            return_value=True,
        ), patch(
            "src.services.podcasts.podcasts.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.podcasts.episodes.check_resource_access",
            new_callable=AsyncMock,
        ):
            fetched = await get_podcast(mock_request, podcast.podcast_uuid, admin_user, db)
            meta = await get_podcast_meta(mock_request, podcast.podcast_uuid, admin_user, db)
            anon_list = await get_podcasts_orgslug(
                mock_request, anonymous_user, org.slug, db
            )
            admin_count = await get_podcasts_count_orgslug(
                mock_request, admin_user, org.slug, db
            )

        assert fetched.podcast_uuid == podcast.podcast_uuid
        assert meta["podcast"].podcast_uuid == podcast.podcast_uuid
        assert len(meta["episodes"]) == 2
        assert len(anon_list) == 1
        assert admin_count == 1

    @pytest.mark.asyncio
    async def test_create_update_thumbnail_delete_and_rights(
        self, db, org, admin_user, mock_request
    ):
        with patch(
            "src.services.podcasts.podcasts.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.podcasts.podcasts.check_feature_access"
        ), patch(
            "src.services.podcasts.podcasts.check_limits_with_usage"
        ), patch(
            "src.services.podcasts.podcasts.increase_feature_usage"
        ), patch(
            "src.services.podcasts.podcasts.upload_podcast_thumbnail",
            new_callable=AsyncMock,
            return_value="thumb.png",
        ):
            created = await create_podcast(
                mock_request,
                org.id,
                PodcastCreate(
                    name="Podcast",
                    description="Desc",
                    about="About",
                    tags="tag",
                    public=True,
                    published=False,
                    org_id=org.id,
                ),
                admin_user,
                db,
                thumbnail_file=_upload_file("thumb.png"),
            )

        with patch(
            "src.services.podcasts.podcasts.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.podcasts.podcasts.upload_podcast_thumbnail",
            new_callable=AsyncMock,
            return_value="new-thumb.png",
        ):
            thumb = await update_podcast_thumbnail(
                mock_request,
                created.podcast_uuid,
                admin_user,
                db,
                _upload_file("new-thumb.png"),
            )
            updated = await update_podcast(
                mock_request,
                PodcastUpdate(name="Updated Name"),
                created.podcast_uuid,
                admin_user,
                db,
            )

        rights = await get_podcast_user_rights(
            mock_request, created.podcast_uuid, admin_user, db
        )

        with patch(
            "src.services.podcasts.podcasts.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.podcasts.podcasts.decrease_feature_usage"
        ), patch(
            "src.services.courses.transfer.storage_utils.delete_storage_directory"
        ):
            deleted = await delete_podcast(
                mock_request, created.podcast_uuid, admin_user, db
            )

        assert thumb.thumbnail_image == "new-thumb.png"
        assert updated.name == "Updated Name"
        assert rights["permissions"]["manage_access"] is True
        assert deleted == {"detail": "Podcast deleted"}

    @pytest.mark.asyncio
    async def test_create_podcast_with_api_token_user_and_sensitive_update_guard(
        self, db, org, admin_user, regular_user, mock_request
    ):
        token_user = APITokenUser(
            org_id=org.id,
            created_by_user_id=admin_user.id,
            rights={},
            token_name="token",
        )
        with patch(
            "src.services.podcasts.podcasts.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.podcasts.podcasts.check_feature_access"
        ), patch(
            "src.services.podcasts.podcasts.check_limits_with_usage"
        ), patch(
            "src.services.podcasts.podcasts.increase_feature_usage"
        ):
            created = await create_podcast(
                mock_request,
                org.id,
                PodcastCreate(
                    name="Token Podcast",
                    description="Desc",
                    about="About",
                    tags="tag",
                    public=True,
                    published=False,
                    org_id=org.id,
                ),
                token_user,
                db,
            )

        with patch(
            "src.services.podcasts.podcasts.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.podcasts.podcasts.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await update_podcast(
                    mock_request,
                    PodcastUpdate(public=False),
                    created.podcast_uuid,
                    regular_user,
                    db,
                )

        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_podcast_not_found_and_feature_disabled(self, db, org, admin_user, mock_request):
        with patch(
            "src.services.podcasts.podcasts._is_podcasts_feature_enabled",
            return_value=False,
        ):
            podcast = _make_podcast(db, org, podcast_uuid="podcast_disabled")
            with pytest.raises(HTTPException) as disabled_exc:
                await get_podcast(mock_request, podcast.podcast_uuid, admin_user, db)
        assert disabled_exc.value.status_code == 404

        with pytest.raises(HTTPException) as missing_exc:
            await get_podcast_user_rights(mock_request, "missing", admin_user, db)
        assert missing_exc.value.status_code == 404


class TestEpisodesService:
    @pytest.mark.asyncio
    async def test_episode_crud_uploads_and_reorder(self, db, org, admin_user, mock_request):
        podcast = _make_podcast(db, org)
        _make_author(db, podcast.podcast_uuid, admin_user.id)
        existing = _make_episode(db, podcast, org, id=1, episode_uuid="episode_one", order=0)

        with patch(
            "src.services.podcasts.episodes.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.podcasts.episodes.dispatch_webhooks",
            new_callable=AsyncMock,
        ), patch(
            "src.services.podcasts.episodes.upload_episode_audio",
            new_callable=AsyncMock,
            return_value="audio.mp3",
        ), patch(
            "src.services.podcasts.episodes.upload_episode_thumbnail",
            new_callable=AsyncMock,
            return_value="thumb.png",
        ):
            created = await create_episode(
                mock_request,
                podcast.podcast_uuid,
                PodcastEpisodeCreate(title="New Episode", description="Desc"),
                admin_user,
                db,
                audio_file=_upload_file("audio.mp3"),
                thumbnail_file=_upload_file("thumb.png"),
            )
            fetched = await get_episode(mock_request, created.episode_uuid, admin_user, db)
            updated = await update_episode(
                mock_request,
                created.episode_uuid,
                PodcastEpisodeUpdate(title="Updated", audio_file="", thumbnail_image=""),
                admin_user,
                db,
            )
            audio = await upload_episode_audio_file(
                mock_request, created.episode_uuid, _upload_file("audio.mp3"), admin_user, db
            )
            thumb = await upload_episode_thumbnail_file(
                mock_request, created.episode_uuid, _upload_file("thumb.png"), admin_user, db
            )
            reordered = await reorder_episodes(
                mock_request,
                podcast.podcast_uuid,
                [
                    {"episode_uuid": existing.episode_uuid, "order": 2},
                    {"episode_uuid": created.episode_uuid, "order": 1},
                ],
                admin_user,
                db,
            )

        assert created.audio_file == "audio.mp3"
        assert fetched.episode_uuid == created.episode_uuid
        assert updated.title == "Updated"
        assert audio.audio_file == "audio.mp3"
        assert thumb.thumbnail_image == "thumb.png"
        assert [episode.order for episode in reordered] == [1, 2]

        with patch(
            "src.services.podcasts.episodes.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.transfer.storage_utils.delete_storage_directory"
        ):
            deleted = await delete_episode(
                mock_request, created.episode_uuid, admin_user, db
            )

        assert deleted == {"detail": "Episode deleted"}

    @pytest.mark.asyncio
    async def test_episode_visibility_and_error_paths(
        self, db, org, admin_user, anonymous_user, mock_request
    ):
        podcast = _make_podcast(db, org, public=False, published=False, podcast_uuid="podcast_private")
        _make_author(db, podcast.podcast_uuid, admin_user.id)
        unpublished = _make_episode(
            db, podcast, org, id=10, episode_uuid="episode_hidden", published=False
        )

        with patch(
            "src.services.podcasts.episodes.check_resource_access",
            new_callable=AsyncMock,
        ):
            visible = await get_episodes_by_podcast(
                mock_request, podcast.id, db, admin_user, include_unpublished=True
            )
            assert visible[0].episode_uuid == unpublished.episode_uuid

            with pytest.raises(HTTPException) as anon_exc:
                await get_episode(mock_request, unpublished.episode_uuid, anonymous_user, db)
        assert anon_exc.value.status_code == 404

        with patch(
            "src.services.podcasts.episodes.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as audio_exc:
                await upload_episode_audio_file(
                    mock_request,
                    unpublished.episode_uuid,
                    UploadFile(filename="", file=BytesIO(b"")),
                    admin_user,
                    db,
                )
        assert audio_exc.value.status_code == 400
