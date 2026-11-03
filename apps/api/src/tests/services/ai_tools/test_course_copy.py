"""copy_course_items (chapters and pages copied between courses, files
included) and update_course's thumbnail_url, run through the full tool
pipeline."""

import os
from datetime import datetime
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from sqlmodel import select

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.blocks import Block, BlockTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.services.ai.tools import ToolContext, ToolRegistry, make_synthetic_request, run_tool
from src.services.ai.tools import chapters, course_copy, courses
from src.services.courses.transfer import storage_utils
from src.tests.services.ai_tools.test_content import PNG, net  # noqa: F401  (fixture)

NOW = str(datetime.now())
SRC = "content/orgs/org_test/courses/course_test/activities/activity_test"


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all([*courses.SPECS, *chapters.SPECS, *course_copy.SPECS])
    return r


@pytest.fixture(autouse=True)
def local_storage(tmp_path, monkeypatch):
    """Stored files go to a temporary local tree; plan counters stay out."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(storage_utils, "get_content_delivery_type", lambda: "filesystem")
    monkeypatch.setattr(storage_utils, "is_s3_enabled", lambda: False)
    with patch("src.services.courses.courses.dispatch_webhooks", new=AsyncMock()):
        yield tmp_path


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


@pytest.fixture
async def rich_source(db, org, course, chapter, activity):
    """The test page with an image block whose file is stored, plus a second
    page and an assignment in the same chapter."""
    activity.content = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Hello"}]},
            {
                "type": "blockImage",
                "attrs": {
                    "blockObject": {
                        "block_uuid": "block_src",
                        "content": {"file_id": "block_file1", "file_format": "png", "activity_uuid": "activity_test"},
                    }
                },
            },
        ],
    }
    db.add(activity)
    db.add(
        Block(
            block_type=BlockTypeEnum.BLOCK_IMAGE,
            content={"file_id": "block_file1", "file_format": "png", "activity_uuid": "activity_test"},
            org_id=org.id,
            course_id=course.id,
            chapter_id=chapter.id,
            activity_id=activity.id,
            block_uuid="block_src",
            creation_date=NOW,
            update_date=NOW,
        )
    )
    for id_, uuid, name, type_, sub, order in (
        (2, "activity_second", "Second page", ActivityTypeEnum.TYPE_DYNAMIC, ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE, 2),
        (3, "activity_hw", "Homework", ActivityTypeEnum.TYPE_ASSIGNMENT, ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY, 3),
    ):
        db.add(
            Activity(
                id=id_, name=name, activity_type=type_, activity_sub_type=sub,
                content={"type": "doc", "content": []}, published=True, org_id=org.id,
                course_id=course.id, activity_uuid=uuid, creation_date=NOW, update_date=NOW,
            )
        )
        await db.commit()
        db.add(
            ChapterActivity(
                order=order, chapter_id=chapter.id, activity_id=id_, course_id=course.id,
                org_id=org.id, creation_date=NOW, update_date=NOW,
            )
        )
    await db.commit()
    folder = f"{SRC}/dynamic/blocks/imageBlock/block_src"
    os.makedirs(folder)
    with open(f"{folder}/block_file1.png", "wb") as f:
        f.write(PNG)
    return activity


@pytest.fixture
async def target(db, org):
    """A draft course with one chapter holding one page."""
    c = Course(
        id=2, name="Target", description="", public=False, published=False,
        open_to_contributors=False, org_id=org.id, course_uuid="course_target",
        creation_date=NOW, update_date=NOW,
    )
    db.add(c)
    await db.commit()
    ch = Chapter(
        id=2, name="Existing", description="", org_id=org.id, course_id=c.id,
        chapter_uuid="chapter_target", creation_date=NOW, update_date=NOW,
    )
    db.add(ch)
    await db.commit()
    db.add(CourseChapter(chapter_id=ch.id, course_id=c.id, org_id=org.id, order=1, creation_date=NOW, update_date=NOW))
    db.add(
        Activity(
            id=10, name="Already here", activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE, content={"type": "doc", "content": []},
            published=True, org_id=org.id, course_id=c.id, activity_uuid="activity_here",
            creation_date=NOW, update_date=NOW,
        )
    )
    await db.commit()
    db.add(ChapterActivity(order=1, chapter_id=ch.id, activity_id=10, course_id=c.id, org_id=org.id, creation_date=NOW, update_date=NOW))
    await db.commit()
    return c


async def _outline(registry, db, org, user, course_uuid):
    out = await call(registry, ctx_for(db, org, user), "get_course", {"course_uuid": course_uuid})
    return [(c["name"], [a["name"] for a in c["activities"]]) for c in out.result["chapters"]]


# ─── copy_course_items ───────────────────────────────────────────────────────


async def test_copy_chapter_into_another_course_copies_content_and_files(
    registry, db, org, admin_user, rich_source, target
):
    out = await call(
        registry, ctx_for(db, org, admin_user), "copy_course_items",
        {"course_uuid": "course_target", "chapter_uuids": ["chapter_test"], "position": 0},
    )
    assert out.status == "executed", out.reason
    res = out.result
    assert res["summary"].startswith("Copied 1 chapter with 2 pages into 'Target'")
    assert [s["uuid"] for s in res["skipped"]] == ["activity_hw"]
    assert "locks" in res["note"]
    copied = res["chapters"][0]
    assert copied["copied_from"] == "chapter_test" and copied["uuid"] != "chapter_test"
    assert [a["name"] for a in copied["activities"]] == ["Test Activity", "Second page"]
    # Placed first; the target's own chapter keeps its page.
    assert await _outline(registry, db, org, admin_user, "course_target") == [
        ("Test Chapter", ["Test Activity", "Second page"]),
        ("Existing", ["Already here"]),
    ]

    new_uuid = copied["activities"][0]["uuid"]
    new = (await db.execute(select(Activity).where(Activity.activity_uuid == new_uuid))).scalars().one()
    assert new.course_id == target.id
    # The draft target keeps the originals' published state.
    assert new.published is True
    block = (await db.execute(select(Block).where(Block.activity_id == new.id))).scalars().one()
    assert block.block_uuid != "block_src" and block.course_id == target.id
    file_id = block.content["file_id"]
    assert file_id != "block_file1" and block.content["activity_uuid"] == new_uuid
    # The page points at the copied block and file, never the source's.
    node = new.content["content"][1]["attrs"]["blockObject"]
    assert node["block_uuid"] == block.block_uuid
    assert node["content"] == {"file_id": file_id, "file_format": "png", "activity_uuid": new_uuid}
    assert new.content["content"][0]["content"][0]["text"] == "Hello"
    copied_file = (
        f"content/orgs/org_test/courses/course_target/activities/{new_uuid}"
        f"/dynamic/blocks/imageBlock/{block.block_uuid}/{file_id}.png"
    )
    assert open(copied_file, "rb").read() == PNG
    # The source is untouched.
    assert os.path.exists(f"{SRC}/dynamic/blocks/imageBlock/block_src/block_file1.png")
    await db.refresh(rich_source)
    assert rich_source.content["content"][1]["attrs"]["blockObject"]["block_uuid"] == "block_src"
    # The original assignment stayed where it was and was not duplicated.
    homework = (await db.execute(select(Activity).where(Activity.name == "Homework"))).scalars().all()
    assert len(homework) == 1


async def test_copy_pages_into_a_live_course_makes_drafts_at_a_position(
    registry, db, org, admin_user, rich_source, chapter
):
    # Same (published) course, into its own chapter, at the top.
    out = await call(
        registry, ctx_for(db, org, admin_user), "copy_course_items",
        {
            "course_uuid": "course_test",
            "activity_uuids": ["activity_second", "activity_hw"],
            "to_chapter_uuid": "chapter_test",
            "position": 0,
        },
    )
    assert out.status == "executed", out.reason
    res = out.result
    assert "drafts" in res["summary"] and res["to_chapter"]["uuid"] == "chapter_test"
    assert [a["published"] for a in res["activities"]] == [False]
    assert res["skipped"][0]["uuid"] == "activity_hw"
    order = (
        await db.execute(
            select(Activity.name)
            .join(ChapterActivity, ChapterActivity.activity_id == Activity.id)
            .where(ChapterActivity.chapter_id == chapter.id)
            .order_by(ChapterActivity.order)
        )
    ).scalars().all()
    assert order == ["Second page", "Test Activity", "Second page", "Homework"]


async def test_copy_refusals(registry, db, org, admin_user, regular_user, rich_source, target, other_org):
    learner = await call(
        registry, ctx_for(db, org, regular_user), "copy_course_items",
        {"course_uuid": "course_target", "chapter_uuids": ["chapter_test"]},
    )
    assert learner.status == "denied"
    no_chapter = await call(
        registry, ctx_for(db, org, admin_user), "copy_course_items",
        {"course_uuid": "course_target", "activity_uuids": ["activity_test"]},
    )
    assert no_chapter.denied_code == "invalid_args"
    wrong_chapter = await call(
        registry, ctx_for(db, org, admin_user), "copy_course_items",
        {"course_uuid": "course_target", "activity_uuids": ["activity_test"], "to_chapter_uuid": "chapter_test"},
    )
    assert wrong_chapter.denied_code == "http_400" and "not a chapter of" in wrong_chapter.reason
    foreign = Course(
        id=9, name="Foreign", description="", public=True, published=True, open_to_contributors=False,
        org_id=other_org.id, course_uuid="course_other", creation_date=NOW, update_date=NOW,
    )
    db.add(foreign)
    await db.commit()
    db.add(Chapter(id=9, name="Theirs", description="", org_id=other_org.id, course_id=9,
                   chapter_uuid="chapter_other", creation_date=NOW, update_date=NOW))
    await db.commit()
    stolen = await call(
        registry, ctx_for(db, org, admin_user), "copy_course_items",
        {"course_uuid": "course_target", "chapter_uuids": ["chapter_other"]},
    )
    assert stolen.status == "denied" and stolen.denied_code == "http_404"
    # Nothing was written by any refusal.
    assert len((await db.execute(select(Chapter).where(Chapter.course_id == target.id))).scalars().all()) == 1


async def test_copy_needs_edit_rights_on_the_source(registry, db, org, admin_user, rich_source, target):
    """Edit rights on the target are not enough: a copy carries drafts and answers."""
    from fastapi import HTTPException

    from src.security import rbac

    real = rbac.check_resource_access

    async def deny_source(request, db_session, user, uuid, action, *a, **kw):
        if uuid == "course_test":
            raise HTTPException(status_code=403, detail="No edit rights on the source")
        return await real(request, db_session, user, uuid, action, *a, **kw)

    with patch("src.services.ai.tools.course_copy.check_resource_access", new=deny_source):
        out = await call(
            registry, ctx_for(db, org, admin_user), "copy_course_items",
            {"course_uuid": "course_target", "chapter_uuids": ["chapter_test"]},
        )
    assert out.status == "denied" and out.denied_code == "http_403"
    assert len((await db.execute(select(Chapter).where(Chapter.course_id == target.id))).scalars().all()) == 1


async def test_copy_failure_rolls_back_and_removes_copied_files(registry, db, org, admin_user, rich_source, target):
    real = course_copy.clone_activity
    calls = 0

    async def fail_second(*a, **kw):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("disk full")
        return await real(*a, **kw)

    with patch.object(course_copy, "clone_activity", new=fail_second):
        out = await call(
            registry, ctx_for(db, org, admin_user), "copy_course_items",
            {"course_uuid": "course_target", "chapter_uuids": ["chapter_test"]},
        )
    assert out.denied_code == "http_500" and "nothing was created" in out.reason
    left = (await db.execute(select(Activity.activity_uuid).where(Activity.course_id == 2))).scalars().all()
    assert left == ["activity_here"]
    assert len((await db.execute(select(Chapter).where(Chapter.course_id == 2))).scalars().all()) == 1
    assert os.listdir("content/orgs/org_test/courses/course_target/activities") == []


async def test_copy_caps(registry, db, org, admin_user, target):
    too_many = await call(
        registry, ctx_for(db, org, admin_user), "copy_course_items",
        {"course_uuid": "course_target", "chapter_uuids": [f"chapter_{i}" for i in range(course_copy.MAX_CHAPTERS + 1)]},
    )
    assert too_many.denied_code == "invalid_args"
    nothing = await call(registry, ctx_for(db, org, admin_user), "copy_course_items", {"course_uuid": "course_target"})
    assert nothing.denied_code == "invalid_args"


def test_copy_spec():
    spec = course_copy.SPECS[0]
    assert spec.name == "copy_course_items" and spec.tier.value == "create"
    assert not spec.may_need_approval and not spec.open_world
    assert len(spec.description) <= 450 and "—" not in spec.description
    for name, field in spec.params_model.model_fields.items():
        assert field.description, name


# ─── update_course thumbnail_url ─────────────────────────────────────────────


async def test_update_course_thumbnail_needs_approval_then_stores(registry, db, org, admin_user, course, net):  # noqa: F811 (fixture)
    net.routes[("files.test", "/cover.png")] = httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    args = {"course_uuid": "course_test", "thumbnail_url": "https://files.test/cover.png"}
    stored = {}

    async def upload(file, org_uuid, course_uuid):
        stored["body"] = file.file.read()
        stored["type"] = file.content_type
        return "thumb.png"

    with patch("src.services.courses.courses.upload_thumbnail", new=upload):
        gated = await call(registry, ctx_for(db, org, admin_user), "update_course", args)
        assert gated.status == "denied" and gated.denied_code == "approval_required"
        assert "files.test" in gated.reason and net.requests == []

        done = await call(registry, ctx_for(db, org, admin_user, approved=True), "update_course", args)
    assert done.status == "executed", done.reason
    assert "thumbnail" in done.result["summary"]
    assert stored == {"body": PNG, "type": "image/png"}
    await db.refresh(course)
    assert course.thumbnail_image == "thumb.png"


async def test_update_course_thumbnail_rejects_bad_urls_before_fetching(registry, db, org, admin_user, course, net):  # noqa: F811 (fixture)
    ctx = ctx_for(db, org, admin_user, approved=True)
    for url in ("ftp://files.test/a.png", "https://user:pw@files.test/a.png", "http://files.test:8080/a.png"):
        out = await call(registry, ctx, "update_course", {"course_uuid": "course_test", "thumbnail_url": url})
        assert out.denied_code == "http_400", url
    # Not an image: refused after the fetch, before anything is stored.
    net.routes[("files.test", "/doc.pdf")] = httpx.Response(200, content=b"%PDF-1.4" + b"\x00" * 40)
    pdf = await call(registry, ctx, "update_course", {"course_uuid": "course_test", "thumbnail_url": "https://files.test/doc.pdf"})
    assert pdf.denied_code == "http_400" and "image" in pdf.reason
    assert len(net.requests) == 1
    await db.refresh(course)
    assert not course.thumbnail_image


def test_update_course_spec_marks_outside_fetches():
    spec = next(s for s in courses.SPECS if s.name == "update_course")
    assert spec.open_world and spec.approval_in_call
    assert "thumbnail_url" in spec.description and len(spec.description) <= 450
