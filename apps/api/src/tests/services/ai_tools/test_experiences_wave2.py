"""The second wave of Experiences blocks (venn compare, label the diagram,
word guess, confidence check, property grid, reflection) across the AI tools:
typed blocks, the editor schema, outlines, Markdown, the learner preview, the
block catalogs and the MCP guides."""

import copy
import json
from pathlib import Path

import pytest

from src.services.ai.tools import block_specs as bs
from src.services.ai.tools import content_blocks as cb
from src.services.ai.tools import course_audit, course_quality, courses
from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import markdown as md
from src.services.courses.activities import experiences as exp
from src.services.mcp import guides, prompts, resources, server

WAVE2 = {
    "venn": "expVenn", "label_diagram": "expLabel", "word_guess": "expWordGuess",
    "confidence_check": "expConfidence", "property_grid": "expMatrix", "reflection": "expReflect",
}
IMAGE = "https://example.org/leaf.png"
WEB_FIXTURES = Path(__file__).resolve().parents[5] / "web" / "tests" / "fixtures" / "editor-blocks"


def _web_fixture_rows() -> list[tuple[str, dict]]:
    """The web editor's Experiences fixtures (skipped when the web app isn't next to the API)."""
    rows: list[tuple[str, dict]] = []
    for name in ("experiences-new-blocks.json", "experiences-scenarios-flashcards.json"):
        path = WEB_FIXTURES / name
        if path.is_file():
            rows += [(f"{name}: {r['name']}", n) for r in json.loads(path.read_text()) for n in r["nodes"]]
    return rows


def _one(block: dict) -> dict:
    return bs.to_converted(bs.parse_blocks([block])).doc["content"][0]


def _built() -> dict[str, dict]:
    return {name: _one(bs.EXAMPLES[name]) for name in WAVE2}


# ─── typed blocks ────────────────────────────────────────────────────────────


def test_each_new_block_is_registered_everywhere():
    for typed, node in WAVE2.items():
        assert exp.NODES[node] == typed and bs.EXPERIENCES[typed][0] == node
        assert typed in bs.BLOCK_TYPES and typed in bs.EXAMPLES and typed in bs.NOTES
        assert node in d.SCHEMA and node in exp.TEXT_PATHS and node in cb.CATALOG
        assert cb.EXPERIENCE_CATALOG_TYPED[node] == typed
        assert node in course_audit.PRACTICE and node in courses._RICH
        assert md._EXPERIENCE_TITLES[node]
    assert len(exp.NODE_NAMES) == 16 and set(cb.EXPERIENCE_CATALOG) == set(exp.NODE_NAMES)


def test_typed_blocks_build_editor_nodes():
    built = _built()
    for typed, node in built.items():
        assert node["type"] == WAVE2[typed] and len(node["attrs"]["blockId"]) == 36
        assert d.strict_problems(node) == [], typed
    venn = built["venn"]["attrs"]
    assert venn["sets"] == {"a": {"label": "Plants", "color": "sky"}, "b": {"label": "Animals", "color": "amber"}}
    assert [i["zone"] for i in venn["items"]] == ["a", "b", "both"] and venn["showNeither"] is False
    assert "explanation" not in venn["items"][0] and venn["items"][2]["explanation"]
    label = built["label_diagram"]["attrs"]
    assert label["imageUrl"].startswith("https://") and "imageObject" not in label
    assert [(p["x"], p["y"], p["label"]) for p in label["pins"]] == [(50, 20, "Tip"), (50, 90, "Stalk")]
    assert isinstance(label["pins"][0]["x"], int) and label["distractors"] == ["Root"]
    word = built["word_guess"]["attrs"]
    assert word["maxGuesses"] == 6 and word["words"][0]["answer"] == "stomata"
    conf = built["confidence_check"]["attrs"]["questions"][0]
    assert conf["answer"] == 0 and conf["explanation"].startswith("Photosynthesis")
    grid = built["property_grid"]["attrs"]
    rows, cols = grid["rows"], grid["columns"]
    assert grid["cells"] == {f"{rows[0]['id']}:{cols[0]['id']}": True, f"{rows[1]['id']}:{cols[1]['id']}": True}
    assert all(":" not in x["id"] for x in rows + cols) and grid["mode"] == "multi"
    reflect = built["reflection"]["attrs"]
    assert reflect["minWords"] == 30 and reflect["checklist"] == ["Light powers photosynthesis", "No sugar means no energy"]
    assert reflect["guidingQuestions"] == ["What does the plant need light for?"]


def test_typed_options_and_tolerance():
    venn = _one({"type": "venn", "sets": {"a": {"label": "A", "color": "Violet"}, "b": {"label": "B", "color": "violet"}},
                 "items": [{"text": "x", "zone": "a"}, {"text": "y", "zone": "neither"}, {"text": "z", "zone": "both", "explanation": " "}]})["attrs"]
    assert venn["sets"]["a"]["color"] == "violet" and venn["sets"]["b"]["color"] == "amber"  # never the same color
    assert venn["showNeither"] is True and "explanation" not in venn["items"][2]
    same = _one({"type": "venn", "sets": {"a": {"label": "A", "color": "amber"}, "b": {"label": "B", "color": "neon"}},
                 "items": [{"text": "x", "zone": "a"}, {"text": "y", "zone": "b"}, {"text": "z", "zone": "both"}], "show_neither": True})["attrs"]
    assert same["sets"]["b"]["color"] == "rose" and same["showNeither"] is True
    word = _one({"type": "word_guess", "max_guesses": 3, "words": [
        {"answer": "  Big   Bang ", "clue": "c"}, {"answer": "café", "clue": "c", "explanation": " "},
        {"answer": "cafés", "clue": "c"}, {"answer": "x-ray", "clue": "c"}]})["attrs"]
    assert [w["answer"] for w in word["words"]] == ["Big Bang", "café", "cafés", "x-ray"]
    assert "explanation" not in word["words"][1] and word["maxGuesses"] == 3
    conf = _one({"type": "confidence_check", "questions": [
        {"prompt": "p", "options": ["a", "B"], "answer": " b ", "explanation": "e"}]})["attrs"]
    assert conf["questions"][0]["answer"] == 1
    grid = _one({"type": "property_grid", "mode": "single", "columns": ["Solid", "Liquid"], "rows": [
        {"label": "Ice", "ticks": [" solid ", 0]}, {"label": "Water", "ticks": ["Liquid"]}]})["attrs"]
    assert len(grid["cells"]) == 2 and grid["mode"] == "single"
    plain = _one({"type": "reflection", "prompt": "Why?", "model_answer": "Because."})["attrs"]
    assert plain == {"blockId": plain["blockId"], "title": "", "prompt": "Why?", "guidingQuestions": [], "minWords": 30,
                     "modelAnswer": "Because.", "checklist": []}
    label = _one({"type": "label_diagram", "image_url": IMAGE, "pins": [
        {"x": 1.5, "y": 2, "label": " A "}, {"x": 3, "y": 4, "label": "A"}]})["attrs"]
    assert label["pins"][0] == {**label["pins"][0], "x": 1.5, "label": "A"} and label["distractors"] == []
    # Prior answers for speed rounds still resolve by text after the shared helper.
    speed = _one({"type": "speed_round", "questions": [{"prompt": "p", "options": ["a", "B"], "answer": "b"}]})["attrs"]
    assert speed["questions"][0]["answer"] == 1


_VENN_ITEMS = [{"text": "x", "zone": "a"}, {"text": "y", "zone": "b"}, {"text": "z", "zone": "both"}]


@pytest.mark.parametrize("block, problem", [
    ({"type": "venn", "sets": {"a": "Cats", "b": " cats "}, "items": _VENN_ITEMS}, "different labels"),
    ({"type": "venn", "sets": {"a": "A", "b": "B"}, "show_neither": False,
      "items": [*_VENN_ITEMS, {"text": "w", "zone": "neither"}]}, "show_neither must be true"),
    ({"type": "label_diagram", "image_url": IMAGE, "distractors": ["tip"],
      "pins": [{"x": 1, "y": 1, "label": "Tip"}, {"x": 2, "y": 2, "label": "Stalk"}]}, "also a pin label"),
    ({"type": "word_guess", "words": [{"answer": "R2D2", "clue": "c"}]}, "only letters"),
    ({"type": "word_guess", "words": [{"answer": "e=mc", "clue": "c"}]}, "only letters"),
    ({"type": "word_guess", "words": [{"answer": "́a", "clue": "c"}]}, "only letters"),
    ({"type": "word_guess", "words": [{"answer": "a", "clue": "c"}]}, "2 to 12 letters"),
    ({"type": "word_guess", "words": [{"answer": "abcdefghijklm", "clue": "c"}]}, "2 to 12 letters"),
    ({"type": "word_guess", "words": [{"answer": "atom", "clue": "c"}, {"answer": "ATOM", "clue": "d"}]}, "used twice"),
    ({"type": "confidence_check", "questions": [{"prompt": "p", "options": ["a", "b"], "answer": 2, "explanation": "e"}]},
     "not one of its options"),
    ({"type": "confidence_check", "questions": [{"prompt": "p", "options": ["a", "b"], "answer": "c", "explanation": "e"}]},
     "not one of its options"),
    ({"type": "property_grid", "columns": ["A", "a"], "rows": [{"label": "r", "ticks": [0]}, {"label": "s"}]}, "different"),
    ({"type": "property_grid", "columns": ["A", "B"], "rows": [{"label": "r", "ticks": ["C"]}, {"label": "s"}]}, "unknown column"),
    ({"type": "property_grid", "columns": ["A", "B"], "rows": [{"label": "r", "ticks": [7]}, {"label": "s"}]}, "unknown column"),
    ({"type": "property_grid", "mode": "single", "columns": ["A", "B"],
      "rows": [{"label": "r", "ticks": [0, 1]}, {"label": "s", "ticks": [0]}]}, "exactly one tick"),
    ({"type": "property_grid", "columns": ["A", "B"], "rows": [{"label": "r"}, {"label": "s"}]}, "at least one cell"),
    ({"type": "reflection", "prompt": "Why?", "model_answer": "  "}, "model_answer or a checklist"),
])
def test_typed_errors_say_how_to_fix(block, problem):
    with pytest.raises(bs.BlockError, match=problem):
        bs.to_converted(bs.parse_blocks([block]))


def test_typed_limits_are_checked_by_the_model():
    with pytest.raises(bs.BlockError, match="items"):
        bs.parse_blocks([{"type": "venn", "sets": {"a": "A", "b": "B"}, "items": _VENN_ITEMS[:2]}])
    with pytest.raises(bs.BlockError, match="zone"):
        bs.parse_blocks([{"type": "venn", "sets": {"a": "A", "b": "B"}, "items": [*_VENN_ITEMS[:2], {"text": "z", "zone": "middle"}]}])
    with pytest.raises(bs.BlockError, match="http"):
        bs.parse_blocks([{"type": "label_diagram", "image_url": "javascript:alert(1)", "pins": []}])
    with pytest.raises(bs.BlockError, match="max_guesses"):
        bs.parse_blocks([{"type": "word_guess", "max_guesses": 9, "words": [{"answer": "ab", "clue": "c"}]}])
    with pytest.raises(bs.BlockError, match="explanation"):
        bs.parse_blocks([{"type": "confidence_check", "questions": [{"prompt": "p", "options": ["a", "b"], "answer": 0}]}])
    with pytest.raises(bs.BlockError, match="min_words"):
        bs.parse_blocks([{"type": "reflection", "prompt": "p", "min_words": 501}])


def test_catalog_documents_the_new_blocks():
    cat = bs.catalog()
    assert set(WAVE2) <= set(cat["types"])
    for typed in WAVE2:
        entry = bs.catalog(typed)
        assert entry["schema"] and entry["notes"] and entry["example"]["type"] == typed
    blocks = json.loads(resources.static_text(resources.RESOURCES["blocks"], None))
    assert set(WAVE2) | {"scenario", "flashcards"} <= {b["type"] for b in blocks["blocks"]}
    assert "study" in bs.NOTES["flashcards"] and "ending" in bs.NOTES["scenario"]


# ─── editor schema ───────────────────────────────────────────────────────────


def _problems(node: dict) -> str:
    return " ".join(d.strict_problems(node))


def test_schema_accepts_editor_shapes_and_partial_blocks():
    for node in (
        # The web editor's defaults (Experiences/*/…Model.ts examples).
        {"type": "expVenn", "attrs": {"blockId": "", "title": "Frogs or toads?", "instructions": "", "showNeither": False,
                                      "sets": {"a": {"label": "Frogs", "color": "emerald"}, "b": {"label": "Toads", "color": "amber"}},
                                      "items": [{"id": "i1", "text": "Smooth skin", "zone": "a"}, {"id": "i2", "text": "", "zone": "neither"}]}},
        {"type": "expLabel", "attrs": {"imageUrl": "", "imageObject": None, "distractors": [],
                                       "pins": [{"id": "p1", "x": 50, "y": 12.5, "label": ""}]}},
        {"type": "expLabel", "attrs": {"imageUrl": "/content/orgs/o/img.png",
                                       "imageObject": {"block_uuid": "block_1", "content": {"file_name": "a.png"}}}},
        {"type": "expWordGuess", "attrs": {"words": [{"id": "w1", "answer": "", "clue": ""}], "maxGuesses": 6}},
        {"type": "expConfidence", "attrs": {"questions": [{"id": "q1", "prompt": "", "options": ["a", ""], "answer": 1, "explanation": ""}]}},
        {"type": "expMatrix", "attrs": {"rows": [{"id": "r1", "label": "Whale"}], "columns": [{"id": "c1", "label": ""}],
                                        "cells": {"r1:c1": True, "r1:c9": False}, "mode": "single"}},
        {"type": "expMatrix", "attrs": {"rows": [], "columns": [], "cells": {}, "mode": "multi"}},
        {"type": "expReflect", "attrs": {"prompt": "", "guidingQuestions": [], "minWords": 0, "modelAnswer": "", "checklist": [""]}},
    ):
        assert d.strict_problems(node) == [], node["type"]


@pytest.mark.parametrize("name, node", _web_fixture_rows() or [("none", None)])
def test_web_editor_fixtures_pass_the_api_schema_and_render(name, node):
    if node is None:
        pytest.skip("web fixtures not available")
    assert d.strict_problems(node) == [], name
    assert md.doc_to_markdown({"type": "doc", "content": [node]}).strip(), name
    if d.kind(node) in exp.TEXT_PATHS:
        assert course_quality._learner_lines(node), name


@pytest.mark.parametrize("node, problem", [
    ({"type": "expVenn", "attrs": {"sets": ["a", "b"]}}, '"a": {label, color}'),
    ({"type": "expVenn", "attrs": {"sets": {"a": {"label": "x"}, "c": {}}}}, '"a": {label, color}'),
    ({"type": "expVenn", "attrs": {"sets": {"a": "Frogs"}}}, "a must be {label, color}"),
    ({"type": "expVenn", "attrs": {"sets": {"b": {"label": 3}}}}, "b label must be text"),
    ({"type": "expVenn", "attrs": {"sets": {"b": {"color": "x" * 31}}}}, "b color"),
    ({"type": "expVenn", "attrs": {"items": [{"zone": "middle"}]}}, "item 0 zone"),
    ({"type": "expVenn", "attrs": {"showNeither": "yes"}}, "true or false"),
    ({"type": "expLabel", "attrs": {"imageUrl": "javascript:alert(1)"}}, "http"),
    ({"type": "expLabel", "attrs": {"imageObject": "a.png"}}, "uploaded file object"),
    ({"type": "expLabel", "attrs": {"pins": [{"x": 101}]}}, "number from 0 to 100"),
    ({"type": "expLabel", "attrs": {"distractors": [1]}}, "at most 20 texts"),
    ({"type": "expWordGuess", "attrs": {"words": [{"answer": 5}]}}, "word 0 answer must be text"),
    ({"type": "expWordGuess", "attrs": {"maxGuesses": 2.5}}, "whole number"),
    ({"type": "expConfidence", "attrs": {"questions": [{"options": ["a", "b"], "answer": 5}]}}, "0-based index"),
    ({"type": "expConfidence", "attrs": {"questions": [{"options": "ab"}]}}, "at most 10 texts"),
    ({"type": "expMatrix", "attrs": {"cells": []}}, "correct ticks"),
    ({"type": "expMatrix", "attrs": {"cells": {"r1c1": True}}}, "rowId:colId"),
    ({"type": "expMatrix", "attrs": {"cells": {"r1:c1": "yes"}}}, "rowId:colId"),
    ({"type": "expMatrix", "attrs": {"mode": "many"}}, "multi"),
    ({"type": "expMatrix", "attrs": {"rows": [{"label": ["x"]}]}}, "row 0 label must be text"),
    ({"type": "expReflect", "attrs": {"minWords": -1}}, "number from 0"),
    ({"type": "expReflect", "attrs": {"checklist": "a, b"}}, "at most 30 texts"),
    ({"type": "expReflect", "attrs": {"secret": 1}}, "no attribute 'secret'"),
])
def test_schema_refuses_what_would_break_a_block(node, problem):
    assert problem in _problems(node)


def test_outline_summary_search_text_and_replace():
    built = _built()
    doc = {"type": "doc", "content": list(built.values())}
    text = d.block_text(doc)
    for needle in ("Plants", "All living cells respire.", "Stalk", "Root", "stomata", "Tiny pores", "Methane",
                   "Carries water", "Stem", "Without light", "No sugar means no energy"):
        assert needle in text, needle
    summaries = {n["type"]: d.summary(n) for n in built.values()}
    assert summaries["expLabel"] == {"title": "Label the leaf", "pins": 2}
    assert summaries["expWordGuess"] == {"title": "Guess the term", "words": 1}
    assert summaries["expConfidence"] == {"title": "How sure are you?", "questions": 1}
    assert d.summary({"type": "expReflect", "attrs": {"prompt": "Why so?"}}) == {"title": "Why so?"}
    assert d.summary({"type": "expVenn", "attrs": {"sets": "bad"}}) == {"items": 0, "sets": []}
    assert [e["type"] for e, _full in d.outline_entries(doc)] == list(WAVE2.values())

    page = copy.deepcopy(doc)
    assert len([n for _p, n in d.text_targets(page, ())]) == len(WAVE2)
    word = page["content"][2]
    assert d.count_in(word, "stomata") == 1  # find/replace reaches the answer (translation does not)
    assert d.replace_in(word, "stomata", "pores", None) == 1
    assert word["attrs"]["words"][0]["answer"] == "pores"
    reflect = page["content"][5]
    assert d.replace_in(reflect, "sugar", "glucose", None) == 2
    assert reflect["attrs"]["checklist"][1] == "No glucose means no energy"
    venn = page["content"][0]
    assert d.replace_in(venn, "Animals", "Beasts", None) == 1 and venn["attrs"]["sets"]["b"]["label"] == "Beasts"
    assert all(d.strict_problems(n) == [] for n in page["content"])


def test_scenario_and_deck_search_text_include_the_new_fields():
    scen = {"type": "scenarios", "attrs": {"title": "T", "scenarios": [
        {"id": "a", "text": "Start", "options": [{"text": "Go", "feedback": "Bold move"}, "junk"],
         "ending": {"tone": "success", "title": "Home safe"}},
        {"id": "b", "text": "Next", "options": [], "ending": "junk"}]}}
    assert d.block_text(scen) == "T\nStart\nGo\nBold move\nHome safe\nNext"
    grid = {"type": "flipcardGrid", "attrs": {"title": "Deck"},
            "content": [{"type": "flipcard", "attrs": {"question": "q", "answer": "a"}}]}
    assert d.block_text(grid) == "Deck"  # cards keep their text in attrs, read by their own entries
    assert d.block_text({**grid, "attrs": {}}) == ""


# ─── Markdown and preview ────────────────────────────────────────────────────


def test_markdown_shows_each_new_block_with_its_answers():
    built = _built()
    out = md.doc_to_markdown({"type": "doc", "content": list(built.values())})
    for needle in ('<!-- block [0] expVenn', 'Venn compare "Plants or animals?"', "Sets: Plants | Animals",
                   "- Make their own sugar -> only Plants", "- Respire to release energy -> both (All living cells respire.)",
                   'Label the diagram "Label the leaf"', "1. Tip at 50%, 20%", "Distractors: Root",
                   "6 guesses per word", "1. Tiny pores that let gases in and out of a leaf. = stomata (Most sit under the leaf.)",
                   "   [x] Oxygen", "   (Photosynthesis splits water and releases oxygen.)",
                   "Columns: Makes sugar | Carries water", "- Leaf: Makes sugar", "- Stem: Carries water",
                   "Prompt: Explain why", "- What does the plant need light for?", "At least 30 words.",
                   "Model answer: Without light", "[key point] Light powers photosynthesis"):
        assert needle in out, needle


def test_markdown_variants_of_new_blocks():
    lines = md.experience_lines
    assert lines("expVenn", {"sets": {"a": {"label": "X"}}, "showNeither": True,
                             "items": [{"text": "n", "zone": "neither"}, {"text": "o", "zone": "odd"}]}) == [
        "Venn compare", "Sets: X | B (with an outside tray)", "- n -> neither", "- o -> ?"]
    assert lines("expVenn", {"sets": "bad"})[1] == "Sets: A | B"
    assert lines("expLabel", {"distractors": "bad", "pins": []}) == ["Label the diagram", "Image: none yet"]
    assert lines("expWordGuess", {"maxGuesses": 4, "words": [{"clue": "c", "answer": "ab"}]}) == [
        "Word guess", "4 guesses per word", "1. c = ab"]
    assert lines("expConfidence", {"questions": [{"prompt": "p", "options": "bad"}]}) == ["Confidence check", "1. p"]
    assert lines("expMatrix", {"mode": "single", "cells": "bad", "columns": [{"id": "c", "label": "C"}],
                               "rows": [{"id": "r", "label": "R"}]}) == [
        "Property grid", "Columns: C (one per row)", "- R: none"]
    assert lines("expReflect", {"prompt": "p", "guidingQuestions": "bad", "checklist": "bad"}) == [
        "Reflection", "Prompt: p", "At least 30 words."]


def test_learner_preview_never_shows_answers():
    built = _built()
    preview = "\n".join(line for n in built.values() for line in course_quality._learner_lines(n))
    for needle in ("**Compare: Plants or animals?**", "Circles: Plants | Animals", "- [Respire to release energy]",
                   "[Image with 2 numbered pin(s)]", "Labels: Root | Stalk | Tip", "🔤 Tiny pores",
                   "   ( ) Nitrogen", "How sure? Guessing / Fairly sure / Certain", "| | Makes sugar | Carries water |",
                   "| Leaf |", "Explain why a plant", "[Write at least 30 words; then compare with the model answer]"):
        assert needle in preview, needle
    for secret in ("stomata", "Without light", "Light powers", "-> both", "Photosynthesis splits"):
        assert secret not in preview, secret
    lines = course_quality._experience_learner_lines
    assert lines("expVenn", {"sets": "bad", "showNeither": True})[-1] == "Circles:  (and outside both)"
    assert lines("expReflect", {"prompt": "p", "minWords": 0})[-1] == "[Write at least 0 words; then compare with the model answer]"


# ─── catalogs, guides and prompts ────────────────────────────────────────────


async def test_describe_activity_blocks_lists_the_whole_family():
    out = await cb._describe_activity_blocks(None, cb.DescribeBlocksParams())
    for typed in exp.NODES.values():
        assert typed in out["experiences"], typed
    assert "scenarios" in out["experiences"] and "mode: study" in out["experiences"]
    for alias, node in (("venn", "expVenn"), ("wordle", "expWordGuess"), ("matrix", "expMatrix"), ("label_diagram", "expLabel"),
                        ("confidence", "expConfidence"), ("reflect", "expReflect")):
        assert cb._LOOKUP[cb._key(alias)] == node
    one = await cb._describe_activity_blocks(None, cb.DescribeBlocksParams(type="property_grid"))
    assert one["type"] == "expMatrix" and one["content"].startswith("none")
    assert one["typed_block"]["type"] == "property_grid" and one["typed_block"]["example"]["type"] == "property_grid"
    assert "typed_block" not in await cb._describe_activity_blocks(None, cb.DescribeBlocksParams(type="callout"))
    for name in WAVE2.values():
        assert d.strict_problems(cb.CATALOG[name]["example"]) == [], name


def test_guides_prompts_and_server_name_every_experience():
    family = list(exp.NODES.values())
    pedagogy = guides.GUIDES["pedagogy"][1]
    assessments = guides.GUIDES["assessments"][1]
    markdown_guide = guides.GUIDES["markdown"][1]
    for typed in family:
        assert f"`{typed}`" in pedagogy and f"`{typed}`" in assessments and typed in markdown_guide, typed
        assert typed in server.INSTRUCTIONS, typed
    assert "display: chat" in pedagogy and "mode: study" in pedagogy
    assessment_prompt = prompts.PROMPTS["add_assessments"]
    for typed in ("venn", "word_guess", "confidence_check", "property_grid", "reflection"):
        assert typed in assessment_prompt.template
