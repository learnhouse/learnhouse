"""Tests for src/services/playgrounds/playgrounds.py."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException, UploadFile

from src.db.playgrounds import Playground, PlaygroundAccessType, PlaygroundCreate, PlaygroundUpdate
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.services.playgrounds.playgrounds import (
    _check_read_access,
    _get_user_rights,
    _is_org_admin,
    _user_in_playground_usergroup,
    add_usergroup_to_playground,
    create_playground,
    delete_playground,
    duplicate_playground,
    get_playground,
    get_playground_usergroups,
    list_org_playgrounds,
    remove_usergroup_from_playground,
    update_playground,
    update_playground_thumbnail,
)


def _make_playground(db, org, admin_user, **overrides):
    playground = Playground(
        id=overrides.pop("id", None),
        org_id=org.id,
        name=overrides.pop("name", "Playground"),
        description=overrides.pop("description", "Desc"),
        thumbnail_image=overrides.pop("thumbnail_image", ""),
        access_type=overrides.pop(
            "access_type", PlaygroundAccessType.AUTHENTICATED
        ),
        published=overrides.pop("published", False),
        course_uuid=overrides.pop("course_uuid", None),
        html_content=overrides.pop("html_content", "<div></div>"),
        playground_uuid=overrides.pop("playground_uuid", "playground_test"),
        course_id=overrides.pop("course_id", None),
        created_by=overrides.pop("created_by", admin_user.id),
        creation_date=overrides.pop("creation_date", "2024-01-01"),
        update_date=overrides.pop("update_date", "2024-01-01"),
    )
    db.add(playground)
    db.commit()
    db.refresh(playground)
    return playground


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


class TestPlaygroundsService:
    def test_rights_and_membership_helpers(self, db, org, admin_user):
        rights = _get_user_rights(admin_user.id, org.id, db)
        assert rights["playgrounds"]["action_create"] is True
        assert _is_org_admin(admin_user.id, org.id, db) is True
        assert _user_in_playground_usergroup(admin_user.id, "missing", db) is False

    def test_check_read_access_public_and_restricted(self, db, org, admin_user, anonymous_user):
        public_pg = _make_playground(
            db, org, admin_user, playground_uuid="pg_public", access_type=PlaygroundAccessType.PUBLIC
        )
        restricted_pg = _make_playground(
            db,
            org,
            admin_user,
            playground_uuid="pg_restricted",
            access_type=PlaygroundAccessType.RESTRICTED,
            created_by=999,
        )

        _check_read_access(public_pg, anonymous_user, db)

        with pytest.raises(HTTPException) as anon_exc:
            _check_read_access(restricted_pg, anonymous_user, db)
        assert anon_exc.value.status_code == 401

        with pytest.raises(HTTPException) as restricted_exc:
            _check_read_access(restricted_pg, admin_user.model_copy(update={"id": 99}), db)
        assert restricted_exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_create_get_list_update_delete_duplicate_playground(
        self, db, org, admin_user, anonymous_user, mock_request
    ):
        with patch(
            "src.services.playgrounds.playgrounds.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            created = await create_playground(
                mock_request,
                org.id,
                PlaygroundCreate(name="Playground", description="Desc"),
                admin_user,
                db,
            )

        public_pg = _make_playground(
            db,
            org,
            admin_user,
            playground_uuid="pg_public",
            access_type=PlaygroundAccessType.PUBLIC,
            published=True,
        )
        _make_playground(
            db,
            org,
            admin_user,
            playground_uuid="pg_private",
            access_type=PlaygroundAccessType.AUTHENTICATED,
            published=False,
            created_by=77,
        )

        fetched = await get_playground(mock_request, created.playground_uuid, admin_user, db)
        anon_list = await list_org_playgrounds(mock_request, org.id, anonymous_user, db)
        admin_list = await list_org_playgrounds(mock_request, org.id, admin_user, db)
        updated = await update_playground(
            mock_request,
            created.playground_uuid,
            PlaygroundUpdate(name="Updated", published=True),
            admin_user,
            db,
        )
        duplicated = await duplicate_playground(
            mock_request, created.playground_uuid, admin_user, db
        )
        deleted = await delete_playground(
            mock_request, created.playground_uuid, admin_user, db
        )

        assert fetched.playground_uuid == created.playground_uuid
        assert {pg.playground_uuid for pg in anon_list} == {public_pg.playground_uuid}
        assert len(admin_list) >= 2
        assert updated.name == "Updated"
        assert duplicated.name.endswith("(Copy)")
        assert deleted == {"detail": "Playground deleted"}

    @pytest.mark.asyncio
    async def test_playground_usergroup_and_thumbnail_flows(
        self, db, org, admin_user, mock_request
    ):
        playground = _make_playground(db, org, admin_user)
        usergroup = _make_usergroup(db, org)
        upload = UploadFile(filename="thumb.png", file=SimpleNamespace())

        added = await add_usergroup_to_playground(
            mock_request, playground.playground_uuid, usergroup.usergroup_uuid, admin_user, db
        )
        duplicate = await add_usergroup_to_playground(
            mock_request, playground.playground_uuid, usergroup.usergroup_uuid, admin_user, db
        )
        membership = _user_in_playground_usergroup(admin_user.id, playground.playground_uuid, db)
        listed = await get_playground_usergroups(
            mock_request, playground.playground_uuid, admin_user, db
        )

        with patch(
            "src.services.playgrounds.playgrounds.upload_file",
            new_callable=AsyncMock,
            return_value="thumb.png",
        ):
            thumb = await update_playground_thumbnail(
                mock_request, playground.playground_uuid, admin_user, db, upload
            )

        removed = await remove_usergroup_from_playground(
            mock_request, playground.playground_uuid, usergroup.usergroup_uuid, admin_user, db
        )

        assert added == {"detail": "User group added to playground"}
        assert duplicate == {"detail": "User group already has access"}
        assert membership is False
        assert listed[0]["usergroup_uuid"] == usergroup.usergroup_uuid
        assert thumb.thumbnail_image == "thumb.png"
        assert removed == {"detail": "User group removed from playground"}

    @pytest.mark.asyncio
    async def test_playground_usergroup_membership_helper_with_real_rows(
        self, db, org, admin_user
    ):
        playground = _make_playground(db, org, admin_user)
        usergroup = _make_usergroup(db, org, id=90, usergroup_uuid="ug90")
        link = UserGroupResource(
            usergroup_id=usergroup.id,
            resource_uuid=playground.playground_uuid,
            org_id=org.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        membership = UserGroupUser(
            usergroup_id=usergroup.id,
            user_id=admin_user.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(link)
        db.add(membership)
        db.commit()

        assert _user_in_playground_usergroup(admin_user.id, playground.playground_uuid, db) is True

    @pytest.mark.asyncio
    async def test_playground_error_branches(self, db, org, admin_user, regular_user, mock_request):
        playground = _make_playground(db, org, admin_user)
        usergroup = _make_usergroup(db, org, usergroup_uuid="ug_missing_link")

        with pytest.raises(HTTPException) as create_exc:
            await create_playground(
                mock_request,
                999,
                PlaygroundCreate(name="Missing Org", description="Desc"),
                admin_user,
                db,
            )
        assert create_exc.value.status_code == 404

        with pytest.raises(HTTPException) as get_exc:
            await get_playground(mock_request, "missing_pg", admin_user, db)
        assert get_exc.value.status_code == 404

        with pytest.raises(HTTPException) as update_exc:
            await update_playground(
                mock_request,
                playground.playground_uuid,
                PlaygroundUpdate(name="Nope"),
                regular_user,
                db,
            )
        assert update_exc.value.status_code == 403

        with pytest.raises(HTTPException) as delete_exc:
            await delete_playground(
                mock_request, playground.playground_uuid, regular_user, db
            )
        assert delete_exc.value.status_code == 403

        with pytest.raises(HTTPException) as thumb_exc:
            await update_playground_thumbnail(
                mock_request, playground.playground_uuid, admin_user, db, None
            )
        assert thumb_exc.value.status_code == 400

        with pytest.raises(HTTPException) as remove_exc:
            await remove_usergroup_from_playground(
                mock_request, playground.playground_uuid, usergroup.usergroup_uuid, admin_user, db
            )
        assert remove_exc.value.status_code == 404
