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

        assert low_plan_exc.value.status_code == 403
        assert missing_org_exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_require_plan_for_usergroups(self, db, org):
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
            return_value=False,
        ):
            with pytest.raises(HTTPException) as exc:
                await dependency(_request(path_params={"usergroup_id": str(usergroup.id)}), db)

            assert await dependency(_request(path_params={"usergroup_id": "missing"}), db) is True

        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_require_plan_for_certifications(self, db, org, course, regular_user):
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

        with patch(
            "src.security.features_utils.plan_check.get_deployment_mode",
            return_value="saas",
        ), patch(
            "src.security.features_utils.plan_check.plan_meets_requirement",
            side_effect=[False, False, True],
        ):
            with pytest.raises(HTTPException) as board_exc:
                await require_plan_for_boards("pro", "Boards")(
                    _request(path_params={"board_uuid": board.board_uuid}), db
                )
            with pytest.raises(HTTPException) as playground_exc:
                await require_plan_for_playgrounds("pro", "Playgrounds")(
                    _request(path_params={"playground_uuid": playground.playground_uuid}), db
                )

            assert (
                await require_plan_for_community("free", "Communities")(
                    _request(path_params={"community_uuid": community.community_uuid}), db
                )
                is True
            )

        assert board_exc.value.status_code == 403
        assert playground_exc.value.status_code == 403
