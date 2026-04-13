"""Tests for src/services/podcasts/*.py."""

from datetime import datetime
from io import BytesIO
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException, UploadFile

from src.db.podcasts.episodes import PodcastEpisode, PodcastEpisodeCreate, PodcastEpisodeUpdate
from src.db.podcasts.podcasts import Podcast, PodcastCreate, PodcastUpdate
from src.db.organization_config import OrganizationConfig
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import APITokenUser
from src.services.podcasts.episodes import (
    create_episode,
    delete_episode,
    get_episode,
    get_episodes_by_podcast,
    reorder_episodes,
    _user_can_view_unpublished_episode,
    update_episode,
    upload_episode_audio_file,
    upload_episode_thumbnail_file,
)
from src.services.podcasts.podcasts import (
    _is_podcasts_feature_enabled,
    _user_can_view_unpublished_podcast,
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


def _make_usergroup(db, org, **overrides):
    usergroup = UserGroup(
        id=overrides.pop("id", None),
        org_id=org.id,
        name=overrides.pop("name", "UserGroup"),
        description=overrides.pop("description", "Desc"),
        usergroup_uuid=overrides.pop("usergroup_uuid", "usergroup_test"),
        creation_date=overrides.pop("creation_date", str(datetime.now())),
        update_date=overrides.pop("update_date", str(datetime.now())),
    )
    db.add(usergroup)
    db.commit()
    db.refresh(usergroup)
    return usergroup


def _make_org_config(db, org, config=None):
    org_config = OrganizationConfig(
        org_id=org.id,
        config=config or {},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(org_config)
    db.commit()
    db.refresh(org_config)
    return org_config


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

    @pytest.mark.asyncio
    async def test_feature_toggle_and_unpublished_helper_branches(
        self, db, org, other_org, admin_user, regular_user, anonymous_user, mock_request
    ):
        assert _is_podcasts_feature_enabled(other_org.id, db) is False

        _make_org_config(db, org, {"podcasts": {"enabled": True}})
        with patch(
            "src.security.features_utils.resolve.resolve_feature",
            return_value={"enabled": False},
        ):
            assert _is_podcasts_feature_enabled(org.id, db) is False

        author_podcast = _make_podcast(
            db,
            org,
            public=False,
            published=False,
            podcast_uuid="podcast_author_view",
        )
        group_podcast = _make_podcast(
            db,
            org,
            public=False,
            published=False,
            podcast_uuid="podcast_group_view",
        )
        owner_podcast = _make_podcast(
            db,
            org,
            public=False,
            published=False,
            podcast_uuid="podcast_owner_view",
        )
        hidden_podcast = _make_podcast(
            db,
            org,
            public=False,
            published=False,
            podcast_uuid="podcast_hidden_view",
        )
        usergroup = _make_usergroup(db, org, usergroup_uuid="usergroup_podcast_view")
        db.add(
            UserGroupResource(
                usergroup_id=usergroup.id,
                resource_uuid=group_podcast.podcast_uuid,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.add(
            UserGroupUser(
                usergroup_id=usergroup.id,
                user_id=regular_user.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        _make_author(db, author_podcast.podcast_uuid, regular_user.id)

        assert (
            await _user_can_view_unpublished_podcast(
                mock_request, hidden_podcast, anonymous_user, db
            )
            is False
        )

        with patch("src.services.podcasts.podcasts.is_user_superadmin", return_value=True):
            assert (
                await _user_can_view_unpublished_podcast(
                    mock_request, hidden_podcast, regular_user, db
                )
                is True
            )

        with patch("src.services.podcasts.podcasts.is_user_superadmin", return_value=False):
            assert (
                await _user_can_view_unpublished_podcast(
                    mock_request, author_podcast, regular_user, db
                )
                is True
            )
            assert (
                await _user_can_view_unpublished_podcast(
                    mock_request, owner_podcast, admin_user, db
                )
                is True
            )
            assert (
                await _user_can_view_unpublished_podcast(
                    mock_request, group_podcast, regular_user, db
                )
                is True
            )
            assert (
                await _user_can_view_unpublished_podcast(
                    mock_request, hidden_podcast, regular_user, db
                )
                is False
            )

    @pytest.mark.asyncio
    async def test_lookup_and_meta_error_paths(self, db, org, admin_user, regular_user, mock_request):
        hidden_podcast = _make_podcast(
            db,
            org,
            public=False,
            published=False,
            podcast_uuid="podcast_lookup_hidden",
        )

        with pytest.raises(HTTPException) as missing_exc:
            await get_podcast(mock_request, "missing-podcast", admin_user, db)
        assert missing_exc.value.status_code == 404

        with pytest.raises(HTTPException) as missing_meta_exc:
            await get_podcast_meta(mock_request, "missing-podcast", admin_user, db)
        assert missing_meta_exc.value.status_code == 404

        with patch(
            "src.services.podcasts.podcasts._is_podcasts_feature_enabled",
            return_value=False,
        ):
            with pytest.raises(HTTPException) as disabled_exc:
                await get_podcast_meta(mock_request, hidden_podcast.podcast_uuid, admin_user, db)
        assert disabled_exc.value.status_code == 404

        with patch(
            "src.services.podcasts.podcasts._is_podcasts_feature_enabled",
            return_value=True,
        ), patch(
            "src.services.podcasts.podcasts.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.podcasts.podcasts.is_user_superadmin",
            return_value=False,
        ):
            with pytest.raises(HTTPException) as hidden_exc:
                await get_podcast(mock_request, hidden_podcast.podcast_uuid, regular_user, db)
            assert hidden_exc.value.status_code == 404

            with pytest.raises(HTTPException) as hidden_meta_exc:
                await get_podcast_meta(mock_request, hidden_podcast.podcast_uuid, regular_user, db)
            assert hidden_meta_exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_listing_and_count_filters(self, db, org, other_org, admin_user, regular_user, anonymous_user, mock_request):
        _make_org_config(db, org, {"podcasts": {"enabled": True}})
        _make_org_config(db, other_org, {"podcasts": {"enabled": True}})

        public_podcast = _make_podcast(
            db,
            org,
            public=True,
            published=True,
            podcast_uuid="podcast_public_listing",
            creation_date="2024-01-04",
        )
        published_private = _make_podcast(
            db,
            org,
            public=False,
            published=True,
            podcast_uuid="podcast_private_listing",
            creation_date="2024-01-03",
        )
        usergroup = _make_usergroup(db, org, usergroup_uuid="usergroup_listing")
        grouped_podcast = _make_podcast(
            db,
            org,
            public=False,
            published=False,
            podcast_uuid="podcast_grouped_listing",
            creation_date="2024-01-02",
        )
        author_podcast = _make_podcast(
            db,
            org,
            public=False,
            published=False,
            podcast_uuid="podcast_author_listing",
            creation_date="2024-01-01",
        )
        db.add(
            UserGroupResource(
                usergroup_id=usergroup.id,
                resource_uuid=grouped_podcast.podcast_uuid,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.add(
            UserGroupUser(
                usergroup_id=usergroup.id,
                user_id=regular_user.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        _make_author(db, author_podcast.podcast_uuid, regular_user.id)
        db.commit()

        assert await get_podcasts_orgslug(mock_request, regular_user, "missing-slug", db) == []

        with patch(
            "src.services.podcasts.podcasts._is_podcasts_feature_enabled",
            return_value=False,
        ):
            assert await get_podcasts_orgslug(mock_request, regular_user, org.slug, db) == []

        assert await get_podcasts_orgslug(mock_request, regular_user, other_org.slug, db) == []

        regular_results = await get_podcasts_orgslug(
            mock_request, regular_user, org.slug, db, include_unpublished=False
        )
        admin_results = await get_podcasts_orgslug(
            mock_request, admin_user, org.slug, db, include_unpublished=True
        )
        with patch("src.services.podcasts.podcasts.is_user_superadmin", return_value=True):
            superadmin_results = await get_podcasts_orgslug(
                mock_request, regular_user, org.slug, db, include_unpublished=True
            )
        anonymous_results = await get_podcasts_orgslug(
            mock_request, anonymous_user, org.slug, db
        )

        regular_uuids = {podcast.podcast_uuid for podcast in regular_results}
        admin_uuids = {podcast.podcast_uuid for podcast in admin_results}
        anon_uuids = {podcast.podcast_uuid for podcast in anonymous_results}

        assert regular_uuids == {
            public_podcast.podcast_uuid,
            published_private.podcast_uuid,
            grouped_podcast.podcast_uuid,
            author_podcast.podcast_uuid,
        }
        assert admin_uuids == regular_uuids
        assert {podcast.podcast_uuid for podcast in superadmin_results} == regular_uuids
        assert anon_uuids == {public_podcast.podcast_uuid}

        assert await get_podcasts_count_orgslug(
            mock_request, anonymous_user, org.slug, db
        ) == 1

        with patch("src.services.podcasts.podcasts.is_user_superadmin", return_value=True):
            assert await get_podcasts_count_orgslug(
                mock_request, regular_user, org.slug, db
            ) == 4

        assert await get_podcasts_count_orgslug(
            mock_request, regular_user, org.slug, db
        ) == 4

    @pytest.mark.asyncio
    async def test_thumbnail_update_sensitive_update_and_delete_errors(
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
                    published=True,
                    org_id=org.id,
                ),
                admin_user,
                db,
            )

        with patch(
            "src.services.podcasts.podcasts.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as upload_exc:
                await update_podcast_thumbnail(
                    mock_request,
                    created.podcast_uuid,
                    admin_user,
                    db,
                )
        assert upload_exc.value.status_code == 500

        with patch(
            "src.services.podcasts.podcasts.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as missing_thumb_exc:
                await update_podcast_thumbnail(
                    mock_request,
                    "missing-podcast",
                    admin_user,
                    db,
                    _upload_file("thumb.png"),
                )
        assert missing_thumb_exc.value.status_code == 404

        with patch(
            "src.services.podcasts.podcasts.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.podcasts.podcasts.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            updated = await update_podcast(
                mock_request,
                PodcastUpdate(public=False),
                created.podcast_uuid,
                admin_user,
                db,
            )
        assert updated.public is False

        with pytest.raises(HTTPException) as missing_update_exc:
            await update_podcast(
                mock_request,
                PodcastUpdate(name="Missing"),
                "missing-podcast",
                admin_user,
                db,
            )
        assert missing_update_exc.value.status_code == 404

        with pytest.raises(HTTPException) as delete_exc:
            await delete_podcast(mock_request, "missing-podcast", admin_user, db)
        assert delete_exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_user_rights_public_anonymous_and_owner_roles(
        self, db, org, admin_user, regular_user, anonymous_user, mock_request
    ):
        public_podcast = _make_podcast(
            db,
            org,
            public=True,
            published=True,
            podcast_uuid="podcast_rights_public",
        )
        maintainer_podcast = _make_podcast(
            db,
            org,
            public=False,
            published=False,
            podcast_uuid="podcast_rights_maintainer",
        )
        contributor_podcast = _make_podcast(
            db,
            org,
            public=False,
            published=False,
            podcast_uuid="podcast_rights_contributor",
        )

        _make_author(
            db,
            maintainer_podcast.podcast_uuid,
            admin_user.id,
            authorship=ResourceAuthorshipEnum.MAINTAINER,
        )
        _make_author(
            db,
            contributor_podcast.podcast_uuid,
            admin_user.id,
            authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
        )

        anon_rights = await get_podcast_user_rights(
            mock_request, public_podcast.podcast_uuid, anonymous_user, db
        )
        assert anon_rights["permissions"]["read"] is True

        with patch(
            "src.services.podcasts.podcasts.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.security.rbac.rbac.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ):
            maintainer_rights = await get_podcast_user_rights(
                mock_request, maintainer_podcast.podcast_uuid, admin_user, db
            )
            contributor_rights = await get_podcast_user_rights(
                mock_request, contributor_podcast.podcast_uuid, admin_user, db
            )

        assert maintainer_rights["ownership"]["is_maintainer"] is True
        assert maintainer_rights["ownership"]["is_owner"] is True
        assert contributor_rights["ownership"]["is_contributor"] is True
        assert contributor_rights["ownership"]["is_owner"] is True


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

    @pytest.mark.asyncio
    async def test_episode_helper_and_missing_branch_paths(
        self, db, org, admin_user, regular_user, anonymous_user, mock_request
    ):
        podcast = _make_podcast(
            db,
            org,
            public=False,
            published=False,
            podcast_uuid="podcast_episode_helper",
        )
        episode = _make_episode(
            db,
            podcast,
            org,
            published=False,
            episode_uuid="episode_episode_helper",
        )

        assert (
            await _user_can_view_unpublished_episode(
                mock_request, episode, podcast, anonymous_user, db
            )
            is False
        )

        with patch("src.services.podcasts.episodes.is_user_superadmin", return_value=True):
            assert (
                await _user_can_view_unpublished_episode(
                    mock_request, episode, podcast, regular_user, db
                )
                is True
            )

        with patch("src.services.podcasts.episodes.is_user_superadmin", return_value=False):
            assert (
                await _user_can_view_unpublished_episode(
                    mock_request, episode, podcast, regular_user, db
                )
                is False
            )
            _make_author(db, podcast.podcast_uuid, regular_user.id)
            assert (
                await _user_can_view_unpublished_episode(
                    mock_request, episode, podcast, regular_user, db
                )
                is True
            )
            assert (
                await _user_can_view_unpublished_episode(
                    mock_request, episode, podcast, admin_user, db
                )
                is True
            )

        with patch("src.services.podcasts.episodes.check_resource_access", new_callable=AsyncMock):
            filtered = await get_episodes_by_podcast(
                mock_request,
                podcast.id,
                db,
                anonymous_user,
            )
            assert filtered == []

            with pytest.raises(HTTPException) as missing_podcast_exc:
                await get_episodes_by_podcast(
                    mock_request,
                    9999,
                    db,
                    admin_user,
                )
        assert missing_podcast_exc.value.status_code == 404

        orphan_episode = PodcastEpisode(
            id=999,
            podcast_id=9999,
            org_id=org.id,
            title="Orphan Episode",
            description="Orphan",
            audio_file="",
            duration_seconds=0,
            episode_number=1,
            thumbnail_image="",
            published=False,
            order=0,
            episode_uuid="episode_orphan",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(orphan_episode)
        db.commit()

        with patch("src.services.podcasts.episodes.check_resource_access", new_callable=AsyncMock):
            with pytest.raises(HTTPException) as missing_episode_exc:
                await get_episode(mock_request, "missing-episode", admin_user, db)
            with pytest.raises(HTTPException) as missing_podcast_for_episode_exc:
                await get_episode(mock_request, orphan_episode.episode_uuid, admin_user, db)
        assert missing_episode_exc.value.status_code == 404
        assert missing_podcast_for_episode_exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_episode_mutation_missing_and_validation_paths(
        self, db, org, admin_user, mock_request
    ):
        podcast = _make_podcast(
            db,
            org,
            public=False,
            published=False,
            podcast_uuid="podcast_episode_mutation",
        )
        episode = _make_episode(
            db,
            podcast,
            org,
            published=False,
            episode_uuid="episode_episode_mutation",
        )
        orphan_episode = PodcastEpisode(
            id=1000,
            podcast_id=9999,
            org_id=org.id,
            title="Orphan Episode",
            description="Orphan",
            audio_file="",
            duration_seconds=0,
            episode_number=1,
            thumbnail_image="",
            published=False,
            order=0,
            episode_uuid="episode_orphan_mutation",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(orphan_episode)
        db.commit()

        with pytest.raises(HTTPException) as missing_podcast_create_exc:
            await create_episode(
                mock_request,
                "missing-podcast",
                PodcastEpisodeCreate(title="Missing", description="Missing"),
                admin_user,
                db,
            )
        assert missing_podcast_create_exc.value.status_code == 404

        with patch("src.services.podcasts.episodes.check_resource_access", new_callable=AsyncMock):
            with pytest.raises(HTTPException) as missing_episode_update_exc:
                await update_episode(
                    mock_request,
                    "missing-episode",
                    PodcastEpisodeUpdate(title="Updated"),
                    admin_user,
                    db,
                )
            with pytest.raises(HTTPException) as missing_podcast_update_exc:
                await update_episode(
                    mock_request,
                    orphan_episode.episode_uuid,
                    PodcastEpisodeUpdate(title="Updated"),
                    admin_user,
                    db,
                )
            with pytest.raises(HTTPException) as missing_episode_delete_exc:
                await delete_episode(
                    mock_request,
                    "missing-episode",
                    admin_user,
                    db,
                )
            with pytest.raises(HTTPException) as missing_podcast_delete_exc:
                await delete_episode(
                    mock_request,
                    orphan_episode.episode_uuid,
                    admin_user,
                    db,
                )
            with pytest.raises(HTTPException) as missing_episode_audio_exc:
                await upload_episode_audio_file(
                    mock_request,
                    "missing-episode",
                    _upload_file("audio.mp3"),
                    admin_user,
                    db,
                )
            with pytest.raises(HTTPException) as missing_podcast_audio_exc:
                await upload_episode_audio_file(
                    mock_request,
                    orphan_episode.episode_uuid,
                    _upload_file("audio.mp3"),
                    admin_user,
                    db,
                )
            with pytest.raises(HTTPException) as missing_episode_thumb_exc:
                await upload_episode_thumbnail_file(
                    mock_request,
                    "missing-episode",
                    _upload_file("thumb.png"),
                    admin_user,
                    db,
                )
            with pytest.raises(HTTPException) as missing_podcast_thumb_exc:
                await upload_episode_thumbnail_file(
                    mock_request,
                    orphan_episode.episode_uuid,
                    _upload_file("thumb.png"),
                    admin_user,
                    db,
                )

            with pytest.raises(HTTPException) as audio_missing_file_exc:
                await upload_episode_audio_file(
                    mock_request,
                    episode.episode_uuid,
                    UploadFile(filename="", file=BytesIO(b"")),
                    admin_user,
                    db,
                )
            with pytest.raises(HTTPException) as thumb_missing_file_exc:
                await upload_episode_thumbnail_file(
                    mock_request,
                    episode.episode_uuid,
                    UploadFile(filename="", file=BytesIO(b"")),
                    admin_user,
                    db,
                )

            reordered = await reorder_episodes(
                mock_request,
                podcast.podcast_uuid,
                [
                    {"episode_uuid": episode.episode_uuid},
                    {"order": 5},
                    {"episode_uuid": episode.episode_uuid, "order": 3},
                ],
                admin_user,
                db,
            )

            with pytest.raises(HTTPException) as missing_podcast_reorder_exc:
                await reorder_episodes(
                    mock_request,
                    "missing-podcast",
                    [{"episode_uuid": episode.episode_uuid, "order": 1}],
                    admin_user,
                    db,
                )

        assert missing_episode_update_exc.value.status_code == 404
        assert missing_podcast_update_exc.value.status_code == 404
        assert missing_episode_delete_exc.value.status_code == 404
        assert missing_podcast_delete_exc.value.status_code == 404
        assert missing_episode_audio_exc.value.status_code == 404
        assert missing_podcast_audio_exc.value.status_code == 404
        assert missing_episode_thumb_exc.value.status_code == 404
        assert missing_podcast_thumb_exc.value.status_code == 404
        assert audio_missing_file_exc.value.status_code == 400
        assert thumb_missing_file_exc.value.status_code == 400
        assert [item.episode_uuid for item in reordered][-1] == episode.episode_uuid
        assert missing_podcast_reorder_exc.value.status_code == 404
