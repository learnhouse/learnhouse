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
import unicodedata
import uuid
from typing import Annotated, Any, Literal, Union

from fastapi import HTTPException
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, TypeAdapter, ValidationError, WithJsonSchema
from sqlmodel import or_, select

from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import fences
from src.services.ai.tools import markdown as md
from src.services.ai.tools.embeds import PROVIDERS, parse_embed
from src.services.courses.activities import experiences as exp
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
    style: Literal["info", "tip", "warning", "success", "error", "note", "question", "example", "quote"] = "info"
    text: str = Field(..., min_length=1, max_length=20_000, description="Paragraphs and lists in Markdown.")
    dismissible: bool = Field(False, description="Learners may hide it.")
    title: str | None = Field(None, max_length=200, description="A bold title above the text.")
    collapsible: bool = Field(False, description="Learners open it by clicking the title (needs a title).")


class CodeB(_B):
    type: Literal["code"]
    code: str = Field(..., min_length=1, max_length=100_000)
    language: str | None = Field(None, max_length=40, description="e.g. python, js, sql (highlighting only).")
    filename: str | None = Field(None, max_length=200)
    line_numbers: bool = Field(False, description="Show line numbers.")
    highlight_lines: str | None = Field(None, max_length=200, description='Lines to emphasise, e.g. "2,4-6".')
    wrap: bool = Field(False, description="Wrap long lines instead of scrolling.")


CellType = Literal["text", "progress", "checkbox", "rating", "status", "number", "date"]


class TableB(_B):
    type: Literal["table"]
    header: list[str] = Field(..., min_length=1, max_length=30, description="Header cells (inline Markdown).")
    rows: list[list[str]] = Field(default_factory=list, max_length=500, description="Body rows, same width as header.")
    column_types: list[CellType] | None = Field(
        None, max_length=30,
        description=(
            "One per column; the cell text stays the value: progress '75' (a bar), checkbox 'yes'/'no', "
            "rating '4' or '4/5' (stars), status 'Done' (a coloured pill), number, date '2026-03-01'."
        ),
    )
    variant: Literal["default", "striped", "bordered", "minimal", "cards"] = Field("default", description="cards stacks rows on phones.")
    caption: str | None = Field(None, max_length=500)
    sortable: bool = Field(False, description="Learners sort by clicking a header.")
    sticky_header: bool = False
    compact: bool = False
    header_column: bool = Field(False, description="The first column is a header too.")
    totals: Literal["none", "sum", "average"] = Field("none", description="A footer row for number and progress columns.")


class MathB(_B):
    type: Literal["math"]
    latex: str = Field(..., min_length=1, max_length=10_000, description="Display LaTeX, rendered with KaTeX.")


class QuizOptionB(_B):
    text: str = Field(..., min_length=1, max_length=1000)
    correct: bool = False


class QuizQuestionB(_B):
    text: str = Field(..., min_length=1, max_length=2000)
    type: Literal["multiple_choice", "true_false", "short_answer", "numeric"] = Field(
        "multiple_choice", description="multiple_choice uses options; true_false answer; short_answer accepted_answers; numeric correct_value.",
    )
    options: list[QuizOptionB] | None = Field(None, min_length=2, max_length=12, description="multiple_choice: 2 to 12; mark at least one correct (2+ = select all).")
    answer: bool | None = Field(None, description="true_false: whether the statement is true.")
    accepted_answers: list[Annotated[str, Field(min_length=1, max_length=500)]] | None = Field(
        None, min_length=1, max_length=10, description="short_answer: what counts as right (case and spaces ignored).",
    )
    accent_insensitive: bool = Field(False, description="short_answer: 'é' matches 'e'.")
    correct_value: float | None = Field(None, ge=-1e15, le=1e15, description="numeric: the expected number.")
    tolerance: float = Field(0, ge=0, le=1e15, description="numeric: how far off still counts.")
    explanation: str | None = Field(None, max_length=2000, description="Shown after answering.")


class QuizB(_B):
    type: Literal["quiz"]
    questions: list[QuizQuestionB] = Field(..., min_length=1, max_length=50)
    pass_mark: int | None = Field(None, ge=0, le=100, description="Score (%) needed to pass.")
    show_explanations: bool | None = Field(None, description="Show explanations after submitting (default true).")


class CardB(_B):
    front: str = Field(..., min_length=1, max_length=2000)
    back: str = Field(..., min_length=1, max_length=2000)


class FlashcardsB(_B):
    type: Literal["flashcards"]
    cards: list[CardB] = Field(..., min_length=1, max_length=60)
    columns: int = Field(2, ge=1, le=6, description="Cards side by side (several cards).")
    color: Literal[fences.COLORS] = "blue"  # type: ignore[valid-type]
    mode: Literal["grid", "study"] | None = Field(
        None, description="grid (default): cards side by side; study: one card at a time with Again / Hard / Got it.",
    )
    title: str | None = Field(None, max_length=200, description="Deck title shown above the cards.")
    shuffle: bool | None = Field(None, description="Shuffle the cards for each learner.")
    style: Literal["solid", "soft", "outline"] | None = Field(
        None, description="Card look for the whole deck: solid (default, full colour), soft (tinted) or outline.",
    )
    size: Literal["small", "medium", "large"] | None = Field(
        None, description="Card size for the whole deck (default medium); every card in a deck shares it.",
    )


Outcome = Literal["success", "neutral", "fail"]


class ScenarioOptionB(_B):
    text: str = Field(..., min_length=1, max_length=500)
    next: str | None = Field(None, max_length=100, description="id of the step it leads to; null ends the scenario.")
    feedback: str | None = Field(None, max_length=1000, description="Shown after the learner picks it, before moving on.")
    outcome: Outcome | None = Field(None, description="How the story ends when next is null.")


class ScenarioEndingB(_B):
    tone: Outcome = "neutral"
    title: str | None = Field(None, max_length=200, description="Headline of the ending card.")


class ScenarioStepB(_B):
    id: str = Field(..., min_length=1, max_length=100)
    text: str = Field(..., min_length=1, max_length=5000)
    image_url: WebUrl | None = Field(None, max_length=2048)
    options: list[ScenarioOptionB] = Field(default_factory=list, max_length=12)
    ending: ScenarioEndingB | None = Field(None, description="For a step without options: the ending's tone and title.")


class ScenarioB(_B):
    type: Literal["scenario"]
    title: str = Field(fences.SCENARIO_TITLE, max_length=500)
    steps: list[ScenarioStepB] = Field(..., min_length=1, max_length=100, description="The first step starts.")
    display: Literal["story", "chat"] | None = Field(None, description="story (default): cards; chat: a messaging-style dialogue.")


# ─── experiences ─────────────────────────────────────────────────────────────
# Interactive learning blocks (Extensions/Experiences in the editor). Limits
# follow the editor; ids and blockId are generated here.

SORT_COLORS = ("sky", "amber", "emerald", "rose")
_TITLE = Field("", max_length=200, description="Short title shown in the block header.")
_INSTRUCTIONS = Field("", max_length=500, description="One line telling learners what to do.")


class SortCategoryB(_B):
    label: str = Field(..., min_length=1, max_length=200)
    color: str | None = Field(None, max_length=30, description="sky, amber, emerald or rose (default: one per slot).")


class SortItemB(_B):
    text: str = Field(..., min_length=1, max_length=500)
    category: str | int = Field(..., description="The category label it belongs to (or its 0-based index).")
    explanation: str | None = Field(None, max_length=1000, description="Shown when a learner places it wrongly.")


class SortB(_B):
    type: Literal["sort"]
    title: str = _TITLE
    instructions: str = _INSTRUCTIONS
    categories: list[SortCategoryB | Annotated[str, Field(min_length=1, max_length=200)]] = Field(
        ..., min_length=2, max_length=4, description="2 to 4 categories: labels or {label, color}.",
    )
    items: list[SortItemB] = Field(..., min_length=2, max_length=20)
    shuffle: bool = True


class SequenceItemB(_B):
    text: str = Field(..., min_length=1, max_length=500)
    detail: str | None = Field(None, max_length=200, description="e.g. a year; revealed after checking (timeline).")


class SequenceB(_B):
    type: Literal["sequence"]
    title: str = _TITLE
    instructions: str = _INSTRUCTIONS
    items: list[SequenceItemB | Annotated[str, Field(min_length=1, max_length=500)]] = Field(
        ..., min_length=3, max_length=10, description="3 to 10 steps in the CORRECT order; learners get them shuffled.",
    )
    variant: Literal["list", "timeline"] = "list"


class PairB(_B):
    left: str = Field(..., min_length=1, max_length=300)
    right: str = Field(..., min_length=1, max_length=300)


class MatchPairsB(_B):
    type: Literal["match_pairs"]
    title: str = _TITLE
    instructions: str = _INSTRUCTIONS
    pairs: list[PairB] = Field(..., min_length=2, max_length=8)
    mode: Literal["connect", "memory"] = Field("connect", description="connect: two columns; memory: flip cards to find pairs.")


class SpotB(_B):
    x: float = Field(..., ge=0, le=100, description="Centre, % of the image width from the left.")
    y: float = Field(..., ge=0, le=100, description="Centre, % of the image height from the top.")
    r: float = Field(8, ge=2, le=25, description="Radius, % of the image width.")
    label: str = Field(..., min_length=1, max_length=200)
    explanation: str | None = Field(None, max_length=1000)
    correct: bool = Field(True, description="find mode: a spot learners must find.")


class HotspotB(_B):
    type: Literal["hotspot"]
    title: str = _TITLE
    instructions: str = _INSTRUCTIONS
    image_url: WebUrl = Field(..., min_length=8, max_length=2048, description="Public image the spots sit on.")
    spots: list[SpotB] = Field(..., min_length=1, max_length=20)
    mode: Literal["find", "explore"] = Field("find", description="find: click the right places; explore: a labelled diagram.")


class FillGapsB(_B):
    type: Literal["fill_gaps"]
    title: str = _TITLE
    text: str = Field(
        ..., min_length=1, max_length=10_000,
        description="Text with gaps as [[answer]] or [[answer|other accepted answer]]; \\[ \\] \\| are literal.",
    )
    mode: Literal["type", "bank"] = Field("type", description="type: learners type each answer; bank: they pick from a word bank.")
    case_sensitive: bool = False


class StatementB(_B):
    text: str = Field(..., min_length=1, max_length=500)
    is_true: bool = Field(..., description="true: a fact; false: a myth.")
    explanation: str = Field("", max_length=1000, description="Why, shown right after the answer.")


class MythFactB(_B):
    type: Literal["myth_fact"]
    title: str = _TITLE
    statements: list[StatementB] = Field(..., min_length=2, max_length=20)
    true_label: str = Field("Fact", min_length=1, max_length=40)
    false_label: str = Field("Myth", min_length=1, max_length=40)


class SpeedQuestionB(_B):
    prompt: str = Field(..., min_length=1, max_length=300)
    options: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(..., min_length=2, max_length=4)
    answer: int | str = Field(..., description="The right option: its 0-based index or its exact text.")


class SpeedRoundB(_B):
    type: Literal["speed_round"]
    title: str = _TITLE
    questions: list[SpeedQuestionB] = Field(..., min_length=1, max_length=30)
    seconds_per_question: int = Field(10, ge=3, le=120)
    lives: int = Field(3, ge=0, le=10, description="Wrong answers allowed; 0 = unlimited.")


class EstimateB(_B):
    type: Literal["estimate"]
    question: str = Field(..., min_length=1, max_length=500)
    min: float
    max: float
    step: float = Field(1, gt=0)
    answer: float
    unit: str = Field("", max_length=30, description="e.g. km, %, years.")
    tolerance_pct: float = Field(10, ge=0, le=100, description="Guesses this close (% of the answer) earn 3 stars.")
    explanation: str = Field("", max_length=2000)


class MistakeSegmentB(_B):
    text: str = Field(..., min_length=1, max_length=2000)
    is_mistake: bool = False
    correction: str | None = Field(None, max_length=1000)
    explanation: str | None = Field(None, max_length=1000)


class SpotMistakeB(_B):
    type: Literal["spot_mistake"]
    title: str = _TITLE
    instructions: str = _INSTRUCTIONS
    segments: list[MistakeSegmentB] = Field(
        ..., min_length=2, max_length=80,
        description="The passage split into sentences (text) or lines (code), in order; mark the wrong ones.",
    )
    kind: Literal["text", "code"] = "text"


class ClueB(_B):
    question: str = Field(..., min_length=1, max_length=500)
    answer: str | int | float = Field(..., description="Short text or a number (up to 40 characters); matched trimmed and case-insensitive.")
    hint: str | None = Field(None, max_length=500)


class CodeLockB(_B):
    type: Literal["code_lock"]
    title: str = _TITLE
    story: str = Field("", max_length=3000, description="The setup learners read first.")
    clues: list[ClueB] = Field(..., min_length=1, max_length=5, description="Each solved clue opens one dial.")
    reward: str = Field("", max_length=5000, description="Shown when the lock opens.")


VENN_COLORS = ("sky", "amber", "emerald", "rose", "violet")


class VennSetB(_B):
    label: str = Field(..., min_length=1, max_length=200)
    color: str | None = Field(None, max_length=30, description="sky, amber, emerald, rose or violet (default: sky for a, amber for b).")


class VennSetsB(_B):
    a: VennSetB | Annotated[str, Field(min_length=1, max_length=200)] = Field(..., description="The left circle: a label or {label, color}.")
    b: VennSetB | Annotated[str, Field(min_length=1, max_length=200)] = Field(..., description="The right circle: a label or {label, color}.")


class VennItemB(_B):
    text: str = Field(..., min_length=1, max_length=500)
    zone: Literal["a", "b", "both", "neither"] = Field(..., description="a: only in a; b: only in b; both: the overlap; neither: outside both.")
    explanation: str | None = Field(None, max_length=1000, description="Shown when checking.")


class VennB(_B):
    type: Literal["venn"]
    title: str = _TITLE
    instructions: str = _INSTRUCTIONS
    sets: VennSetsB
    items: list[VennItemB] = Field(..., min_length=3, max_length=16, description="3 to 16; include at least one in both.")
    show_neither: bool | None = Field(None, description="Show an 'outside both' tray (default: on when an item's zone is neither).")


class LabelPinB(_B):
    x: float = Field(..., ge=0, le=100, description="% of the image width from the left.")
    y: float = Field(..., ge=0, le=100, description="% of the image height from the top.")
    label: str = Field(..., min_length=1, max_length=200, description="The label that belongs on this pin.")


class LabelDiagramB(_B):
    type: Literal["label_diagram"]
    title: str = _TITLE
    instructions: str = _INSTRUCTIONS
    image_url: WebUrl = Field(..., min_length=8, max_length=2048, description="Public image the pins sit on.")
    pins: list[LabelPinB] = Field(..., min_length=2, max_length=12)
    distractors: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(
        default_factory=list, max_length=4, description="0 to 4 wrong labels mixed into the bank.",
    )


class WordB(_B):
    answer: str = Field(..., min_length=1, max_length=40, description="2 to 12 letters; spaces and hyphens are shown fixed.")
    clue: str = Field(..., min_length=1, max_length=500)
    explanation: str | None = Field(None, max_length=1000, description="Shown once the word is solved or revealed.")


class WordGuessB(_B):
    type: Literal["word_guess"]
    title: str = _TITLE
    words: list[WordB] = Field(..., min_length=1, max_length=8)
    max_guesses: int = Field(6, ge=3, le=8, description="Tries per word.")


class ConfidenceQuestionB(_B):
    prompt: str = Field(..., min_length=1, max_length=500)
    options: list[Annotated[str, Field(min_length=1, max_length=300)]] = Field(..., min_length=2, max_length=4)
    answer: int | str = Field(..., description="The right option: its 0-based index or its exact text.")
    explanation: str = Field(..., min_length=1, max_length=1000, description="Why, shown with the result.")


class ConfidenceCheckB(_B):
    type: Literal["confidence_check"]
    title: str = _TITLE
    questions: list[ConfidenceQuestionB] = Field(..., min_length=1, max_length=10)


class GridRowB(_B):
    label: str = Field(..., min_length=1, max_length=200)
    ticks: list[str | int] = Field(
        default_factory=list, max_length=6, description="The columns that apply to this row: labels or 0-based indexes.",
    )


class PropertyGridB(_B):
    type: Literal["property_grid"]
    title: str = _TITLE
    instructions: str = _INSTRUCTIONS
    columns: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(..., min_length=2, max_length=6, description="Property names.")
    rows: list[GridRowB] = Field(..., min_length=2, max_length=8)
    mode: Literal["multi", "single"] = Field("multi", description="multi: any number of ticks per row; single: exactly one.")


class ReflectionB(_B):
    type: Literal["reflection"]
    title: str = _TITLE
    prompt: str = Field(..., min_length=1, max_length=2000, description="What to write about.")
    guiding_questions: list[Annotated[str, Field(min_length=1, max_length=300)]] = Field(default_factory=list, max_length=5)
    min_words: int = Field(30, ge=0, le=500, description="Words to write before the model answer shows.")
    model_answer: str = Field("", max_length=5000)
    checklist: list[Annotated[str, Field(min_length=1, max_length=300)]] = Field(
        default_factory=list, max_length=8, description="Key points learners tick if they covered them (their score).",
    )


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


# Blocks inside a layout block. Their schema is shown as "any typed block":
# inlining the whole union under every layout block (as clients need, see
# mcp.server.compact_schema) would grow exponentially with each one added.
# Validation still checks every nested block in full.
_NESTED_SCHEMA = WithJsonSchema({
    "type": "array",
    "items": {"type": "object", "description": "A typed block, any type of this list (layout blocks nest up to 3 deep)."},
})
Nested = Annotated[list["Block"], _NESTED_SCHEMA]


class TabB(_B):
    title: str = Field(..., min_length=1, max_length=200)
    blocks: Nested = Field(..., min_length=1, max_length=100)


class TabsB(_B):
    type: Literal["tabs"]
    tabs: list[TabB] = Field(..., min_length=2, max_length=8, description="2 to 8 tabs, each with its own blocks.")
    variant: Literal["line", "pills", "boxed"] = "line"


class ColumnB(_B):
    blocks: Nested = Field(..., min_length=1, max_length=100)


class ColumnsB(_B):
    type: Literal["columns"]
    columns: list[ColumnB] = Field(..., min_length=2, max_length=4, description="2 to 4 columns side by side (stacked on phones).")
    layout: Literal["1-1", "1-2", "2-1", "1-1-1", "1-1-1-1"] | None = Field(None, description="Width ratios; omit for equal columns.")
    gap: Literal["sm", "md", "lg"] = "md"
    vertical_align: Literal["top", "center", "bottom"] = "top"


class AccordionItemB(_B):
    summary: str = Field(..., min_length=1, max_length=300)
    blocks: Nested = Field(..., min_length=1, max_length=100)
    open: bool = False


class AccordionB(_B):
    type: Literal["accordion"]
    items: list[AccordionItemB] = Field(..., min_length=1, max_length=30)
    single: bool = Field(True, description="Only one section open at a time.")
    variant: Literal["default", "bordered", "filled"] = "default"


LayoutTone = Literal["neutral", "blue", "teal", "green", "amber", "rose"]
LayoutIcon = Literal["lightbulb", "star", "check", "target", "flag", "book", "rocket", "key"]


class StepB(_B):
    title: str = Field(..., min_length=1, max_length=300)
    label: str = Field("", max_length=100, description="A date or step label shown above the title.")
    text: str | None = Field(None, max_length=20_000, description="Markdown under the title (or use blocks).")
    blocks: Nested = Field(default_factory=list, max_length=100)
    tone: LayoutTone | None = None
    icon: LayoutIcon | None = None


class TimelineB(_B):
    type: Literal["timeline"]
    steps: list[StepB] = Field(..., min_length=1, max_length=50)
    variant: Literal["steps", "timeline", "process"] = Field("steps", description="steps for how-tos, timeline for dates, process for stages.")
    numbered: bool = True
    orientation: Literal["vertical", "horizontal"] = "vertical"


class KeyTakeawaysB(_B):
    type: Literal["key_takeaways"]
    points: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(default_factory=list, max_length=20, description="Bullets (inline Markdown).")
    blocks: Nested = Field(default_factory=list, max_length=50, description="Or any blocks.")
    title: str = Field("", max_length=200, description="Empty shows 'Key takeaways'.")
    tone: LayoutTone = "amber"
    icon: LayoutIcon | None = None


class ChecklistB(_B):
    type: Literal["checklist"]
    items: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(..., min_length=1, max_length=100)
    learner_can_check: bool = Field(True, description="Learners tick items (kept in their browser).")


class GalleryImageB(_B):
    url: WebUrl = Field(..., min_length=8, max_length=2048, description="Public image link (shown from there, not stored).")
    alt: str = Field(..., min_length=1, max_length=500)
    caption: str | None = Field(None, max_length=300)


class GalleryB(_B):
    type: Literal["gallery"]
    images: list[GalleryImageB] = Field(..., min_length=1, max_length=40)
    layout: Literal["grid", "carousel", "masonry"] = "grid"
    columns: Literal[2, 3, 4] = 3


class CompareSideB(_B):
    url: WebUrl = Field(..., min_length=8, max_length=2048)
    label: str = Field("", max_length=80, description="e.g. Before, 2010.")
    alt: str | None = Field(None, max_length=500)


class ImageCompareB(_B):
    type: Literal["image_compare"]
    before: CompareSideB
    after: CompareSideB
    start: int = Field(50, ge=0, le=100, description="Divider position (%).")
    orientation: Literal["horizontal", "vertical"] = "horizontal"


class SeriesB(_B):
    name: str = Field(..., min_length=1, max_length=60)
    values: list[float] = Field(..., max_length=50, description="One number per label.")
    tone: Literal["blue", "orange", "teal", "amber", "pink", "green", "violet", "red"] | None = None


class ChartB(_B):
    type: Literal["chart"]
    chart: Literal["bar", "column", "line", "area", "pie", "donut"] = Field("column", description="pie and donut show the first series.")
    title: str = Field("", max_length=300)
    labels: list[Annotated[str, Field(max_length=60)]] = Field(..., min_length=1, max_length=50)
    series: list[SeriesB] = Field(..., min_length=1, max_length=8)
    show_legend: bool = True
    show_values: bool = False
    stacked: bool = False


class StatB(_B):
    value: str = Field(..., min_length=1, max_length=24, description="The number as shown: '92', '12,500', '4.8'.")
    label: str = Field(..., min_length=1, max_length=120)
    description: str | None = Field(None, max_length=300)
    prefix: str | None = Field(None, max_length=8, description="e.g. $")
    suffix: str | None = Field(None, max_length=12, description="e.g. %, +, /5")
    tone: LayoutTone | None = None


class StatHighlightsB(_B):
    type: Literal["stat_highlights"]
    stats: list[StatB] = Field(..., min_length=1, max_length=8)
    columns: Literal[2, 3, 4] | None = Field(None, description="Omit to fit the number of stats.")
    animate: bool = Field(True, description="Count up when scrolled into view.")


class FileCardB(_B):
    type: Literal["file_card"]
    url: WebUrl = Field(..., min_length=8, max_length=2048, description="Link to the file (not stored).")
    name: str = Field("", max_length=200, description="Shown name; omit to use the file name from the link.")
    description: str | None = Field(None, max_length=1000)
    size_bytes: int | None = Field(None, ge=0, le=10**13)


class QuoteB(_B):
    type: Literal["quote"]
    text: str = Field(..., min_length=1, max_length=5000, description="The quote; blank lines split paragraphs.")
    author: str | None = Field(None, max_length=200)
    role: str | None = Field(None, max_length=200)
    variant: Literal["pull", "testimonial", "highlight"] = "pull"


class EmbedB(_B):
    type: Literal["embed"]
    url: WebUrl = Field(..., min_length=8, max_length=2048, description="Share link of a known service (" + ", ".join(PROVIDERS) + ") or any embeddable page.")
    height: int | None = Field(None, ge=100, le=2000, description="Pixels; omit to use the service's shape.")
    alignment: Align = "center"
    caption: str | None = Field(None, max_length=500)


class VideoB(_B):
    type: Literal["video"]
    url: WebUrl = Field(..., min_length=8, max_length=2048, description="YouTube/Vimeo/Loom/Kinescope link (embedded) or a .mp4/.webm file (stored; needs approval).")
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
    variant: Literal["solid", "outline", "soft", "link"] | None = None
    size: Literal["sm", "md", "lg"] | None = None


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
        H5pB, WebPreviewB, UserB, DividerB, ButtonB, BadgeB, SortB, SequenceB, MatchPairsB, HotspotB,
        FillGapsB, MythFactB, SpeedRoundB, EstimateB, SpotMistakeB, CodeLockB, VennB, LabelDiagramB,
        WordGuessB, ConfidenceCheckB, PropertyGridB, ReflectionB, TabsB, ColumnsB, AccordionB, TimelineB,
        KeyTakeawaysB, ChecklistB, GalleryB, ImageCompareB, ChartB, StatHighlightsB, FileCardB, QuoteB, NodeB,
    ],
    Field(discriminator="type"),
]
for _model in (ConditionalB, ToggleB, TabB, ColumnB, AccordionItemB, StepB, KeyTakeawaysB, RuleGroup):
    _model.model_rebuild()

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
            raise BlockError(f"{'an' if kind[0] in 'aeiou' else 'a'} {kind} must be at the top level of the page, not inside another block (toggle, conditional, tabs, columns...)")
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
            if b.title:
                node["attrs"]["title"] = b.title
            if b.collapsible:
                if not b.title:
                    raise BlockError("a collapsible callout needs a title to click")
                node["attrs"]["collapsible"] = True
            node["attrs"] = d.callout_kind_attrs(node["attrs"])
            self.notes.extend(notes)
            return [node]
        if t == "code":
            attrs = {"language": b.language, **({"filename": b.filename} if b.filename else {})}
            if b.line_numbers:
                attrs["showLineNumbers"] = True
            if b.highlight_lines:
                attrs["highlightLines"] = b.highlight_lines
            if b.wrap:
                attrs["wrap"] = True
            return [{"type": "codeBlock", "attrs": attrs, "content": [d.text_node(b.code)]}]
        if t == "table":
            return [self._table(b)]
        if t == "math":
            return [{"type": "blockMathEquation", "attrs": {"math_equation": b.latex}}]
        if t == "quiz":
            questions = [self._question(q, n) for n, q in enumerate(b.questions, 1)]
            settings = {
                **({"passMark": b.pass_mark} if b.pass_mark is not None else {}),
                **({"showExplanations": b.show_explanations} if b.show_explanations is not None else {}),
            }
            return [d.quiz_node(questions, settings or None)]
        if t in _CONTAINERS:
            if depth >= MAX_NESTING:
                raise BlockError(f"blocks nest at most {MAX_NESTING} deep")
            return [self._container(b, where, depth + 1)]
        if t in ("gallery", "image_compare", "chart", "stat_highlights", "file_card", "quote", "checklist"):
            return [self._data_block(b)]
        if t == "flashcards":
            cards = [
                {
                    "type": "flipcard",
                    "attrs": {
                        "question": c.front,
                        "answer": c.back,
                        "color": b.color,
                        "alignment": "center",
                        "size": b.size or "medium",
                        # Only written when asked for, so older inputs give the same JSON.
                        **({"style": b.style} if b.style else {}),
                    },
                }
                for c in b.cards
            ]
            # mode, title and shuffle live on the grid, so a deck that sets
            # them is a grid even with one card; left out, nothing changes.
            deck = {k: v for k, v in (("mode", b.mode), ("title", b.title), ("shuffle", b.shuffle)) if v is not None}
            if len(cards) == 1 and not deck:
                return cards
            return [{"type": "flipcardGrid", "attrs": {"columns": min(b.columns, len(cards)), **deck}, "content": cards}]
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
                step: dict[str, Any] = {
                    "id": s.id, "text": s.text, "imageUrl": s.image_url or "",
                    "options": [_scenario_option(o) for o in s.options],
                }
                if s.ending is not None:
                    step["ending"] = s.ending.model_dump(exclude_none=True)
                steps.append(step)
            attrs = {"title": b.title, "scenarios": steps, "currentScenarioId": steps[0]["id"]}
            if b.display is not None:
                attrs["display"] = b.display
            return [{"type": "scenarios", "attrs": attrs}]
        if t in EXPERIENCES:
            node_type, build = EXPERIENCES[t]
            return [{"type": node_type, "attrs": {"blockId": str(uuid.uuid4()), **build(b)}}]
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
            attrs.update({k: v for k, v in (("variant", b.variant), ("size", b.size)) if v})
            return [{"type": "button", "attrs": attrs, "content": [d.text_node(b.label)]}]
        if t == "badge":
            return [{"type": "badge", "attrs": {"color": b.color, "emoji": b.emoji}, "content": [d.text_node(b.text)]}]
        node = b.node
        if _contains(node, "blockUser"):
            raise BlockError("use the typed 'user' block for member cards")
        if d.kind(node) == "blockQuiz" and isinstance(node.get("attrs"), dict):
            node = {**node, "attrs": {**node["attrs"], "questions": d.fill_quiz_ids(node["attrs"].get("questions"))}}
        return [node]


    def _table(self, b: Any) -> dict:
        width = len(b.header)
        if any(len(r) > width for r in b.rows):
            raise BlockError(f"every row has at most {width} cells, like the header")
        if b.column_types is not None and len(b.column_types) != width:
            raise BlockError(f"column_types needs one type per column ({width})")
        types = b.column_types or ["text"] * width

        def row(cells: list[str], cell: str) -> dict:
            cells = cells + [""] * (width - len(cells))
            out = []
            for k, c in enumerate(cells):
                node: dict[str, Any] = {"type": cell, "content": [_para(c) if c else d.paragraph()]}
                if cell == "tableCell" and types[k] != "text":
                    node["attrs"] = {"cellType": types[k]}
                out.append(node)
            return {"type": "tableRow", "content": out}

        node: dict[str, Any] = {"type": "table", "content": [row(b.header, "tableHeader"), *(row(r, "tableCell") for r in b.rows)]}
        attrs = {
            "variant": b.variant if b.variant != "default" else None, "caption": b.caption or None,
            "sortable": b.sortable or None, "stickyHeader": b.sticky_header or None, "compact": b.compact or None,
            "headerColumn": b.header_column or None, "totals": b.totals if b.totals != "none" else None,
        }
        attrs = {k: v for k, v in attrs.items() if v is not None}
        if attrs:
            node["attrs"] = attrs
        return node

    @staticmethod
    def _question(q: Any, n: int) -> dict:
        label = f"question {n} ('{q.text[:60]}')"
        extra = {
            "options": q.options, "answer": q.answer, "accepted_answers": q.accepted_answers,
            "correct_value": q.correct_value,
        }
        wanted = {"multiple_choice": "options", "true_false": "answer", "short_answer": "accepted_answers", "numeric": "correct_value"}[q.type]
        if extra[wanted] is None:
            raise BlockError(f"{label} is {q.type}: give {wanted}")
        stray = [k for k, v in extra.items() if v is not None and k != wanted]
        if stray:
            raise BlockError(f"{label} is {q.type}: {stray[0]} is for another question type")
        if q.type == "multiple_choice":
            if not any(o.correct for o in q.options):
                raise BlockError(f"{label} has no option marked correct")
            return {"text": q.text, "options": [o.model_dump() for o in q.options], "explanation": q.explanation}
        out: dict[str, Any] = {"text": q.text, "type": q.type, "explanation": q.explanation}
        if q.type == "true_false":
            out["answer"] = q.answer
        elif q.type == "short_answer":
            out["accepted_answers"] = [a.strip() for a in q.accepted_answers]
            out["accent_insensitive"] = q.accent_insensitive
        else:
            out["correct_value"] = q.correct_value
            out["tolerance"] = q.tolerance
        return out

    def _container(self, b: Any, where: str, depth: int) -> dict:  # noqa: C901 - one branch per layout block
        t = b.type
        if t == "tabs":
            items = [
                {"type": "tabItem", "attrs": {"title": tab.title}, "content": self.many(tab.blocks, f"{where}.tabs[{k}].blocks", depth)}
                for k, tab in enumerate(b.tabs)
            ]
            return {"type": "tabs", "attrs": {"blockId": _block_id(), "variant": b.variant}, "content": items}
        if t == "columns":
            count = len(b.columns)
            layout = b.layout or {2: "1-1", 3: "1-1-1", 4: "1-1-1-1"}[count]
            if len(layout.split("-")) != count:
                raise BlockError(f"layout {layout} is for {len(layout.split('-'))} columns, not {count}")
            cols = [{"type": "column", "content": self.many(c.blocks, f"{where}.columns[{k}].blocks", depth)} for k, c in enumerate(b.columns)]
            attrs = {"layout": layout, "gap": b.gap, "stackOnMobile": True, "verticalAlign": b.vertical_align}
            return {"type": "columns", "attrs": attrs, "content": cols}
        if t == "accordion":
            items = [
                {"type": "toggleBlock", "attrs": {"summary": item.summary, "defaultOpen": item.open},
                 "content": self.many(item.blocks, f"{where}.items[{k}].blocks", depth)}
                for k, item in enumerate(b.items)
            ]
            return {"type": "accordion", "attrs": {"single": b.single, "variant": b.variant}, "content": items}
        if t == "timeline":
            steps = []
            for k, step in enumerate(b.steps):
                content = _blocks_of(step.text) if step.text else []
                content += self.many(step.blocks, f"{where}.steps[{k}].blocks", depth)
                attrs: dict[str, Any] = {"title": step.title, "label": step.label}
                attrs.update({key: v for key, v in (("tone", step.tone), ("icon", step.icon)) if v})
                steps.append({"type": "timelineItem", "attrs": attrs, "content": content or [d.paragraph()]})
            attrs = {"variant": b.variant, "numbered": b.numbered, "orientation": b.orientation}
            return {"type": "timeline", "attrs": attrs, "content": steps}
        # key_takeaways
        if not b.points and not b.blocks:
            raise BlockError("key_takeaways needs points or blocks")
        content = [{"type": "bulletList", "content": [{"type": "listItem", "content": [_para(x)]} for x in b.points]}] if b.points else []
        content += self.many(b.blocks, f"{where}.blocks", depth)
        attrs = {"title": b.title, "tone": b.tone, **({"icon": b.icon} if b.icon else {})}
        return {"type": "keyTakeaways", "attrs": attrs, "content": content}

    def _data_block(self, b: Any) -> dict:
        t = b.type
        if t == "checklist":
            items = [{"type": "taskItem", "attrs": {"checked": False}, "content": [_para(x)]} for x in b.items]
            return {"type": "taskList", "attrs": {"blockId": _block_id(), "learnerCanCheck": b.learner_can_check}, "content": items}
        if t == "gallery":
            images = [
                {"id": f"img_{uuid.uuid4().hex[:10]}", "url": img.url, "alt": img.alt, **({"caption": img.caption} if img.caption else {})}
                for img in b.images
            ]
            return {"type": "gallery", "attrs": {"blockId": _block_id(), "layout": b.layout, "columns": b.columns, "images": images}}
        if t == "image_compare":
            def side(x: Any) -> dict:
                return {"url": x.url, "label": x.label, **({"alt": x.alt} if x.alt else {})}

            attrs = {"before": side(b.before), "after": side(b.after), "start": b.start, "orientation": b.orientation}
            return {"type": "imageCompare", "attrs": attrs}
        if t == "chart":
            for k, series in enumerate(b.series):
                if len(series.values) != len(b.labels):
                    raise BlockError(f"series {k} ('{series.name[:40]}') has {len(series.values)} values for {len(b.labels)} labels")
            data = {
                "labels": list(b.labels),
                "series": [{"name": x.name, "values": [_number(v) for v in x.values], "tone": x.tone} for x in b.series],
            }
            attrs = {"type": b.chart, "title": b.title, "data": data, "showLegend": b.show_legend,
                     "showValues": b.show_values, "stacked": b.stacked}
            return {"type": "chart", "attrs": attrs}
        if t == "stat_highlights":
            items = []
            for x in b.stats:
                item = {"id": f"stat_{uuid.uuid4().hex[:10]}", "value": x.value, "label": x.label}
                item.update({k: v for k, v in (("description", x.description), ("prefix", x.prefix), ("suffix", x.suffix), ("tone", x.tone)) if v})
                items.append(item)
            columns = b.columns or max(2, min(4, len(items)))
            return {"type": "statHighlights", "attrs": {"items": items, "columns": columns, "animate": b.animate}}
        if t == "file_card":
            name = b.name.strip() or _file_name(b.url)
            attrs = {"url": b.url, "name": name, "fileType": _file_type(name or b.url)}
            attrs.update({k: v for k, v in (("description", b.description), ("sizeBytes", b.size_bytes)) if v is not None})
            return {"type": "fileCard", "attrs": attrs}
        # quote
        paragraphs = [_para(p.strip()) for p in re.split(r"\n\s*\n", b.text) if p.strip()]
        attrs = {"variant": b.variant}
        attrs.update({k: v for k, v in (("author", b.author), ("role", b.role)) if v})
        return {"type": "quoteBlock", "attrs": attrs, "content": paragraphs or [d.paragraph()]}


_CONTAINERS = ("tabs", "columns", "accordion", "timeline", "key_takeaways")
_NESTED = ("conditional", "toggle", *_CONTAINERS)

_FILE_EXT = {
    "pdf": "pdf", "doc": "doc", "docx": "doc", "odt": "doc", "rtf": "doc", "pages": "doc",
    "xls": "sheet", "xlsx": "sheet", "ods": "sheet", "csv": "sheet", "numbers": "sheet", "tsv": "sheet",
    "ppt": "slides", "pptx": "slides", "odp": "slides", "key": "slides",
    "zip": "archive", "rar": "archive", "7z": "archive", "tar": "archive", "gz": "archive", "tgz": "archive",
    "jpg": "image", "jpeg": "image", "png": "image", "gif": "image", "webp": "image", "svg": "image", "avif": "image",
    "mp3": "audio", "wav": "audio", "ogg": "audio", "m4a": "audio", "flac": "audio",
    "mp4": "video", "webm": "video", "mov": "video", "mkv": "video",
    "txt": "text", "md": "text",
    "json": "code", "js": "code", "ts": "code", "py": "code", "html": "code", "css": "code", "xml": "code",
    "ipynb": "code", "sql": "code",
}


def _block_id() -> str:
    return f"lh_{uuid.uuid4().hex[:12]}"


def _number(v: float) -> int | float:
    return int(v) if float(v).is_integer() else v


def _file_name(url: str) -> str:
    from urllib.parse import unquote, urlsplit

    return unquote(urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1])[:200]


def _file_type(name: str) -> str:
    """The file card icon, from the extension (same table as the editor)."""
    base = name.split("?", 1)[0].split("#", 1)[0].rsplit("/", 1)[-1]
    ext = base.rsplit(".", 1)[-1].lower() if "." in base[1:] else ""
    return _FILE_EXT.get(ext, "file")


def _scenario_option(o: ScenarioOptionB) -> dict:
    out: dict[str, Any] = {"id": f"opt_{uuid.uuid4().hex[:10]}", "text": o.text, "nextScenarioId": o.next}
    if o.feedback is not None:
        out["feedback"] = o.feedback
    if o.outcome is not None:
        out["outcome"] = o.outcome
    return out


def _sid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def _num(value: float) -> int | float:
    """Whole numbers stay integers in the stored JSON (10, not 10.0)."""
    return int(value) if float(value).is_integer() else value


def _sort(b: SortB) -> dict:
    categories = []
    for i, c in enumerate(b.categories):
        label, color = (c, None) if isinstance(c, str) else (c.label, c.color)
        categories.append({"id": _sid("cat"), "label": label.strip(), "color": color if color in SORT_COLORS else SORT_COLORS[i]})
    keys = [c["label"].casefold() for c in categories]
    if len(set(keys)) != len(keys):
        raise BlockError("category labels must be different")
    items = []
    for item in b.items:
        ref = item.category
        if isinstance(ref, int):
            index = ref if 0 <= ref < len(categories) else None
        else:
            index = keys.index(ref.strip().casefold()) if ref.strip().casefold() in keys else None
        if index is None:
            names = ", ".join(c["label"] for c in categories)
            raise BlockError(f"item '{item.text[:40]}' names unknown category {ref!r}; use one of {names}")
        out = {"id": _sid("item"), "text": item.text, "categoryId": categories[index]["id"]}
        if item.explanation and item.explanation.strip():
            out["explanation"] = item.explanation
        items.append(out)
    return {"title": b.title, "instructions": b.instructions, "categories": categories, "items": items, "shuffle": b.shuffle}


def _sequence(b: SequenceB) -> dict:
    items = []
    for item in b.items:
        text, detail = (item, None) if isinstance(item, str) else (item.text, item.detail)
        items.append({"id": _sid("step"), "text": text, **({"detail": detail} if detail and detail.strip() else {})})
    return {"title": b.title, "instructions": b.instructions, "items": items, "variant": b.variant}


def _match(b: MatchPairsB) -> dict:
    pairs = [{"id": _sid("pair"), "left": p.left, "right": p.right} for p in b.pairs]
    return {"title": b.title, "instructions": b.instructions, "pairs": pairs, "mode": b.mode}


def _hotspot(b: HotspotB) -> dict:
    if b.mode == "find" and not any(s.correct for s in b.spots):
        raise BlockError("find mode needs at least one spot with correct: true")
    spots = []
    for s in b.spots:
        spot = {"id": _sid("spot"), "x": _num(s.x), "y": _num(s.y), "r": _num(s.r), "label": s.label, "correct": s.correct}
        if s.explanation and s.explanation.strip():
            spot["explanation"] = s.explanation
        spots.append(spot)
    # imageObject (an uploaded file's server object) is optional and left
    # out: a typed hotspot points at a public image URL, like scenario images.
    return {"title": b.title, "instructions": b.instructions, "imageUrl": b.image_url, "spots": spots, "mode": b.mode}


def _gaps(b: FillGapsB) -> dict:
    if not exp.gap_answers(b.text):
        raise BlockError("the text has no gap; mark each one as [[answer]] or [[answer|alternative]]")
    return {"title": b.title, "text": b.text, "mode": b.mode, "caseSensitive": b.case_sensitive}


def _myth_fact(b: MythFactB) -> dict:
    statements = [
        {"id": _sid("st"), "text": s.text, "isTrue": s.is_true, "explanation": s.explanation} for s in b.statements
    ]
    return {"title": b.title, "statements": statements, "labels": {"true": b.true_label, "false": b.false_label}}


def _speed_round(b: SpeedRoundB) -> dict:
    questions = []
    for n, q in enumerate(b.questions, 1):
        answer = _option_index(list(q.options), q.answer)
        if answer is None:
            raise BlockError(f"question {n} ('{q.prompt[:40]}') answer {q.answer!r} is not one of its options")
        questions.append({"id": _sid("q"), "prompt": q.prompt, "options": list(q.options), "answer": answer})
    return {"title": b.title, "questions": questions, "secondsPerQuestion": b.seconds_per_question, "lives": b.lives}


def _estimate(b: EstimateB) -> dict:
    if b.min >= b.max:
        raise BlockError("min must be below max")
    if not b.min <= b.answer <= b.max:
        raise BlockError("answer must be between min and max")
    if (b.max - b.min) / b.step > 100_000:
        raise BlockError("the slider would have more than 100000 steps; use a larger step")
    return {
        "question": b.question, "min": _num(b.min), "max": _num(b.max), "step": _num(b.step), "answer": _num(b.answer),
        "unit": b.unit, "tolerancePct": _num(b.tolerance_pct), "explanation": b.explanation,
    }


def _spot_mistake(b: SpotMistakeB) -> dict:
    if not any(s.is_mistake for s in b.segments):
        raise BlockError("mark at least one segment with is_mistake: true")
    segments = []
    for s in b.segments:
        segment = {"id": _sid("seg"), "text": s.text, "isMistake": s.is_mistake}
        for key, value in (("correction", s.correction), ("explanation", s.explanation)):
            if value and value.strip():
                segment[key] = value
        segments.append(segment)
    return {"title": b.title, "instructions": b.instructions, "segments": segments, "kind": b.kind}


def _code_lock(b: CodeLockB) -> dict:
    clues = []
    for n, c in enumerate(b.clues, 1):
        answer = exp.text(_num(c.answer) if isinstance(c.answer, float) else c.answer)
        if not answer or len(answer) > 40:
            raise BlockError(f"clue {n} needs a short answer (1 to 40 characters)")
        clues.append({"id": _sid("clue"), "question": c.question, "answer": answer, "hint": c.hint or ""})
    return {"title": b.title, "story": b.story, "clues": clues, "reward": b.reward}


def _venn(b: VennB) -> dict:
    sets = {}
    for key, raw, fallback in (("a", b.sets.a, "sky"), ("b", b.sets.b, "amber")):
        label, color = (raw, None) if isinstance(raw, str) else (raw.label, raw.color)
        color = (color or "").strip().lower()
        sets[key] = {"label": label.strip(), "color": color if color in VENN_COLORS else fallback}
    if sets["a"]["label"].casefold() == sets["b"]["label"].casefold():
        raise BlockError("the two sets need different labels")
    if sets["a"]["color"] == sets["b"]["color"]:
        sets["b"]["color"] = "rose" if sets["a"]["color"] == "amber" else "amber"
    neither = any(i.zone == "neither" for i in b.items)
    if neither and b.show_neither is False:
        raise BlockError("an item's zone is neither, so show_neither must be true (or leave it out)")
    items = []
    for item in b.items:
        out = {"id": _sid("item"), "text": item.text, "zone": item.zone}
        if item.explanation and item.explanation.strip():
            out["explanation"] = item.explanation
        items.append(out)
    show = neither if b.show_neither is None else b.show_neither
    return {"title": b.title, "instructions": b.instructions, "sets": sets, "items": items, "showNeither": show}


def _label_diagram(b: LabelDiagramB) -> dict:
    labels = {p.label.strip().casefold() for p in b.pins}
    for x in b.distractors:
        if x.strip().casefold() in labels:
            raise BlockError(f"distractor '{x[:40]}' is also a pin label; distractors must be wrong labels")
    pins = [{"id": _sid("pin"), "x": _num(p.x), "y": _num(p.y), "label": p.label.strip()} for p in b.pins]
    # imageObject (an uploaded file's server object) is left out, as for hotspots.
    return {
        "title": b.title, "instructions": b.instructions, "imageUrl": b.image_url, "pins": pins,
        "distractors": [x.strip() for x in b.distractors],
    }


_FIXED_CHARS = frozenset(" -\u2010\u2011\u2013")


def _word_letters(answer: str) -> int | None:
    """Letters to guess in a word guess answer, or None when it holds
    something else than letters, spaces and hyphens (as the editor reads it)."""
    letters = 0
    for ch in " ".join(answer.split()):
        cat = unicodedata.category(ch)
        if cat.startswith("L"):
            letters += 1
        elif not (cat.startswith("M") and letters) and ch not in _FIXED_CHARS:
            return None
    return letters


def _word_guess(b: WordGuessB) -> dict:
    words = []
    seen: set[str] = set()
    for n, w in enumerate(b.words, 1):
        answer = " ".join(w.answer.split())
        letters = _word_letters(answer)
        if letters is None:
            raise BlockError(f"word {n} answer '{answer[:40]}' may hold only letters, spaces and hyphens")
        if not 2 <= letters <= 12:
            raise BlockError(f"word {n} answer '{answer[:40]}' needs 2 to 12 letters")
        if answer.casefold() in seen:
            raise BlockError(f"word {n} answer '{answer[:40]}' is used twice")
        seen.add(answer.casefold())
        out = {"id": _sid("word"), "answer": answer, "clue": w.clue}
        if w.explanation and w.explanation.strip():
            out["explanation"] = w.explanation
        words.append(out)
    return {"title": b.title, "words": words, "maxGuesses": b.max_guesses}


def _option_index(options: list[str], answer: int | str) -> int | None:
    if isinstance(answer, int):
        return answer if 0 <= answer < len(options) else None
    wanted = answer.strip().casefold()
    return next((i for i, o in enumerate(options) if o.strip().casefold() == wanted), None)


def _confidence_check(b: ConfidenceCheckB) -> dict:
    questions = []
    for n, q in enumerate(b.questions, 1):
        answer = _option_index(list(q.options), q.answer)
        if answer is None:
            raise BlockError(f"question {n} ('{q.prompt[:40]}') answer {q.answer!r} is not one of its options")
        questions.append({"id": _sid("q"), "prompt": q.prompt, "options": list(q.options), "answer": answer, "explanation": q.explanation})
    return {"title": b.title, "questions": questions}


def _property_grid(b: PropertyGridB) -> dict:
    keys = [c.strip().casefold() for c in b.columns]
    if len(set(keys)) != len(keys):
        raise BlockError("column labels must be different")
    columns = [{"id": _sid("col"), "label": c.strip()} for c in b.columns]
    rows, cells = [], {}
    for n, r in enumerate(b.rows, 1):
        row = {"id": _sid("row"), "label": r.label.strip()}
        picked: list[int] = []
        for ref in r.ticks:
            if isinstance(ref, int):
                index = ref if 0 <= ref < len(columns) else None
            else:
                index = keys.index(ref.strip().casefold()) if ref.strip().casefold() in keys else None
            if index is None:
                names = ", ".join(c["label"] for c in columns)
                raise BlockError(f"row {n} ('{r.label[:40]}') ticks unknown column {ref!r}; use one of {names}")
            if index not in picked:
                picked.append(index)
        if b.mode == "single" and len(picked) != 1:
            raise BlockError(f"row {n} ('{r.label[:40]}') needs exactly one tick in single mode")
        for index in picked:
            cells[f"{row['id']}:{columns[index]['id']}"] = True
        rows.append(row)
    if not cells:
        raise BlockError("tick at least one cell: each row's ticks name the columns that apply")
    return {"title": b.title, "instructions": b.instructions, "rows": rows, "columns": columns, "cells": cells, "mode": b.mode}


def _reflection(b: ReflectionB) -> dict:
    if not b.model_answer.strip() and not b.checklist:
        raise BlockError("give a model_answer or a checklist of key points for learners to compare with")
    return {
        "title": b.title, "prompt": b.prompt, "guidingQuestions": list(b.guiding_questions), "minWords": b.min_words,
        "modelAnswer": b.model_answer, "checklist": list(b.checklist),
    }


# typed block -> (editor node, attrs builder)
EXPERIENCES: dict[str, tuple[str, Any]] = {
    "sort": ("expSort", _sort),
    "sequence": ("expSequence", _sequence),
    "match_pairs": ("expMatch", _match),
    "hotspot": ("expHotspot", _hotspot),
    "fill_gaps": ("expGaps", _gaps),
    "myth_fact": ("expMythFact", _myth_fact),
    "speed_round": ("expSpeedRound", _speed_round),
    "estimate": ("expEstimate", _estimate),
    "spot_mistake": ("expSpotMistake", _spot_mistake),
    "code_lock": ("expCodeLock", _code_lock),
    "venn": ("expVenn", _venn),
    "label_diagram": ("expLabel", _label_diagram),
    "word_guess": ("expWordGuess", _word_guess),
    "confidence_check": ("expConfidence", _confidence_check),
    "property_grid": ("expMatrix", _property_grid),
    "reflection": ("expReflect", _reflection),
}


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
        elif b.type in ("conditional", "toggle", "key_takeaways"):
            keys |= member_keys(b.blocks)
        elif b.type in ("tabs", "columns", "accordion", "timeline"):
            for part in getattr(b, {"tabs": "tabs", "columns": "columns", "accordion": "items", "timeline": "steps"}[b.type]):
                keys |= member_keys(part.blocks)
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
    "sort": {"type": "sort", "title": "Sort it", "instructions": "Put each thing where it belongs.",
             "categories": ["Needs light", "Needs no light"], "items": [
                 {"text": "Photosynthesis", "category": "Needs light"},
                 {"text": "Cellular respiration", "category": "Needs no light",
                  "explanation": "Cells respire day and night."}]},
    "sequence": {"type": "sequence", "title": "Order the steps", "items": [
        "Light hits the leaf", "Water is split", "Sugar is made"]},
    "match_pairs": {"type": "match_pairs", "title": "Match the parts", "pairs": [
        {"left": "Stomata", "right": "Let gases in"}, {"left": "Xylem", "right": "Carries water"}]},
    "hotspot": {"type": "hotspot", "title": "Find the stomata", "instructions": "Click where gases enter.",
                "image_url": "https://upload.wikimedia.org/wikipedia/commons/3/3c/Leaf_1_web.jpg",
                "spots": [{"x": 42, "y": 61, "r": 8, "label": "Stomata", "explanation": "Tiny pores under the leaf."}]},
    "fill_gaps": {"type": "fill_gaps", "title": "Fill the gaps",
                  "text": "Plants make sugar in the [[chloroplasts|chloroplast]] using [[light]]."},
    "myth_fact": {"type": "myth_fact", "title": "Myth or fact?", "statements": [
        {"text": "Plants only breathe at night.", "is_true": False, "explanation": "They respire all the time."},
        {"text": "Leaves look green because of chlorophyll.", "is_true": True, "explanation": "It reflects green light."}]},
    "speed_round": {"type": "speed_round", "title": "Quick fire", "questions": [
        {"prompt": "Gas plants take in", "options": ["CO2", "O2", "N2"], "answer": 0},
        {"prompt": "Sugar made", "options": ["Glucose", "Salt"], "answer": "Glucose"}], "seconds_per_question": 10},
    "estimate": {"type": "estimate", "question": "What share of Earth's oxygen comes from the ocean?",
                 "min": 0, "max": 100, "step": 1, "answer": 50, "unit": "%",
                 "explanation": "Marine plankton make about half of it."},
    "spot_mistake": {"type": "spot_mistake", "title": "Spot the mistake", "segments": [
        {"text": "Plants take in carbon dioxide."},
        {"text": "They release nitrogen as a by-product.", "is_mistake": True, "correction": "They release oxygen."}]},
    "code_lock": {"type": "code_lock", "title": "Lab escape", "story": "Answer every clue to open the lab door.",
                  "clues": [{"question": "How many oxygen atoms in CO2?", "answer": 2, "hint": "Read the formula."}],
                  "reward": "You are out! Photosynthesis mastered."},
    "venn": {"type": "venn", "title": "Plants or animals?", "instructions": "Place each fact in the right zone.",
             "sets": {"a": "Plants", "b": "Animals"}, "items": [
                 {"text": "Make their own sugar", "zone": "a"},
                 {"text": "Eat other living things", "zone": "b"},
                 {"text": "Respire to release energy", "zone": "both", "explanation": "All living cells respire."}]},
    "label_diagram": {"type": "label_diagram", "title": "Label the leaf", "instructions": "Drag each label onto its pin.",
                      "image_url": "https://upload.wikimedia.org/wikipedia/commons/3/3c/Leaf_1_web.jpg",
                      "pins": [{"x": 50, "y": 20, "label": "Tip"}, {"x": 50, "y": 90, "label": "Stalk"}],
                      "distractors": ["Root"]},
    "word_guess": {"type": "word_guess", "title": "Guess the term", "words": [
        {"answer": "stomata", "clue": "Tiny pores that let gases in and out of a leaf.", "explanation": "Most sit under the leaf."}]},
    "confidence_check": {"type": "confidence_check", "title": "How sure are you?", "questions": [
        {"prompt": "Which gas do plants release in daylight?", "options": ["Oxygen", "Nitrogen", "Methane"], "answer": 0,
         "explanation": "Photosynthesis splits water and releases oxygen."}]},
    "property_grid": {"type": "property_grid", "title": "Which parts do what?", "columns": ["Makes sugar", "Carries water"],
                      "rows": [{"label": "Leaf", "ticks": ["Makes sugar"]}, {"label": "Stem", "ticks": [1]}]},
    "reflection": {"type": "reflection", "title": "In your own words", "prompt": "Explain why a plant in a dark cupboard wilts.",
                   "guiding_questions": ["What does the plant need light for?"], "min_words": 30,
                   "model_answer": "Without light it cannot make sugar, so it runs out of energy.",
                   "checklist": ["Light powers photosynthesis", "No sugar means no energy"]},
    "tabs": {"type": "tabs", "tabs": [
        {"title": "Light", "blocks": [{"type": "paragraph", "text": "Chlorophyll absorbs red and blue light."}]},
        {"title": "Dark", "blocks": [{"type": "paragraph", "text": "The Calvin cycle builds sugar."}]}]},
    "columns": {"type": "columns", "columns": [
        {"blocks": [{"type": "heading", "text": "Plants", "level": 3}, {"type": "paragraph", "text": "Make their food."}]},
        {"blocks": [{"type": "heading", "text": "Animals", "level": 3}, {"type": "paragraph", "text": "Eat theirs."}]}]},
    "accordion": {"type": "accordion", "items": [
        {"summary": "What is chlorophyll?", "blocks": [{"type": "paragraph", "text": "The green pigment in leaves."}]},
        {"summary": "Why are leaves green?", "blocks": [{"type": "paragraph", "text": "They reflect green light."}]}]},
    "timeline": {"type": "timeline", "variant": "steps", "steps": [
        {"title": "Light hits the leaf", "text": "Chlorophyll absorbs it."},
        {"title": "Water splits", "text": "Oxygen is released."},
        {"title": "Sugar is built", "text": "In the Calvin cycle."}]},
    "key_takeaways": {"type": "key_takeaways", "points": ["Plants make sugar from light.", "Oxygen is a by-product."]},
    "checklist": {"type": "checklist", "items": ["Read the lesson", "Label the leaf diagram", "Take the quiz"]},
    "gallery": {"type": "gallery", "columns": 2, "images": [
        {"url": "https://upload.wikimedia.org/wikipedia/commons/3/3c/Leaf_1_web.jpg", "alt": "A green leaf", "caption": "Leaf"},
        {"url": "https://upload.wikimedia.org/wikipedia/commons/4/49/Chloroplasten.jpg", "alt": "Chloroplasts under a microscope"}]},
    "image_compare": {"type": "image_compare",
                      "before": {"url": "https://example.org/leaf-summer.jpg", "label": "Summer"},
                      "after": {"url": "https://example.org/leaf-autumn.jpg", "label": "Autumn"}},
    "chart": {"type": "chart", "chart": "column", "title": "Growth by light", "labels": ["Low", "Medium", "High"],
              "series": [{"name": "Height (cm)", "values": [4, 9, 15]}]},
    "stat_highlights": {"type": "stat_highlights", "stats": [
        {"value": "70", "suffix": "%", "label": "of Earth's oxygen", "description": "comes from ocean plants"},
        {"value": "6", "label": "CO2 molecules", "description": "per glucose"}]},
    "file_card": {"type": "file_card", "url": "https://example.org/worksheet.pdf", "name": "Leaf worksheet.pdf", "description": "Print and label."},
    "quote": {"type": "quote", "text": "Nature does nothing uselessly.", "author": "Aristotle", "variant": "pull"},
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
    "flashcards": "mode: study shows one card at a time with spaced review (Again / Hard / Got it); best for memorising.",
    "scenario": "Steps without options end the story; give them an ending {tone, title}. Option feedback explains each choice.",
    "sort": "Categorisation: 2 to 4 categories, 2 to 20 items; explain the tricky ones.",
    "sequence": "Ordering steps or events; list them in the right order (learners get them shuffled).",
    "match_pairs": "Term to definition, cause to effect; memory mode turns it into a card game.",
    "hotspot": "Coordinates are percentages of the image; use it only when you know where things sit on the image.",
    "fill_gaps": "Retrieval in context: [[answer|alternative]] marks each gap; bank mode shows a word bank.",
    "myth_fact": "Tackles misconceptions: always explain why.",
    "speed_round": "Timed rapid recall of facts already taught; keep prompts and options short.",
    "estimate": "Prediction before teaching: ask before the explanation, so the reveal sticks.",
    "spot_mistake": "Error detection: kind code splits by line; give a correction for each mistake.",
    "code_lock": "A mini escape room: 1 to 5 clues with short answers (a word or number); the reward shows at the end.",
    "venn": "Compare and contrast two ideas: 3 to 16 facts, each only in a, only in b, in both (the overlap) or neither.",
    "label_diagram": "Labelling a diagram: pins sit at % coordinates of the image; add 1 to 4 plausible wrong labels.",
    "word_guess": "Recall a key term from its clue with letter feedback (accent- and case-insensitive); best for vocabulary.",
    "confidence_check": "Metacognition: learners answer, say how sure they are, then see their calibration; always explain.",
    "property_grid": "Which properties apply to each row (a feature table); single mode means one tick per row.",
    "reflection": "Self-explanation: learners write first, then compare with the model answer and tick the key points they covered.",
    "table": "column_types makes typed cells (progress bars, checkboxes, stars, status pills...) whose value is the cell text.",
    "quiz": "Question types: multiple_choice (options), true_false (answer), short_answer (accepted_answers), numeric (correct_value, tolerance).",
    "tabs": "Parallel views of one topic (e.g. per language or role); learners see one tab at a time.",
    "columns": "Side-by-side comparison; stacks on phones. Keep each column short.",
    "accordion": "Several collapsible sections (FAQs, optional depth); single opens one at a time.",
    "timeline": "Ordered steps, dates or stages.",
    "key_takeaways": "A summary card, usually at the end of a page.",
    "checklist": "Things for learners to do; their ticks stay in their browser.",
    "gallery": "Linked pictures (not stored as course files).",
    "image_compare": "A before/after slider over two linked pictures.",
    "chart": "Small data sets as a bar, column, line, area, pie or donut chart.",
    "stat_highlights": "Two to four headline numbers.",
    "file_card": "A download card for a linked file.",
    "quote": "A pull quote or testimonial.",
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
            "toggle, conditional, tabs, columns, accordion, timeline and key_takeaways. Media files go at "
            "the top level. Markdown is always accepted too."
        ),
        "types": list(BLOCK_TYPES),
        "blocks": [entry(name) for name in BLOCK_TYPES],
    }
