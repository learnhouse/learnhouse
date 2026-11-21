"""Experiences blocks (sort, sequence, match pairs, hotspot, fill the gaps,
myth or fact, speed round, estimate, spot the mistake, code lock) across the
AI tools: typed blocks, the editor schema, outlines, Markdown, fences and the
learner preview, plus the shared helpers in activities/experiences.py."""

import copy

import pytest

from src.services.ai.tools import block_specs as bs
from src.services.ai.tools import content_blocks as cb
from src.services.ai.tools import course_audit, course_quality
from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import fences
from src.services.ai.tools import markdown as md
from src.services.courses.activities import experiences as exp

TYPED = ("sort", "sequence", "match_pairs", "hotspot", "fill_gaps", "myth_fact", "speed_round",
         "estimate", "spot_mistake", "code_lock", "venn", "label_diagram", "word_guess", "confidence_check",
         "property_grid", "reflection")


def _inline(text: str) -> list[dict]:
    return [d.text_node(text)]


def _one(block: dict) -> dict:
    return bs.to_converted(bs.parse_blocks([block])).doc["content"][0]


def _built() -> dict[str, dict]:
    return {name: _one(bs.EXAMPLES[name]) for name in TYPED}


# ─── typed blocks ────────────────────────────────────────────────────────────


def test_every_typed_experience_builds_its_node_with_ids():
    built = _built()
    assert {n["type"] for n in built.values()} == set(exp.NODE_NAMES)
    assert {bs.EXPERIENCES[k][0] for k in TYPED} == set(exp.NODE_NAMES)
    assert dict((v, k) for k, v in exp.NODES.items()) == {k: bs.EXPERIENCES[k][0] for k in TYPED}
    for node in built.values():
        assert len(node["attrs"]["blockId"]) == 36
        assert d.strict_problems(node) == []
    sort = built["sort"]["attrs"]
    assert [c["color"] for c in sort["categories"]] == ["sky", "amber"]
    assert sort["items"][0]["categoryId"] == sort["categories"][0]["id"]
    assert "explanation" not in sort["items"][0] and sort["items"][1]["explanation"]
    assert sort["shuffle"] is True
    assert [i["text"] for i in built["sequence"]["attrs"]["items"]] == ["Light hits the leaf", "Water is split", "Sugar is made"]
    assert built["match_pairs"]["attrs"]["mode"] == "connect"
    spot = built["hotspot"]["attrs"]["spots"][0]
    assert (spot["x"], spot["y"], spot["r"], spot["correct"]) == (42, 61, 8, True) and isinstance(spot["x"], int)
    assert built["fill_gaps"]["attrs"]["caseSensitive"] is False
    assert built["myth_fact"]["attrs"]["labels"] == {"true": "Fact", "false": "Myth"}
    assert [q["answer"] for q in built["speed_round"]["attrs"]["questions"]] == [0, 0]
    est = built["estimate"]["attrs"]
    assert (est["min"], est["max"], est["step"], est["answer"], est["tolerancePct"]) == (0, 100, 1, 50, 10)
    assert built["spot_mistake"]["attrs"]["segments"][1] == {**built["spot_mistake"]["attrs"]["segments"][1], "isMistake": True}
    assert built["code_lock"]["attrs"]["clues"][0]["answer"] == "2"


def test_typed_experience_options_and_tolerance():
    sort = _one({"type": "sort", "categories": [{"label": "A", "color": "rose"}, {"label": "B", "color": "neon"}],
                 "items": [{"text": "x", "category": 1}, {"text": "y", "category": " a "}], "shuffle": False})["attrs"]
    assert [c["color"] for c in sort["categories"]] == ["rose", "amber"]
    assert [i["categoryId"] for i in sort["items"]] == [sort["categories"][1]["id"], sort["categories"][0]["id"]]
    seq = _one({"type": "sequence", "variant": "timeline", "items": [
        {"text": "a", "detail": "1492"}, {"text": "b", "detail": " "}, "c"]})["attrs"]
    assert seq["items"][0]["detail"] == "1492" and "detail" not in seq["items"][1]
    hot = _one({"type": "hotspot", "mode": "explore", "image_url": "https://x.org/a.png",
                "spots": [{"x": 1.5, "y": 2, "label": "L", "correct": False}]})["attrs"]
    assert hot["spots"][0]["x"] == 1.5 and hot["spots"][0]["r"] == 8 and "explanation" not in hot["spots"][0]
    speed = _one({"type": "speed_round", "lives": 0, "questions": [{"prompt": "p", "options": ["a", "B"], "answer": " b "}]})["attrs"]
    assert speed["questions"][0]["answer"] == 1 and speed["lives"] == 0
    est = _one({"type": "estimate", "question": "q", "min": 0.5, "max": 2, "step": 0.25, "answer": 1.25})["attrs"]
    assert (est["min"], est["step"], est["answer"], est["unit"]) == (0.5, 0.25, 1.25, "")
    lock = _one({"type": "code_lock", "clues": [{"question": "a", "answer": 2.0}, {"question": "b", "answer": 2.5},
                                                {"question": "c", "answer": " Oxygen "}]})["attrs"]
    assert [c["answer"] for c in lock["clues"]] == ["2", "2.5", "Oxygen"] and lock["clues"][0]["hint"] == ""
    spot = _one({"type": "spot_mistake", "kind": "code", "segments": [
        {"text": "x = 1"}, {"text": "print(y)", "is_mistake": True, "explanation": "y is undefined", "correction": " "}]})["attrs"]
    assert spot["segments"][1]["explanation"] == "y is undefined" and "correction" not in spot["segments"][1]


@pytest.mark.parametrize("block, problem", [
    ({"type": "sort", "categories": ["A", "a"], "items": [{"text": "x", "category": "A"}, {"text": "y", "category": "A"}]}, "different"),
    ({"type": "sort", "categories": ["A", "B"], "items": [{"text": "x", "category": "C"}, {"text": "y", "category": "A"}]}, "unknown category"),
    ({"type": "sort", "categories": ["A", "B"], "items": [{"text": "x", "category": 5}, {"text": "y", "category": "A"}]}, "unknown category"),
    ({"type": "hotspot", "image_url": "https://x.org/a.png", "spots": [{"x": 1, "y": 1, "label": "L", "correct": False}]}, "correct: true"),
    ({"type": "fill_gaps", "text": "No gaps [[ ]] here"}, "no gap"),
    ({"type": "speed_round", "questions": [{"prompt": "p", "options": ["a", "b"], "answer": 2}]}, "not one of its options"),
    ({"type": "speed_round", "questions": [{"prompt": "p", "options": ["a", "b"], "answer": "c"}]}, "not one of its options"),
    ({"type": "estimate", "question": "q", "min": 5, "max": 5, "answer": 5}, "below max"),
    ({"type": "estimate", "question": "q", "min": 0, "max": 5, "answer": 6}, "between min and max"),
    ({"type": "estimate", "question": "q", "min": 0, "max": 1_000_000, "step": 1, "answer": 6}, "100000 steps"),
    ({"type": "spot_mistake", "segments": [{"text": "a"}, {"text": "b"}]}, "is_mistake"),
    ({"type": "code_lock", "clues": [{"question": "q", "answer": "x" * 41}]}, "short answer"),
    ({"type": "code_lock", "clues": [{"question": "q", "answer": "  "}]}, "short answer"),
])
def test_typed_experience_errors_say_how_to_fix(block, problem):
    with pytest.raises(bs.BlockError, match=problem):
        bs.to_converted(bs.parse_blocks([block]))


def test_typed_experience_limits_are_checked_by_the_model():
    with pytest.raises(bs.BlockError, match="categories"):
        bs.parse_blocks([{"type": "sort", "categories": ["A", "B", "C", "D", "E"], "items": []}])
    with pytest.raises(bs.BlockError, match="items"):
        bs.parse_blocks([{"type": "sequence", "items": ["a", "b"]}])
    with pytest.raises(bs.BlockError, match="http"):
        bs.parse_blocks([{"type": "hotspot", "image_url": "javascript:alert(1)", "spots": []}])


def test_flashcards_and_scenario_new_fields_are_optional():
    plain = {"type": "flashcards", "cards": [{"front": "a", "back": "b"}, {"front": "c", "back": "d"}]}
    assert _one(plain)["attrs"] == {"columns": 2}
    one = _one({"type": "flashcards", "cards": [{"front": "a", "back": "b"}], "mode": "study"})
    assert one["type"] == "flipcardGrid" and one["attrs"] == {"columns": 1, "mode": "study"}
    deck = _one({**plain, "title": "Deck", "shuffle": False})
    assert deck["attrs"] == {"columns": 2, "title": "Deck", "shuffle": False} and d.strict_problems(deck) == []

    old = {"type": "scenario", "steps": [{"id": "a", "text": "t", "options": [{"text": "go", "next": None}]}]}
    node = _one(old)
    assert set(node["attrs"]) == {"title", "scenarios", "currentScenarioId"}
    assert set(node["attrs"]["scenarios"][0]) == {"id", "text", "imageUrl", "options"}
    assert set(node["attrs"]["scenarios"][0]["options"][0]) == {"id", "text", "nextScenarioId"}
    new = _one({"type": "scenario", "display": "chat", "steps": [
        {"id": "a", "text": "t", "options": [{"text": "go", "next": "b", "feedback": "Good"}, {"text": "quit", "outcome": "fail"}]},
        {"id": "b", "text": "Done", "ending": {"tone": "success", "title": "Well done"}},
        {"id": "c", "text": "Meh", "ending": {}}]})
    a = new["attrs"]
    assert a["display"] == "chat" and a["scenarios"][1]["ending"] == {"tone": "success", "title": "Well done"}
    assert a["scenarios"][2]["ending"] == {"tone": "neutral"}
    assert a["scenarios"][0]["options"][0]["feedback"] == "Good" and a["scenarios"][0]["options"][1]["outcome"] == "fail"
    assert d.strict_problems(new) == []


def test_catalog_lists_the_experiences():
    cat = bs.catalog()
    assert set(TYPED) <= set(cat["types"])
    assert bs.catalog("fill_gaps")["notes"].startswith("Retrieval")
    assert bs.catalog("sort")["schema"]


# ─── editor schema ───────────────────────────────────────────────────────────


def _problems(node: dict) -> str:
    return " ".join(d.strict_problems(node))


def test_schema_accepts_editor_shapes_and_partial_blocks():
    # What the editor saves mid-authoring: missing ids, empty texts, defaults.
    for node in (
        {"type": "expSort", "attrs": {"blockId": "", "title": "", "categories": [{"label": ""}], "items": [{"text": "", "categoryId": ""}]}},
        {"type": "expSequence", "attrs": {"items": [], "variant": "timeline"}},
        {"type": "expMatch", "attrs": {"pairs": [{"left": "a", "note": "kept"}], "mode": "memory"}},
        {"type": "expHotspot", "attrs": {"imageUrl": "/content/orgs/o/img.png", "spots": [{"x": 0, "y": 100.0, "r": 5}]}},
        {"type": "expHotspot", "attrs": {"imageUrl": "", "mode": "explore", "imageObject": None}},
        {"type": "expHotspot", "attrs": {"imageUrl": "https://media.example.org/a.png",
                                         "imageObject": {"block_uuid": "block_1", "content": {"file_name": "a.png"}}}},
        {"type": "expGaps", "attrs": {"text": "", "mode": "bank", "caseSensitive": True}},
        {"type": "expMythFact", "attrs": {"statements": [{"isTrue": False}], "labels": {"true": "Vrai"}}},
        {"type": "expSpeedRound", "attrs": {"questions": [{"prompt": "p"}, {"options": ["a"], "answer": 0}], "lives": 0, "secondsPerQuestion": 5}},
        {"type": "expEstimate", "attrs": {"question": "", "min": 0, "max": 1.5, "step": 0.5, "answer": 1, "tolerancePct": 12.5}},
        {"type": "expSpotMistake", "attrs": {"segments": [{"text": "a", "isMistake": True}], "kind": "code"}},
        {"type": "expCodeLock", "attrs": {"clues": [{"answer": 42}, {"answer": "word"}], "reward": ""}},
        {"type": "flipcardGrid", "attrs": {"columns": 2, "mode": "grid", "title": "", "shuffle": False},
         "content": [{"type": "flipcard", "attrs": {"question": "q", "answer": "a"}}]},
        {"type": "scenarios", "attrs": {"display": "story", "scenarios": [
            {"id": "a", "text": "t", "options": [{"text": "x", "nextScenarioId": None, "feedback": "f", "outcome": None}],
             "ending": {"tone": "fail"}}]}},
    ):
        assert d.strict_problems(node) == [], node["type"]


@pytest.mark.parametrize("node, problem", [
    ({"type": "expSort", "attrs": {"categories": "x"}}, "at most 8 categorys"),
    ({"type": "expSort", "attrs": {"items": ["x"]}}, "item 0 must be an object"),
    ({"type": "expSort", "attrs": {"items": [{"text": 3}]}}, "item 0 text must be text"),
    ({"type": "expSort", "attrs": {"categories": [{"id": "c1"}], "items": [{"categoryId": "zz"}]}}, "names no category"),
    ({"type": "expSort", "attrs": {"shuffle": "yes"}}, "true or false"),
    ({"type": "expSort", "attrs": {"title": "x" * 501}}, "at most 500"),
    ({"type": "expSequence", "attrs": {"variant": "grid"}}, "list"),
    ({"type": "expMatch", "attrs": {"pairs": [{"left": "a"}] * 21}}, "at most 20 pairs"),
    ({"type": "expHotspot", "attrs": {"imageUrl": "javascript:alert(1)"}}, "http"),
    ({"type": "expHotspot", "attrs": {"imageUrl": "//evil.org/a.png"}}, "http"),
    ({"type": "expHotspot", "attrs": {"spots": [{"x": 101}]}}, "number from 0 to 100"),
    ({"type": "expHotspot", "attrs": {"imageObject": "a.png"}}, "uploaded file object"),
    ({"type": "expHotspot", "attrs": {"spots": [{"y": True}]}}, "number from 0 to 100"),
    ({"type": "expGaps", "attrs": {"caseSensitive": 1}}, "true or false"),
    ({"type": "expMythFact", "attrs": {"labels": ["Fact"]}}, '"true": "Fact"'),
    ({"type": "expMythFact", "attrs": {"labels": {"true": 3}}}, "true must be text"),
    ({"type": "expMythFact", "attrs": {"labels": {"maybe": "x"}}}, '"true": "Fact"'),
    ({"type": "expSpeedRound", "attrs": {"questions": [{"options": ["a", "b"], "answer": 2}]}}, "0-based index"),
    ({"type": "expSpeedRound", "attrs": {"questions": [{"options": ["a"], "answer": True}]}}, "0-based index"),
    ({"type": "expSpeedRound", "attrs": {"questions": [{"options": "ab"}]}}, "at most 6 texts"),
    ({"type": "expSpeedRound", "attrs": {"lives": 1.5}}, "whole number"),
    ({"type": "expEstimate", "attrs": {"min": "0"}}, "must be a number"),
    ({"type": "expEstimate", "attrs": {"max": float("nan")}}, "must be a number"),
    ({"type": "expEstimate", "attrs": {"min": 5, "max": 1}}, "min must be below max"),
    ({"type": "expEstimate", "attrs": {"step": 0}}, "step must be above 0"),
    ({"type": "expEstimate", "attrs": {"tolerancePct": 150}}, "number from 0 to 100"),
    ({"type": "expSpotMistake", "attrs": {"kind": "prose"}}, "text"),
    ({"type": "expCodeLock", "attrs": {"clues": [{"answer": ["x"]}]}}, "clue 0 answer must be text"),
    ({"type": "expCodeLock", "attrs": {"secret": 1}}, "no attribute 'secret'"),
    ({"type": "flipcardGrid", "attrs": {"mode": "deck"}, "content": [{"type": "flipcard", "attrs": {"question": "q", "answer": "a"}}]}, "grid"),
    ({"type": "flipcardGrid", "attrs": {"shuffle": "no"}, "content": [{"type": "flipcard", "attrs": {"question": "q", "answer": "a"}}]}, "shuffle"),
    ({"type": "scenarios", "attrs": {"display": "comic"}}, "chat"),
    ({"type": "scenarios", "attrs": {"scenarios": [{"id": "a", "text": "t", "options": [], "ending": "end"}]}}, "ending must be"),
    ({"type": "scenarios", "attrs": {"scenarios": [{"id": "a", "text": "t", "options": [], "ending": {"tone": "great"}}]}}, "ending must be"),
    ({"type": "scenarios", "attrs": {"scenarios": [{"id": "a", "text": "t", "options": [], "ending": {"title": 3}}]}}, "ending title must be text"),
    ({"type": "scenarios", "attrs": {"scenarios": [{"id": "a", "text": "t", "options": [{"text": "x", "feedback": 3}]}]}}, "feedback must be text"),
    ({"type": "scenarios", "attrs": {"scenarios": [{"id": "a", "text": "t", "options": [{"text": "x", "outcome": "win"}]}]}}, "outcome must be"),
])
def test_schema_refuses_what_would_break_a_block(node, problem):
    assert problem in _problems(node)


def test_outline_text_summary_and_replace():
    built = _built()
    doc = {"type": "doc", "content": list(built.values())}
    text = d.block_text(doc)
    for needle in ("Needs no light", "Cells respire day and night.", "Water is split", "Carries water", "Stomata",
                   "[chloroplasts / chloroplast]", "They respire all the time.", "Glucose", "nitrogen", "Read the formula."):
        assert needle in text, needle
    summaries = {n["type"]: d.summary(n) for n in built.values()}
    assert summaries["expSort"] == {"title": "Sort it", "items": 2, "categories": ["Needs light", "Needs no light"]}
    assert summaries["expGaps"]["gaps"] == 2 and summaries["expGaps"]["mode"] == "type"
    assert summaries["expEstimate"]["answer"] == 50 and summaries["expEstimate"]["unit"] == "%"
    assert summaries["expCodeLock"] == {"title": "Lab escape", "clues": 1}
    assert d.summary({"type": "expEstimate", "attrs": {}}) == {}
    assert summaries["expVenn"] == {"title": "Plants or animals?", "items": 3, "sets": ["Plants", "Animals"]}
    assert summaries["expMatrix"]["columns"] == ["Makes sugar", "Carries water"] and summaries["expMatrix"]["rows"] == 2
    assert summaries["expReflect"] == {"title": "In your own words", "key_points": 2}
    entries = [e for e, _full in d.outline_entries(doc)]
    assert [e["type"] for e in entries] == [n["type"] for n in built.values()]

    page = copy.deepcopy(doc)
    targets = [n for _p, n in d.text_targets(page, ())]
    assert len(targets) == len(built)
    sort = page["content"][0]
    assert d.count_in(sort, "light") == 2
    assert d.replace_in(sort, "light", "sun", None) == 2
    assert sort["attrs"]["categories"][1]["label"] == "Needs no sun"
    lock = page["content"][TYPED.index("code_lock")]
    assert d.replace_in(lock, "2", "two", None) == 2  # the question's CO2 and the answer
    assert lock["attrs"]["clues"][0]["answer"] == "two"
    assert d.strict_problems(sort) == [] and d.strict_problems(lock) == []


def test_replace_text_reaches_new_scenario_and_deck_text():
    scen = {"type": "scenarios", "attrs": {"title": "T", "scenarios": [
        {"id": "a", "text": "go", "options": [{"id": "o", "text": "go on", "nextScenarioId": None, "feedback": "go far"}],
         "ending": {"tone": "success", "title": "go home"}}]}}
    assert d.replace_in(scen, "go", "run", None) == 4
    step = scen["attrs"]["scenarios"][0]
    assert (step["options"][0]["feedback"], step["ending"]["title"]) == ("run far", "run home")
    grid = {"type": "flipcardGrid", "attrs": {"columns": 1, "title": "Deck one"},
            "content": [{"type": "flipcard", "attrs": {"question": "one", "answer": "two"}}]}
    doc = {"type": "doc", "content": [grid]}
    assert [n["type"] for _p, n in d.text_targets(doc, ())] == ["flipcardGrid", "flipcard"]
    assert [n["type"] for _p, n in d.text_targets(grid, (0,))] == ["flipcardGrid", "flipcard"]
    assert d.replace_in(grid, "one", "1", None) == 1 and grid["attrs"]["title"] == "Deck 1"
    assert d.summary(grid) == {"children": 1, "title": "Deck 1"}
    assert d.summary({**grid, "attrs": {"mode": "study"}}) == {"children": 1, "mode": "study"}
    assert d.summary({"type": "scenarios", "attrs": {"display": "chat"}})["display"] == "chat"


# ─── Markdown, fences and preview ────────────────────────────────────────────


def test_markdown_shows_each_experience_with_its_answers():
    built = _built()
    out = md.doc_to_markdown({"type": "doc", "content": list(built.values())})
    for needle in ('<!-- block [0] expSort', 'Sort it "Sort it"', "- Photosynthesis -> Needs light",
                   "1. Light hits the leaf", "- Stomata = Let gases in", "[x] Stomata at 42%, 61% (Tiny pores under the leaf.)",
                   "[chloroplasts / chloroplast]", "- [Myth] Plants only breathe at night.", "   [x] CO2",
                   "Estimate: What share", "answer 50 % (within 10%)", "[mistake] They release nitrogen as a by-product. -> They release oxygen.",
                   "1. How many oxygen atoms in CO2? = 2 (hint: Read the formula.)", "Reward: You are out!"):
        assert needle in out, needle


def test_markdown_variants_of_experiences():
    lines = md.experience_lines
    assert lines("expSequence", {"variant": "timeline", "items": [{"text": "a", "detail": "1492"}, {"text": "b"}]}) == [
        "Sequence", "Correct order (timeline):", "1. a [1492]", "2. b"]
    assert lines("expMatch", {"mode": "memory", "pairs": []}) == ["Match pairs", "Pairs (memory game):"]
    assert lines("expHotspot", {"mode": "explore", "spots": [{"label": "L", "x": 1, "y": 2, "correct": False}]}) == [
        "Hotspot", "Image: none yet (explore)", "[ ] L at 1%, 2%"]
    assert lines("expGaps", {"mode": "bank", "text": "a [[b]]"}) == ["Fill the gaps", "Word bank. a [b]"]
    assert lines("expMythFact", {"labels": {"true": "Vrai", "false": "Faux"}, "statements": [{"text": "x", "isTrue": True}]})[1] == "- [Vrai] x"
    assert lines("expSpeedRound", {"lives": 0, "questions": [{"prompt": "p", "options": "bad"}]}) == [
        "Speed round", "10s per question, lives: unlimited", "1. p"]
    assert lines("expEstimate", {"question": "q", "min": 1, "max": 2, "answer": 1}) == ["Estimate: q", "Range 1 to 2, answer 1 (within 10%)"]
    assert lines("expSpotMistake", {"instructions": "Find it", "segments": [{"text": "a", "isMistake": True}]}) == [
        "Spot the mistake", "Find it", "[mistake] a"]
    assert lines("expCodeLock", {"clues": [{"question": "q", "answer": 7}]}) == ["Code lock", "1. q = 7"]
    grid = {"type": "flipcardGrid", "attrs": {"title": "Deck", "mode": "study"},
            "content": [{"type": "flipcard", "attrs": {"question": "a", "answer": "b"}}]}
    assert md.block_comment(grid, [0])[1] == 'Flipcard grid "Deck" (study mode), 1 cards:'
    scen = {"type": "scenarios", "attrs": {"title": "T", "display": "chat", "scenarios": []}}
    assert md.block_comment(scen, [0])[1] == 'Scenario "T" (chat), 0 steps.'


def test_flipcards_fence_deck_settings():
    inline = _inline
    node = fences.parse("flipcards", "mode: study\ntitle: Cells\nshuffle: yes\nATP :: Energy", inline)
    assert node["type"] == "flipcardGrid" and node["attrs"] == {"columns": 1, "mode": "study", "title": "Cells", "shuffle": True}
    # A card whose front looks like a setting stays a card.
    node = fences.parse("flipcards", "Title :: The name\nMode :: How", inline)
    assert [c["attrs"]["question"] for c in node["content"]] == ["Title", "Mode"] and set(node["attrs"]) == {"columns"}
    assert fences.parse("flipcards", "shuffle: no\na :: b", inline)["attrs"]["shuffle"] is False
    with pytest.raises(fences.FenceError, match="mode"):
        fences.parse("flipcards", "mode: deck\na :: b", inline)
    lines = fences.render(node | {"attrs": {"columns": 2, "mode": "study", "title": "Deck", "shuffle": True}}, md.inline_markdown)
    assert lines[1:5] == ["columns: 2", "mode: study", "title: Deck", "shuffle: true"]
    plain = fences.render(node | {"attrs": {"columns": 2, "mode": "grid", "title": "", "shuffle": False}}, md.inline_markdown)
    assert plain[1] == "columns: 2" and not any(x.startswith(("mode", "title", "shuffle")) for x in plain)
    assert not fences.renders(node | {"attrs": {"columns": 2, "title": "a :: b"}})
    assert not fences.renders(node | {"attrs": {"columns": 2, "mode": "deck"}})


def test_scenario_fence_keeps_new_fields_or_steps_aside():
    chat = fences.parse("scenario", "title: T\ndisplay: chat\n# a\nHello\n- Bye", _inline)
    assert chat["attrs"]["display"] == "chat"
    assert fences.renders(chat) and "display: chat" in fences.render(chat, md.inline_markdown)
    assert "display" not in fences.parse("scenario", "# a\nHello", _inline)["attrs"]
    with pytest.raises(fences.FenceError, match="display"):
        fences.parse("scenario", "display: comic\n# a\nHello", _inline)
    story = copy.deepcopy(chat)
    story["attrs"]["display"] = "story"
    assert fences.renders(story)  # the editor's default, same as no display
    with_feedback = copy.deepcopy(chat)
    with_feedback["attrs"]["scenarios"][0]["options"][0]["feedback"] = "See you"
    assert not fences.renders(with_feedback)  # kept as a block comment, nothing lost
    ending = copy.deepcopy(chat)
    ending["attrs"]["scenarios"][0]["ending"] = {"tone": "success"}
    assert not fences.renders(ending)


def test_learner_preview_never_shows_answers():
    built = _built()
    preview = "\n".join(line for n in built.values() for line in course_quality._learner_lines(n))
    for needle in ("**Sort it: Sort it**", "- [Cellular respiration]", "Match with: Carries water | Let gases in",
                   "[Image: find 1 place(s)]", "Plants make sugar in the ____ using ____.", "2 statement(s)",
                   "2 timed question(s), 10s each.", "Slider from 0 to 100 %.", "🔒 How many oxygen atoms in CO2?"):
        assert needle in preview, needle
    assert "Needs light ->" not in preview and "= 2" not in preview and "chloroplasts" not in preview
    lines = course_quality._experience_learner_lines
    assert lines("expMatch", {"mode": "memory", "pairs": [{"left": "a", "right": "b"}]})[-1] == "2 face-down cards to pair up."
    assert lines("expHotspot", {"mode": "explore", "spots": [{"label": "Heart"}]})[-1] == "1. Heart"
    assert lines("expGaps", {"mode": "bank", "text": "[[b|c]] and [[a]]"})[-1] == "Word bank: a, b"
    assert lines("expMythFact", {})[-1] == "0 statement(s), one at a time. First: "
    assert lines("expSpotMistake", {"kind": "code", "segments": [{"text": "x = 1"}]})[-3:] == ["```", "x = 1", "```"]
    assert lines("expEstimate", {"question": "How far?", "min": 1, "max": 2}) == ["**Estimate: How far?**", "Slider from 1 to 2."]
    assert lines("expCodeLock", {"title": "Vault"}) == ["**Code lock: Vault**"]
    grid = {"type": "flipcardGrid", "attrs": {"title": "Deck", "mode": "study"},
            "content": [{"type": "flipcard", "attrs": {"question": "a", "answer": "b"}}]}
    assert course_quality._learner_lines(grid)[:2] == ["**Deck**", "(study mode: one card at a time)"]


def test_experiences_count_as_practice_and_are_described():
    assert set(exp.NODE_NAMES) <= set(course_audit.PRACTICE)
    for name in exp.NODE_NAMES:
        entry = cb.CATALOG[name]
        assert d.strict_problems(entry["example"]) == [], name
        assert entry["example"]["type"] == name
    assert cb._LOOKUP[cb._key("fill_gaps")] == "expGaps"
    assert cb._LOOKUP[cb._key("expCodeLock")] == "expCodeLock"
    assert cb._LOOKUP[cb._key("code")] == "codeBlock"


# ─── shared helpers ──────────────────────────────────────────────────────────


def test_gap_parsing_matches_the_editor():
    assert exp.gap_answers("The [[cat|kitty| cat ]] sat on the [[mat]].") == [["cat", "kitty"], ["mat"]]
    assert exp.gap_answers(r"Use [[arr[0]]] and [[a\|b|c]] and \[[not]]") == [["arr[0]"], ["a|b", "c"]]
    assert exp.gap_answers("[[ | ]] empty, [[unclosed") == []
    assert exp.gap_answers("[[across\n\nparagraphs]]") == []
    assert exp.gap_answers("[[a]b]]") == [["a]b"]]
    assert exp.gap_answers(None) == []
    assert exp.gap_tokens(r"x \\ [[y]] z") == ["x \\ ", ["y"], " z"]
    assert exp.gaps_text("A [[b|c]] d", answers=True) == "A [b / c] d"
    assert exp.gaps_text("A [[b|c]] d", answers=False) == "A ____ d"
    assert exp.split_answers(r"a\\|b") == ["a\\", "b"]


def test_helpers_walk_and_text():
    attrs = {"title": "T", "items": [{"text": "a", "explanation": "e"}, "junk", {"text": 3}], "labels": {"true": "F"}}
    got = [owner[key] for owner, key in exp.strings(attrs, "expSort")]
    assert got == ["T", "a", "e"]
    assert [o[k] for o, k in exp.strings({"questions": [{"prompt": "p", "options": ["x", 2, "y"]}]}, "expSpeedRound")] == ["p", "x", "y"]
    assert [o[k] for o, k in exp.strings({"labels": {"true": "F"}, "statements": "bad"}, "expMythFact")] == ["F"]
    assert list(exp.strings("bad", "expSort")) == [] and list(exp.strings({}, "paragraph")) == []
    assert list(exp.walk({"a": 1}, [])) == [] and list(exp.walk({"a": [1]}, "a.*")) == []
    assert exp.items([{"a": 1}, 2]) == [{"a": 1}] and exp.items("x") == []
    assert (exp.text(True), exp.text(4), exp.text(2.5), exp.text(" a "), exp.text(None)) == ("", "4", "2.5", "a", "")
