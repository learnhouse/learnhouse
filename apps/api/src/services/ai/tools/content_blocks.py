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
    {
        "node": "badge",
        "purpose": "A small inline pill/label with an emoji. Holds short text.",
        "example": {"type": "badge", "attrs": {"color": "sky", "emoji": "⭐"}, "content": [{"type": "text", "text": "Key concept"}]},
        "notes": "color is a tailwind-ish name (sky, green, red, amber, blue, purple, …).",
    },
    {
        "node": "button",
        "purpose": "A call-to-action link button with an emoji. Holds the label text.",
        "example": {"type": "button", "attrs": {"emoji": "🔗", "link": "https://aws.amazon.com/s3/", "color": "blue", "alignment": "left"}, "content": [{"type": "text", "text": "Open the S3 docs"}]},
    },
    {
        "node": "blockEmbed",
        "purpose": "Embed external content (YouTube, Figma, Loom, CodePen, GitHub gist, Giphy, Google Maps, Canva). Provide embedUrl (an embeddable URL) or raw embedCode (an iframe).",
        "example": {"type": "blockEmbed", "attrs": {"embedUrl": "https://www.youtube.com/embed/tp4gGvGl-mc", "embedType": "youtube", "embedCode": None, "embedHeight": 400, "embedWidth": "100%", "alignment": "center"}},
        "notes": "embedType is a hint like youtube|figma|loom|codepen|github|giphy|maps|canva. Use an /embed URL for YouTube.",
    },
    {
        "node": "blockWebPreview",
        "purpose": "A rich link-preview card for a web page.",
        "example": {"type": "blockWebPreview", "attrs": {"url": "https://aws.amazon.com/s3/", "title": "Amazon S3", "description": "Object storage built to store and retrieve any amount of data.", "og_image": None, "favicon": None, "og_type": None, "og_url": None, "alignment": "left", "showButton": True, "buttonLabel": "Visit Site", "openInPopup": False}},
        "notes": "Only url is required; title/description/og_image are optional and can be refreshed later.",
    },
    {
        "node": "blockUser",
        "purpose": "Embed an organization member's profile card.",
        "example": {"type": "blockUser", "attrs": {"user_id": "2"}},
        "notes": "user_id is the member's numeric id — resolve it first with list_org_users / resolve_entity(kind='user').",
    },
    {
        "node": "scenarios",
        "purpose": "A branching interactive scenario: nodes with options that link to other nodes. Great for decision-tree practice.",
        "example": {"type": "scenarios", "attrs": {"title": "Choose an S3 storage class", "scenarios": [
            {"id": "1", "text": "Your data is read constantly with low latency. Which class?", "imageUrl": "", "options": [
                {"id": "opt1", "text": "S3 Standard", "nextScenarioId": "2"},
                {"id": "opt2", "text": "Glacier Deep Archive", "nextScenarioId": "3"}]},
            {"id": "2", "text": "Correct — Standard fits hot, frequent access.", "imageUrl": "", "options": [
                {"id": "opt3", "text": "Finish", "nextScenarioId": None}]},
            {"id": "3", "text": "Not quite — Glacier is for cold archives with slow retrieval. Try again.", "imageUrl": "", "options": [
                {"id": "opt4", "text": "Back to start", "nextScenarioId": "1"}]}]}},
        "notes": "Every option.nextScenarioId must reference an existing scenario id, or be null to end. Node ids and option ids must be unique.",
    },
    {
        "node": "blockCode",
        "purpose": "An executable code-playground exercise (runs via Judge0). Learners write and run code against optional test cases.",
        "example": {"type": "blockCode", "attrs": {"mode": "simple", "languageId": 71, "languageName": "Python 3", "starterCode": "# Print the S3 bucket name\nprint('my-bucket')\n", "description": "Print your bucket name.", "difficulty": "easy", "testCases": [], "hints": [], "solutionCode": "", "maxAttemptsBeforeReveal": 3}},
        "notes": "languageId is a Judge0 id and MUST match languageName. Common ids: 71=Python 3, 63=JavaScript (Node), 62=Java, 54=C++, 50=C, 72=Ruby, 73=Rust, 60=Go. Leave testCases empty for a free-form playground.",
    },
    {
        "node": "blockMagic",
        "purpose": "A self-contained interactive HTML widget (rendered in a sandboxed iframe). Use for custom simulations/visualizations.",
        "example": {"type": "blockMagic", "attrs": {"blockUuid": "mb_example_1", "sessionUuid": None, "title": "S3 request calculator", "height": 400, "htmlContent": "<!DOCTYPE html><html><body><p>Interactive widget HTML goes here.</p></body></html>"}},
        "notes": "Normally produced by the Magic Blocks generator, but you may author a self-contained HTML document directly. blockUuid must be a unique string; keep htmlContent fully self-contained (inline CSS/JS, CDN libraries only).",
    },
]

ASSET_BLOCKS_NOTE = (
    "Image, video, audio and PDF blocks reference an uploaded file and cannot "
    "be authored as plain JSON. Add them from a public URL with the dedicated "
    "tools: add_image_block, add_video_block, add_pdf_block, add_audio_block "
    "(each takes the activity_uuid and the asset URL, uploads it, and appends "
    "the block to the activity)."
)


class DescribeBlocksParams(BaseModel):
    pass


async def _describe_activity_blocks(ctx: ToolContext, p: DescribeBlocksParams):
    return {
        "document": DOC_ENVELOPE,
        "blocks": BLOCK_CATALOG,
        "asset_blocks": ASSET_BLOCKS_NOTE,
        "how_to_use": (
            "Build NEW activity content by composing these node objects into "
            "the doc.content array, then pass the whole doc to create_activity. "
            "Prefer a rich mix: headings, paragraphs, a callout for key "
            "warnings/tips, a flipcard or quiz to check understanding. "
            "To EDIT an EXISTING activity, do not rebuild the whole doc — call "
            "read_activity_content to get each block's path, then patch just "
            "that block with edit_block_text / update_block_attrs / "
            "replace_block / insert_block / delete_block / move_block."
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
