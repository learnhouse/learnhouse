"""Edge branches of the headless admin API (src/services/admin/admin.py and
src/routers/admin.py): dangling course structure rows, the last-admin guards
kept as defense in depth, and the AI chat purge without Redis."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.course_chapters import CourseChapter
from src.db.users import APITokenUser
from src.routers.admin import api_admin_provision_user
from src.services.admin import admin as admin_service

RIGHTS = {
    bucket: {"action_create": True, "action_read": True, "action_update": True, "action_delete": True}
    for bucket in ("users", "roles", "courses", "certifications", "usergroups")
}


@pytest.fixture
def token_user(org, admin_user):
    return APITokenUser(
        id=1, user_uuid="apitoken_edges", username="api_token", org_id=org.id,
        rights=RIGHTS, token_name="Edges", created_by_user_id=admin_user.id,
    )


async def test_trail_detail_skips_dangling_chapter_and_activity_links(db, org, token_user, admin_user, course, chapter):
    """Link rows whose chapter or activity is gone are left out, not crashed on."""
    now = str(datetime.now())
    db.add(CourseChapter(chapter_id=99, course_id=course.id, org_id=org.id, order=2, creation_date=now, update_date=now))
    db.add(ChapterActivity(order=1, chapter_id=chapter.id, activity_id=99, course_id=course.id, org_id=org.id, creation_date=now, update_date=now))
    await db.commit()

    result = await admin_service.get_user_trail_detail(token_user, admin_user.id, db, course_uuid=course.course_uuid)

    [course_block] = result["courses"]
    assert [c["chapter_id"] for c in course_block["chapters"]] == [chapter.id]
    assert course_block["chapters"][0]["activities"] == []
    assert course_block["total_activities"] == 0
    assert course_block["status"] is None


async def test_remove_last_admin_is_refused_even_past_the_staff_guard(db, token_user, admin_user):
    """Tokens are refused on Admin targets first; the last-admin check still holds behind that."""
    with patch.object(admin_service, "_check_token_can_manage_membership", new_callable=AsyncMock):
        with pytest.raises(HTTPException) as exc:
            await admin_service.remove_user_from_org_admin(token_user, admin_user.id, db)
    assert exc.value.status_code == 400
    assert exc.value.detail == "Cannot remove the last admin of the organization"


async def test_demote_last_admin_is_refused_even_past_the_staff_guard(db, token_user, admin_user, user_role):
    with patch.object(admin_service, "_check_token_can_manage_membership", new_callable=AsyncMock):
        with pytest.raises(HTTPException) as exc:
            await admin_service.change_user_role(token_user, admin_user.id, user_role.id, db)
    assert exc.value.status_code == 400
    assert exc.value.detail == "Cannot demote the last admin of the organization"


def test_ai_chat_purge_without_redis_purges_nothing():
    with patch("src.services.ai.base._get_redis", return_value=None):
        assert admin_service._purge_user_ai_chats(1) == 0


async def test_provision_endpoint_rate_limits_per_token(db, mock_request, token_user):
    with patch("src.routers.admin._resolve_org_slug", new_callable=AsyncMock), \
         patch("src.services.security.rate_limiting.check_admin_user_provision_rate_limit", return_value=(False, 42)), \
         patch("src.routers.admin.provision_user", new_callable=AsyncMock) as provision:
        with pytest.raises(HTTPException) as exc:
            await api_admin_provision_user(mock_request, "test-org", object(), token_user, db)
    assert exc.value.status_code == 429
    assert exc.value.headers == {"Retry-After": "42"}
    provision.assert_not_awaited()
