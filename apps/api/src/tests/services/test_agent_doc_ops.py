"""Unit tests for the pure TipTap doc operations (src/services/ai/tools/doc_ops.py)."""

import pytest

from src.services.ai.tools import doc_ops as d


def _doc():
    return {
        "type": "doc",
        "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Storage Classes"}]},
            {"type": "paragraph", "content": [
                {"type": "text", "text": "S3 offers "},
                {"type": "text", "text": "eleven nines", "marks": [{"type": "bold"}]},
                {"type": "text", "text": " of durability."},
            ]},
            {"type": "bulletList", "content": [
                {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "First point"}]}]},
                {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Second point"}]}]},
            ]},
            {"type": "callout", "attrs": {"type": "tip", "dismissible": False}, "content": [{"type": "text", "text": "Keep it private."}]},
            {"type": "blockQuiz", "attrs": {"quizId": None, "questions": [
                {"question_id": "q1", "question": "Which class is default?", "type": "multiple_choice",
                 "answers": [{"answer_id": "a1", "answer": "Standard", "correct": True}]}]}},
        ],
    }


# ─── resolve_path ───────────────────────────────────────────────────────────


def test_resolve_top_level():
    doc = _doc()
    parent, idx, node = d.resolve_path(doc, [1])
    assert idx == 1 and node["type"] == "paragraph" and parent is doc["content"]


def test_resolve_nested_list_item():
    doc = _doc()
    _parent, idx, node = d.resolve_path(doc, [2, 1])
    assert idx == 1 and node["type"] == "listItem"
    assert d.node_text(node) == "Second point"


def test_resolve_empty_path_raises():
    with pytest.raises(d.PathError):
        d.resolve_path(_doc(), [])


def test_resolve_out_of_range_raises():
    with pytest.raises(d.PathError):
        d.resolve_path(_doc(), [99])
    with pytest.raises(d.PathError):
        d.resolve_path(_doc(), [2, 9])


def test_resolve_descend_into_atom_raises():
    # index 4 is a blockQuiz (atom) — can't descend into it
    with pytest.raises(d.PathError):
        d.resolve_path(_doc(), [4, 0])


# ─── node_text / outline / preview ──────────────────────────────────────────


def test_node_text_concatenates_runs():
    doc = _doc()
    assert d.node_text(doc["content"][1]) == "S3 offers eleven nines of durability."


def test_outline_indexes_and_expands_lists():
    ol = d.outline(_doc())
    paths = [e["path"] for e in ol]
    assert [0] in paths and [4] in paths
    # list expanded to child items
    assert [2, 0] in paths and [2, 1] in paths
    heading = next(e for e in ol if e["path"] == [0])
    assert heading["type"] == "heading" and heading["level"] == 2 and heading["text"] == "Storage Classes"
    callout = next(e for e in ol if e["path"] == [3])
    assert callout["callout_type"] == "tip"
    quiz = next(e for e in ol if e["path"] == [4])
    assert "1 question" in quiz["summary"]


def test_preview_quiz_and_flipcard():
    fc = {"type": "flipcard", "attrs": {"question": "Q?", "answer": "A."}}
    assert "Q?" in d.preview(fc)["summary"]


# ─── set_text ───────────────────────────────────────────────────────────────


def test_set_text_on_paragraph_resets_to_single_run():
    node = _doc()["content"][1]
    d.set_text(node, "New text")
    assert node["content"] == [{"type": "text", "text": "New text"}]


def test_set_text_on_callout():
    node = _doc()["content"][3]
    d.set_text(node, "Updated note")
    assert d.node_text(node) == "Updated note"


def test_set_text_empty_clears_content():
    node = _doc()["content"][1]
    d.set_text(node, "")
    assert node["content"] == []


def test_set_text_rejects_atom():
    with pytest.raises(d.DocError):
        d.set_text(_doc()["content"][4], "nope")


# ─── replace_runs (mark preservation) ───────────────────────────────────────


def test_replace_runs_preserves_marks():
    node = _doc()["content"][1]
    n = d.replace_runs(node, "eleven nines", "99.999999999%")
    assert n == 1
    runs = node["content"]
    bold_run = next(r for r in runs if r["text"] == "99.999999999%")
    assert bold_run["marks"] == [{"type": "bold"}]  # mark survived the edit
    # untouched runs intact
    assert runs[0]["text"] == "S3 offers " and "marks" not in runs[0]


def test_replace_runs_within_plain_run():
    node = _doc()["content"][1]
    n = d.replace_runs(node, "durability", "resilience")
    assert n == 1 and d.node_text(node) == "S3 offers eleven nines of resilience."


def test_replace_runs_dropping_empty_run_removed():
    node = {"type": "paragraph", "content": [{"type": "text", "text": "remove-me"}]}
    d.replace_runs(node, "remove-me", "")
    assert node["content"] == []  # empty run dropped, not left as text:""


def test_replace_runs_no_match_returns_zero():
    node = _doc()["content"][1]
    assert d.replace_runs(node, "absent", "x") == 0


def test_replace_runs_descends_into_lists():
    doc = _doc()
    n = d.replace_runs(doc["content"][2], "First", "1st")
    assert n == 1 and d.node_text(doc["content"][2]).startswith("1st point")


# ─── merge_attrs ────────────────────────────────────────────────────────────


def test_merge_attrs_updates_and_removes():
    node = _doc()["content"][3]
    d.merge_attrs(node, {"type": "warning"})
    assert node["attrs"]["type"] == "warning" and node["attrs"]["dismissible"] is False
    d.merge_attrs(node, {"dismissible": None})
    assert "dismissible" not in node["attrs"]


# ─── check_anchor ───────────────────────────────────────────────────────────


def test_anchor_type_and_contains():
    node = _doc()["content"][1]
    d.check_anchor(node, {"type": "paragraph"})  # ok
    d.check_anchor(node, {"contains": "eleven nines"})  # ok (in text)
    with pytest.raises(d.PathError):
        d.check_anchor(node, {"type": "heading"})
    with pytest.raises(d.PathError):
        d.check_anchor(node, {"contains": "not here"})


def test_anchor_matches_atom_attrs_text():
    node = _doc()["content"][4]
    d.check_anchor(node, {"type": "blockQuiz", "contains": "Which class is default"})


# ─── validate_doc ───────────────────────────────────────────────────────────


def test_validate_accepts_good_doc():
    d.validate_doc(_doc())


def test_validate_rejects_envelope():
    with pytest.raises(d.DocError):
        d.validate_doc({"content": []})


def test_validate_rejects_empty_text_node():
    bad = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": ""}]}]}
    with pytest.raises(d.DocError):
        d.validate_doc(bad)


def test_validate_rejects_atom_with_children():
    bad = {"type": "doc", "content": [{"type": "blockQuiz", "attrs": {}, "content": [{"type": "text", "text": "x"}]}]}
    with pytest.raises(d.DocError):
        d.validate_doc(bad)


def test_validate_rejects_non_text_in_text_block():
    bad = {"type": "doc", "content": [{"type": "callout", "attrs": {"type": "info"}, "content": [{"type": "paragraph"}]}]}
    with pytest.raises(d.DocError):
        d.validate_doc(bad)


def test_ensure_doc_coerces_garbage():
    assert d.ensure_doc(None) == {"type": "doc", "content": []}
    assert d.ensure_doc({"foo": 1}) == {"type": "doc", "content": []}
    good = {"type": "doc", "content": [{"type": "paragraph"}]}
    assert d.ensure_doc(good) is good
