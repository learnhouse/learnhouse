"""Calendar sources beyond assignments: drip schedules, course updates,
certificates and podcast episodes."""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from src.db.courses.certifications import CertificateUser, Certifications
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.course_updates import CourseUpdate
from src.db.courses.courses import Course
from src.db.podcasts.episodes import PodcastEpisode
from src.db.podcasts.podcasts import Podcast
from src.db.trail_runs import TrailRun
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.services.calendar import sources as calendar_sources
from src.services.calendar.calendar import get_calendar_events

NOW = datetime.now(timezone.utc)
START = NOW - timedelta(days=30)
END = NOW + timedelta(days=60)


def _stamp(dt: datetime) -> str:
    return str(dt.replace(tzinfo=None))


@pytest.fixture
def only():
    """Run with just the named sources registered."""
    original = dict(calendar_sources._SOURCES)

    def pick(*keys):
        calendar_sources._SOURCES.clear()
        for key in keys:
            calendar_sources._SOURCES[key] = original[key]

    yield pick
    calendar_sources._SOURCES.clear()
    calendar_sources._SOURCES.update(original)


async def _events(mock_request, org, user, db):
    return await get_calendar_events(mock_request, org.id, START, END, user, db)


async def _enroll(db, org, course, user):
    db.add(TrailRun(trail_id=1, course_id=course.id, org_id=org.id, user_id=user.id, creation_date=_stamp(NOW - timedelta(days=3)), update_date=""))
    await db.commit()


async def _drip_course(db, org, course, chapter, **settings):
    course.drip_settings = {"enabled": True, "anchor": "fixed_date", "start_date": (NOW - timedelta(days=1)).isoformat(), **settings}
    db.add(course)
    chapter.drip_rule = {"mode": "immediate"}
    db.add(chapter)
    rules = {
        "chapter_soon": {"mode": "date", "release_at": (NOW + timedelta(days=5)).isoformat(), "available_days": 3},
        "chapter_limited": {"mode": "date", "release_at": (NOW - timedelta(days=2)).isoformat(), "available_days": 10},
    }
    for order, (uuid, rule) in enumerate(rules.items(), start=2):
        ch = Chapter(
            name=uuid.replace("chapter_", "").title(), org_id=org.id, course_id=course.id, chapter_uuid=uuid,
            drip_rule=rule, creation_date="", update_date="",
        )
        db.add(ch)
        await db.flush()
        db.add(CourseChapter(chapter_id=ch.id, course_id=course.id, org_id=org.id, order=order, creation_date="", update_date=""))
    await db.commit()


async def test_drip_shows_this_learners_opens_and_closes(db, org, course, chapter, regular_user, mock_request, only):
    only("drip")
    await _drip_course(db, org, course, chapter)
    assert await _events(mock_request, org, regular_user, db) == []  # not in the course

    await _enroll(db, org, course, regular_user)
    events = {e.id: e for e in await _events(mock_request, org, regular_user, db)}
    assert events["course_start:course_test"].type == "course_start" and events["course_start:course_test"].status == "started"
    assert events["chapter_open:chapter_test"].status == "unlocked"
    soon = events["chapter_open:chapter_soon"]
    assert soon.type == "chapter_release" and soon.status == "upcoming" and soon.title == "Soon"
    assert soon.url == "/course/test" and soon.course.course_uuid == "course_test"
    assert events["chapter_open:chapter_limited"].status == "unlocked"
    closing = events["chapter_close:chapter_limited"]
    assert closing.type == "chapter_close" and closing.status == "closing"
    # A chapter that hasn't opened yet has no closing date for this learner.
    assert "chapter_close:chapter_soon" not in events


async def test_drip_early_access_has_nothing_locked(db, org, course, chapter, regular_user, mock_request, only):
    only("drip")
    group = UserGroup(name="Staff", description="", org_id=org.id, usergroup_uuid="usergroup_staff", creation_date="", update_date="")
    db.add(group)
    await db.flush()
    db.add(UserGroupUser(usergroup_id=group.id, user_id=regular_user.id, org_id=org.id, creation_date="", update_date=""))
    await _drip_course(db, org, course, chapter, early_access_usergroups=["usergroup_staff"])
    await _enroll(db, org, course, regular_user)
    types = {e.type for e in await _events(mock_request, org, regular_user, db)}
    assert types == {"course_start"}


async def test_courses_without_drip_add_nothing(db, org, course, chapter, regular_user, mock_request, only):
    only("drip")
    await _enroll(db, org, course, regular_user)
    assert await _events(mock_request, org, regular_user, db) == []


async def test_course_updates_from_my_courses_only(db, org, course, regular_user, mock_request, only):
    only("course_updates")
    other = Course(name="Other", public=True, published=True, open_to_contributors=False, org_id=org.id, course_uuid="course_other", creation_date="", update_date="")
    db.add(other)
    await db.flush()
    for c, uuid in ((course, "mine"), (other, "theirs")):
        db.add(CourseUpdate(
            title=f"Update {uuid}", content="", course_id=c.id, org_id=org.id, courseupdate_uuid=f"courseupdate_{uuid}",
            creation_date=_stamp(NOW - timedelta(days=1)), update_date="",
        ))
    db.add(CourseUpdate(
        title="Too old", content="", course_id=course.id, org_id=org.id, courseupdate_uuid="courseupdate_old",
        creation_date=_stamp(NOW - timedelta(days=90)), update_date="",
    ))
    await db.commit()
    await _enroll(db, org, course, regular_user)
    events = await _events(mock_request, org, regular_user, db)
    assert [e.id for e in events] == ["course_update:courseupdate_mine"]
    assert events[0].type == "course_update" and events[0].url == "/course/test"


async def test_certificates_are_the_users_own(db, org, course, regular_user, admin_user, mock_request, only):
    only("certificates")
    cert = Certifications(course_id=course.id, config={}, certification_uuid="certification_x", creation_date="", update_date="")
    db.add(cert)
    await db.flush()
    db.add(CertificateUser(user_id=regular_user.id, certification_id=cert.id, user_certification_uuid="usercert_mine", created_at=_stamp(NOW), updated_at=""))
    db.add(CertificateUser(user_id=admin_user.id, certification_id=cert.id, user_certification_uuid="usercert_admin", created_at=_stamp(NOW), updated_at=""))
    await db.commit()
    events = await _events(mock_request, org, regular_user, db)
    assert [e.id for e in events] == ["certificate:usercert_mine"]
    assert events[0].url == "/certificates/usercert_mine/verify" and events[0].title == "Test Course"


async def test_podcast_episodes_published_and_readable(db, org, regular_user, mock_request, only):
    only("podcasts")
    podcast = Podcast(name="DNS Weekly", public=True, published=True, org_id=org.id, podcast_uuid="podcast_dns", creation_date="", update_date="")
    draft = Podcast(name="Draft show", public=True, published=False, org_id=org.id, podcast_uuid="podcast_draft", creation_date="", update_date="")
    db.add(podcast)
    db.add(draft)
    await db.flush()
    for pod, uuid, published in ((podcast, "ep1", True), (podcast, "ep2", False), (draft, "ep3", True)):
        db.add(PodcastEpisode(
            title=uuid, podcast_id=pod.id, org_id=org.id, episode_uuid=f"episode_{uuid}", published=published,
            creation_date=_stamp(NOW - timedelta(days=2)), update_date="",
        ))
    await db.commit()
    events = await _events(mock_request, org, regular_user, db)
    assert [e.id for e in events] == ["podcast_episode:episode_ep1"]
    assert events[0].url == "/podcast/dns" and events[0].meta == {"podcast": "DNS Weekly"}

    with patch("src.services.calendar.types.resolve_feature", return_value={"enabled": False}):
        assert await _events(mock_request, org, regular_user, db) == []


async def test_sources_respect_the_feature_toggle(db, org, course, chapter, regular_user, mock_request, only):
    from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
    from src.db.courses.assignments import Assignment, GradingTypeEnum

    only("assignments")
    activity = Activity(
        name="a", activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT, activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY,
        content={}, published=True, org_id=org.id, course_id=course.id, activity_uuid="activity_a", creation_date="", update_date="",
    )
    db.add(activity)
    await db.flush()
    db.add(Assignment(
        title="Due", description="", published=True, grading_type=GradingTypeEnum.NUMERIC,
        due_date=(NOW + timedelta(days=3)).date().isoformat(), org_id=org.id, course_id=course.id,
        chapter_id=chapter.id, activity_id=activity.id, assignment_uuid="assignment_a", creation_date="", update_date="",
    ))
    await db.commit()
    await _enroll(db, org, course, regular_user)
    assert len(await _events(mock_request, org, regular_user, db)) == 1
    with patch("src.services.calendar.types.resolve_feature", return_value={"enabled": False}):
        assert await _events(mock_request, org, regular_user, db) == []


def test_all_built_in_sources_are_registered():
    assert {"assignments", "drip", "course_updates", "certificates", "podcasts"} <= set(calendar_sources.registered_sources())
