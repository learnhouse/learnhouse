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
        "notes": "Inline content is text (marks: bold, italic, strike, underline, code, link {href}) and hardBreak. Code text takes no other mark.",
    },
    "heading": {
        "use": "Section title.",
        "add": "Markdown: ## Title",
        "attrs": {"level": "1 to 6"},
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
        "attrs": {"language": "e.g. python, js, sql"},
        "example": {"type": "codeBlock", "attrs": {"language": "python"}, "content": [{"type": "text", "text": "print('hi')"}]},
        "notes": "Plain text only, no marks.",
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
        "notes": "Cell paths are [table, row, cell]; a cell holds blocks.",
    },
    "callout": {
        "use": "Highlighted note box.",
        "add": "insert {callout: {type, markdown}} or Markdown: > [!TIP] text (NOTE, TIP, WARNING, CAUTION, SUCCESS).",
        "attrs": {"type": "info | tip | warning | success | error", "dismissible": "true lets learners hide it"},
        "example": {"type": "callout", "attrs": {"type": "tip", "dismissible": False}, "content": [_p("Turn on versioning before you need it.")]},
        "notes": "Holds paragraphs and lists only (never bare text). Change the style with set_attrs {type}.",
    },
    "blockMathEquation": {
        "use": "Display math (LaTeX, rendered with KaTeX).",
        "add": "Markdown: $$ ... $$ on their own lines.",
        "attrs": {"math_equation": "LaTeX source"},
        "example": {"type": "blockMathEquation", "attrs": {"math_equation": "E = mc^2"}},
        "notes": "There is no inline math; $...$ inside a sentence stays text.",
    },
    "blockQuiz": {
        "use": "Multiple-choice check for understanding (ungraded).",
        "add": (
            "Markdown: ```quiz fence (several questions, blank line between), or insert "
            "{quiz: {questions: [{text, options: [{text, correct}]}]}}; ids are generated."
        ),
        "attrs": {
            "quizId": "string id or null",
            "questions": "[{question_id, question, type: multiple_choice, response_type: single|multiple, answers: [{answer_id, answer, correct}]}]",
        },
        "example": {"type": "blockQuiz", "attrs": {"quizId": "quiz_example", "questions": [{
            "question_id": "question_1", "question": "Where does S3 store objects?",
            "type": "multiple_choice", "response_type": "single",
            "answers": [
                {"answer_id": "answer_1", "answer": "In buckets", "correct": True},
                {"answer_id": "answer_2", "answer": "On EC2 disks", "correct": False},
            ],
        }]}},
        "notes": "2 to 12 answers, at least one correct; two or more correct make it select-all. set_attrs {questions} also accepts the simple shape and keeps existing ids.",
    },
    "flipcard": {
        "use": "Click-to-reveal card for recall.",
        "add": "Markdown fence: ```flipcards with one card per line as Front :: Back (optional columns: 3, color: green), or insert {node}.",
        "attrs": {"question": "front", "answer": "back", "color": "blue, green, red, ...", "alignment": "left | center | right", "size": "small | medium | large"},
        "example": {"type": "flipcard", "attrs": {"question": "What is a bucket?", "answer": "A container for objects.", "color": "blue", "alignment": "center", "size": "medium"}},
        "notes": "Wrap several in a flipcardGrid {attrs: {columns: 2}, content: [flipcards]} to show them side by side.",
    },
    "flipcardGrid": {
        "use": "Flipcards side by side.",
        "add": "A ```flipcards fence with several cards makes one, or insert {node}.",
        "attrs": {"columns": "1 to 6"},
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
        "attrs": {"link": "http(s) URL", "emoji": "one emoji", "color": "blue, ...", "alignment": "left | center | right"},
        "example": {"type": "button", "attrs": {"emoji": "🔗", "link": "https://docs.aws.amazon.com/s3/", "color": "blue", "alignment": "left"}, "content": [{"type": "text", "text": "Open the docs"}]},
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
        "use": "Branching decision scenario.",
        "add": "Markdown: ```scenario fence, or insert {node}.",
        "attrs": {"title": "name", "scenarios": "[{id, text, imageUrl, options: [{id, text, nextScenarioId or null}]}]"},
        "example": {"type": "scenarios", "attrs": {"title": "Pick a storage class", "scenarios": [
            {"id": "1", "text": "Data is read every minute. Which class?", "imageUrl": "", "options": [
                {"id": "o1", "text": "Standard", "nextScenarioId": "2"},
                {"id": "o2", "text": "Glacier", "nextScenarioId": "1"},
            ]},
            {"id": "2", "text": "Right: hot data belongs in Standard.", "imageUrl": "", "options": [
                {"id": "o3", "text": "Finish", "nextScenarioId": None},
            ]},
        ]}},
        "notes": "Every nextScenarioId names an existing step id or is null (end).",
    },
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
    "media": {
        "use": "Image, video, audio or PDF (blockImage, blockVideo, blockAudio, blockPDF).",
        "add": "Markdown: ![alt](url) line or ```image/pdf/audio/video fence (approval), or add_media_block.",
        "notes": (
            "The file is fetched from its public URL and stored; until then it shows as a link, and a "
            "file that fails stays a link. Raw nodes cannot point at files. set_attrs can change an "
            "image's alignment or size {width} later."
        ),
    },
}

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
        "text), --- hint and --- file <name> (extra files) sections. Indentation in code is kept."
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
        "blocks": [{"type": name, "use": e["use"], "add": e["add"]} for name, e in CATALOG.items()],
        "read_only": _READ_ONLY,
        "detail": "Call again with type=<name> for shape, fence rules and an example.",
    }


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="describe_activity_blocks",
        title="Page block types",
        description=(
            "List the block types a page can hold (text, lists, tables, callouts, quizzes, "
            "flipcards, math, embeds, code exercises, media) and how to add each. Pass type for "
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
