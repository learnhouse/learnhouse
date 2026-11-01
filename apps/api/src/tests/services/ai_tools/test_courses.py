"""Course, chapter and activity tools, run through the full tool pipeline
(validation, scope, rights pre-flight, approval gate, execute)."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.activities import (
    Activity,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.course_updates import CourseUpdate as CourseUpdateRow
from src.db.courses.courses import Course
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.services.ai.tools import (
    ToolContext,
    ToolRegistry,
    make_synthetic_request,
    run_tool,
)
from src.services.ai.tools import activities, chapters, courses
from src.tests.services.ai_tools.test_content import PNG, net  # noqa: F401  (fixture)

NOW = str(datetime.now())


# ─── fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all([*courses.SPECS, *chapters.SPECS, *activities.SPECS])
    return r


@pytest.fixture(autouse=True)
def quiet_services():
    """Keep plan counters, webhooks and storage out of the tests."""
    with patch("src.services.courses.courses.check_limits_with_usage", new=AsyncMock()), \
            patch("src.services.courses.courses.increase_feature_usage", new=AsyncMock()), \
            patch("src.services.courses.courses.decrease_feature_usage", new=AsyncMock()), \
            patch("src.services.courses.courses.dispatch_webhooks", new=AsyncMock()), \
            patch("src.services.courses.updates.dispatch_webhooks", new=AsyncMock()), \
            patch("src.services.courses.transfer.storage_utils.delete_storage_directory"):
        yield


def ctx_for(db, org, user, *, approved=False):
    return ToolContext(
        request=make_synthetic_request(),
        db_session=db,
        user=user,
        org=org,
        org_slug=org.slug,
        mode="execute",
        surface="mcp",
        approved=approved,
    )


async def call(registry, ctx, name, args):
    return await run_tool(registry, name, args, ctx)


async def _add_activity(db, org, course, chapter, *, id, uuid, name, published=True, order=1):
    a = Activity(
        id=id,
        name=name,
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={"type": "doc", "content": []},
        published=published,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=uuid,
        creation_date=NOW,
        update_date=NOW,
    )
    db.add(a)
    await db.commit()
    db.add(
        ChapterActivity(
            order=order,
            chapter_id=chapter.id,
            activity_id=a.id,
            course_id=course.id,
            org_id=org.id,
            creation_date=NOW,
            update_date=NOW,
        )
    )
    await db.commit()
    return a


async def _add_chapter(db, org, course, *, id, uuid, name, order):
    ch = Chapter(
        id=id,
        name=name,
        description="",
        org_id=org.id,
        course_id=course.id,
        chapter_uuid=uuid,
        creation_date=NOW,
        update_date=NOW,
    )
    db.add(ch)
    await db.commit()
    db.add(
        CourseChapter(
            chapter_id=ch.id,
            course_id=course.id,
            org_id=org.id,
            order=order,
            creation_date=NOW,
            update_date=NOW,
        )
    )
    await db.commit()
    return ch


@pytest.fixture
async def draft(db, org, course, chapter, activity):
    """An unpublished page after the published one."""
    return await _add_activity(
        db, org, course, chapter, id=2, uuid="activity_draft", name="Draft page", published=False, order=2
    )


@pytest.fixture
async def chapter_two(db, org, course, chapter):
    ch = await _add_chapter(db, org, course, id=2, uuid="chapter_two", name="Second", order=2)
    await _add_activity(db, org, course, ch, id=3, uuid="activity_three", name="Three", order=1)
    return ch


@pytest.fixture
async def group_draft_course(db, org, regular_user):
    """A private, unpublished course linked to a usergroup the learner is in."""
    c = Course(
        id=5,
        name="Secret Draft",
        description="not ready",
        public=False,
        published=False,
        open_to_contributors=False,
        org_id=org.id,
        course_uuid="course_secret",
        creation_date=NOW,
        update_date=NOW,
    )
    g = UserGroup(id=1, name="Cohort", description="", org_id=org.id, usergroup_uuid="usergroup_c")
    db.add_all([c, g])
    await db.commit()
    db.add_all(
        [
            UserGroupUser(usergroup_id=g.id, user_id=regular_user.id, org_id=org.id),
            UserGroupResource(usergroup_id=g.id, resource_uuid=c.course_uuid, org_id=org.id),
        ]
    )
    await db.commit()
    return c


@pytest.fixture
async def foreign(db, other_org):
    """A course, chapter and page in another organization."""
    c = Course(
        id=9,
        name="Foreign",
        description="",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=other_org.id,
        course_uuid="course_other",
        creation_date=NOW,
        update_date=NOW,
    )
    db.add(c)
    await db.commit()
    ch = await _add_chapter(db, other_org, c, id=9, uuid="chapter_other", name="Theirs", order=1)
    await _add_activity(db, other_org, c, ch, id=9, uuid="activity_other", name="Theirs")
    return c


# ─── list_courses ────────────────────────────────────────────────────────────


async def test_list_courses_shapes_and_paging(registry, db, org, admin_user, course, chapter, group_draft_course):
    ctx = ctx_for(db, org, admin_user)
    out = await call(registry, ctx, "list_courses", {})
    assert out.status == "executed", out.reason
    res = out.result
    assert res["total"] == 2 and {i["uuid"] for i in res["items"]} == {"course_test", "course_secret"}
    item = next(i for i in res["items"] if i["uuid"] == "course_test")
    assert item["kind"] == "course" and item["name"] == "Test Course"
    assert item["published"] is True and item["public"] is True and item["chapters_count"] == 1
    assert "id" not in item and "authors" not in item

    first = (await call(registry, ctx, "list_courses", {"limit": 1})).result
    assert len(first["items"]) == 1 and first["has_more"] and first["next_cursor"]
    second = (await call(registry, ctx, "list_courses", {"limit": 1, "cursor": first["next_cursor"]})).result
    assert second["items"][0]["uuid"] != first["items"][0]["uuid"] and not second["has_more"]

    drafts = (await call(registry, ctx, "list_courses", {"published": False})).result
    assert [i["uuid"] for i in drafts["items"]] == ["course_secret"]
    found = (await call(registry, ctx, "list_courses", {"query": "secret"})).result
    assert [i["uuid"] for i in found["items"]] == ["course_secret"]


async def test_list_courses_hides_group_drafts_from_learners(
    registry, db, org, regular_user, course, group_draft_course, foreign
):
    out = await call(registry, ctx_for(db, org, regular_user), "list_courses", {})
    assert out.status == "executed", out.reason
    assert [i["uuid"] for i in out.result["items"]] == ["course_test"]
    assert out.result["total"] == 1


async def test_list_courses_bad_cursor(registry, db, org, admin_user, course):
    out = await call(registry, ctx_for(db, org, admin_user), "list_courses", {"cursor": "garbage!"})
    assert out.status == "denied" and out.denied_code == "http_400"


# ─── get_course ──────────────────────────────────────────────────────────────


async def test_get_course_outline_hides_drafts_from_learners(
    registry, db, org, admin_user, regular_user, course, chapter, activity, draft
):
    learner = (await call(registry, ctx_for(db, org, regular_user), "get_course", {"course_uuid": "course_test"}))
    assert learner.status == "executed", learner.reason
    res = learner.result
    assert res["can_edit"] is False and "editor_url" not in res
    [ch] = res["chapters"]
    assert ch["kind"] == "chapter" and ch["uuid"] == "chapter_test"
    assert [a["uuid"] for a in ch["activities"]] == ["activity_test"]
    assert ch["activities"][0]["type"] == "page" and ch["activities"][0]["published"] is True

    admin = (await call(registry, ctx_for(db, org, admin_user), "get_course", {"course_uuid": "course_test"})).result
    assert admin["can_edit"] is True
    assert [a["uuid"] for a in admin["chapters"][0]["activities"]] == ["activity_test", "activity_draft"]
    assert admin["chapters"][0]["activities"][1]["published"] is False
    assert "authors" not in admin

    detailed = (
        await call(
            registry, ctx_for(db, org, admin_user), "get_course",
            {"course_uuid": "course_test", "include_details": True},
        )
    ).result
    assert "created_at" in detailed and detailed["authors"] == []


async def test_get_course_refuses_other_org_and_wrong_kind(registry, db, org, admin_user, course, chapter, foreign):
    ctx = ctx_for(db, org, admin_user)
    other = await call(registry, ctx, "get_course", {"course_uuid": "course_other"})
    assert other.status == "denied" and other.denied_code in ("rbac_denied", "http_404")
    wrong = await call(registry, ctx, "get_course", {"course_uuid": "chapter_test"})
    assert wrong.status == "denied" and wrong.denied_code == "http_400"
    assert "course_" in wrong.reason


# ─── create_course ───────────────────────────────────────────────────────────


async def test_create_course_with_outline_makes_viewable_pages(registry, db, org, admin_user):
    out = await call(
        registry,
        ctx_for(db, org, admin_user),
        "create_course",
        {
            "name": "Plants",
            "description": "Green things",
            "learnings": ["Name the parts of a leaf"],
            "tags": ["biology", "plants"],
            "chapters": [
                {"name": "Leaves", "activities": [{"name": "Intro", "markdown": "# Hi\n\nText"}, {"name": "Empty"}]},
                {"name": "Roots"},
            ],
        },
    )
    assert out.status == "executed", out.reason
    res = out.result
    assert res["ok"] and "stopped" not in res
    assert res["course"]["kind"] == "course" and res["course"]["published"] is False
    assert [c["name"] for c in res["chapters"]] == ["Leaves", "Roots"]
    pages = res["chapters"][0]["activities"]
    assert [p["name"] for p in pages] == ["Intro", "Empty"] and pages[0]["type"] == "page"
    assert "rich_blocks" not in pages[0]

    course = (await db.execute(select(Course).where(Course.course_uuid == res["course"]["uuid"]))).scalars().one()
    assert course.published is False and course.public is False
    assert course.tags == "biology|plants" and "Name the parts of a leaf" in course.learnings
    rows = (await db.execute(select(Activity).where(Activity.course_id == course.id))).scalars().all()
    assert len(rows) == 2
    for row in rows:
        assert row.activity_type == ActivityTypeEnum.TYPE_DYNAMIC
        assert row.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE
        # The draft course is the gate: publishing it shows every page.
        assert row.published is True
    intro = next(r for r in rows if r.name == "Intro")
    assert intro.content.get("type") == "doc" and intro.content.get("content")


async def test_create_course_partial_failure_reports_what_exists(registry, db, org, admin_user):
    calls = {"n": 0}
    real = courses.create_activity

    async def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise HTTPException(status_code=400, detail="Activity limit reached.")
        return await real(*args, **kwargs)

    with patch.object(courses, "create_activity", side_effect=flaky):
        out = await call(
            registry,
            ctx_for(db, org, admin_user),
            "create_course",
            {"name": "Half", "chapters": [{"name": "A", "activities": [{"name": "1", "markdown": "a"}, {"name": "2", "markdown": "b"}]}]},
        )
    assert out.status == "executed", out.reason
    assert "Activity limit reached." in out.result["stopped"]
    assert [p["name"] for p in out.result["chapters"][0]["activities"]] == ["1"]


async def test_create_course_checks_every_page_before_creating_anything(registry, db, org, admin_user):
    out = await call(
        registry,
        ctx_for(db, org, admin_user),
        "create_course",
        {"name": "Plants", "chapters": [
            {"name": "Leaves", "activities": [{"name": "Intro", "markdown": "# Hi"}]},
            {"name": "Roots", "activities": [
                {"name": "Fine", "markdown": "Text"},
                {"name": "Quiz", "markdown": "```quiz\nQ: Which part?\n- [ ] Root\n- [ ] Stem\n```"},
            ]},
        ]},
    )
    assert out.status == "denied" and out.denied_code == "http_400"
    assert out.reason.startswith("Page 'Quiz' (chapter 2, 'Roots'): In the ```quiz block starting at line 1")
    assert "no correct option" in out.reason and out.reason.endswith("Nothing was created.")
    assert (await db.execute(select(Course))).scalars().all() == []


async def test_create_course_pages_take_rich_fences(registry, db, org, admin_user):
    out = await call(
        registry,
        ctx_for(db, org, admin_user),
        "create_course",
        {"name": "Plants", "chapters": [{"name": "Leaves", "activities": [{
            "name": "Check",
            "markdown": (
                "## Check yourself\n\n```quiz\nQ: Which part?\n- [x] Leaf\n- [ ] Stem\n```\n\n"
                "```flipcards\nStomata :: Pores\nXylem :: Tubes\n```\n\n"
                "```embed\nhttps://youtu.be/aqz-KE-bpKQ\n```"
            ),
        }]}]},
    )
    assert out.status == "executed", out.reason
    page_ref = out.result["chapters"][0]["activities"][0]
    assert page_ref["rich_blocks"] == {"blockQuiz": 1, "flipcardGrid": 1, "blockEmbed": 1}
    row = (await db.execute(select(Activity))).scalars().one()
    assert [n["type"] for n in row.content["content"]] == ["heading", "blockQuiz", "flipcardGrid", "blockEmbed"]
    assert row.content["content"][3]["attrs"]["embedUrl"] == "https://www.youtube.com/embed/aqz-KE-bpKQ"


async def test_create_course_limits(registry, db, org, admin_user):
    ctx = ctx_for(db, org, admin_user)
    many = [{"name": f"c{i}", "activities": [{"name": f"p{j}"} for j in range(9)]} for i in range(25)]
    out = await call(registry, ctx, "create_course", {"name": "Big", "chapters": many})
    assert out.status == "denied" and out.denied_code == "invalid_args" and "200 pages" in out.reason
    both = await call(
        registry, ctx, "create_course",
        {"name": "X", "copy_from_course_uuid": "course_test", "chapters": [{"name": "A"}]},
    )
    assert both.status == "denied" and both.denied_code == "invalid_args"
    long_tag = await call(registry, ctx, "create_course", {"name": "X", "tags": ["x" * 61]})
    assert long_tag.status == "denied" and long_tag.denied_code == "invalid_args"
    assert (await db.execute(select(Course))).scalars().all() == []


async def test_create_course_refused_for_learners(registry, db, org, regular_user):
    out = await call(registry, ctx_for(db, org, regular_user), "create_course", {"name": "Mine"})
    assert out.status == "denied"
    assert (await db.execute(select(Course))).scalars().all() == []


async def test_create_course_copy(registry, db, org, admin_user, course, chapter, activity, foreign):
    ctx = ctx_for(db, org, admin_user)
    with patch("src.services.courses.transfer.storage_utils.is_s3_enabled", return_value=False), \
            patch("src.services.courses.transfer.storage_utils.file_exists", return_value=False), \
            patch("src.services.courses.transfer.storage_utils.list_directory", return_value=[]), \
            patch("src.services.courses.courses._copy_storage_directory"), \
            patch("os.makedirs"):
        out = await call(registry, ctx, "create_course", {"name": "Copy of test", "copy_from_course_uuid": "course_test"})
        assert out.status == "executed", out.reason
        foreign_copy = await call(registry, ctx, "create_course", {"name": "Steal", "copy_from_course_uuid": "course_other"})
    res = out.result
    assert res["course"]["name"] == "Copy of test" and res["copied_from"]["uuid"] == "course_test"
    assert res["outline"][0]["name"] == "Test Chapter"
    copy = (await db.execute(select(Course).where(Course.course_uuid == res["course"]["uuid"]))).scalars().one()
    assert copy.published is False and copy.public is False
    assert foreign_copy.status == "denied"


# ─── update / delete / announce ──────────────────────────────────────────────


async def test_update_course_approval_and_publish_activities(
    registry, db, org, admin_user, course, chapter, activity, draft
):
    plain = await call(registry, ctx_for(db, org, admin_user), "update_course", {"course_uuid": "course_test", "name": "Renamed"})
    assert plain.status == "executed", plain.reason
    assert plain.result["course"]["name"] == "Renamed"

    args = {"course_uuid": "course_test", "publish_activities": True}
    gated = await call(registry, ctx_for(db, org, admin_user), "update_course", args)
    assert gated.status == "denied" and gated.denied_code == "approval_required"

    done = await call(registry, ctx_for(db, org, admin_user, approved=True), "update_course", args)
    assert done.status == "executed", done.reason
    assert done.result["activities_changed"] == 1
    await db.refresh(draft)
    assert draft.published is True

    empty = await call(registry, ctx_for(db, org, admin_user), "update_course", {"course_uuid": "course_test"})
    assert empty.status == "denied" and empty.denied_code == "http_400"


async def test_update_course_refused_for_learners_and_other_orgs(registry, db, org, admin_user, regular_user, course, foreign):
    learner = await call(registry, ctx_for(db, org, regular_user), "update_course", {"course_uuid": "course_test", "name": "x"})
    assert learner.status == "denied"
    other = await call(registry, ctx_for(db, org, admin_user), "update_course", {"course_uuid": "course_other", "name": "x"})
    assert other.status == "denied"
    await db.refresh(course)
    assert course.name == "Test Course"


async def test_delete_course_needs_approval(registry, db, org, admin_user, course, chapter, activity):
    args = {"course_uuid": "course_test"}
    gated = await call(registry, ctx_for(db, org, admin_user), "delete_course", args)
    assert gated.denied_code == "approval_required"
    with patch("src.services.courses.courses._remove_course_from_org_landing", new=AsyncMock()):
        done = await call(registry, ctx_for(db, org, admin_user, approved=True), "delete_course", args)
    assert done.status == "executed", done.reason
    assert "1 chapter and 1 activity" in done.result["summary"]
    assert (await db.execute(select(Course).where(Course.course_uuid == "course_test"))).scalars().first() is None


async def test_create_course_update(registry, db, org, admin_user, regular_user, course):
    args = {"course_uuid": "course_test", "title": "New week", "content": "Chapter 2 is out."}
    gated = await call(registry, ctx_for(db, org, admin_user), "create_course_update", args)
    assert gated.denied_code == "approval_required"
    learner = await call(registry, ctx_for(db, org, regular_user, approved=True), "create_course_update", args)
    assert learner.status == "denied"
    done = await call(registry, ctx_for(db, org, admin_user, approved=True), "create_course_update", args)
    assert done.status == "executed", done.reason
    assert done.result["update"]["uuid"].startswith("courseupdate_")
    rows = (await db.execute(select(CourseUpdateRow))).scalars().all()
    assert [r.title for r in rows] == ["New week"]


# ─── chapters ────────────────────────────────────────────────────────────────


async def test_create_chapter_at_position(registry, db, org, admin_user, course, chapter):
    out = await call(
        registry, ctx_for(db, org, admin_user), "create_chapter",
        {"course_uuid": "course_test", "name": "Prologue", "position": 0},
    )
    assert out.status == "executed", out.reason
    assert out.result["chapter"]["uuid"].startswith("chapter_")
    outline = (await call(registry, ctx_for(db, org, admin_user), "get_course", {"course_uuid": "course_test"})).result
    assert [c["name"] for c in outline["chapters"]] == ["Prologue", "Test Chapter"]


async def test_update_chapter(registry, db, org, admin_user, regular_user, course, chapter, foreign):
    ctx = ctx_for(db, org, admin_user)
    out = await call(registry, ctx, "update_chapter", {"chapter_uuid": "chapter_test", "name": "Renamed"})
    assert out.status == "executed", out.reason
    assert out.result["chapter"]["name"] == "Renamed"
    locked = await call(registry, ctx, "update_chapter", {"chapter_uuid": "chapter_test", "lock": "restricted"})
    assert locked.denied_code == "approval_required"
    locked = await call(registry, ctx_for(db, org, admin_user, approved=True), "update_chapter", {"chapter_uuid": "chapter_test", "lock": "restricted"})
    assert locked.status == "executed" and locked.result["chapter"]["lock"] == "restricted"
    numeric = await call(registry, ctx, "update_chapter", {"chapter_id": 1, "name": "x"})
    assert numeric.denied_code == "invalid_args"
    other = await call(registry, ctx, "update_chapter", {"chapter_uuid": "chapter_other", "name": "x"})
    assert other.status == "denied"
    learner = await call(registry, ctx_for(db, org, regular_user), "update_chapter", {"chapter_uuid": "chapter_test", "name": "x"})
    assert learner.status == "denied"


async def test_delete_chapter_removes_its_activities(registry, db, org, admin_user, course, chapter, activity, draft):
    out = await call(registry, ctx_for(db, org, admin_user, approved=True), "delete_chapter", {"chapter_uuid": "chapter_test"})
    assert out.status == "executed", out.reason
    assert out.result["activities_deleted"] == 2
    assert (await db.execute(select(Activity))).scalars().all() == []


# ─── move_course_items ───────────────────────────────────────────────────────


async def _order(registry, db, org, user):
    res = (await call(registry, ctx_for(db, org, user), "get_course", {"course_uuid": "course_test"})).result
    return [(c["uuid"], [a["uuid"] for a in c["activities"]]) for c in res["chapters"]]


async def test_move_course_items(registry, db, org, admin_user, course, chapter, activity, draft, chapter_two):
    ctx = ctx_for(db, org, admin_user)
    out = await call(
        registry, ctx, "move_course_items",
        {
            "course_uuid": "course_test",
            "moves": [
                {"item_uuid": "activity_draft", "to_chapter_uuid": "chapter_two", "position": 0},
                {"item_uuid": "chapter_two", "position": 0},
                {"item_uuid": "activity_test", "after_uuid": "activity_three"},
            ],
        },
    )
    assert out.status == "executed", out.reason
    expected = [("chapter_two", ["activity_draft", "activity_three", "activity_test"]), ("chapter_test", [])]
    assert [(c["uuid"], [a["uuid"] for a in c["activities"]]) for c in out.result["outline"]] == expected
    assert await _order(registry, db, org, admin_user) == expected


async def test_move_course_items_validates_everything_first(
    registry, db, org, admin_user, course, chapter, activity, chapter_two, foreign
):
    ctx = ctx_for(db, org, admin_user)
    before = await _order(registry, db, org, admin_user)
    bad = [
        [{"item_uuid": "activity_test", "position": 0}, {"item_uuid": "activity_other", "position": 0}],
        [{"item_uuid": "chapter_test", "to_chapter_uuid": "chapter_two"}],
        [{"item_uuid": "activity_test", "before_uuid": "chapter_two"}],
        [{"item_uuid": "course_test", "position": 0}],
        [{"item_uuid": "chapter_test"}],
    ]
    for moves in bad:
        out = await call(registry, ctx, "move_course_items", {"course_uuid": "course_test", "moves": moves})
        assert out.status == "denied", moves
        assert out.denied_code in ("http_400", "http_404"), out.reason
    both = await call(
        registry, ctx, "move_course_items",
        {"course_uuid": "course_test", "moves": [{"item_uuid": "activity_test", "before_uuid": "activity_three", "position": 1}]},
    )
    assert both.denied_code == "invalid_args"
    assert await _order(registry, db, org, admin_user) == before


# ─── activities ──────────────────────────────────────────────────────────────


async def test_create_activity_page(registry, db, org, admin_user, course, chapter, activity):
    out = await call(
        registry, ctx_for(db, org, admin_user), "create_activity",
        {"chapter_uuid": "chapter_test", "name": "First", "markdown": "Some *text*", "position": 0},
    )
    assert out.status == "executed", out.reason
    res = out.result
    assert res["activity"]["type"] == "page" and res["activity"]["published"] is False
    assert res["chapter"]["uuid"] == "chapter_test" and res["course"]["uuid"] == "course_test"
    row = (await db.execute(select(Activity).where(Activity.activity_uuid == res["activity"]["uuid"]))).scalars().one()
    assert row.activity_type == ActivityTypeEnum.TYPE_DYNAMIC
    assert row.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE
    assert row.content["type"] == "doc"
    order = await _order(registry, db, org, admin_user)
    assert order[0][1][0] == res["activity"]["uuid"]


async def test_create_activity_refusals(registry, db, org, admin_user, regular_user, course, chapter, foreign):
    converted = []
    with patch.object(activities, "convert", side_effect=lambda t, **kw: converted.append(t)):
        learner = await call(
            registry, ctx_for(db, org, regular_user), "create_activity",
            {"chapter_uuid": "chapter_test", "name": "x", "markdown": "# x"},
        )
        other = await call(
            registry, ctx_for(db, org, admin_user), "create_activity",
            {"chapter_uuid": "chapter_other", "name": "x", "markdown": "# x"},
        )
    assert learner.status == "denied" and other.status == "denied"
    assert converted == []  # nothing converted before access was known
    big = await call(
        registry, ctx_for(db, org, admin_user), "create_activity",
        {"chapter_uuid": "chapter_test", "name": "x", "markdown": "a" * (activities.MAX_MARKDOWN + 1)},
    )
    assert big.denied_code == "invalid_args"


async def test_create_activities_fills_a_chapter(registry, db, org, admin_user, course, chapter, activity):
    rich = (
        "# Practice\n\n```exercise\nlanguage: python\nPrint 1.\n--- test\noutput: 1\n```\n\n"
        "```scenario\n# a\nGo?\n- Yes\n```"
    )
    out = await call(
        registry, ctx_for(db, org, admin_user), "create_activities",
        {"chapter_uuid": "chapter_test", "position": 0, "pages": [
            {"name": "One", "markdown": "Some *text*"}, {"name": "Two", "markdown": rich}, {"name": "Three"},
        ]},
    )
    assert out.status == "executed", out.reason
    made = out.result["activities"]
    assert [a["name"] for a in made] == ["One", "Two", "Three"] and "stopped" not in out.result
    assert out.result["summary"].startswith("Created 3 pages in chapter")
    order = await _order(registry, db, org, admin_user)
    assert order[0][1] == [a["uuid"] for a in made] + ["activity_test"]
    two = (await db.execute(select(Activity).where(Activity.activity_uuid == made[1]["uuid"]))).scalars().one()
    assert [n["type"] for n in two.content["content"]] == ["heading", "blockCode", "scenarios"]


async def test_create_activities_checks_everything_first(registry, db, org, admin_user, regular_user, course, chapter):
    ctx = ctx_for(db, org, admin_user)
    bad_fence = await call(registry, ctx, "create_activities", {"chapter_uuid": "chapter_test", "pages": [
        {"name": "Fine", "markdown": "ok"}, {"name": "Broken", "markdown": "```quiz\nQ: x\n- [ ] a\n- [ ] b\n```"},
    ]})
    assert bad_fence.denied_code == "http_400" and "Page 2 ('Broken')" in bad_fence.reason
    assert "Nothing was created" in bad_fence.reason
    too_many = await call(registry, ctx, "create_activities", {
        "chapter_uuid": "chapter_test", "pages": [{"name": f"p{i}"} for i in range(activities.MAX_PAGES_PER_CALL + 1)],
    })
    assert too_many.denied_code == "invalid_args"
    learner = await call(registry, ctx_for(db, org, regular_user), "create_activities",
                         {"chapter_uuid": "chapter_test", "pages": [{"name": "x"}]})
    assert learner.status == "denied"
    assert (await db.execute(select(Activity))).scalars().all() == []


@pytest.mark.parametrize("tool", ["create_activity", "create_activities", "create_course"])
async def test_custom_html_from_markdown_needs_approval(tool, registry, db, org, admin_user, course, chapter):
    page = {"name": "Widget", "markdown": "```widget\ntitle: Calc\n<p>hi</p>\n```"}
    args = {
        "create_activity": {"chapter_uuid": "chapter_test", **page},
        "create_activities": {"chapter_uuid": "chapter_test", "pages": [page]},
        "create_course": {"name": "New", "chapters": [{"name": "A", "activities": [page]}]},
    }[tool]
    gated = await call(registry, ctx_for(db, org, admin_user), tool, args)
    assert gated.denied_code == "approval_required" and "blockMagic" in gated.reason
    assert (await db.execute(select(Activity))).scalars().all() == []
    done = await call(registry, ctx_for(db, org, admin_user, approved=True), tool, args)
    assert done.status == "executed", done.reason
    row = (await db.execute(select(Activity))).scalars().one()
    assert row.content["content"][0]["type"] == "blockMagic"


async def test_update_activity(registry, db, org, admin_user, regular_user, course, chapter, activity, foreign):
    ctx = ctx_for(db, org, admin_user)
    renamed = await call(registry, ctx, "update_activity", {"activity_uuid": "activity_test", "name": "Lesson 1"})
    assert renamed.status == "executed", renamed.reason
    assert renamed.result["activity"]["name"] == "Lesson 1" and renamed.result["activity"]["type"] == "page"
    gated = await call(registry, ctx, "update_activity", {"activity_uuid": "activity_test", "published": False})
    assert gated.denied_code == "approval_required"
    done = await call(registry, ctx_for(db, org, admin_user, approved=True), "update_activity", {"activity_uuid": "activity_test", "published": False})
    assert done.status == "executed" and done.result["activity"]["published"] is False
    other = await call(registry, ctx, "update_activity", {"activity_uuid": "activity_other", "name": "x"})
    assert other.status == "denied" and other.denied_code == "http_404"
    learner = await call(registry, ctx_for(db, org, regular_user), "update_activity", {"activity_uuid": "activity_test", "name": "x"})
    assert learner.status == "denied"
    content = await call(registry, ctx, "update_activity", {"activity_uuid": "activity_test", "content": {"foo": 1}})
    assert content.status == "denied" and content.denied_code == "http_400"  # content is not a field here


async def test_delete_activity(registry, db, org, admin_user, course, chapter, activity):
    gated = await call(registry, ctx_for(db, org, admin_user), "delete_activity", {"activity_uuid": "activity_test"})
    assert gated.denied_code == "approval_required"
    done = await call(registry, ctx_for(db, org, admin_user, approved=True), "delete_activity", {"activity_uuid": "activity_test"})
    assert done.status == "executed", done.reason
    assert done.result["chapter"]["uuid"] == "chapter_test"
    assert (await db.execute(select(Activity))).scalars().all() == []


def test_catalog_metadata():
    specs = {s.name: s for s in [*courses.SPECS, *chapters.SPECS, *activities.SPECS]}
    assert set(specs) == {
        "list_courses", "get_course", "create_course", "update_course", "delete_course",
        "create_course_update", "create_chapter", "update_chapter", "delete_chapter",
        "move_course_items", "create_activity", "create_activities", "create_media_activity",
        "update_activity", "delete_activity",
    }
    for spec in specs.values():
        assert len(spec.description) <= 450, spec.name
        assert "\u2014" not in spec.description and "\u2013" not in spec.description
        if spec.tier.value != "read":
            assert spec.summarize is not None, spec.name
        for name, field in spec.params_model.model_fields.items():
            assert field.description, f"{spec.name}.{name}"


async def test_list_courses_follows_course_access_rules(registry, db, org, regular_user, course):
    """Published group courses only for the group; drafts only for authors."""
    from src.db.resource_authors import (
        ResourceAuthor,
        ResourceAuthorshipEnum,
        ResourceAuthorshipStatusEnum,
    )

    def make(id, uuid, *, public, published):
        return Course(
            id=id, name=uuid, description="", public=public, published=published,
            open_to_contributors=False, org_id=org.id, course_uuid=uuid,
            creation_date=NOW, update_date=NOW,
        )

    mine_group = UserGroup(id=2, name="Mine", description="", org_id=org.id, usergroup_uuid="usergroup_m")
    their_group = UserGroup(id=3, name="Theirs", description="", org_id=org.id, usergroup_uuid="usergroup_t")
    db.add_all([
        make(20, "course_members", public=False, published=True),
        make(21, "course_mygroup", public=False, published=True),
        make(22, "course_theirgroup", public=False, published=True),
        make(23, "course_authored_draft", public=False, published=False),
        make(24, "course_public_draft", public=True, published=False),
        mine_group,
        their_group,
    ])
    await db.commit()
    db.add_all([
        UserGroupUser(usergroup_id=mine_group.id, user_id=regular_user.id, org_id=org.id),
        UserGroupResource(usergroup_id=mine_group.id, resource_uuid="course_mygroup", org_id=org.id),
        UserGroupResource(usergroup_id=their_group.id, resource_uuid="course_theirgroup", org_id=org.id),
        ResourceAuthor(
            resource_uuid="course_authored_draft", user_id=regular_user.id,
            authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
            creation_date=NOW, update_date=NOW,
        ),
    ])
    await db.commit()
    out = await call(registry, ctx_for(db, org, regular_user), "list_courses", {"limit": 100})
    assert out.status == "executed", out.reason
    assert {i["uuid"] for i in out.result["items"]} == {
        "course_test", "course_members", "course_mygroup", "course_authored_draft",
    }


async def test_list_courses_api_token(registry, db, org, admin_user, course, group_draft_course):
    from src.db.users import APITokenUser

    def token(rights):
        return APITokenUser(
            id=0, user_uuid="apitoken_t", username="api_token", org_id=org.id,
            rights=rights, created_by_user_id=admin_user.id,
        )

    read = {"courses": {"action_create": False, "action_read": True, "action_update": False, "action_delete": False}}
    out = await call(registry, ctx_for(db, org, token(read)), "list_courses", {})
    assert out.status == "executed", out.reason
    assert out.result["total"] == 2
    denied = await call(registry, ctx_for(db, org, token({})), "list_courses", {})
    assert denied.status == "denied" and denied.denied_code == "missing_right"


@pytest.mark.parametrize("tool", ["create_activity", "create_activities", "create_course"])
async def test_markdown_images_are_stored_on_create(registry, db, org, admin_user, course, chapter, net, tool):  # noqa: F811 (fixture)
    net.routes[("files.test", "/a.png")] = httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    page = {"name": "Cells", "markdown": "Intro\n\n![](https://files.test/a.png)"}
    args = {
        "create_activity": {"chapter_uuid": "chapter_test", **page},
        "create_activities": {"chapter_uuid": "chapter_test", "pages": [page]},
        "create_course": {"name": "Bio", "chapters": [{"name": "One", "activities": [page]}]},
    }[tool]
    need = await call(registry, ctx_for(db, org, admin_user), tool, args)
    assert need.denied_code == "approval_required" and "Fetches 1 file" in need.reason
    assert not net.requests
    out = await call(registry, ctx_for(db, org, admin_user, approved=True), tool, args)
    assert out.status == "executed", out.reason
    made = {
        "create_activity": lambda r: r["activity"] | {"media": r["media"]},
        "create_activities": lambda r: r["activities"][0],
        "create_course": lambda r: r["chapters"][0]["activities"][0],
    }[tool](out.result)
    assert made["media"]["added"][0]["path"] == [1]
    row = (await db.execute(select(Activity).where(Activity.activity_uuid == made["uuid"]))).scalars().one()
    await db.refresh(row)
    assert [n["type"] for n in row.content["content"]] == ["paragraph", "blockImage"]


async def test_create_media_activity_youtube(registry, db, org, admin_user, regular_user, course, chapter, activity):
    args = {"chapter_uuid": "chapter_test", "name": "Intro talk", "kind": "youtube",
            "url": "https://youtu.be/aqz-KE-bpKQ?t=4", "position": 0}
    assert (await call(registry, ctx_for(db, org, regular_user), "create_media_activity", args)).status == "denied"
    out = await call(registry, ctx_for(db, org, admin_user), "create_media_activity", args)
    assert out.status == "executed", out.reason
    row = (await db.execute(select(Activity).where(Activity.activity_uuid == out.result["activity"]["uuid"]))).scalars().one()
    assert row.activity_type == ActivityTypeEnum.TYPE_VIDEO
    assert row.content["uri"] == "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
    assert row.published is False  # a live course: it starts as a draft, like a page
    order = await _order(registry, db, org, admin_user)
    assert order[0][1][0] == row.activity_uuid
    bad = await call(registry, ctx_for(db, org, admin_user), "create_media_activity",
                     {**args, "url": "https://vimeo.com/123"})
    assert bad.status == "denied" and "YouTube" in bad.reason


async def test_create_media_activity_pdf(registry, db, org, admin_user, course, chapter, net):  # noqa: F811 (fixture)
    pdf = b"%PDF-1.7\n" + b"0" * 200
    net.routes[("files.test", "/doc.pdf")] = httpx.Response(200, content=pdf, headers={"content-type": "application/pdf"})
    args = {"chapter_uuid": "chapter_test", "name": "Reading", "kind": "pdf", "url": "https://files.test/doc.pdf"}
    need = await call(registry, ctx_for(db, org, admin_user), "create_media_activity", args)
    assert need.denied_code == "approval_required" and not net.requests
    from src.services.courses.activities import pdf as pdf_service

    uploaded = AsyncMock(return_value="doc.pdf")
    with patch.object(pdf_service, "upload_pdf", uploaded):
        out = await call(registry, ctx_for(db, org, admin_user, approved=True), "create_media_activity", args)
    assert out.status == "executed", out.reason
    upload = uploaded.call_args.args[0]
    assert upload.content_type == "application/pdf" and upload.filename == "pdf.pdf"
    row = (await db.execute(select(Activity).where(Activity.activity_uuid == out.result["activity"]["uuid"]))).scalars().one()
    assert row.activity_type == ActivityTypeEnum.TYPE_DOCUMENT and row.content["filename"] == "doc.pdf"
    assert out.result["summary"].startswith("Created document activity 'Reading'")
    wrong = await call(registry, ctx_for(db, org, admin_user, approved=True), "create_media_activity",
                       {**args, "url": "https://www.youtube.com/watch?v=abc"})
    assert wrong.status == "denied" and "embed" in wrong.reason
