"""build_course, add_blocks and validate_content (course_build.py), run
through the full tool pipeline like an MCP call."""

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.activities import Activity, ActivityTypeEnum
from src.db.courses.assignments import Assignment, AssignmentTask
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.users import APITokenUser
from src.services.ai.tools import course_build as cb
from src.services.ai.tools import get_mcp_registry, get_registry, run_tool
from src.tests.services.ai_tools.test_content import PNG, net  # noqa: F401  (fixture)
from src.tests.services.ai_tools.test_courses import ctx_for, quiet_services  # noqa: F401  (fixture)


class FakeRedis:
    def __init__(self):
        self.data = {}

    def get(self, key):
        return self.data.get(key)

    def set(self, key, value, ex=None):
        self.data[key] = value


@pytest.fixture(autouse=True)
def redis_store():
    store = FakeRedis()
    with patch.object(cb, "get_redis_client", return_value=store):
        yield store


SVC = "src.services.courses.activities.assignments"


@pytest.fixture(autouse=True)
def quiet_assignments():
    from src.services.ai.tools import assignments

    with patch("src.services.courses.activities.versioning.dispatch_webhooks", new=AsyncMock()), \
            patch(f"{SVC}.check_limits_with_usage", new=AsyncMock()), \
            patch.object(assignments, "check_limits_with_usage", new=AsyncMock()), \
            patch(f"{SVC}.increase_feature_usage", new=AsyncMock()), \
            patch(f"{SVC}.dispatch_webhooks", new=AsyncMock()), \
            patch(f"{SVC}.record_audit_event", new=AsyncMock()):
        yield


async def build(db, org, user, args, **kw):
    return await run_tool(get_mcp_registry(), "build_course", args, ctx_for(db, org, user, **kw))


def page(name, key=None, **kw):
    return {"name": name, **({"key": key} if key else {}), **kw}


SPEC = {
    "idempotency_key": "build-test-0001",
    "course": {
        "name": "Plants",
        "description": "How plants live.",
        "about": "A short course.",
        "objectives": ["Explain photosynthesis", "Name leaf parts"],
        "prerequisites": ["Reading"],
        "tags": ["biology"],
    },
    "chapters": [
        {"key": "c1", "name": "Leaves", "description": "All about leaves", "activities": [
            page("Intro", "intro", markdown="## Leaves\n\nLeaves make **sugar**.\n\n```quiz\nQ: What do leaves make?\n- [x] Sugar\n- [ ] Salt\n```"),
            page("Blocks", "blocks", blocks=[
                {"type": "callout", "style": "tip", "text": "Look closely."},
                {"type": "flashcards", "cards": [{"front": "Stomata", "back": "Pores"}, {"front": "Xylem", "back": "Tubes"}]},
                {"type": "toggle", "summary": "Answer", "blocks": [{"type": "paragraph", "text": "Sugar."}]},
            ]),
            page("Both", "both", markdown="Intro text.", blocks=[{"type": "divider"}]),
            page("Empty", "empty"),
        ]},
        {"key": "c2", "name": "Check", "activities": [
            {"key": "exam", "kind": "assignment", "name": "Leaf test", "description": "Do it.", "auto_grading": True, "tasks": [
                {"type": "quiz", "title": "Parts", "questions": [{"text": "Chlorophyll?", "options": [{"text": "Chloroplast", "correct": True}, {"text": "Root"}]}]},
            ]},
            {"key": "yt", "kind": "youtube", "name": "Watch", "url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ"},
        ]},
    ],
    "settings": {
        "certificate": {"enabled": True, "name": "Plants"},
        "seo": {"title": "Plants course", "description": "Learn plants."},
        "drip": {"enabled": True, "anchor": "enrollment", "chapters": [{"chapter": "c2", "mode": "delay", "delay_days": 3}]},
    },
}


# ─── spec validation ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "args, problem",
    [
        ({"chapters": []}, "course.name"),
        ({"course": {"name": "x"}, "chapters": [{"key": "a", "name": "1"}, {"key": "a", "name": "2"}]}, "chapter keys must be unique"),
        ({"course": {"name": "x"}, "chapters": [{"name": "c", "activities": [page("a", "k"), page("b", "k")]}]}, "activity keys must be unique"),
        ({"course": {"name": "x"}, "chapters": [{"name": "c", "activities": [{"name": "v", "kind": "video"}]}]}, "needs url"),
        ({"course": {"name": "x"}, "chapters": [{"name": "c", "activities": [{"name": "v", "kind": "pdf", "url": "https://x.test/a.pdf", "markdown": "x"}]}]}, "cannot be set on a pdf"),
        ({"course": {"name": "x", "tags": [" "]}}, "each of tags"),
        ({"course": {"name": "x"}, "chapters": [{"name": "c", "activities": [page(str(i)) for i in range(cb.MAX_ACTIVITIES + 1)]}]}, "at most"),
    ],
)
async def test_invalid_specs_are_refused(db, org, admin_user, args, problem):
    out = await build(db, org, admin_user, args)
    assert out.status == "denied" and out.denied_code == "invalid_args"
    assert problem in out.reason


async def test_spec_size_cap(db, org, admin_user, monkeypatch):
    monkeypatch.setattr(cb, "MAX_SPEC_CHARS", 200)
    out = await build(db, org, admin_user, {"course": {"name": "x", "about": "y" * 300}})
    assert "build in parts" in out.reason


async def test_content_errors_fail_before_anything_is_written(db, org, admin_user):
    bad_block = {"course": {"name": "x"}, "chapters": [{"name": "c", "activities": [page("p", blocks=[{"type": "quiz", "questions": [{"text": "q", "options": [{"text": "a"}, {"text": "b"}]}]}])]}]}
    out = await build(db, org, admin_user, bad_block)
    assert out.denied_code == "http_400" and "Chapter 1 'c', activity 1 'p'" in out.reason and "no option marked correct" in out.reason
    bad_md = {"course": {"name": "x"}, "chapters": [{"name": "c", "activities": [page("p", markdown="```quiz\nnothing here\n```")]}]}
    assert (await build(db, org, admin_user, bad_md)).denied_code == "http_400"
    bad_task = {"course": {"name": "x"}, "chapters": [{"name": "c", "activities": [{"name": "a", "kind": "assignment", "tasks": [{"type": "essay"}]}]}]}
    out = await build(db, org, admin_user, bad_task)
    assert "tasks:" in out.reason
    bad_drip = {**SPEC, "idempotency_key": None, "settings": {"drip": {"chapters": [{"chapter": "nope", "mode": "immediate"}]}}}
    assert "is not a chapter key or name" in (await build(db, org, admin_user, bad_drip)).reason
    bad_setting = {"course": {"name": "x"}, "settings": {"certificate": {"type": "no-such-type"}}}
    assert "settings (Set the certificate)" in (await build(db, org, admin_user, bad_setting)).reason
    too_many_files = {"course": {"name": "x"}, "chapters": [{"name": "c", "activities": [
        page("p", blocks=[{"type": "image", "url": f"https://f.test/{i}.png", "alt": "a"} for i in range(21)])]}]}
    assert "the limit is 20" in (await build(db, org, admin_user, too_many_files)).reason
    assert (await db.execute(select(Course))).scalars().all() == []


# ─── building ────────────────────────────────────────────────────────────────


async def test_dry_run_plans_without_writing(db, org, admin_user):
    out = await build(db, org, admin_user, {**SPEC, "dry_run": True})
    r = out.result
    assert out.status == "executed" and r["dry_run"] is True
    assert r["counts"] == {"create": 9, "update": 0, "unchanged": 0}
    kinds = [s["what"] for s in r["steps"]]
    assert kinds[:3] == ["course", "chapter", "page"] and "assignment" in kinds and "youtube" in kinds and kinds.count("setting") == 3
    exam = next(s for s in r["steps"] if s["what"] == "assignment")
    assert exam["tasks"] == ["quiz"]
    assert r["needs_approval"] is None
    assert (await db.execute(select(Course))).scalars().all() == []


async def test_full_build_then_replay_then_update(db, org, admin_user, redis_store):
    with patch("src.services.ai.tools.courses._set_thumbnail", new=AsyncMock()):
        out = await build(db, org, admin_user, SPEC)
    assert out.status == "executed", out.reason
    r = out.result
    assert r["ok"] is True and r["counts"]["created"] == 9 and not r.get("failed"), r.get("failed")
    assert set(r["settings_applied"]) == {"Set the certificate", "Set SEO", "Set the drip schedule"}
    course = (await db.execute(select(Course))).scalars().one()
    assert course.name == "Plants" and "Before you start:\n- Reading" in course.about and not course.published
    assert "Explain photosynthesis" in course.learnings and course.seo.get("title") == "Plants course"
    ids = r["ids"]
    assert set(ids["chapters"]) == {"c1", "c2"} and {"intro", "blocks", "both", "empty", "exam", "yt"} <= set(ids["activities"])
    blocks = await db.get(Activity, (await db.execute(select(Activity.id).where(Activity.activity_uuid == ids["activities"]["blocks"]))).scalar_one())
    assert [n["type"] for n in blocks.content["content"]] == ["callout", "flipcardGrid", "toggleBlock"]
    both = (await db.execute(select(Activity).where(Activity.activity_uuid == ids["activities"]["both"]))).scalars().one()
    assert [n["type"] for n in both.content["content"]] == ["paragraph", "horizontalRule"]
    assignment = (await db.execute(select(Assignment))).scalars().one()
    assert assignment.title == "Leaf test" and len((await db.execute(select(AssignmentTask))).scalars().all()) == 1

    # Same key and spec: replayed, nothing new.
    again = await build(db, org, admin_user, SPEC)
    assert again.result["replayed"] is True
    assert len((await db.execute(select(Course))).scalars().all()) == 1

    # Same key, other spec: refused with how to update instead.
    other = await build(db, org, admin_user, {**SPEC, "course": {**SPEC["course"], "name": "Other"}})
    assert other.denied_code == "http_409" and course.course_uuid in other.reason

    # Update mode: a diff in the plan, then only that page changes.
    update = {"course_uuid": course.course_uuid, "course": {"description": "New card text"}, "chapters": [
        {"key": "c1", "name": "Leaves and stems", "activities": [
            page("Intro", "intro", markdown="## Leaves\n\nRewritten."),
            page("Blocks", "blocks", blocks=SPEC["chapters"][0]["activities"][1]["blocks"]),
            page("New page", "new", markdown="Fresh."),
        ]},
        {"key": "c2", "name": "Check", "activities": [
            {"key": "exam", "kind": "assignment", "name": "Leaf test v2", "due_date": "2030-01-01"},
            {"key": "yt", "kind": "youtube", "name": "Watch", "url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ"},
        ]},
    ]}
    plan = (await build(db, org, admin_user, {**update, "dry_run": True})).result
    actions = {s.get("name"): s["action"] for s in plan["steps"] if s["what"] != "setting"}
    assert actions[None] == "update"  # the course itself (description)
    assert actions["Leaves and stems"] == "update" and actions["Intro"] == "update" and actions["Blocks"] == "unchanged"
    assert actions["New page"] == "create" and actions["Leaf test v2"] == "update" and actions["Watch"] == "unchanged"
    intro = next(s for s in plan["steps"] if s.get("name") == "Intro")
    assert "+Rewritten." in intro["diff"] and intro["changes"][0].startswith("content: +")
    done = (await build(db, org, admin_user, update)).result
    assert done["counts"] == {"created": 1, "updated": 4, "unchanged": 3}, done
    await db.refresh(course)
    assert course.description == "New card text"
    chapter = (await db.execute(select(Chapter).where(Chapter.chapter_uuid == ids["chapters"]["c1"]))).scalars().one()
    assert chapter.name == "Leaves and stems"
    intro_row = (await db.execute(select(Activity).where(Activity.activity_uuid == ids["activities"]["intro"]))).scalars().one()
    assert "Rewritten" in json.dumps(intro_row.content)
    # Items left out of the spec are kept, after the ones in it.
    outline = await run_tool(get_registry(), "get_course", {"course_uuid": course.course_uuid}, ctx_for(db, org, admin_user))
    names = [a["name"] for a in outline.result["chapters"][0]["activities"]]
    assert names == ["Intro", "Blocks", "New page", "Both", "Empty"]


async def test_failures_do_not_stop_the_build_and_resume_finishes_it(db, org, admin_user):
    real = cb._write_page
    calls = {"n": 0}

    async def flaky(ctx, course, chapter, pa):
        calls["n"] += 1
        if pa.spec.name == "Blocks" and calls["n"] < 10:
            raise HTTPException(status_code=500, detail="storage hiccup")
        if pa.spec.name == "Both" and calls["n"] < 10:
            raise RuntimeError("boom")
        return await real(ctx, course, chapter, pa)

    spec = {k: v for k, v in SPEC.items() if k != "settings"}
    with patch.object(cb, "_write_page", side_effect=flaky):
        first = (await build(db, org, admin_user, spec)).result
        assert first["ok"] is False and {f["item"] for f in first["failed"]} == {"activity 'Blocks'", "activity 'Both'"}
        assert {f["code"] for f in first["failed"]} == {"http_500", "internal_error"}
        assert first["resume"]["idempotency_key"] == spec["idempotency_key"]
        calls["n"] = 100
        second = (await build(db, org, admin_user, spec)).result
    assert second["ok"] is True and second["counts"]["created"] == 2 and second["counts"]["unchanged"] >= 5, second
    assert len((await db.execute(select(Course))).scalars().all()) == 1


async def test_chapter_failure_skips_its_activities(db, org, admin_user):
    spec = {"course": {"name": "x"}, "chapters": [{"name": "c", "activities": [page("a"), page("b")]}]}
    with patch("src.services.courses.chapters.create_chapter", new=AsyncMock(side_effect=HTTPException(status_code=403, detail="no"))):
        r = (await build(db, org, admin_user, spec)).result
    assert [f["code"] for f in r["failed"]] == ["http_403", "skipped", "skipped"]


async def test_setting_and_thumbnail_failures_are_reported(db, org, admin_user, redis_store):
    spec = {"idempotency_key": "build-test-0002", "course": {"name": "x", "thumbnail_url": "https://img.test/a.png"}, "settings": {"languages": ["fr"]}}
    with patch("src.services.ai.tools.courses._set_thumbnail", new=AsyncMock(side_effect=HTTPException(status_code=400, detail="bad image"))), \
            patch("src.services.ai.tools.translations.svc.add_language", new=AsyncMock(side_effect=HTTPException(status_code=403, detail="Languages are off"))):
        out = await build(db, org, admin_user, spec, approved=True)
    r = out.result
    assert {f["item"] for f in r["failed"]} == {"course thumbnail", "Add the fr language version"}
    assert not json.loads(next(iter(redis_store.data.values()))).get("done")


async def test_order_failure_is_reported(db, org, admin_user):
    with patch.object(cb, "write_order", new=AsyncMock(side_effect=HTTPException(status_code=409, detail="raced"))):
        r = (await build(db, org, admin_user, {"course": {"name": "x"}, "chapters": [{"name": "a"}, {"name": "b"}]})).result
    assert r["counts"]["created"] == 3
    with patch.object(cb, "current_order", new=AsyncMock(side_effect=HTTPException(status_code=409, detail="raced"))):
        r = (await build(db, org, admin_user, {"course": {"name": "y"}})).result
    assert r["failed"][0]["item"] == "order"


async def test_redis_trouble_degrades_gracefully(db, org, admin_user):
    class Broken:
        def get(self, key):
            raise ConnectionError("down")

        def set(self, *a, **k):
            raise ConnectionError("down")

    with patch.object(cb, "get_redis_client", return_value=Broken()):
        r = (await build(db, org, admin_user, {"idempotency_key": "build-test-0003", "course": {"name": "x"}})).result
    assert r["ok"] and "could not be saved" in r["note"]
    with patch.object(cb, "get_redis_client", return_value=None):
        r = (await build(db, org, admin_user, {"idempotency_key": "build-test-0004", "course": {"name": "y"}})).result
    assert "could not be saved" in r["note"]
    assert cb.save_record(None, None, {}) is False and cb.load_record(None, None) is None


async def test_files_custom_html_and_publishing_need_one_approval(db, org, admin_user, net):  # noqa: F811 (fixture)
    net.routes[("img.test", "/a.png")] = httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    spec = {"course": {"name": "Rich"}, "chapters": [{"name": "c", "activities": [page("p", blocks=[
        {"type": "image", "url": "https://img.test/a.png", "alt": "A leaf", "caption": "Leaf"},
        {"type": "widget", "html": "<html></html>"},
    ])]}], "settings": {"publish": True}}
    plan = (await build(db, org, admin_user, {**spec, "dry_run": True})).result
    assert len(plan["needs_approval"]) == 3
    held = await build(db, org, admin_user, spec)
    assert held.denied_code == "approval_required" and "Fetches 1 file" in held.reason
    ok = await build(db, org, admin_user, spec, approved=True)
    assert ok.status == "executed" and ok.result["ok"], ok.result
    row = (await db.execute(select(Activity).where(Activity.activity_type == ActivityTypeEnum.TYPE_DYNAMIC))).scalars().one()
    assert [n["type"] for n in row.content["content"]][:3] == ["blockImage", "paragraph", "blockMagic"]
    assert row.content["content"][0]["attrs"]["alt"] == "A leaf"
    course = (await db.execute(select(Course))).scalars().one()
    assert course.published


def test_summary_names_what_needs_approval():
    p = cb.BuildCourseParams.model_validate({
        "course": {"name": "R", "thumbnail_url": "https://i.test/c.png"},
        "chapters": [{"name": "c", "activities": [page("p", markdown="![a](https://i.test/a.png)", blocks=[{"type": "image", "url": "https://i.test/b.png", "alt": "b"}]),
                                                  {"name": "v", "kind": "video", "url": "https://i.test/v.mp4"}]}],
        "settings": {"publish": True},
    })
    s = cb._summarize_build(p)
    assert "fetch about 3 outside file(s)" in s and "cover image" in s and "publish it" in s
    assert cb._summarize_build(cb.BuildCourseParams(course_uuid="course_x")).startswith("Update course course_x")


async def test_update_mode_errors(db, org, admin_user, course, chapter, activity):
    base = {"course_uuid": course.course_uuid}
    # Existing page matched by name but asked to be an assignment, and the reverse.
    out = await build(db, org, admin_user, {**base, "chapters": [{"name": chapter.name, "activities": [{"name": activity.name, "kind": "assignment"}]}]})
    assert "is not an assignment" in out.reason
    activity.activity_type = ActivityTypeEnum.TYPE_VIDEO
    db.add(activity)
    await db.commit()
    out = await build(db, org, admin_user, {**base, "chapters": [{"name": chapter.name, "activities": [page(activity.name, markdown="x")]}]})
    assert "is not a page" in out.reason
    # Media activities that exist are not fetched again.
    plan = (await build(db, org, admin_user, {**base, "dry_run": True, "chapters": [{"name": chapter.name, "description": "new", "activities": [
        {"name": activity.name, "kind": "video", "url": "https://v.test/a.mp4"}]}]})).result
    steps = {s["name"]: s for s in plan["steps"]}
    assert steps[activity.name]["action"] == "unchanged" and steps[chapter.name]["changes"] == ["description"]


async def test_update_mode_media_pages_refetch(db, org, admin_user, course, chapter, activity):
    plan = (await build(db, org, admin_user, {"course_uuid": course.course_uuid, "dry_run": True, "chapters": [
        {"name": chapter.name, "activities": [page(activity.name, blocks=[{"type": "image", "url": "https://i.test/a.png", "alt": "a"}])]}]})).result
    step = next(s for s in plan["steps"] if s["name"] == activity.name)
    assert step["action"] == "update" and step["files_to_fetch"] == ["https://i.test/a.png"]


async def test_permissions_scope_tokens_and_plan(db, org, admin_user, regular_user):
    spec = {"course": {"name": "x"}}
    assert (await build(db, org, regular_user, spec)).denied_code in ("http_403", "rbac_denied")
    ro = ctx_for(db, org, admin_user)
    ro.read_only = True
    assert (await run_tool(get_mcp_registry(), "build_course", spec, ro)).denied_code == "insufficient_scope"
    token = APITokenUser(id=9, org_id=org.id, rights={"courses": {"action_create": False}}, created_by_user_id=admin_user.id)
    assert (await build(db, org, token, spec)).denied_code == "missing_right"
    with patch("src.services.courses.courses.check_limits_with_usage", new=AsyncMock(side_effect=HTTPException(status_code=403, detail="Usage limit reached for courses"))):
        assert (await build(db, org, admin_user, spec)).denied_code == "plan_limit"
    # Updating someone else's org course: not found, never confirmed.
    assert (await build(db, org, admin_user, {"course_uuid": "course_nowhere"})).denied_code == "http_404"


def test_mcp_only_tools_stay_out_of_the_agent_registry():
    agent = {s.name for s in get_registry().specs()}
    mcp = {s.name for s in get_mcp_registry().specs()}
    new = {"build_course", "add_blocks", "validate_content", "import_content", "import_outline", "score_course", "preview_activity"}
    assert new <= mcp and not new & agent
    assert get_mcp_registry() is get_mcp_registry()


# ─── add_blocks and validate_content ─────────────────────────────────────────


async def add(db, org, user, **args):
    return await run_tool(get_mcp_registry(), "add_blocks", {"activity_uuid": "activity_test", **args}, ctx_for(db, org, user))


async def test_add_blocks_positions_and_errors(db, org, admin_user, activity):
    out = await add(db, org, admin_user, blocks=[{"type": "heading", "text": "Start"}])
    assert out.status == "executed" and out.result["paths"] == [[0]]
    out = await add(db, org, admin_user, blocks=[{"type": "paragraph", "text": "End"}, {"type": "divider"}])
    assert out.result["paths"] == [[1], [2]] and out.result["undo"]["tool"] == "restore_activity_version"
    out = await add(db, org, admin_user, at="after", path=[0], blocks=[{"type": "callout", "text": "Between"}])
    assert out.result["paths"] == [[1]]
    out = await add(db, org, admin_user, at="start", blocks=[{"type": "badge", "text": "New"}])
    await db.refresh(activity)
    assert [n["type"] for n in activity.content["content"]] == ["badge", "heading", "callout", "paragraph", "horizontalRule"]
    assert "at=after needs" in (await add(db, org, admin_user, at="after", blocks=[{"type": "divider"}])).reason
    assert "top-level path" in (await add(db, org, admin_user, at="after", path=[0, 1], blocks=[{"type": "divider"}])).reason
    assert "No block at [99]" in (await add(db, org, admin_user, at="after", path=[99], blocks=[{"type": "divider"}])).reason
    assert "not a member" in (await add(db, org, admin_user, blocks=[{"type": "user", "member": "ghost"}])).reason
    held = await add(db, org, admin_user, blocks=[{"type": "h5p", "url": "https://h5p.org/h5p/embed/1"}])
    assert held.denied_code == "approval_required"
    out = await add(db, org, admin_user, blocks=[{"type": "user", "member": "admin"}], expected_version=1)
    assert out.denied_code == "http_409"


async def test_add_blocks_replaces_an_empty_page_and_stores_files(db, org, admin_user, activity, net):  # noqa: F811 (fixture)
    activity.content = {"type": "doc", "content": [{"type": "paragraph"}]}
    db.add(activity)
    await db.commit()
    net.routes[("img.test", "/a.png")] = httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    out = await run_tool(get_mcp_registry(), "add_blocks", {"activity_uuid": "activity_test", "at": "end", "blocks": [
        {"type": "image", "url": "https://img.test/a.png", "alt": "Leaf"}]}, ctx_for(db, org, admin_user, approved=True))
    assert out.status == "executed" and out.result["media"]["added"], out.result
    await db.refresh(activity)
    assert activity.content["content"][0]["type"] == "blockImage"


async def validate(db, org, user, **args):
    return (await run_tool(get_mcp_registry(), "validate_content", args, ctx_for(db, org, user))).result


async def test_validate_content(db, org, admin_user):
    good = await validate(db, org, admin_user, blocks=[{"type": "quiz", "questions": [{"text": "q", "options": [{"text": "a", "correct": True}, {"text": "b"}]}]}], include_doc=True)
    assert good["valid"] and good["blocks"] == {"blockQuiz": 1} and good["doc"]["type"] == "doc" and "```quiz" in good["markdown"]
    risky = await validate(db, org, admin_user, markdown="![a](https://i.test/a.png)\n\n```h5p\nhttps://h5p.org/h5p/embed/1\n```", include_doc=False)
    assert risky["valid"] and len(risky["needs_approval"]) == 2
    noted = await validate(db, org, admin_user, markdown="- ![a](https://i.test/a.png)")
    assert noted["notes"]
    bad_md = await validate(db, org, admin_user, markdown="```quiz\nnope\n```")
    assert not bad_md["valid"] and bad_md["hint"]
    raw = await validate(db, org, admin_user, doc={"type": "doc", "content": [{"type": "button", "attrs": {"link": "javascript:alert(1)"}, "content": [{"type": "text", "text": "x"}]}]})
    assert not raw["valid"] and "http(s)" in raw["problems"][0]
    ok_doc = await validate(db, org, admin_user, doc={"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "ok"}]}]})
    assert ok_doc["valid"]
    both = await run_tool(get_mcp_registry(), "validate_content", {"markdown": "a", "doc": {}}, ctx_for(db, org, admin_user))
    assert both.denied_code == "invalid_args"


def test_record_keys_differ_by_caller_and_key():
    from types import SimpleNamespace

    from src.db.users import PublicUser

    org = SimpleNamespace(id=1)
    a = SimpleNamespace(org=org, user=PublicUser(id=1, username="a", first_name="", last_name="", email="a@a.test", user_uuid="user_a"))
    b = SimpleNamespace(org=org, user=APITokenUser(id=4, org_id=1, rights={}, user_uuid="tok"))
    assert cb._record_key(a, "k1") != cb._record_key(b, "k1") != cb._record_key(a, "k2")


@pytest.mark.parametrize(
    "current, spec, merged",
    [
        ([1, 2, 3], [], [1, 2, 3]),
        ([1, 2, 3], [9], [1, 2, 3, 9]),  # a new item alone goes last
        ([1, 2, 3], [2, 9], [1, 2, 9, 3]),  # right after the item before it in the spec
        ([1, 2, 3], [9, 2], [1, 9, 2, 3]),  # or right before the one after it
        ([1, 2, 3], [3, 1], [3, 2, 1]),  # listed items swap slots, the rest stay
        ([1, 2, 3, 4], [4, 8, 2], [1, 4, 8, 3, 2]),
        ([], [5, 6], [5, 6]),
    ],
)
def test_merge_order_keeps_untouched_items_in_place(current, spec, merged):
    assert cb.merge_order(current, spec) == merged


async def test_a_partial_update_does_not_move_other_chapters(db, org, admin_user):
    built = (await build(db, org, admin_user, {"course": {"name": "Order"}, "chapters": [{"key": "a", "name": "A"}, {"key": "b", "name": "B"}]})).result
    course_uuid = built["ids"]["course_uuid"]
    await build(db, org, admin_user, {"course_uuid": course_uuid, "chapters": [{"key": "new", "name": "New"}]})
    await build(db, org, admin_user, {"course_uuid": course_uuid, "chapters": [{"key": "a", "name": "A"}, {"key": "a2", "name": "After A"}]})
    outline = await run_tool(get_registry(), "get_course", {"course_uuid": course_uuid}, ctx_for(db, org, admin_user))
    assert [c["name"] for c in outline.result["chapters"]] == ["A", "After A", "B", "New"]
