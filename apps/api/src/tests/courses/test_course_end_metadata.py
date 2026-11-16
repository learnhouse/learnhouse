"""Per-course completion screen config stored at extra_metadata["course_end"].

Covers validation (link allowlist, stripping, unknown keys, secondary button),
the key-by-key merge of extra_metadata on update, validation on create, and
that the course update permission check still applies.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlmodel import select

from src.db.courses.courses import Course, CourseCompletionConfig, CourseCreate, CourseUpdate
from src.services.courses.courses import create_course, update_course

COURSES_MOD = "src.services.courses.courses"

_DEFAULTS = {
    "message": "",
    "button_text": "",
    "button_link": "",
    "title": "",
    "show_confetti": True,
    "show_back_button": True,
    "secondary_button_text": "",
    "secondary_button_link": "",
}


def _bypass_access():
    return patch(f"{COURSES_MOD}.check_resource_access", new_callable=AsyncMock)


async def _update(mock_request, course, admin_user, db, metadata):
    with _bypass_access():
        return await update_course(
            mock_request, CourseUpdate(extra_metadata=metadata), course.course_uuid, admin_user, db
        )


class TestCourseCompletionConfigModel:
    def test_defaults_match_the_unconfigured_screen(self):
        assert CourseCompletionConfig().model_dump() == _DEFAULTS

    def test_strips_and_drops_unknown_keys(self):
        config = CourseCompletionConfig.model_validate(
            {
                "title": "  Well done  ",
                "secondary_button_text": " Join the community ",
                "secondary_button_link": " https://example.com/community ",
                "evil": "<script>",
            }
        )
        dumped = config.model_dump()
        assert dumped["title"] == "Well done"
        assert dumped["secondary_button_text"] == "Join the community"
        assert dumped["secondary_button_link"] == "https://example.com/community"
        assert "evil" not in dumped

    @pytest.mark.parametrize("bad", ["javascript:alert(1)", "//evil.com", "data:text/html,x", "ftp://x"])
    def test_rejects_unsafe_secondary_link(self, bad):
        with pytest.raises(ValidationError) as exc:
            CourseCompletionConfig(secondary_button_text="Go", secondary_button_link=bad)
        assert "secondary_button_link" in str(exc.value)

    def test_secondary_link_requires_text(self):
        with pytest.raises(ValidationError) as exc:
            CourseCompletionConfig(secondary_button_link="/courses")
        assert "secondary_button_text is required" in str(exc.value)

    def test_title_length_is_capped(self):
        with pytest.raises(ValidationError):
            CourseCompletionConfig(title="x" * 121)


class TestUpdateCourseCompletionScreen:
    @pytest.mark.asyncio
    async def test_valid_save_is_normalized(self, db, org, course, admin_user, mock_request, bypass_webhooks):
        updated = await _update(
            mock_request,
            course,
            admin_user,
            db,
            {
                "course_end": {
                    "message": "  See you in the next course!  ",
                    "button_text": "Next course",
                    "button_link": "/course/next",
                    "show_confetti": False,
                    "secondary_button_text": "Community",
                    "secondary_button_link": "https://example.com",
                    "unknown": 1,
                }
            },
        )

        expected = {
            **_DEFAULTS,
            "message": "See you in the next course!",
            "button_text": "Next course",
            "button_link": "/course/next",
            "show_confetti": False,
            "secondary_button_text": "Community",
            "secondary_button_link": "https://example.com",
        }
        assert updated.extra_metadata == {"course_end": expected}
        await db.refresh(course)
        assert course.extra_metadata == {"course_end": expected}

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "course_end",
        [
            {"button_link": "javascript:alert(1)"},
            {"secondary_button_text": "x", "secondary_button_link": "javascript:alert(1)"},
            {"message": "x" * 501},
            "not-an-object",
        ],
    )
    async def test_invalid_config_is_a_400_and_nothing_is_saved(
        self, db, org, course, admin_user, mock_request, bypass_webhooks, course_end
    ):
        course.extra_metadata = {"sku": "ABC"}
        db.add(course)
        await db.commit()

        with _bypass_access(), pytest.raises(HTTPException) as exc:
            await update_course(
                mock_request,
                CourseUpdate(name="Should not stick", extra_metadata={"course_end": course_end}),
                course.course_uuid,
                admin_user,
                db,
            )
        assert exc.value.status_code == 400
        assert exc.value.detail.startswith("Invalid course_end")

        stored = (await db.execute(select(Course).where(Course.id == course.id))).scalars().first()
        await db.refresh(stored)
        assert stored.extra_metadata == {"sku": "ABC"}
        assert stored.name != "Should not stick"

    @pytest.mark.asyncio
    async def test_other_keys_are_preserved(self, db, org, course, admin_user, mock_request, bypass_webhooks):
        course.extra_metadata = {"sku": "ABC", "vendor": {"name": "x"}}
        db.add(course)
        await db.commit()

        updated = await _update(mock_request, course, admin_user, db, {"course_end": {"message": "Bravo"}})

        assert updated.extra_metadata["sku"] == "ABC"
        assert updated.extra_metadata["vendor"] == {"name": "x"}
        assert updated.extra_metadata["course_end"]["message"] == "Bravo"

    @pytest.mark.asyncio
    async def test_none_removes_the_key(self, db, org, course, admin_user, mock_request, bypass_webhooks):
        course.extra_metadata = {"sku": "ABC", "course_end": {"message": "old"}}
        db.add(course)
        await db.commit()

        updated = await _update(mock_request, course, admin_user, db, {"course_end": None})
        assert updated.extra_metadata == {"sku": "ABC"}

        # Removing the last key leaves no metadata at all.
        updated = await _update(mock_request, course, admin_user, db, {"sku": None})
        assert updated.extra_metadata is None

    @pytest.mark.asyncio
    async def test_non_member_cannot_set_it(self, db, org, course, regular_user, mock_request, bypass_webhooks):
        # Real RBAC: a plain member who does not author the course is refused.
        with pytest.raises(HTTPException) as exc:
            await update_course(
                mock_request,
                CourseUpdate(extra_metadata={"course_end": {"message": "hijack"}}),
                course.course_uuid,
                regular_user,
                db,
            )
        assert exc.value.status_code == 403

        stored = (await db.execute(select(Course).where(Course.id == course.id))).scalars().first()
        await db.refresh(stored)
        assert not (stored.extra_metadata or {}).get("course_end")


class TestCreateCourseCompletionScreen:
    def _patches(self):
        return (
            _bypass_access(),
            patch(f"{COURSES_MOD}.require_org_create_permission", new_callable=AsyncMock),
            patch(f"{COURSES_MOD}.check_limits_with_usage"),
            patch(f"{COURSES_MOD}.increase_feature_usage"),
            patch(f"{COURSES_MOD}.dispatch_webhooks", new_callable=AsyncMock),
        )

    def _create_object(self, org, metadata):
        return CourseCreate(
            org_id=org.id,
            name="Completion Course",
            description="d",
            public=False,
            published=False,
            open_to_contributors=False,
            extra_metadata=metadata,
        )

    @pytest.mark.asyncio
    async def test_create_normalizes_course_end(self, db, org, admin_user, mock_request):
        a, b, c, d, e = self._patches()
        with a, b, c, d, e:
            created = await create_course(
                mock_request,
                org.id,
                self._create_object(org, {"sku": "1", "course_end": {"title": "  Done  "}}),
                admin_user,
                db,
            )
        assert created.extra_metadata == {"sku": "1", "course_end": {**_DEFAULTS, "title": "Done"}}

    @pytest.mark.asyncio
    async def test_create_rejects_unsafe_link(self, db, org, admin_user, mock_request):
        a, b, c, d, e = self._patches()
        with a, b, c, d, e, pytest.raises(HTTPException) as exc:
            await create_course(
                mock_request,
                org.id,
                self._create_object(org, {"course_end": {"button_link": "javascript:alert(1)"}}),
                admin_user,
                db,
            )
        assert exc.value.status_code == 400
