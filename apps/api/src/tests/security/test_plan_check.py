"""Tests for src/security/features_utils/plan_check.py."""

from datetime import datetime
from unittest.mock import patch
from urllib.parse import urlencode

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.db.boards import Board
from src.db.communities.communities import Community
from src.db.courses.certifications import CertificateUser, Certifications
from src.db.organization_config import OrganizationConfig
from src.db.playgrounds import Playground
from src.db.usergroups import UserGroup
from src.security.features_utils.plan_check import (
    _check_mode_bypass,
    get_org_plan,
    require_plan,
    require_plan_for_boards,
    require_plan_for_certifications,
    require_plan_for_community,
    require_plan_for_playgrounds,
    require_plan_for_usergroups,
)

PLAN_DEPENDENCIES = [
    ("Analytics", require_plan("pro", "Analytics")),
    ("Usergroups", require_plan_for_usergroups("pro", "Usergroups")),
    ("Certificates", require_plan_for_certifications("pro", "Certificates")),
    ("Boards", require_plan_for_boards("pro", "Boards")),
    ("Playgrounds", require_plan_for_playgrounds("pro", "Playgrounds")),
    ("Communities", require_plan_for_community("standard", "Communities")),
]


def _request(path_params=None, query_params=None):
    query_string = urlencode(query_params or {}).encode()
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [],
            "query_string": query_string,
            "path_params": path_params or {},
        }
    )


def _make_org_config(db, org, config):
    org_config = OrganizationConfig(
        org_id=org.id,
        config=config,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(org_config)
    db.commit()
    db.refresh(org_config)
    return org_config


class TestPlanCheck:
    def test_check_mode_bypass(self):
        with patch(
            "src.security.features_utils.plan_check.get_deployment_mode",
            return_value="ee",
        ):
            assert _check_mode_bypass("Boards") is True

        with patch(
            "src.security.features_utils.plan_check.get_deployment_mode",
            return_value="saas",
        ):
            assert _check_mode_bypass("Boards") is None

        with patch(
            "src.security.features_utils.plan_check.get_deployment_mode",
            return_value="oss",
        ), patch(
            "src.security.features_utils.plan_check.EE_ONLY_FEATURES",
            {"boards"},
        ):
            with pytest.raises(HTTPException) as exc:
                _check_mode_bypass("Boards")

        assert exc.value.status_code == 403

        with patch(
            "src.security.features_utils.plan_check.get_deployment_mode",
            return_value="oss",
        ), patch(
            "src.security.features_utils.plan_check.EE_ONLY_FEATURES",
            {"boards"},
        ):
            assert _check_mode_bypass("Analytics") is True

    def test_get_org_plan_versions_and_missing_config(self, db, org):
        _make_org_config(
            db,
            org,
            {"config_version": "1.4", "cloud": {"plan": "pro"}},
        )
        assert get_org_plan(org.id, db) == "pro"

        db.query(OrganizationConfig).delete()
        db.commit()
        _make_org_config(db, org, {"config_version": "2.0", "plan": "enterprise"})
        assert get_org_plan(org.id, db) == "enterprise"

        db.query(OrganizationConfig).delete()
        db.commit()
        with pytest.raises(HTTPException) as exc:
            get_org_plan(org.id, db)

        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_require_plan_from_path_and_query(self, db, org):
        _make_org_config(
            db,
            org,
            {"config_version": "2.0", "plan": "standard"},
        )
        dependency = require_plan("pro", "Analytics")

        with patch(
            "src.security.features_utils.plan_check.get_deployment_mode",
            return_value="saas",
        ), patch(
            "src.security.features_utils.plan_check.plan_meets_requirement",
            side_effect=[False, True],
        ):
            with pytest.raises(HTTPException) as low_plan_exc:
                await dependency(_request(path_params={"org_id": str(org.id)}), db)

            assert await dependency(_request(query_params={"org_id": str(org.id)}), db) is True

            with pytest.raises(HTTPException) as missing_org_exc:
                await dependency(_request(path_params={"org_id": "abc"}), db)

            with pytest.raises(HTTPException) as invalid_query_exc:
                await dependency(_request(query_params={"org_id": "abc"}), db)

        assert low_plan_exc.value.status_code == 403
        assert missing_org_exc.value.status_code == 400
        assert invalid_query_exc.value.status_code == 400

    @pytest.mark.asyncio
    @pytest.mark.parametrize("feature_name, dependency", PLAN_DEPENDENCIES)
    async def test_require_plan_mode_bypass_allows_request(self, db, feature_name, dependency):
        with patch(
            "src.security.features_utils.plan_check.get_deployment_mode",
            return_value="ee",
        ):
            assert await dependency(_request(), db) is True

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("feature_name", "dependency", "request_kwargs", "expected_status"),
        [
            # The vanilla ``require_plan`` always requires a resolvable
            # org_id and fails closed with 400 if missing or malformed.
            ("Analytics", require_plan("pro", "Analytics"), {"path_params": {"org_id": "abc"}}, 400),
            ("Analytics", require_plan("pro", "Analytics"), {"query_params": {"org_id": "abc"}}, 400),
            # The specialised wrappers fall through when the discriminator
            # can't be resolved — their routers mount handlers whose
            # discriminator sometimes lives in the request body or in
            # child uuids (discussion_uuid, comment_uuid) we don't expand.
            # Tenant isolation is still enforced by each handler's RBAC.
            ("Usergroups", require_plan_for_usergroups("pro", "Usergroups"), {"path_params": {"usergroup_id": "abc"}}, 200),
            ("Usergroups", require_plan_for_usergroups("pro", "Usergroups"), {"path_params": {"org_id": "abc"}}, 200),
            ("Usergroups", require_plan_for_usergroups("pro", "Usergroups"), {"query_params": {"org_id": "abc"}}, 200),
            ("Certificates", require_plan_for_certifications("pro", "Certificates"), {"path_params": {"org_id": "abc"}}, 200),
            ("Certificates", require_plan_for_certifications("pro", "Certificates"), {"query_params": {"org_id": "abc"}}, 200),
            ("Boards", require_plan_for_boards("pro", "Boards"), {"path_params": {"org_id": "abc"}}, 200),
            ("Boards", require_plan_for_boards("pro", "Boards"), {"query_params": {"org_id": "abc"}}, 200),
            ("Playgrounds", require_plan_for_playgrounds("pro", "Playgrounds"), {"path_params": {"org_id": "abc"}}, 200),
            ("Playgrounds", require_plan_for_playgrounds("pro", "Playgrounds"), {"query_params": {"org_id": "abc"}}, 200),
            ("Communities", require_plan_for_community("standard", "Communities"), {"path_params": {"org_id": "abc"}}, 200),
            ("Communities", require_plan_for_community("standard", "Communities"), {"query_params": {"org_id": "abc"}}, 200),
        ],
    )
    async def test_require_plan_invalid_ids(self, db, feature_name, dependency, request_kwargs, expected_status):
        with patch(
            "src.security.features_utils.plan_check.get_deployment_mode",
            return_value="saas",
        ):
            if expected_status == 400:
                with pytest.raises(HTTPException) as exc:
                    await dependency(_request(**request_kwargs), db)
                assert exc.value.status_code == 400
            else:
                assert await dependency(_request(**request_kwargs), db) is True

    @pytest.mark.asyncio
    async def test_require_plan_for_usergroups_success_and_no_org(self, db, org):
        _make_org_config(db, org, {"config_version": "2.0", "plan": "standard"})
        usergroup = UserGroup(
            org_id=org.id,
            name="Group",
            description="Desc",
            usergroup_uuid="ug_plan",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(usergroup)
        db.commit()
        db.refresh(usergroup)

        dependency = require_plan_for_usergroups("pro", "Usergroups")
        with patch(
            "src.security.features_utils.plan_check.get_deployment_mode",
            return_value="saas",
        ), patch(
            "src.security.features_utils.plan_check.plan_meets_requirement",
            return_value=True,
        ):
            # No discriminator → fall through (handler RBAC still runs).
            # Resolvable discriminator → plan gate evaluates and returns True.
            assert await dependency(_request(), db) is True
            assert await dependency(_request(path_params={"usergroup_id": str(usergroup.id)}), db) is True

        with patch(
            "src.security.features_utils.plan_check.get_deployment_mode",
            return_value="saas",
        ), patch(
            "src.security.features_utils.plan_check.plan_meets_requirement",
            return_value=False,
        ):
            with pytest.raises(HTTPException) as exc:
                await dependency(_request(path_params={"usergroup_id": str(usergroup.id)}), db)

        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_require_plan_for_certifications_variants(self, db, org, course, regular_user):
        _make_org_config(db, org, {"config_version": "2.0", "plan": "enterprise"})
        cert = Certifications(
            certification_uuid="cert_test",
            course_id=course.id,
            config={},
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(cert)
        db.commit()
        db.refresh(cert)
        user_cert = CertificateUser(
            user_id=regular_user.id,
            certification_id=cert.id,
            user_certification_uuid="user_cert_test",
            created_at=str(datetime.now()),
            updated_at=str(datetime.now()),
        )
        db.add(user_cert)
        db.commit()

        dependency = require_plan_for_certifications("pro", "Certificates")
        with patch(
            "src.security.features_utils.plan_check.get_deployment_mode",
            return_value="saas",
        ), patch(
            "src.security.features_utils.plan_check.plan_meets_requirement",
            return_value=True,
        ):
            # No discriminator → fall through (handler RBAC still runs).
            assert await dependency(_request(), db) is True
            assert (
                await dependency(_request(path_params={"certification_uuid": cert.certification_uuid}), db)
                is True
            )
            assert (
                await dependency(_request(path_params={"course_uuid": course.course_uuid}), db)
                is True
            )
            assert (
                await dependency(
                    _request(path_params={"user_certification_uuid": user_cert.user_certification_uuid}),
                    db,
                )
                is True
            )

        with patch(
            "src.security.features_utils.plan_check.get_deployment_mode",
            return_value="saas",
        ), patch(
            "src.security.features_utils.plan_check.plan_meets_requirement",
            return_value=False,
        ):
            with pytest.raises(HTTPException) as exc:
                await dependency(_request(path_params={"certification_uuid": cert.certification_uuid}), db)

        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_require_plan_for_board_playground_and_community(self, db, org):
        _make_org_config(db, org, {"config_version": "2.0", "plan": "standard"})
        board = Board(
            org_id=org.id,
            name="Board",
            description="Desc",
            public=True,
            board_uuid="board_plan",
            created_by=1,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        playground = Playground(
            org_id=org.id,
            name="Playground",
            description="Desc",
            access_type="authenticated",
            published=True,
            playground_uuid="playground_plan",
            created_by=1,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        community = Community(
            org_id=org.id,
            name="Community",
            description="Desc",
            public=True,
            community_uuid="community_plan",
            moderation_words=[],
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(board)
        db.add(playground)
        db.add(community)
        db.commit()

        board_dependency = require_plan_for_boards("pro", "Boards")
        playground_dependency = require_plan_for_playgrounds("pro", "Playgrounds")
        community_dependency = require_plan_for_community("free", "Communities")

        with patch(
            "src.security.features_utils.plan_check.get_deployment_mode",
            return_value="saas",
        ), patch(
            "src.security.features_utils.plan_check.plan_meets_requirement",
            return_value=True,
        ):
            # No discriminator → fall through (handler RBAC still runs).
            assert await board_dependency(_request(), db) is True
            assert await playground_dependency(_request(), db) is True
            assert await community_dependency(_request(), db) is True

            assert (
                await board_dependency(_request(path_params={"board_uuid": board.board_uuid}), db)
                is True
            )
            assert (
                await playground_dependency(
                    _request(path_params={"playground_uuid": playground.playground_uuid}),
                    db,
                )
                is True
            )
            assert (
                await community_dependency(
                    _request(path_params={"community_uuid": community.community_uuid}),
                    db,
                )
                is True
            )

        with patch(
            "src.security.features_utils.plan_check.get_deployment_mode",
            return_value="saas",
        ), patch(
            "src.security.features_utils.plan_check.plan_meets_requirement",
            return_value=False,
        ):
            with pytest.raises(HTTPException) as board_exc:
                await board_dependency(_request(path_params={"board_uuid": board.board_uuid}), db)
            with pytest.raises(HTTPException) as playground_exc:
                await playground_dependency(
                    _request(path_params={"playground_uuid": playground.playground_uuid}),
                    db,
                )
            with pytest.raises(HTTPException) as community_exc:
                await community_dependency(
                    _request(path_params={"community_uuid": community.community_uuid}),
                    db,
                )

        assert board_exc.value.status_code == 403
        assert playground_exc.value.status_code == 403
        assert community_exc.value.status_code == 403
