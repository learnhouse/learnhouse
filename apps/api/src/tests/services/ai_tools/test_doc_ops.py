"""Page documents in depth: the schema checks (doc_ops), the batch editor
behind edit_activity_content, the read and write tools' partial views and
limits (content_edit), and the Markdown corners the main suites skip."""

import copy
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.courses import Course
from src.services.ai.tools import ToolRegistry, content_blocks, content_edit
from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import markdown as md
from src.services.ai.tools.markdown import doc_to_markdown, inline, markdown_to_doc
from src.tests.services.ai_tools.test_content import _li, _p, call, ctx_for, denied, ok, rich_doc, stored


@pytest.fixture(autouse=True)
def _no_webhooks():
    with patch("src.services.courses.activities.versioning.dispatch_webhooks", new_callable=AsyncMock):
        yield


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(content_edit.SPECS + content_blocks.SPECS)
    return r


async def _set_content(db, activity, content):
    activity.content = content
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    return activity


@pytest.fixture
async def page(db, activity):
    return await _set_content(db, activity, rich_doc())


async def edit(registry, ctx, *ops, **kw):
    return await call(registry, ctx, "edit_activity_content", activity_uuid="activity_test", ops=list(ops), **kw)


def problems(node, **kw):
    return " ".join(d.strict_problems(node, **kw))


def text(s, *marks):
    node = {"type": "text", "text": s}
    if marks:
        node["marks"] = [{"type": m} for m in marks]
    return node


def link(s, href="https://x.test"):
    return {"type": "text", "text": s, "marks": [{"type": "link", "attrs": {"href": href}}]}


# ─── envelopes and legacy shapes ─────────────────────────────────────────────


def test_ensure_doc_and_legacy_callouts():
    assert d.ensure_doc(None) == {"type": "doc", "content": []}
    assert d.ensure_doc({"type": "doc", "content": "junk"}) == {"type": "doc", "content": []}
    doc = {"type": "doc", "content": [
        "stray",
        {"type": "callout", "content": [text("a"), {"type": "hardBreak"}, "junk", _p("b"), text("c")]},
        {"type": "callout", "content": []},
    ]}
    d.normalize_legacy(doc)
    # Runs of inline nodes are wrapped in paragraphs, as the editor does on load.
    assert doc["content"][1]["content"] == [
        {"type": "paragraph", "content": [text("a"), {"type": "hardBreak"}]},
        _p("b"),
        {"type": "paragraph", "content": [text("c")]},
    ]
    assert doc["content"][2]["content"] == [{"type": "paragraph"}]


# ─── loadable checks ─────────────────────────────────────────────────────────


def test_loadable_problems_name_the_spot():
    def loadable(*blocks):
        return " ".join(d.loadable_problems({"type": "doc", "content": list(blocks)}))

    assert "Block [0] is not an object" in loadable("x")
    assert "marks at [0, 0] must be a list" in loadable(_p({"type": "text", "text": "x", "marks": "bold"}))
    assert "attrs at [0] must be an object" in loadable({"type": "heading", "attrs": [1]})
    assert "content at [0] must be a list" in loadable({"type": "paragraph", "content": "x"})
    assert loadable(_p("fine")) == ""


def test_check_loadable_rejects_broken_and_oversized_pages():
    with pytest.raises(d.DocError, match="Unknown block type 'script'"):
        d.check_loadable({"type": "doc", "content": [{"type": "script"}]})
    with pytest.raises(d.DocError, match=f"the limit is {d.MAX_DOC_CHARS}"):
        d.check_loadable({"type": "doc", "content": [_p("x" * d.MAX_DOC_CHARS)]})


# ─── strict checks ───────────────────────────────────────────────────────────


def test_strict_problems_structure():
    assert "Block the page is not an object" in problems("x")
    assert "Unexpected keys ['id']" in problems({"type": "paragraph", "id": 3})
    assert "Empty or missing text at [0]" in problems(_p({"type": "text", "text": ""}))
    assert "Only text carries marks" in problems({"type": "paragraph", "marks": [{"type": "bold"}]})
    assert "cannot be formatted" in problems({"type": "codeBlock", "content": [text("x", "bold")]})
    assert "holds no content; its data lives in attrs" in problems({"type": "horizontalRule", "content": [_p("x")]})
    # The content model names what fits: text in a paragraph, blocks in a quote.
    assert "cannot hold a paragraph (child 0); it holds text" in problems({"type": "paragraph", "content": [_p("x")]})
    assert "needs at least one of blocks" in problems({"type": "blockquote", "content": []})
    assert d.content_problem({"type": "script"}) == "Unknown block type 'script' at the page."
    assert "attrs on the heading at the page must be an object" in problems({"type": "heading", "attrs": [2]})


def test_strict_problems_marks():
    def marked(*marks):
        return problems(_p({"type": "text", "text": "x", "marks": list(marks)}))

    assert "must be a list" in problems(_p({"type": "text", "text": "x", "marks": {"type": "bold"}}))
    assert "Mark bold repeated" in marked({"type": "bold"}, {"type": "bold"})
    assert "Mark attrs at [0] must be an object" in marked({"type": "link", "attrs": "x"})
    assert "Mark bold has no attribute 'color'" in marked({"type": "bold", "attrs": {"color": "red"}})
    assert "Mark link has no attribute 'onclick'" in marked({"type": "link", "attrs": {"href": "https://x.test", "onclick": "x"}})
    # The editor's streaming mark loads fine but is not something a tool writes.
    streaming = _p({"type": "text", "text": "x", "marks": [{"type": "aiStreaming"}]})
    assert "Unknown mark 'aiStreaming'" in problems(streaming)
    assert d.strict_problems(streaming, authoring=False) == []
    assert d.strict_problems({"type": "youtube", "attrs": {"src": "https://y.test"}}, authoring=False) == []


QUESTION = {"question_id": "q", "question": "Q?", "answers": [
    {"answer_id": "a", "answer": "yes", "correct": True},
    {"answer_id": "b", "answer": "no", "correct": False},
]}


def question(**changes):
    q = copy.deepcopy(QUESTION)
    q.update(changes)
    return q


def answers(*extra):
    return [QUESTION["answers"][0], *extra]


def step(id="s1", text="Start", options=()):
    return {"id": id, "text": text, "options": list(options)}


ATTR_CASES = [
    ({"type": "heading", "attrs": {"level": True}}, "heading.level must be a whole number from 1 to 6"),
    ({"type": "callout", "attrs": {"dismissible": "no"}, "content": [_p("x")]}, "must be true or false"),
    ({"type": "orderedList", "attrs": {"type": "x"}, "content": [_li("a")]}, "orderedList.type must be one of"),
    ({"type": "codeBlock", "attrs": {"language": "py thon"}}, "short language name"),
    ({"type": "flipcard", "attrs": {"question": None, "answer": "A"}}, "flipcard.question must be text"),
    ({"type": "badge", "attrs": {"color": 5}}, "badge.color must be text"),
    ({"type": "badge", "attrs": {"emoji": "x" * 17}}, "badge.emoji must be at most 16 characters"),
    ({"type": "button", "attrs": {"link": "javascript:alert(1)"}}, "button.link must be an http(s) URL"),
    ({"type": "blockEmbed", "attrs": {"embedUrl": "data:text/html,x"}}, "embedUrl must be an http(s) URL"),
    ({"type": "blockEmbed", "attrs": {"embedType": "url"}}, "needs embedUrl or embedCode"),
    ({"type": "blockCode", "attrs": {"starterCode": "x" * 600_001}}, "are too large"),
    ({"type": "blockQuiz", "attrs": {"questions": "x"}}, "must be a list of 1 to 50 questions"),
    ({"type": "blockQuiz", "attrs": {"questions": ["x"]}}, "question 0 must be an object"),
    ({"type": "blockQuiz", "attrs": {"questions": [question(question=" ")]}}, "question 0 needs question text"),
    ({"type": "blockQuiz", "attrs": {"questions": [question(answers=answers())]}}, "needs 2 to 12 answers"),
    ({"type": "blockQuiz", "attrs": {"questions": [question(), question()]}}, "question 1 needs a unique question_id"),
    ({"type": "blockQuiz", "attrs": {"questions": [question(answers=answers("x"))]}}, "answer 1 must be an object"),
    ({"type": "blockQuiz", "attrs": {"questions": [question(answers=answers({"answer_id": "b", "answer": "", "correct": False}))]}},
     "answer 1 needs text"),
    ({"type": "blockQuiz", "attrs": {"questions": [question(answers=answers({"answer_id": "b", "answer": "y", "correct": "no"}))]}},
     "needs correct: true or false"),
    ({"type": "blockQuiz", "attrs": {"questions": [question(answers=answers({"answer_id": "q", "answer": "y", "correct": False}))]}},
     "answer 1 needs a unique answer_id"),
    ({"type": "blockQuiz", "attrs": {"questions": [question(response_type="many")]}}, "response_type must be single or multiple"),
    ({"type": "scenarios", "attrs": {"scenarios": "x"}}, "1 to 100 scenario steps"),
    ({"type": "scenarios", "attrs": {"scenarios": [step(id=1)]}}, "step 0 needs a string id and text"),
    ({"type": "scenarios", "attrs": {"scenarios": [{"id": "s1", "text": "t"}]}}, "step 0 needs an options list"),
    ({"type": "scenarios", "attrs": {"scenarios": [step(options=[{"nextScenarioId": "s1"}])]}}, "option without text"),
    ({"type": "scenarios", "attrs": {"scenarios": [step(options=[{"text": "go", "nextScenarioId": "zz"}])]}},
     "points at unknown step 'zz'"),
    ({"type": "scenarios", "attrs": {"scenarios": [step(), step()]}}, "step ids must be unique"),
]


@pytest.mark.parametrize("node, expected", ATTR_CASES, ids=[e for _n, e in ATTR_CASES])
def test_attribute_values(node, expected):
    assert expected in problems(node)


def test_valid_attribute_values_pass():
    assert d.strict_problems({"type": "button", "attrs": {"link": ""}, "content": [text("Go")]}) == []
    assert d.strict_problems({"type": "blockEmbed", "attrs": {"embedUrl": "https://e.test", "embedType": None}}) == []
    assert d.strict_problems({"type": "blockWebPreview", "attrs": {"url": "https://site.test", "og_image": None}}) == []
    assert d.strict_problems({"type": "blockQuiz", "attrs": {"questions": [question()]}}) == []
    flow = [step(options=[{"text": "next", "nextScenarioId": "s2"}]), step(id="s2", text="End")]
    assert d.strict_problems({"type": "scenarios", "attrs": {"title": "Flow", "scenarios": flow}}) == []


def test_attrs_must_be_plain_json():
    attrs: dict = {"title": "x"}
    attrs["loop"] = attrs
    assert any("must be plain JSON" in p for p in d.attrs_problems("blockMagic", attrs))


# ─── building blocks ─────────────────────────────────────────────────────────


def test_fill_quiz_ids_accepts_both_shapes():
    assert d.fill_quiz_ids("x") == "x"
    simple, editor, junk = d.fill_quiz_ids([
        {"question": "Simple?", "explanation": "Why", "options": [
            {"text": "a", "correct": True}, {"text": "b", "correct": True}, "junk"]},
        {"question_id": "q1", "question": "Editor?", "answers": [
            {"answer_id": "a1", "answer": "x", "correct": True}, {"answer": "y", "correct": True}, "junk"]},
        "junk",
    ])
    assert simple["question"] == "Simple?" and simple["explanation"] == "Why"
    assert simple["response_type"] == "multiple" and [a["answer"] for a in simple["answers"]] == ["a", "b"]
    assert editor["question_id"] == "q1" and editor["type"] == "multiple_choice" and editor["response_type"] == "multiple"
    assert editor["answers"][0]["answer_id"] == "a1" and editor["answers"][1]["answer_id"].startswith("answer_")
    assert editor["answers"][2] == "junk" and junk == "junk"


def test_clean_marks_keeps_code_alone():
    nodes = d.clean_marks([text("x", "code", "bold"), text("y", "bold", "italic"), "junk"])
    assert nodes[0]["marks"] == [{"type": "code"}]
    assert nodes[1]["marks"] == [{"type": "bold"}, {"type": "italic"}]


# ─── paths ───────────────────────────────────────────────────────────────────


def test_locate_errors_guide_the_agent():
    doc = rich_doc()
    with pytest.raises(d.PathError, match="at least one index"):
        d.locate(doc, [])
    with pytest.raises(d.PathError, match="deeper than any block"):
        d.locate(doc, [0] * (d.MAX_DEPTH + 1))
    with pytest.raises(d.PathError, match=r"No block at \[3, 5\]: \[3\] has 2 children"):
        d.locate(doc, [3, 5])
    with pytest.raises(d.PathError, match=r"\[2\] has 1 child\. Read the outline"):
        d.locate(doc, [2, 1])
    with pytest.raises(d.PathError, match=r"inside the text of a paragraph; address the paragraph itself \(\[1\]\)"):
        d.locate(doc, [1, 0])
    assert d.locate(doc, [3, 0, 1, 0])[2]["type"] == "listItem"


def test_find_path_skips_inline_and_junk():
    target = _p("here")
    doc = {"type": "doc", "content": ["x", text("loose"), target]}
    assert d.find_path(doc, target) == [2]
    assert d.find_parent(doc, _p("elsewhere")) is None


# ─── outlines and searchable text ────────────────────────────────────────────

MEDIA = {"blockObject": {"block_uuid": "block_1", "content": {"file_name": "clip.mp4"}}}


def leaf_doc():
    return {"type": "doc", "content": [
        {"type": "calloutInfo", "content": [text("Old note")]},
        {"type": "codeBlock", "attrs": {"language": "py"}, "content": [text("x = 1")]},
        {"type": "orderedList", "attrs": {"start": 3}, "content": [_li("c")]},
        {"type": "flipcard", "attrs": {"question": "Front", "answer": "Back"}},
        {"type": "blockMathEquation", "attrs": {"math_equation": "x^2"}},
        {"type": "blockEmbed", "attrs": {"embedUrl": "https://embed.test/v", "embedType": "url"}},
        {"type": "blockWebPreview", "attrs": {"url": "https://site.test", "title": "Site", "description": "About"}},
        {"type": "youtube", "attrs": {"src": "https://www.youtube.com/embed/abc"}},
        {"type": "blockVideo", "attrs": MEDIA},
        {"type": "blockImage", "attrs": {"unsplash_url": "https://img.test/u.jpg", "alignment": "center"}},
        {"type": "scenarios", "attrs": {"title": "Choose", "scenarios": [
            step(text="Start here", options=[{"text": "Go left", "nextScenarioId": None}])]}},
        {"type": "blockH5P", "attrs": {"h5pUrl": "https://h5p.test/x", "title": "Game"}},
        {"type": "button", "attrs": {"link": "https://go.test"}, "content": [text("Go")]},
        {"type": "badge", "attrs": {"emoji": "*"}, "content": [text("New")]},
        {"type": "blockLibrary", "attrs": {"resourceUuid": "res_1", "resourceType": "video"}},
        {"type": "blockUser", "attrs": {"user_id": 3}},
    ]}


def test_outline_summarizes_every_block_kind():
    pairs = list(d.outline_entries(leaf_doc()))
    entries = {tuple(e["path"]): e for e, _s in pairs}
    search = {tuple(e["path"]): s for e, s in pairs}
    assert entries[(0,)]["callout_type"] == "info" and entries[(0,)]["text"] == "Old note"
    assert entries[(1,)]["language"] == "py" and entries[(1,)]["text"] == "x = 1"
    assert entries[(2,)]["start"] == 3 and entries[(2, 0)]["text"] == "c"
    assert (entries[(3,)]["question"], entries[(3,)]["answer"]) == ("Front", "Back")
    assert entries[(4,)]["latex"] == "x^2"
    assert entries[(5,)]["url"] == "https://embed.test/v" and entries[(5,)]["embed_type"] == "url"
    assert entries[(6,)]["title"] == "Site" and entries[(7,)]["url"] == "https://www.youtube.com/embed/abc"
    assert entries[(8,)]["media"] == {"block_uuid": "block_1", "file": "clip.mp4", "src": None}
    assert entries[(9,)]["media"]["src"] == "https://img.test/u.jpg" and entries[(9,)]["alignment"] == "center"
    assert entries[(10,)]["title"] == "Choose" and entries[(10,)]["steps"] == 1
    assert entries[(11,)]["title"] == "Game" and entries[(12,)]["link"] == "https://go.test"
    assert entries[(13,)]["emoji"] == "*" and entries[(14,)]["resource"] == {"uuid": "res_1", "kind": "video"}
    assert entries[(15,)] == {"path": [15], "type": "blockUser"}
    # Blocks whose data lives in attrs are still found by a query.
    assert "Go left" in search[(10,)] and search[(8,)] == "clip.mp4" and search[(9,)] == "https://img.test/u.jpg"
    assert search[(6,)] == "Site https://site.test About" and search[(5,)] == "https://embed.test/v"
    assert search[(11,)] == "Game" and search[(4,)] == "x^2" and search[(15,)] == ""
    assert d.atom_text(leaf_doc()["content"][3]) == "Front\nBack"


def test_outline_limits_long_quizzes_tables_and_depth():
    quiz = d.quiz_node([
        {"text": f"Q{i}?", "options": [{"text": "a", "correct": True}, {"text": "b", "correct": False}]}
        for i in range(21)
    ])
    row = {"type": "tableRow", "content": [{"type": "tableCell", "content": [_p("v")]}]}
    table = {"type": "table", "content": [row] * 31}
    nested = _p("bottom")
    for _ in range(30):
        nested = {"type": "bulletList", "content": [{"type": "listItem", "content": [_p("level"), nested]}]}
    nested = nested["content"][0]["content"][1]
    two = {"type": "callout", "attrs": {"type": "tip"}, "content": [_p("one"), _p("two")]}
    doc = {"type": "doc", "content": [quiz, table, "junk", nested, two]}
    entries = {tuple(e["path"]): e for e, _s in d.outline_entries(doc)}
    assert len(entries[(0,)]["questions"]) == 20 and entries[(0,)]["more_questions"] == 1
    assert len(entries[(1,)]["rows"]) == 30 and entries[(1,)]["more_rows"] == 1
    assert max(len(p) for p in entries) == d.MAX_DEPTH
    assert entries[(4, 1)]["text"] == "two"


# ─── text replacement ────────────────────────────────────────────────────────


def test_replace_keeps_line_breaks_and_can_empty_a_block():
    para = _p("a", {"type": "hardBreak"}, "b a")
    assert d.block_text(para) == "a\nb a" and d.count_in(para, "a") == 2
    assert d.replace_in(para, "a", "", None) == 2
    assert para["content"] == [{"type": "hardBreak"}, text("b ")]
    gone = _p("gone")
    assert d.replace_in(gone, "gone", "", None) == 1
    assert gone == {"type": "paragraph"}


def test_replace_reaches_text_in_attrs():
    flip = {"type": "flipcard", "attrs": {"question": "Front side", "answer": "Back side"}}
    assert d.replace_in(flip, "side", "face", None) == 2
    assert flip["attrs"] == {"question": "Front face", "answer": "Back face"}
    scen = {"type": "scenarios", "attrs": {"title": "Go on", "scenarios": [
        step(text="Go now", options=[{"text": "Go back"}, "junk"]), "junk"]}}
    assert d.count_in(scen, "Go") == 3
    assert d.replace_in(scen, "Go", "Run", 2) == 2
    assert scen["attrs"]["title"] == "Run on" and scen["attrs"]["scenarios"][0]["text"] == "Run now"
    assert scen["attrs"]["scenarios"][0]["options"][0]["text"] == "Go back"


# ─── the batch editor ────────────────────────────────────────────────────────


def test_editor_follows_replaced_blocks_and_refuses_removed_ones():
    doc = rich_doc()
    ed = d.Editor(doc)
    assert ed.replace([0], []) == "heading"
    with pytest.raises(d.PathError, match="removed by an earlier operation"):
        ed.node([0])
    first, second = _p("one"), _p("two")
    ed.replace([1], [first])
    ed.replace([1], [second])  # the path follows the block that took its place
    assert ed.node([1]) is second
    with pytest.raises(d.PathError, match="points inside the text of a block"):
        ed.node([1, 0])
    with pytest.raises(d.PathError, match=r"No block at \[99\] in the version you read"):
        ed.node([99])
    ed.check()
    assert doc["content"][0] is second


def test_editor_on_legacy_shapes():
    empty = {"type": "doc", "content": [{"type": "paragraph"}]}
    ed = d.Editor(empty)
    ed.insert("start", None, [_p("x")])
    assert empty["content"] == [_p("x")]  # the placeholder paragraph of an empty page goes
    item = {"type": "listItem", "content": [{"type": "bulletList", "content": [_li("inner")]}]}
    doc = {"type": "doc", "content": [{"type": "bulletList", "content": [item]}, {"type": "mystery"}]}
    ed = d.Editor(doc)
    assert ed.set_text([0, 0], [text("label")], "label") == "listItem"
    assert item["content"][0] == _p("label") and item["content"][1]["type"] == "bulletList"
    with pytest.raises(d.DocError, match="Unknown block type 'mystery'"):
        ed.set_attrs([1], {"x": 1})


# ─── edit_activity_content ───────────────────────────────────────────────────


async def test_edit_errors_an_agent_can_act_on(registry, db, org, admin_user, page):
    ctx = ctx_for(db, org, admin_user)
    cases = [
        ({"op": "replace_text", "find": "a\ufffcb", "replace": "x"}, "unsupported character"),
        ({"op": "replace_text", "find": "absent", "replace": "x", "path": [1]}, "'absent' was not found in [1]"),
        ({"op": "insert", "at": "inside_end", "path": [1], "block": {"markdown": "x"}}, "Cannot insert blocks inside a paragraph"),
        ({"op": "insert", "at": "inside_end", "path": [5], "block": {"markdown": "x"}}, "Cannot insert blocks inside a blockQuiz"),
        ({"op": "set_attrs", "path": [1], "attrs": {"x": 1}}, "A paragraph has no settings to change"),
        ({"op": "set_text", "path": [1, 0], "text": "x"}, "points inside the text of a block"),
        ({"op": "set_text", "path": [4], "text": "x"}, "Address one of its children, or use replace_block"),
        ({"op": "move", "from_path": [3, 0], "to": "after", "path": [0]}, "A listItem cannot sit at the top of the page ([1])"),
        ({"op": "replace_block", "path": [3, 0], "block": {"markdown": "plain"}}, "cannot hold a paragraph"),
        ({"op": "insert", "at": "end", "block": {"node": {"type": "paragraph", "content": [link("x", "javascript:alert(1)")]}}},
         "http(s) href"),
    ]
    for op, expected in cases:
        out = await edit(registry, ctx, op)
        assert out.status == "denied" and expected in out.reason, (op, out.reason)
    assert (await stored(db)).current_version == 1


async def test_edit_paths_after_removals_in_the_same_batch(registry, db, org, admin_user, page):
    ctx = ctx_for(db, org, admin_user)
    out = await edit(registry, ctx, {"op": "delete", "path": [2]},
                     {"op": "insert", "at": "after", "path": [2, 0], "block": {"markdown": "x"}})
    assert "Op 1 (insert) failed" in out.reason and "removed by an earlier operation" in out.reason
    out = await edit(registry, ctx, {"op": "delete", "path": [1]}, {"op": "set_text", "path": [1], "text": "x"})
    assert "removed by an earlier operation" in out.reason
    # Filling a callout and then deleting it is fine: the callout is simply gone.
    out = await edit(registry, ctx, {"op": "insert", "at": "inside_start", "path": [2], "block": {"markdown": "First"}},
                     {"op": "delete", "path": [2]})
    assert out.status == "executed", out.reason
    content = (await stored(db)).content["content"]
    assert [n["type"] for n in content][:3] == ["heading", "paragraph", "bulletList"]


async def test_edit_inside_start_and_text_kinds(registry, db, org, admin_user, page):
    ctx = ctx_for(db, org, admin_user)
    out = await edit(registry, ctx,
                     {"op": "insert", "at": "inside_start", "path": [2], "block": {"markdown": "First"}},
                     {"op": "set_text", "path": [1], "text": ""},
                     {"op": "replace_text", "find": "Intro", "replace": "Start", "path": [0]},
                     {"op": "insert", "at": "after", "path": [0], "block": {"node": {"type": "codeBlock", "attrs": {"language": "py"}}}})
    assert out.status == "executed", out.reason
    assert out.result["ops"][2] == {"op": 2, "kind": "replace_text", "replaced": 1, "paths": [[0]]}
    content = (await stored(db)).content["content"]
    assert d.block_text(content[0]) == "Start" and content[2] == {"type": "paragraph"}
    assert [d.block_text(p) for p in content[3]["content"]] == ["First", "Remember this"]
    # Code keeps its text literally; an empty text clears it.
    out = await edit(registry, ctx, {"op": "set_text", "path": [1], "text": "print(1)\n**not bold**"})
    assert out.status == "executed", out.reason
    assert (await stored(db)).content["content"][1]["content"] == [text("print(1)\n**not bold**")]
    out = await edit(registry, ctx, {"op": "set_text", "path": [1], "text": ""})
    assert "content" not in (await stored(db)).content["content"][1]


async def test_set_text_on_callouts_and_quotes_splits_paragraphs(registry, db, org, admin_user, activity):
    await _set_content(db, activity, {"type": "doc", "content": [
        {"type": "callout", "attrs": {"type": "info"}, "content": [_p("old")]},
        {"type": "blockquote", "content": [_p("old"), _p("older")]},
    ]})
    out = await edit(registry, ctx_for(db, org, admin_user),
                     {"op": "set_text", "path": [0], "text": "one\n**two**"},
                     {"op": "set_text", "path": [1], "text": "said"})
    assert out.status == "executed", out.reason
    callout, quote = (await stored(db)).content["content"]
    assert callout["content"] == [_p("one"), {"type": "paragraph", "content": [text("two", "bold")]}]
    assert quote["content"] == [_p("said")]


async def test_set_attrs_rules(registry, db, org, admin_user, activity):
    image = {"type": "blockImage", "attrs": {"blockObject": {"block_uuid": "block_1"}, "alignment": "left"}}
    await _set_content(db, activity, {"type": "doc", "content": [
        image,
        {"type": "callout", "attrs": {"type": "tip", "dismissible": True}, "content": [_p("x")]},
        d.quiz_node([{"text": "Old?", "options": [{"text": "a", "correct": True}, {"text": "b", "correct": False}]}]),
    ]})
    ctx = ctx_for(db, org, admin_user)
    out = await edit(registry, ctx, {"op": "set_attrs", "path": [0], "attrs": {"blockObject": {"block_uuid": "other"}}})
    assert "cannot be changed; add a new one with add_media_block" in out.reason
    out = await edit(registry, ctx,
                     {"op": "set_attrs", "path": [0], "attrs": {"alignment": "center"}},
                     {"op": "set_attrs", "path": [1], "attrs": {"dismissible": None}},
                     {"op": "set_attrs", "path": [2], "attrs": {"questions": [
                         {"text": "New?", "options": [{"text": "y", "correct": True}, {"text": "n", "correct": True}]}]}})
    assert out.status == "executed", out.reason
    assert out.result["ops"][1]["before"] == {"dismissible": True}
    image_after, callout, quiz = (await stored(db)).content["content"]
    assert image_after["attrs"] == {"blockObject": {"block_uuid": "block_1"}, "alignment": "center"}
    assert callout["attrs"] == {"type": "tip"}  # null resets a setting
    q = quiz["attrs"]["questions"][0]
    assert q["question"] == "New?" and q["response_type"] == "multiple" and q["question_id"].startswith("question_")


async def test_deleting_everything_leaves_an_empty_page(registry, db, org, admin_user, page):
    ops = [{"op": "delete", "path": [i]} for i in range(len(page.content["content"]))]
    out = await edit(registry, ctx_for(db, org, admin_user), *ops)
    assert out.status == "executed", out.reason
    assert (await stored(db)).content == {"type": "doc", "content": [{"type": "paragraph"}]}


async def test_edit_markdown_limit_notes_and_summary(registry, db, org, admin_user, page):
    ctx = ctx_for(db, org, admin_user)
    chunk = {"op": "insert", "at": "end", "block": {"markdown": "x" * 61_000}}
    out = await edit(registry, ctx, chunk, chunk, chunk, {"op": "insert", "at": "end", "block": {"callout": {"markdown": "y" * 20_000}}})
    assert out.denied_code == "http_400" and f"the limit per call is {content_edit.MAX_OPS_MARKDOWN}" in out.reason
    out = await edit(registry, ctx, {"op": "insert", "at": "end", "block": {"markdown": "![chart](https://img.test/c.png)"}})
    assert out.status == "executed" and any("add_media_block" in n for n in out.result["notes"])
    proposed = await call(registry, ctx_for(db, org, admin_user, mode="confirm"), "edit_activity_content",
                          activity_uuid="activity_test",
                          ops=[{"op": "delete", "path": [0]}, {"op": "set_text", "path": [1], "text": "x"}])
    assert proposed.status == "proposed"
    assert proposed.proposal.summary == "Edit page content: 2 changes (delete, set text)"


# ─── reading parts of a page ─────────────────────────────────────────────────


async def test_outline_paths_and_budget(registry, db, org, admin_user, page, activity):
    ctx = ctx_for(db, org, admin_user)
    out = await ok(registry, ctx, "get_activity_content", activity_uuid="activity_test", paths=[[2, 0], [99], [1, 0]])
    assert [b["path"] for b in out["blocks"]] == [[2, 0]] and out["missing_paths"] == [[99], [1, 0]]
    await _set_content(db, activity, {"type": "doc", "content": [_p(f"{i} " + "w" * 1000) for i in range(40)]})
    out = await ok(registry, ctx, "get_activity_content", activity_uuid="activity_test")
    assert out["truncated"] and 0 < len(out["blocks"]) < 40 and out["top_level_blocks"] == 40
    assert f"[[{len(out['blocks'])}], ...]" in out["guidance"]


async def test_markdown_parts_queries_and_budget(registry, db, org, admin_user, page, activity):
    ctx = ctx_for(db, org, admin_user)
    out = await ok(registry, ctx, "get_activity_content", activity_uuid="activity_test", format="markdown", paths=[[2], [99]])
    assert out["markdown"].startswith("<!-- at [2] -->\n> [!TIP]\n> Remember this")
    assert out["missing_paths"] == [[99]] and "This is part of the page" in out["about"]
    found = await ok(registry, ctx, "get_activity_content", activity_uuid="activity_test", format="markdown", query="REMEMBER")
    assert found["markdown"] == "> [!TIP]\n> Remember this\n" and "part of the page" in found["about"]
    await _set_content(db, activity, {"type": "doc", "content": [_p("w" * 1000) for _ in range(40)]})
    out = await ok(registry, ctx, "get_activity_content", activity_uuid="activity_test", format="markdown")
    assert out["truncated"] and "do not write it back with mode=replace" in out["guidance"]
    assert "part of the page" in out["about"]
    await _set_content(db, activity, {"type": "doc", "content": [_p("w" * 30_000)]})
    out = await ok(registry, ctx, "get_activity_content", activity_uuid="activity_test", format="markdown")
    assert out["truncated"] and "<!-- block [0] cut here" in out["markdown"]
    assert len(out["markdown"]) <= content_edit.RESULT_BUDGET


async def test_json_paths_budget(registry, db, org, admin_user, activity):
    await _set_content(db, activity, {"type": "doc", "content": [_p("a" * 30_000), _p("b" * 30_000)]})
    out = await ok(registry, ctx_for(db, org, admin_user), "get_activity_content",
                   activity_uuid="activity_test", format="json", paths=[[0], [1]])
    assert [n["path"] for n in out["nodes"]] == [[0]]
    assert out["truncated"] and "Stopped before [1]" in out["guidance"]


# ─── write_activity_content ──────────────────────────────────────────────────


async def test_write_rejects_bad_block_comments(registry, db, org, admin_user, page):
    ctx = ctx_for(db, org, admin_user)
    out = await denied(registry, ctx, "write_activity_content", activity_uuid="activity_test",
                       markdown="<!-- block [42] blockCode -->")
    assert "no block at [42]" in out.reason
    out = await denied(registry, ctx, "write_activity_content", activity_uuid="activity_test",
                       markdown="<!-- block [7] blockCode -->\n\n<!-- block [7] blockCode -->")
    assert "the block at [7] is kept twice" in out.reason
    assert (await stored(db)).current_version == 1


async def test_write_append_to_empty_page_and_strict_check(registry, db, org, admin_user, activity):
    await _set_content(db, activity, {"type": "doc", "content": [{"type": "paragraph"}]})
    ctx = ctx_for(db, org, admin_user)
    out = await ok(registry, ctx, "write_activity_content", activity_uuid="activity_test", markdown="Hi", mode="append")
    assert out["top_level_blocks"] == 1
    assert (await stored(db)).content == {"type": "doc", "content": [_p("Hi")]}
    out = await denied(registry, ctx, "write_activity_content", activity_uuid="activity_test",
                       markdown="$$ " + "x" * 10_001 + " $$", mode="append")
    assert "math_equation must be at most 10000 characters" in out.reason


async def test_write_refuses_to_extend_a_page_that_would_not_load(registry, db, org, admin_user, activity):
    await _set_content(db, activity, {"type": "doc", "content": [{"type": "script"}]})
    out = await denied(registry, ctx_for(db, org, admin_user), "write_activity_content",
                       activity_uuid="activity_test", markdown="more", mode="append")
    assert out.denied_code == "http_400" and "Unknown block type 'script'" in out.reason


# ─── rows that point elsewhere ───────────────────────────────────────────────


async def test_activity_on_another_orgs_course_is_not_editable(registry, db, org, other_org, admin_user, course):
    elsewhere = Course(
        id=50, name="Elsewhere", description="", public=True, published=True,
        open_to_contributors=False, org_id=other_org.id, course_uuid="course_other",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(elsewhere)
    await db.commit()
    db.add(Activity(
        id=60, name="Crossed", activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE, content=rich_doc(),
        published=True, org_id=org.id, course_id=elsewhere.id, activity_uuid="activity_crossed",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    await db.commit()
    out = await call(registry, ctx_for(db, org, admin_user), "edit_activity_content",
                     activity_uuid="activity_crossed", ops=[{"op": "delete", "path": [0]}])
    assert out.denied_code == "http_404"


async def test_activity_without_its_course_reads_as_missing(registry, db, org, admin_user, course):
    db.add(Activity(
        id=61, name="Orphan", activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE, content=rich_doc(),
        published=True, org_id=org.id, course_id=999, activity_uuid="activity_orphan",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    await db.commit()
    out = await denied(registry, ctx_for(db, org, admin_user), "get_activity_content", activity_uuid="activity_orphan")
    assert out.denied_code == "http_404" and "activity_orphan" in out.reason


async def test_restore_passes_other_errors_through(registry, db, org, admin_user, activity):
    failure = HTTPException(status_code=404, detail="Activity not found")
    with patch.object(content_edit, "restore_activity_version", AsyncMock(side_effect=failure)):
        out = await denied(registry, ctx_for(db, org, admin_user), "restore_activity_version",
                           activity_uuid="activity_test", version=1)
    assert out.denied_code == "http_404" and "No saved version" not in out.reason


# ─── Markdown corners ────────────────────────────────────────────────────────


def test_inline_literals_and_link_forms():
    assert inline("~one~ and ~~~three~~~ and ****four****") == [text("~one~ and ~~~three~~~ and ****four****")]
    assert inline("C:\\new") == [text("C:\\new")]
    assert inline("`` `x` ``") == [text("`x`", "code")]
    assert inline("a\n   b") == [text("a b")]
    assert inline("[a]( https://x.test)") == [link("a")]
    assert inline('[a](https://x.test "t" )') == [link("a")]
    assert inline('[a](https://x.test "open') == [text('[a](https://x.test "open')]
    # Line breaks inside a link label survive, linked or not.
    assert inline("[a  \nb](https://x.test)") == [link("a"), {"type": "hardBreak"}, link("b")]
    assert inline("[a  \nb](ftp://h/f)") == [text("a"), {"type": "hardBreak"}, text("b")]


def test_block_corners():
    assert markdown_to_doc("```py{x}\ncode\n```")["content"][0]["attrs"] == {"language": None}
    assert markdown_to_doc("Title\n---")["content"][0]["attrs"] == {"level": 2}
    assert markdown_to_doc("Para\n    ===")["content"] == [_p("Para ===")]
    assert markdown_to_doc("#tag")["content"] == [_p("#tag")]
    assert markdown_to_doc("a | b\nc | d")["content"] == [_p("a | b c | d")]
    assert markdown_to_doc("$$x + 1")["content"] == [_p("$$x + 1")]
    assert markdown_to_doc("$$\nx")["content"] == [_p("$$ x")]
    two = markdown_to_doc("- a\n\n\n- b")["content"]
    assert len(two) == 1 and len(two[0]["content"]) == 2
    item = markdown_to_doc("- a\n  - b\n  more")["content"][0]["content"][0]
    assert [n["type"] for n in item["content"]] == ["paragraph", "bulletList", "paragraph"]
    assert d.block_text(item["content"][2]) == "more"


def test_callout_flattening_and_limits():
    callout = markdown_to_doc("> [!NOTE]\n> ```\n> a\n> b\n> ```\n> > inner")["content"][0]
    assert callout["content"] == [
        {"type": "paragraph", "content": [text("a", "code"), {"type": "hardBreak"}, text("b", "code")]},
        _p("inner"),
    ]
    with pytest.raises(HTTPException) as e:
        md.callout("info", "x" * (md.MAX_CHARS + 1))
    assert e.value.status_code == 400
    wide = md.convert("|".join("h" * 31) + "\n" + "|".join(["-"] * 31))
    assert len(wide.doc["content"][0]["content"][0]["content"]) == md.MAX_TABLE_COLUMNS
    assert any("at most 30 columns" in n for n in wide.notes)


def test_block_comments_only_count_at_the_top():
    quoted = md.convert("> <!-- block [3] blockCode -->", keep_blocks=True)
    assert all(n["type"] != md.KEEP for n in quoted.doc["content"])
    assert any("keep them at the top level" in n for n in quoted.notes)
    assert md.convert("<!-- block [,] blockCode -->", keep_blocks=True).doc["content"] == [{"type": "paragraph"}]


def test_inline_markdown_out():
    def out(*nodes):
        return md.render_block({"type": "paragraph", "content": list(nodes)}, [0])

    assert out(text("a", "bold"), {"type": "hardBreak"}, text("b")) == ["**a**\\", "b"]
    assert out(text("a", "bold"), text("b", "bold", "italic")) == ["**a*b***"]
    assert out(text("a", "bold"), link("b")) == ["**a**[b](https://x.test)"]
    assert out(text("a"), {"type": "mention"}, text("b")) == ["ab"]
    for nodes in ([text("a", "bold"), text("b", "bold", "italic")], [text("a", "bold"), link("b")]):
        doc = {"type": "doc", "content": [{"type": "paragraph", "content": nodes}]}
        assert markdown_to_doc(doc_to_markdown(doc)) == doc


def test_render_blocks_markdown_cannot_show():
    def comment(node):
        return "\n".join(md.render_block(node, [4]))

    assert comment({"type": "flipcard", "attrs": {"question": "Front"}}).startswith("<!-- block [4] flipcard\nFlipcard. Q: Front")
    assert "Video file: clip.mp4" in comment({"type": "blockVideo", "attrs": MEDIA})
    assert "Image file: uploaded file" in comment({"type": "blockImage", "attrs": {}})
    assert "YouTube video: https://y.test/v" in comment({"type": "youtube", "attrs": {"src": "https://y.test/v"}})
    assert "Link preview: Site https://site.test" in comment({"type": "blockWebPreview", "attrs": {"url": "https://site.test", "title": "Site"}})
    assert "Interactive element: Game" in comment({"type": "blockH5P", "attrs": {"title": "Game"}})
    assert "Button: Go" in comment({"type": "button", "content": [text("Go")]})
    assert "Badge:" in comment({"type": "badge", "attrs": {"link": "https://x.test"}})
    assert "Member profile card." in comment({"type": "blockUser", "attrs": {"user_id": 1}})
    assert "Library item: video res_1" in comment({"type": "blockLibrary", "attrs": {"resourceUuid": "res_1", "resourceType": "video"}})
    assert comment({"type": "calloutWarning", "content": [text("Legacy")]}) == "> [!WARNING]\n> Legacy"
    assert comment({"type": "codeBlock", "content": [text("```\nx\n```")]}) == "````\n```\nx\n```\n````"
    assert comment({"type": "blockquote", "content": [_p("a"), _p("b")]}) == "> a\n>\n> b"
    assert md.render_block({"type": "table", "content": []}, [0]) == []
    assert md.render_block("x", [0]) == []
    # A block type this version does not know still shows its text.
    assert comment({"type": "mystery", "content": [_p("kept text")]}) == "<!-- block [4] mystery\nkept text\n-->"


def test_is_prose_edges():
    assert not md.is_prose("x")
    assert md.is_prose({"type": "horizontalRule"})
    with_media = {"type": "bulletList", "content": [{"type": "listItem", "content": [_p("a"), {"type": "blockVideo", "attrs": MEDIA}]}]}
    assert not md.is_prose(with_media)
    assert md.is_prose(rich_doc()["content"][3])
