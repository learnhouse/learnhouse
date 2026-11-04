"""Tests for src/services/courses/activities/utils.py.

These helpers flatten an activity's rich-text document into the plain-text
context handed to the AI assistant: headings, callouts and paragraphs are
pulled out of the editor JSON, then serialized into a single prompt string.
"""

from types import SimpleNamespace

from src.services.courses.activities.utils import (
    serialize_activity_text_to_ai_comprehensible_text,
    structure_activity_content_by_type,
)


def _text(t):
    return {"type": "text", "text": t}


class TestStructureActivityContentByType:
    def test_missing_or_empty_content_returns_empty_list(self):
        assert structure_activity_content_by_type({}) == []
        assert structure_activity_content_by_type({"content": []}) == []
        assert structure_activity_content_by_type({"content": None}) == []

    def test_extracts_headings_callouts_and_paragraphs(self):
        activity = {
            "content": [
                {"type": "heading", "content": [_text("Intro")]},
                {"type": "paragraph", "content": [_text("Hello world")]},
                {"type": "calloutInfo", "content": [_text("Note: "), _text("be careful")]},
                {"type": "calloutWarning", "content": [_text("Danger")]},
                {"type": "heading", "content": [_text("Outro")]},
            ]
        }
        assert structure_activity_content_by_type(activity) == [
            {"Headings": ["Intro", "Outro"]},
            {"Callouts": ["Note: be careful", "Danger"]},
            {"Paragraphs": ["Hello world"]},
        ]

    def test_skips_nodes_without_text(self):
        """Nodes with no content, non-text children, or unknown types are ignored."""
        activity = {
            "content": [
                {"type": "paragraph"},  # no "content" key at all
                {"type": "heading", "content": [{"type": "image"}]},
                {"type": "paragraph", "content": [{"type": "hardBreak"}]},
                # A callout is kept only when every child carries text.
                {"type": "calloutInfo", "content": [_text("a"), {"type": "image"}]},
                {"type": "codeBlock", "content": [_text("print(1)")]},
            ]
        }
        assert structure_activity_content_by_type(activity) == [
            {"Headings": []},
            {"Callouts": []},
            {"Paragraphs": []},
        ]


class TestSerializeActivityText:
    course = SimpleNamespace(name="Python 101")
    activity = SimpleNamespace(name="Loops")

    def test_empty_activity_says_there_is_no_content(self):
        text = serialize_activity_text_to_ai_comprehensible_text(
            [], self.course, self.activity, isActivityEmpty=True
        )
        assert '"Python 101"' in text
        assert '"Loops"' in text
        assert text.endswith("There is no content yet in this lecture.")

    def test_serializes_each_section(self):
        data = [
            {"Headings": ["Intro", "Outro"]},
            {"Callouts": ["Careful"]},
            {"Paragraphs": ["Hello", "World"]},
        ]
        text = serialize_activity_text_to_ai_comprehensible_text(
            data, self.course, self.activity
        )
        assert text == (
            'Use this as a context This is a course about "Python 101". '
            'This is a lecture about "Loops". '
            'These are the headings: "Intro Outro " '
            'These are the callouts: "Careful " '
            'These are the paragraphs: "Hello World "'
        )

    def test_round_trip_from_structured_content(self):
        structured = structure_activity_content_by_type(
            {"content": [{"type": "paragraph", "content": [_text("Only text")]}]}
        )
        text = serialize_activity_text_to_ai_comprehensible_text(
            structured, self.course, self.activity
        )
        assert 'These are the headings: ""' in text
        assert 'These are the paragraphs: "Only text "' in text
