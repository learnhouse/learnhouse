"""Dynamic content in activity documents: variables and conditional blocks.

Authors put two node types in a TipTap document:

- ``dynamicVariable`` (inline) names a value such as ``user.first_name``. The
  reader gets a plain text node in its place.
- ``conditionalBlock`` (block) wraps blocks that only some readers see. Its
  ``rules`` attribute is a JSON rule tree, never code: every field and
  operator comes from the fixed tables below, and anything else evaluates to
  false so a malformed rule hides content instead of showing it.

``{{ path }}`` written straight into text resolves the same way, so documents
created through the API, imports or AI work without the inline node.

Rendering runs before the response leaves the API: a learner never receives a
block hidden from them, nor the rules that hide it. Values only ever become
text nodes, which the editor escapes, so a learner's name can't inject markup.

This module is pure (no I/O). ``dynamic_context`` builds the RenderContext.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Callable

CONDITIONAL_NODE = "conditionalBlock"
VARIABLE_NODE = "dynamicVariable"

# Bounds on author input so a crafted document can't make rendering expensive.
MAX_RULE_DEPTH = 4
MAX_CONDITIONS = 50
MAX_NODE_DEPTH = 64
MAX_VARIABLE_LENGTH = 500


@dataclass
class RenderContext:
    """Everything a rule or variable may read about the current reader."""

    signed_in: bool = False
    first_name: str = ""
    last_name: str = ""
    username: str = ""
    email: str = ""
    user_uuid: str = ""
    account_days: int | None = None
    # Stable 0-99 per learner and org, for splitting an audience (A/B content).
    bucket: int | None = None
    role: str = "anonymous"  # admin | maintainer | member | anonymous
    group_uuids: frozenset[str] = frozenset()
    group_names: tuple[str, ...] = ()
    locale: str = "en"
    org_name: str = ""
    course_name: str = ""
    activity_name: str = ""
    enrolled: bool = False
    enrolled_on: date | None = None
    days_enrolled: int | None = None
    progress_completed: int = 0
    progress_total: int = 0
    completed_activity_uuids: frozenset[str] = frozenset()
    today: date = field(default_factory=date.today)

    @property
    def progress_percent(self) -> int:
        if self.progress_total <= 0:
            return 0
        return min(100, round(self.progress_completed * 100 / self.progress_total))

    @property
    def email_domain(self) -> str:
        return self.email.rsplit("@", 1)[-1].lower() if "@" in self.email else ""

    @property
    def course_completed(self) -> bool:
        return self.progress_total > 0 and self.progress_completed >= self.progress_total


# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------

def _full_name(ctx: RenderContext) -> str:
    return " ".join(part for part in (ctx.first_name, ctx.last_name) if part)


VARIABLES: dict[str, Callable[[RenderContext], str]] = {
    "user.first_name": lambda c: c.first_name,
    "user.last_name": lambda c: c.last_name,
    "user.full_name": _full_name,
    "user.username": lambda c: c.username if c.signed_in else "",
    "user.email": lambda c: c.email if c.signed_in else "",
    "user.groups": lambda c: ", ".join(sorted(c.group_names)),
    "org.name": lambda c: c.org_name,
    "course.name": lambda c: c.course_name,
    "activity.name": lambda c: c.activity_name,
    "progress.percent": lambda c: str(c.progress_percent),
    "progress.completed": lambda c: str(c.progress_completed),
    "progress.total": lambda c: str(c.progress_total),
    "progress.remaining": lambda c: str(max(0, c.progress_total - c.progress_completed)),
    "enrollment.days": lambda c: "" if c.days_enrolled is None else str(c.days_enrolled),
    "enrollment.date": lambda c: c.enrolled_on.isoformat() if c.enrolled_on else "",
    "date.today": lambda c: c.today.isoformat(),
    "date.year": lambda c: str(c.today.year),
}

FORMATS: dict[str, Callable[[str], str]] = {
    "upper": str.upper,
    "lower": str.lower,
    "capitalize": lambda s: s[:1].upper() + s[1:],
    "title": str.title,
}

# {{ path }}, {{ path | upper }}, {{ path | default: "there" }}
_PLACEHOLDER = re.compile(
    r"\{\{\s*([a-z_]+(?:\.[a-z_]+)+)\s*((?:\|\s*[a-z_]+(?:\s*:\s*\"[^\"{}]{0,200}\")?\s*)*)\}\}"
)
_FILTER = re.compile(r"\|\s*([a-z_]+)(?:\s*:\s*\"([^\"{}]*)\")?")


def resolve_variable(path: Any, ctx: RenderContext, *, fallback: Any = "", fmt: Any = None) -> str:
    """Value of ``path`` for this reader, or ``fallback`` when empty/unknown."""
    getter = VARIABLES.get(path) if isinstance(path, str) else None
    value = getter(ctx) if getter else ""
    if not value:
        value = fallback if isinstance(fallback, str) else ""
    formatter = FORMATS.get(fmt) if isinstance(fmt, str) else None
    if formatter and value:
        value = formatter(value)
    return value[:MAX_VARIABLE_LENGTH]


def interpolate_text(text: str, ctx: RenderContext) -> str:
    """Resolve ``{{ ... }}`` placeholders in a text node. Unknown paths stay
    as written so ordinary prose with braces (code samples) is untouched."""
    if "{{" not in text:
        return text

    def replace(match: re.Match) -> str:
        path = match.group(1)
        if path not in VARIABLES:
            return match.group(0)
        fallback, fmt = "", None
        for name, arg in _FILTER.findall(match.group(2) or ""):
            if name == "default":
                fallback = arg
            elif name in FORMATS:
                fmt = name
        return resolve_variable(path, ctx, fallback=fallback, fmt=fmt)

    return _PLACEHOLDER.sub(replace, text)


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------

def _locale_matches(locale: str, wanted: str) -> bool:
    locale, wanted = locale.lower(), wanted.lower()
    return locale == wanted or locale.startswith(wanted + "-")


def _domain_matches(domain: str, wanted: str) -> bool:
    # "acme.com" also covers "eu.acme.com"; a leading "@" is tolerated.
    wanted = wanted.lower().lstrip("@")
    return bool(domain) and (domain == wanted or domain.endswith("." + wanted))


def _as_str_list(value: Any) -> list[str] | None:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list) and all(isinstance(v, str) for v in value):
        return value
    return None


def _as_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _as_date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _set_op(actual: frozenset[str], op: str, value: Any) -> bool:
    wanted = _as_str_list(value)
    if wanted is None:
        return False
    if op == "contains_any":
        return any(v in actual for v in wanted)
    if op == "contains_all":
        return all(v in actual for v in wanted)
    if op == "contains_none":
        return not any(v in actual for v in wanted)
    return False


def _string_op(actual: str, op: str, value: Any, *, match: Callable[[str, str], bool] | None = None) -> bool:
    wanted = _as_str_list(value)
    if wanted is None:
        return False
    hit = any(match(actual, v) if match else actual == v for v in wanted)
    if op in ("eq", "in"):
        return hit
    if op in ("neq", "not_in"):
        return not hit
    return False


def _number_op(actual: float | None, op: str, value: Any) -> bool:
    if actual is None:
        return False
    if op == "between":
        if not isinstance(value, list) or len(value) != 2:
            return False
        low, high = _as_number(value[0]), _as_number(value[1])
        return low is not None and high is not None and low <= actual <= high
    target = _as_number(value)
    if target is None:
        return False
    return {
        "eq": actual == target,
        "neq": actual != target,
        "gt": actual > target,
        "gte": actual >= target,
        "lt": actual < target,
        "lte": actual <= target,
    }.get(op, False)


def _date_op(actual: date, op: str, value: Any) -> bool:
    if op == "between":
        if not isinstance(value, list) or len(value) != 2:
            return False
        start, end = _as_date(value[0]), _as_date(value[1])
        return start is not None and end is not None and start <= actual <= end
    target = _as_date(value)
    if target is None:
        return False
    return {
        "on_or_after": actual >= target,
        "on_or_before": actual <= target,
        "before": actual < target,
        "after": actual > target,
    }.get(op, False)


def _bool_op(actual: bool, op: str) -> bool:
    if op == "is_true":
        return actual
    if op == "is_false":
        return not actual
    return False


def _optional_number(value: int | None) -> float | None:
    return None if value is None else float(value)


# field -> evaluator(ctx, op, value). The editor's rule builder mirrors this table.
FIELDS: dict[str, Callable[[RenderContext, str, Any], bool]] = {
    "user.groups": lambda c, op, v: _set_op(c.group_uuids, op, v),
    "user.role": lambda c, op, v: _string_op(c.role, op, v),
    "user.signed_in": lambda c, op, v: _bool_op(c.signed_in, op),
    "user.locale": lambda c, op, v: _string_op(c.locale, op, v, match=_locale_matches),
    "user.email_domain": lambda c, op, v: _string_op(c.email_domain, op, v, match=_domain_matches),
    "user.account_days": lambda c, op, v: _number_op(_optional_number(c.account_days), op, v),
    "user.bucket": lambda c, op, v: _number_op(_optional_number(c.bucket), op, v),
    "course.enrolled": lambda c, op, v: _bool_op(c.enrolled, op),
    "course.completed": lambda c, op, v: _bool_op(c.course_completed, op),
    "enrollment.days": lambda c, op, v: _number_op(_optional_number(c.days_enrolled), op, v),
    "progress.percent": lambda c, op, v: _number_op(float(c.progress_percent), op, v),
    "progress.completed_count": lambda c, op, v: _number_op(float(c.progress_completed), op, v),
    "progress.completed_activities": lambda c, op, v: _set_op(c.completed_activity_uuids, op, v),
    "date.today": lambda c, op, v: _date_op(c.today, op, v),
}


class _Budget:
    def __init__(self) -> None:
        self.remaining = MAX_CONDITIONS


def _evaluate_group(group: Any, ctx: RenderContext, depth: int, budget: _Budget) -> bool:
    if not isinstance(group, dict) or depth > MAX_RULE_DEPTH:
        return False
    conditions = group.get("conditions", [])
    if not isinstance(conditions, list):
        return False
    results = []
    for item in conditions:
        budget.remaining -= 1
        if budget.remaining < 0:
            return False
        if isinstance(item, dict) and "conditions" in item:
            results.append(_evaluate_group(item, ctx, depth + 1, budget))
        else:
            results.append(_evaluate_condition(item, ctx))
    # An empty group is "everyone": a block just dropped into the page.
    passed = any(results) if group.get("match") == "any" and results else all(results)
    return not passed if group.get("negate") is True else passed


def _evaluate_condition(condition: Any, ctx: RenderContext) -> bool:
    if not isinstance(condition, dict):
        return False
    evaluator = FIELDS.get(condition.get("field"))  # type: ignore[arg-type]
    op = condition.get("op")
    if evaluator is None or not isinstance(op, str):
        return False
    return evaluator(ctx, op, condition.get("value"))


def evaluate_rules(rules: Any, ctx: RenderContext) -> bool:
    """True when ``rules`` lets this reader see the block. Missing rules mean
    everyone; anything malformed means no one."""
    if rules is None:
        return True
    return _evaluate_group(rules, ctx, 0, _Budget())


# ---------------------------------------------------------------------------
# Document walk
# ---------------------------------------------------------------------------

def has_dynamic_content(doc: Any) -> bool:
    """Cheap pre-check so plain documents skip the context queries."""
    stack, depth_guard = [doc], 0
    while stack:
        node = stack.pop()
        depth_guard += 1
        if depth_guard > 100_000:
            return True
        if isinstance(node, dict):
            node_type = node.get("type")
            if node_type in (CONDITIONAL_NODE, VARIABLE_NODE):
                return True
            text = node.get("text")
            if isinstance(text, str) and "{{" in text:
                return True
            children = node.get("content")
            if isinstance(children, list):
                stack.extend(children)
        elif isinstance(node, list):
            stack.extend(node)
    return False


MAX_TEASER_LENGTH = 300


def _teaser(message: Any, ctx: RenderContext | None) -> dict | None:
    """What a reader who can't see a block gets instead, if the author set
    one ("Unlocks after your first week"). Only the message, never the content."""
    if ctx is None or not isinstance(message, str) or not message.strip():
        return None
    text = interpolate_text(message.strip()[:MAX_TEASER_LENGTH], ctx)
    if not text:
        return None
    return {
        "type": "callout",
        "attrs": {"type": "info"},
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
    }


@dataclass
class RenderStats:
    shown_blocks: int = 0
    hidden_blocks: int = 0
    variables: int = 0


def _render_children(children: list, ctx: RenderContext | None, stats: RenderStats, depth: int) -> list:
    out: list = []
    dropped_block = False
    for child in children:
        if not isinstance(child, dict):
            out.append(child)
            continue
        node_type = child.get("type")

        if node_type == CONDITIONAL_NODE:
            attrs = child.get("attrs") or {}
            # ctx=None strips every conditional block (search indexing).
            visible = ctx is not None and evaluate_rules(attrs.get("rules"), ctx)
            if visible:
                stats.shown_blocks += 1
                out.extend(_render_children(child.get("content") or [], ctx, stats, depth + 1))
            else:
                stats.hidden_blocks += 1
                teaser = _teaser(attrs.get("hiddenMessage"), ctx)
                if teaser:
                    out.append(teaser)
                else:
                    dropped_block = True
            continue

        if node_type == VARIABLE_NODE:
            stats.variables += 1
            attrs = child.get("attrs") or {}
            text = resolve_variable(
                attrs.get("path"), ctx, fallback=attrs.get("fallback"), fmt=attrs.get("format")
            ) if ctx is not None else ""
            if text:
                text_node: dict = {"type": "text", "text": text}
                if child.get("marks"):
                    text_node["marks"] = child["marks"]
                out.append(text_node)
            continue

        if node_type == "text" and isinstance(child.get("text"), str) and ctx is not None:
            text = interpolate_text(child["text"], ctx)
            if text:
                out.append({**child, "text": text})
            continue

        out.append(_render_node(child, ctx, stats, depth + 1))

    # A container whose only blocks were hidden would break `block+` schemas.
    if dropped_block and not out:
        out.append({"type": "paragraph"})
    return out


def _render_node(node: dict, ctx: RenderContext | None, stats: RenderStats, depth: int) -> dict:
    if depth > MAX_NODE_DEPTH:
        return {"type": "paragraph"}
    children = node.get("content")
    if not isinstance(children, list):
        return copy.deepcopy(node)
    rendered = {k: copy.deepcopy(v) for k, v in node.items() if k != "content"}
    rendered["content"] = _render_children(children, ctx, stats, depth)
    return rendered


def render_document(doc: Any, ctx: RenderContext) -> tuple[Any, RenderStats]:
    """The document as this reader sees it: rules applied, variables filled."""
    stats = RenderStats()
    if not isinstance(doc, dict):
        return doc, stats
    return _render_node(doc, ctx, stats, 0), stats


def strip_dynamic_content(doc: Any) -> Any:
    """The document with every conditional block and variable removed: the
    part every reader sees. For search/AI indexes shared across readers."""
    if not isinstance(doc, dict) or not has_dynamic_content(doc):
        return doc
    return _render_node(doc, None, RenderStats(), 0)


def conditional_blocks(doc: Any) -> list[tuple[Any, int | None]]:
    """Every conditional block in document order (ProseMirror's descendants
    order) as ``(rules, index of the enclosing conditional block or None)``:
    a nested block is only seen by readers who also see its parent."""
    blocks: list[tuple[Any, int | None]] = []

    def walk(node: Any, parent: int | None, depth: int) -> None:
        if not isinstance(node, dict) or depth > MAX_NODE_DEPTH:
            return
        if node.get("type") == CONDITIONAL_NODE:
            blocks.append(((node.get("attrs") or {}).get("rules"), parent))
            parent = len(blocks) - 1
        for child in node.get("content") or []:
            walk(child, parent, depth + 1)

    walk(doc, None, 0)
    return blocks


def count_conditions(rules: Any, depth: int = 0) -> int:
    """Conditions in a rule tree, as evaluate_rules would visit them."""
    if not isinstance(rules, dict) or depth > MAX_RULE_DEPTH:
        return 0
    items = rules.get("conditions")
    if not isinstance(items, list):
        return 0
    return min(MAX_CONDITIONS, sum(
        1 + (count_conditions(item, depth + 1) if isinstance(item, dict) and "conditions" in item else 0)
        for item in items
    ))


def conditional_reach(doc: Any, contexts: list[RenderContext]) -> list[int]:
    """How many of ``contexts`` see each conditional block, in document order.
    Each block's rules run once per reader; nested blocks reuse the parent's
    result instead of re-checking it."""
    blocks = conditional_blocks(doc)
    counts = [0] * len(blocks)
    for ctx in contexts:
        visible: list[bool] = []
        for index, (rules, parent) in enumerate(blocks):
            seen = (parent is None or visible[parent]) and evaluate_rules(rules, ctx)
            visible.append(seen)
            counts[index] += seen
    return counts
