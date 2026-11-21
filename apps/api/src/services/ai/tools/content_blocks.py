"""The block palette of a page: what each block is, how to add it, and its
exact editor shape.

Shapes here are what edit_activity_content accepts (and its validator
checks, see doc_ops.SCHEMA); every example is a valid node. Without a type
the tool returns a short catalog; with one, the full shape and an example.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, Field

from src.security.rbac import AccessAction
from src.services.ai.tools import doc_ops as d
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.fences import LANGUAGES


def _p(text: str) -> dict:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def _li(text: str) -> dict:
    return {"type": "listItem", "content": [_p(text)]}


_TYPED = "Typed block {type: '%s', ...} (see typed_block) in add_blocks, build_course or an insert {blocks: [...]} (no fence)."
_BID = {"blockId": "unique id (any string; a uuid)"}
_HEAD = {**_BID, "title": "short title", "instructions": "one line for learners"}

# Experiences: interactive learning blocks. Their data lives in attrs; the
# typed blocks generate every id, so prefer them over raw nodes.
EXPERIENCE_CATALOG: dict[str, dict[str, Any]] = {
    "expSort": {
        "use": "Sort it: learners drag items into 2 to 4 categories (categorisation, interleaving).",
        "add": _TYPED % "sort",
        "attrs": {**_HEAD, "categories": "[{id, label, color: sky|amber|emerald|rose}] (2 to 4)",
                  "items": "[{id, text, categoryId, explanation?}] (2 to 20)", "shuffle": "true/false"},
        "example": {"type": "expSort", "attrs": {"blockId": "b1", "title": "Sort it", "instructions": "", "shuffle": True,
                    "categories": [{"id": "c1", "label": "Mammal", "color": "sky"}, {"id": "c2", "label": "Bird", "color": "amber"}],
                    "items": [{"id": "i1", "text": "Bat", "categoryId": "c1", "explanation": "Bats feed their young milk."},
                              {"id": "i2", "text": "Penguin", "categoryId": "c2"}]}},
        "notes": "Every categoryId names a category id.",
    },
    "expSequence": {
        "use": "Sequence: put steps or events in order (causal reasoning, processes, timelines).",
        "add": _TYPED % "sequence",
        "attrs": {**_HEAD, "items": "[{id, text, detail?}] (3 to 10) in the CORRECT order", "variant": "list | timeline"},
        "example": {"type": "expSequence", "attrs": {"blockId": "b2", "title": "Order the steps", "instructions": "", "variant": "list",
                    "items": [{"id": "s1", "text": "Plan"}, {"id": "s2", "text": "Build"}, {"id": "s3", "text": "Test"}]}},
        "notes": "Learners get the items shuffled; timeline reveals each detail (e.g. a year) after checking.",
    },
    "expMatch": {
        "use": "Match pairs: connect terms to definitions, causes to effects; memory mode is a card game.",
        "add": _TYPED % "match_pairs",
        "attrs": {**_HEAD, "pairs": "[{id, left, right}] (2 to 8)", "mode": "connect | memory"},
        "example": {"type": "expMatch", "attrs": {"blockId": "b3", "title": "Match", "instructions": "", "mode": "connect",
                    "pairs": [{"id": "p1", "left": "H2O", "right": "Water"}, {"id": "p2", "left": "NaCl", "right": "Salt"}]}},
    },
    "expHotspot": {
        "use": "Hotspot: find the right places on an image (find), or a labelled diagram (explore).",
        "add": _TYPED % "hotspot",
        "attrs": {**_HEAD, "imageUrl": "http(s) image URL", "imageObject": "uploaded file object (set by the editor)",
                  "spots": "[{id, x, y, r, label, explanation?, correct}]: x, y = % of width/height, r = % of width",
                  "mode": "find | explore"},
        "example": {"type": "expHotspot", "attrs": {"blockId": "b4", "title": "Find the heart", "instructions": "", "mode": "find",
                    "imageUrl": "https://example.org/body.png",
                    "spots": [{"id": "h1", "x": 48, "y": 35, "r": 8, "label": "Heart", "correct": True}]}},
    },
    "expGaps": {
        "use": "Fill the gaps: recall words in context (retrieval practice).",
        "add": _TYPED % "fill_gaps",
        "attrs": {**_BID, "title": "short title", "text": "text with gaps as [[answer|other accepted answer]]",
                  "mode": "type | bank (word bank)", "caseSensitive": "true/false"},
        "example": {"type": "expGaps", "attrs": {"blockId": "b5", "title": "Fill the gaps", "mode": "type", "caseSensitive": False,
                    "text": "Water boils at [[100]] degrees [[Celsius|C]]."}},
        "notes": "A backslash makes [, ] and | literal.",
    },
    "expMythFact": {
        "use": "Myth or fact: a swipeable true/false deck that tackles misconceptions.",
        "add": _TYPED % "myth_fact",
        "attrs": {**_BID, "title": "short title", "statements": "[{id, text, isTrue, explanation}] (2 to 20)",
                  "labels": '{"true": "Fact", "false": "Myth"}'},
        "example": {"type": "expMythFact", "attrs": {"blockId": "b6", "title": "Myth or fact?", "labels": {"true": "Fact", "false": "Myth"},
                    "statements": [{"id": "m1", "text": "Goldfish forget in 3 seconds.", "isTrue": False, "explanation": "They remember for months."},
                                   {"id": "m2", "text": "Octopuses have three hearts.", "isTrue": True, "explanation": "Two pump blood to the gills."}]}},
    },
    "expSpeedRound": {
        "use": "Speed round: timed rapid-fire questions with points, combos and lives.",
        "add": _TYPED % "speed_round",
        "attrs": {**_BID, "title": "short title", "questions": "[{id, prompt, options: [2 to 4 texts], answer: index}] (up to 30)",
                  "secondsPerQuestion": "3 to 120", "lives": "0 (unlimited) to 10"},
        "example": {"type": "expSpeedRound", "attrs": {"blockId": "b7", "title": "Quick fire", "secondsPerQuestion": 10, "lives": 3,
                    "questions": [{"id": "q1", "prompt": "2 + 2", "options": ["3", "4"], "answer": 1}]}},
    },
    "expEstimate": {
        "use": "Estimate: learners predict a number on a slider before the reveal (prequestioning).",
        "add": _TYPED % "estimate",
        "attrs": {**_BID, "question": "the question", "min": "number", "max": "number", "step": "number > 0",
                  "answer": "number between min and max", "unit": "e.g. km", "tolerancePct": "0 to 100 (3 stars within it)",
                  "explanation": "shown after the reveal"},
        "example": {"type": "expEstimate", "attrs": {"blockId": "b8", "question": "How tall is Everest?", "min": 0, "max": 15000,
                    "step": 100, "answer": 8849, "unit": "m", "tolerancePct": 10, "explanation": "8,849 m since 2020."}},
    },
    "expSpotMistake": {
        "use": "Spot the mistake: click the wrong sentences or code lines (error detection).",
        "add": _TYPED % "spot_mistake",
        "attrs": {**_HEAD, "segments": "[{id, text, isMistake, correction?, explanation?}] in reading order",
                  "kind": "text | code (monospace lines)"},
        "example": {"type": "expSpotMistake", "attrs": {"blockId": "b9", "title": "Spot the mistake", "instructions": "", "kind": "text",
                    "segments": [{"id": "g1", "text": "The sun is a star.", "isMistake": False},
                                 {"id": "g2", "text": "It orbits the Earth.", "isMistake": True, "correction": "The Earth orbits it."}]}},
    },
    "expCodeLock": {
        "use": "Code lock: a mini escape room; each solved clue opens one dial, then a reward shows.",
        "add": _TYPED % "code_lock",
        "attrs": {**_BID, "title": "short title", "story": "the setup", "clues": "[{id, question, answer, hint}] (1 to 5)",
                  "reward": "text shown when the lock opens"},
        "example": {"type": "expCodeLock", "attrs": {"blockId": "b10", "title": "Escape", "story": "Solve the clues.", "reward": "Well done!",
                    "clues": [{"id": "k1", "question": "Legs on a spider?", "answer": "8", "hint": "More than an insect."}]}},
        "notes": "Answers are short text or numbers (up to 40 characters), matched trimmed and case-insensitive.",
    },
    "expVenn": {
        "use": "Venn compare: place facts in two overlapping circles (only A, both, only B, optionally neither) to compare and contrast.",
        "add": _TYPED % "venn",
        "attrs": {**_HEAD, "sets": "{a: {label, color}, b: {label, color}}; color: sky|amber|emerald|rose|violet",
                  "items": "[{id, text, zone: a|b|both|neither, explanation?}] (3 to 16)",
                  "showNeither": "true shows an 'outside both' tray (needed for zone neither)"},
        "example": {"type": "expVenn", "attrs": {"blockId": "b11", "title": "Frogs or toads?", "instructions": "", "showNeither": False,
                    "sets": {"a": {"label": "Frogs", "color": "emerald"}, "b": {"label": "Toads", "color": "amber"}},
                    "items": [{"id": "v1", "text": "Smooth, moist skin", "zone": "a"},
                              {"id": "v2", "text": "Dry, bumpy skin", "zone": "b"},
                              {"id": "v3", "text": "Lay eggs in water", "zone": "both", "explanation": "Both are amphibians."}]}},
    },
    "expLabel": {
        "use": "Label the diagram: drag labels onto numbered pins on an image.",
        "add": _TYPED % "label_diagram",
        "attrs": {**_HEAD, "imageUrl": "http(s) image URL", "imageObject": "uploaded file object (set by the editor)",
                  "pins": "[{id, x, y, label}]: x, y = % of width/height (2 to 12)",
                  "distractors": "[wrong labels] (0 to 4)"},
        "example": {"type": "expLabel", "attrs": {"blockId": "b12", "title": "Label the plant", "instructions": "",
                    "imageUrl": "https://example.org/plant.png", "distractors": ["Petal"],
                    "pins": [{"id": "p1", "x": 50, "y": 20, "label": "Flower"}, {"id": "p2", "x": 50, "y": 85, "label": "Roots"}]}},
        "notes": "Labels are matched by text (trimmed, case-insensitive); a distractor must not equal a pin label.",
    },
    "expWordGuess": {
        "use": "Word guess: guess a key term from its clue, with letter feedback after each try.",
        "add": _TYPED % "word_guess",
        "attrs": {**_BID, "title": "short title", "words": "[{id, answer, clue, explanation?}] (1 to 8)",
                  "maxGuesses": "3 to 8 (default 6)"},
        "example": {"type": "expWordGuess", "attrs": {"blockId": "b13", "title": "Guess the word", "maxGuesses": 6,
                    "words": [{"id": "w1", "answer": "atom", "clue": "The tiny building block of matter.", "explanation": "Everything is made of atoms."}]}},
        "notes": "Answers are 2 to 12 letters (spaces and hyphens shown fixed); matching ignores accents and case.",
    },
    "expConfidence": {
        "use": "Confidence check: answer, say how sure you are, then see accuracy per confidence level (calibration).",
        "add": _TYPED % "confidence_check",
        "attrs": {**_BID, "title": "short title",
                  "questions": "[{id, prompt, options: [2 to 4 texts], answer: index, explanation}] (1 to 10)"},
        "example": {"type": "expConfidence", "attrs": {"blockId": "b14", "title": "How sure are you?",
                    "questions": [{"id": "c1", "prompt": "Closest planet to the Sun?", "options": ["Venus", "Mercury"], "answer": 1,
                                   "explanation": "Mercury orbits closest."}]}},
    },
    "expMatrix": {
        "use": "Property grid: tick which properties (columns) apply to each row.",
        "add": _TYPED % "property_grid",
        "attrs": {**_HEAD, "rows": "[{id, label}] (2 to 8)", "columns": "[{id, label}] (2 to 6)",
                  "cells": '{"rowId:colId": true} for each correct tick', "mode": "multi | single (exactly one per row)"},
        "example": {"type": "expMatrix", "attrs": {"blockId": "b15", "title": "Which apply?", "instructions": "", "mode": "multi",
                    "rows": [{"id": "r1", "label": "Whale"}, {"id": "r2", "label": "Shark"}],
                    "columns": [{"id": "k1", "label": "Mammal"}, {"id": "k2", "label": "Lives in water"}],
                    "cells": {"r1:k1": True, "r1:k2": True, "r2:k2": True}}},
        "notes": "Ids never contain ':'; every cells key names a row id and a column id.",
    },
    "expReflect": {
        "use": "Reflection: write in your own words, then compare with a model answer and tick the key points covered.",
        "add": _TYPED % "reflection",
        "attrs": {**_BID, "title": "short title", "prompt": "what to write about", "guidingQuestions": "[texts] (0 to 5)",
                  "minWords": "0 to 500 (default 30)", "modelAnswer": "optional", "checklist": "[key points] (0 to 8)"},
        "example": {"type": "expReflect", "attrs": {"blockId": "b16", "title": "In your own words", "prompt": "Why do seasons happen?",
                    "guidingQuestions": ["What does the tilt change?"], "minWords": 30,
                    "modelAnswer": "Earth's tilt changes how directly sunlight hits each hemisphere.",
                    "checklist": ["Axial tilt", "Angle of sunlight"]}},
        "notes": "The learner's draft stays on their device; give a model answer or key points to compare with.",
    },
}

# Experiences node -> its typed block name.
EXPERIENCE_CATALOG_TYPED = {
    "expSort": "sort", "expSequence": "sequence", "expMatch": "match_pairs", "expHotspot": "hotspot",
    "expGaps": "fill_gaps", "expMythFact": "myth_fact", "expSpeedRound": "speed_round",
    "expEstimate": "estimate", "expSpotMistake": "spot_mistake", "expCodeLock": "code_lock",
    "expVenn": "venn", "expLabel": "label_diagram", "expWordGuess": "word_guess",
    "expConfidence": "confidence_check", "expMatrix": "property_grid", "expReflect": "reflection",
}

# type -> purpose, how to add it, attrs (name -> meaning), example node
CATALOG: dict[str, dict[str, Any]] = {
    "paragraph": {
        "use": "Body text.",
        "add": "Markdown: plain lines.",
        "example": {"type": "paragraph", "content": [
            {"type": "text", "text": "Objects live in "},
            {"type": "text", "text": "buckets", "marks": [{"type": "bold"}]},
            {"type": "text", "text": "."},
        ]},
        "attrs": {"textAlign": "start | center | end | justify (omit for the default)"},
        "notes": "Inline content is text (marks: bold, italic, strike, underline, code, link {href}), hardBreak and inlineMath. Code text takes no other mark.",
    },
    "heading": {
        "use": "Section title.",
        "add": "Markdown: ## Title",
        "attrs": {"level": "1 to 6", "textAlign": "start | center | end | justify"},
        "example": {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Storage classes"}]},
    },
    "bulletList": {
        "use": "Bulleted list (orderedList: numbered, attrs.start).",
        "add": "Markdown: - item / 1. item, nested by indentation.",
        "attrs": {"start": "orderedList only: first number"},
        "example": {"type": "bulletList", "content": [_li("First point"), _li("Second point")]},
        "notes": "Holds listItem nodes; a listItem holds a paragraph first, then any blocks (nested lists). Item paths are [list, item].",
    },
    "blockquote": {
        "use": "Quoted passage.",
        "add": "Markdown: > text",
        "example": {"type": "blockquote", "content": [_p("Simplicity is prerequisite for reliability.")]},
    },
    "codeBlock": {
        "use": "Code listing (not runnable; see blockCode).",
        "add": "Markdown: ```python fences",
        "attrs": {
            "language": "e.g. python, js, sql", "filename": "optional", "showLineNumbers": "true/false",
            "highlightLines": 'e.g. "2,4-6"', "wrap": "true wraps long lines",
        },
        "example": {"type": "codeBlock", "attrs": {"language": "python"}, "content": [{"type": "text", "text": "print('hi')"}]},
        "notes": "Plain text only, no marks. In Markdown, options follow the language: ```python {lines wrap highlight=2,4-6}.",
    },
    "horizontalRule": {"use": "Divider.", "add": "Markdown: ---", "example": {"type": "horizontalRule"}},
    "table": {
        "use": "Table.",
        "add": "Markdown: | a | b | rows with a |---|---| separator.",
        "example": {"type": "table", "content": [
            {"type": "tableRow", "content": [
                {"type": "tableHeader", "content": [_p("Class")]},
                {"type": "tableHeader", "content": [_p("Use")]},
            ]},
            {"type": "tableRow", "content": [
                {"type": "tableCell", "content": [_p("Standard")]},
                {"type": "tableCell", "content": [_p("Hot data")]},
            ]},
        ]},
        "attrs": {
            "variant": "default | striped | bordered | minimal | cards (rows stack on phones)", "caption": "text",
            "headerColumn / stickyHeader / sortable / compact": "true/false", "totals": "none | sum | average",
            "cell attrs": (
                "cellType text | progress | checkbox | rating | status | number | date; background and tone "
                "(gray, red, orange, amber, green, teal, blue, purple, pink); align start | center | end; "
                "valign top | middle | bottom; numberFormat plain | percent | currency | compact; currency (USD)"
            ),
        },
        "notes": (
            "Cell paths are [table, row, cell]; a cell holds blocks. A typed cell keeps its value as its text: "
            "progress '75', checkbox 'yes'/'no', rating '4/5', status 'Done', number '1200', date '2026-03-01'. "
            "Typed blocks: {type: table, column_types: [...]}."
        ),
    },
    "callout": {
        "use": "Highlighted note box.",
        "add": "insert {callout: {type, markdown}} or Markdown: > [!TIP] text (NOTE, TIP, WARNING, CAUTION, SUCCESS).",
        "attrs": {
            "type": "info | tip | warning | success | error", "dismissible": "true lets learners hide it",
            "title": "bold title", "collapsible": "true: opens on click (with defaultOpen)",
            "kind": "note | question | example | quote (newer looks; type keeps the closest of the five)",
            "tone": "gray, red, orange, amber, green, teal, blue, purple, pink (custom colour)",
        },
        "example": {"type": "callout", "attrs": {"type": "tip", "dismissible": False}, "content": [_p("Turn on versioning before you need it.")]},
        "notes": "Holds paragraphs and lists only (never bare text). Change the style with set_attrs {type}; set_attrs {type: note} stores kind note with type info.",
    },
    "blockMathEquation": {
        "use": "Display math (LaTeX, rendered with KaTeX).",
        "add": "Markdown: $$ ... $$ on their own lines.",
        "attrs": {"math_equation": "LaTeX source"},
        "example": {"type": "blockMathEquation", "attrs": {"math_equation": "E = mc^2"}},
        "notes": "For a formula inside a sentence use an inlineMath node in the paragraph; Markdown $...$ stays text.",
    },
    "blockQuiz": {
        "use": "Multiple-choice check for understanding (ungraded).",
        "add": (
            "Markdown: ```quiz fence (several questions, blank line between), or insert "
            "{quiz: {questions: [{text, options: [{text, correct}]}]}}; ids are generated."
        ),
        "attrs": {
            "quizId": "string id or null",
            "questions": (
                "[{question_id, question, type, response_type: single|multiple, answers: [{answer_id, answer, correct}], explanation}]; "
                "type multiple_choice (default), true_false (answers True then False), short_answer (answers [], "
                "accepted_answers, accent_insensitive) or numeric (answers [], correct_value, tolerance)"
            ),
            "settings": "null or {passMark: 0-100, showExplanations: true/false, ...}",
        },
        "example": {"type": "blockQuiz", "attrs": {"quizId": "quiz_example", "questions": [{
            "question_id": "question_1", "question": "Where does S3 store objects?",
            "type": "multiple_choice", "response_type": "single",
            "answers": [
                {"answer_id": "answer_1", "answer": "In buckets", "correct": True},
                {"answer_id": "answer_2", "answer": "On EC2 disks", "correct": False},
            ],
        }]}},
        "notes": (
            "Options questions: 2 to 12 answers, at least one correct; two or more correct make it select-all. "
            "set_attrs {questions} also accepts the simple shape ({text, options} or {text, type: true_false, answer} / "
            "{text, type: short_answer, accepted_answers} / {text, type: numeric, correct_value, tolerance}) and keeps existing ids."
        ),
    },
    "flipcard": {
        "use": "Click-to-reveal card for recall.",
        "add": "Markdown fence: ```flipcards with one card per line as Front :: Back (optional columns: 3, color: green), or insert {node}.",
        "attrs": {"question": "front", "answer": "back", "color": "blue, green, red, ...", "alignment": "left | center | right", "size": "small | medium | large"},
        "example": {"type": "flipcard", "attrs": {"question": "What is a bucket?", "answer": "A container for objects.", "color": "blue", "alignment": "center", "size": "medium"}},
        "notes": "Wrap several in a flipcardGrid {attrs: {columns: 2}, content: [flipcards]} to show them side by side.",
    },
    "flipcardGrid": {
        "use": "Flipcards side by side, or a study deck.",
        "add": "A ```flipcards fence with several cards makes one, or insert {node}.",
        "attrs": {"columns": "1 to 6", "mode": "grid (default) | study", "title": "deck title", "shuffle": "true/false"},
        "notes": "Study mode shows one card at a time with Again / Hard / Got it. Fence settings: mode: study, title: ..., shuffle: true.",
        "example": {"type": "flipcardGrid", "attrs": {"columns": 2}, "content": [
            {"type": "flipcard", "attrs": {"question": "Hot data?", "answer": "S3 Standard"}},
            {"type": "flipcard", "attrs": {"question": "Archive?", "answer": "Glacier"}},
        ]},
    },
    "badge": {
        "use": "Small labelled pill.",
        "add": "Markdown fence: ```badge with the text on one line (optional color: green, emoji: ⭐), or insert {node}.",
        "attrs": {"color": "sky, green, red, amber, ...", "emoji": "one emoji"},
        "example": {"type": "badge", "attrs": {"color": "sky", "emoji": "⭐"}, "content": [{"type": "text", "text": "Key concept"}]},
    },
    "button": {
        "use": "Call-to-action link button.",
        "add": "Markdown fence: ```button with [Label](https://...) on one line (optional color: green, align: center), or insert {node}.",
        "attrs": {
            "link": "http(s) URL", "emoji": "one emoji", "color": "blue, ...", "alignment": "left | center | right",
            "variant": "solid | outline | soft | link", "size": "sm | md | lg",
        },
        "example": {"type": "button", "attrs": {"emoji": "🔗", "link": "https://docs.aws.amazon.com/s3/", "color": "blue", "alignment": "left"}, "content": [{"type": "text", "text": "Open the docs"}]},
    },
    "buttonGroup": {
        "use": "Several buttons in a row.",
        "add": "insert {node}.",
        "attrs": {"alignment": "left | center | right"},
        "example": {"type": "buttonGroup", "attrs": {"alignment": "left"}, "content": [
            {"type": "button", "attrs": {"emoji": "📄", "link": "https://example.org/notes.pdf", "color": "blue", "alignment": "left"}, "content": [{"type": "text", "text": "Notes"}]},
            {"type": "button", "attrs": {"emoji": "🧪", "link": "https://example.org/lab", "color": "blue", "alignment": "left", "variant": "outline"}, "content": [{"type": "text", "text": "Lab"}]},
        ]},
    },
    "blockEmbed": {
        "use": "Embedded YouTube, Vimeo, Loom, Figma, CodePen, Google Maps, ...",
        "add": "Markdown fence: ```embed with the video or page URL on one line (optional height: 400), or insert {node}.",
        "attrs": {"embedUrl": "embeddable http(s) URL", "embedType": "url (embedUrl) or code (embedCode)", "embedHeight": "pixels", "embedWidth": "e.g. 100%", "alignment": "left | center | right", "embedCode": "raw iframe code instead of embedUrl"},
        "example": {"type": "blockEmbed", "attrs": {"embedUrl": "https://www.youtube.com/embed/aqz-KE-bpKQ", "embedType": "url", "embedHeight": 400, "embedWidth": "100%", "alignment": "center"}},
        "notes": "The fence turns shared YouTube, Vimeo and Loom links into embed URLs; raw nodes need the provider's embed URL (YouTube: /embed/<id>).",
    },
    "blockWebPreview": {
        "use": "Link card for a web page.",
        "add": "Markdown: ```preview fence, or insert {node}.",
        "attrs": {"url": "http(s) URL", "title": "optional", "description": "optional", "showButton": "true/false", "buttonLabel": "button text"},
        "example": {"type": "blockWebPreview", "attrs": {"url": "https://aws.amazon.com/s3/", "title": "Amazon S3"}},
    },
    "scenarios": {
        "use": "Branching decision scenario (story or chat).",
        "add": "Markdown: ```scenario fence, or insert {node}.",
        "attrs": {
            "title": "name", "display": "story (default) | chat (messaging-style)",
            "scenarios": "[{id, text, imageUrl, options: [{id, text, nextScenarioId or null, feedback?, outcome?}], ending?: {tone, title}}]",
        },
        "example": {"type": "scenarios", "attrs": {"title": "Pick a storage class", "scenarios": [
            {"id": "1", "text": "Data is read every minute. Which class?", "imageUrl": "", "options": [
                {"id": "o1", "text": "Standard", "nextScenarioId": "2"},
                {"id": "o2", "text": "Glacier", "nextScenarioId": "1"},
            ]},
            {"id": "2", "text": "Right: hot data belongs in Standard.", "imageUrl": "", "options": [
                {"id": "o3", "text": "Finish", "nextScenarioId": None},
            ]},
        ]}},
        "notes": (
            "Every nextScenarioId names an existing step id or is null (end). Optional: option feedback "
            "(shown after picking it), outcome success|neutral|fail (when it ends the story), and a step "
            "ending {tone: success|neutral|fail, title} for steps without options."
        ),
    },
    **EXPERIENCE_CATALOG,
    "blockCode": {
        "use": "Runnable coding exercise (learners write and run code).",
        "add": "Markdown: ```exercise fence, or insert {node}.",
        "attrs": {"languageId": "Judge0 id: 71 Python 3, 63 JavaScript, 62 Java, 54 C++, 50 C, 60 Go, 73 Rust", "languageName": "matches languageId", "starterCode": "code shown first", "description": "the task", "testCases": "[] or [{id, label, stdin, expectedStdout}]", "hints": "list of strings", "solutionCode": "optional", "difficulty": "easy | medium | hard"},
        "example": {"type": "blockCode", "attrs": {"languageId": 71, "languageName": "Python 3", "starterCode": "print('hello')\n", "description": "Print hello.", "difficulty": "easy", "testCases": []}},
        "notes": "Use insert {node} only for a SQLite database (sqliteDbPath), which the fence lacks.",
    },
    "blockMagic": {
        "use": "Self-contained interactive HTML widget (sandboxed).",
        "add": "Markdown: ```widget fence, or insert {node}.",
        "attrs": {"blockUuid": "unique string", "title": "name", "height": "pixels", "htmlContent": "full HTML document, inline CSS/JS"},
        "example": {"type": "blockMagic", "attrs": {"blockUuid": "mb_example", "title": "Cost calculator", "height": 400, "htmlContent": "<!DOCTYPE html><html><body><p>Widget</p></body></html>"}},
    },
    "blockH5P": {
        "use": "Embedded H5P activity.",
        "add": "Markdown: ```h5p fence, or insert {node}.",
        "attrs": {"h5pUrl": "http(s) URL of the H5P embed", "title": "name", "height": "pixels"},
        "example": {"type": "blockH5P", "attrs": {"h5pUrl": "https://h5p.org/h5p/embed/712", "title": "Drag the words"}},
    },
    "toggleBlock": {
        "use": "Collapsible section (worked answers, optional depth).",
        "add": "Typed block {type: toggle, summary, blocks}, or insert {node}.",
        "attrs": {"summary": "the line learners click", "defaultOpen": "true starts open", "variant": "default | bordered | filled", "icon": "chevron | plus"},
        "example": {"type": "toggleBlock", "attrs": {"summary": "Show the answer", "defaultOpen": False}, "content": [_p("42.")]},
    },
    "tabs": {
        "use": "Parallel views of one topic (per language, role or option); learners see one tab at a time.",
        "add": "Typed block {type: tabs, tabs: [{title, blocks}]}, or insert {node}.",
        "attrs": {"blockId": "unique id", "variant": "line | pills | boxed"},
        "example": {"type": "tabs", "attrs": {"blockId": "tabs_example", "variant": "line"}, "content": [
            {"type": "tabItem", "attrs": {"title": "Python"}, "content": [_p("Use boto3.")]},
            {"type": "tabItem", "attrs": {"title": "CLI"}, "content": [_p("Use aws s3 cp.")]},
        ]},
        "notes": "Holds 2 to 8 tabItem {attrs: {title}, content: blocks}. Tab paths are [tabs, tab]; a tab's blocks [tabs, tab, i].",
    },
    "columns": {
        "use": "Content side by side (comparisons, text beside an example); stacks on phones.",
        "add": "Typed block {type: columns, columns: [{blocks}]}, or insert {node}.",
        "attrs": {"layout": "1-1 | 1-2 | 2-1 | 1-1-1 | 1-1-1-1 (matches the column count)", "gap": "sm | md | lg", "stackOnMobile": "true", "verticalAlign": "top | center | bottom"},
        "example": {"type": "columns", "attrs": {"layout": "1-1", "gap": "md", "stackOnMobile": True, "verticalAlign": "top"}, "content": [
            {"type": "column", "content": [_p("Standard: hot data.")]},
            {"type": "column", "content": [_p("Glacier: archives.")]},
        ]},
        "notes": "Holds 2 to 4 column nodes, each holding blocks.",
    },
    "accordion": {
        "use": "A stack of collapsible sections (FAQs).",
        "add": "Typed block {type: accordion, items: [{summary, blocks}]}, or insert {node}.",
        "attrs": {"single": "true opens one at a time", "variant": "default | bordered | filled"},
        "example": {"type": "accordion", "attrs": {"single": True, "variant": "default"}, "content": [
            {"type": "toggleBlock", "attrs": {"summary": "Is S3 durable?", "defaultOpen": False}, "content": [_p("Eleven nines.")]},
        ]},
        "notes": "Holds toggleBlock nodes only.",
    },
    "timeline": {
        "use": "Ordered steps, dates or stages.",
        "add": "Typed block {type: timeline, steps: [{title, label, text}]}, or insert {node}.",
        "attrs": {"variant": "steps | timeline | process", "numbered": "true/false", "orientation": "vertical | horizontal"},
        "example": {"type": "timeline", "attrs": {"variant": "steps", "numbered": True, "orientation": "vertical"}, "content": [
            {"type": "timelineItem", "attrs": {"title": "Create a bucket", "label": ""}, "content": [_p("Pick a region.")]},
            {"type": "timelineItem", "attrs": {"title": "Upload", "label": ""}, "content": [_p("Drag files in.")]},
        ]},
        "notes": "Holds timelineItem {attrs: {title, label, icon, tone}, content: blocks}; tone neutral, blue, teal, green, amber, rose.",
    },
    "tableOfContents": {
        "use": "A live list of the page's headings.",
        "add": "insert {node}.",
        "attrs": {"title": "empty shows 'Contents'", "maxLevel": "2 | 3 | 4", "numbered": "true/false"},
        "example": {"type": "tableOfContents", "attrs": {"title": "", "maxLevel": 3, "numbered": False}},
    },
    "keyTakeaways": {
        "use": "Summary card, usually at the end of a page.",
        "add": "Typed block {type: key_takeaways, points: [...]}, or insert {node}.",
        "attrs": {"title": "empty shows 'Key takeaways'", "tone": "neutral | blue | teal | green | amber | rose", "icon": "lightbulb, star, check, target, flag, book, rocket, key"},
        "example": {"type": "keyTakeaways", "attrs": {"title": "", "tone": "amber"}, "content": [
            {"type": "bulletList", "content": [_li("Buckets hold objects."), _li("Pick the class by access pattern.")]},
        ]},
    },
    "taskList": {
        "use": "Checklist learners can tick (kept in their browser).",
        "add": "Typed block {type: checklist, items: [...]}, or insert {node}.",
        "attrs": {"blockId": "unique id", "learnerCanCheck": "true/false"},
        "example": {"type": "taskList", "attrs": {"blockId": "check_example", "learnerCanCheck": True}, "content": [
            {"type": "taskItem", "attrs": {"checked": False}, "content": [_p("Create a bucket")]},
            {"type": "taskItem", "attrs": {"checked": False}, "content": [_p("Upload a file")]},
        ]},
        "notes": "Holds taskItem {attrs: {checked}, content: paragraphs}.",
    },
    "gallery": {
        "use": "Several pictures as a grid, carousel or masonry, with a lightbox.",
        "add": "Typed block {type: gallery, images: [{url, alt, caption}]}, or insert {node}.",
        "attrs": {"blockId": "unique id", "layout": "grid | carousel | masonry", "columns": "2 | 3 | 4", "images": "[{id, url, alt, caption}] (linked pictures; uploads keep their blockObject)"},
        "example": {"type": "gallery", "attrs": {"blockId": "gal_example", "layout": "grid", "columns": 2, "images": [
            {"id": "img_1", "url": "https://example.org/a.jpg", "alt": "A bucket diagram"},
            {"id": "img_2", "url": "https://example.org/b.jpg", "alt": "The console", "caption": "Console"},
        ]}},
    },
    "imageCompare": {
        "use": "Before/after slider over two pictures.",
        "add": "Typed block {type: image_compare, before: {url, label}, after: {url, label}}, or insert {node}.",
        "attrs": {"before / after": "{url, label, alt}", "start": "divider position 0-100", "orientation": "horizontal | vertical"},
        "example": {"type": "imageCompare", "attrs": {"before": {"url": "https://example.org/old.png", "label": "Before"}, "after": {"url": "https://example.org/new.png", "label": "After"}, "start": 50, "orientation": "horizontal"}},
    },
    "chart": {
        "use": "A small data set as a chart.",
        "add": "Typed block {type: chart, chart, labels, series}, or insert {node}.",
        "attrs": {
            "type": "bar | column | line | area | pie | donut", "title": "text",
            "data": "{labels: [text], series: [{name, values: [one number per label], tone}]}",
            "showLegend / showValues / stacked": "true/false",
        },
        "example": {"type": "chart", "attrs": {"type": "column", "title": "Cost per GB", "data": {"labels": ["Standard", "Glacier"], "series": [{"name": "USD", "values": [0.023, 0.004], "tone": None}]}, "showLegend": True, "showValues": False, "stacked": False}},
    },
    "statHighlights": {
        "use": "Two to four headline numbers.",
        "add": "Typed block {type: stat_highlights, stats: [...]}, or insert {node}.",
        "attrs": {"items": "[{id, value (text, e.g. '99.9'), label, description, prefix, suffix, tone}]", "columns": "2 | 3 | 4", "animate": "true counts up"},
        "example": {"type": "statHighlights", "attrs": {"items": [{"id": "s1", "value": "99.99", "suffix": "%", "label": "Availability"}], "columns": 2, "animate": True}},
    },
    "fileCard": {
        "use": "Download card for a file.",
        "add": "Typed block {type: file_card, url, name}, or insert {node}.",
        "attrs": {"url": "http(s) link", "name": "shown name", "description": "optional", "sizeBytes": "optional", "fileType": "pdf, doc, sheet, slides, archive, image, audio, video, text, code, file"},
        "example": {"type": "fileCard", "attrs": {"url": "https://example.org/cheatsheet.pdf", "name": "S3 cheat sheet.pdf", "fileType": "pdf"}},
        "notes": "An uploaded file (blockObject) is added in the editor.",
    },
    "quoteBlock": {
        "use": "Pull quote or testimonial with an author.",
        "add": "Typed block {type: quote, text, author, role}, or insert {node}.",
        "attrs": {"variant": "pull | testimonial | highlight", "author": "name", "role": "e.g. job title", "avatarUrl": "http(s) picture"},
        "example": {"type": "quoteBlock", "attrs": {"variant": "pull", "author": "Werner Vogels"}, "content": [_p("Everything fails, all the time.")]},
        "notes": "Holds paragraphs only. A plain > quote is a blockquote.",
    },
    "inlineMath": {
        "use": "A formula inside a sentence (KaTeX).",
        "add": "insert {node} with a paragraph holding it.",
        "attrs": {"latex": "LaTeX source"},
        "example": {"type": "inlineMath", "attrs": {"latex": "x^2"}},
        "notes": "Inline: it sits in a paragraph or heading next to text.",
    },
    "media": {
        "use": "Image, video, audio or PDF (blockImage, blockVideo, blockAudio, blockPDF).",
        "add": "Markdown: ![alt](url) line or ```image/pdf/audio/video fence (approval), or add_media_block.",
        "notes": (
            "The file is fetched from its public URL and stored; until then it shows as a link, and a "
            "file that fails stays a link. Raw nodes cannot point at files. set_attrs can change an "
            "image's alignment, size {width} or frame (none, rounded, shadow, border, polaroid) later."
        ),
    },
}

# Layout and data blocks, listed by name only in the short catalog.
LAYOUT_BLOCKS = (
    "tabs", "columns", "accordion", "timeline", "toggleBlock", "keyTakeaways", "taskList", "tableOfContents",
    "gallery", "imageCompare", "chart", "statHighlights", "fileCard", "quoteBlock", "buttonGroup", "inlineMath",
)

# The fence syntax, shown once in the catalog so a model can write rich
# blocks straight into a page's Markdown (parsed in fences.py).
FENCES = {
    "quiz": "```quiz\nQ: Where does photosynthesis happen?\n- [x] In the chloroplasts\n- [ ] In the nucleus\n> Chloroplasts hold the chlorophyll.\n\nQ: Next question...\n- [x] ...\n- [ ] ...\n```",
    "flipcards": "```flipcards\ncolumns: 3\nStomata :: Pores that let gases in and out\nXylem :: Tubes that carry water up\n```",
    "embed": "```embed\nhttps://www.youtube.com/watch?v=aqz-KE-bpKQ\nheight: 400\n```",
    "button": "```button\n[Open the lab sheet](https://example.org/lab.pdf)\ncolor: green\n```",
    "badge": "```badge\nKey idea\nemoji: ⭐\n```",
    "exercise": (
        "```exercise\nlanguage: python\nPrint the sum of two input numbers.\n--- starter\na = int(input())\n"
        "--- solution\nprint(int(input()) + int(input()))\n--- test Small\ninput:\n2\n3\noutput:\n5\n"
        "--- hint\nUse int().\n```"
    ),
    "scenario": (
        "```scenario\ntitle: Storage\n# start\nData is read every minute. Which class?\n"
        "- Standard -> right\n- Glacier -> start\n# right\nRight: hot data belongs in Standard.\n- Finish\n```"
    ),
    "preview": "```preview\nhttps://aws.amazon.com/s3/\ntitle: Amazon S3\nbutton: Visit S3\n```",
    "h5p": "```h5p\nhttps://h5p.org/h5p/embed/712\ntitle: Drag the words\n```",
    "widget": "```widget\ntitle: Calculator\nheight: 500\n<!DOCTYPE html><html>...</html>\n```",
    "media": "![Leaf](https://example.org/leaf.jpg)",
}

# How each fence reads, beyond its example.
FENCE_RULES = {
    "exercise": (
        "Settings first (language: one of " + ", ".join(a[0] for _i, _n, a in LANGUAGES)
        + "; difficulty: easy|medium|hard; attempts: tries before the solution shows; timed: 10m; "
        "time limit: 5s per run; time complexity: / space complexity: expected), then the task, then "
        "--- starter, --- solution, --- test <label> (input: and output: lines, each followed by its "
        "text; end the label with (hidden) to hide that test's input and output from learners), --- hint and --- file <name> (extra files) sections. Indentation in code is kept."
    ),
    "scenario": (
        "Each step starts with '# <step name>', then its text, an optional image: <url>, then "
        "options as '- text -> <step name>'. An option without -> (or -> end) ends the scenario."
    ),
    "media": (
        "An image alone on its line, or ```image / ```video (a .mp4/.webm file; other links embed) / "
        "```audio / ```pdf with the URL, then caption:, width: and align: (image), height: (pdf). "
        "Top level only, at most 20 per call; fetching needs the user's approval."
    ),
    "preview, h5p, widget": (
        "They show outside content or run custom HTML, so adding one needs the user's approval. "
        "A widget is one full HTML document with inline CSS and JS, after title: and height:."
    ),
}

# Block type -> the fence that writes it.
_FENCE_OF = {
    "blockQuiz": "quiz", "flipcard": "flipcards", "flipcardGrid": "flipcards", "blockEmbed": "embed",
    "button": "button", "badge": "badge", "blockCode": "exercise", "scenarios": "scenario",
    "blockWebPreview": "preview", "blockH5P": "h5p", "blockMagic": "widget", "media": "media",
}

_ALIASES = {
    "orderedList": "bulletList", "listItem": "bulletList", "tableRow": "table", "tableCell": "table",
    "tableHeader": "table", "blockImage": "media", "blockVideo": "media", "blockAudio": "media",
    "blockPDF": "media", "image": "media", "video": "media", "audio": "media", "pdf": "media",
    "quiz": "blockQuiz", "math": "blockMathEquation", "embed": "blockEmbed", "code": "codeBlock",
    "youtube": "blockEmbed", "vimeo": "blockEmbed", "iframe": "blockEmbed", "flashcard": "flipcard",
    "linkPreview": "blockWebPreview", "exercise": "blockCode", "codeExercise": "blockCode",
    "note": "callout", "alert": "callout", "equation": "blockMathEquation", "list": "bulletList",
    "sort": "expSort", "sequence": "expSequence", "match_pairs": "expMatch", "matching": "expMatch",
    "hotspot": "expHotspot", "fill_gaps": "expGaps", "gaps": "expGaps", "cloze": "expGaps",
    "myth_fact": "expMythFact", "true_false": "expMythFact", "speed_round": "expSpeedRound",
    "estimate": "expEstimate", "spot_mistake": "expSpotMistake", "code_lock": "expCodeLock",
    "escape_room": "expCodeLock", "venn": "expVenn", "compare": "expVenn", "label_diagram": "expLabel",
    "label": "expLabel", "diagram": "expLabel", "word_guess": "expWordGuess", "wordle": "expWordGuess",
    "confidence_check": "expConfidence", "confidence": "expConfidence", "property_grid": "expMatrix",
    "matrix": "expMatrix", "reflection": "expReflect", "reflect": "expReflect",
    "toggle": "toggleBlock", "tab": "tabs", "tabItem": "tabs", "column": "columns", "timelineItem": "timeline",
    "toc": "tableOfContents", "key_takeaways": "keyTakeaways", "summary": "keyTakeaways", "checklist": "taskList",
    "taskItem": "taskList", "todo": "taskList", "image_compare": "imageCompare", "before_after": "imageCompare",
    "stat_highlights": "statHighlights", "stats": "statHighlights", "file_card": "fileCard", "file": "fileCard",
    "download": "fileCard", "testimonial": "quoteBlock", "pullQuote": "quoteBlock", "graph": "chart",
    "buttonRow": "buttonGroup", "faq": "accordion",
}

def _key(name: str) -> str:
    """Spelling-insensitive key: blockFlipcard, flip_card and Flipcards all
    name the same block."""
    key = "".join(c for c in name.lower() if c.isalnum())
    key = key.removeprefix("block") or key
    return key.removesuffix("s") if key.endswith("s") and key[:-1] else key


# Exact names first, then aliases (blockCode, the runnable exercise, and
# codeBlock, the listing, share a key; the alias "code" means the listing).
_LOOKUP = {
    **{_key(name): name for name in CATALOG},
    **{_key(alias): target for alias, target in _ALIASES.items()},
}

_READ_ONLY ="blockUser (member card), blockLibrary (library item), youtube and calloutInfo / calloutWarning (older blocks) can be read, moved and deleted, not created."


class DescribeBlocksParams(BaseModel):
    type: str | None = Field(
        None, max_length=40, description="A block type (e.g. blockQuiz, callout) for its exact shape and an example."
    )


async def _describe_activity_blocks(ctx: ToolContext, p: DescribeBlocksParams):
    if p.type:
        name = p.type if p.type in CATALOG else _LOOKUP.get(_key(p.type))
        if name is None:
            raise HTTPException(
                status_code=400,
                detail=f"No block type '{p.type}'. Pass one of: {', '.join(CATALOG)}, or omit type for the catalog.",
            )
        entry = {"type": name, **CATALOG[name]}
        spec = d.SCHEMA.get(name)
        if spec is not None:
            entry["content"] = spec.content or "none (data lives in attrs)"
        typed = EXPERIENCE_CATALOG_TYPED.get(name)
        if typed:
            # The typed block to send in an insert op ({blocks: [...]}) or add_blocks.
            from src.services.ai.tools import block_specs as bs

            entry["typed_block"] = bs.catalog(typed)
        fence = _FENCE_OF.get(name)
        if fence:
            entry["fence"] = FENCES[fence]
            rules = next((r for k, r in FENCE_RULES.items() if fence in k.split(", ")), None)
            if rules:
                entry["fence_rules"] = rules
        return entry
    return {
        "page": "A page is {type: doc, content: [blocks]}. Paths: [i] is a top-level block, [i, j] a child of it.",
        "how": (
            "Write Markdown (create_course or create_activities pages, write_activity_content, or "
            "edit_activity_content insert {markdown}). The rich blocks below are Markdown fences, "
            "so a whole page, images included, fits in one call; else insert {node}. "
            "Media, preview, h5p and widget need approval."
        ),
        "fences": FENCES,
        "blocks": [
            {"type": name, "use": e["use"], "add": e["add"]}
            for name, e in CATALOG.items() if name not in EXPERIENCE_CATALOG and name not in LAYOUT_BLOCKS
        ],
        "experiences": (
            "Interactive typed blocks (insert {blocks: [...]} or add_blocks; no fence): " + ", ".join(EXPERIENCE_CATALOG_TYPED.values())
            + "; plus scenarios (display: chat) and flashcards (mode: study)."
        ),
        "layout_blocks": " ".join(LAYOUT_BLOCKS) + " (typed blocks or insert {node})",
        "read_only": _READ_ONLY,
        "detail": "Call again with type=<name> for shape, fence rules and an example.",
    }


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="describe_activity_blocks",
        title="Page block types",
        description=(
            "List the block types a page can hold (text, lists, tables, callouts, quizzes, "
            "flipcards, math, embeds, code exercises, media, tabs, columns, accordions, timelines, "
            "checklists, charts, galleries, and interactive Experiences such as sort, sequence, "
            "match pairs, fill the gaps, myth or fact and reflection) and how to add each. Pass type for "
            "one block's exact editor shape and a valid example."
        ),
        params_model=DescribeBlocksParams,
        tier=ActionTier.READ,
        rights_bucket=None,
        access_action=AccessAction.READ,
        execute=_describe_activity_blocks,
        idempotent=True,
    ),
]
