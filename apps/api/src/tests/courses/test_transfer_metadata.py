"""
Verify that course export/import round-trips the ``extra_metadata`` field
on Course, Chapter, and Activity rows.

Tests the data-shaping functions directly (no zip round-trip):

  * ``_load_course_export_data`` produces the dicts written to
    course.json / chapter.json / activity.json.
  * ``_import_chapter`` / ``_import_activity`` read those dicts back into
    SQLModel rows. Course-level import is exercised by constructing a
    ``Course`` row with the same dict shape, mirroring the constructor call
    inside ``_import_single_course``.
"""

from datetime import datetime

import pytest
from sqlmodel import select

from src.db.courses.activities import (
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.services.courses.transfer.export_service import _load_course_export_data
from src.services.courses.transfer.import_service import (
    _import_activity,
    _import_chapter,
)


COURSE_META = {"category": "engineering", "audience": ["staff"]}
CHAPTER_META = {"reviewer": "alice", "weight": 3}
ACTIVITY_META = {"duration_minutes": 12, "tags": ["video", "intro"]}


async def _seed(db, org):
    """Insert a Course + Chapter + Activity carrying the test metadata."""
    now = str(datetime.now())
    course = Course(
        name="Meta Course",
        description="",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid="course_meta",
        extra_metadata=COURSE_META,
        creation_date=now,
        update_date=now,
    )
    db.add(course)
    await db.commit()
    await db.refresh(course)

    chapter = Chapter(
        name="Meta Chapter",
        description="",
        org_id=org.id,
        course_id=course.id,
        chapter_uuid="chapter_meta",
        extra_metadata=CHAPTER_META,
        creation_date=now,
        update_date=now,
    )
    db.add(chapter)
    await db.commit()
    await db.refresh(chapter)
    db.add(CourseChapter(
        chapter_id=chapter.id, course_id=course.id, org_id=org.id,
        order=1, creation_date=now, update_date=now,
    ))

    activity = Activity(
        name="Meta Activity",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={"type": "doc", "content": []},
        published=True,
        org_id=org.id,
        course_id=course.id,
        activity_uuid="activity_meta",
        extra_metadata=ACTIVITY_META,
        creation_date=now,
        update_date=now,
    )
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    db.add(ChapterActivity(
        order=1, chapter_id=chapter.id, activity_id=activity.id,
        course_id=course.id, org_id=org.id,
        creation_date=now, update_date=now,
    ))
    await db.commit()
    return course


@pytest.mark.asyncio
async def test_export_serialization_includes_extra_metadata(db, org):
    """Export dicts must carry extra_metadata at all three levels."""
    course = await _seed(db, org)

    course_data, chapters = await _load_course_export_data(course, db)

    assert course_data["extra_metadata"] == COURSE_META
    assert len(chapters) == 1
    chapter_dict, activities = chapters[0]
    assert chapter_dict["extra_metadata"] == CHAPTER_META
    assert len(activities) == 1
    activity_dict, _blocks = activities[0]
    assert activity_dict["extra_metadata"] == ACTIVITY_META


@pytest.mark.asyncio
async def test_import_constructors_restore_extra_metadata(db, org, tmp_path):
    """Importing the dict shape produced by export must restore extra_metadata
    onto the new DB rows."""
    now = str(datetime.now())
    # Course import is ``Course(..., extra_metadata=course_data["extra_metadata"])``
    # in ``_import_single_course`` — mirror that constructor call directly.
    new_course = Course(
        org_id=org.id, name="Imported", description="", public=True,
        published=True, open_to_contributors=False,
        course_uuid="course_imported",
        extra_metadata=dict(COURSE_META),
        creation_date=now, update_date=now,
    )
    db.add(new_course)
    await db.commit()
    await db.refresh(new_course)

    chapter_data = {
        "name": "Imported Chapter", "description": "", "thumbnail_image": "",
        "order": 1, "extra_metadata": dict(CHAPTER_META),
    }
    activity_data = {
        "name": "Imported Activity",
        "activity_type": "TYPE_DYNAMIC",
        "activity_sub_type": "SUBTYPE_DYNAMIC_PAGE",
        "content": {"type": "doc", "content": []},
        "details": None, "published": True, "order": 1,
        "extra_metadata": dict(ACTIVITY_META),
    }

    # No activities/ dir under chapter_path -> the loop is skipped.
    new_chapter = await _import_chapter(
        chapter_path=str(tmp_path / "nonexistent_chapter"),
        chapter_data=chapter_data,
        new_course=new_course,
        new_course_path=str(tmp_path / "course_content"),
        organization=org,
        db_session=db,
    )

    # Existing dir without files/ or blocks/ -> those branches are skipped.
    activity_src = tmp_path / "activity_src"
    activity_src.mkdir()
    new_activity = await _import_activity(
        activity_path=str(activity_src),
        activity_data=activity_data,
        new_course=new_course,
        new_chapter=new_chapter,
        new_course_path=str(tmp_path / "course_content"),
        organization=org,
        db_session=db,
    )

    await db.commit()

    # Re-fetch to confirm the values are persisted.
    persisted_course = (await db.execute(
        select(Course).where(Course.id == new_course.id)
    )).scalars().one()
    persisted_chapter = (await db.execute(
        select(Chapter).where(Chapter.id == new_chapter.id)
    )).scalars().one()
    persisted_activity = (await db.execute(
        select(Activity).where(Activity.id == new_activity.id)
    )).scalars().one()

    assert persisted_course.extra_metadata == COURSE_META
    assert persisted_chapter.extra_metadata == CHAPTER_META
    assert persisted_activity.extra_metadata == ACTIVITY_META
