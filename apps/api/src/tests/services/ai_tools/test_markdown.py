"""Markdown to page documents and back (src/services/ai/tools/markdown.py)."""

import gc
import time

import pytest
from fastapi import HTTPException

from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import markdown as md
from src.services.ai.tools.markdown import doc_to_markdown, inline, markdown_to_doc


def types_of(doc):
    return [n["type"] for n in doc["content"]]


def marks_by_text(nodes):
    return {n["text"]: [m["type"] for m in n.get("marks", [])] for n in nodes if n["type"] == "text"}


def test_inline_marks():
    nodes = inline("a **b** *c* `d` ~~e~~ [f](https://x.test) <https://y.test> _g_")
    marks = marks_by_text(nodes)
    assert marks["b"] == ["bold"] and marks["c"] == ["italic"] and marks["d"] == ["code"]
    assert marks["e"] == ["strike"] and marks["f"] == ["link"] and marks["https://y.test"] == ["link"]
    assert marks["g"] == ["italic"]
    nested = inline("**bold _both_**")
    assert nested[-1]["marks"] == [{"type": "bold"}, {"type": "italic"}]
    assert inline("***x***")[0]["marks"] == [{"type": "bold"}, {"type": "italic"}]
    assert inline("snake_case_name stays") == [{"type": "text", "text": "snake_case_name stays"}]
    assert inline("\\*not\\* emphasis") == [{"type": "text", "text": "*not* emphasis"}]
    assert inline("**unclosed") == [{"type": "text", "text": "**unclosed"}]
    # A link label keeps its own formatting; the code mark never combines.
    label = inline("[**bold** `code`](https://x.test)")
    assert label[0]["marks"] == [{"type": "bold"}, {"type": "link", "attrs": {"href": "https://x.test"}}]
    assert label[-1]["marks"] == [{"type": "code"}]


def test_links_only_web():
    for bad in ("[x](javascript:alert(1))", "[x](data:text/html,hi)", "[x](/relative)", "[x](ftp://h/f)"):
        nodes = inline(bad)
        assert all(not n.get("marks") for n in nodes), bad
        assert "".join(n["text"] for n in nodes) == "x"
    mail = inline("[write us](mailto:team@school.test)")
    assert mail == [{"type": "text", "text": "write us (team@school.test)"}]
    wiki = inline("[w](https://en.wikipedia.org/wiki/Set_(mathematics))")
    assert wiki[0]["marks"][0]["attrs"]["href"] == "https://en.wikipedia.org/wiki/Set_(mathematics)"
    titled = inline('[t](https://x.test "Title")')
    assert titled[0]["marks"][0]["attrs"]["href"] == "https://x.test"


def test_images_become_links_with_a_note():
    converted = md.convert("![A diagram](https://img.test/d.png)")
    para = converted.doc["content"][0]
    assert para["content"] == [
        {"type": "text", "text": "A diagram", "marks": [{"type": "link", "attrs": {"href": "https://img.test/d.png"}}]}
    ]
    assert any("add_media_block" in n for n in converted.notes)


def test_line_breaks():
    para = markdown_to_doc("one\ntwo  \nthree\\\nfour")["content"][0]
    assert para["content"] == [
        {"type": "text", "text": "one two"},
        {"type": "hardBreak"},
        {"type": "text", "text": "three"},
        {"type": "hardBreak"},
        {"type": "text", "text": "four"},
    ]


def test_blocks():
    doc = markdown_to_doc(
        "# Title #\n\nPara line one\nline two\n\n- a\n  - a1\n    continued\n- b\n\n3. c\n4. d\n\n"
        "> [!CAUTION] careful\n> more\n\n> quote\n\n| h1 | h2 |\n|---|:-:|\n| x |\n\n```js\nlet a\n```\n\n"
        "~~~\n~~~\n\n***\n####### not a heading\n\nSetext\n===\n\n$$\nE = mc^2\n$$\n\n$$ a+b $$"
    )
    assert types_of(doc) == [
        "heading", "paragraph", "bulletList", "orderedList", "callout", "blockquote", "table",
        "codeBlock", "codeBlock", "horizontalRule", "paragraph", "heading", "blockMathEquation",
        "blockMathEquation",
    ]
    nested = doc["content"][2]["content"][0]["content"][1]
    assert nested["type"] == "bulletList"
    assert nested["content"][0]["content"][0]["content"][0]["text"] == "a1 continued"
    assert doc["content"][3]["attrs"] == {"start": 3}
    callout = doc["content"][4]
    assert callout["attrs"] == {"type": "error", "dismissible": False}
    assert callout["content"][0]["type"] == "paragraph"
    table = doc["content"][6]
    assert len(table["content"]) == 2 and len(table["content"][1]["content"]) == 2
    assert table["content"][0]["content"][0]["type"] == "tableHeader"
    assert doc["content"][7]["attrs"]["language"] == "js"
    assert "content" not in doc["content"][8]
    assert doc["content"][11]["attrs"]["level"] == 1
    assert doc["content"][12]["attrs"]["math_equation"] == "E = mc^2"
    assert doc["content"][13]["attrs"]["math_equation"] == "a+b"
    assert d.strict_problems(doc) == []


def test_inline_math_stays_text():
    assert inline("costs $5 and $x^2$") == [{"type": "text", "text": "costs $5 and $x^2$"}]


def test_callouts_hold_only_paragraphs_and_lists():
    doc = markdown_to_doc("> [!TIP]\n> # Heading\n> - item\n> ```\n> code\n> ```\n> ---")
    callout = doc["content"][0]
    assert [n["type"] for n in callout["content"]] == ["paragraph", "bulletList", "paragraph"]
    assert callout["content"][0]["content"][0]["marks"] == [{"type": "bold"}]
    assert callout["content"][2]["content"][0]["marks"] == [{"type": "code"}]
    assert d.strict_problems(doc) == []
    for alert, kind in (("NOTE", "info"), ("TIP", "tip"), ("WARNING", "warning"), ("CAUTION", "error"), ("SUCCESS", "success")):
        assert markdown_to_doc(f"> [!{alert}]\n> x")["content"][0]["attrs"]["type"] == kind
    node, _notes = md.callout("warning", "Careful **now**\n\n- a")
    assert node["attrs"]["type"] == "warning"
    assert [n["type"] for n in node["content"]] == ["paragraph", "bulletList"]


def test_edge_cases():
    assert markdown_to_doc("") == {"type": "doc", "content": [{"type": "paragraph"}]}
    assert types_of(markdown_to_doc("- a\n1. b")) == ["bulletList", "orderedList"]
    assert types_of(markdown_to_doc("   - a")) == ["bulletList"]
    assert types_of(markdown_to_doc("a\r\nb\r\rc")) == ["paragraph", "paragraph"]
    # An unterminated comment is text, not a black hole for the rest of the page.
    assert types_of(markdown_to_doc("<!-- oops\n\n# Kept")) == ["paragraph", "heading"]
    # Plain comments are dropped.
    assert types_of(markdown_to_doc("<!-- hidden -->\n\ntext")) == ["paragraph"]
    loose = markdown_to_doc("- a\n\n  more\n- b")["content"][0]
    assert [n["type"] for n in loose["content"][0]["content"]] == ["paragraph", "paragraph"]
    fenced = markdown_to_doc("- step\n  ```py\n  x = 1\n  ```")["content"][0]
    assert fenced["content"][0]["content"][1]["type"] == "codeBlock"


def test_size_cap():
    with pytest.raises(HTTPException) as e:
        markdown_to_doc("a" * (md.MAX_CHARS + 1))
    assert e.value.status_code == 400


def test_deep_nesting_does_not_crash():
    quotes = markdown_to_doc(">" * 60000)
    depth = 0
    node = quotes["content"][0]
    while node["type"] == "blockquote":
        node = node["content"][0]
        depth += 1
    assert depth == md.MAX_QUOTE_DEPTH
    lists = markdown_to_doc("\n".join(" " * (2 * i) + "- x" for i in range(200)))
    depth = 0
    node = lists["content"][0]
    while True:
        depth += 1
        last = node["content"][-1]["content"][-1]
        if last["type"] != "bulletList":
            break
        node = last
    assert depth == md.MAX_LIST_DEPTH
    assert d.strict_problems(quotes) == [] and d.strict_problems(lists) == []


ADVERSARIAL = {
    "backticks": "`a` " * 15000,
    "stars": "*a " * 20000,
    "bold": "**a" * 20000,
    "underscores": "_a " * 20000,
    "tildes": "~~a" * 20000,
    "brackets": "[a](" * 15000,
    "open_brackets": "[" * 60000,
    "autolinks": "<https://a" * 6000,
    "fence": "```" + "a" * 59990 + "`",
    "comments": "<!--\n" * 12000,
    "heading_hashes": "# " + " #" * 29999,
    "mixed": "**_~~`[x](" * 6000,
    "table": "a|b\n|-|-|\n" + "|x|y|\n" * 9000,
}


def _convert_time(text: str) -> float:
    """Best of five runs with GC paused, so a busy machine adds less noise.

    The suite runs in parallel, so a worker can lose the CPU for a run; one
    clean run out of five is enough to see the real growth rate.
    """
    best = float("inf")
    gc.disable()
    try:
        for _ in range(5):
            start = time.perf_counter()
            doc_to_markdown(markdown_to_doc(text))
            best = min(best, time.perf_counter() - start)
    finally:
        gc.enable()
    return best


@pytest.mark.parametrize("name", list(ADVERSARIAL))
def test_linear_time(name):
    text = ADVERSARIAL[name][: md.MAX_CHARS]
    full = _convert_time(text)
    quarter = _convert_time(text[: len(text) // 4])
    # Growth, not wall clock, so a loaded CI runner does not fail it: four
    # times the input may take about four times as long, never sixteen
    # (quadratic). The old converter took about 23 s on the backtick case.
    # The floor covers inputs whose quarter is microseconds: a truncated
    # fence loses its closing backtick and takes a shortcut, so the ratio
    # alone means nothing there, and a CI runner needs ~60ms for the full one.
    assert full < 8 * quarter + 0.25, f"{name}: {quarter:.3f}s for a quarter, {full:.3f}s for all"
    assert full < 10, f"{name}: {full:.2f}s"


def test_round_trip():
    source = (
        "# Title\n\nSome **bold**, *italic*, ~~gone~~, `code` and a [link](https://x.test).\\\nNext line\n\n"
        "- one\n  - nested\n- two\n\n3. three\n4. four\n\n> [!TIP]\n> Remember\n\n> A quote\n\n"
        "| a | b |\n|---|---|\n| 1 | 2 \\| 3 |\n\n```py\nprint('x')\n```\n\n$$\nx^2\n$$\n\n---\n\n"
        "\\# not a heading, 1\\. not a list, snake_case and 2 * 3\n"
    )
    doc = markdown_to_doc(source)
    again = markdown_to_doc(doc_to_markdown(doc))
    assert again == doc


def test_rich_blocks_render_as_fences_or_comments_and_come_back():
    quiz = d.quiz_node([{"text": "Q?", "options": [{"text": "yes", "correct": True}, {"text": "no", "correct": False}]}])
    doc = {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Before"}]},
        quiz,
        {"type": "flipcard", "attrs": {"question": "Front --> trick", "answer": "Back", "color": "green"}},
        {"type": "scenarios", "attrs": {"title": "Pick --> one", "scenarios": []}},
    ]}
    text = doc_to_markdown(doc)
    assert "```quiz\nQ: Q?\n- [x] yes\n- [ ] no\n```" in text
    assert "```flipcards\ncolor: green\nFront --> trick :: Back\n```" in text
    assert "<!-- block [3] scenarios" in text and "Pick -- > one" in text  # cannot close the comment early
    converted = md.convert(text, keep_blocks=True)
    assert types_of(converted.doc) == ["paragraph", "blockQuiz", "flipcard", md.KEEP]
    assert converted.doc["content"][2]["attrs"]["color"] == "green"
    assert (converted.doc["content"][3]["path"], converted.doc["content"][3]["node_type"]) == ([3], "scenarios")
    # Without keep_blocks the comments are simply dropped; fences still parse.
    assert types_of(markdown_to_doc(text)) == ["paragraph", "blockQuiz", "flipcard"]
    assert all(md.is_prose(n) for n in doc["content"][:3]) and not md.is_prose(doc["content"][3])


def test_checklists_become_boxed_bullets():
    """The editor has no checklist block, so "- [ ]" must not show brackets."""
    doc = markdown_to_doc("- [ ] Ask about warranty\n- [x] Get three quotes\n- plain")
    out = doc_to_markdown(doc)
    assert "- ☐ Ask about warranty" in out and "- ☑ Get three quotes" in out
    assert "[ ]" not in out and "- plain" in out
    # Stable on the way back.
    assert doc_to_markdown(markdown_to_doc(out)) == out


def test_media_lines_and_fences_are_listed():
    text = (
        "![A cell](https://files.test/cell.png)\n\n"
        "```image\nurl: https://files.test/b.png\ncaption: Mitosis\nwidth: 400\nalign: left\n```\n\n"
        "```pdf\nhttps://files.test/sheet.pdf\nheight: 900\n```\n\n"
        "```audio\n![Interview](https://files.test/talk.mp3)\n```\n\n"
        "```video\nhttps://files.test/clip.mp4\n```\n\n"
        "```video\nhttps://www.youtube.com/watch?v=aqz-KE-bpKQ\n```"
    )
    out = md.convert(text, media=True)
    kinds = [(m.kind, m.url, m.caption, m.attrs) for m in out.media]
    assert kinds == [
        ("image", "https://files.test/cell.png", "A cell", {}),
        ("image", "https://files.test/b.png", "Mitosis", {"size": {"width": 400}, "alignment": "left"}),
        ("pdf", "https://files.test/sheet.pdf", "", {"pdfHeight": 900}),
        ("audio", "https://files.test/talk.mp3", "Interview", {}),
        ("video", "https://files.test/clip.mp4", "", {}),
    ]
    content = out.doc["content"]
    # each file stands in as a link until stored; a YouTube page stays an embed
    assert all(content[k] is out.media[k].node for k in range(5))
    assert content[0]["content"][0]["marks"] == [{"type": "link", "attrs": {"href": "https://files.test/cell.png"}}]
    assert content[5]["type"] == "blockEmbed"


def test_media_only_at_the_top_level_and_when_asked():
    plain = md.convert("![A cell](https://files.test/cell.png)")
    assert plain.media == [] and any("add_media_block" in n for n in plain.notes)
    nested = md.convert("- item\n\n  ```image\n  https://files.test/a.png\n  ```\n\n> ![x](https://files.test/b.png)", media=True)
    assert nested.media == [] and any("top level" in n for n in nested.notes)
    inline_image = md.convert("See ![x](https://files.test/a.png) here.", media=True)
    assert inline_image.media == []


@pytest.mark.parametrize("body, error", [
    ("", "first line"),
    ("ftp://files.test/a.png", "http(s)"),
    ("https://files.test/a.png\nhttps://files.test/b.png", "one file"),
    ("https://files.test/a.png\nwidth: 9", "width"),
    ("https://files.test/a.png\nalign: top", "align"),
])
def test_media_fence_errors(body, error):
    with pytest.raises(HTTPException) as e:
        md.convert(f"```image\n{body}\n```", media=True)
    assert error in e.value.detail and "line 1" in e.value.detail
