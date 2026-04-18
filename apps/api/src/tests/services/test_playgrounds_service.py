"""Tests for src/services/playgrounds/playgrounds.py."""

from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException, UploadFile
from sqlmodel import select

from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.playgrounds import Playground, PlaygroundAccessType, PlaygroundCreate, PlaygroundUpdate
from src.db.roles import Role, RoleTypeEnum
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


def _make_role(db, org, **overrides):
    role = Role(
        id=overrides.pop("id", None),
        org_id=org.id,
        name=overrides.pop("name", "Role"),
        description=overrides.pop("description", "Desc"),
        role_type=overrides.pop("role_type", RoleTypeEnum.TYPE_ORGANIZATION),
        role_uuid=overrides.pop("role_uuid", f"role_{uuid4()}"),
        rights=overrides.pop("rights", {}),
        creation_date=overrides.pop("creation_date", str(datetime.now())),
        update_date=overrides.pop("update_date", str(datetime.now())),
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


class TestPlaygroundsService:
    def test_rights_and_membership_helpers(self, db, org, admin_user):
        rights = _get_user_rights(admin_user.id, org.id, db)
        assert rights["playgrounds"]["action_create"] is True
        assert _is_org_admin(admin_user.id, org.id, db) is True
        assert _user_in_playground_usergroup(admin_user.id, "missing", db) is False

    def test_rights_helper_empty_and_model_dump_branches(self, db, org, regular_user, monkeypatch):
        # Missing user-org link.
        assert _get_user_rights(9999, org.id, db) == {}
        original_get = db.get

        def empty_rights_get(model, ident):
            if model is Role and ident == 4:
                return SimpleNamespace(rights={})
            return original_get(model, ident)

        monkeypatch.setattr(db, "get", empty_rights_get)
        assert _get_user_rights(regular_user.id, org.id, db) == {}

        fake_role = SimpleNamespace(
            rights=SimpleNamespace(
                model_dump=lambda: {"playgrounds": {"action_create": True, "action_update": True}}
            )
        )

        def model_dump_get(model, ident):
            if model is Role and ident == 4:
                return fake_role
            return original_get(model, ident)

        monkeypatch.setattr(db, "get", model_dump_get)
        assert _get_user_rights(regular_user.id, org.id, db) == {
            "playgrounds": {"action_create": True, "action_update": True}
        }

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

    def test_check_read_access_authenticated_owner_admin_and_usergroup(
        self, db, org, admin_user, regular_user, anonymous_user
    ):
        authenticated_pg = _make_playground(
            db,
            org,
            admin_user,
            playground_uuid="pg_auth",
            access_type=PlaygroundAccessType.AUTHENTICATED,
        )
        owner_pg = _make_playground(
            db,
            org,
            regular_user,
            playground_uuid="pg_owner",
            access_type=PlaygroundAccessType.RESTRICTED,
            created_by=regular_user.id,
        )
        admin_pg = _make_playground(
            db,
            org,
            admin_user,
            playground_uuid="pg_admin",
            access_type=PlaygroundAccessType.RESTRICTED,
            created_by=99,
        )
        group_pg = _make_playground(
            db,
            org,
            admin_user,
            playground_uuid="pg_group",
            access_type=PlaygroundAccessType.RESTRICTED,
            created_by=99,
        )
        usergroup = _make_usergroup(db, org, usergroup_uuid="pg_group_ug")
        db.add(
            UserGroupResource(
                usergroup_id=usergroup.id,
                resource_uuid=group_pg.playground_uuid,
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

        _check_read_access(authenticated_pg, regular_user, db)
        _check_read_access(owner_pg, regular_user, db)
        _check_read_access(admin_pg, admin_user, db)
        _check_read_access(group_pg, regular_user, db)

        with pytest.raises(HTTPException) as anon_exc:
            _check_read_access(authenticated_pg, anonymous_user, db)
        assert anon_exc.value.status_code == 401

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
    async def test_create_and_update_course_uuid_resolution_and_rights_guards(
        self, db, org, other_org, admin_user, regular_user, mock_request
    ):
        course = Course(
            id=41,
            name="Course One",
            description="Desc",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_match",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        foreign_course = Course(
            id=42,
            name="Course Foreign",
            description="Desc",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=other_org.id,
            course_uuid="course_foreign",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(course)
        db.add(foreign_course)
        db.commit()

        with patch(
            "src.services.playgrounds.playgrounds.dispatch_webhooks",
            new_callable=AsyncMock,
        ):
            created = await create_playground(
                mock_request,
                org.id,
                PlaygroundCreate(
                    name="With Course",
                    description="Desc",
                    course_uuid=course.course_uuid,
                ),
                admin_user,
                db,
            )
            foreign_created = await create_playground(
                mock_request,
                org.id,
                PlaygroundCreate(
                    name="With Foreign Course",
                    description="Desc",
                    course_uuid=foreign_course.course_uuid,
                ),
                admin_user,
                db,
            )

        with pytest.raises(HTTPException) as denied_exc:
            await create_playground(
                mock_request,
                org.id,
                PlaygroundCreate(name="Denied", description="Desc"),
                regular_user,
                db,
            )
        assert denied_exc.value.status_code == 403

        with pytest.raises(HTTPException) as missing_org_exc:
            await create_playground(
                mock_request,
                9999,
                PlaygroundCreate(name="Missing", description="Desc"),
                admin_user,
                db,
            )
        assert missing_org_exc.value.status_code == 404

        updated_to_course = await update_playground(
            mock_request,
            created.playground_uuid,
            PlaygroundUpdate(course_uuid=course.course_uuid),
            admin_user,
            db,
        )
        updated_to_foreign = await update_playground(
            mock_request,
            created.playground_uuid,
            PlaygroundUpdate(course_uuid=foreign_course.course_uuid),
            admin_user,
            db,
        )
        cleared_course = await update_playground(
            mock_request,
            created.playground_uuid,
            PlaygroundUpdate(course_uuid=None),
            admin_user,
            db,
        )

        with pytest.raises(HTTPException) as duplicate_exc:
            await duplicate_playground(mock_request, created.playground_uuid, regular_user, db)
        assert duplicate_exc.value.status_code == 403

        with pytest.raises(HTTPException) as missing_update_exc:
            await update_playground(
                mock_request,
                "missing_pg",
                PlaygroundUpdate(name="Missing"),
                admin_user,
                db,
            )
        assert missing_update_exc.value.status_code == 404

        with pytest.raises(HTTPException) as missing_delete_exc:
            await delete_playground(mock_request, "missing_pg", admin_user, db)
        assert missing_delete_exc.value.status_code == 404

        with pytest.raises(HTTPException) as missing_duplicate_exc:
            await duplicate_playground(mock_request, "missing_pg", admin_user, db)
        assert missing_duplicate_exc.value.status_code == 404

        assert created.course_id == course.id
        assert foreign_created.course_id is None
        assert updated_to_course.course_id == course.id
        assert updated_to_foreign.course_id is None
        assert cleared_course.course_id is None

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
    async def test_usergroup_and_thumbnail_error_paths(self, db, org, admin_user, regular_user, mock_request):
        playground = _make_playground(db, org, admin_user, playground_uuid="pg_errors")
        usergroup = _make_usergroup(db, org, usergroup_uuid="ug_errors")
        other_usergroup = _make_usergroup(db, org, id=101, usergroup_uuid="ug_other")
        upload = UploadFile(filename="thumb.png", file=SimpleNamespace())

        with pytest.raises(HTTPException) as add_missing_pg_exc:
            await add_usergroup_to_playground(
                mock_request, "missing_pg", usergroup.usergroup_uuid, admin_user, db
            )
        assert add_missing_pg_exc.value.status_code == 404

        with pytest.raises(HTTPException) as add_denied_exc:
            await add_usergroup_to_playground(
                mock_request, playground.playground_uuid, usergroup.usergroup_uuid, regular_user, db
            )
        assert add_denied_exc.value.status_code == 403

        with pytest.raises(HTTPException) as add_missing_ug_exc:
            await add_usergroup_to_playground(
                mock_request, playground.playground_uuid, "missing_ug", admin_user, db
            )
        assert add_missing_ug_exc.value.status_code == 404

        added = await add_usergroup_to_playground(
            mock_request, playground.playground_uuid, usergroup.usergroup_uuid, admin_user, db
        )
        duplicate = await add_usergroup_to_playground(
            mock_request, playground.playground_uuid, usergroup.usergroup_uuid, admin_user, db
        )

        with pytest.raises(HTTPException) as remove_missing_pg_exc:
            await remove_usergroup_from_playground(
                mock_request, "missing_pg", usergroup.usergroup_uuid, admin_user, db
            )
        assert remove_missing_pg_exc.value.status_code == 404

        with pytest.raises(HTTPException) as remove_denied_exc:
            await remove_usergroup_from_playground(
                mock_request, playground.playground_uuid, usergroup.usergroup_uuid, regular_user, db
            )
        assert remove_denied_exc.value.status_code == 403

        with pytest.raises(HTTPException) as remove_missing_ug_exc:
            await remove_usergroup_from_playground(
                mock_request, playground.playground_uuid, "missing_ug", admin_user, db
            )
        assert remove_missing_ug_exc.value.status_code == 404

        with pytest.raises(HTTPException) as remove_missing_assoc_exc:
            await remove_usergroup_from_playground(
                mock_request, playground.playground_uuid, other_usergroup.usergroup_uuid, admin_user, db
            )
        assert remove_missing_assoc_exc.value.status_code == 404

        removed = await remove_usergroup_from_playground(
            mock_request, playground.playground_uuid, usergroup.usergroup_uuid, admin_user, db
        )

        with pytest.raises(HTTPException) as thumb_missing_pg_exc:
            await update_playground_thumbnail(
                mock_request, "missing_pg", admin_user, db, upload
            )
        assert thumb_missing_pg_exc.value.status_code == 404

        with pytest.raises(HTTPException) as thumb_denied_exc:
            await update_playground_thumbnail(
                mock_request, playground.playground_uuid, regular_user, db, upload
            )
        assert thumb_denied_exc.value.status_code == 403

        original_get = db.get

        def missing_org_get(model, ident):
            if model is Organization and ident == org.id:
                return None
            return original_get(model, ident)

        with patch.object(db, "get", side_effect=missing_org_get):
            with pytest.raises(HTTPException) as thumb_org_exc:
                await update_playground_thumbnail(
                    mock_request, playground.playground_uuid, admin_user, db, upload
                )
        assert thumb_org_exc.value.status_code == 404

        with pytest.raises(HTTPException) as thumb_file_exc:
            await update_playground_thumbnail(
                mock_request, playground.playground_uuid, admin_user, db, None
            )
        assert thumb_file_exc.value.status_code == 400

        with patch(
            "src.services.playgrounds.playgrounds.upload_file",
            new_callable=AsyncMock,
            return_value="thumb_ok.png",
        ):
            thumb = await update_playground_thumbnail(
                mock_request, playground.playground_uuid, admin_user, db, upload
            )

        assert added == {"detail": "User group added to playground"}
        assert duplicate == {"detail": "User group already has access"}
        assert removed == {"detail": "User group removed from playground"}
        assert thumb.thumbnail_image == "thumb_ok.png"

    @pytest.mark.asyncio
    async def test_delete_playground_removes_linked_usergroups(
        self, db, org, admin_user, mock_request
    ):
        playground = _make_playground(db, org, admin_user, playground_uuid="pg_delete_links")
        usergroup = _make_usergroup(db, org, usergroup_uuid="ug_delete_links")
        await add_usergroup_to_playground(
            mock_request, playground.playground_uuid, usergroup.usergroup_uuid, admin_user, db
        )

        deleted = await delete_playground(mock_request, playground.playground_uuid, admin_user, db)

        assert deleted == {"detail": "Playground deleted"}
        assert (
            db.exec(
                select(UserGroupResource).where(
                    UserGroupResource.resource_uuid == playground.playground_uuid
                )
            ).first()
            is None
        )

    @pytest.mark.asyncio
    async def test_playground_list_and_get_usergroups_error_paths(
        self, db, org, admin_user, regular_user, anonymous_user, mock_request
    ):
        playground = _make_playground(db, org, admin_user, playground_uuid="pg_list")
        visible = _make_playground(
            db,
            org,
            admin_user,
            playground_uuid="pg_visible",
            access_type=PlaygroundAccessType.PUBLIC,
            published=True,
        )
        public_unpublished = _make_playground(
            db,
            org,
            admin_user,
            playground_uuid="pg_public_unpublished",
            access_type=PlaygroundAccessType.PUBLIC,
            published=False,
            created_by=regular_user.id,
        )
        hidden = _make_playground(
            db,
            org,
            admin_user,
            playground_uuid="pg_hidden",
            access_type=PlaygroundAccessType.AUTHENTICATED,
            published=False,
            created_by=admin_user.id,
        )
        usergroup = _make_usergroup(db, org, id=211, usergroup_uuid="ug_list")
        db.add(
            UserGroupResource(
                usergroup_id=usergroup.id,
                resource_uuid=playground.playground_uuid,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.add(
            UserGroupResource(
                usergroup_id=9999,
                resource_uuid=playground.playground_uuid,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        anon_list = await list_org_playgrounds(mock_request, org.id, anonymous_user, db)
        regular_list = await list_org_playgrounds(mock_request, org.id, regular_user, db)
        admin_list = await list_org_playgrounds(mock_request, org.id, admin_user, db)
        listed_groups = await get_playground_usergroups(
            mock_request, playground.playground_uuid, admin_user, db
        )

        with pytest.raises(HTTPException) as missing_get_exc:
            await get_playground_usergroups(mock_request, "missing_pg", admin_user, db)
        assert missing_get_exc.value.status_code == 404

        assert visible.playground_uuid in {pg.playground_uuid for pg in anon_list}
        assert hidden.playground_uuid in {pg.playground_uuid for pg in admin_list}
        assert public_unpublished.playground_uuid not in {pg.playground_uuid for pg in anon_list}
        assert hidden.playground_uuid not in {pg.playground_uuid for pg in regular_list}
        assert all(item["usergroup_uuid"] == usergroup.usergroup_uuid for item in listed_groups)

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

    @pytest.mark.asyncio
    async def test_list_org_playgrounds_empty_returns_empty(
        self, db, org, admin_user, mock_request
    ):
        """Line 211: no playgrounds for the org → returns [] immediately."""
        result = await list_org_playgrounds(mock_request, org.id, admin_user, db)
        assert result == []

    @pytest.mark.asyncio
    async def test_list_org_playgrounds_no_allowed_returns_empty(
        self, db, org, admin_user, anonymous_user, mock_request
    ):
        """Line 272: playgrounds exist but none pass the filter for the user → returns []."""
        _make_playground(
            db,
            org,
            admin_user,
            playground_uuid="pg_auth_only_anon",
            access_type=PlaygroundAccessType.AUTHENTICATED,
            published=True,
        )
        result = await list_org_playgrounds(mock_request, org.id, anonymous_user, db)
        assert result == []

    @pytest.mark.asyncio
    async def test_list_org_playgrounds_restricted_accessible_via_usergroup(
        self, db, org, admin_user, regular_user, mock_request
    ):
        """Lines 229-247, 254-261: regular user in a usergroup that grants access to a
        restricted playground can see it in the listing."""
        restricted_pg = _make_playground(
            db,
            org,
            admin_user,
            playground_uuid="pg_restricted_ug_access",
            access_type=PlaygroundAccessType.RESTRICTED,
            published=True,
            created_by=admin_user.id,
        )

        ug = _make_usergroup(db, org, usergroup_uuid="ug_restricted_access")
        db.add(
            UserGroupResource(
                usergroup_id=ug.id,
                resource_uuid=restricted_pg.playground_uuid,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()
        db.add(
            UserGroupUser(
                usergroup_id=ug.id,
                user_id=regular_user.id,
                org_id=org.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        result = await list_org_playgrounds(mock_request, org.id, regular_user, db)
        assert any(pg.playground_uuid == restricted_pg.playground_uuid for pg in result)

    @pytest.mark.asyncio
    async def test_list_org_playgrounds_restricted_skips_anonymous_and_no_access(
        self, db, org, admin_user, regular_user, anonymous_user, mock_request
    ):
        restricted_pg = _make_playground(
            db, org, admin_user,
            playground_uuid="pg_restricted_filter",
            access_type=PlaygroundAccessType.RESTRICTED,
            published=True,
            created_by=admin_user.id,
        )

        # Line 255: anonymous user → skip restricted playground
        anon_result = await list_org_playgrounds(mock_request, org.id, anonymous_user, db)
        assert all(pg.playground_uuid != restricted_pg.playground_uuid for pg in anon_result)

        # Line 261: non-admin, not owner, no group access → skip
        regular_result = await list_org_playgrounds(mock_request, org.id, regular_user, db)
        assert all(pg.playground_uuid != restricted_pg.playground_uuid for pg in regular_result)
