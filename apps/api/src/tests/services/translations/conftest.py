"""Fixtures for multilingual courses: a page with real content, a video, a
second chapter, an admin of another organization."""

import copy
import json
from datetime import datetime
from pathlib import Path

import pytest

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.roles import Role, RoleTypeEnum
from src.tests.conftest import ADMIN_RIGHTS
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User

PAGES = json.loads((Path(__file__).parents[2] / "fixtures" / "translation_pages.json").read_text())
QUIZ_PAGE = next(v for v in PAGES.values() if v["name"] == "Quiz and flipcards QA")


class FakeRedis:
    def __init__(self):
        self.h: dict[str, dict[str, str]] = {}

    def hset(self, key, field, value):
        self.h.setdefault(key, {})[field] = value

    def hgetall(self, key):
        return dict(self.h.get(key, {}))

    def expire(self, key, seconds):
        return True

    def delete(self, *keys):
        for k in keys:
            self.h.pop(k, None)


@pytest.fixture
def fake_redis(monkeypatch):
    r = FakeRedis()
    monkeypatch.setattr("src.services.courses.translations.jobs.get_redis_client", lambda: r)
    return r


@pytest.fixture
async def page(db, org, course, chapter, activity):
    """The conftest page activity, filled with a real page (quiz + flipcards)."""
    activity.content = copy.deepcopy(QUIZ_PAGE["content"])
    activity.name = "Quiz and flipcards"
    activity.current_version = 3
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    return activity


@pytest.fixture
async def video(db, org, course, chapter):
    a = Activity(
        id=2, name="Intro video", activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED, content={}, published=True,
        org_id=org.id, course_id=course.id, activity_uuid="activity_video", creation_date="", update_date="",
    )
    db.add(a)
    await db.commit()
    db.add(ChapterActivity(order=2, chapter_id=chapter.id, activity_id=a.id, course_id=course.id, org_id=org.id,
                           creation_date="", update_date=""))
    await db.commit()
    return a


@pytest.fixture
async def other_admin(db, other_org):
    role = Role(id=50, name="Admin2", org_id=other_org.id, role_uuid="role_admin2",
                role_type=RoleTypeEnum.TYPE_ORGANIZATION, rights=ADMIN_RIGHTS.model_dump(),
                creation_date="", update_date="")
    db.add(role)
    u = User(id=60, username="otheradmin", first_name="O", last_name="A", email="o@a.com", password="x",
             user_uuid="user_other_admin", creation_date="", update_date="")
    db.add(u)
    await db.commit()
    db.add(UserOrganization(user_id=60, org_id=other_org.id, role_id=50, creation_date=str(datetime.now()),
                            update_date=str(datetime.now())))
    await db.commit()
    return PublicUser(id=60, username="otheradmin", first_name="O", last_name="A", email="o@a.com",
                      user_uuid="user_other_admin")
