"""The compact block DSL behind the onboarding starter course."""

import pytest

from src.services.onboarding.content import ContentError, compile_document


def test_string_blocks_compile_to_their_nodes():
    doc = compile_document(["h2:Title", "h3:Sub", "p:Text", "info:Note", "warn:Careful", "p:"])
    types = [n["type"] for n in doc["content"]]
    assert types == ["heading", "heading", "paragraph", "calloutInfo", "calloutWarning", "paragraph"]
    assert doc["content"][0]["attrs"] == {"level": 2}
    assert doc["content"][1]["attrs"] == {"level": 3}
    assert "attrs" not in doc["content"][2]
    # An empty string has no text node at all.
    assert doc["content"][5]["content"] == []


def test_object_blocks_compile_to_their_nodes():
    doc = compile_document([
        {"h2": "Heading: with a colon"},
        {"info": "A full sentence."},
        {"ul": ["a", "b"]},
        {"ol": ["one"]},
        {"code": {"lang": "python", "text": "print(1)"}},
        {"rule": True},
    ])
    nodes = doc["content"]
    assert nodes[0] == {"type": "heading", "content": [{"type": "text", "text": "Heading: with a colon"}], "attrs": {"level": 2}}
    assert nodes[1]["type"] == "calloutInfo" and "attrs" not in nodes[1]
    assert nodes[2]["type"] == "bulletList" and len(nodes[2]["content"]) == 2
    assert nodes[3]["type"] == "orderedList"
    assert nodes[4] == {"type": "codeBlock", "attrs": {"language": "python"}, "content": [{"type": "text", "text": "print(1)"}]}
    assert nodes[5] == {"type": "horizontalRule"}


def test_quiz_ids_are_stable():
    body = [{"quiz": {"q": "Stable?", "a": [["Yes", True], ["No", False]]}}]
    first = compile_document(body)
    assert first == compile_document(body)
    quiz = first["content"][0]
    assert quiz["type"] == "blockQuiz"
    answers = quiz["attrs"]["questions"][0]["answers"]
    assert [a["correct"] for a in answers] == [True, False]


@pytest.mark.parametrize(
    "block",
    [
        "no prefix at all",
        "h9:not a heading level",
        {"nonsense": "value"},
        {"p": "a", "h2": "b"},
        42,
        {"quiz": {"a": [["Yes", True]]}},
        {"quiz": {"q": "Unanswerable?", "a": [["No", False]]}},
    ],
)
def test_bad_blocks_are_rejected(block):
    with pytest.raises(ContentError):
        compile_document([block])
