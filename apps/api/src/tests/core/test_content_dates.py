"""Tests for src/core/events/content_dates.py: editing a course's content moves
the course's update_date (and an episode moves its podcast's)."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import event, select, update

from src.core.events import content_dates
from src.core.events.content_dates import register_content_date_hooks, touch_parent
from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum, ActivityUpdate
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.podcasts.episodes import PodcastEpisode
from src.db.podcasts.podcasts import Podcast
from src.services.courses.activities.activities import update_activity

OLD = "2020-01-01 00:00:00"

register_content_date_hooks()


async def _age(db, model, row_id):
    """Store an old update_date for a row, in the database and in memory."""
    await db.execute(update(model).where(model.id == row_id).values(update_date=OLD))
    await db.commit()
    for obj in db.identity_map.values():
        if isinstance(obj, model) and obj.id == row_id:
            obj.update_date = OLD
    await db.commit()


async def _stored(db, model, row_id):
    return (await db.execute(select(model.update_date).where(model.id == row_id))).scalar_one()


def _new_activity(org, course, activity_id):
    return Activity(
        id=activity_id,
        name="Another",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={},
        org_id=org.id,
        course_id=course.id,
        activity_uuid=f"activity_{activity_id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )


@pytest.mark.asyncio
async def test_editing_activity_content_moves_course_date(mock_request, db, course, activity, admin_user):
    await _age(db, Course, course.id)

    with patch(
        "src.services.courses.activities.activities.check_resource_access",
        new_callable=AsyncMock,
    ), patch(
        "src.services.courses.activities.activities.create_activity_version",
        new_callable=AsyncMock,
    ):
        await update_activity(
            mock_request,
            ActivityUpdate(content={"type": "doc", "content": [{"type": "paragraph"}]}),
            activity.activity_uuid,
            admin_user,
            db,
        )

    assert await _stored(db, Course, course.id) > OLD
    # The loaded course follows without being left dirty.
    assert course.update_date > OLD
    assert course not in db.dirty


@pytest.mark.asyncio
async def test_background_write_without_stamp_leaves_course_date(db, course, activity):
    await _age(db, Course, course.id)

    activity.extra_metadata = {"rag_status": "indexed"}
    await db.commit()

    assert await _stored(db, Course, course.id) == OLD


@pytest.mark.asyncio
async def test_adding_and_removing_activities_moves_course_date(db, org, course, chapter, activity):
    await _age(db, Course, course.id)
    db.add(_new_activity(org, course, 2))
    await db.commit()
    assert await _stored(db, Course, course.id) > OLD

    await _age(db, Course, course.id)
    await db.delete(activity)
    await db.commit()
    assert await _stored(db, Course, course.id) > OLD


@pytest.mark.asyncio
async def test_one_write_per_course_per_flush(engine, db, org, course, activity):
    await _age(db, Course, course.id)
    writes = []

    def count(conn, cursor, statement, params, context, executemany):
        if statement.startswith("UPDATE course "):
            writes.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", count)
    try:
        db.add_all([_new_activity(org, course, 2), _new_activity(org, course, 3)])
        await db.commit()
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count)

    assert len(writes) == 1
    assert await _stored(db, Course, course.id) > OLD


@pytest.mark.asyncio
async def test_editing_chapter_moves_course_date(db, course, chapter):
    db.expunge(course)  # parent not loaded: only the stored row changes
    await _age(db, Course, course.id)

    chapter.name = "Renamed"
    chapter.update_date = str(datetime.now())
    await db.commit()

    assert await _stored(db, Course, course.id) > OLD


@pytest.mark.asyncio
async def test_reordering_moves_course_date_only_on_real_change(db, course, chapter, activity):
    link = (await db.execute(select(CourseChapter).where(CourseChapter.chapter_id == chapter.id))).scalar_one()
    await _age(db, Course, course.id)

    link.order = link.order  # same value: not a change
    db.add(link)
    await db.commit()
    assert await _stored(db, Course, course.id) == OLD

    activity_link = (
        await db.execute(select(ChapterActivity).where(ChapterActivity.activity_id == activity.id))
    ).scalar_one()
    activity_link.order = 5
    await db.commit()
    assert await _stored(db, Course, course.id) > OLD


@pytest.mark.asyncio
async def test_editing_episode_moves_podcast_date(db, org):
    podcast = Podcast(name="Pod", public=True, org_id=org.id, podcast_uuid="podcast_1", update_date=OLD)
    db.add(podcast)
    await db.commit()
    episode = PodcastEpisode(title="Ep", podcast_id=podcast.id, org_id=org.id, episode_uuid="episode_1")
    db.add(episode)
    await db.commit()
    assert await _stored(db, Podcast, podcast.id) > OLD

    await _age(db, Podcast, podcast.id)
    episode.title = "Ep renamed"
    episode.update_date = str(datetime.now())
    await db.commit()
    assert await _stored(db, Podcast, podcast.id) > OLD


def test_touch_parent_skips_rows_without_session_or_parent():
    connection = object()  # never used: both rows return before any write
    touch_parent(connection, Chapter(name="Loose", org_id=1, course_id=1))
    touch_parent(connection, Chapter(name="No course", org_id=1, course_id=None))


def test_register_is_idempotent():
    with patch.object(content_dates.event, "listen") as listen:
        register_content_date_hooks()
    listen.assert_not_called()
