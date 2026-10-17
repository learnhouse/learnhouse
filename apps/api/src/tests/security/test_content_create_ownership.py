"""
Adding content (chapters, activities, episodes, ...) to an existing course or
podcast needs the right to change that resource: authorship, admin/maintainer,
or a role whose update right covers it. The role's create right only allows
making new top-level resources, so an instructor who can create their own
courses must not be able to add content to someone else's.
"""

from datetime import datetime

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.db.courses.activities import (
    ActivityCreate,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.chapters import ChapterCreate
from src.db.podcasts.episodes import PodcastEpisodeCreate
from src.db.podcasts.podcasts import Podcast
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.roles import (
    DashboardPermission,
    Permission,
    PermissionsWithOwn,
    Rights,
    Role,
    RoleTypeEnum,
)
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.security.rbac import AccessAction, check_resource_access
from src.services.courses.activities.activities import create_activity
from src.services.courses.chapters import create_chapter
from src.services.podcasts.episodes import create_episode
from src.tests.conftest import ADMIN_RIGHTS

NOW = str(datetime.now())


def _own_only() -> PermissionsWithOwn:
    """Mirrors the built-in instructor role: create new, edit only your own."""
    return PermissionsWithOwn(
        action_create=True,
        action_read=True,
        action_read_own=True,
        action_update=False,
        action_update_own=True,
        action_delete=False,
        action_delete_own=True,
    )


def _perm(create: bool) -> Permission:
    return Permission(
        action_create=create, action_read=True, action_update=False, action_delete=False
    )


INSTRUCTOR_RIGHTS = Rights(
    courses=_own_only(),
    users=_perm(False),
    usergroups=_perm(False),
    folders=_perm(False),
    media=_perm(True),
    organizations=_perm(False),
    coursechapters=_perm(True),
    activities=_perm(True),
    roles=_perm(False),
    dashboard=DashboardPermission(action_access=True),
    communities=_perm(False),
    discussions=_own_only(),
    podcasts=_own_only(),
    boards=_own_only(),
    playgrounds=_own_only(),
)


def _request() -> Request:
    # Fresh request per call so the per-request access checker cache never
    # carries a decision from one user to another.
    return Request(
        {"type": "http", "method": "POST", "path": "/", "headers": [], "query_string": b""}
    )


async def _make_user(db, *, uid: int, username: str, org_id: int, role_id: int) -> PublicUser:
    u = User(
        id=uid,
        username=username,
        first_name=username,
        last_name="User",
        email=f"{username}@test.com",
        password="hashed_password",
        user_uuid=f"user_{username}",
        creation_date=NOW,
        update_date=NOW,
    )
    db.add(u)
    db.add(
        UserOrganization(
            user_id=uid, org_id=org_id, role_id=role_id, creation_date=NOW, update_date=NOW
        )
    )
    await db.commit()
    return PublicUser(
        id=u.id,
        username=u.username,
        first_name=u.first_name,
        last_name=u.last_name,
        email=u.email,
        user_uuid=u.user_uuid,
    )


async def _add_author(db, *, resource_uuid: str, user_id: int, authorship) -> None:
    db.add(
        ResourceAuthor(
            resource_uuid=resource_uuid,
            user_id=user_id,
            authorship=authorship,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
            creation_date=NOW,
            update_date=NOW,
        )
    )
    await db.commit()


@pytest.fixture
async def instructor_role(db, org):
    r = Role(
        id=3,
        name="Instructor",
        org_id=org.id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_instructor",
        rights=INSTRUCTOR_RIGHTS.model_dump(),
        creation_date=NOW,
        update_date=NOW,
    )
    db.add(r)
    await db.commit()
    return r


@pytest.fixture
async def instructor(db, org, instructor_role):
    return await _make_user(db, uid=10, username="instructor", org_id=org.id, role_id=instructor_role.id)


@pytest.fixture
async def podcast(db, org):
    p = Podcast(
        id=1,
        name="Test Podcast",
        description="d",
        public=True,
        published=True,
        org_id=org.id,
        podcast_uuid="podcast_test",
        creation_date=NOW,
        update_date=NOW,
    )
    db.add(p)
    await db.commit()
    return p


async def _allowed(db, user, resource_uuid: str) -> bool:
    decision = await check_resource_access(
        _request(), db, user, resource_uuid, AccessAction.CREATE, raise_on_deny=False
    )
    return decision.allowed


class TestCreateContentNeedsOwnership:
    @pytest.mark.asyncio
    async def test_instructor_cannot_add_to_course_they_do_not_author(self, db, course, instructor):
        assert not await _allowed(db, instructor, course.course_uuid)

    @pytest.mark.asyncio
    async def test_instructor_cannot_add_to_podcast_they_do_not_author(self, db, podcast, instructor):
        assert not await _allowed(db, instructor, podcast.podcast_uuid)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "authorship",
        [
            ResourceAuthorshipEnum.CREATOR,
            ResourceAuthorshipEnum.MAINTAINER,
            ResourceAuthorshipEnum.CONTRIBUTOR,
        ],
    )
    async def test_author_can_add_to_own_course(self, db, course, instructor, authorship):
        await _add_author(db, resource_uuid=course.course_uuid, user_id=instructor.id, authorship=authorship)
        assert await _allowed(db, instructor, course.course_uuid)

    @pytest.mark.asyncio
    async def test_author_can_add_to_own_podcast(self, db, podcast, instructor):
        await _add_author(
            db, resource_uuid=podcast.podcast_uuid, user_id=instructor.id,
            authorship=ResourceAuthorshipEnum.CREATOR,
        )
        assert await _allowed(db, instructor, podcast.podcast_uuid)

    @pytest.mark.asyncio
    async def test_admin_can_add_to_any_course_and_podcast(self, db, course, podcast, admin_user):
        assert await _allowed(db, admin_user, course.course_uuid)
        assert await _allowed(db, admin_user, podcast.podcast_uuid)

    @pytest.mark.asyncio
    async def test_custom_role_with_update_any_can_add(self, db, org, course, podcast):
        # A custom (non admin/maintainer id) role that may edit every course
        # and podcast can also add content to them.
        editor_role = Role(
            id=60,
            name="Editor",
            org_id=org.id,
            role_type=RoleTypeEnum.TYPE_ORGANIZATION,
            role_uuid="role_editor",
            rights=ADMIN_RIGHTS.model_dump(),
            creation_date=NOW,
            update_date=NOW,
        )
        db.add(editor_role)
        await db.commit()
        editor = await _make_user(db, uid=11, username="editor", org_id=org.id, role_id=editor_role.id)
        assert await _allowed(db, editor, course.course_uuid)
        assert await _allowed(db, editor, podcast.podcast_uuid)

    @pytest.mark.asyncio
    async def test_instructor_can_still_create_new_courses(self, db, org, instructor):
        assert await _allowed(db, instructor, "course_x")


class TestCreateEndpointsRefuseNonAuthors:
    @pytest.mark.asyncio
    async def test_create_chapter(self, db, org, course, instructor):
        with pytest.raises(HTTPException) as exc:
            await create_chapter(
                _request(),
                ChapterCreate(name="x", description="x", org_id=org.id, course_id=course.id),
                instructor,
                db,
            )
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_create_activity(self, db, org, course, chapter, instructor):
        with pytest.raises(HTTPException) as exc:
            await create_activity(
                _request(),
                ActivityCreate(
                    name="x",
                    chapter_id=chapter.id,
                    activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
                    activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
                    content={"type": "doc", "content": []},
                    published=True,
                ),
                instructor,
                db,
            )
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_create_episode(self, db, org, podcast, instructor):
        with pytest.raises(HTTPException) as exc:
            await create_episode(
                _request(),
                podcast.podcast_uuid,
                PodcastEpisodeCreate(title="x", description="x"),
                instructor,
                db,
            )
        assert exc.value.status_code == 403
