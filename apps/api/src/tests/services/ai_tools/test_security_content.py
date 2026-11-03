"""Approval gates and attribute rules on the content-shaping tools: final
grades, lock-widening moves, folder moves, community course links, risky page
blocks, link marks and image attrs. Calls go through `run_tool` in MCP
execute mode, so the approval gate runs as it does in production."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.communities.communities import Community, CommunityCreate
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter, LockType
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.folders.folder_content import FolderContent
from src.db.folders.folders import Folder
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroups import UserGroup
from src.services.ai.tools import (
    ToolContext,
    ToolRegistry,
    make_synthetic_request,
    run_tool,
)
from src.services.ai.tools import (
    assignments,
    chapters,
    communities,
    content_edit,
    courses,
    library,
)
from src.services.ai.tools import doc_ops as d
from src.services.communities import communities as community_service

NOW = str(datetime.now())
SVC = "src.services.courses.activities.assignments"


@pytest.fixture
def registry():
    r = ToolRegistry()
    for module in (assignments, chapters, communities, content_edit, courses, library):
        r.register_all(module.SPECS)
    return r


@pytest.fixture(autouse=True)
def quiet_services():
    """Webhooks, counters, audit rows and certificates are not under test."""
    with patch(f"{SVC}.dispatch_webhooks", new=AsyncMock()), \
            patch(f"{SVC}.record_audit_event", new=AsyncMock()), \
            patch(f"{SVC}.check_course_completion_and_create_certificate", new=AsyncMock()), \
            patch(f"{SVC}.are_course_assignments_passed", new=AsyncMock(return_value=True)), \
            patch("src.services.courses.activities.versioning.dispatch_webhooks", new=AsyncMock()), \
            patch("src.services.folders.folders.dispatch_webhooks", new=AsyncMock()):
        yield


def ctx_for(db, org, user, *, approved=False):
    return ToolContext(
        request=make_synthetic_request(),
        db_session=db,
        user=user,
        org=org,
        org_slug=org.slug,
        mode="execute",
        scope_key="test",
        surface="mcp",
        approved=approved,
    )


async def call(registry, db, org, user, name, args, *, approved=False):
    return await run_tool(registry, name, args, ctx_for(db, org, user, approved=approved))


def ok(out):
    assert out.status == "executed", (out.denied_code, out.reason)
    return out.result


def needs_approval(out):
    assert out.status == "denied" and out.denied_code == "approval_required", (out.denied_code, out.reason)


async def add(db, row):
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


# ─── 1. grade_submission ─────────────────────────────────────────────────────


async def test_finalized_grade_needs_approval(
    registry, db, org, admin_user, assignment_task, user_submission, task_submission
):
    args = {"assignment_uuid": "assignment_test", "user_uuid": "user_regular", "feedback": "Well done"}
    needs_approval(await call(registry, db, org, admin_user, "grade_submission", args))
    await db.refresh(user_submission)
    assert user_submission.overall_feedback != "Well done"
    ok(await call(registry, db, org, admin_user, "grade_submission", args, approved=True))


async def test_draft_task_grades_stay_approval_free(
    registry, db, org, admin_user, assignment_task, user_submission, task_submission
):
    out = ok(await call(registry, db, org, admin_user, "grade_submission", {
        "assignment_uuid": "assignment_test", "user_uuid": "user_regular", "finalize": False,
        "task_grades": [{"assignment_task_uuid": "assignmenttask_test", "grade": 40}],
    }))
    assert "not finalized" in out["summary"]
    await db.refresh(task_submission)
    assert task_submission.grade == 40


def test_grade_summary_names_learner_and_points(registry):
    spec = registry.get("grade_submission")
    params = assignments.GradeSubmissionParams(
        assignment_uuid="assignment_test", user_uuid="user_regular", feedback="Great",
        task_grades=[{"assignment_task_uuid": "assignmenttask_test", "grade": 100}],
    )
    summary = spec.summarize(params)
    assert "user_regular" in summary and "100 pts" in summary and "Finalize" in summary
    assert "Great" in summary
    assert spec.approval_for(params) is True
    draft = params.model_copy(update={"finalize": False, "feedback": None})
    assert spec.approval_for(draft) is False


# ─── 2. move_course_items ────────────────────────────────────────────────────


async def _chapter(db, org, course, *, id, uuid, lock, order):
    ch = await add(db, Chapter(
        id=id, name=uuid, description="", org_id=org.id, course_id=course.id,
        chapter_uuid=uuid, lock_type=lock, creation_date=NOW, update_date=NOW,
    ))
    await add(db, CourseChapter(
        chapter_id=ch.id, course_id=course.id, org_id=org.id, order=order,
        creation_date=NOW, update_date=NOW,
    ))
    return ch


async def _activity(db, org, course, chapter, *, id, uuid):
    a = await add(db, Activity(
        id=id, name=uuid, activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={"type": "doc", "content": []}, published=True, org_id=org.id,
        course_id=course.id, activity_uuid=uuid, creation_date=NOW, update_date=NOW,
    ))
    await add(db, ChapterActivity(
        order=1, chapter_id=chapter.id, activity_id=a.id, course_id=course.id,
        org_id=org.id, creation_date=NOW, update_date=NOW,
    ))
    return a


async def _chapter_of(db, activity_id):
    return (
        await db.execute(select(ChapterActivity.chapter_id).where(ChapterActivity.activity_id == activity_id))
    ).scalars().all()


@pytest.fixture
async def locked_chapters(db, org, course, chapter, activity):
    restricted = await _chapter(db, org, course, id=2, uuid="chapter_staff", lock=LockType.RESTRICTED, order=2)
    await _activity(db, org, course, restricted, id=2, uuid="activity_secret")
    other = await _chapter(db, org, course, id=3, uuid="chapter_cohort", lock=LockType.RESTRICTED, order=3)
    signed_in = await _chapter(db, org, course, id=4, uuid="chapter_members", lock=LockType.AUTHENTICATED, order=4)
    return restricted, other, signed_in


async def test_move_out_of_restricted_chapter_needs_approval(registry, db, org, admin_user, locked_chapters):
    args = {"course_uuid": "course_test", "moves": [{"item_uuid": "activity_secret", "to_chapter_uuid": "chapter_test"}]}
    needs_approval(await call(registry, db, org, admin_user, "move_course_items", args))
    assert await _chapter_of(db, 2) == [2]
    ok(await call(registry, db, org, admin_user, "move_course_items", args, approved=True))
    assert await _chapter_of(db, 2) == [1]


async def test_move_between_restricted_chapters_needs_approval(registry, db, org, admin_user, locked_chapters):
    # Two restricted chapters may admit different usergroups.
    needs_approval(await call(registry, db, org, admin_user, "move_course_items", {
        "course_uuid": "course_test", "moves": [{"item_uuid": "activity_secret", "to_chapter_uuid": "chapter_cohort"}],
    }))
    needs_approval(await call(registry, db, org, admin_user, "move_course_items", {
        "course_uuid": "course_test", "moves": [{"item_uuid": "activity_secret", "to_chapter_uuid": "chapter_members"}],
    }))


async def test_tightening_or_reordering_moves_stay_approval_free(registry, db, org, admin_user, locked_chapters):
    ok(await call(registry, db, org, admin_user, "move_course_items", {
        "course_uuid": "course_test", "moves": [{"item_uuid": "activity_test", "to_chapter_uuid": "chapter_staff"}],
    }))
    assert await _chapter_of(db, 1) == [2]
    # Reordering inside a chapter and moving chapters change no lock.
    ok(await call(registry, db, org, admin_user, "move_course_items", {
        "course_uuid": "course_test",
        "moves": [{"item_uuid": "activity_test", "position": 0}, {"item_uuid": "chapter_staff", "position": 0}],
    }))
    # Moving an activity out and back in the same call ends where it started.
    ok(await call(registry, db, org, admin_user, "move_course_items", {
        "course_uuid": "course_test",
        "moves": [
            {"item_uuid": "activity_secret", "to_chapter_uuid": "chapter_test"},
            {"item_uuid": "activity_secret", "to_chapter_uuid": "chapter_staff"},
        ],
    }))


# ─── 3. place_in_library ─────────────────────────────────────────────────────


@pytest.fixture
async def private_folders(db, org, course):
    group = await add(db, UserGroup(
        id=1, name="Staff", description="", org_id=org.id, usergroup_uuid="usergroup_staff",
        creation_date=NOW, update_date=NOW,
    ))
    staff = await add(db, Folder(
        id=10, name="Staff", description="", public=False, org_id=org.id,
        folder_uuid="folder_staff", creation_date=NOW, update_date=NOW,
    ))
    inner = await add(db, Folder(
        id=11, name="Staff inner", description="", public=True, org_id=org.id, parent_folder_id=staff.id,
        folder_uuid="folder_staff_inner", creation_date=NOW, update_date=NOW,
    ))
    members = await add(db, Folder(
        id=12, name="Members", description="", public=False, org_id=org.id,
        folder_uuid="folder_members", creation_date=NOW, update_date=NOW,
    ))
    public = await add(db, Folder(
        id=13, name="Open", description="", public=True, org_id=org.id,
        folder_uuid="folder_open", creation_date=NOW, update_date=NOW,
    ))
    await add(db, UserGroupResource(
        usergroup_id=group.id, resource_uuid="folder_staff", org_id=org.id,
        creation_date=NOW, update_date=NOW,
    ))
    await add(db, FolderContent(
        folder_id=staff.id, resource_uuid=course.course_uuid, org_id=org.id, position=0,
        creation_date=NOW, update_date=NOW,
    ))
    return staff, inner, members, public


async def _folders_of(db, uuid):
    rows = (await db.execute(select(FolderContent.folder_id).where(FolderContent.resource_uuid == uuid))).scalars().all()
    return sorted(str(r) for r in rows)


async def test_move_out_of_private_folder_needs_approval(registry, db, org, admin_user, private_folders):
    for target in (None, "folder_open", "folder_members"):
        args = {"resource_uuid": "course_test", "from_folder_uuid": "folder_staff"}
        if target:
            args["folder_uuid"] = target
        needs_approval(await call(registry, db, org, admin_user, "place_in_library", args))
        assert await _folders_of(db, "course_test") == ["10"]
    ok(await call(registry, db, org, admin_user, "place_in_library", {
        "resource_uuid": "course_test", "from_folder_uuid": "folder_staff", "folder_uuid": "folder_open",
    }, approved=True))
    assert await _folders_of(db, "course_test") == ["13"]


async def test_remove_from_private_folder_needs_approval(registry, db, org, admin_user, private_folders):
    args = {"resource_uuid": "course_test", "folder_uuid": "folder_staff", "remove": True}
    needs_approval(await call(registry, db, org, admin_user, "place_in_library", args))
    assert await _folders_of(db, "course_test") == ["10"]
    ok(await call(registry, db, org, admin_user, "place_in_library", args, approved=True))
    assert await _folders_of(db, "course_test") == []


async def test_same_or_tighter_placements_stay_approval_free(registry, db, org, admin_user, private_folders, folder):
    # Into a sub-folder of the same private folder: the same restriction holds.
    ok(await call(registry, db, org, admin_user, "place_in_library", {
        "resource_uuid": "course_test", "from_folder_uuid": "folder_staff", "folder_uuid": "folder_staff_inner",
    }))
    # Plain additions into a folder, and leaving a public folder.
    ok(await call(registry, db, org, admin_user, "place_in_library", {
        "resource_uuid": "course_test", "folder_uuid": "folder_members",
    }))
    ok(await call(registry, db, org, admin_user, "place_in_library", {
        "resource_uuid": "course_test", "folder_uuid": "folder_test", "remove": True,
    }))
    ok(await call(registry, db, org, admin_user, "place_in_library", {
        "resource_uuid": "course_test", "folder_uuid": "folder_open",
    }))
    ok(await call(registry, db, org, admin_user, "place_in_library", {
        "resource_uuid": "course_test", "from_folder_uuid": "folder_open", "folder_uuid": "folder_test",
    }))


# ─── 4 and 5. community course links ─────────────────────────────────────────


async def test_create_community_with_course_needs_approval(registry, db, org, admin_user, course):
    needs_approval(await call(registry, db, org, admin_user, "create_community", {"name": "C", "course_uuid": "course_test"}))
    assert (await db.execute(select(Community))).scalars().first() is None
    out = ok(await call(registry, db, org, admin_user, "create_community", {"name": "C", "course_uuid": "course_test"}, approved=True))
    assert out["course"]["uuid"] == "course_test"
    ok(await call(registry, db, org, admin_user, "create_community", {"name": "Free"}))


def _deny_courses(real):
    async def check(request, db_session, user, uuid, action, *args, **kwargs):
        if uuid.startswith("course_"):
            raise HTTPException(status_code=403, detail="no course rights")
        return await real(request, db_session, user, uuid, action, *args, **kwargs)

    return check


async def test_service_create_checks_course_update(db, org, admin_user, course):
    real = community_service.check_resource_access
    with patch.object(community_service, "check_resource_access", side_effect=_deny_courses(real)) as check:
        with pytest.raises(HTTPException) as e:
            await community_service.create_community(
                make_synthetic_request(), org.id,
                CommunityCreate(name="C", org_id=org.id, course_id=course.id), admin_user, db,
            )
    assert e.value.status_code == 403
    assert any(c.args[3] == "course_test" for c in check.call_args_list)
    assert (await db.execute(select(Community))).scalars().first() is None


async def test_service_create_refuses_other_org_course(db, org, other_org, admin_user):
    from src.db.courses.courses import Course

    await add(db, Course(
        id=9, name="Theirs", description="", public=True, published=True, open_to_contributors=False,
        org_id=other_org.id, course_uuid="course_theirs", creation_date=NOW, update_date=NOW,
    ))
    with pytest.raises(HTTPException) as e:
        await community_service.create_community(
            make_synthetic_request(), org.id, CommunityCreate(name="C", org_id=org.id, course_id=9), admin_user, db,
        )
    assert e.value.status_code == 404


async def test_service_link_checks_course_update(db, org, admin_user, course):
    row = await add(db, Community(
        id=1, name="Main", public=True, org_id=org.id, community_uuid="community_main",
        creation_date=NOW, update_date=NOW,
    ))
    real = community_service.check_resource_access
    with patch.object(community_service, "check_resource_access", side_effect=_deny_courses(real)):
        with pytest.raises(HTTPException) as e:
            await community_service.link_community_to_course(
                make_synthetic_request(), "community_main", "course_test", admin_user, db,
            )
    assert e.value.status_code == 403
    await db.refresh(row)
    assert row.course_id is None
    linked = await community_service.link_community_to_course(
        make_synthetic_request(), "community_main", "course_test", admin_user, db,
    )
    assert linked.course_id == course.id


# ─── 6. risky page blocks ────────────────────────────────────────────────────

MAGIC = {"type": "blockMagic", "attrs": {"htmlContent": "<script>alert(1)</script>", "title": "Sim", "height": 400}}
CODE_EMBED = {"type": "blockEmbed", "attrs": {"embedCode": "<iframe src='https://x.test'></iframe>", "embedType": "code"}}
URL_EMBED = {"type": "blockEmbed", "attrs": {"embedUrl": "https://www.youtube.com/embed/abc", "embedType": "url"}}
H5P = {"type": "blockH5P", "attrs": {"h5pUrl": "https://h5p.test/x", "title": "H"}}
PREVIEW = {"type": "blockWebPreview", "attrs": {"url": "https://example.test", "title": "Ex"}}
PROSE = {"type": "paragraph", "content": [{"type": "text", "text": "Hello"}]}


async def _set_page(db, activity, content):
    activity.content = {"type": "doc", "content": content}
    return await add(db, activity)


async def _edit(registry, db, org, user, ops, *, approved=False):
    return await call(registry, db, org, user, "edit_activity_content", {"activity_uuid": "activity_test", "ops": ops}, approved=approved)


@pytest.mark.parametrize("node", [MAGIC, CODE_EMBED, H5P, PREVIEW], ids=lambda n: n["type"])
async def test_inserting_risky_blocks_needs_approval(registry, db, org, admin_user, activity, node):
    await _set_page(db, activity, [PROSE])
    ops = [{"op": "insert", "at": "end", "block": {"node": node}}]
    needs_approval(await _edit(registry, db, org, admin_user, ops))
    await db.refresh(activity)
    assert len(activity.content["content"]) == 1
    ok(await _edit(registry, db, org, admin_user, ops, approved=True))


async def test_changing_risky_blocks_needs_approval(registry, db, org, admin_user, activity):
    await _set_page(db, activity, [PROSE, MAGIC, URL_EMBED])
    needs_approval(await _edit(registry, db, org, admin_user, [
        {"op": "set_attrs", "path": [1], "attrs": {"htmlContent": "<p>new</p>"}},
    ]))
    needs_approval(await _edit(registry, db, org, admin_user, [
        {"op": "set_attrs", "path": [2], "attrs": {"embedType": "code", "embedCode": "<b>x</b>"}},
    ]))
    needs_approval(await _edit(registry, db, org, admin_user, [
        {"op": "replace_block", "path": [0], "block": {"node": PREVIEW}},
    ]))


async def test_ordinary_edits_stay_approval_free(registry, db, org, admin_user, activity):
    await _set_page(db, activity, [PROSE, MAGIC])
    ok(await _edit(registry, db, org, admin_user, [
        {"op": "insert", "at": "end", "block": {"markdown": "More *text*\n\n```embed\nhttps://www.youtube.com/watch?v=abcdefghijk\n```"}},
        {"op": "insert", "at": "end", "block": {"node": URL_EMBED}},
        {"op": "insert", "at": "end", "block": {"quiz": {"questions": [{"text": "Q", "options": [
            {"text": "a", "correct": True}, {"text": "b", "correct": False}]}]}}},
        {"op": "move", "from_path": [1], "to": "before", "path": [0]},
        {"op": "replace_text", "find": "Hello", "replace": "Hi"},
    ]))
    ok(await _edit(registry, db, org, admin_user, [{"op": "delete", "path": [0]}]))


async def test_write_content_keeps_risky_blocks_without_approval(registry, db, org, admin_user, activity):
    await _set_page(db, activity, [PROSE, MAGIC])
    ok(await call(registry, db, org, admin_user, "write_activity_content", {
        "activity_uuid": "activity_test", "mode": "replace",
        "markdown": "New intro\n\n<!-- block [1] blockMagic -->\n\n```flipcards\nQ :: A\n```",
    }))
    await db.refresh(activity)
    assert [n["type"] for n in activity.content["content"]].count("blockMagic") == 1
    ok(await call(registry, db, org, admin_user, "write_activity_content", {
        "activity_uuid": "activity_test", "mode": "append", "markdown": "Tail",
    }))


def test_added_risky_compares_blocks():
    old = {"type": "doc", "content": [MAGIC, PROSE]}
    assert d.added_risky(old, {"type": "doc", "content": [PROSE, MAGIC]}) == []
    assert d.added_risky(old, {"type": "doc", "content": [MAGIC, MAGIC]}) == ["blockMagic"]
    nested = {"type": "doc", "content": [{"type": "blockquote", "content": [CODE_EMBED]}]}
    assert d.added_risky(old, nested) == ["blockEmbed"]
    assert d.added_risky(old, {"type": "doc", "content": [URL_EMBED]}) == []
    # An embed without a type is treated as code.
    untyped = {"type": "blockEmbed", "attrs": {"embedUrl": "https://x.test"}}
    assert d.added_risky(old, {"type": "doc", "content": [untyped]}) == ["blockEmbed"]


# ─── 7. link marks ───────────────────────────────────────────────────────────


def _linked(**attrs):
    return {"type": "paragraph", "content": [
        {"type": "text", "text": "x", "marks": [{"type": "link", "attrs": {"href": "https://a.test", **attrs}}]},
    ]}


@pytest.mark.parametrize("attrs", [{"class": "btn"}, {"rel": "opener"}, {"target": "_self"}, {"target": "frame"}])
def test_link_attrs_refused(attrs):
    assert d.strict_problems(_linked(**attrs))


@pytest.mark.parametrize("attrs", [{}, {"target": "_blank"}, {"target": None, "title": "t"}])
def test_link_attrs_allowed(attrs):
    assert d.strict_problems(_linked(**attrs)) == []


async def test_editor_link_extras_are_dropped(registry, db, org, admin_user, activity):
    await _set_page(db, activity, [PROSE])
    node = _linked(target="_blank", rel="noopener noreferrer", **{"class": None})
    ok(await _edit(registry, db, org, admin_user, [{"op": "insert", "at": "end", "block": {"node": node}}]))
    await db.refresh(activity)
    mark = activity.content["content"][1]["content"][0]["marks"][0]
    assert mark["attrs"] == {"href": "https://a.test", "target": "_blank"}
    out = await _edit(registry, db, org, admin_user, [
        {"op": "insert", "at": "end", "block": {"node": _linked(target="_top")}},
    ])
    assert out.denied_code == "http_400"


# ─── 8. image attrs ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("attrs", [
    {"unsplash_url": "javascript:alert(1)"},
    {"unsplash_photographer_url": "data:text/html,x"},
    {"unsplash_photo_url": "//evil.test"},
    {"unsplash_photographer_name": "x" * 500},
    {"size": "huge"},
    {"size": {"width": 10}},
    {"size": {"width": 300, "style": "x"}},
])
def test_image_attrs_refused(attrs):
    assert d.attrs_problems("blockImage", attrs)


def test_image_attrs_allowed():
    assert d.attrs_problems("blockImage", {
        "size": {"width": 300}, "unsplash_url": "https://images.unsplash.com/x",
        "unsplash_photographer_url": "https://unsplash.com/@me", "unsplash_photographer_name": "Me",
        "unsplash_photo_url": None,
    }) == []


async def test_set_attrs_on_image_checks_urls(registry, db, org, admin_user, activity):
    image = {"type": "blockImage", "attrs": {"blockObject": {"block_uuid": "b"}, "size": {"width": 300}}}
    await _set_page(db, activity, [image])
    out = await _edit(registry, db, org, admin_user, [
        {"op": "set_attrs", "path": [0], "attrs": {"unsplash_photographer_url": "javascript:alert(1)"}},
    ])
    assert out.denied_code == "http_400"
    ok(await _edit(registry, db, org, admin_user, [
        {"op": "set_attrs", "path": [0], "attrs": {"size": {"width": 400}, "alignment": "left"}},
    ]))
