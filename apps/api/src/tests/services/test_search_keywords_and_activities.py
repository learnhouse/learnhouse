"""
Tests for keyword (multi-term) matching and lesson results in
src/services/search/search.py.

Covers: split_search_terms / build_like_patterns, every-word-must-match
semantics across folders and courses, and who may see a lesson (published
only, in a chapter, course visibility, lock tiers, admin bypass).
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from src.db.courses.activities import (
    Activity,
    ActivityLockType,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter, LockType
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.folders.folders import Folder
from src.services.courses.courses import search_courses
from src.services.search.normalization import (
    MAX_SEARCH_TERMS,
    build_like_patterns,
    split_search_terms,
)
from src.services.search.search import search_across_org


# ── helpers ──────────────────────────────────────────────────────────────────


async def _make_folder(db, org, *, id, name, public=True):
    f = Folder(
        id=id,
        name=name,
        description="",
        public=public,
        org_id=org.id,
        folder_uuid=f"folder_{id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(f)
    await db.commit()
    return f


async def _make_course(db, org, *, id, name, public=True, published=True, tags=""):
    c = Course(
        id=id,
        name=name,
        description="",
        tags=tags,
        public=public,
        published=published,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid=f"course_{id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return c


async def _make_chapter(db, org, course, *, id, name="Chapter", lock_type=LockType.PUBLIC):
    ch = Chapter(
        id=id,
        name=name,
        description="",
        org_id=org.id,
        course_id=course.id,
        chapter_uuid=f"chapter_{id}",
        lock_type=lock_type,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(ch)
    await db.commit()
    await db.refresh(ch)
    db.add(CourseChapter(
        chapter_id=ch.id, course_id=course.id, org_id=org.id, order=1,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    await db.commit()
    return ch


async def _make_activity(
    db, org, course, chapter, *, id, name, published=True,
    lock_type=ActivityLockType.PUBLIC, link=True,
):
    a = Activity(
        id=id,
        name=name,
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={"type": "doc", "content": [{"type": "paragraph"}]},
        published=published,
        lock_type=lock_type,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=f"activity_{id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    if link:
        db.add(ChapterActivity(
            order=1, chapter_id=chapter.id, activity_id=a.id,
            course_id=course.id, org_id=org.id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        await db.commit()
    return a


def _no_course_search():
    """Course search has its own tests; keep it out of the folder/lesson ones."""
    return patch(
        "src.services.search.search.search_courses",
        new_callable=AsyncMock,
        return_value=[],
    )


# ── normalization ────────────────────────────────────────────────────────────


class TestSplitSearchTerms:
    def test_splits_on_whitespace_and_trims(self):
        assert split_search_terms("  python   intro ") == ["python", "intro"]

    def test_empty_gives_no_terms(self):
        assert split_search_terms("") == []
        assert split_search_terms(None) == []
        assert split_search_terms("   ") == []

    def test_caps_term_count(self):
        many = " ".join(f"w{i}" for i in range(MAX_SEARCH_TERMS + 5))
        assert len(split_search_terms(many)) == MAX_SEARCH_TERMS

    def test_patterns_escape_each_term(self):
        assert build_like_patterns("100% a_b") == ["%100\\%%", "%a\\_b%"]

    def test_single_word_is_the_old_pattern(self):
        assert build_like_patterns("café") == ["%café%"]


# ── every word must match ────────────────────────────────────────────────────


class TestKeywordMatching:
    @pytest.mark.asyncio
    async def test_words_match_in_any_order(self, db, org, anonymous_user, mock_request):
        await _make_folder(db, org, id=301, name="Introduction to Python")
        await _make_folder(db, org, id=302, name="Python for data science")
        await _make_folder(db, org, id=303, name="Rust introduction")

        with _no_course_search():
            result = await search_across_org(
                mock_request, anonymous_user, "test-org", "python intro", db
            )

        assert [f.name for f in result.folders] == ["Introduction to Python"]
        assert result.total_folders == 1

    @pytest.mark.asyncio
    async def test_a_word_with_no_match_excludes_the_row(
        self, db, org, anonymous_user, mock_request
    ):
        await _make_folder(db, org, id=311, name="Introduction to Python")

        with _no_course_search():
            result = await search_across_org(
                mock_request, anonymous_user, "test-org", "python rust", db
            )

        assert result.folders == []

    @pytest.mark.asyncio
    async def test_course_words_match_across_fields(
        self, db, org, anonymous_user, mock_request
    ):
        await _make_course(db, org, id=321, name="Data Science", tags="python, pandas")
        await _make_course(db, org, id=322, name="Data Engineering", tags="spark")

        courses = await search_courses(
            mock_request, anonymous_user, "test-org", "data python", db
        )

        assert [c.name for c in courses] == ["Data Science"]


# ── lessons ──────────────────────────────────────────────────────────────────


class TestActivitySearch:
    @pytest.mark.asyncio
    async def test_anonymous_finds_public_published_lesson(
        self, db, org, anonymous_user, mock_request
    ):
        course = await _make_course(db, org, id=401, name="Course A")
        chapter = await _make_chapter(db, org, course, id=401, name="Basics")
        await _make_activity(db, org, course, chapter, id=401, name="Variables in Python")

        with _no_course_search():
            result = await search_across_org(
                mock_request, anonymous_user, "test-org", "variables", db
            )

        assert result.total_activities == 1
        hit = result.activities[0]
        assert hit.activity_uuid == "activity_401"
        assert hit.course_uuid == "course_401"
        assert hit.course_name == "Course A"
        assert hit.chapter_name == "Basics"
        assert hit.activity_type == "TYPE_DYNAMIC"

    @pytest.mark.asyncio
    async def test_lesson_body_is_never_in_the_result(
        self, db, org, anonymous_user, mock_request
    ):
        course = await _make_course(db, org, id=411, name="Course B")
        chapter = await _make_chapter(db, org, course, id=411)
        await _make_activity(db, org, course, chapter, id=411, name="Secret lesson")

        with _no_course_search():
            result = await search_across_org(
                mock_request, anonymous_user, "test-org", "secret", db
            )

        assert not hasattr(result.activities[0], "content")
        assert "content" not in result.activities[0].model_dump()

    @pytest.mark.asyncio
    async def test_unpublished_lesson_is_hidden(self, db, org, admin_user, mock_request):
        course = await _make_course(db, org, id=421, name="Course C")
        chapter = await _make_chapter(db, org, course, id=421)
        await _make_activity(
            db, org, course, chapter, id=421, name="Draft lesson", published=False
        )

        with _no_course_search(), patch(
            "src.services.search.search.is_org_member", return_value=True
        ):
            result = await search_across_org(
                mock_request, admin_user, "test-org", "draft", db
            )

        assert result.activities == []

    @pytest.mark.asyncio
    async def test_lesson_outside_any_chapter_is_hidden(
        self, db, org, anonymous_user, mock_request
    ):
        course = await _make_course(db, org, id=431, name="Course D")
        chapter = await _make_chapter(db, org, course, id=431)
        await _make_activity(
            db, org, course, chapter, id=431, name="Orphan lesson", link=False
        )

        with _no_course_search():
            result = await search_across_org(
                mock_request, anonymous_user, "test-org", "orphan", db
            )

        assert result.activities == []

    @pytest.mark.asyncio
    async def test_lesson_follows_course_visibility(
        self, db, org, anonymous_user, regular_user, mock_request
    ):
        private = await _make_course(db, org, id=441, name="Members only", public=False)
        chapter = await _make_chapter(db, org, private, id=441)
        await _make_activity(db, org, private, chapter, id=441, name="Hidden gem")
        draft = await _make_course(db, org, id=442, name="Draft course", published=False)
        draft_chapter = await _make_chapter(db, org, draft, id=442)
        await _make_activity(db, org, draft, draft_chapter, id=442, name="Hidden gem 2")

        with _no_course_search():
            anon = await search_across_org(
                mock_request, anonymous_user, "test-org", "hidden gem", db
            )
        with _no_course_search(), patch(
            "src.services.search.search.is_org_member", return_value=True
        ):
            member = await search_across_org(
                mock_request, regular_user, "test-org", "hidden gem", db
            )

        assert anon.activities == []
        # The member sees the lesson in the org-wide published course, never
        # the one in the draft.
        assert [a.activity_uuid for a in member.activities] == ["activity_441"]

    @pytest.mark.asyncio
    async def test_lock_tiers(
        self, db, org, anonymous_user, regular_user, admin_user, mock_request
    ):
        course = await _make_course(db, org, id=451, name="Course E")
        chapter = await _make_chapter(db, org, course, id=451)
        await _make_activity(db, org, course, chapter, id=451, name="Tier public")
        await _make_activity(
            db, org, course, chapter, id=452, name="Tier authenticated",
            lock_type=ActivityLockType.AUTHENTICATED,
        )
        await _make_activity(
            db, org, course, chapter, id=453, name="Tier restricted",
            lock_type=ActivityLockType.RESTRICTED,
        )
        locked_chapter = await _make_chapter(
            db, org, course, id=452, name="Locked chapter", lock_type=LockType.RESTRICTED
        )
        await _make_activity(
            db, org, course, locked_chapter, id=454, name="Tier chapter locked"
        )

        async def run(user):
            with _no_course_search(), patch(
                "src.services.search.search.is_org_member", return_value=True
            ):
                res = await search_across_org(mock_request, user, "test-org", "tier", db)
            return sorted(a.name for a in res.activities)

        assert await run(anonymous_user) == ["Tier public"]
        assert await run(regular_user) == ["Tier authenticated", "Tier public"]
        assert await run(admin_user) == [
            "Tier authenticated",
            "Tier chapter locked",
            "Tier public",
            "Tier restricted",
        ]

    @pytest.mark.asyncio
    async def test_lessons_are_paginated_and_counted(
        self, db, org, anonymous_user, mock_request
    ):
        course = await _make_course(db, org, id=461, name="Course F")
        chapter = await _make_chapter(db, org, course, id=461)
        for i in range(4):
            await _make_activity(
                db, org, course, chapter, id=470 + i, name=f"Paged lesson {i}"
            )

        with _no_course_search():
            page1 = await search_across_org(
                mock_request, anonymous_user, "test-org", "paged", db, page=1, limit=3
            )
            page2 = await search_across_org(
                mock_request, anonymous_user, "test-org", "paged", db, page=2, limit=3
            )

        assert page1.total_activities == 4
        assert len(page1.activities) == 3
        assert len(page2.activities) == 1
