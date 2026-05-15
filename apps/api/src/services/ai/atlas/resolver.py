"""Entity resolution for Atlas.

Turn a free-form selector ("the intro activity", "activity_abc123",
"the second one", "this") into a concrete uuid using a deterministic,
ordered pipeline. The LLM never calls a ``resolve_entity`` tool — the
pipeline pre-resolves before invoking any ``propose_*``.

Order of passes (stop on the first confident single match):
  1. Reference chip      — user attached the entity explicitly
  2. Page context        — selector is deictic and route matches
  3. UUID prefix         — exact prefix lookup
  4. Recent mention      — "the previous/last/that one" → history scan
  5. Exact normalized    — punctuation-stripped, lowercased name match
  6. Ordinal positional  — "the second activity" against snapshot order
  7. Fuzzy               — SequenceMatcher + token Jaccard, gated thresholds
"""

from __future__ import annotations

import re
import string
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field

from src.services.ai.atlas.events import Candidate
from src.services.ai.atlas.snapshots import (
    ActivityNode,
    ChapterNode,
    CourseSnapshot,
)


Kind = Literal["course", "chapter", "activity"]

# Matches "the second activity", "second chapter", "3rd activity", "last activity"
_ORDINAL_RE = re.compile(
    r"^\s*(?:the\s+)?"
    r"(?P<ord>first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|"
    r"\d{1,2}(?:st|nd|rd|th)?)"
    r"\s+(?P<kind>activity|chapter)\s*$",
    re.IGNORECASE,
)

_ORDINAL_WORD_TO_INDEX = {
    "first": 0, "second": 1, "third": 2, "fourth": 3, "fifth": 4,
    "sixth": 5, "seventh": 6, "eighth": 7, "ninth": 8, "tenth": 9,
}

_DEICTIC_TOKENS = {"this", "current", "the one", "the current one", "here"}
_UUID_PREFIX_RE = re.compile(r"^(?P<kind>course|chapter|activity)_[0-9a-f]{6,}$", re.IGNORECASE)


# --- Inputs / outputs --------------------------------------------------------


@dataclass
class ResolveRequest:
    """All the context one resolve call needs.

    Built once per agent turn from the chat request body + cached
    snapshot. Tools that need to resolve a fresh selector mid-turn
    re-use the same ``ResolveRequest`` with a new ``selector`` value.
    """

    selector: str
    kind: Kind
    page_context: "PageContextDTO"
    references: list["ReferenceDTO"] = field(default_factory=list)
    recent_resolved: list["RecentResolved"] = field(default_factory=list)
    snapshot: Optional[CourseSnapshot] = None
    # Optional chapter scope: when set, ordinal/exact passes look only
    # inside this chapter's activities (used when the user is on an
    # activity edit page and says "the next one" without naming a chapter).
    scope_chapter_id: Optional[int] = None


class PageContextDTO(BaseModel):
    """Subset of ``AtlasPageContext`` the resolver needs.

    Defined here (rather than imported from the router) so the resolver
    has no router dependency and can be unit-tested in isolation.
    """

    course_uuid: Optional[str] = None
    chapter_id: Optional[int] = None
    chapter_uuid: Optional[str] = None
    activity_uuid: Optional[str] = None


class ReferenceDTO(BaseModel):
    """A chip the user attached in the panel."""

    kind: Kind
    uuid: str
    name: str
    parent_course_uuid: Optional[str] = None
    parent_chapter_id: Optional[int] = None


class RecentResolved(BaseModel):
    """One ``entity.resolved`` from a prior turn — used by 'previous/last/that one'."""

    kind: Kind
    uuid: str
    name: str
    parent_course_uuid: Optional[str] = None
    parent_chapter_id: Optional[int] = None


# Pydantic outputs (also re-used by event payloads)


class Resolved(BaseModel):
    kind: Kind
    uuid: str
    name: str
    parent_course_uuid: Optional[str] = None
    parent_chapter_id: Optional[int] = None
    via: Literal["chip", "page", "uuid", "recent", "exact", "ordinal", "fuzzy"]
    score: float = 1.0


class Ambiguous(BaseModel):
    kind: Kind
    selector: str
    candidates: list[Candidate] = Field(default_factory=list)


class NotFound(BaseModel):
    kind: Kind
    selector: str
    suggestions: list[Candidate] = Field(default_factory=list)


ResolveResult = Union[Resolved, Ambiguous, NotFound]


# --- Public entry point ------------------------------------------------------


def resolve(req: ResolveRequest) -> ResolveResult:
    """Run the resolution pipeline. Pure, deterministic, no I/O."""
    sel = (req.selector or "").strip()
    sel_norm = _normalize(sel)

    # 1. Reference chip
    chip = _match_chip(req, sel_norm)
    if chip is not None:
        return chip

    # 2. Page context (deictic or empty selector)
    if _is_deictic(sel_norm):
        page_hit = _match_page_context(req)
        if page_hit is not None:
            return page_hit
        # Deictic but page context didn't match the requested kind → fall through

    # 3. UUID prefix
    uuid_hit = _match_uuid(req, sel)
    if uuid_hit is not None:
        return uuid_hit

    # 4. Recent mention ("the previous", "the last one", "that one")
    if sel_norm in {"the previous", "previous", "the last one", "last", "the last", "that one"}:
        recent = _match_recent(req)
        if recent is not None:
            return recent

    # If we don't have a snapshot, we can't do name/ordinal/fuzzy
    if req.snapshot is None:
        return NotFound(kind=req.kind, selector=sel, suggestions=[])

    # 5. Exact normalized-name match
    exact = _match_exact(req, sel_norm)
    if exact is not None:
        return exact

    # 6. Ordinal positional ("the second activity")
    ordinal = _match_ordinal(req, sel)
    if ordinal is not None:
        return ordinal

    # 7. Fuzzy
    return _match_fuzzy(req, sel_norm)


# --- Pass implementations ----------------------------------------------------


def _match_chip(req: ResolveRequest, sel_norm: str) -> Optional[Resolved]:
    """Match against a user-attached reference chip.

    Empty or prefix-of-name selector + same kind → resolve to the chip.
    Multiple chips of the same kind: only auto-resolve when one is a
    clear prefix match.
    """
    same_kind = [r for r in req.references if r.kind == req.kind]
    if not same_kind:
        return None
    if not sel_norm:
        if len(same_kind) == 1:
            r = same_kind[0]
            return Resolved(
                kind=r.kind, uuid=r.uuid, name=r.name,
                parent_course_uuid=r.parent_course_uuid,
                parent_chapter_id=r.parent_chapter_id,
                via="chip",
            )
        return None
    prefixes = [r for r in same_kind if _normalize(r.name).startswith(sel_norm)]
    if len(prefixes) == 1:
        r = prefixes[0]
        return Resolved(
            kind=r.kind, uuid=r.uuid, name=r.name,
            parent_course_uuid=r.parent_course_uuid,
            parent_chapter_id=r.parent_chapter_id,
            via="chip",
        )
    return None


def _match_page_context(req: ResolveRequest) -> Optional[Resolved]:
    """Deictic selector + matching page context = page-context hit."""
    pc = req.page_context
    if req.kind == "activity" and pc.activity_uuid:
        name = _activity_name(req.snapshot, pc.activity_uuid) or ""
        return Resolved(
            kind="activity", uuid=pc.activity_uuid, name=name,
            parent_course_uuid=pc.course_uuid,
            parent_chapter_id=pc.chapter_id,
            via="page",
        )
    if req.kind == "chapter" and (pc.chapter_uuid or pc.chapter_id is not None):
        ch = _chapter_by_uuid(req.snapshot, pc.chapter_uuid) if pc.chapter_uuid else \
             _chapter_by_id(req.snapshot, pc.chapter_id)
        if ch:
            return Resolved(
                kind="chapter", uuid=ch.uuid, name=ch.name,
                parent_course_uuid=pc.course_uuid,
                parent_chapter_id=ch.id,
                via="page",
            )
        if pc.chapter_uuid:
            return Resolved(
                kind="chapter", uuid=pc.chapter_uuid, name="",
                parent_course_uuid=pc.course_uuid,
                parent_chapter_id=pc.chapter_id,
                via="page",
            )
    if req.kind == "course" and pc.course_uuid:
        snap = req.snapshot
        name = snap.course_name if snap and snap.course_uuid == pc.course_uuid else ""
        return Resolved(
            kind="course", uuid=pc.course_uuid, name=name,
            parent_course_uuid=None, parent_chapter_id=None,
            via="page",
        )
    return None


def _match_uuid(req: ResolveRequest, sel: str) -> Optional[Resolved]:
    """Match a literal ``<kind>_<hex>`` selector."""
    m = _UUID_PREFIX_RE.match(sel)
    if m is None:
        return None
    kind_in_selector = m.group("kind").lower()
    if kind_in_selector != req.kind:
        return None
    snap = req.snapshot
    name = ""
    parent_course = None
    parent_chapter = None
    if snap:
        if req.kind == "activity":
            for ch in snap.chapters:
                for act in ch.activities:
                    if act.uuid == sel:
                        name = act.name
                        parent_course = snap.course_uuid
                        parent_chapter = ch.id
                        break
        elif req.kind == "chapter":
            for ch in snap.chapters:
                if ch.uuid == sel:
                    name = ch.name
                    parent_course = snap.course_uuid
                    break
        elif req.kind == "course" and snap.course_uuid == sel:
            name = snap.course_name
    return Resolved(
        kind=req.kind, uuid=sel, name=name,
        parent_course_uuid=parent_course,
        parent_chapter_id=parent_chapter,
        via="uuid",
    )


def _match_recent(req: ResolveRequest) -> Optional[Resolved]:
    """Find the most-recent ``entity.resolved`` of the requested kind."""
    for entry in reversed(req.recent_resolved):
        if entry.kind == req.kind:
            return Resolved(
                kind=entry.kind, uuid=entry.uuid, name=entry.name,
                parent_course_uuid=entry.parent_course_uuid,
                parent_chapter_id=entry.parent_chapter_id,
                via="recent",
            )
    return None


def _match_exact(req: ResolveRequest, sel_norm: str) -> Optional[Resolved]:
    """Exact name match after normalization (case-insensitive, punctuation-stripped)."""
    if not sel_norm:
        return None
    snap = req.snapshot
    hits: list[tuple[str, str, Optional[int]]] = []  # (uuid, name, chapter_id)
    if req.kind == "course":
        if snap and _normalize(snap.course_name) == sel_norm:
            hits.append((snap.course_uuid, snap.course_name, None))
    elif req.kind == "chapter":
        for ch in snap.chapters:
            if _normalize(ch.name) == sel_norm:
                hits.append((ch.uuid, ch.name, ch.id))
    elif req.kind == "activity":
        scope_chapter = (
            _chapter_by_id(snap, req.scope_chapter_id)
            if req.scope_chapter_id is not None
            else None
        )
        chapters = [scope_chapter] if scope_chapter else snap.chapters
        for ch in chapters:
            if ch is None:
                continue
            for act in ch.activities:
                if _normalize(act.name) == sel_norm:
                    hits.append((act.uuid, act.name, ch.id))
    if len(hits) == 1:
        uuid, name, chapter_id = hits[0]
        return Resolved(
            kind=req.kind, uuid=uuid, name=name,
            parent_course_uuid=snap.course_uuid if snap else None,
            parent_chapter_id=chapter_id,
            via="exact",
        )
    return None


def _match_ordinal(req: ResolveRequest, sel: str) -> Optional[Resolved]:
    """Resolve "the second activity" / "3rd chapter" / "last activity"."""
    m = _ORDINAL_RE.match(sel.strip().lower())
    if m is None:
        return None
    kind_in_selector = m.group("kind").lower()
    if kind_in_selector != req.kind:
        return None
    snap = req.snapshot
    if not snap:
        return None

    candidates: list[tuple[str, str, Optional[int]]] = []
    if req.kind == "chapter":
        candidates = [(ch.uuid, ch.name, ch.id) for ch in snap.chapters]
    elif req.kind == "activity":
        scope_chapter = (
            _chapter_by_id(snap, req.scope_chapter_id)
            if req.scope_chapter_id is not None
            else _chapter_by_id(snap, req.page_context.chapter_id)
            if req.page_context.chapter_id is not None
            else None
        )
        if scope_chapter is not None:
            candidates = [(a.uuid, a.name, scope_chapter.id) for a in scope_chapter.activities]
        else:
            for ch in snap.chapters:
                for a in ch.activities:
                    candidates.append((a.uuid, a.name, ch.id))
    else:
        return None

    if not candidates:
        return None

    idx = _ordinal_index(m.group("ord").lower(), len(candidates))
    if idx is None:
        return None

    uuid, name, chapter_id = candidates[idx]
    return Resolved(
        kind=req.kind, uuid=uuid, name=name,
        parent_course_uuid=snap.course_uuid,
        parent_chapter_id=chapter_id,
        via="ordinal",
    )


def _match_fuzzy(req: ResolveRequest, sel_norm: str) -> ResolveResult:
    """Token-overlap + SequenceMatcher fuzzy match with confidence gating.

    Thresholds:
      - score >= 0.80 and top-1 leads next by >= 0.15 → Resolved
      - score >= 0.60 and unique → Resolved (low-confidence flag)
      - else → Ambiguous (if best > 0.60) or NotFound (with suggestions)
    """
    if not sel_norm:
        return NotFound(kind=req.kind, selector=req.selector, suggestions=[])

    snap = req.snapshot
    pool: list[tuple[str, str, Optional[int]]] = []
    label_fn = lambda name, ch_name: name
    if req.kind == "course":
        if snap:
            pool.append((snap.course_uuid, snap.course_name, None))
    elif req.kind == "chapter":
        for ch in snap.chapters:
            pool.append((ch.uuid, ch.name, ch.id))
        label_fn = lambda name, _: name
    elif req.kind == "activity":
        scope_chapter_id = req.scope_chapter_id
        for ch in snap.chapters:
            if scope_chapter_id is not None and ch.id != scope_chapter_id:
                continue
            for a in ch.activities:
                pool.append((a.uuid, a.name, ch.id))
        label_fn = lambda name, ch_name: f"{ch_name} · {name}" if ch_name else name

    if not pool:
        return NotFound(kind=req.kind, selector=req.selector, suggestions=[])

    scored: list[tuple[float, str, str, Optional[int]]] = []
    sel_tokens = set(sel_norm.split())
    for uuid, name, chapter_id in pool:
        name_norm = _normalize(name)
        seq = SequenceMatcher(None, sel_norm, name_norm).ratio()
        toks = set(name_norm.split())
        jacc = (
            len(sel_tokens & toks) / max(1, len(sel_tokens | toks))
            if sel_tokens or toks else 0.0
        )
        # Prefix bonus: short selectors ("intro" for "Introduction") get a
        # bump when the selector is a prefix of the candidate name (or any
        # of its tokens). Without this, SequenceMatcher returns ~0.58 for
        # "intro" vs "introduction" and we'd never match.
        prefix_bonus = 0.0
        if sel_norm:
            if name_norm.startswith(sel_norm):
                prefix_bonus = 0.30
            elif any(t.startswith(sel_norm) for t in toks):
                prefix_bonus = 0.20
        score = min(1.0, max(seq, jacc) + prefix_bonus)
        scored.append((score, uuid, name, chapter_id))

    scored.sort(reverse=True, key=lambda t: t[0])
    top = scored[0]
    second = scored[1] if len(scored) > 1 else (0.0, "", "", None)

    def _label(name: str, chapter_id: Optional[int]) -> str:
        if req.kind != "activity":
            return name
        if chapter_id is None:
            return name
        ch = _chapter_by_id(snap, chapter_id)
        return label_fn(name, ch.name if ch else "")

    if top[0] >= 0.80 and (top[0] - second[0]) >= 0.15:
        return Resolved(
            kind=req.kind, uuid=top[1], name=top[2],
            parent_course_uuid=snap.course_uuid,
            parent_chapter_id=top[3],
            via="fuzzy", score=top[0],
        )
    if top[0] >= 0.60 and (top[0] - second[0]) >= 0.20:
        return Resolved(
            kind=req.kind, uuid=top[1], name=top[2],
            parent_course_uuid=snap.course_uuid,
            parent_chapter_id=top[3],
            via="fuzzy", score=top[0],
        )
    # Ambiguous or NotFound
    if top[0] >= 0.60:
        candidates = [
            Candidate(
                kind=req.kind, uuid=u, name=n,
                label=_label(n, c),
                score=s,
                parent_course_uuid=snap.course_uuid,
                parent_chapter_id=c,
            )
            for (s, u, n, c) in scored[:5] if s >= 0.50
        ]
        return Ambiguous(kind=req.kind, selector=req.selector, candidates=candidates)
    suggestions = [
        Candidate(
            kind=req.kind, uuid=u, name=n,
            label=_label(n, c),
            score=s,
            parent_course_uuid=snap.course_uuid,
            parent_chapter_id=c,
        )
        for (s, u, n, c) in scored[:3]
    ]
    return NotFound(kind=req.kind, selector=req.selector, suggestions=suggestions)


# --- Helpers ----------------------------------------------------------------


def _normalize(s: str) -> str:
    """Lowercase, strip surrounding whitespace, collapse internal whitespace,
    and remove punctuation. Used everywhere we compare names."""
    if s is None:
        return ""
    s = s.strip().lower()
    s = s.translate(str.maketrans("", "", string.punctuation))
    return " ".join(s.split())


def _is_deictic(sel_norm: str) -> bool:
    if not sel_norm:
        return True
    return sel_norm in _DEICTIC_TOKENS or sel_norm in {"it", "this one"}


def _ordinal_index(token: str, n: int) -> Optional[int]:
    """Translate "second" or "2nd" into a 0-based index. "last" → n-1."""
    if token == "last":
        return n - 1 if n > 0 else None
    if token in _ORDINAL_WORD_TO_INDEX:
        idx = _ORDINAL_WORD_TO_INDEX[token]
        return idx if idx < n else None
    m = re.match(r"^(\d{1,2})(?:st|nd|rd|th)?$", token)
    if m:
        num = int(m.group(1))
        if num <= 0:
            return None
        if num <= n:
            return num - 1
    return None


def _chapter_by_id(snap: Optional[CourseSnapshot], chapter_id: Optional[int]) -> Optional[ChapterNode]:
    if snap is None or chapter_id is None:
        return None
    for ch in snap.chapters:
        if ch.id == chapter_id:
            return ch
    return None


def _chapter_by_uuid(snap: Optional[CourseSnapshot], chapter_uuid: Optional[str]) -> Optional[ChapterNode]:
    if snap is None or not chapter_uuid:
        return None
    for ch in snap.chapters:
        if ch.uuid == chapter_uuid:
            return ch
    return None


def _activity_name(snap: Optional[CourseSnapshot], activity_uuid: str) -> Optional[str]:
    if snap is None:
        return None
    for ch in snap.chapters:
        for a in ch.activities:
            if a.uuid == activity_uuid:
                return a.name
    return None
