"""Activity content authoring — block catalog + discovery tool.

Activity content is a TipTap editor document: ``{"type": "doc", "content":
[ ...block nodes... ]}``. Beyond standard prose nodes, LearnHouse ships
custom blocks (quiz, callout, flipcard, math, …). The agent has no way to
guess their JSON shape, so `describe_activity_blocks` returns the catalog
with a copy-pasteable example for each — call it before writing content.

The schemas here mirror the editor node definitions in
apps/web/components/Objects/Editor/Extensions/*. Asset blocks (image /
video / audio / pdf) are intentionally excluded: their `blockObject`
references an uploaded file and needs a dedicated upload tool.
"""

from __future__ import annotations

from pydantic import BaseModel

from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec

DOC_ENVELOPE = {
    "note": (
        "Activity content is a single TipTap document. Wrap all blocks in "
        '{"type": "doc", "content": [ ...blocks... ]}. Compose freely: mix '
        "prose (heading/paragraph/lists) with the custom blocks below."
    ),
    "example_doc": {
        "type": "doc",
        "content": [
            {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Section title"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "A paragraph of explanation."}]},
        ],
    },
}


# Every value is a real, renderable node example.
BLOCK_CATALOG: list[dict] = [
    {
        "node": "heading",
        "purpose": "Section heading. attrs.level is 1-4.",
        "example": {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Storage Classes"}]},
    },
    {
        "node": "paragraph",
        "purpose": "A paragraph of body text.",
        "example": {"type": "paragraph", "content": [{"type": "text", "text": "Amazon S3 stores data as objects in buckets."}]},
    },
    {
        "node": "bulletList",
        "purpose": "Unordered list. Each listItem wraps a paragraph.",
        "example": {
            "type": "bulletList",
            "content": [
                {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "First point"}]}]},
                {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Second point"}]}]},
            ],
        },
    },
    {
        "node": "orderedList",
        "purpose": "Numbered list. Same structure as bulletList.",
        "example": {
            "type": "orderedList",
            "content": [
                {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Step one"}]}]},
                {"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Step two"}]}]},
            ],
        },
    },
    {
        "node": "callout",
        "purpose": "Highlighted note box. attrs.type is one of info | warning | tip | success | error. Holds inline text.",
        "example": {"type": "callout", "attrs": {"type": "tip", "dismissible": False}, "content": [{"type": "text", "text": "Keep Block Public Access on unless you truly need public objects."}]},
    },
    {
        "node": "flipcard",
        "purpose": "A click-to-reveal flashcard. Good for definitions and quick recall.",
        "example": {"type": "flipcard", "attrs": {"question": "What is an S3 bucket?", "answer": "A globally-unique container for objects in a Region.", "color": "blue", "alignment": "center", "size": "medium"}},
    },
    {
        "node": "blockMathEquation",
        "purpose": "A KaTeX/LaTeX equation (attrs.math_equation is the LaTeX source).",
        "example": {"type": "blockMathEquation", "attrs": {"math_equation": "\\text{durability} = 99.999999999\\%"}},
    },
    {
        "node": "blockQuiz",
        "purpose": (
            "An interactive multiple-choice quiz. attrs.questions is a list of "
            "questions; each question has answers with a `correct` flag. "
            "question_id and answer_id must be unique non-empty strings within "
            "the document (use short slugs or uuids). Set quizId to null."
        ),
        "example": {
            "type": "blockQuiz",
            "attrs": {
                "quizId": None,
                "questions": [
                    {
                        "question_id": "q1",
                        "question": "Which statement about Amazon S3 is true?",
                        "type": "multiple_choice",
                        "answers": [
                            {"answer_id": "q1a1", "answer": "S3 stores data as objects in buckets", "correct": True},
                            {"answer_id": "q1a2", "answer": "S3 is a block storage service for EC2 disks", "correct": False},
                            {"answer_id": "q1a3", "answer": "S3 requires you to provision capacity in advance", "correct": False},
                        ],
                    }
                ],
            },
        },
        "notes": "Multiple answers may have correct=true (multi-select). Keep 2-5 answers per question.",
    },
]

ASSET_BLOCKS_NOTE = (
    "Image, video, audio and PDF blocks (blockImage/blockVideo/blockAudio/"
    "blockPDF) reference an uploaded file via a `blockObject` id and cannot "
    "be authored as plain JSON — use the dedicated add_*_block upload tools."
)


class DescribeBlocksParams(BaseModel):
    pass


async def _describe_activity_blocks(ctx: ToolContext, p: DescribeBlocksParams):
    return {
        "document": DOC_ENVELOPE,
        "blocks": BLOCK_CATALOG,
        "asset_blocks": ASSET_BLOCKS_NOTE,
        "how_to_use": (
            "Build the activity content by composing these node objects into "
            "the doc.content array, then pass the whole doc to create_activity "
            "or set_activity_content. Prefer a rich mix: headings, paragraphs, "
            "a callout for key warnings/tips, a flipcard or quiz to check "
            "understanding."
        ),
    }


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="describe_activity_blocks",
        description=(
            "List the content block types an activity can contain (quiz, "
            "callout, flipcard, math, headings, lists, …) with a JSON example "
            "for each. Call this BEFORE writing activity content so you can "
            "use rich blocks, not just paragraphs."
        ),
        params_model=DescribeBlocksParams,
        tier=ActionTier.READ,
        rights_bucket=None,
        access_action=AccessAction.READ,
        execute=_describe_activity_blocks,
    ),
]
