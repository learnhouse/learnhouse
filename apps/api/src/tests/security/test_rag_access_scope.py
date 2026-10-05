"""RAG retrieval only returns content the caller could open directly.

Covers the course-level scope built before the vector search and the
activity-level filter (drafts, locks, paid access) applied to its results.
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.db.course_embeddings import CourseEmbedding
from src.db.courses.activities import (
    Activity,
    ActivityLockType,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.courses import Course
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.services.ai.rag import access as rag_access
from src.services.ai.rag import query_service
from src.services.ai.rag.access import (
    RagAccessScope,
    build_rag_access_scope,
    filter_readable_chunks,
)


async def _course(db, org, course_id, uuid, public, published):
    c = Course(
        id=course_id,
        name=uuid,
        description="",
        public=public,
        published=published,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return c


async def _activity(db, org, course, chapter, activity_id, uuid, published=True, lock_type=ActivityLockType.PUBLIC):
    a = Activity(
        id=activity_id,
        name=uuid,
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={},
        published=published,
        lock_type=lock_type,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    if chapter is not None:
        db.add(ChapterActivity(
            order=activity_id,
            chapter_id=chapter.id,
            activity_id=a.id,
            course_id=course.id,
            org_id=org.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        ))
        await db.commit()
    return a


async def _index(db, org, course, activity):
    db.add(CourseEmbedding(
        org_id=org.id,
        course_id=course.id,
        activity_id=activity.id,
        activity_uuid=activity.activity_uuid,
        source_type="dynamic_page",
        chunk_text="indexed",
        embedding=[0.0] * 768,
    ))
    await db.commit()


def _row(course, activity):
    return SimpleNamespace(
        id=activity.id,
        course_id=course.id,
        activity_id=activity.id,
        activity_uuid=activity.activity_uuid,
        chunk_text=f"text of {activity.activity_uuid}",
        activity_name=activity.name,
        chapter_name="",
        course_name=course.name,
        source_type="dynamic_page",
        block_uuid=None,
        course_uuid=course.course_uuid,
    )


@pytest.fixture
async def private_course(db, org):
    return await _course(db, org, 20, "course_private", public=False, published=False)


class TestCourseScope:
    async def test_named_private_course_is_403_for_member(
        self, db, org, regular_user, private_course, mock_request
    ):
        with pytest.raises(HTTPException) as exc:
            await build_rag_access_scope(
                mock_request, regular_user, org.id, db, course=private_course
            )
        assert exc.value.status_code == 403

    async def test_org_wide_scope_skips_unreadable_courses(
        self, db, org, regular_user, admin_user, course, chapter, private_course, mock_request
    ):
        public_activity = await _activity(db, org, course, chapter, 30, "act_public")
        private_activity = await _activity(db, org, private_course, None, 31, "act_private")
        await _index(db, org, course, public_activity)
        await _index(db, org, private_course, private_activity)

        member_scope = await build_rag_access_scope(mock_request, regular_user, org.id, db)
        assert member_scope.course_ids == [course.id]

        admin_scope = await build_rag_access_scope(mock_request, admin_user, org.id, db)
        assert sorted(admin_scope.course_ids) == [course.id, private_course.id]
        assert admin_scope.courses[private_course.id].is_admin is True


class TestActivityFilter:
    async def test_drops_drafts_and_locked_activities_for_member(
        self, db, org, regular_user, course, chapter, mock_request
    ):
        visible = await _activity(db, org, course, chapter, 40, "act_visible")
        draft = await _activity(db, org, course, chapter, 41, "act_draft", published=False)
        locked = await _activity(
            db, org, course, chapter, 42, "act_locked", lock_type=ActivityLockType.RESTRICTED
        )
        scope = await build_rag_access_scope(mock_request, regular_user, org.id, db, course=course)

        rows = [_row(course, a) for a in (visible, draft, locked)]
        kept = await filter_readable_chunks(rows, scope, db)
        assert [r.activity_uuid for r in kept] == ["act_visible"]

    async def test_usergroup_unlocks_restricted_activity(
        self, db, org, regular_user, course, chapter, mock_request
    ):
        locked = await _activity(
            db, org, course, chapter, 43, "act_group", lock_type=ActivityLockType.RESTRICTED
        )
        ug = UserGroup(id=70, org_id=org.id, name="g", description="", usergroup_uuid="ug_g")
        db.add(ug)
        await db.commit()
        db.add(UserGroupResource(usergroup_id=ug.id, resource_uuid=locked.activity_uuid, org_id=org.id))
        db.add(UserGroupUser(usergroup_id=ug.id, user_id=regular_user.id, org_id=org.id))
        await db.commit()

        scope = await build_rag_access_scope(mock_request, regular_user, org.id, db, course=course)
        kept = await filter_readable_chunks([_row(course, locked)], scope, db)
        assert [r.activity_uuid for r in kept] == ["act_group"]

    async def test_admin_keeps_drafts_and_locked(
        self, db, org, admin_user, course, chapter, mock_request
    ):
        draft = await _activity(db, org, course, chapter, 44, "act_admin_draft", published=False)
        locked = await _activity(
            db, org, course, chapter, 45, "act_admin_locked", lock_type=ActivityLockType.RESTRICTED
        )
        scope = await build_rag_access_scope(mock_request, admin_user, org.id, db, course=course)
        kept = await filter_readable_chunks(
            [_row(course, draft), _row(course, locked)], scope, db
        )
        assert len(kept) == 2

    async def test_paid_activity_is_dropped_without_access(
        self, db, org, regular_user, course, chapter, mock_request
    ):
        paid = await _activity(db, org, course, chapter, 46, "act_paid")
        scope = await build_rag_access_scope(mock_request, regular_user, org.id, db, course=course)
        with patch.object(
            rag_access, "check_ee_activity_paid_access", new=AsyncMock(return_value=False)
        ):
            assert await filter_readable_chunks([_row(course, paid)], scope, db) == []

    async def test_rows_outside_scope_are_dropped(
        self, db, org, regular_user, course, chapter, private_course, mock_request
    ):
        private_activity = await _activity(db, org, private_course, None, 47, "act_out")
        scope = await build_rag_access_scope(mock_request, regular_user, org.id, db, course=course)
        assert await filter_readable_chunks([_row(private_course, private_activity)], scope, db) == []


class TestQuery:
    async def test_empty_scope_skips_search(self, mock_request, regular_user):
        scope = RagAccessScope(request=mock_request, current_user=regular_user, org_id=1)
        db = AsyncMock()
        with patch.object(query_service, "embed_single_text", new=AsyncMock()) as embed:
            result = await query_service.query_course_rag("q", 1, db, scope=scope)
        assert result == {"context": "", "sources": []}
        embed.assert_not_called()
        db.execute.assert_not_called()

    async def test_search_is_limited_to_scope_and_filtered(
        self, db, org, regular_user, course, chapter, mock_request
    ):
        visible = await _activity(db, org, course, chapter, 50, "act_q_visible")
        draft = await _activity(db, org, course, chapter, 51, "act_q_draft", published=False)
        scope = await build_rag_access_scope(mock_request, regular_user, org.id, db, course=course)

        # pgvector's <=> only exists on Postgres; capture the search instead.
        fake_result = MagicMock()
        fake_result.fetchall.return_value = [_row(course, draft), _row(course, visible)]
        search_db = AsyncMock()
        search_db.execute.return_value = fake_result

        async def filter_with_real_db(rows, s, _db):
            return await filter_readable_chunks(rows, s, db)

        with patch.object(
            query_service, "embed_single_text", new=AsyncMock(return_value=[0.0] * 3)
        ), patch.object(query_service, "filter_readable_chunks", new=filter_with_real_db):
            result = await query_service.query_course_rag("q", org.id, search_db, scope=scope)

        params = search_db.execute.call_args.args[1]
        assert params["course_ids"] == [course.id]
        assert params["org_id"] == org.id
        assert [s["activity_uuid"] for s in result["sources"]] == ["act_q_visible"]
        assert "act_q_draft" not in result["context"]


class TestActivityChat:
    @pytest.mark.parametrize(
        "published,lock_type",
        [(False, ActivityLockType.PUBLIC), (True, ActivityLockType.RESTRICTED)],
    )
    async def test_member_cannot_chat_with_unreadable_activity(
        self, db, org, regular_user, course, chapter, mock_request, published, lock_type
    ):
        from src.services.ai import ai as ai_service

        await _activity(
            db, org, course, chapter, 60, "act_chat", published=published, lock_type=lock_type
        )
        with patch.object(ai_service, "reserve_ai_credit", new_callable=AsyncMock) as reserve:
            with pytest.raises(HTTPException) as exc:
                await ai_service._get_activity_and_course_info(
                    "act_chat", db, mock_request, regular_user
                )
        assert exc.value.status_code == 403
        reserve.assert_not_called()

    async def test_member_can_chat_with_readable_activity(
        self, db, org, regular_user, course, chapter, mock_request
    ):
        from src.db.organization_config import OrganizationConfig
        from src.services.ai import ai as ai_service

        db.add(OrganizationConfig(org_id=org.id, config={"config_version": "1.0"}))
        await db.commit()
        await _activity(db, org, course, chapter, 61, "act_chat_ok")
        with patch.object(ai_service, "model_for_tier", return_value="m"):
            got_activity, *_ = await ai_service._get_activity_and_course_info(
                "act_chat_ok", db, mock_request, regular_user
            )
        assert got_activity.activity_uuid == "act_chat_ok"
