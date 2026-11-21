"""Editor Plus content in the RAG index and in page translations."""

import copy

from src.services.ai.rag.sources import dynamic
from src.services.courses.translations import content as c
from src.tests.services.editor_plus_fixtures import plus_page


# ─── RAG ─────────────────────────────────────────────────────────────────────


def test_rag_text_of_every_new_block():
    text = dynamic.extract_text_from_prosemirror(plus_page())
    for expected in (
        "## Photosynthesis",
        "Energy is $E=mc^2$ here.",
        "Team progress\nTask | Status | Progress\nWrite | Done | 75",
        "Remember\nLight is energy.",
        "Light\nLight reactions.\nDark\nCalvin cycle.",
        "Plants\nAnimals",
        "Why green?\nReflection.",
        "Step 1 Absorb\nLight hits.",
        "Remember this\n- Plants make sugar.",
        "- Read\n- Practice Twice",
        "A leaf. Green leaf\nChloroplast",
        "Image comparison: Summer: Green tree / Autumn",
        "Chart: Growth\nHeight: Low 4, High 15.5\nWidth: Low 1, High 2",
        "92% Completion: of learners\n~4.8 Rating",
        "File: Worksheet. Print it.",
        "> It clicked.\n— Sam, Designer",
        "Explanation: Chlorophyll reflects green light.",
        "Quiz question: Name the green pigment.\nExplanation: It absorbs red and blue.",
        "Quiz question: How many CO2 per glucose?",
    ):
        assert expected in text, expected
    # Never the answer key of typed questions, nor the table of contents.
    assert not any("- chlorophyll" in line or line.strip() == "chlorophyll" for line in text.splitlines())
    assert "42" not in text and "On this page" not in text
    assert "6" not in text.split("How many CO2 per glucose?")[1]


def test_rag_edge_cases_of_new_blocks():
    text = dynamic.extract_text_from_prosemirror({"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "inlineMath", "attrs": {}}]},
        {"type": "toggleBlock", "attrs": {}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "body"}]}]},
        {"type": "callout", "attrs": {"type": "info"}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "plain"}]}]},
        {"type": "tabItem", "attrs": {}, "content": []},
        {"type": "quoteBlock", "attrs": {}, "content": []},
        {"type": "gallery", "attrs": {"images": ["x", {}]}},
        {"type": "imageCompare", "attrs": {"before": "x"}},
        {"type": "chart", "attrs": {"data": {"labels": ["a", "b"], "series": ["x", {"values": "bad"}]}}},
        {"type": "chart", "attrs": {"title": "Only names", "data": {"series": [{"name": "s", "values": []}]}}},
        {"type": "statHighlights", "attrs": {"items": ["x", {"value": 3, "label": "Things"}, {"label": "No value"}]}},
        {"type": "fileCard", "attrs": {}},
        {"type": "taskItem", "content": [{"type": "paragraph"}]},
    ]})
    assert text.splitlines() == ["body", "plain", "a, b", "Chart: Only names", "s", "3 Things", "No value"]


# ─── translations ────────────────────────────────────────────────────────────


def test_translation_segments_of_new_attrs():
    segs = c.iter_segments(plus_page())
    attrs: dict = {}
    for seg in segs:
        if seg.kind == "attr":
            attrs.setdefault((seg.node_type, seg.attr_path), seg.text)
    for key, value in {
        ("table", ("caption",)): "Team progress",
        ("callout", ("title",)): "Remember",
        ("tabItem", ("title",)): "Light",
        ("timelineItem", ("label",)): "Step 1",
        ("tableOfContents", ("title",)): "On this page",
        ("keyTakeaways", ("title",)): "Remember this",
        ("chart", ("data", "labels", 1)): "High",
        ("chart", ("data", "series", 0, "name")): "Height",
        ("statHighlights", ("items", 0, "description")): "of learners",
        ("gallery", ("images", 0, "caption")): "A leaf",
        ("imageCompare", ("before", "alt")): "Green tree",
        ("fileCard", ("description",)): "Print it.",
        ("quoteBlock", ("role",)): "Designer",
        ("blockQuiz", ("questions", 1, "accepted_answers", 0)): "chlorophyll",
        ("blockQuiz", ("questions", 0, "explanation")): "Chlorophyll reflects green light.",
    }.items():
        assert attrs.get(key) == value, key
    # Symbols, numbers and numeric answers are never sent for translation.
    assert ("statHighlights", ("items", 0, "suffix")) not in attrs
    assert ("blockQuiz", ("questions", 1, "accepted_answers", 1)) not in attrs
    assert not any("correct_value" in s.attr_path or "value" in s.attr_path for s in segs)
    math = next(s for s in segs if s.kind == "text" and s.text.startswith("Energy"))
    assert math.text == "Energy is <x1/> here." and math.atoms[1]["type"] == "inlineMath"


def test_translated_page_keeps_structure_and_answer_list_length():
    page = plus_page()
    segs = c.iter_segments(page)
    translated, report = c.apply_segments(page, {s.id: f"«{s.text}»" for s in segs})
    assert report["missing"] == [] and report["applied"] == len(segs)
    quiz = translated["content"][-1]["attrs"]["questions"]
    assert quiz[1]["accepted_answers"] == ["«chlorophyll»", "42"] and quiz[2]["correct_value"] == 6
    chart = next(n for n in translated["content"] if n["type"] == "chart")
    assert chart["attrs"]["data"]["labels"] == ["«Low»", "«High»"] and chart["attrs"]["data"]["series"][0]["values"] == [4, 15.5]
    stats = next(n for n in translated["content"] if n["type"] == "statHighlights")["attrs"]["items"]
    assert stats[0]["value"] == "92" and stats[0]["suffix"] == "%" and stats[1]["prefix"] == "~"
    para = translated["content"][1]
    assert para["attrs"] == {"textAlign": "justify"} and para["content"][1] == {"type": "inlineMath", "attrs": {"latex": "E=mc^2"}}
    stripped = copy.deepcopy(translated)
    assert c.current_translations(page, stripped)
