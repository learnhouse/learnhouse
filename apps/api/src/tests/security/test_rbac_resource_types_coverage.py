"""
Coverage for the media_/board_/playground_ resource-type resolution branches.

Targets:
- src/security/rbac/utils.py            26, 96, 154, 155
- src/security/rbac/resource_access.py  845-847, 850-852, 855-856
- src/security/rbac/rbac.py             158-163

These tests exercise the real RBAC resolution functions (no RBAC bypass) with
Media, Board and Playground rows inserted directly via their model classes.
"""

import pytest
from unittest.mock import Mock
from starlette.requests import Request

from src.security.rbac.utils import (
    check_element_type,
    get_singular_form_of_element,
    get_element_organization_id,
)
from src.security.rbac.rbac import authorization_verify_if_element_is_public
from src.security.rbac.resource_access import ResourceAccessChecker
from src.security.rbac.types import ResourceConfig
from src.db.media.media import Media, MediaTypeEnum
from src.db.boards import Board
from src.db.playgrounds import Playground
from src.db.users import AnonymousUser


# ---------------------------------------------------------------------------
# Row helpers
# ---------------------------------------------------------------------------

async def _insert_media(db, org, uuid="media_test", public=True):
    m = Media(
        name="Test Media",
        description="",
        media_type=MediaTypeEnum.UPLOAD,
        public=public,
        org_id=org.id,
        media_uuid=uuid,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


async def _insert_board(db, org, uuid="board_test", public=True):
    b = Board(
        name="Test Board",
        public=public,
        org_id=org.id,
        board_uuid=uuid,
        created_by=None,
    )
    db.add(b)
    await db.commit()
    await db.refresh(b)
    return b


async def _insert_playground(db, org, uuid="playground_test"):
    p = Playground(
        name="Test Playground",
        org_id=org.id,
        playground_uuid=uuid,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


# ---------------------------------------------------------------------------
# utils.py 26 and 96 — media element-type / singular-form resolution
# ---------------------------------------------------------------------------

class TestUtilsMediaType:
    @pytest.mark.asyncio
    async def test_check_element_type_media(self):
        """utils.py:26 — media_ prefix resolves to 'media'."""
        assert await check_element_type("media_abc") == "media"

    @pytest.mark.asyncio
    async def test_get_singular_form_of_element_media(self):
        """utils.py:96 — singular form of a media element is 'media'."""
        assert await get_singular_form_of_element("media_abc") == "media"


# ---------------------------------------------------------------------------
# utils.py 154,155 — get_element_organization_id for a media_ uuid
# ---------------------------------------------------------------------------

class TestGetElementOrgIdMedia:
    @pytest.mark.asyncio
    async def test_media_org_id(self, db, org):
        """utils.py:153-155 — media branch returns the owning org id."""
        await _insert_media(db, org, uuid="media_orgcheck")
        result = await get_element_organization_id("media_orgcheck", db)
        assert result == org.id


# ---------------------------------------------------------------------------
# resource_access.py 845-856 — _get_resource for media / board / playground
# ---------------------------------------------------------------------------

class TestGetResourceMediaBoardPlayground:
    def _checker(self, db):
        request = Mock(spec=Request)
        request.state = type("S", (), {})()
        return ResourceAccessChecker(request, db, AnonymousUser())

    @pytest.mark.asyncio
    async def test_get_resource_media(self, db, org):
        """resource_access.py:845-847 — media resource resolves by uuid."""
        await _insert_media(db, org, uuid="media_load")
        checker = self._checker(db)
        config = ResourceConfig(
            resource_type="media",
            uuid_prefix="media_",
            has_published_field=False,
            supports_usergroups=True,
            supports_authorship=True,
            model_name="Media",
            uuid_field="media_uuid",
        )
        resource = await checker._get_resource("media_load", config)
        assert resource is not None
        assert resource.media_uuid == "media_load"

    @pytest.mark.asyncio
    async def test_get_resource_board(self, db, org):
        """resource_access.py:850-852 — board resource resolves by uuid."""
        await _insert_board(db, org, uuid="board_load")
        checker = self._checker(db)
        config = ResourceConfig(
            resource_type="boards",
            uuid_prefix="board_",
            has_published_field=False,
            supports_usergroups=True,
            supports_authorship=True,
            model_name="Board",
            uuid_field="board_uuid",
        )
        resource = await checker._get_resource("board_load", config)
        assert resource is not None
        assert resource.board_uuid == "board_load"

    @pytest.mark.asyncio
    async def test_get_resource_playground(self, db, org):
        """resource_access.py:855-856 — playground resource resolves by uuid."""
        await _insert_playground(db, org, uuid="playground_load")
        checker = self._checker(db)
        config = ResourceConfig(
            resource_type="playgrounds",
            uuid_prefix="playground_",
            has_published_field=False,
            supports_usergroups=True,
            supports_authorship=True,
            model_name="Playground",
            uuid_field="playground_uuid",
        )
        resource = await checker._get_resource("playground_load", config)
        assert resource is not None
        assert resource.playground_uuid == "playground_load"


# ---------------------------------------------------------------------------
# rbac.py 158-163 — media branch of authorization_verify_if_element_is_public
# ---------------------------------------------------------------------------

class TestVerifyPublicMedia:
    @pytest.mark.asyncio
    async def test_public_media_is_allowed(self, db, org, mock_request):
        """rbac.py:158-163 — public media read passes the public check."""
        await _insert_media(db, org, uuid="media_public", public=True)
        result = await authorization_verify_if_element_is_public(
            mock_request, "media_public", "read", db
        )
        assert result is True

    @pytest.mark.asyncio
    async def test_private_media_is_denied(self, db, org, mock_request):
        """rbac.py:158-169 — non-public media read raises 403 (media lookup runs)."""
        from fastapi import HTTPException

        await _insert_media(db, org, uuid="media_private", public=False)
        with pytest.raises(HTTPException) as exc_info:
            await authorization_verify_if_element_is_public(
                mock_request, "media_private", "read", db
            )
        assert exc_info.value.status_code == 403
