"""
Intermediate representation shared by every LMS reader.

Each source reader (Moodle, Canvas, ...) parses its export into these plain
dataclasses; the package writer then turns them into a LearnHouse course
package. Readers never emit LearnHouse JSON themselves, so the native mapping
(dynamic pages, quiz blocks, assignment tasks) lives in one place.

Rich text stays as the source HTML plus a resolver that maps a URL found in
that HTML (``@@PLUGINFILE@@/a.png``, ``$IMS-CC-FILEBASE$/a.png``,
``/static/a.png``, ...) to a file on disk. Relative URLs only make sense next
to the document they came from, which is why every RichText carries its own.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Optional, Union


@dataclass
class Asset:
    """A file shipped inside the source export."""

    path: str  # absolute path on disk, inside the extraction directory
    name: str  # original file name, used for display and extension sniffing
    mime: Optional[str] = None

    @property
    def extension(self) -> str:
        return os.path.splitext(self.name or self.path)[1].lower().lstrip(".")

    def exists(self) -> bool:
        return os.path.isfile(self.path)


Resolver = Callable[[str], Optional[Asset]]


def no_resolver(_url: str) -> Optional[Asset]:
    return None


@dataclass
class RichText:
    """HTML in the source dialect, with the resolver for its relative URLs."""

    html: str = ""
    resolve: Resolver = no_resolver

    def is_empty(self) -> bool:
        return not (self.html or "").strip()


# ---------------------------------------------------------------------------
# Questions
# ---------------------------------------------------------------------------


class QType(str, Enum):
    MULTICHOICE = "multichoice"  # single or multiple response
    TRUEFALSE = "truefalse"
    SHORTANSWER = "shortanswer"
    NUMERICAL = "numerical"
    ESSAY = "essay"
    MATCHING = "matching"
    ORDERING = "ordering"
    CLOZE = "cloze"  # fill in the blanks, dropdowns, embedded answers
    DESCRIPTION = "description"  # text only, no answer
    FILE_UPLOAD = "file_upload"
    CODE = "code"
    UNSUPPORTED = "unsupported"


@dataclass
class Choice:
    text: RichText
    correct: bool = False
    feedback: str = ""


@dataclass
class NumericAnswer:
    value: float
    tolerance: float = 0.0


@dataclass
class Blank:
    """One gap of a cloze question.

    ``answers`` are the accepted values; ``choices`` is set when the source
    shows a dropdown (the correct ones are also in ``answers``).
    """

    answers: list[str] = field(default_factory=list)
    choices: list[str] = field(default_factory=list)
    hint: str = ""
    numeric: Optional[NumericAnswer] = None


@dataclass
class MatchPair:
    prompt: RichText
    answer: str


@dataclass
class CodeSpec:
    language: str = "python"
    starter_code: str = ""
    solution_code: str = ""
    test_cases: list[tuple[str, str]] = field(default_factory=list)  # (stdin, stdout)


@dataclass
class Question:
    type: QType
    text: RichText = field(default_factory=RichText)
    title: str = ""
    id: str = ""
    points: float = 1.0
    general_feedback: str = ""
    # MULTICHOICE / TRUEFALSE
    choices: list[Choice] = field(default_factory=list)
    multiple: bool = False
    partial_credit: bool = True  # multiple response scored per option
    # SHORTANSWER
    answers: list[str] = field(default_factory=list)
    case_sensitive: bool = False
    regex: bool = False  # answers are regular expressions (full match)
    # Moodle-style "*" wildcards; None means "guess from the answers"
    wildcard: Optional[bool] = None
    # NUMERICAL
    numeric: list[NumericAnswer] = field(default_factory=list)
    unit: str = ""
    # MATCHING (distractors are extra answers with no prompt)
    pairs: list[MatchPair] = field(default_factory=list)
    distractors: list[str] = field(default_factory=list)
    # ORDERING: items in their correct order
    ordering: list[str] = field(default_factory=list)
    # CLOZE: the text contains ``{{1}}``, ``{{2}}``... markers, one per blank
    blanks: list[Blank] = field(default_factory=list)
    # ESSAY
    allow_attachments: bool = False
    allow_text: bool = True
    # CODE
    code: Optional[CodeSpec] = None
    # UNSUPPORTED
    source_type: str = ""
    reason: str = ""


# ---------------------------------------------------------------------------
# Course structure
# ---------------------------------------------------------------------------


class MediaKind(str, Enum):
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    PDF = "pdf"


@dataclass
class HtmlPart:
    content: RichText


@dataclass
class HeadingPart:
    text: str
    level: int = 2


@dataclass
class MediaPart:
    kind: MediaKind
    asset: Optional[Asset] = None
    url: str = ""  # remote media (YouTube, Vimeo, external mp4...)
    title: str = ""


@dataclass
class EmbedPart:
    url: str = ""
    code: str = ""
    height: int = 500
    title: str = ""


@dataclass
class LinkPart:
    url: str
    title: str = ""
    description: str = ""


@dataclass
class MathPart:
    latex: str


@dataclass
class InlineQuizPart:
    """Self-check questions shown inside a page (no grade)."""

    questions: list[Question]
    title: str = ""


@dataclass
class FlashcardsPart:
    """Term/definition pairs, e.g. a Moodle glossary."""

    cards: list[tuple[str, str]]
    title: str = ""


@dataclass
class FilePart:
    """A downloadable file with no native renderer (docx, zip, ...)."""

    asset: Asset
    title: str = ""


@dataclass
class CodePart:
    code: str
    language: str = ""


Part = Union[
    HtmlPart,
    HeadingPart,
    MediaPart,
    EmbedPart,
    LinkPart,
    MathPart,
    InlineQuizPart,
    FlashcardsPart,
    FilePart,
    CodePart,
]


@dataclass
class Page:
    """Becomes a TYPE_DYNAMIC activity (the LearnHouse editor document)."""

    title: str
    parts: list[Part] = field(default_factory=list)
    id: str = ""
    visible: bool = True


@dataclass
class VideoItem:
    title: str
    asset: Optional[Asset] = None
    url: str = ""
    description: Optional[RichText] = None
    id: str = ""
    visible: bool = True


@dataclass
class DocumentItem:
    """A PDF shown in the document viewer."""

    title: str
    asset: Asset
    id: str = ""
    visible: bool = True


@dataclass
class Assessment:
    """A graded quiz or exam. Becomes an assignment unless written as a page."""

    title: str
    questions: list[Question] = field(default_factory=list)
    intro: RichText = field(default_factory=RichText)
    due_date: Optional[str] = None  # ISO 8601
    max_attempts: int = 1  # 0 = unlimited
    pass_percent: Optional[float] = None
    show_correct_answers: bool = False
    graded: bool = True
    time_limit_minutes: Optional[int] = None
    shuffle: bool = False
    id: str = ""
    visible: bool = True


@dataclass
class AssignmentItem:
    """A hand-in assignment (Moodle assign, Canvas assignment, D2L dropbox)."""

    title: str
    instructions: RichText = field(default_factory=RichText)
    due_date: Optional[str] = None
    allow_file: bool = True
    allow_text: bool = False
    points: Optional[float] = None
    pass_percent: Optional[float] = None
    graded: bool = True
    attachments: list[Asset] = field(default_factory=list)
    id: str = ""
    visible: bool = True


@dataclass
class ScormItem:
    title: str
    package: Asset  # the zip as shipped in the export
    id: str = ""
    visible: bool = True


@dataclass
class UnsupportedItem:
    title: str
    kind: str
    reason: str
    id: str = ""


Item = Union[
    Page,
    VideoItem,
    DocumentItem,
    Assessment,
    AssignmentItem,
    ScormItem,
    UnsupportedItem,
]


@dataclass
class Section:
    """Becomes a chapter."""

    title: str
    items: list[Item] = field(default_factory=list)
    summary: RichText = field(default_factory=RichText)
    id: str = ""
    visible: bool = True


@dataclass
class Course:
    title: str
    source: str  # reader key, e.g. "moodle"
    sections: list[Section] = field(default_factory=list)
    short_name: str = ""
    summary: RichText = field(default_factory=RichText)
    tags: list[str] = field(default_factory=list)
    learnings: list[str] = field(default_factory=list)
    thumbnail: Optional[Asset] = None
    language: str = ""
    id: str = ""
    # Warnings the reader raised while parsing (the writer adds its own)
    warnings: list[str] = field(default_factory=list)
    # (title, kind, reason) of source items that have no LearnHouse equivalent
    skipped: list[tuple[str, str, str]] = field(default_factory=list)
