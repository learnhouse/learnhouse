"""Segments of an activity page: extraction, write-back preserving the
structure, and re-alignment of an existing translation. Uses real pages
(the Blocks QA course of the local demo) as fixtures."""

import copy
import json
import re
from pathlib import Path

import pytest

from src.services.courses.translations import content as c

PAGES = json.loads((Path(__file__).parents[2] / "fixtures" / "translation_pages.json").read_text())


def _shape(node):
    """Structure without text: types, attribute keys, marks (comments dropped)."""
    if not isinstance(node, dict):
        return None
    return (
        node.get("type"),
        tuple(sorted((node.get("attrs") or {}).keys())),
        tuple(m.get("type") for m in node.get("marks") or [] if m.get("type") not in c.DROPPED_MARKS),
        tuple(_shape(k) for k in node.get("content") or []),
    )


def _ids(node, out):
    """Every id-like attribute (quiz/answer/scenario ids, block uuids)."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k.endswith("_id") or k.endswith("Id") or k in ("id", "block_uuid", "blockUuid", "correct"):
                out.append((k, json.dumps(v, sort_keys=True)))
            _ids(v, out)
    elif isinstance(node, list):
        for v in node:
            _ids(v, out)
    return out


def _fake_translate(segments):
    """Uppercase every text outside tags (a 'translation' we can check)."""
    out = {}
    for s in segments:
        if s.kind == "attr":
            out[s.id] = "FR:" + s.text
        else:
            out[s.id] = re.sub(r"(^|>)([^<]*)", lambda m: m.group(1) + m.group(2).upper(), s.text)
    return out


@pytest.mark.parametrize("uuid", list(PAGES))
def test_real_pages_keep_structure_ids_and_marks(uuid):
    source = PAGES[uuid]["content"]
    before = copy.deepcopy(source)
    segments = c.iter_segments(source)
    assert segments, "a real page has text"
    doc, report = c.apply_segments(source, _fake_translate(segments))
    assert source == before, "the source is never modified"
    assert report["applied"] == len(segments) and not report["missing"] and not report["warnings"]
    assert _shape(doc) == _shape(source)
    assert _ids(doc, []) == _ids(c.strip_dropped_marks(copy.deepcopy(source)), [])
    assert "comment" not in json.dumps(doc), "translations start without comment marks"
    # The translation reads back as the same segments.
    assert c.current_translations(source, doc) == _fake_translate(segments)


def test_nothing_untranslatable_is_extracted():
    doc = {"type": "doc", "content": [
        {"type": "codeBlock", "attrs": {"language": "py"}, "content": [{"type": "text", "text": "print('hi')"}]},
        {"type": "blockMathEquation", "attrs": {"math_equation": "x^2"}},
        {"type": "paragraph", "content": [{"type": "text", "text": "12 345 !"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "https://example.com/a"}]},
        {"type": "blockImage", "attrs": {"alt": "   ", "caption": "https://x.y/z.png"}},
    ]}
    assert c.iter_segments(doc) == []
    assert c.iter_segments("not a doc") == []


def test_inline_tags_for_marks_and_verbatim_parts():
    link = {"type": "link", "attrs": {"href": "https://a.b"}}
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "Open "},
        {"type": "text", "text": "the docs", "marks": [link, {"type": "comment", "attrs": {"threadId": "t"}}]},
        {"type": "text", "text": " and run "},
        {"type": "text", "text": "npm i", "marks": [{"type": "code"}]},
        {"type": "hardBreak"},
        {"type": "text", "text": "Hello {{user.first_name}}, see https://x.io and $a^2$."},
        {"type": "dynamicVariable", "attrs": {"path": "course.name"}},
    ]}]}
    [seg] = c.iter_segments(doc)
    assert seg.text == "Open <m1>the docs</m1> and run <x1/><x2/>Hello <x3/>, see <x4/> and <x5/>.<x6/>"
    assert seg.public()["tags"]
    # A translation that reorders words and moves tags keeps marks and atoms.
    out, report = c.apply_segments(doc, {seg.id: "<x1/><x2/>Ouvrez <m1>la doc</m1> puis <x3/> <x4/> <x5/> <x6/>"})
    kids = out["content"][0]["content"]
    assert {"type": "text", "text": "la doc", "marks": [link]} in kids
    assert {"type": "text", "text": "npm i", "marks": [{"type": "code"}]} in kids
    assert {"type": "dynamicVariable", "attrs": {"path": "course.name"}} in kids
    assert any("{{user.first_name}}" in (k.get("text") or "") for k in kids)
    assert not report["warnings"]


def test_bad_tags_are_tolerated_and_reported():
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "Hi "},
        {"type": "text", "text": "bold", "marks": [{"type": "bold"}]},
        {"type": "hardBreak"},
    ]}]}
    [seg] = c.iter_segments(doc)
    # Lost atom, unknown tags, unbalanced/unclosed marks: text kept, atom re-added.
    out, report = c.apply_segments(doc, {seg.id: "Salut </m1><m9>x</m9><x7/><x1/><x1/> <m1>gras"})
    kids = out["content"][0]["content"]
    assert kids[-1] == {"type": "hardBreak"} or {"type": "hardBreak"} in kids
    warns = report["warnings"][seg.id]
    assert {"unbalanced_tag:m1", "unknown_tag:m9", "unknown_or_repeated_tag:x7", "unclosed_tags"} <= set(warns)
    out2, report2 = c.apply_segments(doc, {seg.id: "Salut <m1>gras</m1>"})
    assert "missing_tag:x1" in report2["warnings"][seg.id]
    assert out2["content"][0]["content"][-1] == {"type": "hardBreak"}


def test_missing_and_empty_translations_keep_the_source():
    doc = {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "One"}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "Two"}]},
        {"type": "paragraph", "content": [{"type": "hardBreak"}, {"type": "text", "text": "Three"}]},
    ]}
    out, report = c.apply_segments(doc, {"s0": "Un", "s1": "  ", "s2": "<x1/>"})
    assert out["content"][0]["content"][0]["text"] == "Un"
    assert out["content"][1]["content"][0]["text"] == "Two"
    assert report["missing"] == ["s1"]
    out, report = c.apply_segments(None, {})
    assert out == {"type": "doc", "content": []}


def test_text_attributes_of_blocks_and_marks():
    note = {"type": "definition", "attrs": {"note": "A small shop"}}
    doc = {"type": "doc", "content": [
        {"type": "blockQuiz", "attrs": {"questions": [{"question_id": "q1", "question": "Why?", "explanation": "",
                                                        "answers": [{"answer_id": "a1", "answer": "Because", "correct": True, "feedback": "Yes"}]}]}},
        {"type": "scenarios", "attrs": {"title": "Case", "scenarios": [{"id": "1", "text": "Start", "options": [{"id": "o", "text": "Go"}]}]}},
        {"type": "blockCode", "attrs": {"description": "Sum it", "hints": ["Use +", 3], "starterCode": "x=1"}},
        {"type": "blockVideo", "attrs": {"caption": "Intro", "chapters": [{"time": 3, "title": "Part 1"}]}},
        {"type": "paragraph", "content": [{"type": "text", "text": "Etsy", "marks": [note]}, {"type": "text", "text": " rocks"}]},
    ]}
    segs = c.iter_segments(doc)
    texts = [s.text for s in segs]
    assert texts == ["Why?", "Because", "Yes", "Case", "Start", "Go", "Sum it", "Use +", "Intro", "Part 1",
                     "<m1>Etsy</m1> rocks", "A small shop"]
    out, report = c.apply_segments(doc, {s.id: f"T({s.text})" for s in segs if s.kind == "attr"} | {
        segs[10].id: "<m1>Etsy</m1> déchire"})
    q = out["content"][0]["attrs"]["questions"][0]
    assert q["question"] == "T(Why?)" and q["answers"][0]["correct"] is True and q["answers"][0]["answer_id"] == "a1"
    assert out["content"][2]["attrs"]["starterCode"] == "x=1"
    assert out["content"][2]["attrs"]["hints"] == ["T(Use +)", 3]
    para = out["content"][4]["content"]
    assert para[0]["marks"][0]["attrs"]["note"] == "T(A small shop)"
    assert para[1]["text"] == " déchire"
    assert doc["content"][4]["content"][0]["marks"][0]["attrs"]["note"] == "A small shop"


def test_hashes_follow_text_only():
    a = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hello", "marks": [{"type": "bold"}]}]}]}
    b = copy.deepcopy(a)
    b["content"][0]["content"][0]["marks"] = [{"type": "italic"}]
    assert c.segments_hash(a) == c.segments_hash(b)
    b["content"][0]["content"][0]["text"] = "Bye"
    assert c.segments_hash(a) != c.segments_hash(b)
    assert c.segments_hash(a, extra="x") != c.segments_hash(a)
    assert c.text_hash("a", None) == c.text_hash("a", None) != c.text_hash("b", None)


def test_current_translations_needs_the_same_structure():
    src = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "A"}]}]}
    other = {"type": "doc", "content": [{"type": "heading", "content": [{"type": "text", "text": "A"}]}]}
    more = {"type": "doc", "content": src["content"] * 2}
    assert c.current_translations(src, other) == {}
    assert c.current_translations(src, more) == {}
    # Tags are renumbered onto the source's numbering; foreign ones dropped.
    src2 = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "a", "marks": [{"type": "bold"}]},
        {"type": "text", "text": "b", "marks": [{"type": "italic"}]},
    ]}]}
    tr = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "B", "marks": [{"type": "italic"}]},
        {"type": "text", "text": "A", "marks": [{"type": "bold"}]},
        {"type": "text", "text": "C", "marks": [{"type": "underline"}]},
    ]}]}
    assert c.current_translations(src2, tr) == {"s0": "<m2>B</m2><m1>A</m1>C"}


def test_escaping_of_text_that_looks_like_tags():
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Use <m1> literally"}]}]}
    [seg] = c.iter_segments(doc)
    assert "‹m1>" in seg.text
    out, _ = c.apply_segments(doc, {seg.id: seg.text})
    assert out["content"][0]["content"][0]["text"] == "Use <m1> literally"


def test_strip_dropped_marks_and_report_helper():
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "x", "marks": [{"type": "comment"}]},
        {"type": "text", "text": "y", "marks": [{"type": "comment"}, {"type": "bold"}]},
    ]}]}
    out = c.strip_dropped_marks(doc)
    assert "marks" not in out["content"][0]["content"][0]
    assert out["content"][0]["content"][1]["marks"] == [{"type": "bold"}]
    assert c.strip_dropped_marks("x") == "x"
    assert c.translation_report_ok({"missing": [], "warnings": {}})
    assert not c.translation_report_ok({"missing": ["s1"]})
    assert c.extract_segments(doc)[0]["id"] == "s0"
    assert c.seg_marks_for([], ()) == []


def test_edge_cases_of_the_walk():
    bold = [{"type": "bold"}]
    doc = {"type": "doc", "content": [
        "junk",
        {"type": "paragraph", "content": [{"type": "text", "text": "See https://a.io now", "marks": bold}]},
        {"type": "paragraph", "content": [{"type": "text", "text": "Plain"}]},
    ]}
    segs = c.iter_segments(doc)
    assert segs[0].text == "<m1>See <x1/> now</m1>"
    assert segs[0].atoms[1] == {"type": "text", "text": "https://a.io", "marks": bold}
    out, report = c.apply_segments(doc, {"s0": "<m1>Voir <x1/></m1>", "s1": "<m9></m9>"})
    assert report["missing"] == ["s1"]
    assert out["content"][2]["content"][0]["text"] == "Plain"
    deep = {"type": "doc", "content": []}
    node = deep
    for _ in range(c.MAX_DEPTH + 5):
        child = {"type": "blockquote", "content": []}
        node["content"].append(child)
        node = child
    node["content"].append({"type": "paragraph", "content": [{"type": "text", "text": "too deep"}]})
    assert c.iter_segments(deep) == []
