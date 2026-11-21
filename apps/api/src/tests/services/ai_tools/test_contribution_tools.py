"""The contributions read tool through the run_tool pipeline."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from src.db.courses.activity_comments import ActivityComment, ActivityCommentThread
from src.db.courses.contributions import ContentSuggestion, CourseContributionSettings
from src.services.ai.tools import ToolContext, ToolRegistry, make_synthetic_request, run_tool
from src.services.ai.tools import contributions as tools
from src.services.ai.tools import refs

NOW = str(datetime.now())


def p(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(tools.SPECS)
    return r


@pytest.fixture(autouse=True)
def web_base():
    with patch.object(refs, "web_base", new=AsyncMock(return_value="https://acme.test")):
        yield


def ctx_for(db, org, user):
    return ToolContext(
        request=make_synthetic_request(), db_session=db, user=user, org=org, org_slug=org.slug,
        mode="execute", scope_key="test", surface="mcp",
    )


async def test_lists_open_suggestions_and_feedback(registry, db, org, course, activity, admin_user, regular_user):
    activity.content = {"type": "doc", "content": [p("The sky is green.")]}
    db.add(activity)
    db.add(CourseContributionSettings(course_id=course.id, org_id=org.id, enabled=True))
    db.add(ContentSuggestion(
        suggestion_uuid="suggestion_1", org_id=org.id, course_id=course.id, activity_id=activity.id,
        author_id=regular_user.id, before=[p("The sky is green.")], after=[p("The sky is blue." + "!" * 700)],
        summary="Edits paragraph", note="Wrong colour", created_at=NOW, updated_at=NOW,
    ))
    db.add(ContentSuggestion(
        suggestion_uuid="suggestion_2", org_id=org.id, course_id=course.id, activity_id=activity.id,
        author_id=None, status="rejected", created_at=NOW, updated_at=NOW,
    ))
    thread = ActivityCommentThread(
        thread_uuid="thread_fb", activity_id=activity.id, org_id=org.id, created_by=regular_user.id,
        kind="feedback", feedback_type="typo", quote="green", created_at=NOW, updated_at=NOW,
    )
    db.add(thread)
    await db.commit()
    db.add(ActivityComment(comment_uuid="c1", thread_id=thread.id, author_id=regular_user.id, body="typo here", created_at=NOW))
    db.add(ActivityCommentThread(
        thread_uuid="thread_empty", activity_id=activity.id, org_id=org.id, created_by=None,
        kind="feedback", feedback_type="unclear", created_at=NOW, updated_at=NOW,
    ))
    await db.commit()

    out = await run_tool(registry, "list_course_contributions", {"course_uuid": "course_test"}, ctx_for(db, org, admin_user))
    assert out.status == "executed", (out.denied_code, out.reason)
    r = out.result
    assert r["enabled"] is True and r["suggestions_open"] == 1
    s = r["suggestions"][0]
    assert s["author"] == "Regular User" and s["before"] == "The sky is green." and s["fits_page"] == "clean"
    assert s["after"].endswith("…") and len(s["after"]) == tools.TEXT_MAX
    assert r["feedback_open"] == 2
    by_uuid = {f["thread_uuid"]: f for f in r["feedback"]}
    assert by_uuid["thread_fb"]["message"] == "typo here" and by_uuid["thread_fb"]["replies"] == 0
    assert by_uuid["thread_empty"]["message"] == "" and by_uuid["thread_empty"]["author"] == ""


async def test_learners_are_refused(registry, db, org, course, regular_user):
    out = await run_tool(registry, "list_course_contributions", {"course_uuid": "course_test"}, ctx_for(db, org, regular_user))
    assert out.status != "executed"


def test_name_of_user_without_names():
    class U:
        first_name = ""
        last_name = ""
        username = "solo"

    assert tools._name(U()) == "solo"
