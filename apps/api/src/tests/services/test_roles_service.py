"""Tests for src/services/roles/roles.py."""

import copy
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from src.db.roles import Rights, Role, RoleCreate, RoleTypeEnum, RoleUpdate
from src.db.user_organizations import UserOrganization
from src.services.roles.roles import (
    create_role,
    delete_role,
    get_roles_by_organization,
    read_role,
    rbac_check,
    update_role,
)


def _make_role(db, org, **overrides):
    role = Role(
        id=overrides.pop("id", None),
        name=overrides.pop("name", "Role"),
        description=overrides.pop("description", "Desc"),
        org_id=overrides.pop("org_id", org.id),
        role_type=overrides.pop("role_type", RoleTypeEnum.TYPE_ORGANIZATION),
        role_uuid=overrides.pop("role_uuid", "role_custom"),
        rights=overrides.pop("rights", {}),
        creation_date=overrides.pop("creation_date", str(datetime.now())),
        update_date=overrides.pop("update_date", str(datetime.now())),
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


class TestRolesService:
    @pytest.mark.asyncio
    async def test_create_role_success_and_duplicate_guard(
        self, db, org, admin_user, admin_role, mock_request
    ):
        rights_model = Rights.model_validate(admin_role.rights)

        with patch(
            "src.services.roles.roles.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.roles.roles.require_org_role_permission"
        ), patch(
            "src.services.roles.roles.get_user_org_role",
            return_value=admin_role,
        ), patch(
            "src.services.roles.roles.is_user_superadmin",
            return_value=False,
        ):
            created = await create_role(
                mock_request,
                db,
                RoleCreate(
                    org_id=org.id,
                    name="Instructor",
                    description="Role",
                    rights=rights_model,
                ),
                admin_user,
            )

            with pytest.raises(HTTPException) as duplicate_exc:
                await create_role(
                    mock_request,
                    db,
                    RoleCreate(
                        org_id=org.id,
                        name="Instructor",
                        description="Role",
                        rights=rights_model,
                    ),
                    admin_user,
                )

        assert created.name == "Instructor"
        assert created.role_type == RoleTypeEnum.TYPE_ORGANIZATION
        assert created.org_id == org.id
        assert duplicate_exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_create_role_validation_and_permission_errors(
        self, db, org, admin_user, admin_role, user_role, mock_request
    ):
        rights_model = Rights.model_validate(admin_role.rights)

        with patch(
            "src.services.roles.roles.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.roles.roles.require_org_role_permission"
        ), patch(
            "src.services.roles.roles.get_user_org_role",
            return_value=user_role,
        ), patch(
            "src.services.roles.roles.is_user_superadmin",
            return_value=False,
        ):
            with pytest.raises(HTTPException) as no_org_exc:
                await create_role(
                    mock_request,
                    db,
                    RoleCreate(name="No Org", rights=admin_role.rights),
                    admin_user,
                )

            with pytest.raises(HTTPException) as missing_right_exc:
                await create_role(
                    mock_request,
                    db,
                    RoleCreate(
                        org_id=org.id,
                        name="Broken",
                        rights={"courses": admin_role.rights["courses"]},
                    ),
                    admin_user,
                )

            with pytest.raises(HTTPException) as escalation_exc:
                await create_role(
                    mock_request,
                    db,
                    RoleCreate(
                        org_id=org.id,
                        name="Escalated",
                        rights=rights_model,
                    ),
                    admin_user,
                )

        assert no_org_exc.value.status_code == 400
        assert missing_right_exc.value.status_code == 400
        assert escalation_exc.value.status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("role_kwargs", "expected_status", "expected_detail"),
        [
            ({"name": "No Org", "rights": {}}, 400, "Organization ID is required"),
            ({"org_id": 99999, "name": "Missing Org", "rights": {}}, 404, "Organization not found"),
            ({"org_id": "existing", "name": "", "rights": {}}, 400, "Role name is required"),
            (
                {"org_id": "existing", "name": "x" * 101, "rights": {}},
                400,
                "Role name cannot exceed 100 characters",
            ),
        ],
    )
    async def test_create_role_org_and_name_validation(
        self,
        db,
        org,
        admin_user,
        admin_role,
        mock_request,
        role_kwargs,
        expected_status,
        expected_detail,
    ):
        rights_model = Rights.model_validate(admin_role.rights)

        kwargs = dict(role_kwargs)
        if kwargs.get("org_id") == "existing":
            kwargs["org_id"] = org.id
        if kwargs.get("rights") == {}:
            kwargs["rights"] = rights_model

        with patch(
            "src.services.roles.roles.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.roles.roles.require_org_role_permission"
        ), patch(
            "src.services.roles.roles.get_user_org_role",
            return_value=admin_role,
        ), patch(
            "src.services.roles.roles.is_user_superadmin",
            return_value=False,
        ):
            with pytest.raises(HTTPException) as exc:
                await create_role(
                    mock_request,
                    db,
                    RoleCreate(**kwargs),
                    admin_user,
                )

        assert exc.value.status_code == expected_status
        assert expected_detail in exc.value.detail

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("rights_mutator", "expected_detail"),
        [
            (lambda rights: rights.pop("dashboard"), "Missing required right: dashboard"),
            (lambda rights: rights.__setitem__("dashboard", True), "Right 'dashboard' must be a JSON object"),
            (lambda rights: rights["courses"].pop("action_delete"), "Missing required course permission: action_delete"),
            (lambda rights: rights["courses"].__setitem__("action_create", "yes"), "Course permission 'action_create' must be a boolean"),
            (lambda rights: rights["users"].pop("action_delete"), "Missing required permission 'action_delete' for 'users'"),
            (lambda rights: rights["users"].__setitem__("action_create", "yes"), "Permission 'action_create' for 'users' must be a boolean"),
            (lambda rights: rights["dashboard"].pop("action_access"), "Missing required dashboard permission: action_access"),
            (lambda rights: rights["dashboard"].__setitem__("action_access", "yes"), "Dashboard permission 'action_access' must be a boolean"),
        ],
    )
    async def test_create_role_rights_validation_branches(
        self, db, org, admin_user, admin_role, mock_request, rights_mutator, expected_detail
    ):
        rights = copy.deepcopy(admin_role.rights)
        rights_mutator(rights)

        with patch(
            "src.services.roles.roles.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.roles.roles.require_org_role_permission"
        ), patch(
            "src.services.roles.roles.get_user_org_role",
            return_value=admin_role,
        ), patch(
            "src.services.roles.roles.is_user_superadmin",
            return_value=False,
        ):
            with pytest.raises(HTTPException) as exc:
                await create_role(
                    mock_request,
                    db,
                    RoleCreate(
                        org_id=org.id,
                        name="Broken Rights",
                        rights=rights,
                    ),
                    admin_user,
                )

        assert exc.value.status_code == 400
        assert expected_detail in exc.value.detail

    @pytest.mark.asyncio
    async def test_create_role_sequence_recovery_and_rbac_helper(
        self, db, org, admin_user, admin_role, mock_request
    ):
        rights_model = Rights.model_validate(admin_role.rights)
        max_result = MagicMock()
        max_result.scalar.return_value = 41
        commit_calls = []

        def commit_side_effect():
            if not commit_calls:
                commit_calls.append("failed")
                raise IntegrityError(
                    "insert role",
                    {},
                    Exception(
                        "duplicate key value violates unique constraint role_pkey"
                    ),
                )
            commit_calls.append("ok")

        with patch(
            "src.services.roles.roles.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.roles.roles.require_org_role_permission"
        ), patch(
            "src.services.roles.roles.get_user_org_role",
            return_value=admin_role,
        ), patch(
            "src.services.roles.roles.is_user_superadmin",
            return_value=False,
        ), patch.object(db, "add"), patch.object(
            db, "commit", side_effect=commit_side_effect
        ), patch.object(db, "refresh"), patch.object(
            db, "execute", side_effect=[max_result, Exception("missing sequence")]
        ), patch.object(
            db, "rollback"
        ):
            created = await create_role(
                mock_request,
                db,
                RoleCreate(
                    org_id=admin_role.org_id,
                    name="Sequence Role",
                    rights=rights_model,
                ),
                admin_user,
            )

        assert created.id == 42
        assert created.name == "Sequence Role"
        assert commit_calls == ["failed", "ok"]

    @pytest.mark.asyncio
    async def test_create_role_sequence_recovery_updates_sequence(
        self, db, org, admin_user, admin_role, mock_request
    ):
        rights_model = Rights.model_validate(admin_role.rights)
        max_result = MagicMock()
        max_result.scalar.return_value = 41
        setval_result = MagicMock()
        commit_calls = []

        def commit_side_effect():
            if not commit_calls:
                commit_calls.append("failed")
                raise IntegrityError(
                    "insert role",
                    {},
                    Exception(
                        "duplicate key value violates unique constraint role_pkey"
                    ),
                )
            commit_calls.append("ok")

        with patch(
            "src.services.roles.roles.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.roles.roles.require_org_role_permission"
        ), patch(
            "src.services.roles.roles.get_user_org_role",
            return_value=admin_role,
        ), patch(
            "src.services.roles.roles.is_user_superadmin",
            return_value=False,
        ), patch.object(db, "add"), patch.object(
            db, "commit", side_effect=commit_side_effect
        ), patch.object(db, "refresh"), patch.object(
            db, "execute", side_effect=[max_result, setval_result]
        ), patch.object(
            db, "rollback"
        ):
            created = await create_role(
                mock_request,
                db,
                RoleCreate(
                    org_id=admin_role.org_id,
                    name="Sequence Role 2",
                    rights=rights_model,
                ),
                admin_user,
            )

        assert created.id == 42
        assert commit_calls == ["failed", "ok", "ok"]

    @pytest.mark.asyncio
    async def test_create_role_sequence_error_passthrough(
        self, db, org, admin_user, admin_role, mock_request
    ):
        rights_model = Rights.model_validate(admin_role.rights)

        def commit_side_effect():
            raise IntegrityError("insert role", {}, Exception("some other error"))

        with patch(
            "src.services.roles.roles.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.roles.roles.require_org_role_permission"
        ), patch(
            "src.services.roles.roles.get_user_org_role",
            return_value=admin_role,
        ), patch(
            "src.services.roles.roles.is_user_superadmin",
            return_value=False,
        ), patch.object(db, "add"), patch.object(
            db, "commit", side_effect=commit_side_effect
        ), patch.object(db, "refresh"):
            with pytest.raises(IntegrityError):
                await create_role(
                    mock_request,
                    db,
                    RoleCreate(
                        org_id=org.id,
                        name="Bad Sequence",
                        rights=rights_model,
                    ),
                    admin_user,
                )

    @pytest.mark.asyncio
    async def test_get_roles_by_org_and_read_role(
        self, db, org, admin_user, admin_role, mock_request
    ):
        global_role = _make_role(
            db,
            org,
            id=20,
            name="Global",
            org_id=None,
            role_type=RoleTypeEnum.TYPE_GLOBAL,
            role_uuid="role_global",
        )

        with patch("src.services.roles.roles.require_org_role_permission"), patch(
            "src.services.roles.roles.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ):
            roles = await get_roles_by_organization(
                mock_request, db, org.id, admin_user
            )
            read_org_role = await read_role(
                mock_request, db, str(admin_role.id), admin_user
            )
            read_global_role = await read_role(
                mock_request, db, str(global_role.id), admin_user
            )

            with pytest.raises(HTTPException) as invalid_exc:
                await read_role(mock_request, db, "abc", admin_user)

        assert [role.name for role in roles[:2]] == ["Global", "Admin"]
        assert read_org_role.id == admin_role.id
        assert read_global_role.id == global_role.id
        assert invalid_exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_get_roles_by_organization_not_found(self, db, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await get_roles_by_organization(mock_request, db, 99999, admin_user)

        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_read_update_delete_not_found_and_rbac_helper(
        self, db, org, admin_user, mock_request
    ):
        with patch(
            "src.services.roles.roles.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as read_exc:
                await read_role(mock_request, db, "99999", admin_user)

        with pytest.raises(HTTPException) as update_exc:
            await update_role(
                mock_request,
                db,
                RoleUpdate(role_id=99999, name="Missing"),
                admin_user,
            )

        with pytest.raises(HTTPException) as delete_exc:
            await delete_role(mock_request, db, "99999", admin_user)

        assert read_exc.value.status_code == 404
        assert update_exc.value.status_code == 404
        assert delete_exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_update_role_success_and_global_guard(
        self, db, org, admin_user, admin_role, regular_user, mock_request
    ):
        rights_model = Rights.model_validate(admin_role.rights)
        org_role = _make_role(
            db,
            org,
            id=30,
            name="Editor",
            role_uuid="role_editor",
            rights=admin_role.rights,
        )
        global_role = _make_role(
            db,
            org,
            id=31,
            name="Immutable",
            org_id=None,
            role_type=RoleTypeEnum.TYPE_GLOBAL,
            role_uuid="role_immutable",
        )
        db.add(
            UserOrganization(
                user_id=regular_user.id,
                org_id=org.id,
                role_id=org_role.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch("src.services.roles.roles.require_org_role_permission"), patch(
            "src.routers.users._invalidate_session_cache"
        ) as invalidate_cache:
            updated = await update_role(
                mock_request,
                db,
                RoleUpdate(
                    role_id=org_role.id,
                    name="Editor Updated",
                    rights=rights_model,
                ),
                admin_user,
            )

            with pytest.raises(HTTPException) as global_exc:
                await update_role(
                    mock_request,
                    db,
                    RoleUpdate(role_id=global_role.id, name="Nope"),
                    admin_user,
                )

        assert updated.name == "Editor Updated"
        invalidate_cache.assert_called_once_with(regular_user.id)
        assert global_exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_update_role_with_rights_model_branch(
        self, db, org, admin_user, admin_role, mock_request
    ):
        rights_model = Rights.model_validate(admin_role.rights)
        role = Role(
            id=50,
            name="Model Role",
            description="Desc",
            org_id=org.id,
            role_type=RoleTypeEnum.TYPE_ORGANIZATION,
            role_uuid="role_model",
            rights=rights_model,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        role_result = MagicMock()
        role_result.first.return_value = role
        users_result = MagicMock()
        users_result.all.return_value = []

        with patch(
            "src.services.roles.roles.require_org_role_permission"
        ), patch.object(db, "exec", side_effect=[role_result, users_result]), patch.object(
            db, "add"
        ), patch.object(
            db, "commit"
        ), patch.object(
            db, "refresh"
        ):
            updated = await update_role(
                mock_request,
                db,
                RoleUpdate(role_id=role.id, name="Model Role Updated"),
                admin_user,
                )

        assert updated.name == "Model Role Updated"
        assert updated.rights.courses.action_create is True

    @pytest.mark.asyncio
    async def test_create_role_permission_missing_key_branch(
        self, db, org, admin_user, admin_role, mock_request
    ):
        rights = copy.deepcopy(admin_role.rights)
        rights["courses"]["action_update_own"] = True
        user_role = Role.model_validate(admin_role.model_dump())
        user_role.rights = copy.deepcopy(admin_role.rights)
        user_role.rights["courses"].pop("action_update_own")

        with patch(
            "src.services.roles.roles.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.roles.roles.require_org_role_permission"
        ), patch(
            "src.services.roles.roles.get_user_org_role",
            return_value=user_role,
        ), patch(
            "src.services.roles.roles.is_user_superadmin",
            return_value=False,
        ):
            with pytest.raises(HTTPException) as exc:
                await create_role(
                    mock_request,
                    db,
                    RoleCreate(
                        org_id=org.id,
                        name="Escalation Missing Key",
                        rights=rights,
                    ),
                    admin_user,
                )

        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_create_role_clears_none_org_id_in_read_model(
        self, db, org, admin_user, admin_role, mock_request
    ):
        rights_model = Rights.model_validate(admin_role.rights)

        class FakeRole:
            def __init__(self):
                self.id = None
                self.org_id = org.id
                self.name = "Fallback Role"
                self.description = "Desc"
                self.rights = rights_model
                self.role_type = RoleTypeEnum.TYPE_ORGANIZATION
                self.role_uuid = "role_fallback"
                self.creation_date = str(datetime.now())
                self.update_date = str(datetime.now())

            def model_dump(self):
                return {
                    "id": self.id,
                    "org_id": None,
                    "name": self.name,
                    "description": self.description,
                    "rights": self.rights,
                    "role_type": self.role_type,
                    "role_uuid": self.role_uuid,
                    "creation_date": self.creation_date,
                    "update_date": self.update_date,
                }

        fake_role = FakeRole()
        org_result = MagicMock()
        org_result.first.return_value = org
        existing_result = MagicMock()
        existing_result.first.return_value = None

        with patch(
            "src.services.roles.roles.rbac_check",
            new_callable=AsyncMock,
        ), patch(
            "src.services.roles.roles.require_org_role_permission"
        ), patch(
            "src.services.roles.roles.get_user_org_role",
            return_value=admin_role,
        ), patch(
            "src.services.roles.roles.is_user_superadmin",
            return_value=False,
        ), patch(
            "src.services.roles.roles.Role.model_validate",
            return_value=fake_role,
        ), patch.object(
            db, "exec", side_effect=[org_result, existing_result]
        ), patch.object(
            db, "add"
        ), patch.object(
            db, "commit"
        ), patch.object(
            db, "refresh"
        ):
            created = await create_role(
                mock_request,
                db,
                RoleCreate(
                    org_id=org.id,
                    name="Fallback Role",
                    rights=rights_model,
                ),
                admin_user,
            )

        assert created.org_id == 0

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("rights_mutator", "expected_detail"),
        [
            (lambda rights: rights.pop("dashboard"), "Missing required right: dashboard"),
            (lambda rights: rights.__setitem__("dashboard", True), "Right 'dashboard' must be a JSON object"),
            (lambda rights: rights["courses"].pop("action_delete"), "Missing required course permission: action_delete"),
            (lambda rights: rights["courses"].__setitem__("action_create", "yes"), "Course permission 'action_create' must be a boolean"),
            (lambda rights: rights["users"].pop("action_delete"), "Missing required permission 'action_delete' for 'users'"),
            (lambda rights: rights["users"].__setitem__("action_create", "yes"), "Permission 'action_create' for 'users' must be a boolean"),
            (lambda rights: rights["dashboard"].pop("action_access"), "Missing required dashboard permission: action_access"),
            (lambda rights: rights["dashboard"].__setitem__("action_access", "yes"), "Dashboard permission 'action_access' must be a boolean"),
        ],
    )
    async def test_update_role_rights_validation_branches(
        self, db, org, admin_user, admin_role, mock_request, rights_mutator, expected_detail
    ):
        role = _make_role(
            db,
            org,
            id=35,
            name="Mutable",
            role_uuid="role_mutable",
            rights=admin_role.rights,
        )
        rights = copy.deepcopy(admin_role.rights)
        rights_mutator(rights)

        with patch("src.services.roles.roles.require_org_role_permission"):
            with pytest.raises(HTTPException) as exc:
                await update_role(
                    mock_request,
                    db,
                    RoleUpdate(role_id=role.id, rights=rights),
                    admin_user,
                )

        assert exc.value.status_code == 400
        assert expected_detail in exc.value.detail

    @pytest.mark.asyncio
    async def test_delete_role_success_and_guards(
        self, db, org, admin_user, regular_user, mock_request
    ):
        org_role = _make_role(
            db,
            org,
            id=40,
            name="Delete Me",
            role_uuid="role_delete_me",
        )
        global_role = _make_role(
            db,
            org,
            id=41,
            name="Global Delete Guard",
            org_id=None,
            role_type=RoleTypeEnum.TYPE_GLOBAL,
            role_uuid="role_delete_guard",
        )
        db.add(
            UserOrganization(
                user_id=regular_user.id,
                org_id=org.id,
                role_id=org_role.id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        db.commit()

        with patch("src.services.roles.roles.require_org_role_permission"), patch(
            "src.routers.users._invalidate_session_cache"
        ) as invalidate_cache:
            deleted = await delete_role(mock_request, db, str(org_role.id), admin_user)

            with pytest.raises(HTTPException) as invalid_exc:
                await delete_role(mock_request, db, "bad-id", admin_user)

            with pytest.raises(HTTPException) as global_exc:
                await delete_role(mock_request, db, str(global_role.id), admin_user)

        assert deleted == "Role deleted"
        invalidate_cache.assert_called_once_with(regular_user.id)
        assert invalid_exc.value.status_code == 400
        assert global_exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_rbac_check_delegates_to_auth_helpers(self, db, org, admin_user, mock_request):
        with patch(
            "src.services.roles.roles.authorization_verify_if_user_is_anon",
            new_callable=AsyncMock,
        ) as anon_check, patch(
            "src.services.roles.roles.authorization_verify_based_on_roles_and_authorship",
            new_callable=AsyncMock,
        ) as auth_check:
            await rbac_check(mock_request, admin_user, "read", "role_xxx", db)

        anon_check.assert_awaited_once_with(admin_user.id)
        auth_check.assert_awaited_once_with(
            mock_request, admin_user.id, "read", "role_xxx", db
        )
