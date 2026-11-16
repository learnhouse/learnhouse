"""Lookups a lesson read repeats are answered once per request.

Covers the session memo (dropped on every write) and the rows other queries
already brought along: authorship from a course read's author join, roles
loaded with the membership rows, the org config joined onto a lesson read and
the "has any published translation" flag.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import event, text

from src.core.session_memo import session_memo
from src.db.organization_config import OrganizationConfig
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.security.auth import remember_user_email, remembered_user_email
from src.security.org_auth import get_user_org_rows, roles_of_memberships
from src.security.rbac.rbac import (
    _load_applicable_roles,
    authorization_verify_org_admin_by_id,
    remember_resource_authors,
    user_is_active_author,
)
from src.services.courses.translations.learner import _published_languages, note_published_translations
from src.services.orgs.org_config_lookup import get_session_org_config, remember_org_config


def _count_queries(db):
    statements = []
    bind = db.sync_session.get_bind()

    @event.listens_for(bind, "before_cursor_execute")
    def _record(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    return statements, lambda: event.remove(bind, "before_cursor_execute", _record)


def _author(user_id, status=ResourceAuthorshipStatusEnum.ACTIVE, authorship=ResourceAuthorshipEnum.CONTRIBUTOR):
    return ResourceAuthor(resource_uuid="course_test", user_id=user_id, authorship=authorship,
                          authorship_status=status, creation_date="now", update_date="now")


class TestSessionMemo:
    async def test_test_doubles_get_none(self):
        class _Bare:
            __slots__ = ()

        assert session_memo(_Bare()) is None
        assert session_memo(MagicMock()) is None

    async def test_dropped_on_every_write_commit_and_rollback(self, db, org):
        # Entries follow a read, so a transaction is open when they're stored.
        await db.execute(text("SELECT 1"))
        session_memo(db)["k"] = 1
        await db.commit()
        assert "k" not in session_memo(db)
        await db.execute(text("SELECT 1"))
        session_memo(db)["k"] = 1
        await db.rollback()
        assert "k" not in session_memo(db)
        session_memo(db)["k"] = 1
        db.add(_author(1))
        # Pending changes: neither served nor stored.
        assert session_memo(db) is None
        await db.flush()
        assert "k" not in session_memo(db)

    async def test_dropped_on_a_bulk_write(self, db, regular_user):
        from sqlmodel import update

        assert await user_is_active_author(regular_user.id, "course_test", db) is False
        session_memo(db)["k"] = 1
        await db.execute(update(ResourceAuthor).where(ResourceAuthor.user_id == -1).values(update_date="x"))
        assert "k" not in session_memo(db)


class TestAuthorship:
    async def test_answer_is_remembered(self, db, regular_user):
        assert await user_is_active_author(regular_user.id, "course_test", db) is False
        statements, stop = _count_queries(db)
        try:
            assert await user_is_active_author(regular_user.id, "course_test", db) is False
        finally:
            stop()
        assert statements == []

    async def test_new_author_row_is_seen(self, db, regular_user):
        assert await user_is_active_author(regular_user.id, "course_test", db) is False
        db.add(_author(regular_user.id))
        assert await user_is_active_author(regular_user.id, "course_test", db) is True

    async def test_inactive_or_reader_rows_are_not_authors(self, db, regular_user, admin_user):
        db.add(_author(regular_user.id, status=ResourceAuthorshipStatusEnum.PENDING))
        db.add(_author(admin_user.id, authorship=ResourceAuthorshipEnum.REPORTER))
        await db.commit()
        assert await user_is_active_author(regular_user.id, "course_test", db) is False
        assert await user_is_active_author(admin_user.id, "course_test", db) is False

    async def test_seeded_from_a_full_author_list(self, db, regular_user, admin_user):
        rows = [_author(admin_user.id)]
        remember_resource_authors(db, "course_test", admin_user.id, rows)
        remember_resource_authors(db, "course_test", regular_user.id, rows)
        with patch.object(db, "execute", new=AsyncMock(side_effect=AssertionError("queried"))):
            assert await user_is_active_author(admin_user.id, "course_test", db) is True
            assert await user_is_active_author(regular_user.id, "course_test", db) is False

    async def test_seeding_skips_anonymous_and_pending_sessions(self, db, regular_user):
        remember_resource_authors(db, "course_test", 0, [])
        assert ("active_author", "course_test", 0) not in session_memo(db)
        db.add(_author(regular_user.id))
        remember_resource_authors(db, "course_test", regular_user.id, [])
        await db.flush()
        assert await user_is_active_author(regular_user.id, "course_test", db) is True


class TestOrgAdminById:
    async def test_admin_member_superadmin_and_member(self, db, org, admin_user, regular_user):
        assert await authorization_verify_org_admin_by_id(admin_user.id, org.id, db) is True
        assert await authorization_verify_org_admin_by_id(regular_user.id, org.id, db) is False
        with patch("src.security.rbac.rbac.is_user_superadmin", new=AsyncMock(return_value=True)):
            assert await authorization_verify_org_admin_by_id(regular_user.id, org.id, db) is True


class TestRolesWithMemberships:
    async def test_roles_come_with_the_membership_rows(self, db, org, regular_user, user_role):
        db._user_org_cache = {}
        rows = await get_user_org_rows(regular_user.id, org.id, db)
        statements, stop = _count_queries(db)
        try:
            roles = await _load_applicable_roles(db, regular_user.id, org.id)
        finally:
            stop()
        assert statements == []
        assert [r.id for r in roles] == [user_role.id]
        assert [r.id for r in roles_of_memberships(db, regular_user.id, org.id, rows)] == [user_role.id]

    async def test_changed_role_is_queried_again(self, db, org, regular_user, admin_role):
        db._user_org_cache = {}
        rows = await get_user_org_rows(regular_user.id, org.id, db)
        rows[0].role_id = admin_role.id
        assert roles_of_memberships(db, regular_user.id, org.id, rows) is None
        roles = await _load_applicable_roles(db, regular_user.id, org.id)
        assert [r.id for r in roles] == [admin_role.id]

    async def test_missing_role_row_and_unloaded_cache(self, db, org):
        membership = SimpleNamespace(role_id=99)
        session_memo(db)[("org_roles", 5, org.id)] = {99: None}
        assert roles_of_memberships(db, 5, org.id, [membership]) == []
        assert roles_of_memberships(db, 6, org.id, [membership]) is None
        # A role the memo didn't load with the membership: query again.
        assert roles_of_memberships(db, 5, org.id, [SimpleNamespace(role_id=100)]) is None

    async def test_rollback_drops_the_loaded_roles(self, db, org, regular_user):
        db._user_org_cache = {}
        user_id, org_id = regular_user.id, org.id
        rows = await get_user_org_rows(user_id, org_id, db)
        await db.rollback()
        # Expired rows are never read: the caller queries roles again.
        assert roles_of_memberships(db, user_id, org_id, rows) is None

    async def test_commit_after_removal_drops_the_loaded_roles(self, db, org, regular_user):
        db._user_org_cache = {}
        user_id, org_id = regular_user.id, org.id
        rows = await get_user_org_rows(user_id, org_id, db)
        await db.delete(rows[0])
        await db.commit()
        assert roles_of_memberships(db, user_id, org_id, rows) is None


class TestMemoLifetime:
    async def test_close_drops_the_memo(self, db):
        await db.execute(text("SELECT 1"))
        session_memo(db)["k"] = 1
        await db.close()
        assert "k" not in session_memo(db)


class TestTranslationsFlag:
    async def test_course_without_translations_skips_the_lookup(self, db, course):
        note_published_translations(db, course.id, False)
        with patch.object(db, "execute", new=AsyncMock(side_effect=AssertionError("queried"))):
            assert await _published_languages(db, course.id) == {}

    async def test_noting_while_changes_are_pending_is_a_no_op(self, db, course):
        db.add(_author(1))
        note_published_translations(db, course.id, False)
        await db.flush()
        assert await _published_languages(db, course.id) == {}


class TestJoinedOrgConfig:
    async def test_pinned_config_is_reused(self, db, org):
        row = OrganizationConfig(org_id=org.id, config={"plan": "pro"}, creation_date="now", update_date="now")
        db.add(row)
        await db.commit()
        remember_org_config(db, org.id, row)
        with patch.object(db, "execute", new=AsyncMock(side_effect=AssertionError("queried"))):
            assert await get_session_org_config(db, org.id) is row

    async def test_missing_or_mismatched_rows_are_ignored(self, db, org):
        remember_org_config(db, org.id, None)
        remember_org_config(db, org.id + 1, SimpleNamespace(org_id=org.id))
        assert org.id + 1 not in db.sync_session.info.get("org_config_rows", {})
        remember_org_config(MagicMock(), org.id, SimpleNamespace(org_id=org.id))


class TestRememberedEmail:
    async def test_noted_for_the_signed_in_user(self, db, regular_user):
        remember_user_email(db, regular_user)
        assert remembered_user_email(db, regular_user.id) == (regular_user.email, bool(regular_user.email_verified))

    async def test_nothing_without_a_user_or_a_memo(self, db):
        remember_user_email(db, SimpleNamespace(id=None, email="x@test.com"))
        assert remembered_user_email(db, 0) is None
        assert remembered_user_email(MagicMock(), 1) is None
