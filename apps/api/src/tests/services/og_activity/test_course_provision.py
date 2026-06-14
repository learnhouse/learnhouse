import pytest
from sqlmodel import select

from src.db.courses.courses import Course
from src.db.courses.chapters import Chapter
from src.services.og_activity.alignment import AlignmentRef
from src.services.og_activity.course_provision import (
    provision_artifact_chapter,
    provision_launch_course,
)


def _launch(sha="sha-1"):
    return {"id": "L1", "name": "Q3 Release", "summary": "the launch", "sourceSha": sha}


@pytest.mark.asyncio
async def test_provision_course_creates_with_alignment(db, org):
    refs = [
        AlignmentRef(type="product", id="p1", name="Procurement", rel_type="for_product"),
        AlignmentRef(type="market", id="m1", name="State & Local", rel_type="serves_market"),
    ]
    course_id = await provision_launch_course(db, org.id, _launch(), refs)

    course = (await db.execute(select(Course).where(Course.id == course_id))).scalars().one()
    assert course.name == "Q3 Release"
    assert course.description == "the launch"
    assert course.public is False and course.published is True
    assert course.tags == "source:kb,product:procurement,market:state-local"
    assert course.extra_metadata["kb_id"] == "L1"
    assert course.extra_metadata["kb_sha"] == "sha-1"
    assert course.extra_metadata["kb_alignment"][0]["name"] == "Procurement"


@pytest.mark.asyncio
async def test_provision_course_is_idempotent_and_updates(db, org):
    first = await provision_launch_course(db, org.id, _launch(), [])
    again = await provision_launch_course(db, org.id, _launch(sha="sha-2"), [])
    assert first == again  # same course row reused

    courses = (await db.execute(select(Course).where(Course.org_id == org.id))).scalars().all()
    assert len(courses) == 1
    assert courses[0].extra_metadata["kb_sha"] == "sha-2"


@pytest.mark.asyncio
async def test_provision_chapter_creates_once_per_artifact(db, org):
    course_id = await provision_launch_course(db, org.id, _launch(), [])
    artifact = {"id": "art-1", "name": "Lesson"}

    ch1 = await provision_artifact_chapter(db, org.id, course_id, artifact)
    ch2 = await provision_artifact_chapter(db, org.id, course_id, artifact)
    assert ch1 == ch2  # idempotent on artifact kb_id

    chapters = (await db.execute(select(Chapter).where(Chapter.course_id == course_id))).scalars().all()
    assert len(chapters) == 1
    assert chapters[0].name == "Lesson"
    assert chapters[0].extra_metadata["kb_id"] == "art-1"


@pytest.mark.asyncio
async def test_provision_course_skips_rewrite_when_sha_unchanged(db, org):
    course_id = await provision_launch_course(db, org.id, _launch(sha="sha-1"), [])
    course = (await db.execute(select(Course).where(Course.id == course_id))).scalars().one()
    first_update = course.update_date

    again = await provision_launch_course(db, org.id, _launch(sha="sha-1"), [])
    assert again == course_id
    refreshed = (await db.execute(select(Course).where(Course.id == course_id))).scalars().one()
    assert refreshed.update_date == first_update  # unchanged: skipped


@pytest.mark.asyncio
async def test_provision_second_chapter_gets_next_order(db, org):
    from src.db.courses.course_chapters import CourseChapter

    course_id = await provision_launch_course(db, org.id, _launch(), [])
    await provision_artifact_chapter(db, org.id, course_id, {"id": "art-1", "name": "A"})
    await provision_artifact_chapter(db, org.id, course_id, {"id": "art-2", "name": "B"})

    links = (await db.execute(select(CourseChapter).where(CourseChapter.course_id == course_id))).scalars().all()
    orders = sorted(link.order for link in links)
    assert orders == [0, 1]
