"""Typed page blocks: every editor block written as a small JSON object with
documented fields, turned into the exact editor (TipTap) nodes and checked
against the editor schema (doc_ops) before anything is saved.

This is the structured twin of the Markdown fences: a model that would rather
fill fields than write fence syntax sends ``{"type": "quiz", "questions": [...]}``
and gets the same node the editor makes. Used by build_course, add_blocks and
validate_content (course_build.py), and documented by the block catalog
resource (``learnhouse://blocks``).

Files (image, audio, PDF, video files) are not stored here: they come back as
`markdown.Media` stand-ins that `content_assets.attach_media` fetches and swaps
in after the page exists, exactly like images written in Markdown.
"""

from __future__ import annotations

import re
import uuid
from typing import Annotated, Any, Literal, Union

from fastapi import HTTPException
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from sqlmodel import or_, select

from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import fences
from src.services.ai.tools import markdown as md
from src.services.ai.tools.embeds import PROVIDERS, parse_embed
from src.services.courses.activities.dynamic_content import FIELDS as RULE_FIELDS

MAX_BLOCKS = 300
MAX_NESTING = 3
Align = Literal["left", "center", "right"]
_VIDEO_FILE = re.compile(r"\.(?:mp4|webm|mov|m4v)(?:[?#]\S*)?$", re.I)


def _web_url(value: str | None) -> str | None:
    """http(s) only: no javascript:, data: or vbscript: links, whatever the case
    or leading spaces (the editor schema checks again on the finished node)."""
    if value is None or d.is_web_url(value):
        return value
    raise ValueError("must be an http(s) URL (https://...)")


WebUrl = Annotated[str, AfterValidator(_web_url)]


class _B(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MarkdownB(_B):
    type: Literal["markdown"]
    markdown: str = Field(..., min_length=1, max_length=md.MAX_CHARS, description="Any Markdown, fences included.")


class ParagraphB(_B):
    type: Literal["paragraph"]
    text: str = Field(..., min_length=1, max_length=20_000, description="Inline Markdown: **bold**, *italic*, `code`, [links](https://...).")


class HeadingB(_B):
    type: Literal["heading"]
    text: str = Field(..., min_length=1, max_length=300)
    level: int = Field(2, ge=1, le=6, description="2 for sections, 3 for subsections (1 is the page title).")


class ListB(_B):
    type: Literal["list"]
    items: list[str] = Field(..., min_length=1, max_length=200, description="One inline-Markdown item each.")
    ordered: bool = Field(False, description="true for a numbered list.")


class CalloutB(_B):
    type: Literal["callout"]
    style: Literal["info", "tip", "warning", "success", "error"] = "info"
    text: str = Field(..., min_length=1, max_length=20_000, description="Paragraphs and lists in Markdown.")
    dismissible: bool = Field(False, description="Learners may hide it.")


class CodeB(_B):
    type: Literal["code"]
    code: str = Field(..., min_length=1, max_length=100_000)
    language: str | None = Field(None, max_length=40, description="e.g. python, js, sql (highlighting only).")
    filename: str | None = Field(None, max_length=200)


class TableB(_B):
    type: Literal["table"]
    header: list[str] = Field(..., min_length=1, max_length=30, description="Header cells (inline Markdown).")
    rows: list[list[str]] = Field(default_factory=list, max_length=500, description="Body rows, same width as header.")


class MathB(_B):
    type: Literal["math"]
    latex: str = Field(..., min_length=1, max_length=10_000, description="Display LaTeX, rendered with KaTeX.")


class QuizOptionB(_B):
    text: str = Field(..., min_length=1, max_length=1000)
    correct: bool = False


class QuizQuestionB(_B):
    text: str = Field(..., min_length=1, max_length=2000)
    options: list[QuizOptionB] = Field(..., min_length=2, max_length=12, description="2 to 12; mark at least one correct (2+ = select all).")
    explanation: str | None = Field(None, max_length=2000)


class QuizB(_B):
    type: Literal["quiz"]
    questions: list[QuizQuestionB] = Field(..., min_length=1, max_length=50)


class CardB(_B):
    front: str = Field(..., min_length=1, max_length=2000)
    back: str = Field(..., min_length=1, max_length=2000)


class FlashcardsB(_B):
    type: Literal["flashcards"]
    cards: list[CardB] = Field(..., min_length=1, max_length=60)
    columns: int = Field(2, ge=1, le=6, description="Cards side by side (several cards).")
    color: Literal[fences.COLORS] = "blue"  # type: ignore[valid-type]


class ScenarioOptionB(_B):
    text: str = Field(..., min_length=1, max_length=500)
    next: str | None = Field(None, max_length=100, description="id of the step it leads to; null ends the scenario.")


class ScenarioStepB(_B):
    id: str = Field(..., min_length=1, max_length=100)
    text: str = Field(..., min_length=1, max_length=5000)
    image_url: WebUrl | None = Field(None, max_length=2048)
    options: list[ScenarioOptionB] = Field(default_factory=list, max_length=12)


class ScenarioB(_B):
    type: Literal["scenario"]
    title: str = Field(fences.SCENARIO_TITLE, max_length=500)
    steps: list[ScenarioStepB] = Field(..., min_length=1, max_length=100, description="The first step starts.")


class TestB(_B):
    label: str = Field("", max_length=200)
    input: str = Field("", max_length=20_000, description="stdin")
    output: str = Field(..., max_length=20_000, description="Expected stdout.")
    hidden: bool = False


class ExerciseB(_B):
    type: Literal["exercise"]
    language: str = Field("python", max_length=40, description="python, js, ts, java, cpp, c, rust, go, sql, ...")
    task: str = Field(..., min_length=1, max_length=20_000, description="What to do (Markdown).")
    starter: str = Field("", max_length=50_000)
    solution: str = Field("", max_length=50_000)
    tests: list[TestB] = Field(default_factory=list, max_length=fences.MAX_TESTS)
    hints: list[str] = Field(default_factory=list, max_length=fences.MAX_HINTS)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    attempts_before_solution: int = Field(3, ge=0, le=20)


class WidgetB(_B):
    type: Literal["widget"]
    html: str = Field(..., min_length=1, max_length=500_000, description="One full HTML document, inline CSS/JS. Needs approval.")
    title: str = Field(fences.WIDGET_TITLE, max_length=200)
    height: int = Field(fences.WIDGET_HEIGHT, ge=50, le=5000)


class Condition(_B):
    field: str = Field(..., description="user.groups, user.role, user.signed_in, user.locale, course.enrolled, progress.percent, user.bucket, ...")
    op: str = Field(..., description="in, not_in, contains_any, gte, lte, between, is_true, is_false, on_or_after, ...")
    value: Any = None


class RuleGroup(_B):
    match: Literal["all", "any"] = "all"
    negate: bool = False
    conditions: list[Union[Condition, "RuleGroup"]] = Field(default_factory=list, max_length=49)


class ConditionalB(_B):
    type: Literal["conditional"]
    rules: RuleGroup = Field(default_factory=RuleGroup, description="Who sees the blocks; empty = everyone.")
    label: str = Field("", max_length=200, description="Authors' note, never shown to learners.")
    hidden_message: str = Field("", max_length=300, description="Shown instead to readers who don't match.")
    blocks: list["Block"] = Field(..., min_length=1, max_length=100)


class ToggleB(_B):
    type: Literal["toggle"]
    summary: str = Field(..., min_length=1, max_length=300, description="The one-line title learners click.")
    open: bool = Field(False, description="Start opened.")
    blocks: list["Block"] = Field(..., min_length=1, max_length=100)


class EmbedB(_B):
    type: Literal["embed"]
    url: WebUrl = Field(..., min_length=8, max_length=2048, description="Share link of a known service (" + ", ".join(PROVIDERS) + ") or any embeddable page.")
    height: int | None = Field(None, ge=100, le=2000, description="Pixels; omit to use the service's shape.")
    alignment: Align = "center"
    caption: str | None = Field(None, max_length=500)


class VideoB(_B):
    type: Literal["video"]
    url: WebUrl = Field(..., min_length=8, max_length=2048, description="YouTube/Vimeo/Loom link (embedded) or a .mp4/.webm file (stored; needs approval).")
    caption: str | None = Field(None, max_length=500)


class ImageB(_B):
    type: Literal["image"]
    url: WebUrl = Field(..., min_length=8, max_length=2048, description="Public image file (jpg/png/gif/webp); fetched and stored (needs approval).")
    alt: str = Field(..., min_length=1, max_length=500, description="What the image shows, for screen readers.")
    caption: str | None = Field(None, max_length=500)
    width: int | None = Field(None, ge=50, le=2000)
    alignment: Align = "center"


class AudioB(_B):
    type: Literal["audio"]
    url: WebUrl = Field(..., min_length=8, max_length=2048, description="mp3/wav/ogg/m4a file; stored (needs approval).")
    caption: str | None = Field(None, max_length=500)


class PdfB(_B):
    type: Literal["pdf"]
    url: WebUrl = Field(..., min_length=8, max_length=2048, description="PDF file; stored (needs approval).")
    caption: str | None = Field(None, max_length=500)
    height: int | None = Field(None, ge=200, le=3000)


class H5pB(_B):
    type: Literal["h5p"]
    url: WebUrl = Field(..., min_length=8, max_length=2048, description="H5P embed URL. Needs approval.")
    title: str = Field("", max_length=500)
    height: int = Field(400, ge=50, le=5000)


class WebPreviewB(_B):
    type: Literal["web_preview"]
    url: WebUrl = Field(..., min_length=8, max_length=2048)
    title: str | None = Field(None, max_length=500)
    description: str | None = Field(None, max_length=2000)
    button_label: str | None = Field(None, max_length=100, description="Shows a button with this text.")


class UserB(_B):
    type: Literal["user"]
    member: str = Field(..., min_length=1, max_length=320, description="A member of this organization: username, email or user_ uuid.")
    layout: Literal["card", "compact"] = "card"


class DividerB(_B):
    type: Literal["divider"]


class ButtonB(_B):
    type: Literal["button"]
    label: str = Field(..., min_length=1, max_length=200)
    url: WebUrl = Field(..., min_length=8, max_length=2048)
    color: str = Field("blue", max_length=30)
    alignment: Align = "left"
    emoji: str = Field("🔗", max_length=16)


class BadgeB(_B):
    type: Literal["badge"]
    text: str = Field(..., min_length=1, max_length=200)
    color: str = Field("sky", max_length=30)
    emoji: str | None = Field(None, max_length=16)


class NodeB(_B):
    type: Literal["node"]
    node: dict[str, Any] = Field(..., description="One raw editor node (see describe_activity_blocks), checked against the schema.")


Block = Annotated[
    Union[
        MarkdownB, ParagraphB, HeadingB, ListB, CalloutB, CodeB, TableB, MathB, QuizB, FlashcardsB,
        ScenarioB, ExerciseB, WidgetB, ConditionalB, ToggleB, EmbedB, VideoB, ImageB, AudioB, PdfB,
        H5pB, WebPreviewB, UserB, DividerB, ButtonB, BadgeB, NodeB,
    ],
    Field(discriminator="type"),
]
ConditionalB.model_rebuild()
ToggleB.model_rebuild()
RuleGroup.model_rebuild()

BLOCKS_ADAPTER = TypeAdapter(list[Block])
BLOCK_MODELS: dict[str, type[_B]] = {
    m.model_fields["type"].annotation.__args__[0]: m  # type: ignore[union-attr]
    for m in Block.__origin__.__args__  # type: ignore[attr-defined]
}
BLOCK_TYPES = tuple(BLOCK_MODELS)
MEDIA_BLOCKS = ("image", "audio", "pdf")


# ─── converting ──────────────────────────────────────────────────────────────


class BlockError(ValueError):
    """A block that cannot be written; the message names it and says why."""


def _inline(text: str) -> list[dict]:
    return md.inline(text) or []


def _para(text: str) -> dict:
    return d.paragraph(_inline(text))


def _blocks_of(markdown: str) -> list[dict]:
    return md.convert(markdown).doc["content"]


class _Builder:
    def __init__(self, members: dict[str, int] | None) -> None:
        self.media: list[md.Media] = []
        self.notes: list[str] = []
        self.members = members or {}

    def many(self, blocks: list[Any], where: str, depth: int) -> list[dict]:
        out: list[dict] = []
        for i, block in enumerate(blocks):
            label = f"{where}[{i}] ({block.type})"
            try:
                out.extend(self.one(block, label, depth))
            except BlockError as e:
                raise e if str(e).startswith("Block ") else BlockError(f"Block {label}: {e}") from None
            except (fences.FenceError, d.DocError) as e:
                raise BlockError(f"Block {label}: {e}") from None
            except HTTPException as e:
                raise BlockError(f"Block {label}: {e.detail}") from None
        return out

    def _media(self, kind: str, url: str, caption: str | None, attrs: dict, depth: int) -> list[dict]:
        if depth:
            raise BlockError(f"{'an' if kind[0] in 'aeiou' else 'a'} {kind} must be at the top level of the page, not inside a toggle or conditional block")
        if not d.is_web_url(url):
            raise BlockError(f"'{url[:80]}' is not an http(s) URL")
        node = d.paragraph([d.text_node((caption or url).strip() or url, [{"type": "link", "attrs": {"href": url}}])])
        self.media.append(md.Media(kind, url, node, (caption or "").strip(), attrs))
        return [node]

    def one(self, b: Any, where: str, depth: int) -> list[dict]:  # noqa: C901 - one branch per block type
        t = b.type
        if t == "markdown":
            converted = md.convert(b.markdown, media=depth == 0)
            self.media.extend(converted.media)
            self.notes.extend(converted.notes)
            return converted.doc["content"]
        if t == "paragraph":
            return [_para(b.text)]
        if t == "heading":
            return [{"type": "heading", "attrs": {"level": b.level}, "content": _inline(b.text)}]
        if t == "list":
            items = [{"type": "listItem", "content": [_para(x)]} for x in b.items]
            return [{"type": "orderedList" if b.ordered else "bulletList", "content": items}]
        if t == "callout":
            node, notes = md.callout(b.style, b.text)
            node["attrs"]["dismissible"] = b.dismissible
            self.notes.extend(notes)
            return [node]
        if t == "code":
            attrs = {"language": b.language, **({"filename": b.filename} if b.filename else {})}
            return [{"type": "codeBlock", "attrs": attrs, "content": [d.text_node(b.code)]}]
        if t == "table":
            width = len(b.header)
            if any(len(r) > width for r in b.rows):
                raise BlockError(f"every row has at most {width} cells, like the header")

            def row(cells: list[str], cell: str) -> dict:
                cells = cells + [""] * (width - len(cells))
                return {"type": "tableRow", "content": [{"type": cell, "content": [_para(c) if c else d.paragraph()]} for c in cells]}

            return [{"type": "table", "content": [row(b.header, "tableHeader"), *(row(r, "tableCell") for r in b.rows)]}]
        if t == "math":
            return [{"type": "blockMathEquation", "attrs": {"math_equation": b.latex}}]
        if t == "quiz":
            questions = [
                {"text": q.text, "options": [o.model_dump() for o in q.options], "explanation": q.explanation}
                for q in b.questions
            ]
            for n, q in enumerate(b.questions, 1):
                if not any(o.correct for o in q.options):
                    raise BlockError(f"question {n} ('{q.text[:60]}') has no option marked correct")
            return [d.quiz_node(questions)]
        if t == "flashcards":
            cards = [
                {"type": "flipcard", "attrs": {"question": c.front, "answer": c.back, "color": b.color, "alignment": "center", "size": "medium"}}
                for c in b.cards
            ]
            if len(cards) == 1:
                return cards
            return [{"type": "flipcardGrid", "attrs": {"columns": min(b.columns, len(cards))}, "content": cards}]
        if t == "scenario":
            ids = [s.id for s in b.steps]
            if len(set(ids)) != len(ids):
                raise BlockError("step ids must be unique")
            steps = []
            for s in b.steps:
                for o in s.options:
                    if o.next is not None and o.next not in ids:
                        raise BlockError(f"step '{s.id}' option '{o.text[:40]}' leads to unknown step '{o.next}'; use one of {', '.join(ids)} or null")
                if s.image_url and not d.is_web_url(s.image_url):
                    raise BlockError(f"step '{s.id}' image_url must be an http(s) URL")
                steps.append({
                    "id": s.id, "text": s.text, "imageUrl": s.image_url or "",
                    "options": [{"id": f"opt_{uuid.uuid4().hex[:10]}", "text": o.text, "nextScenarioId": o.next} for o in s.options],
                })
            return [{"type": "scenarios", "attrs": {"title": b.title, "scenarios": steps, "currentScenarioId": steps[0]["id"]}}]
        if t == "exercise":
            lid, lname = fences.language(b.language)
            attrs: dict[str, Any] = {
                "languageId": lid, "languageName": lname, "description": b.task,
                "starterCode": b.starter, "solutionCode": b.solution, "hints": list(b.hints),
                "difficulty": b.difficulty, "maxAttemptsBeforeReveal": b.attempts_before_solution,
                "testCases": [
                    {"id": f"test_{uuid.uuid4().hex[:10]}", "label": x.label or f"Test {n}", "stdin": x.input,
                     "expectedStdout": x.output, **({"hidden": True} if x.hidden else {})}
                    for n, x in enumerate(b.tests, 1)
                ],
            }
            return [{"type": "blockCode", "attrs": attrs}]
        if t == "widget":
            return [{"type": "blockMagic", "attrs": {"blockUuid": f"mb_{uuid.uuid4().hex[:10]}", "title": b.title, "height": b.height, "htmlContent": b.html}}]
        if t in ("conditional", "toggle"):
            if depth >= MAX_NESTING:
                raise BlockError(f"blocks nest at most {MAX_NESTING} deep")
            inner = self.many(b.blocks, f"{where}.blocks", depth + 1)
            if t == "toggle":
                return [{"type": "toggleBlock", "attrs": {"summary": b.summary, "defaultOpen": b.open}, "content": inner}]
            attrs = {"rules": b.rules.model_dump(exclude_defaults=False), "label": b.label, "hiddenMessage": b.hidden_message}
            return [{"type": "conditionalBlock", "attrs": attrs, "content": inner}]
        if t == "embed":
            if not d.is_web_url(b.url):
                raise BlockError(f"'{b.url[:80]}' is not an http(s) URL")
            return [fences.embed_node(b.url, height=b.height, alignment=b.alignment, caption=b.caption)]
        if t == "video":
            if parse_embed(b.url) is not None or not _VIDEO_FILE.search(b.url):
                if not d.is_web_url(b.url):
                    raise BlockError(f"'{b.url[:80]}' is not an http(s) URL")
                return [fences.embed_node(b.url, caption=b.caption)]
            return self._media("video", b.url, b.caption, {}, depth)
        if t == "image":
            attrs = {"alt": b.alt, "alignment": b.alignment, **({"size": {"width": b.width}} if b.width else {})}
            return self._media("image", b.url, b.caption, attrs, depth)
        if t == "audio":
            return self._media("audio", b.url, b.caption, {}, depth)
        if t == "pdf":
            return self._media("pdf", b.url, b.caption, {"pdfHeight": b.height} if b.height else {}, depth)
        if t == "h5p":
            return [{"type": "blockH5P", "attrs": {"h5pUrl": b.url, "title": b.title, "height": b.height}}]
        if t == "web_preview":
            attrs = {
                "url": b.url, "title": b.title, "description": b.description, "alignment": "left",
                "buttonLabel": b.button_label or "Visit Site", "showButton": bool(b.button_label),
            }
            return [{"type": "blockWebPreview", "attrs": attrs}]
        if t == "user":
            user_id = self.members.get(b.member.strip().lower())
            if user_id is None:
                raise BlockError(f"'{b.member}' is not a member of this organization")
            return [{"type": "blockUser", "attrs": {"user_id": user_id, "layout": b.layout}}]
        if t == "divider":
            return [{"type": "horizontalRule"}]
        if t == "button":
            attrs = {"emoji": b.emoji, "link": b.url, "color": b.color, "alignment": b.alignment}
            return [{"type": "button", "attrs": attrs, "content": [d.text_node(b.label)]}]
        if t == "badge":
            return [{"type": "badge", "attrs": {"color": b.color, "emoji": b.emoji}, "content": [d.text_node(b.text)]}]
        node = b.node
        if _contains(node, "blockUser"):
            raise BlockError("use the typed 'user' block for member cards")
        if d.kind(node) == "blockQuiz" and isinstance(node.get("attrs"), dict):
            node = {**node, "attrs": {**node["attrs"], "questions": d.fill_quiz_ids(node["attrs"].get("questions"))}}
        return [node]


def _contains(node: Any, kind: str, depth: int = 0) -> bool:
    if not isinstance(node, dict) or depth > d.MAX_DEPTH:
        return False
    return d.kind(node) == kind or any(_contains(c, kind, depth + 1) for c in d.children(node))


def parse_blocks(raw: Any) -> list[Any]:
    """Validate raw block objects; the error lists every bad field with the
    types and values allowed, so the caller can fix them in one go."""
    try:
        return BLOCKS_ADAPTER.validate_python(raw)
    except ValidationError as e:
        raise BlockError(validation_message(e)) from None


def validation_message(e: ValidationError, limit: int = 6) -> str:
    parts = []
    for err in e.errors()[:limit]:
        loc = ".".join(str(p) for p in err.get("loc", ()) if not (isinstance(p, str) and p.endswith("B")))
        msg = err.get("msg", "")
        ctx = err.get("ctx") or {}
        if err.get("type") == "union_tag_invalid":
            msg = f"unknown block type; use one of {', '.join(BLOCK_TYPES)}"
        elif "expected" in ctx and str(ctx["expected"]) not in msg:
            msg = f"{msg} (allowed: {ctx['expected']})"
        parts.append(f"{loc or 'blocks'}: {msg}")
    more = len(e.errors()) - limit
    return "; ".join(parts) + (f"; and {more} more" if more > 0 else "")


def member_keys(blocks: list[Any]) -> set[str]:
    keys: set[str] = set()
    for b in blocks:
        if b.type == "user":
            keys.add(b.member.strip().lower())
        elif b.type in ("conditional", "toggle"):
            keys |= member_keys(b.blocks)
    return keys


async def resolve_members(ctx: Any, keys: set[str]) -> dict[str, int]:
    """Member cards may only show members of this organization."""
    if not keys:
        return {}
    from src.db.user_organizations import UserOrganization
    from src.db.users import User

    rows = (
        await ctx.db_session.execute(
            select(User.id, User.username, User.email, User.user_uuid)
            .join(UserOrganization, UserOrganization.user_id == User.id)
            .where(UserOrganization.org_id == ctx.org.id)
            .where(or_(*(c.in_(list(keys)) for c in (User.username, User.email, User.user_uuid))))
        )
    ).all()
    found: dict[str, int] = {}
    for uid, username, email, user_uuid in rows:
        for key in (username, email, user_uuid):
            if key and key.lower() in keys:
                found[key.lower()] = uid
    return found


def to_converted(blocks: list[Any], members: dict[str, int] | None = None) -> md.Converted:
    """Typed blocks to a checked document plus the files to store."""
    if len(blocks) > MAX_BLOCKS:
        raise BlockError(f"at most {MAX_BLOCKS} blocks per page")
    builder = _Builder(members)
    content = builder.many(blocks, "blocks", 0)
    doc = {"type": "doc", "content": content or [d.paragraph()]}
    check_doc(doc, member_ids=set((members or {}).values()))
    return md.Converted(doc, sorted(set(builder.notes)), builder.media)


def check_doc(doc: dict, member_ids: set[int] | None = None) -> None:
    """The editor's full schema on a new document. Member cards (blockUser),
    which tools may not write as raw JSON, are admitted only for the members
    of this organization resolved by `resolve_members` (`member_ids`); every
    other block gets the strict authoring check."""
    try:
        d.check_loadable(doc)
    except d.DocError as e:
        raise BlockError(str(e)) from None
    member_ids = member_ids or set()
    problems: list[str] = []

    def swap(node: Any, path: tuple) -> Any:
        if not isinstance(node, dict):
            return node
        if d.kind(node) == "blockUser":
            user_id = (node.get("attrs") or {}).get("user_id")
            if isinstance(user_id, bool) or user_id not in member_ids:
                problems.append(f"The member card at {list(path)} is not for a member of this organization.")
            problems.extend(d.strict_problems(node, path, authoring=False))
            return {"type": "horizontalRule"}
        if not isinstance(node.get("content"), list):
            return node
        return {**node, "content": [swap(c, path + (j,)) for j, c in enumerate(node["content"])]}

    for i, node in enumerate(doc.get("content") or []):
        problems.extend(d.strict_problems(swap(node, (i,)), (i,)))
        if len(problems) >= 6:
            break
    if problems:
        raise BlockError(" ".join(problems[:6]))


async def convert_blocks(ctx: Any, raw: Any) -> md.Converted:
    """Raw block objects to a checked document (members resolved in ctx's org)."""
    blocks = parse_blocks(raw)
    members = await resolve_members(ctx, member_keys(blocks))
    return to_converted(blocks, members)


# ─── catalog ─────────────────────────────────────────────────────────────────

EXAMPLES: dict[str, dict] = {
    "markdown": {"type": "markdown", "markdown": "## Why it matters\n\nPlants turn **light** into sugar."},
    "paragraph": {"type": "paragraph", "text": "Plants turn **light** into sugar."},
    "heading": {"type": "heading", "text": "Photosynthesis", "level": 2},
    "list": {"type": "list", "items": ["Light", "Water", "CO2"], "ordered": False},
    "callout": {"type": "callout", "style": "tip", "text": "Leaves face the sun."},
    "code": {"type": "code", "language": "python", "code": "print('hello')"},
    "table": {"type": "table", "header": ["Input", "Output"], "rows": [["Light", "Sugar"]]},
    "math": {"type": "math", "latex": "6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2"},
    "quiz": {"type": "quiz", "questions": [{"text": "Where does photosynthesis happen?", "options": [
        {"text": "Chloroplasts", "correct": True}, {"text": "Nucleus", "correct": False}], "explanation": "Chlorophyll lives there."}]},
    "flashcards": {"type": "flashcards", "cards": [{"front": "Stomata", "back": "Leaf pores"}, {"front": "Xylem", "back": "Water tubes"}], "columns": 2},
    "scenario": {"type": "scenario", "title": "Wilting plant", "steps": [
        {"id": "start", "text": "Your plant wilts. What first?", "options": [{"text": "Water it", "next": "good"}, {"text": "Repot it", "next": "start"}]},
        {"id": "good", "text": "Right: check water first.", "options": [{"text": "Finish", "next": None}]}]},
    "exercise": {"type": "exercise", "language": "python", "task": "Print the sum of two numbers read from input.",
                 "starter": "a = int(input())\n", "solution": "print(int(input()) + int(input()))\n",
                 "tests": [{"label": "small", "input": "2\n3", "output": "5"}], "hints": ["Use int()."], "difficulty": "easy"},
    "widget": {"type": "widget", "title": "Light slider", "height": 300, "html": "<!DOCTYPE html><html><body><input type=range></body></html>"},
    "conditional": {"type": "conditional", "label": "Beginners", "rules": {"match": "all", "conditions": [
        {"field": "progress.percent", "op": "lt", "value": 50}]}, "blocks": [{"type": "paragraph", "text": "Take it slow."}]},
    "toggle": {"type": "toggle", "summary": "Show the worked answer", "blocks": [{"type": "paragraph", "text": "Sugar and oxygen."}]},
    "embed": {"type": "embed", "url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ"},
    "video": {"type": "video", "url": "https://vimeo.com/76979871", "caption": "Chloroplasts up close"},
    "image": {"type": "image", "url": "https://upload.wikimedia.org/wikipedia/commons/3/3c/Leaf_1_web.jpg", "alt": "A green leaf", "caption": "A leaf"},
    "audio": {"type": "audio", "url": "https://example.org/intro.mp3", "caption": "Listen first"},
    "pdf": {"type": "pdf", "url": "https://example.org/worksheet.pdf", "caption": "Worksheet"},
    "h5p": {"type": "h5p", "url": "https://h5p.org/h5p/embed/712", "title": "Drag the words"},
    "web_preview": {"type": "web_preview", "url": "https://en.wikipedia.org/wiki/Photosynthesis", "title": "Photosynthesis", "button_label": "Read more"},
    "user": {"type": "user", "member": "maya", "layout": "card"},
    "divider": {"type": "divider"},
    "button": {"type": "button", "label": "Open the lab sheet", "url": "https://example.org/lab.pdf", "color": "green"},
    "badge": {"type": "badge", "text": "Key idea", "emoji": "⭐"},
    "node": {"type": "node", "node": {"type": "paragraph", "content": [{"type": "text", "text": "Raw editor JSON"}]}},
}

NOTES: dict[str, str] = {
    "markdown": "Any Markdown including ```quiz, ```flipcards, ```exercise, ```scenario, ```embed fences.",
    "image": "Fetched and stored as a course file after one approval; top level only.",
    "video": "Known video sites are embedded; direct files are fetched and stored after approval.",
    "audio": "Fetched and stored after approval; top level only.",
    "pdf": "Fetched and stored after approval; top level only.",
    "widget": "Custom HTML runs for every learner, so it needs the user's approval.",
    "h5p": "Frames outside content, so it needs the user's approval.",
    "web_preview": "Frames outside content, so it needs the user's approval.",
    "embed": "Providers recognized by share link: " + ", ".join(PROVIDERS) + ".",
    "conditional": "Rule fields: " + ", ".join(sorted(RULE_FIELDS)) + ". Ops: " + ", ".join(d.RULE_OPS) + ".",
    "user": "Shows a member card; the member must belong to this organization.",
    "node": "Escape hatch: one raw node, checked against the editor schema.",
}


def catalog(block_type: str | None = None) -> dict:
    """Each typed block: JSON schema, a minimal valid example and notes."""
    from src.services.mcp.server import compact_schema

    def entry(name: str) -> dict:
        schema = compact_schema(BLOCK_MODELS[name].model_json_schema())
        out = {"type": name, "schema": schema, "example": EXAMPLES[name]}
        if name in NOTES:
            out["notes"] = NOTES[name]
        return out

    if block_type is not None:
        if block_type not in BLOCK_MODELS:
            raise BlockError(f"unknown block type '{block_type}'; use one of {', '.join(BLOCK_TYPES)}")
        return entry(block_type)
    return {
        "about": (
            "Page content as a list of typed blocks. Each item is {type, ...fields}; nest blocks inside "
            "toggle and conditional. Media files go at the top level. Markdown is always accepted too."
        ),
        "types": list(BLOCK_TYPES),
        "blocks": [entry(name) for name in BLOCK_TYPES],
    }
