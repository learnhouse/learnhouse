"""Compact authoring DSL for demo activity bodies, compiled to ProseMirror.

Activity content in LearnHouse is a ProseMirror document. Writing ~90 of those
by hand as raw JSON would be unreviewable — a reader could not tell good course
copy from bad through four levels of node nesting — so the bundle authors
content in a compact form and compiles it here:

    [
      "h2:Why escalation matters",
      "p:Most tickets never need a second pair of eyes...",
      {"ul": ["The customer has asked twice", "Money is involved"]},
      {"info": "Escalating early is cheaper than escalating late."},
      {"quiz": {"q": "When should you escalate?",
                "a": [["As soon as you are stuck", true],
                      ["After the customer complains", false]]}},
    ]

Every id this module emits is derived with uuid5 from the text it belongs to.
That is not a stylistic choice: the demo is refreshed in place and compared
against its bundle, so if quiz ids were random the compiled content would
differ on every single refresh and each one would rewrite every activity in
the database — exactly the churn the design exists to avoid.
"""

import uuid
from typing import Any

# Fixed namespace so ids are stable across processes, machines and installs.
_NAMESPACE = uuid.UUID("6f1d6d4a-19f0-5a3e-9a1e-2f9c0f7b41d2")

# Node types the editor knows about. Compiling to anything outside this set
# produces a document the editor refuses to render, so an unknown prefix is a
# hard error at bundle-validation time rather than a blank activity in a demo.
_PREFIX_NODES = {
    "h2": ("heading", 2),
    "h3": ("heading", 3),
    "p": ("paragraph", None),
    "info": ("calloutInfo", None),
    "warn": ("calloutWarning", None),
}


class ContentError(ValueError):
    """A bundle authored a block this module cannot compile."""


def _stable_id(*parts: str) -> str:
    return str(uuid.uuid5(_NAMESPACE, "|".join(parts)))


def _text(value: str) -> list[dict]:
    """ProseMirror omits the text node entirely for an empty string."""
    return [{"type": "text", "text": value}] if value else []


def _paragraph(value: str) -> dict:
    return {"type": "paragraph", "content": _text(value)}


def _list(kind: str, items: list[str]) -> dict:
    return {
        "type": kind,
        "content": [
            {"type": "listItem", "content": [_paragraph(item)]} for item in items
        ],
    }


def _quiz(spec: dict) -> dict:
    question = spec.get("q", "")
    answers = spec.get("a") or []
    if not question:
        raise ContentError("quiz block needs a 'q'")
    if not any(correct for _, correct in answers):
        # A quiz with no correct answer can never be passed, and the block
        # reports every submission as wrong with no way for a learner to tell
        # why. Always an authoring mistake.
        raise ContentError(f"quiz {question!r} has no correct answer")

    return {
        "type": "blockQuiz",
        "attrs": {
            "quizId": _stable_id("quiz", question),
            "questions": [
                {
                    "question_id": _stable_id("question", question),
                    "question": question,
                    "type": "multiple_choice",
                    "answers": [
                        {
                            "answer_id": _stable_id("answer", question, text),
                            "answer": text,
                            "correct": bool(correct),
                        }
                        for text, correct in answers
                    ],
                }
            ],
        },
    }


def _compile_block(block: Any) -> dict:
    if isinstance(block, str):
        prefix, separator, value = block.partition(":")
        if not separator:
            raise ContentError(
                f"string block {block!r} must start with a prefix, e.g. 'p:'"
            )
        if prefix not in _PREFIX_NODES:
            raise ContentError(
                f"unknown block prefix {prefix!r} (have: {', '.join(sorted(_PREFIX_NODES))})"
            )
        node_type, level = _PREFIX_NODES[prefix]
        node: dict[str, Any] = {"type": node_type, "content": _text(value)}
        if level is not None:
            node["attrs"] = {"level": level}
        return node

    if not isinstance(block, dict) or len(block) != 1:
        raise ContentError(f"block {block!r} must be a string or a single-key object")

    (kind, payload), = block.items()

    # The text nodes are writable either way: "info:short note" reads well
    # inline, {"info": "..."} reads better when the text is a full sentence or
    # contains a colon of its own.
    if kind in _PREFIX_NODES:
        node_type, level = _PREFIX_NODES[kind]
        node = {"type": node_type, "content": _text(str(payload))}
        if level is not None:
            node["attrs"] = {"level": level}
        return node

    if kind == "ul":
        return _list("bulletList", payload)
    if kind == "ol":
        return _list("orderedList", payload)
    if kind == "quiz":
        return _quiz(payload)
    if kind == "code":
        return {
            "type": "codeBlock",
            "attrs": {"language": payload.get("lang")},
            "content": _text(payload.get("text", "")),
        }
    if kind == "rule":
        return {"type": "horizontalRule"}

    raise ContentError(f"unknown block kind {kind!r}")


def compile_document(blocks: list[Any]) -> dict:
    """Compile an authored block list into a ProseMirror document."""
    return {"type": "doc", "content": [_compile_block(block) for block in blocks]}


def plain_text(blocks: list[Any]) -> str:
    """Readable text of an authored body.

    Used for the reading-time estimate and to check that an activity actually
    says something, without teaching the caller the block DSL.
    """
    words: list[str] = []
    for block in blocks:
        if isinstance(block, str):
            _, _, value = block.partition(":")
            words.append(value)
        elif isinstance(block, dict):
            (kind, payload), = block.items()
            if kind in _PREFIX_NODES:
                words.append(str(payload))
            elif kind in ("ul", "ol"):
                words.extend(payload)
            elif kind == "quiz":
                words.append(payload.get("q", ""))
                words.extend(text for text, _ in payload.get("a") or [])
            elif kind == "code":
                words.append(payload.get("text", ""))
    return " ".join(w for w in words if w)
