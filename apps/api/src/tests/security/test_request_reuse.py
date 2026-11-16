"""Auth checks reuse what the request already loaded instead of querying again."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import event

from src.db.courses.courses import Course
from src.db.usergroup_resources import UserGroupResource
from src.security.org_auth import get_user_org_rows, holds_admin_or_maintainer_role
from src.security.rbac.resource_access import (
    ResourceAccessChecker,
    _loaded_in_session,
    _resource_model,
)
from src.security.rbac.utils import get_element_organization_id
from src.services.courses.locks import batch_accessible_restricted_uuids


def _count_queries(db):
    """Collect every statement the session sends."""
    statements = []
    bind = db.sync_session.get_bind()

    @event.listens_for(bind, "before_cursor_execute")
    def _record(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    return statements, lambda: event.remove(bind, "before_cursor_execute", _record)


class TestLoadedInSession:
    async def test_returns_the_loaded_row(self, db, course):
        assert _loaded_in_session(db, Course, "course_uuid", "course_test") is course
        assert _loaded_in_session(db, Course, "course_uuid", "course_missing") is None

    async def test_skips_a_row_pending_delete(self, db, course):
        await db.delete(course)
        assert _loaded_in_session(db, Course, "course_uuid", "course_test") is None

    async def test_skips_an_expired_row(self, db, course):
        db.sync_session.expire(course)
        assert _loaded_in_session(db, Course, "course_uuid", "course_test") is None

    def test_test_double_session_is_ignored(self):
        assert _loaded_in_session(MagicMock(), Course, "course_uuid", "course_test") is None

    def test_unknown_resource_type(self):
        assert _resource_model("nope") is None
        for kind in (
            "podcasts", "communities", "folders", "media",
            "coursechapters", "activities", "episodes", "discussions",
        ):
            assert _resource_model(kind) is not None
        # Plays and boards are EE-only (ee/tests cover them with EE).
        assert _resource_model("playgrounds") is None
        assert _resource_model("boards") is None


class TestAccessCheckerReuse:
    async def test_checker_takes_the_course_from_the_session(self, db, course, regular_user):
        checker = ResourceAccessChecker(MagicMock(), db, regular_user)
        statements, stop = _count_queries(db)
        try:
            found = await checker._get_resource("course_test", SimpleNamespace(resource_type="courses"))
        finally:
            stop()
        assert found is course
        assert statements == []

    async def test_checker_queries_when_not_loaded(self, db, course, regular_user):
        db.sync_session.expunge(course)
        checker = ResourceAccessChecker(MagicMock(), db, regular_user)
        found = await checker._get_resource("course_test", SimpleNamespace(resource_type="courses"))
        assert found is not None and found.course_uuid == "course_test"
        # Memoized on the checker.
        assert await checker._get_resource("course_test", SimpleNamespace(resource_type="courses")) is found

    async def test_unknown_type_resolves_to_none(self, db, regular_user):
        checker = ResourceAccessChecker(MagicMock(), db, regular_user)
        assert await checker._get_resource("thing_1", SimpleNamespace(resource_type="unknown")) is None


class TestElementOrganizationId:
    async def test_placeholder_uuid_does_not_query(self, db):
        statements, stop = _count_queries(db)
        try:
            assert await get_element_organization_id("course_x", db) is None
        finally:
            stop()
        assert statements == []

    async def test_loaded_row_answers_without_query(self, db, course):
        statements, stop = _count_queries(db)
        try:
            assert await get_element_organization_id("course_test", db) == course.org_id
        finally:
            stop()
        assert statements == []

    async def test_queried_answer_is_remembered(self, db, course):
        db.sync_session.expunge(course)
        assert await get_element_organization_id("course_test", db) == 1
        statements, stop = _count_queries(db)
        try:
            assert await get_element_organization_id("course_test", db) == 1
        finally:
            stop()
        assert statements == []

    async def test_missing_element_is_asked_again(self, db):
        assert await get_element_organization_id("course_missing", db) is None
        assert "course_missing" not in db._element_org_cache

    async def test_session_without_attributes(self, db):
        class _Frozen:
            __slots__ = ()

            def __getattr__(self, name):
                return getattr(db, name)

        frozen = _Frozen()
        with patch(
            "src.security.rbac.utils._lookup_element_organization_id",
            new=AsyncMock(return_value=4),
        ):
            assert await get_element_organization_id("course_elsewhere", frozen) == 4


class TestMembershipRows:
    async def test_admin_and_member_share_one_lookup(self, db, org, admin_user, regular_user):
        db._user_org_cache = {}
        assert await holds_admin_or_maintainer_role(admin_user.id, org.id, db) is True
        statements, stop = _count_queries(db)
        try:
            rows = await get_user_org_rows(admin_user.id, org.id, db)
            assert await holds_admin_or_maintainer_role(admin_user.id, org.id, db) is True
        finally:
            stop()
        assert len(rows) == 1 and statements == []
        assert await holds_admin_or_maintainer_role(regular_user.id, org.id, db) is False

    async def test_non_member_is_not_remembered(self, db, org):
        db._user_org_cache = {}
        assert await get_user_org_rows(999, org.id, db) == []
        assert (999, org.id) not in db._user_org_cache


class TestUsergroupAccessMemo:
    async def test_unlinked_resources_are_remembered(self, db, regular_user):
        assert await batch_accessible_restricted_uuids(regular_user.id, ["course_a", "course_a", None], db) == set()
        statements, stop = _count_queries(db)
        try:
            assert await batch_accessible_restricted_uuids(regular_user.id, ["course_a"], db) == set()
        finally:
            stop()
        assert statements == []

    async def test_linked_but_not_granted_is_asked_again(self, db, org, regular_user):
        db.add(UserGroupResource(usergroup_id=77, resource_uuid="course_b", org_id=org.id,
                                 creation_date="now", update_date="now"))
        await db.commit()
        assert await batch_accessible_restricted_uuids(regular_user.id, ["course_b"], db) == set()
        assert (regular_user.id, "course_b") not in db._usergroup_access_cache

    async def test_granted_access_is_remembered(self, db, regular_user):
        with patch.object(db, "execute", new=AsyncMock(side_effect=[
            MagicMock(all=MagicMock(return_value=[("course_c", 5)])),
            MagicMock(scalars=MagicMock(return_value=MagicMock(all=MagicMock(return_value=[5])))),
        ])):
            assert await batch_accessible_restricted_uuids(regular_user.id, ["course_c"], db) == {"course_c"}
        with patch.object(db, "execute", new=AsyncMock(side_effect=AssertionError("queried"))):
            assert await batch_accessible_restricted_uuids(regular_user.id, ["course_c"], db) == {"course_c"}

    async def test_test_double_session(self):
        session = MagicMock()
        session.execute = AsyncMock(return_value=MagicMock(all=MagicMock(return_value=[])))

        class _NoAttrs:
            __slots__ = ("execute",)

        frozen = _NoAttrs()
        frozen.execute = session.execute
        assert await batch_accessible_restricted_uuids(1, ["course_d"], frozen) == set()


class TestCurrentUserMemo:
    async def test_second_call_reuses_the_resolved_user(self, db):
        from starlette.requests import Request

        from src.security.auth import get_current_user

        request = Request({"type": "http", "headers": [], "state": {}})
        first = await get_current_user(request, db)
        with patch("src.security.auth._resolve_current_user", new=AsyncMock(side_effect=AssertionError("resolved twice"))):
            assert await get_current_user(request, db) is first


class TestUsergroupGrantAfterRoles:
    async def test_usergroup_member_is_granted(self, db):
        from src.security.rbac import rbac

        with patch.object(rbac, "is_user_superadmin", new=AsyncMock(return_value=False)), \
                patch.object(rbac, "authorization_verify_if_user_is_author", new=AsyncMock(return_value=False)), \
                patch.object(rbac, "authorization_verify_based_on_roles", new=AsyncMock(return_value=False)), \
                patch.object(rbac, "check_usergroup_access", new=AsyncMock(return_value=True)):
            assert await rbac.authorization_verify_based_on_roles_and_authorship(
                MagicMock(), 5, "read", "course_test", db
            ) is True
