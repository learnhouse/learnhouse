"""Access-control regressions (round 3).

1. Podcast episode files: podcast READ + published episode/podcast, org segment.
2. Search: usergroup-restricted communities, discussions and podcasts.
3. Usergroup member roster is a management view.
4. Folders: same-org parents/resources, no private item metadata.
5. Assignment submission writes run the activity reader gate.
6. Code submissions: activity gate, size caps, server-derived ``passed``.
7. Podcast visibility: only ACTIVE authorships count.
"""


import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

import src.routers.content_files as content_files
import src.routers.local_content as local_content
from src.core.events.database import get_db_session
from src.db.communities.communities import Community
from src.db.communities.discussions import Discussion
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmissionUpdate,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.courses.courses import Course
from src.db.folders.folder_content import FolderContent
from src.db.folders.folders import Folder, FolderUpdate
from src.db.podcasts.episodes import PodcastEpisode
from src.db.podcasts.podcasts import Podcast
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.routers.code_submissions import router as code_submissions_router
from src.security.auth import get_current_user
from src.tests.fixtures.rows import activity_row

NOW = "2024-01-01"
ROUTERS = [content_files, local_content]


def _podcast(id, org_id, uuid, public=True, published=True):
    return Podcast(
        id=id, name=uuid, description="d", public=public, published=published,
        org_id=org_id, podcast_uuid=uuid, creation_date=NOW, update_date=NOW,
    )


def _episode(id, podcast_id, org_id, uuid, published=True):
    return PodcastEpisode(
        id=id, podcast_id=podcast_id, org_id=org_id, title="Ep",
        published=published, episode_uuid=uuid, creation_date=NOW, update_date=NOW,
    )


def _course(id, org_id, uuid, public=True, published=True):
    return Course(
        id=id, name=uuid, description="d", public=public, published=published,
        open_to_contributors=False, org_id=org_id, course_uuid=uuid,
        creation_date=NOW, update_date=NOW,
    )


async def _usergroup(db, org_id, ug_id, resource_uuid, member_id=None):
    db.add(UserGroup(
        id=ug_id, name=f"g{ug_id}", description="", org_id=org_id,
        usergroup_uuid=f"usergroup_{ug_id}", creation_date=NOW, update_date=NOW,
    ))
    db.add(UserGroupResource(
        usergroup_id=ug_id, resource_uuid=resource_uuid, org_id=org_id,
        creation_date=NOW, update_date=NOW,
    ))
    if member_id is not None:
        db.add(UserGroupUser(
            usergroup_id=ug_id, user_id=member_id, org_id=org_id,
            creation_date=NOW, update_date=NOW,
        ))
    await db.commit()


async def _status(coro):
    try:
        await coro
    except HTTPException as exc:
        return exc.status_code
    return 200


# ---------------------------------------------------------------------------
# 1. Podcast episode files
# ---------------------------------------------------------------------------

@pytest.fixture
async def podcast_rows(db, org):
    db.add(_podcast(61, org.id, "podcast_pub"))
    db.add(_podcast(62, org.id, "podcast_draft", published=False))
    db.add(_episode(61, 61, org.id, "episode_pub"))
    db.add(_episode(62, 61, org.id, "episode_draft", published=False))
    db.add(_episode(63, 62, org.id, "episode_in_draft_podcast"))
    await db.commit()


@pytest.mark.parametrize("router", ROUTERS, ids=["s3", "local"])
class TestPodcastEpisodeFiles:
    async def test_anonymous_gets_published_episode_of_public_podcast(
        self, router, db, org, podcast_rows, anonymous_user, mock_request
    ):
        path = "orgs/org_test/podcasts/podcast_pub/episodes/episode_pub/a.mp3"
        assert await _status(router._check_content_access(path, anonymous_user, db, mock_request)) == 200

    async def test_unpublished_episode_hidden_from_anonymous_and_learner(
        self, router, db, org, podcast_rows, anonymous_user, regular_user, mock_request
    ):
        path = "orgs/org_test/podcasts/podcast_pub/episodes/episode_draft/a.mp3"
        assert await _status(router._check_content_access(path, anonymous_user, db, mock_request)) == 404
        assert await _status(router._check_content_access(path, regular_user, db, mock_request)) == 404

    async def test_unpublished_podcast_refused(
        self, router, db, org, podcast_rows, anonymous_user, regular_user, mock_request
    ):
        path = "orgs/org_test/podcasts/podcast_draft/episodes/episode_in_draft_podcast/a.mp3"
        assert await _status(router._check_content_access(path, anonymous_user, db, mock_request)) == 401
        assert await _status(router._check_content_access(path, regular_user, db, mock_request)) in (403, 404)

    async def test_editor_gets_unpublished_episode(
        self, router, db, org, podcast_rows, admin_user, mock_request
    ):
        path = "orgs/org_test/podcasts/podcast_pub/episodes/episode_draft/a.mp3"
        assert await _status(router._check_content_access(path, admin_user, db, mock_request)) == 200
        path = "orgs/org_test/podcasts/podcast_draft/episodes/episode_in_draft_podcast/a.mp3"
        assert await _status(router._check_content_access(path, admin_user, db, mock_request)) == 200

    async def test_episode_of_another_podcast_is_404(
        self, router, db, org, podcast_rows, admin_user, mock_request
    ):
        path = "orgs/org_test/podcasts/podcast_draft/episodes/episode_pub/a.mp3"
        assert await _status(router._check_content_access(path, admin_user, db, mock_request)) == 404

    async def test_foreign_org_segment_is_404(
        self, router, db, org, other_org, podcast_rows, course, activity,
        anonymous_user, mock_request,
    ):
        podcast_path = "orgs/org_other/podcasts/podcast_pub/episodes/episode_pub/a.mp3"
        assert await _status(router._check_content_access(podcast_path, anonymous_user, db, mock_request)) == 404
        activity_path = "orgs/org_other/courses/course_test/activities/activity_test/v.mp4"
        assert await _status(router._check_content_access(activity_path, anonymous_user, db, mock_request)) == 404
        # Sanity: the right org segment is served.
        ok_path = "orgs/org_test/courses/course_test/activities/activity_test/v.mp4"
        assert await _status(router._check_content_access(ok_path, anonymous_user, db, mock_request)) == 200


# ---------------------------------------------------------------------------
# 2. Search
# ---------------------------------------------------------------------------

class TestSearchUsergroupVisibility:
    @pytest.fixture
    async def restricted(self, db, org, admin_user):
        db.add(Community(
            id=71, name="zeta open", description="", public=False, org_id=org.id,
            community_uuid="community_open", creation_date=NOW, update_date=NOW,
        ))
        db.add(Community(
            id=72, name="zeta locked", description="", public=False, org_id=org.id,
            community_uuid="community_locked", creation_date=NOW, update_date=NOW,
        ))
        db.add(Discussion(
            id=71, title="zeta thread", content="", community_id=72, org_id=org.id,
            author_id=admin_user.id, discussion_uuid="discussion_locked",
            creation_date=NOW, update_date=NOW,
        ))
        db.add(_podcast(71, org.id, "podcast_open", public=False))
        db.add(_podcast(72, org.id, "podcast_locked", public=False))
        await db.commit()
        # Rename podcasts so the query matches them.
        for p in (await db.execute(select(Podcast).where(Podcast.id.in_([71, 72])))).scalars():
            p.name = f"zeta {p.podcast_uuid}"
        await db.commit()
        await _usergroup(db, org.id, 71, "community_locked")
        await _usergroup(db, org.id, 72, "podcast_locked")

    async def _search(self, mock_request, user, db):
        from src.services.search.search import search_across_org
        return await search_across_org(mock_request, user, "test-org", "zeta", db)

    async def test_learner_outside_group_sees_only_org_wide_items(
        self, db, org, restricted, regular_user, mock_request
    ):
        result = await self._search(mock_request, regular_user, db)
        assert {c.community_uuid for c in result.communities} == {"community_open"}
        assert result.discussions == []
        assert {p.podcast_uuid for p in result.podcasts} == {"podcast_open"}

    async def test_group_member_sees_restricted_items(
        self, db, org, restricted, regular_user, mock_request
    ):
        for ug_id in (71, 72):
            db.add(UserGroupUser(
                usergroup_id=ug_id, user_id=regular_user.id, org_id=org.id,
                creation_date=NOW, update_date=NOW,
            ))
        await db.commit()
        result = await self._search(mock_request, regular_user, db)
        assert {c.community_uuid for c in result.communities} == {"community_open", "community_locked"}
        assert [d.discussion_uuid for d in result.discussions] == ["discussion_locked"]
        assert {p.podcast_uuid for p in result.podcasts} == {"podcast_open", "podcast_locked"}

    async def test_admin_sees_everything(self, db, org, restricted, admin_user, mock_request):
        result = await self._search(mock_request, admin_user, db)
        assert len(result.communities) == 2
        assert len(result.discussions) == 1
        assert len(result.podcasts) == 2

    async def test_anonymous_sees_nothing_private(
        self, db, org, restricted, anonymous_user, mock_request
    ):
        result = await self._search(mock_request, anonymous_user, db)
        assert result.communities == [] and result.discussions == [] and result.podcasts == []


# ---------------------------------------------------------------------------
# 3. Usergroup member roster
# ---------------------------------------------------------------------------

class TestUsergroupRoster:
    async def test_learner_refused_manager_allowed(
        self, db, org, admin_user, regular_user, mock_request
    ):
        from src.services.users.usergroups import get_users_linked_to_usergroup

        await _usergroup(db, org.id, 81, "course_test", member_id=admin_user.id)
        assert await _status(get_users_linked_to_usergroup(mock_request, db, regular_user, 81)) == 403
        users = await get_users_linked_to_usergroup(mock_request, db, admin_user, 81)
        assert [u.username for u in users] == ["admin"]

    async def test_anonymous_refused(self, db, org, anonymous_user, mock_request):
        from src.services.users.usergroups import get_users_linked_to_usergroup

        await _usergroup(db, org.id, 82, "course_test")
        assert await _status(get_users_linked_to_usergroup(mock_request, db, anonymous_user, 82)) in (401, 403)


# ---------------------------------------------------------------------------
# 4. Folders
# ---------------------------------------------------------------------------

class TestFolders:
    async def _folder(self, db, id, org_id, uuid, public=True):
        db.add(Folder(
            id=id, name=uuid, description="", public=public, org_id=org_id,
            folder_uuid=uuid, creation_date=NOW, update_date=NOW,
        ))
        await db.commit()

    async def test_reparent_into_other_org_refused(
        self, db, org, other_org, admin_user, mock_request, bypass_webhooks
    ):
        from src.services.folders.folders import update_folder

        await self._folder(db, 91, org.id, "folder_mine")
        await self._folder(db, 92, other_org.id, "folder_theirs")
        status = await _status(update_folder(
            mock_request, FolderUpdate(parent_folder_uuid="folder_theirs"),
            "folder_mine", admin_user, db,
        ))
        assert status == 400
        folder = (await db.execute(select(Folder).where(Folder.id == 91))).scalars().one()
        assert folder.parent_folder_id is None

    async def test_add_other_org_resource_refused(
        self, db, org, other_org, admin_user, mock_request
    ):
        from src.services.folders.folders import add_folder_content

        await self._folder(db, 93, org.id, "folder_add")
        db.add(_course(93, other_org.id, "course_foreign"))  # public + published
        await db.commit()
        status = await _status(add_folder_content(
            mock_request, "folder_add", "course_foreign", admin_user, db
        ))
        assert status == 400
        rows = (await db.execute(select(FolderContent).where(FolderContent.folder_id == 93))).scalars().all()
        assert rows == []

    @pytest.fixture
    async def mixed_folder(self, db, org):
        await self._folder(db, 94, org.id, "folder_mixed")
        db.add(_course(94, org.id, "course_ok"))
        db.add(_course(95, org.id, "course_draft", published=False))
        db.add(_course(96, org.id, "course_grouped", public=False))
        db.add(_podcast(94, org.id, "podcast_draft_f", published=False))
        for i, uuid in enumerate(["course_ok", "course_draft", "course_grouped", "podcast_draft_f"]):
            db.add(FolderContent(
                folder_id=94, resource_uuid=uuid, org_id=org.id, position=i,
                creation_date=NOW, update_date=NOW,
            ))
        await db.commit()
        await _usergroup(db, org.id, 94, "course_grouped")

    async def _items(self, mock_request, user, db):
        from src.services.folders.folders import get_folder
        folder = await get_folder(mock_request, "folder_mixed", user, db)
        return {i.resource_uuid for i in folder.items}

    async def test_learner_does_not_see_drafts_or_restricted(
        self, db, org, mixed_folder, regular_user, mock_request
    ):
        assert await self._items(mock_request, regular_user, db) == {"course_ok"}

    async def test_group_member_sees_restricted(
        self, db, org, mixed_folder, regular_user, mock_request
    ):
        db.add(UserGroupUser(
            usergroup_id=94, user_id=regular_user.id, org_id=org.id,
            creation_date=NOW, update_date=NOW,
        ))
        await db.commit()
        assert await self._items(mock_request, regular_user, db) == {"course_ok", "course_grouped"}

    async def test_admin_sees_all(self, db, org, mixed_folder, admin_user, mock_request):
        assert await self._items(mock_request, admin_user, db) == {
            "course_ok", "course_draft", "course_grouped", "podcast_draft_f",
        }

    async def test_anonymous_does_not_see_public_draft(
        self, db, org, mixed_folder, anonymous_user, mock_request
    ):
        assert await self._items(mock_request, anonymous_user, db) == {"course_ok"}


# ---------------------------------------------------------------------------
# 5. Assignment submission writes
# ---------------------------------------------------------------------------

class TestAssignmentSubmissionGate:
    @pytest.fixture
    async def draft_task(self, db, org, course, chapter):
        db.add(activity_row(101, org.id, course.id, "activity_draft_asg", published=False))
        db.add(Assignment(
            id=101, title="A", description="d", due_date="2030-01-01", published=True,
            grading_type=GradingTypeEnum.NUMERIC, auto_grading=False,
            org_id=org.id, course_id=course.id, chapter_id=chapter.id, activity_id=101,
            assignment_uuid="assignment_draft", creation_date=NOW, update_date=NOW,
        ))
        db.add(AssignmentTask(
            id=101, title="T", description="d", hint="", reference_file=None,
            assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER, contents={},
            max_grade_value=100, assignment_id=101, org_id=org.id, course_id=course.id,
            chapter_id=chapter.id, activity_id=101, assignment_task_uuid="assignmenttask_draft",
            creation_date=NOW, update_date=NOW,
        ))
        await db.commit()

    async def test_learner_cannot_answer_task_of_draft_activity(
        self, db, org, draft_task, regular_user, mock_request
    ):
        from src.services.courses.activities.assignments import handle_assignment_task_submission

        status = await _status(handle_assignment_task_submission(
            mock_request, "assignmenttask_draft",
            AssignmentTaskSubmissionUpdate(task_submission={"answer": "x"}),
            regular_user, db,
        ))
        assert status == 404

    async def test_learner_cannot_upload_file_to_draft_activity(
        self, db, org, draft_task, regular_user, mock_request
    ):
        from src.services.courses.activities.assignments import put_assignment_task_submission_file

        status = await _status(put_assignment_task_submission_file(
            mock_request, db, "assignmenttask_draft", regular_user, None,
        ))
        assert status == 404


# ---------------------------------------------------------------------------
# 6. Code submissions
# ---------------------------------------------------------------------------

@pytest.fixture
def code_app(db, regular_user):
    app = FastAPI()
    app.include_router(code_submissions_router, prefix="/code/submissions")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: regular_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def code_client(code_app):
    async with AsyncClient(transport=ASGITransport(app=code_app), base_url="http://test") as c:
        yield c


def _code_body(activity_uuid="activity_test", **overrides):
    body = {
        "activity_uuid": activity_uuid, "block_id": "b1", "language_id": 71,
        "source_code": "print(1)", "results": {"items": []},
        "passed": True, "total_tests": 3, "passed_tests": 1,
    }
    body.update(overrides)
    return body


class TestCodeSubmissions:
    async def test_passed_is_derived_not_trusted(self, code_client, activity):
        resp = await code_client.post("/code/submissions/save", json=_code_body())
        assert resp.status_code == 200
        assert resp.json()["passed"] is False
        resp = await code_client.post(
            "/code/submissions/save", json=_code_body(passed=False, passed_tests=3)
        )
        assert resp.json()["passed"] is True

    async def test_draft_activity_refused(self, db, org, course, code_client):
        db.add(activity_row(111, org.id, course.id, "activity_draft_code", published=False))
        await db.commit()
        resp = await code_client.post(
            "/code/submissions/save", json=_code_body("activity_draft_code")
        )
        assert resp.status_code == 404
        resp = await code_client.get(
            "/code/submissions/history",
            params={"activity_uuid": "activity_draft_code", "block_id": "b1"},
        )
        assert resp.status_code == 404

    async def test_unknown_activity_refused(self, code_client):
        resp = await code_client.post("/code/submissions/save", json=_code_body("activity_nope"))
        assert resp.status_code == 404

    async def test_private_course_activity_refused_to_non_member(
        self, db, org, other_org, code_app, code_client, regular_user
    ):
        db.add(_course(112, other_org.id, "course_foreign_priv", public=False))
        db.add(activity_row(112, other_org.id, 112, "activity_foreign"))
        await db.commit()
        resp = await code_client.post("/code/submissions/save", json=_code_body("activity_foreign"))
        assert resp.status_code == 403

    async def test_size_caps(self, code_client, activity):
        resp = await code_client.post(
            "/code/submissions/save", json=_code_body(source_code="x" * 200_001)
        )
        assert resp.status_code == 413
        resp = await code_client.post(
            "/code/submissions/save", json=_code_body(results={"blob": "y" * 1_000_001})
        )
        assert resp.status_code == 413
        resp = await code_client.post(
            "/code/submissions/save", json=_code_body(passed_tests=4)
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# 7. Podcast authorship status
# ---------------------------------------------------------------------------

class TestPodcastAuthorshipStatus:
    @pytest.mark.parametrize(
        "status,visible",
        [
            (ResourceAuthorshipStatusEnum.ACTIVE, True),
            (ResourceAuthorshipStatusEnum.PENDING, False),
            (ResourceAuthorshipStatusEnum.INACTIVE, False),
        ],
    )
    async def test_only_active_authorship_reveals_draft(
        self, db, org, regular_user, status, visible
    ):
        from src.services.podcasts.podcasts import accessible_podcast_ids_query

        db.add(_podcast(121, org.id, "podcast_authored_draft", published=False))
        db.add(ResourceAuthor(
            resource_uuid="podcast_authored_draft", user_id=regular_user.id,
            authorship=ResourceAuthorshipEnum.CONTRIBUTOR, authorship_status=status,
            creation_date=NOW, update_date=NOW,
        ))
        await db.commit()
        ids = set((await db.execute(accessible_podcast_ids_query(regular_user.id))).scalars().all())
        assert (121 in ids) is visible

    async def test_list_endpoint_uses_active_filter(
        self, db, org, regular_user, mock_request
    ):
        from unittest.mock import AsyncMock, patch
        from src.services.podcasts import podcasts as svc

        db.add(_podcast(122, org.id, "podcast_pending_draft", published=False))
        db.add(_podcast(123, org.id, "podcast_visible"))
        db.add(ResourceAuthor(
            resource_uuid="podcast_pending_draft", user_id=regular_user.id,
            authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
            authorship_status=ResourceAuthorshipStatusEnum.PENDING,
            creation_date=NOW, update_date=NOW,
        ))
        await db.commit()
        with patch.object(svc, "_is_podcasts_feature_enabled", new_callable=AsyncMock, return_value=True):
            listed = await svc.get_podcasts_orgslug(mock_request, regular_user, "test-org", db)
            count = await svc.get_podcasts_count_orgslug(mock_request, regular_user, "test-org", db)
        assert [p.podcast_uuid for p in listed] == ["podcast_visible"]
        assert count == 1
