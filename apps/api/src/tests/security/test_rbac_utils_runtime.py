from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from src.security.rbac.utils import (
    check_course_permissions_with_own,
    check_element_type,
    get_element_organization_id,
)


def _query_result(value):
    result = Mock()
    result.first.return_value = value
    return result


def _session_with_results(*values):
    session = Mock()
    session.exec.side_effect = [_query_result(value) for value in values]
    return session


class TestRBACUtilsRuntime:
    @pytest.mark.asyncio
    async def test_check_course_permissions_with_own_supports_dict_and_object_rights(self):
        assert await check_course_permissions_with_own(None, "read") is False
        assert await check_course_permissions_with_own({}, "read") is False

        assert (
            await check_course_permissions_with_own({"action_read": True}, "read")
            is True
        )

        rights = SimpleNamespace(action_update=True)
        assert await check_course_permissions_with_own(rights, "update") is True

        own_rights = SimpleNamespace(action_delete_own=True)
        assert (
            await check_course_permissions_with_own(own_rights, "delete", is_author=True)
            is True
        )

        assert (
            await check_course_permissions_with_own(own_rights, "delete", is_author=False)
            is False
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "element_uuid,expected",
        [
            ("community_123", "communities"),
            ("discussion_123", "discussions"),
            ("vote_123", "votes"),
            ("podcast_123", "podcasts"),
            ("episode_123", "episodes"),
            ("board_123", "boards"),
            ("playground_123", "playgrounds"),
        ],
    )
    async def test_check_element_type_handles_remaining_prefixes(self, element_uuid, expected):
        assert await check_element_type(element_uuid) == expected

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "element_uuid,results,expected",
        [
            ("course_1", [11], 11),
            ("course_2", [None], None),
            ("chapter_1", [12], 12),
            ("chapter_2", [None], None),
            ("activity_1", [13], 13),
            ("activity_2", [None], None),
            ("collection_1", [14], 14),
            ("collection_2", [None], None),
            ("org_1", [15], 15),
            ("org_2", [None], None),
            ("role_1", [16], 16),
            ("role_2", [None], None),
            ("usergroup_1", [17], 17),
            ("usergroup_2", [None], None),
            ("user_1", [], None),
            ("house_1", [], None),
            ("community_1", [18], 18),
            ("community_2", [None], None),
            ("discussion_1", [19], 19),
            ("discussion_2", [None], None),
            ("vote_1", [21], 21),
            ("vote_2", [None], None),
            ("podcast_1", [22], 22),
            ("podcast_2", [None], None),
            ("episode_1", [23], 23),
            ("episode_2", [None], None),
            ("board_1", [24], 24),
            ("board_2", [None], None),
        ],
    )
    async def test_get_element_organization_id_covers_remaining_branches(
        self,
        element_uuid,
        results,
        expected,
    ):
        session = _session_with_results(*results)

        assert await get_element_organization_id(element_uuid, session) == expected

    @pytest.mark.asyncio
    async def test_get_element_organization_id_unknown_type_returns_none(self):
        session = Mock()

        with patch(
            "src.security.rbac.utils.check_element_type",
            new=AsyncMock(return_value="mystery"),
        ):
            assert await get_element_organization_id("mystery_1", session) is None

        session.exec.assert_not_called()
