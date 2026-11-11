"""Page content tools through the full pipeline (run_tool): reading,
writing from Markdown, batched edits, versions, the block palette and media
from a URL. Also the document checks they rely on (doc_ops)."""

import copy
import json
from datetime import datetime
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from sqlmodel import select

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.activity_versions import ActivityVersion
from src.db.courses.courses import Course
from src.services.ai.tools import (
    ToolContext,
    ToolRegistry,
    content_assets,
    content_blocks,
    content_edit,
    make_synthetic_request,
    run_tool,
)
from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import markdown as md

LONG = "word " * 300 + "needle"


def _p(*runs):
    content = []
    for run in runs:
        if isinstance(run, str):
            content.append({"type": "text", "text": run})
        else:
            content.append(run)
    return {"type": "paragraph", "content": content}


def _li(text, *more):
    return {"type": "listItem", "content": [_p(text), *more]}


def rich_doc():
    return {"type": "doc", "content": [
        {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Intro"}]},
        _p("Hello ", {"type": "text", "text": "world", "marks": [{"type": "bold"}]}, " and more"),
        {"type": "callout", "attrs": {"type": "tip", "dismissible": False}, "content": [_p("Remember this")]},
        {"type": "bulletList", "content": [
            _li("one", {"type": "bulletList", "content": [_li("nested")]}),
            _li("two"),
        ]},
        {"type": "table", "content": [
            {"type": "tableRow", "content": [
                {"type": "tableHeader", "content": [_p("a")]},
                {"type": "tableHeader", "content": [_p("b")]},
            ]},
            {"type": "tableRow", "content": [
                {"type": "tableCell", "content": [_p("1")]},
                {"type": "tableCell", "content": [_p("2")]},
            ]},
        ]},
        d.quiz_node([{"text": "Is S3 object storage?", "options": [
            {"text": "Yes", "correct": True}, {"text": "No", "correct": False}]}]),
        _p(LONG),
        # A block Markdown cannot express (the ```exercise fence has no timer):
        # it renders as a block comment.
        {"type": "blockCode", "attrs": {
            "languageId": 71, "languageName": "Python 3", "starterCode": "print(1)\n",
            "description": "Print one.", "difficulty": "easy", "testCases": [], "sqliteDbPath": "db/shop.db",
        }},
    ]}


@pytest.fixture(autouse=True)
def _no_webhooks():
    with patch("src.services.courses.activities.versioning.dispatch_webhooks", new_callable=AsyncMock):
        yield


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(content_edit.SPECS + content_blocks.SPECS + content_assets.SPECS)
    return r


def ctx_for(db, org, user, **kw):
    return ToolContext(
        request=make_synthetic_request(),
        db_session=db,
        user=user,
        org=org,
        org_slug=org.slug,
        mode=kw.pop("mode", "execute"),
        scope_key="test",
        surface="mcp",
        **kw,
    )


async def call(registry, ctx, name, **args):
    return await run_tool(registry, name, args, ctx)


async def ok(registry, ctx, name, **args):
    out = await call(registry, ctx, name, **args)
    assert out.status == "executed", (out.denied_code, out.reason)
    return out.result


async def denied(registry, ctx, name, **args):
    out = await call(registry, ctx, name, **args)
    assert out.status == "denied", out.result
    return out


@pytest.fixture
async def page(db, activity):
    activity.content = rich_doc()
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    return activity


@pytest.fixture
async def other_page(db, other_org):
    course = Course(
        id=50, name="Elsewhere", description="", public=True, published=True,
        open_to_contributors=False, org_id=other_org.id, course_uuid="course_other",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(course)
    await db.commit()
    a = Activity(
        id=50, name="Other page", activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE, content=rich_doc(),
        published=True, org_id=other_org.id, course_id=course.id, activity_uuid="activity_other",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    return a


async def stored(db, uuid="activity_test"):
    row = (await db.execute(select(Activity).where(Activity.activity_uuid == uuid))).scalars().first()
    await db.refresh(row)
    return row


# ─── doc_ops ─────────────────────────────────────────────────────────────────


def test_callouts_with_paragraphs_are_valid():
    doc = rich_doc()
    assert d.strict_problems(doc) == []
    assert d.loadable_problems(doc) == []


def test_loadable_rejects_what_the_editor_drops():
    assert d.loadable_problems({"foo": 1})
    assert "Unknown block type 'script'" in d.loadable_problems({"type": "doc", "content": [{"type": "script"}]})[0]
    assert d.loadable_problems({"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": ""}]}]})
    assert d.loadable_problems({"type": "doc", "content": [_p({"type": "text", "text": "x", "marks": [{"type": "blink"}]})]})


def test_strict_checks():
    def problems(node):
        return " ".join(d.strict_problems(node))

    assert "level" in problems({"type": "heading", "attrs": {"level": 9}})
    assert "http(s)" in problems(_p({"type": "text", "text": "x", "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}]}))
    assert "no attribute 'colour'" in problems({"type": "callout", "attrs": {"colour": "red"}, "content": [_p("x")]})
    assert "cannot hold a heading" in problems({"type": "callout", "content": [{"type": "heading", "attrs": {"level": 1}}]})
    assert "needs at least one" in problems({"type": "bulletList", "content": []})
    assert "add_media_block" in problems({"type": "blockImage", "attrs": {}})
    assert "correct answer" in problems({"type": "blockQuiz", "attrs": {"questions": [
        {"question_id": "q", "question": "?", "answers": [
            {"answer_id": "a", "answer": "x", "correct": False}, {"answer_id": "b", "answer": "y", "correct": False}]}]}})
    assert "Code text" in problems(_p({"type": "text", "text": "x", "marks": [{"type": "code"}, {"type": "bold"}]}))


def test_deep_documents_do_not_crash():
    node = _p("leaf")
    for _ in range(5000):
        node = {"type": "blockquote", "content": [node]}
    doc = {"type": "doc", "content": [node]}
    assert d.loadable_problems(doc)  # too deep, reported, no RecursionError
    assert d.strict_problems(node)
    list(d.outline_entries(doc))
    md.doc_to_markdown(doc)
    d.block_text(node)


def test_outline_keeps_cells_and_items_apart():
    entries = {tuple(e["path"]): e for e, _s in d.outline_entries(rich_doc())}
    assert entries[(4,)]["rows"] == [["a", "b"], ["1", "2"]]
    assert entries[(3, 0)]["text"] == "one"
    assert entries[(3, 0, 1, 0)]["text"] == "nested"
    assert entries[(3, 1)]["text"] == "two"
    assert entries[(5,)]["questions"][0]["options"] == [{"text": "Yes", "correct": True}, {"text": "No", "correct": False}]
    assert d.block_text(rich_doc()["content"][4]) == "a | b\n1 | 2"


def test_replace_across_runs_keeps_marks():
    para = _p("Hello ", {"type": "text", "text": "big world", "marks": [{"type": "bold"}]}, "!")
    assert d.replace_in(para, "lo big", "lo small", None) == 1
    assert para["content"] == [
        {"type": "text", "text": "Hello small"},
        {"type": "text", "text": " world", "marks": [{"type": "bold"}]},
        {"type": "text", "text": "!"},
    ]
    inside = _p("a ", {"type": "text", "text": "bold", "marks": [{"type": "bold"}]})
    d.replace_in(inside, "bold", "strong", None)
    assert inside["content"][1] == {"type": "text", "text": "strong", "marks": [{"type": "bold"}]}


# ─── get_activity_content ────────────────────────────────────────────────────


async def test_outline_read(registry, db, org, admin_user, page):
    out = await ok(registry, ctx_for(db, org, admin_user), "get_activity_content", activity_uuid="activity_test")
    assert out["activity"]["uuid"] == "activity_test" and out["activity"]["kind"] == "activity"
    assert out["version"] == 1 and out["format"] == "outline"
    assert "note" in out  # page text is data, not instructions
    by_path = {tuple(b["path"]): b for b in out["blocks"]}
    assert by_path[(2,)]["callout_type"] == "tip" and by_path[(2,)]["text"] == "Remember this"
    assert by_path[(6,)]["truncated"] is True and len(by_path[(6,)]["text"]) <= 1000
    assert "activity_id" not in json.dumps(out)
    assert "explanation" not in by_path[(5,)]["questions"][0]


def test_outline_shows_quiz_explanations():
    quiz = d.quiz_node([{"text": "Q?", "explanation": "Because.", "options": [
        {"text": "a", "correct": True}, {"text": "b", "correct": False}]}])
    entry, _search = d.entry(quiz, [0], 1000)
    assert entry["questions"][0]["explanation"] == "Because."


async def test_query_searches_full_text(registry, db, org, admin_user, page):
    ctx = ctx_for(db, org, admin_user)
    out = await ok(registry, ctx, "get_activity_content", activity_uuid="activity_test", query="NEEDLE")
    assert [b["path"] for b in out["blocks"]] == [[6]] and out["matches"] == 1
    nested = await ok(registry, ctx, "get_activity_content", activity_uuid="activity_test", query="nested")
    assert [b["path"] for b in nested["blocks"]] == [[3, 0, 1, 0]]
    quiz = await ok(registry, ctx, "get_activity_content", activity_uuid="activity_test", query="object storage")
    assert [b["path"] for b in quiz["blocks"]] == [[5]]


async def test_markdown_and_json_reads(registry, db, org, admin_user, page):
    ctx = ctx_for(db, org, admin_user)
    out = await ok(registry, ctx, "get_activity_content", activity_uuid="activity_test", format="markdown")
    assert out["markdown"].startswith("## Intro\n\nHello **world** and more")
    assert "> [!TIP]" in out["markdown"] and "<!-- block [7] blockCode" in out["markdown"]
    assert "```quiz\nQ: Is S3 object storage?\n- [x] Yes\n- [ ] No\n```" in out["markdown"]
    part = await ok(registry, ctx, "get_activity_content", activity_uuid="activity_test", format="json", paths=[[2], [9]])
    assert part["nodes"][0]["node"]["type"] == "callout" and part["missing_paths"] == [[9]]
    whole = await ok(registry, ctx, "get_activity_content", activity_uuid="activity_test", format="json")
    assert whole["doc"]["type"] == "doc"
    cells = await ok(registry, ctx, "get_activity_content", activity_uuid="activity_test", paths=[[4, 1, 1], [2, 0]])
    assert [(b["path"], b.get("text")) for b in cells["blocks"]] == [([2, 0], "Remember this"), ([4, 1, 1], "2")]


async def test_big_page_json_needs_paths(registry, db, org, admin_user, activity):
    activity.content = {"type": "doc", "content": [_p("x" * 5000) for _ in range(20)]}
    db.add(activity)
    await db.commit()
    ctx = ctx_for(db, org, admin_user)
    out = await denied(registry, ctx, "get_activity_content", activity_uuid="activity_test", format="json")
    assert out.denied_code == "http_400" and "paths" in out.reason
    outline = await ok(registry, ctx, "get_activity_content", activity_uuid="activity_test")
    assert len(json.dumps(outline)) < 30_000


async def test_read_refuses_other_org_and_wrong_prefix(registry, db, org, admin_user, page, other_page):
    ctx = ctx_for(db, org, admin_user)
    out = await denied(registry, ctx, "get_activity_content", activity_uuid="activity_other")
    assert out.denied_code == "http_404"
    out = await denied(registry, ctx, "get_activity_content", activity_uuid="course_test")
    assert out.denied_code == "http_400" and "activity_" in out.reason


async def test_learner_can_read_published_page(registry, db, org, regular_user, page):
    out = await ok(registry, ctx_for(db, org, regular_user), "get_activity_content", activity_uuid="activity_test")
    assert out["blocks"]


# ─── write_activity_content ──────────────────────────────────────────────────


async def test_write_replace_append_prepend(registry, db, org, admin_user, activity):
    ctx = ctx_for(db, org, admin_user)
    out = await ok(registry, ctx, "write_activity_content", activity_uuid="activity_test", markdown="# Hi\n\nBody")
    assert out["ok"] and out["version_before"] == 1 and out["version_after"] == 2
    assert out["undo"] == {"tool": "restore_activity_version", "args": {"activity_uuid": "activity_test", "version": 1}}
    await ok(registry, ctx, "write_activity_content", activity_uuid="activity_test", markdown="End", mode="append")
    await ok(registry, ctx, "write_activity_content", activity_uuid="activity_test", markdown="Start", mode="prepend")
    row = await stored(db)
    texts = [d.block_text(n) for n in row.content["content"]]
    assert texts == ["Start", "Hi", "Body", "End"]
    assert row.current_version == 4


async def test_write_version_conflict(registry, db, org, admin_user, activity):
    ctx = ctx_for(db, org, admin_user)
    out = await denied(registry, ctx, "write_activity_content", activity_uuid="activity_test", markdown="x", expected_version=7)
    assert out.denied_code == "http_409" and "version 1" in out.reason


async def test_write_keeps_commented_blocks(registry, db, org, admin_user, page):
    ctx = ctx_for(db, org, admin_user)
    quiz = copy.deepcopy(page.content["content"][5])
    code = copy.deepcopy(page.content["content"][7])
    read = await ok(registry, ctx, "get_activity_content", activity_uuid="activity_test", format="markdown")
    edited = read["markdown"].replace("Hello **world**", "Hi **there**")
    out = await ok(registry, ctx, "write_activity_content", activity_uuid="activity_test", markdown=edited, expected_version=1)
    assert out["kept_blocks"] == 1 and "removed_rich_blocks" not in out
    row = await stored(db)
    assert row.content["content"][7] == code  # the commented block, untouched
    # The quiz came back through its fence: same questions, new ids.
    written = row.content["content"][5]["attrs"]["questions"][0]
    assert written["question"] == quiz["attrs"]["questions"][0]["question"]
    assert [(a["answer"], a["correct"]) for a in written["answers"]] == [("Yes", True), ("No", False)]
    assert d.block_text(row.content["content"][1]) == "Hi there and more"


async def test_write_reports_removed_rich_blocks(registry, db, org, admin_user, page):
    out = await ok(registry, ctx_for(db, org, admin_user), "write_activity_content", activity_uuid="activity_test", markdown="Just text")
    assert out["removed_rich_blocks"] == [{"path": [7], "type": "blockCode"}]
    assert out["undo"]["args"]["version"] == 1


async def test_write_rejects_stale_comments(registry, db, org, admin_user, page):
    out = await denied(
        registry, ctx_for(db, org, admin_user), "write_activity_content",
        activity_uuid="activity_test", markdown="<!-- block [0] blockQuiz -->",
    )
    assert out.denied_code == "http_400" and "not a blockQuiz" in out.reason


async def test_write_authorizes_before_converting(registry, db, org, regular_user, activity):
    with patch.object(md, "convert", side_effect=AssertionError("converted before authorization")):
        out = await denied(registry, ctx_for(db, org, regular_user), "write_activity_content", activity_uuid="activity_test", markdown="x")
    assert out.denied_code == "http_403"


async def test_write_refuses_other_org_and_oversize(registry, db, org, admin_user, other_page):
    ctx = ctx_for(db, org, admin_user)
    out = await denied(registry, ctx, "write_activity_content", activity_uuid="activity_other", markdown="x")
    assert out.denied_code == "http_404"
    out = await denied(registry, ctx, "write_activity_content", activity_uuid="activity_test", markdown="x" * (md.MAX_CHARS + 1))
    assert out.denied_code == "invalid_args"


async def test_write_refuses_read_only_and_non_pages(registry, db, org, admin_user, activity):
    out = await denied(registry, ctx_for(db, org, admin_user, read_only=True), "write_activity_content", activity_uuid="activity_test", markdown="x")
    assert out.denied_code == "insufficient_scope"
    activity.activity_type = ActivityTypeEnum.TYPE_VIDEO
    db.add(activity)
    await db.commit()
    out = await denied(registry, ctx_for(db, org, admin_user), "write_activity_content", activity_uuid="activity_test", markdown="x")
    assert "video activity" in out.reason


async def test_confirm_mode_proposes(registry, db, org, admin_user, activity):
    out = await call(registry, ctx_for(db, org, admin_user, mode="confirm"), "write_activity_content", activity_uuid="activity_test", markdown="x")
    assert out.status == "proposed" and "Replace page content" in out.proposal.summary


# ─── edit_activity_content ───────────────────────────────────────────────────


async def edit(registry, ctx, *ops, **kw):
    return await call(registry, ctx, "edit_activity_content", activity_uuid="activity_test", ops=list(ops), **kw)


async def test_insert_on_empty_page(registry, db, org, admin_user, activity):
    ctx = ctx_for(db, org, admin_user)
    out = await edit(registry, ctx, {"op": "insert", "at": "end", "block": {"markdown": "# Title\n\nText"}},
                     {"op": "insert", "at": "end", "block": {"quiz": {"questions": [
                         {"text": "2+2?", "options": [{"text": "4", "correct": True}, {"text": "5", "correct": False}]}]}}},
                     {"op": "insert", "at": "start", "block": {"callout": {"type": "warning", "markdown": "Read first"}}})
    assert out.status == "executed", out.reason
    assert out.result["ops"][0]["paths"] == [[1], [2]]
    assert out.result["ops"][2]["paths"] == [[0]]
    content = (await stored(db)).content["content"]
    assert [n["type"] for n in content] == ["callout", "heading", "paragraph", "blockQuiz"]
    question = content[3]["attrs"]["questions"][0]
    assert question["question_id"].startswith("question_") and question["answers"][0]["answer_id"].startswith("answer_")
    assert content[3]["attrs"]["quizId"].startswith("quiz_")


async def test_edits_on_a_page_with_callouts(registry, db, org, admin_user, page):
    """The old validator refused every edit on a page holding a callout."""
    out = await edit(registry, ctx_for(db, org, admin_user),
                     {"op": "replace_text", "find": "Intro", "replace": "Welcome"},
                     {"op": "set_attrs", "path": [2], "attrs": {"type": "warning"}},
                     expected_version=1)
    assert out.status == "executed", out.reason
    assert out.result["version_before"] == 1 and out.result["version_after"] == 2
    assert out.result["ops"][1]["before"] == {"type": "tip"}
    content = (await stored(db)).content["content"]
    assert content[0]["content"][0]["text"] == "Welcome" and content[2]["attrs"]["type"] == "warning"


async def test_replace_text_rules(registry, db, org, admin_user, page):
    ctx = ctx_for(db, org, admin_user)
    out = await edit(registry, ctx, {"op": "replace_text", "find": "o", "replace": "0"})
    assert out.status == "denied" and "occurs" in out.reason and "nothing was saved" in out.reason
    out = await edit(registry, ctx, {"op": "replace_text", "find": "hello", "replace": "x"})
    assert "different capitalization" in out.reason
    out = await edit(registry, ctx, {"op": "replace_text", "find": "lo wor", "replace": "lo, wor"})
    assert out.status == "executed"
    para = (await stored(db)).content["content"][1]
    assert d.inline_text(para) == "Hello, world and more"
    assert para["content"][1]["marks"] == [{"type": "bold"}]
    out = await edit(registry, ctx, {"op": "replace_text", "find": "Yes", "replace": "Sure", "path": [5]})
    assert out.status == "executed"
    assert (await stored(db)).content["content"][5]["attrs"]["questions"][0]["answers"][0]["answer"] == "Sure"
    out = await edit(registry, ctx, {"op": "replace_text", "find": "e", "replace": "E", "all": True, "path": [3]})
    assert out.result["ops"][0]["replaced"] == 3  # "one", "nested"


async def test_paths_refer_to_the_page_as_read(registry, db, org, admin_user, page):
    out = await edit(registry, ctx_for(db, org, admin_user),
                     {"op": "delete", "path": [0]},
                     {"op": "set_text", "path": [1], "text": "**New** text\nsecond line"},
                     {"op": "set_text", "path": [3, 1], "text": "item two"},
                     {"op": "move", "from_path": [4], "to": "before", "path": [1]})
    assert out.status == "executed", out.reason
    content = (await stored(db)).content["content"]
    assert [n["type"] for n in content[:4]] == ["table", "paragraph", "callout", "bulletList"]
    assert content[1]["content"][0] == {"type": "text", "text": "New", "marks": [{"type": "bold"}]}
    assert {"type": "hardBreak"} in content[1]["content"]
    assert d.block_text(content[3]["content"][1]) == "item two"
    assert out.result["ops"][3]["paths"] == [[0]]


async def test_edit_is_atomic(registry, db, org, admin_user, page):
    before = copy.deepcopy(page.content)
    out = await edit(registry, ctx_for(db, org, admin_user),
                     {"op": "set_text", "path": [0], "text": "Changed"},
                     {"op": "delete", "path": [42]})
    assert out.status == "denied" and out.reason.startswith("Op 1 (delete) failed, nothing was saved")
    row = await stored(db)
    assert row.current_version == 1 and row.content == before


async def test_edit_rejects_invalid_content(registry, db, org, admin_user, page):
    ctx = ctx_for(db, org, admin_user)
    cases = [
        ({"op": "insert", "at": "end", "block": {"node": {"type": "script"}}}, "Unknown block type"),
        ({"op": "insert", "at": "inside_end", "path": [2], "block": {"markdown": "# Heading"}}, "cannot hold a heading"),
        ({"op": "set_attrs", "path": [0], "attrs": {"level": 12}}, "level"),
        ({"op": "set_attrs", "path": [2], "attrs": {"onclick": "x"}}, "no attribute"),
        ({"op": "insert", "at": "after", "block": {"markdown": "x"}}, "needs a path"),
        ({"op": "delete", "path": [3, 0, 1, 0]}, "empty"),
        ({"op": "set_text", "path": [5], "text": "x"}, "set_attrs"),
        ({"op": "insert", "at": "end", "block": {"node": {"type": "blockVideo", "attrs": {"blockObject": {}}}}}, "add_media_block"),
        ({"op": "move", "from_path": [3], "to": "after", "path": [3, 0]}, "into itself"),
    ]
    for op, expected in cases:
        out = await edit(registry, ctx, op)
        assert out.status == "denied" and expected in out.reason, (op, out.reason)
    assert (await stored(db)).current_version == 1


async def test_edit_raw_nodes_and_replace_block(registry, db, org, admin_user, page):
    flip = {"type": "flipcard", "attrs": {"question": "Q", "answer": "A"}}
    out = await edit(registry, ctx_for(db, org, admin_user),
                     {"op": "replace_block", "path": [6], "block": {"node": flip}},
                     {"op": "insert", "at": "after", "path": [1], "block": {"node": {"type": "blockQuiz", "attrs": {"questions": [
                         {"text": "Simple shape?", "options": [{"text": "yes", "correct": True}, {"text": "no", "correct": False}]}]}}}})
    assert out.status == "executed", out.reason
    content = (await stored(db)).content["content"]
    assert content[2]["type"] == "blockQuiz" and content[2]["attrs"]["questions"][0]["question"] == "Simple shape?"
    assert content[7] == flip and content[-1]["type"] == "blockCode"


async def test_edit_denials(registry, db, org, admin_user, regular_user, page, other_page):
    out = await edit(registry, ctx_for(db, org, regular_user), {"op": "delete", "path": [0]})
    assert out.denied_code == "http_403"
    out = await call(registry, ctx_for(db, org, admin_user), "edit_activity_content",
                     activity_uuid="activity_other", ops=[{"op": "delete", "path": [0]}])
    assert out.denied_code == "http_404"
    out = await edit(registry, ctx_for(db, org, admin_user), *[{"op": "delete", "path": [0]}] * 101)
    assert out.denied_code == "invalid_args"
    out = await edit(registry, ctx_for(db, org, admin_user), {"op": "explode", "path": [0]})
    assert out.denied_code == "invalid_args"


async def test_undo_with_restore(registry, db, org, admin_user, page):
    ctx = ctx_for(db, org, admin_user)
    before = copy.deepcopy(page.content)
    out = await edit(registry, ctx, {"op": "delete", "path": [5]})
    undo = out.result["undo"]
    restored = await ok(registry, ctx, undo["tool"], **undo["args"])
    assert restored["version_before"] == 2 and restored["version_after"] == 3
    assert (await stored(db)).content == before


# ─── versions ────────────────────────────────────────────────────────────────


async def test_list_and_restore_versions(registry, db, org, admin_user, regular_user, activity):
    ctx = ctx_for(db, org, admin_user)
    for text in ("first", "second", "third"):
        await ok(registry, ctx, "write_activity_content", activity_uuid="activity_test", markdown=text)
    first = await ok(registry, ctx, "list_activity_versions", activity_uuid="activity_test", limit=2)
    assert [v["version"] for v in first["items"]] == [3, 2] and first["has_more"]
    assert first["items"][0]["starts_with"] == "second" and first["current_version"] == 4
    rest = await ok(registry, ctx, "list_activity_versions", activity_uuid="activity_test", limit=2, cursor=first["next_cursor"])
    assert [v["version"] for v in rest["items"]] == [1] and not rest["has_more"]
    out = await ok(registry, ctx, "restore_activity_version", activity_uuid="activity_test", version=2)
    assert d.block_text((await stored(db)).content["content"][0]) == "first"
    assert out["version_after"] == 5
    missing = await denied(registry, ctx, "restore_activity_version", activity_uuid="activity_test", version=99)
    assert "list_activity_versions" in missing.reason
    learner = await denied(registry, ctx_for(db, org, regular_user), "list_activity_versions", activity_uuid="activity_test")
    assert learner.denied_code == "http_403"
    assert (await db.execute(select(ActivityVersion))).scalars().all()


# ─── describe_activity_blocks ────────────────────────────────────────────────


async def test_block_catalog(registry, db, org, regular_user):
    ctx = ctx_for(db, org, regular_user)
    catalog = await ok(registry, ctx, "describe_activity_blocks")
    assert len(json.dumps(catalog)) < 5000
    assert {"callout", "blockQuiz", "media"} <= {b["type"] for b in catalog["blocks"]}
    quiz = await ok(registry, ctx, "describe_activity_blocks", type="quiz")
    assert quiz["type"] == "blockQuiz" and "example" in quiz
    assert "quiz" in catalog["fences"]
    for spelling, name in (("blockFlipcard", "flipcard"), ("Flip_Cards", "flipcard"), ("youtube", "blockEmbed"),
                           ("blockCode", "blockCode"), ("code", "codeBlock"), ("Scenario", "scenarios")):
        assert (await ok(registry, ctx, "describe_activity_blocks", type=spelling))["type"] == name, spelling
    out = await denied(registry, ctx, "describe_activity_blocks", type="nope")
    assert out.denied_code == "http_400" and "omit type for the catalog" in out.reason


def test_catalog_examples_are_valid():
    for name, entry in content_blocks.CATALOG.items():
        if "example" in entry:
            assert d.strict_problems(entry["example"]) == [], name
            assert entry["example"]["type"] == name


# ─── add_media_block ─────────────────────────────────────────────────────────

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200
PUBLIC_IP = "93.184.216.34"


class FakeNet:
    """A transport serving canned responses, recording what was asked."""

    def __init__(self, routes):
        self.routes = routes
        self.requests = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        host = request.headers["host"]
        response = self.routes.get((host, request.url.path))
        if response is None:
            return httpx.Response(404)
        return response() if callable(response) else response


@pytest.fixture
def net(monkeypatch):
    fake = FakeNet({})
    monkeypatch.setattr(content_assets, "_transport", lambda: httpx.MockTransport(fake.handler))
    monkeypatch.setattr(content_assets, "_check_peer", lambda response, ip: None)

    real = content_assets._resolve

    def resolve(url):
        host = httpx.URL(url).host
        return [PUBLIC_IP] if host.endswith(".test") else real(url)

    monkeypatch.setattr(content_assets, "_resolve", resolve)
    create = AsyncMock(return_value={
        "block_uuid": "block_new", "content": {"file_id": "f1", "file_format": "png", "file_name": "image.png"},
    })
    monkeypatch.setitem(content_assets.KINDS, "image", content_assets.MediaKind("blockImage", 1024, "image/*", create))
    fake.create = create
    return fake


async def add(registry, ctx, **args):
    return await call(registry, ctx, "add_media_block", activity_uuid="activity_test", **args)


async def test_add_media_happy_path(registry, db, org, admin_user, page, net):
    net.routes[("files.test", "/a.png")] = httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    ctx = ctx_for(db, org, admin_user, approved=True)
    out = await add(registry, ctx, kind="image", url="https://files.test/a.png", at="after", path=[0], caption="A picture")
    assert out.status == "executed", out.reason
    assert out.result["block"] == {"type": "blockImage", "path": [1]}
    assert out.result["media"]["uuid"] == "block_new" and out.result["media"]["bytes"] == len(PNG)
    assert "doc" not in json.dumps(out.result)
    request = net.requests[0]
    assert request.url.host == PUBLIC_IP and request.headers["host"] == "files.test"
    assert request.extensions.get("sni_hostname") == "files.test"
    content = (await stored(db)).content["content"]
    assert content[1]["type"] == "blockImage" and content[1]["attrs"]["blockObject"]["block_uuid"] == "block_new"
    assert content[2]["content"][0]["marks"] == [{"type": "italic"}]


async def test_add_media_needs_approval(registry, db, org, admin_user, page, net):
    out = await add(registry, ctx_for(db, org, admin_user), kind="image", url="https://files.test/a.png")
    assert out.denied_code == "approval_required"
    assert not net.requests


async def test_add_media_checks_rights_before_fetching(registry, db, org, regular_user, page, net):
    out = await add(registry, ctx_for(db, org, regular_user, approved=True), kind="image", url="https://files.test/a.png")
    assert out.denied_code == "http_403"
    assert not net.requests


async def test_add_media_url_rules(registry, db, org, admin_user, page, net):
    ctx = ctx_for(db, org, admin_user, approved=True)
    cases = [
        ("http://127.0.0.1/a.png", "private"),
        ("http://localhost/a.png", "private"),
        ("https://files.test:8443/a.png", "ports"),
        ("ftp://files.test/a.png", "http and https"),
        ("https://user:pw@files.test/a.png", "password"),
        ("https://www.youtube.com/watch?v=abc123", "youtube.com/embed/abc123"),
    ]
    for url, expected in cases:
        out = await add(registry, ctx, kind="image", url=url)
        assert out.status == "denied" and expected in out.reason, (url, out.reason)
    assert not net.requests


async def test_add_media_redirects_are_checked(registry, db, org, admin_user, page, net):
    ctx = ctx_for(db, org, admin_user, approved=True)
    net.routes[("files.test", "/r")] = httpx.Response(302, headers={"location": "http://169.254.169.254/latest"})
    out = await add(registry, ctx, kind="image", url="https://files.test/r")
    assert "private" in out.reason
    for k in range(5):
        net.routes[("files.test", f"/loop{k}")] = httpx.Response(302, headers={"location": f"/loop{k + 1}"})
    out = await add(registry, ctx, kind="image", url="https://files.test/loop0")
    assert "redirects" in out.reason


async def test_add_media_body_checks(registry, db, org, admin_user, page, net):
    ctx = ctx_for(db, org, admin_user, approved=True)
    net.routes[("files.test", "/page")] = httpx.Response(200, content=b"<html></html>", headers={"content-type": "text/html"})
    net.routes[("files.test", "/big")] = httpx.Response(200, content=PNG * 10, headers={"content-type": "image/png"})
    net.routes[("files.test", "/pdf")] = httpx.Response(200, content=b"%PDF-1.7" + b"\x00" * 64)
    for path, expected in (("/page", "web page"), ("/big", "limit"), ("/pdf", "looks like a pdf")):
        out = await add(registry, ctx, kind="image", url=f"https://files.test{path}")
        assert out.status == "denied" and expected in out.reason, (path, out.reason)
    net.create.assert_not_called()
    assert (await stored(db)).current_version == 1


def test_sniff():
    assert content_assets.sniff(PNG)[0] == "image"
    assert content_assets.sniff(b"\x00\x00\x00\x18ftypmp42")[1] == "video/mp4"
    assert content_assets.sniff(b"\x00\x00\x00\x18ftypM4A ")[0] == "audio"
    assert content_assets.sniff(b"ID3\x04")[2] == "mp3"
    assert content_assets.sniff(b"plain text") is None


def test_specs_metadata():
    specs = {s.name: s for s in content_edit.SPECS + content_blocks.SPECS + content_assets.SPECS}
    assert set(specs) == {
        "get_activity_content", "write_activity_content", "edit_activity_content",
        "list_activity_versions", "restore_activity_version", "describe_activity_blocks", "add_media_block",
    }
    media = specs["add_media_block"]
    assert media.open_world and media.approval_for(None) and media.target_param == "activity_uuid"
    assert specs["restore_activity_version"].idempotent
    for spec in specs.values():
        assert len(spec.description) <= 450, spec.name
        assert "\u2014" not in spec.description and "\u2013" not in spec.description
        if spec.name != "describe_activity_blocks":
            assert spec.target_kind == "activity"


async def test_write_stores_markdown_images(registry, db, org, admin_user, activity, net):
    net.routes[("files.test", "/a.png")] = httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    markdown = (
        "# Cells\n\n![A plant cell](https://files.test/a.png)\n\nText.\n\n"
        "```image\nhttps://files.test/missing.png\nwidth: 400\n```"
    )
    need = await call(registry, ctx_for(db, org, admin_user), "write_activity_content",
                      activity_uuid="activity_test", markdown=markdown)
    assert need.denied_code == "approval_required" and "Fetches 2 files" in need.reason
    assert not net.requests

    out = await ok(registry, ctx_for(db, org, admin_user, approved=True), "write_activity_content",
                   activity_uuid="activity_test", markdown=markdown)
    assert out["media"]["added"] == [{"kind": "image", "url": "https://files.test/a.png", "path": [1]}]
    assert out["media"]["failed"][0]["url"] == "https://files.test/missing.png"
    content = (await stored(db)).content["content"]
    assert content[1]["type"] == "blockImage" and content[1]["attrs"]["blockObject"]["block_uuid"] == "block_new"
    assert content[2] == {"type": "paragraph", "content": [
        {"type": "text", "text": "A plant cell", "marks": [{"type": "italic"}]}]}
    # the file that failed stays a link
    assert content[-1]["content"][0]["marks"][0]["attrs"]["href"] == "https://files.test/missing.png"
    assert out["version_after"] == (await stored(db)).current_version


async def test_markdown_media_url_rules_fail_before_writing(registry, db, org, admin_user, activity, net):
    ctx = ctx_for(db, org, admin_user, approved=True)
    out = await denied(registry, ctx, "write_activity_content", activity_uuid="activity_test",
                       markdown="![x](https://files.test:8443/a.png)")
    assert "ports" in out.reason
    many = "\n\n".join(f"![x](https://files.test/{k}.png)" for k in range(content_assets.MAX_MEDIA_PER_CALL + 1))
    out = await denied(registry, ctx, "write_activity_content", activity_uuid="activity_test", markdown=many)
    assert "the limit is" in out.reason
    assert not net.requests

