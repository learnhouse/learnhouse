"""Editor Plus content (tables, layout and data blocks, block upgrades) in the
AI tools: schema, outline, editing, Markdown, typed blocks, quality checks."""

from collections import Counter

import pytest

from src.services.ai.tools import block_specs as bs
from src.services.ai.tools import content_blocks, course_audit, course_quality, courses
from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import markdown as md
from src.tests.services.editor_plus_fixtures import BLOCK_OBJECT, QUIZ, TABLE, p, plus_page


def _node(page: dict, t: str) -> dict:
    return next(n for n in page["content"] if n["type"] == t)


# ─── schema ──────────────────────────────────────────────────────────────────


def test_every_editor_plus_node_passes_the_full_schema():
    page = plus_page()
    assert d.loadable_problems(page) == []
    for i, node in enumerate(page["content"]):
        assert d.strict_problems(node, (i,), authoring=False) == [], node["type"]
        if node["type"] != "blockImage":  # media come from uploads, never raw JSON
            assert d.strict_problems(node, (i,)) == [], node["type"]


def test_new_types_are_registered_with_their_content_models():
    for name in ("tabs", "columns", "accordion", "timeline", "keyTakeaways", "taskList", "quoteBlock", "buttonGroup"):
        assert name in d.CONTAINERS and name in d.BLOCK_TYPES
    for name in d.PLUS_ATOMS:
        assert name in d.LEAVES
    assert "inlineMath" in d.INLINE_TYPES
    assert {"tabItem", "column", "timelineItem", "taskItem"} <= d.CONTAINERS - d.BLOCK_TYPES


def test_content_model_bounds():
    tab = {"type": "tabItem", "attrs": {"title": "A"}, "content": [p("x")]}
    assert "at least 2 of tabItem" in d.content_problem({"type": "tabs", "content": [tab]})
    assert "at most 8 of tabItem" in d.content_problem({"type": "tabs", "content": [tab] * 9})
    col = {"type": "column", "content": [p("x")]}
    assert "at most 4 of column" in d.content_problem({"type": "columns", "content": [col] * 5})
    assert d.content_problem({"type": "columns", "content": [col] * 4}) is None
    assert "cannot hold a paragraph" in d.content_problem({"type": "accordion", "content": [p("x")]})
    assert "at least one of taskItem" in d.content_problem({"type": "taskList", "content": []})
    assert "needs a paragraph first" in d.content_problem({"type": "listItem", "content": []})


BAD_ATTRS = [
    ("paragraph", {"textAlign": "left"}, "textAlign"),
    ("codeBlock", {"highlightLines": "2-a"}, "line numbers"),
    ("codeBlock", {"showLineNumbers": "yes"}, "true or false"),
    ("table", {"variant": "fancy"}, "variant"),
    ("table", {"totals": "max"}, "totals"),
    ("tableCell", {"cellType": "slider"}, "cellType"),
    ("tableCell", {"currency": "dollars"}, "currency code"),
    ("tableHeader", {"background": "#fff"}, "background"),
    ("callout", {"type": "note"}, "set kind: 'note'"),
    ("callout", {"type": "loud"}, "must be one of"),
    ("callout", {"kind": "warning"}, "kind"),
    ("toggleBlock", {"icon": "arrow"}, "icon"),
    ("button", {"size": "xl"}, "size"),
    ("blockImage", {"frame": "gold"}, "frame"),
    ("inlineMath", {"latex": " "}, "must not be empty"),
    ("tabs", {"variant": "cards"}, "variant"),
    ("columns", {"layout": "3-1"}, "layout"),
    ("timelineItem", {"tone": "purple"}, "tone"),
    ("tableOfContents", {"maxLevel": 6}, "maxLevel"),
    ("keyTakeaways", {"icon": "fire"}, "icon"),
    ("gallery", {"images": "x"}, "at most 40 images"),
    ("gallery", {"images": ["x"]}, "image 0 must be an object"),
    ("gallery", {"images": [{"url": "https://x.org/a.png", "size": 2}]}, "no field 'size'"),
    ("gallery", {"images": [{"url": "javascript:x"}]}, "http(s)"),
    ("gallery", {"images": [{"blockObject": {"x": 1}}]}, "blockObject"),
    ("gallery", {"images": [{"url": "https://x.org/a.png", "alt": 5}]}, "alt must be text"),
    ("gallery", {"images": [{"caption": "no source"}]}, "needs a url"),
    ("imageCompare", {"before": {"label": "x" * 81}}, "label must be text"),
    ("imageCompare", {"start": 101}, "start"),
    ("chart", {"data": []}, "labels"),
    ("chart", {"data": {"labels": [1], "series": []}}, "labels must be"),
    ("chart", {"data": {"labels": ["a"], "series": "x"}}, "series must be"),
    ("chart", {"data": {"labels": ["a"], "series": ["x"]}}, "series 0 must be"),
    ("chart", {"data": {"labels": ["a"], "series": [{"name": 3, "values": [1]}]}}, "name must be text"),
    ("chart", {"data": {"labels": ["a"], "series": [{"name": "s", "values": []}]}}, "one value per label"),
    ("chart", {"data": {"labels": ["a"], "series": [{"name": "s", "values": [True]}]}}, "must be numbers"),
    ("chart", {"data": {"labels": ["a"], "series": [{"name": "s", "values": [1], "tone": "gold"}]}}, "tone must be"),
    ("chart", {"type": "radar"}, "type"),
    ("statHighlights", {"items": []}, "1 to 8 stats"),
    ("statHighlights", {"items": ["x"]}, "stat 0 must be an object"),
    ("statHighlights", {"items": [{"value": "1", "big": True}]}, "no field 'big'"),
    ("statHighlights", {"items": [{"value": True}]}, "value must be"),
    ("statHighlights", {"items": [{"value": "1", "label": 3}]}, "label must be text"),
    ("statHighlights", {"items": [{"value": "1", "tone": "gold"}]}, "tone must be"),
    ("fileCard", {"blockObject": "x"}, "stored upload"),
    ("fileCard", {"sizeBytes": -1}, "sizeBytes"),
    ("fileCard", {"url": "ftp://x.org/a"}, "http(s)"),
    ("quoteBlock", {"avatarUrl": "data:x"}, "http(s)"),
    ("quoteBlock", {"variant": "loud"}, "variant"),
    ("blockQuiz", {"settings": "x"}, "object or null"),
    ("blockQuiz", {"settings": {"passMark": 101}}, "passMark"),
    ("blockQuiz", {"settings": {"showExplanations": 1}}, "showExplanations"),
]


@pytest.mark.parametrize("t,attrs,problem", BAD_ATTRS)
def test_bad_editor_plus_attrs_are_named(t, attrs, problem):
    out = " ".join(d.attrs_problems(t, attrs))
    assert problem in out, out


def test_good_settings_and_nulls_pass():
    assert d.attrs_problems("blockQuiz", {"settings": None}) == []
    assert d.attrs_problems("blockQuiz", {"settings": {"passMark": 0, "shuffle": True}}) == []
    assert d.attrs_problems("imageCompare", {"before": None, "after": {"url": "https://x.org/a.png", "label": "x"}}) == []
    assert d.attrs_problems("tableCell", {"cellType": None, "currency": None, "align": "right"}) == []
    assert d.attrs_problems("statHighlights", {"items": [{"value": 12, "label": ""}]}) == []


def _question(**kw) -> dict:
    return {"question_id": "q", "question": "Q?", **kw}


@pytest.mark.parametrize("question,problem", [
    (_question(type="short_answer", answers=[{"answer_id": "a", "answer": "x", "correct": True}], accepted_answers=["x"]), "leave answers empty"),
    (_question(type="short_answer", accepted_answers=[]), "1 to 10 accepted_answers"),
    (_question(type="short_answer", accepted_answers=[" "]), "1 to 10 accepted_answers"),
    (_question(type="short_answer", accepted_answers=["x"], accent_insensitive="yes"), "accent_insensitive"),
    (_question(type="numeric", answers=[]), "correct_value number"),
    (_question(type="numeric", correct_value=True), "correct_value number"),
    (_question(type="numeric", correct_value=3, tolerance=-1), "tolerance"),
    (_question(type="true_false", answers=[{"answer_id": f"a{i}", "answer": "T", "correct": True} for i in range(3)]), "exactly 2 answers"),
])
def test_typed_quiz_questions_are_checked(question, problem):
    assert problem in (d._quiz_questions([question]) or "")


def test_typed_quiz_questions_pass():
    assert d._quiz_questions(QUIZ["attrs"]["questions"]) is None
    assert d._quiz_questions([_question(type="numeric", correct_value=2.5, tolerance=None)]) is None
    # A type the editor does not know is multiple choice there and here.
    legacy = _question(type="odd", answers=[{"answer_id": "a", "answer": "x", "correct": True},
                                            {"answer_id": "b", "answer": "y", "correct": False}])
    assert d._quiz_questions([legacy]) is None


# ─── quizzes from the simple shape ───────────────────────────────────────────


def test_quiz_question_shapes():
    tf = d.quiz_question({"text": "Sky is blue", "type": "true_false", "answer": True, "explanation": "Rayleigh."})
    assert [a["correct"] for a in tf["answers"]] == [True, False] and tf["response_type"] == "single"
    assert tf["explanation"] == "Rayleigh."
    false = d.quiz_question({"text": "Sun is cold", "type": "true_false", "answer": "true"})
    assert [a["correct"] for a in false["answers"]] == [False, True]  # only a real true counts
    sa = d.quiz_question({"text": "Pigment?", "type": "short_answer", "accepted_answers": ["chlorophyll"], "accent_insensitive": True})
    assert sa["answers"] == [] and sa["accepted_answers"] == ["chlorophyll"] and sa["accent_insensitive"] is True
    plain_sa = d.quiz_question({"text": "Pigment?", "type": "short_answer", "accepted_answers": ["x"]})
    assert "accent_insensitive" not in plain_sa
    num = d.quiz_question({"text": "2+2", "type": "numeric", "correct_value": 4})
    assert num["correct_value"] == 4 and num["tolerance"] == 0 and num["answers"] == []
    node = d.quiz_node([{"text": "2+2", "type": "numeric", "correct_value": 4}], {"passMark": 80})
    assert node["attrs"]["settings"] == {"passMark": 80}
    assert "settings" not in d.quiz_node([{"text": "a", "options": [{"text": "x", "correct": True}, {"text": "y", "correct": False}]}])["attrs"]
    assert d.strict_problems(node) == []


def test_fill_quiz_ids_accepts_typed_simple_questions():
    out = d.fill_quiz_ids([
        {"text": "2+2", "type": "numeric", "correct_value": 4, "tolerance": 0.5, "explanation": "Add."},
        {"question": "Pigment?", "type": "short_answer", "accepted_answers": ["chlorophyll"]},
        {"text": "x", "type": "true_false", "answer": False},
    ])
    assert out[0]["correct_value"] == 4 and out[0]["tolerance"] == 0.5 and out[0]["explanation"] == "Add."
    assert out[1]["question"] == "Pigment?" and out[1]["question_id"]
    assert out[2]["answers"][1]["correct"] is True
    assert d._quiz_questions(out) is None


# ─── reading ─────────────────────────────────────────────────────────────────


def test_text_of_new_blocks():
    page = plus_page()
    assert d.inline_text(page["content"][1]) == "Energy is $E=mc^2$ here."
    assert d.block_text(TABLE).splitlines()[0] == "Team progress"
    assert "Step 1 Absorb" in d.block_text(_node(page, "timeline"))
    assert d.block_text(_node(page, "tabs")).splitlines()[:2] == ["Light", "Light reactions."]
    assert d.block_text(_node(page, "quoteBlock")).endswith("— Sam, Designer")
    assert d.block_text(_node(page, "callout")).startswith("Remember")
    assert d.quote_credit({"type": "quoteBlock", "attrs": {}}) == ""
    chart = d.atom_text(_node(page, "chart"))
    assert "Growth" in chart and "Height: Low 4, High 15.5" in chart
    assert d.atom_text(_node(page, "statHighlights")).splitlines() == ["92% Completion: of learners", "~4.8 Rating"]
    assert d.atom_text(_node(page, "gallery")).splitlines() == ["A leaf", "Chloroplast"]
    assert d.atom_text(_node(page, "imageCompare")).splitlines() == ["Summer - Green tree", "Autumn"]
    assert d.atom_text(_node(page, "fileCard")) == "Worksheet\nPrint it."
    assert d.atom_text({"type": "tableOfContents", "attrs": {"title": ""}}) == "Table of contents"
    odd_chart = {"type": "chart", "attrs": {"data": {"labels": ["a"], "series": [{"name": "", "values": ["x"]}]}}}
    assert d.plus_atom_lines(odd_chart) == ["a"]
    assert d.plus_atom_lines({"type": "chart", "attrs": {"data": "bad"}}) == []


def test_outline_summaries_of_new_blocks():
    page = plus_page()
    entries: dict = {}
    for e, _full in d.outline_entries(page):
        entries.setdefault(e["type"], e)
    assert entries["tabs"]["tabs"] == ["Light", "Dark"]
    assert entries["accordion"]["sections"] == ["Why green?"]
    assert entries["timeline"]["steps"] == ["Step 1 Absorb", "Split"]
    assert entries["columns"]["layout"] == "1-2"
    assert entries["taskList"]["items"] == ["Read", "Practice\nTwice"]
    assert entries["tabItem"]["title"] == "Light" and entries["keyTakeaways"]["title"] == "Remember this"
    assert entries["quoteBlock"]["author"] == "Sam"
    assert entries["chart"]["chart_type"] == "line" and entries["gallery"]["images"] == 2
    assert entries["fileCard"]["url"] == "https://example.org/sheet.pdf"
    assert entries["callout"]["callout_type"] == "note" and entries["callout"]["title"] == "Remember"
    assert entries["callout"]["collapsible"] is True
    assert entries["table"]["options"]["variant"] == "striped" and entries["table"]["column_types"] == ["text", "status", "progress"]
    assert entries["taskItem"]["text"] == "Read"
    quiz = entries["blockQuiz"]["questions"]
    assert quiz[0]["type"] == "true_false"
    assert quiz[1]["accepted_answers"] == ["chlorophyll", "42"] and quiz[2]["correct_value"] == 6
    paths = [e["path"] for e, _ in d.outline_entries(page) if e["type"] == "paragraph"]
    assert [6, 0, 0] in paths and [11, 1, 1] in paths  # a tab's text, a checklist item's second paragraph
    assert d.summary({"type": "inlineMath", "attrs": {"latex": "x"}}) == {"latex": "x"}
    assert d._column_types({"type": "table", "content": [{"type": "tableRow", "content": [{"type": "tableHeader"}]}]}) is None
    assert d._column_types({"type": "table", "content": [{"type": "tableRow", "content": [{"type": "tableCell"}]}]}) is None


def test_replace_text_reaches_new_attrs():
    page = plus_page()
    chart = _node(page, "chart")
    targets = [n["type"] for _p, n in d.text_targets(page, ())]
    for t in ("tabItem", "timelineItem", "gallery", "imageCompare", "chart", "statHighlights", "fileCard", "quoteBlock", "callout"):
        assert t in targets
    assert d.count_in(chart, "High") == 1
    assert d.replace_in(chart, "High", "Strong", None) == 1
    assert chart["attrs"]["data"]["labels"] == ["Low", "Strong"]
    stats = _node(page, "statHighlights")
    assert d.replace_in(stats, "learners", "students", None) == 1 and stats["attrs"]["items"][0]["description"] == "of students"
    compare = _node(page, "imageCompare")
    assert d.replace_in(compare, "Summer", "June", None) == 1
    gallery = _node(page, "gallery")
    assert d.replace_in(gallery, "leaf", "frond", None) == 1


def test_editing_new_blocks():
    page = plus_page()
    ed = d.Editor(page)
    assert ed.set_text([11, 1], [d.text_node("Practice more")], "Practice more") == "taskItem"
    assert ed.set_text([17], [d.text_node("One"), {"type": "hardBreak"}, d.text_node("Two")], "") == "quoteBlock"
    assert [d.inline_text(c) for c in page["content"][17]["content"]] == ["One", "Two"]
    t, before = ed.set_attrs([4], {"type": "question"})
    assert page["content"][4]["attrs"]["type"] == "info" and page["content"][4]["attrs"]["kind"] == "question"
    with pytest.raises(d.DocError, match="file card"):
        ed.set_attrs([16], {"blockObject": BLOCK_OBJECT})
    with pytest.raises(d.DocError, match="columns must be one of 2, 3, 4"):
        ed.set_attrs([12], {"images": [{"url": "https://x.org/a.png", "alt": "a"}], "columns": 5})
    ed.delete([6, 1])  # a tabs block keeps at least two tabs
    with pytest.raises(d.DocError, match="at least 2 of tabItem"):
        ed.check()


# ─── Markdown ────────────────────────────────────────────────────────────────


def test_code_block_options_round_trip():
    code = _node(plus_page(), "codeBlock")
    lines = md.render_block(code, [0])
    assert lines[0] == "```python {lines wrap highlight=2,4-6}"
    back = md.convert("\n".join(lines)).doc["content"][0]
    assert back["attrs"] == {"language": "python", "showLineNumbers": True, "wrap": True, "highlightLines": "2,4-6"}
    assert md.code_options("```js {highlight=x lines}") == {"showLineNumbers": True}
    assert md.code_options("```js") == {}
    plain = md.convert("```{wrap}\nx\n```").doc["content"][0]
    assert plain["attrs"] == {"language": None, "wrap": True}


def test_new_blocks_render_as_kept_comments_with_readable_text():
    page = plus_page()
    text = md.doc_to_markdown(page)
    assert "<!-- block [1] paragraph\nEnergy is $E=mc^2$ here." in text
    assert "## Photosynthesis" in text
    assert "<!-- block [2] tableOfContents\nTable of contents:\n- On this page" in text
    assert "<!-- block [3] table\nTable:\nTeam progress\nTask | Status | Progress" in text
    assert '<!-- block [4] callout\nCallout (note) "Remember":\nLight is energy.' in text
    assert "Tabs, 2 sections:\n1. Light\n   Light reactions.\n2. Dark" in text
    assert "Columns, 2 columns:" in text and "Accordion, 1 sections:\n1. Why green?" in text
    assert "Timeline, 2 sections:\n1. Step 1 Absorb" in text
    assert "Checklist:\n- [x] Read\n- [ ] Practice Twice" in text.replace("Practice\nTwice", "Practice Twice")
    assert "Chart (line):\n- Growth" in text and "File:\n- Worksheet\n- Print it.\n- https://example.org/sheet.pdf" in text
    assert "Key takeaways:\nRemember this" in text and "Quote:\nIt clicked." in text
    assert "Buttons:\nGo" in text
    toggle = md.render_block({"type": "toggleBlock", "attrs": {"summary": "Answer"}, "content": [p("42")]}, [0])
    assert toggle[1:3] == ["Toggle: Answer", "42"]
    # Writing it back keeps every block as it was.
    kept = md.convert(text, keep_blocks=True).doc["content"]
    assert [n.get("node_type") for n in kept if n["type"] == md.KEEP][:4] == ["paragraph", "tableOfContents", "table", "callout"]


def test_plain_tables_callouts_and_text_stay_markdown():
    plain_table = {"type": "table", "attrs": {"variant": "default", "caption": None, "totals": "none", "sortable": False},
                   "content": [{"type": "tableRow", "content": [
                       {"type": "tableHeader", "attrs": {"cellType": "text", "align": None}, "content": [p("A")]}]}]}
    assert md.render_block(plain_table, [0])[0] == "| A |"
    assert md.is_prose(plain_table) and not md.has_plus_attrs(plain_table)
    callout = {"type": "callout", "attrs": {"type": "tip", "title": "", "collapsible": False, "defaultOpen": True, "tone": None, "kind": None},
               "content": [p("x")]}
    assert md.render_block(callout, [0])[0] == "> [!TIP]" and md.is_prose(callout)
    assert not md.is_prose(TABLE) and not md.is_prose(_node(plus_page(), "callout"))
    assert not md.is_prose(plus_page()["content"][1])
    assert md.has_plus_attrs({"type": "paragraph"}) is False
    math_cell = {"type": "table", "content": [{"type": "tableRow", "content": [{"type": "tableCell", "content": [
        {"type": "paragraph", "content": [{"type": "inlineMath", "attrs": {"latex": "x"}}]}]}]}]}
    assert md.has_plus_attrs(math_cell) and md.render_block(math_cell, [2])[0] == "<!-- block [2] table"
    aligned = {"type": "paragraph", "attrs": {"textAlign": "center"}, "content": [{"type": "text", "text": "Hi"}]}
    assert md.render_block(aligned, [0]) == ["Hi"]
    assert md.inline_markdown([{"type": "text", "text": "a", "marks": [{"type": "bold"}]}, {"type": "inlineMath", "attrs": {"latex": "x"}}]) == "**a**$x$"


# ─── typed blocks ────────────────────────────────────────────────────────────


def build(*blocks, members=None) -> list[dict]:
    return bs.to_converted(bs.parse_blocks(list(blocks)), members or {}).doc["content"]


def test_typed_layout_blocks():
    tabs, columns, accordion, timeline, takeaways = build(
        {"type": "tabs", "variant": "boxed", "tabs": [{"title": "A", "blocks": [{"type": "paragraph", "text": "a"}]},
                                                      {"title": "B", "blocks": [{"type": "user", "member": "maya"}]}]},
        {"type": "columns", "layout": "2-1", "gap": "sm", "vertical_align": "center",
         "columns": [{"blocks": [{"type": "divider"}]}, {"blocks": [{"type": "divider"}]}]},
        {"type": "accordion", "single": False, "items": [{"summary": "S", "open": True, "blocks": [{"type": "divider"}]}]},
        {"type": "timeline", "variant": "timeline", "steps": [
            {"title": "1990", "label": "Start", "text": "Began.", "tone": "teal", "icon": "flag",
             "blocks": [{"type": "divider"}]},
            {"title": "2000"}]},
        {"type": "key_takeaways", "title": "Sum up", "icon": "star", "points": ["One"], "blocks": [{"type": "divider"}]},
        members={"maya": 3},
    )
    assert tabs["attrs"]["variant"] == "boxed" and tabs["attrs"]["blockId"].startswith("lh_")
    assert tabs["content"][1]["content"][0] == {"type": "blockUser", "attrs": {"user_id": 3, "layout": "card"}}
    assert columns["attrs"] == {"layout": "2-1", "gap": "sm", "stackOnMobile": True, "verticalAlign": "center"}
    assert accordion["content"][0]["attrs"] == {"summary": "S", "defaultOpen": True} and accordion["attrs"]["single"] is False
    first, second = timeline["content"]
    assert first["attrs"] == {"title": "1990", "label": "Start", "tone": "teal", "icon": "flag"}
    assert [c["type"] for c in first["content"]] == ["paragraph", "horizontalRule"]
    assert second["content"] == [{"type": "paragraph"}]
    assert takeaways["attrs"] == {"title": "Sum up", "tone": "amber", "icon": "star"}
    assert [c["type"] for c in takeaways["content"]] == ["bulletList", "horizontalRule"]
    three = build({"type": "columns", "columns": [{"blocks": [{"type": "divider"}]}] * 3})[0]
    assert three["attrs"]["layout"] == "1-1-1"
    keys = bs.member_keys(bs.parse_blocks([
        {"type": "tabs", "tabs": [{"title": "a", "blocks": [{"type": "user", "member": "Ann"}]}, {"title": "b", "blocks": [{"type": "divider"}]}]},
        {"type": "key_takeaways", "blocks": [{"type": "user", "member": "bo"}]},
    ]))
    assert keys == {"ann", "bo"}


def test_typed_data_blocks():
    checklist, gallery, compare, chart, stats, file_card, quote = build(
        {"type": "checklist", "items": ["Read **it**"], "learner_can_check": False},
        {"type": "gallery", "layout": "masonry", "columns": 4, "images": [
            {"url": "https://x.org/a.png", "alt": "A", "caption": "Cap"}, {"url": "https://x.org/b.png", "alt": "B"}]},
        {"type": "image_compare", "before": {"url": "https://x.org/a.png", "label": "Old", "alt": "old"},
         "after": {"url": "https://x.org/b.png"}, "start": 30, "orientation": "vertical"},
        {"type": "chart", "chart": "pie", "labels": ["a", "b"], "series": [{"name": "s", "values": [1, 2.5], "tone": "red"}]},
        {"type": "stat_highlights", "stats": [{"value": "9", "label": "L", "description": "D", "prefix": "$", "suffix": "k", "tone": "rose"}]},
        {"type": "file_card", "url": "https://x.org/files/My%20Notes.docx?dl=1", "size_bytes": 10},
        {"type": "quote", "text": "One.\n\nTwo.", "author": "Ann", "role": "Chef", "variant": "highlight"},
    )
    assert checklist["attrs"]["learnerCanCheck"] is False and checklist["content"][0]["attrs"] == {"checked": False}
    assert gallery["attrs"]["layout"] == "masonry" and gallery["attrs"]["images"][0]["caption"] == "Cap"
    assert "caption" not in gallery["attrs"]["images"][1]
    assert compare["attrs"]["before"]["alt"] == "old" and compare["attrs"]["after"] == {"url": "https://x.org/b.png", "label": ""}
    assert chart["attrs"]["type"] == "pie" and chart["attrs"]["data"]["series"][0]["values"] == [1, 2.5]
    assert isinstance(chart["attrs"]["data"]["series"][0]["values"][0], int)
    assert stats["attrs"]["columns"] == 2 and stats["attrs"]["items"][0]["prefix"] == "$"
    assert file_card["attrs"]["name"] == "My Notes.docx" and file_card["attrs"]["fileType"] == "doc"
    assert file_card["attrs"]["sizeBytes"] == 10
    assert [d.inline_text(x) for x in quote["content"]] == ["One.", "Two."] and quote["attrs"]["role"] == "Chef"
    assert bs._file_type("archive") == "file" and bs._file_type("notes.unknown") == "file"
    named = build({"type": "file_card", "url": "https://x.org/a", "name": "Slides.pptx"})[0]
    assert named["attrs"]["fileType"] == "slides"


def test_typed_table_quiz_callout_code_button_options():
    table, quiz, callout, code, button = build(
        {"type": "table", "header": ["Task", "Done"], "rows": [["Write", "yes"]], "column_types": ["text", "checkbox"],
         "variant": "cards", "caption": "Plan", "sortable": True, "sticky_header": True, "compact": True,
         "header_column": True, "totals": "sum"},
        {"type": "quiz", "pass_mark": 80, "show_explanations": False, "questions": [
            {"text": "T?", "type": "true_false", "answer": False, "explanation": "No."},
            {"text": "Name?", "type": "short_answer", "accepted_answers": [" chlorophyll "], "accent_insensitive": True},
            {"text": "2+2?", "type": "numeric", "correct_value": 4, "tolerance": 0.1},
            {"text": "Pick", "options": [{"text": "a", "correct": True}, {"text": "b"}]}]},
        {"type": "callout", "style": "example", "title": "Worked example", "collapsible": True, "text": "x"},
        {"type": "code", "code": "x", "line_numbers": True, "highlight_lines": "1", "wrap": True},
        {"type": "button", "label": "Go", "url": "https://x.org", "variant": "soft", "size": "sm"},
    )
    assert table["attrs"] == {"variant": "cards", "caption": "Plan", "sortable": True, "stickyHeader": True,
                              "compact": True, "headerColumn": True, "totals": "sum"}
    assert table["content"][1]["content"][1]["attrs"] == {"cellType": "checkbox"}
    assert "attrs" not in table["content"][1]["content"][0] and "attrs" not in table["content"][0]["content"][1]
    assert quiz["attrs"]["settings"] == {"passMark": 80, "showExplanations": False}
    tf, sa, num, mc = quiz["attrs"]["questions"]
    assert tf["type"] == "true_false" and tf["answers"][1]["correct"] is True
    assert sa["accepted_answers"] == ["chlorophyll"] and num["tolerance"] == 0.1 and mc["type"] == "multiple_choice"
    assert callout["attrs"]["type"] == "tip" and callout["attrs"]["kind"] == "example" and callout["attrs"]["collapsible"]
    assert code["attrs"] == {"language": None, "showLineNumbers": True, "highlightLines": "1", "wrap": True}
    assert button["attrs"]["variant"] == "soft" and button["attrs"]["size"] == "sm"
    plain = build({"type": "table", "header": ["a"]}, {"type": "quiz", "questions": [
        {"text": "Q", "options": [{"text": "a", "correct": True}, {"text": "b"}]}]})
    assert "attrs" not in plain[0] and "settings" not in plain[1]["attrs"]


@pytest.mark.parametrize("block,problem", [
    ({"type": "callout", "text": "x", "collapsible": True}, "needs a title"),
    ({"type": "table", "header": ["a", "b"], "column_types": ["text"]}, "one type per column"),
    ({"type": "quiz", "questions": [{"text": "Q", "type": "numeric"}]}, "give correct_value"),
    ({"type": "quiz", "questions": [{"text": "Q", "type": "true_false", "answer": True, "correct_value": 1}]}, "correct_value is for another"),
    ({"type": "quiz", "questions": [{"text": "Q"}]}, "give options"),
    ({"type": "columns", "layout": "1-1-1", "columns": [{"blocks": [{"type": "divider"}]}] * 2}, "is for 3 columns"),
    ({"type": "key_takeaways"}, "needs points or blocks"),
    ({"type": "chart", "labels": ["a"], "series": [{"name": "s", "values": [1, 2]}]}, "2 values for 1 labels"),
    ({"type": "tabs", "tabs": [{"title": "a", "blocks": [{"type": "image", "url": "https://x.org/a.png", "alt": "a"}]},
                               {"title": "b", "blocks": [{"type": "divider"}]}]}, "not inside another block"),
])
def test_typed_block_errors(block, problem):
    with pytest.raises(bs.BlockError, match=problem):
        bs.to_converted(bs.parse_blocks([block]), {})


def test_layout_blocks_nest_at_most_max_depth():
    deep = {"type": "divider"}
    for _ in range(4):
        deep = {"type": "accordion", "items": [{"summary": "s", "blocks": [deep]}]}
    with pytest.raises(bs.BlockError, match="nest at most"):
        bs.to_converted(bs.parse_blocks([deep]))


# ─── catalog, quality and audit ──────────────────────────────────────────────


def test_catalog_lists_the_new_blocks():
    for name in content_blocks.LAYOUT_BLOCKS:
        assert name in content_blocks.CATALOG
    for name in ("tabs", "chart", "checklist", "quote", "image_compare"):
        assert name in bs.catalog()["types"] and bs.catalog(name)["notes"]


def test_learner_preview_of_new_blocks():
    page = plus_page()
    lines = [line for n in page["content"] for line in course_quality._learner_lines(n)]
    joined = "\n".join(lines)
    assert "**[Light]**" in joined and "**[Dark]** (tab)" in joined and "Calvin cycle." not in joined
    assert "1. **Step 1 Absorb**" in joined and "   Light hits." in joined
    assert "- [ ] Read" in joined and "> It clicked." in joined and "> — Sam, Designer" in joined
    assert "[Go]" in joined and "[On this page: links to the page's headings]" in joined
    assert "[Chart]" in joined and "- Growth" in joined and "**Remember this**" in joined
    assert "   [ type an answer ]" in joined and "   [ type a number ]" in joined
    assert "▸ Why green? (collapsed)" in joined and "Plants" in joined
    unnumbered = {"type": "timeline", "attrs": {"numbered": False}, "content": [
        {"type": "timelineItem", "attrs": {"title": "A"}, "content": [p("x")]}]}
    assert course_quality._learner_lines(unnumbered)[0] == "- **A**"
    assert course_quality._learner_lines({"type": "quoteBlock", "attrs": {}, "content": [p("q")]}) == ["> q"]
    assert course_quality._learner_lines({"type": "tabs", "content": [{"type": "tabItem", "content": [p("x")]}]})[0] == "**[Tab 1]**"
    assert course_quality._learner_lines({"type": "keyTakeaways", "content": [p("x")]})[0] == "**Key takeaways**"


def test_gallery_alt_text_is_an_accessibility_issue():
    issues: list[dict] = []
    course_quality._a11y(plus_page(), {}, issues)
    assert not any(i["code"] == "image_no_alt" for i in issues)
    page = {"type": "doc", "content": [{"type": "gallery", "attrs": {"images": [{"url": "https://x.org/a.png"}]}}]}
    course_quality._a11y(page, {}, issues)
    assert [i["code"] for i in issues] == ["image_no_alt"]


def _audit(page: dict, links: list | None = None):
    issues = course_audit._Issues()
    stats: Counter = Counter()
    course_audit._check_page(page, {}, issues, stats, links)
    return [i[2]["code"] for i in issues.items], stats


def test_audit_reads_typed_quizzes_and_media_blocks():
    links: list = []
    codes, stats = _audit(plus_page(), links)
    assert "quiz_no_correct" not in codes and "quiz_few_options" not in codes and "media_missing" not in codes
    assert stats["media_blocks"] == 5  # gallery, comparison, chart, file card, image
    assert ("https://example.org/sheet.pdf", {}, [16]) in links
    broken = {"type": "doc", "content": [
        {"type": "blockQuiz", "attrs": {"questions": [
            {"question": "a", "type": "short_answer", "accepted_answers": [" "]},
            {"question": "b", "type": "numeric", "correct_value": True},
            {"question": "c", "type": "numeric", "correct_value": 3}]}},
        {"type": "gallery", "attrs": {"images": [{"url": "nope"}]}},
        {"type": "imageCompare", "attrs": {"before": {"url": "https://x.org/a.png"}, "after": {}}},
        {"type": "fileCard", "attrs": {"name": "x"}},
        {"type": "chart", "attrs": {"data": {"labels": ["a"], "series": [{"values": []}]}}},
    ]}
    codes, _stats = _audit(broken)
    assert codes.count("quiz_no_correct") == 2 and codes.count("media_missing") == 3 and "chart_empty" in codes


def test_rich_block_counts_include_new_blocks():
    counts = courses._rich_blocks(plus_page())
    assert counts["tabs"] == 1 and counts["chart"] == 1 and counts["taskList"] == 1 and counts["blockQuiz"] == 1
