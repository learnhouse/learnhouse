"""
D2L Brightspace reader: course "Export Components" / Import-Export-Copy packages.

An export is an IMS Content Package with D2L extensions (the ``d2l_2p0``
namespace). ``imsmanifest.xml`` holds the content tree (``organizations``:
modules and topics) and one resource per tool file, each tagged with a
``d2l_2p0:material_type``:

* ``content`` (a file topic), ``contentlink`` (a URL or a ``quickLink`` to a
  tool object), ``contentmodule`` (a module)
* ``d2lquiz`` (``quiz_d2l_<id>.xml``, QTI 1.2), ``d2lquestionlibrary``
  (``questiondb.xml``), ``d2lsurvey``, ``d2ldropbox`` (``dropbox_d2l.xml``,
  every assignment folder), ``d2ldiscussion``, ``d2lnews``, ``d2lgrades``...

Content topics point at quizzes and assignment folders through quickLinks
(``/d2l/common/dialogs/quickLink/quickLink.d2l?type=quiz&rCode=<code>``) whose
``rCode`` is the ``resource_code`` of the target. Tools nobody links to still
belong to the course and are appended as their own sections.

Quizzes use D2L's own QTI dialect (``qti_metadatafield`` labels, answers keyed
on ``response_label`` idents, ``D2L_Correct``/``D2L_Incorrect`` counters for
matching and ordering), so items are parsed here; the shared QTI module only
renders the material.
"""

from __future__ import annotations

import ast
import codecs
import html
import math
import operator
import os
import re
import zipfile
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import parse_qs, unquote, urlparse
from xml.etree.ElementTree import Element

from .. import ir
from ..html_to_tiptap import html_to_text, media_kind_for, vimeo_id, youtube_id
from ..qti import material_html
from ..xmlutil import (
    MAX_TEXT_BYTES,
    attr,
    children,
    inner_text,
    read_limited,
    text,
    to_bool,
    to_float,
    to_int,
    try_parse_file,
)
from .common import FileIndex, iso_from_text, make_resolver, slug_title
from ..report import error_text

KEY = "brightspace"
LABEL = "D2L Brightspace"

_D2L_NS = b"desire2learn.com/xsd/d2lcp"
# Course title when the export names none
UNTITLED = "Imported course"
_TOOL_FILES = re.compile(r"^(questiondb\.xml|dropbox_d2l\.xml|quiz_d2l_\d+\.xml)$", re.I)
_ENFORCED = re.compile(r"^/?content/enforced/[^/]+/(.+)$", re.I)
_VAR = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")

# Course objects that have no LearnHouse equivalent: material type -> (report title, kind)
_SKIPPED_TOOLS = {
    "d2lchecklist": ("Checklists", "checklist"),
    "d2lrubrics": ("Rubrics", "rubric"),
    "d2lcompetencies": ("Competencies", "competency"),
    "d2lcompetency": ("Competencies", "competency"),
    "d2lreleaseconditions": ("Release conditions", "release condition"),
    "d2lconditionalrelease": ("Release conditions", "release condition"),
    "d2lglossary": ("Glossary", "glossary"),
    "d2lselfassess": ("Self assessments", "self assessment"),
    "d2lawards": ("Awards", "award"),
    "d2lintelligentagents": ("Intelligent agents", "intelligent agent"),
    "imsbasiclti_xmlv1p0": ("LTI tool links", "LTI tool"),
}
# Handled elsewhere, or course settings rather than content (grade book, links
# tool, calendar, attendance, groups...): nothing to report
_SILENT_TOOLS = {
    "content", "contentlink", "contentmodule", "d2lquiz", "d2lquestionlibrary", "d2lsurvey", "d2ldropbox",
    "d2ldiscussion", "d2lnews", "orgunitconfig", "d2lcourseimage", "d2lsyllabus", "webcontent", "",
    "d2lgrades", "d2llinks", "d2lcalendar", "d2lattendance", "d2lgroups", "d2lcourseschedule",
}
# Tool files a course cannot do without: missing ones are a problem, not a design difference
_REQUIRED_FILES = {"d2lquiz", "d2ldropbox", "d2lquestionlibrary"}
# quickLink ``type`` values
_LINK_KINDS = {
    "discuss": "discussion", "checklist": "checklist", "selfassess": "self assessment", "lti": "LTI tool",
    "survey": "survey", "quiz": "quiz", "dropbox": "assignment", "content": "content link",
    "scorm": "scorm", "glossary": "glossary", "calendar": "calendar", "grades": "grades",
}


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


def detect(root: str) -> int:
    try:
        entries = os.listdir(root)
    except OSError:
        return 0
    for name in entries:
        if name.lower() == "imsmanifest.xml":
            try:
                with open(os.path.join(root, name), "rb") as f:
                    head = f.read(65536)
            except OSError:
                continue
            if _D2L_NS in head or b"d2l_2p0:" in head:
                # A D2L manifest outranks a stale Canvas course_settings/ folder
                # copied into the package (OpenStax D2L exports ship one)
                return 97
    if any(_TOOL_FILES.match(name) for name in entries):
        return 95
    return 0


def read(root: str) -> ir.Course:
    return _Reader(root).read()


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _visible(el: Element) -> bool:
    """D2L writes ``isvisible="False"`` on hidden topics; tools use ``is_hidden``."""
    if el is None:
        return True
    if not to_bool(attr(el, "isvisible", "true"), True):
        return False
    for name in ("is_hidden", "ishidden", "hidden", "isdraft", "is_draft"):
        if to_bool(attr(el, name), False):
            return False
    return True


def _read_text_file(path: str) -> str:
    return decode_html(read_limited(path, MAX_TEXT_BYTES))


_CHARSET = re.compile(rb"""<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_\-:.]+)""", re.I)


def decode_html(data: bytes) -> str:
    """Text of an HTML file whose encoding nobody declared reliably.

    Brightspace stores pages as uploaded: UTF-8 with or without a BOM,
    UTF-16 from Windows editors (FrontPage/Word "Unicode" saves, whole CBE
    courses), or a legacy code page.
    """
    for bom, codec in ((codecs.BOM_UTF32_LE, "utf-32"), (codecs.BOM_UTF32_BE, "utf-32"),
                       (codecs.BOM_UTF8, "utf-8-sig"), (codecs.BOM_UTF16_LE, "utf-16"),
                       (codecs.BOM_UTF16_BE, "utf-16")):
        if data.startswith(bom):
            return data.decode(codec, errors="replace").replace("\x00", "")
    head = data[:4000]
    if len(head) >= 4 and head.count(b"\x00") * 3 > len(head):
        # UTF-16 without a BOM: ASCII markup leaves every other byte NUL
        codec = "utf-16-le" if head[1::2].count(0) >= head[0::2].count(0) else "utf-16-be"
        return data.decode(codec, errors="replace").replace("\x00", "")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        pass
    m = _CHARSET.search(data[:4096])
    candidates = [m.group(1).decode("ascii", "ignore")] if m else []
    for codec in candidates + ["cp1252"]:
        try:
            return data.decode(codec)
        except (LookupError, UnicodeDecodeError):
            continue
    return data.decode("latin-1")


_DOCTYPE = re.compile(r"<!DOCTYPE[^>]*>|<\?xml[^>]*\?>", re.I)


def _timestamp(el: Optional[Element]) -> Optional[str]:
    """ISO date from D2L's ``<timestamp><month>..`` blocks or plain ISO text."""
    if el is None:
        return None
    ts = el.find("timestamp")
    if ts is None:
        return iso_from_text(inner_text(el))
    try:
        dt = datetime(to_int(text(ts, "year")), to_int(text(ts, "month")), to_int(text(ts, "day")),
                      to_int(text(ts, "hour")), to_int(text(ts, "minutes")), to_int(text(ts, "seconds")),
                      tzinfo=timezone.utc)
    except (ValueError, OverflowError, OSError):  # a year of 20 digits overflows datetime
        return None
    return dt.isoformat()


def _quicklink(href: str) -> Optional[tuple[str, str]]:
    """(type, rcode) of a ``quickLink.d2l`` URL."""
    if "quicklink" not in (href or "").lower():
        return None
    try:
        query = parse_qs(urlparse(href).query)
    except ValueError:
        return None
    lowered = {k.lower(): v for k, v in query.items()}
    kind = (lowered.get("type") or [""])[0].strip().lower()
    code = (lowered.get("rcode") or [""])[0].strip().lower()
    return kind, code


def _plain_to_html(value: str) -> str:
    return "".join(f"<p>{html.escape(line)}</p>" for line in (value or "").splitlines() if line.strip())


def _fmt_num(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else repr(round(float(value), 10))


# ---------------------------------------------------------------------------
# Arithmetic questions
# ---------------------------------------------------------------------------

_BINOPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
           ast.Pow: operator.pow, ast.Mod: operator.mod}
_UNARY = {ast.USub: operator.neg, ast.UAdd: operator.pos}
_FUNCS = {"sqrt": math.sqrt, "abs": abs, "sin": math.sin, "cos": math.cos, "tan": math.tan, "asin": math.asin,
          "acos": math.acos, "atan": math.atan, "exp": math.exp, "ln": math.log, "log": math.log10,
          "log10": math.log10, "floor": math.floor, "ceil": math.ceil, "round": round, "sinh": math.sinh,
          "cosh": math.cosh, "tanh": math.tanh}
_CONSTS = {"pi": math.pi, "e": math.e}


def eval_formula(formula: str, values: dict[str, float]) -> Optional[float]:
    """Evaluate a D2L arithmetic formula (``2 * {x} + {y}^2``) without ``eval``."""
    if not formula or len(formula) > 500:
        return None
    try:
        expr = _VAR.sub(lambda m: f"({values[m.group(1)]!r})", formula).replace("^", "**")
        tree = ast.parse(expr.strip(), mode="eval")
    except (KeyError, SyntaxError, ValueError):
        return None

    def ev(node):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) \
                and not isinstance(node.value, bool):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _BINOPS:
            left, right = ev(node.left), ev(node.right)
            if isinstance(node.op, ast.Pow) and (abs(right) > 100 or abs(left) > 1e6):
                raise ValueError("exponent too large")
            return _BINOPS[type(node.op)](left, right)
        if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
            return _UNARY[type(node.op)](ev(node.operand))
        if isinstance(node, ast.Name) and node.id.lower() in _CONSTS:
            return _CONSTS[node.id.lower()]
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id.lower() in _FUNCS \
                and not node.keywords and len(node.args) == 1:
            return _FUNCS[node.func.id.lower()](ev(node.args[0]))
        raise ValueError("unsupported expression")

    try:
        result = float(ev(tree))
    except (ValueError, TypeError, ZeroDivisionError, OverflowError):
        return None
    return result if math.isfinite(result) else None


# ---------------------------------------------------------------------------
# QTI items (D2L dialect)
# ---------------------------------------------------------------------------


def _meta_pairs(container: Optional[Element]) -> dict[str, str]:
    """``fieldlabel``/``fieldentry`` pairs in document order.

    D2L wraps each pair in ``qti_metadatafield`` (with an underscore, unlike
    plain QTI's ``qtimetadatafield``); some exports drop the wrapper.
    """
    meta: dict[str, str] = {}
    if container is None:
        return meta
    pending = ""
    for node in container.iter():
        if node.tag == "fieldlabel":
            pending = (node.text or "").strip().lower()
        elif node.tag == "fieldentry" and pending:
            meta.setdefault(pending, (node.text or "").strip())
            pending = ""
    return meta


def _item_meta(item: Element) -> dict[str, str]:
    return _meta_pairs(item.find("itemmetadata"))


def _condition_values(cond: Element) -> list[tuple[str, str]]:
    """(respident, value) pairs a condition requires, ignoring ``<not>`` branches."""
    pairs: list[tuple[str, str]] = []

    def walk(node: Element, negated: bool):
        for child in node:
            if child.tag == "not":
                walk(child, not negated)
            elif child.tag in ("and", "or"):
                walk(child, negated)
            elif child.tag in ("varequal", "varsubstring") and not negated:
                pairs.append((attr(child, "respident"), (child.text or "").strip()))

    cv = cond.find("conditionvar")
    if cv is not None:
        walk(cv, False)
    return pairs


def _condition_score(cond: Element) -> float:
    """Positive when the condition rewards the answer; 0 or less otherwise."""
    if "incorrect" in (attr(cond, "title") or "").lower():
        return 0.0
    best = 0.0
    for sv in cond.iter("setvar"):
        varname = (attr(sv, "varname") or "").lower()
        if "incorrect" in varname:
            return 0.0
        value = to_float(sv.text, float("nan"))
        if math.isnan(value):
            continue
        best = max(best, value)
    return best


def _correct(item: Element) -> dict[str, list[str]]:
    """respident -> rewarded values, best scored first."""
    scored: dict[str, list[tuple[float, int, str]]] = {}
    order = 0
    for cond in item.iter("respcondition"):
        score = _condition_score(cond)
        if score <= 0:
            continue
        for respident, value in _condition_values(cond):
            if not value:
                continue
            bucket = scored.setdefault(respident, [])
            if value not in [v for _s, _o, v in bucket]:
                bucket.append((score, order, value))
                order += 1
    return {k: [v for _s, _o, v in sorted(b, key=lambda t: (-t[0], t[1]))] for k, b in scored.items()}


def _top_scored(item: Element, resp: Element, values: set[str]) -> set[str]:
    """The best-scored of ``values``: a 25% "near miss" option is not a second right answer
    of a single-answer question."""
    keys = _keys(resp)
    best: dict[str, float] = {}
    for cond in item.iter("respcondition"):
        score = _condition_score(cond)
        for respident, value in _condition_values(cond):
            if value in values and respident in keys and score > 0:
                best[value] = max(best.get(value, 0.0), score)
    if len(set(best.values())) < 2:
        return values
    top = max(best.values())
    return {v for v, s in best.items() if s == top}


def _keys(resp: Element) -> set[str]:
    """Idents a response may be scored under (D2L scores blanks by their label)."""
    keys = {attr(resp, "ident"), attr(resp, "respident")}
    keys.update(attr(lb, "ident") for lb in resp.iter("response_label"))
    keys.discard("")
    return keys


def _values_for(correct: dict[str, list[str]], resp: Element) -> list[str]:
    out: list[str] = []
    for key in _keys(resp):
        for v in correct.get(key, []):
            if v not in out:
                out.append(v)
    return out


def _labels(resp: Element) -> list[tuple[str, str]]:
    return [(attr(lb, "ident"), material_html(lb) or html.escape(inner_text(lb)))
            for lb in resp.iter("response_label")]


def _unwrap_p(fragment: str) -> str:
    """``<p>text</p>`` -> ``text`` so fill-in-the-blank chunks join into one sentence."""
    m = re.fullmatch(r"\s*<p\b[^>]*>(.*?)</p>\s*", fragment or "", re.S | re.I)
    if m and "<p" not in m.group(1).lower():
        return m.group(1).strip()
    return fragment


def _strip(fragment: str) -> str:
    return html_to_text(fragment) or html.unescape(re.sub(r"<[^>]+>", "", fragment or "")).strip()


class _ItemParser:
    def __init__(self, resolve: ir.Resolver):
        self.resolve = resolve

    def rich(self, fragment: str) -> ir.RichText:
        return ir.RichText(fragment, self.resolve)

    def parse(self, item: Element) -> ir.Question:
        meta = _item_meta(item)
        label = (meta.get("qmd_questiontype") or "").strip().lower()
        points = to_float(meta.get("qmd_weighting"), 0.0) or 1.0
        q = ir.Question(type=ir.QType.UNSUPPORTED, title=attr(item, "title"),
                        id=attr(item, "label") or attr(item, "ident"), points=points,
                        source_type=meta.get("qmd_questiontype", ""))
        q.general_feedback = self._general_feedback(item)
        pres = item.find("presentation")
        responses = [el for el in (pres.iter() if pres is not None else []) if el.tag.startswith("response_")
                     and el.tag != "response_extension" and el.tag != "response_label"]
        lids = [r for r in responses if r.tag == "response_lid"]
        strs = [r for r in responses if r.tag == "response_str"]
        nums = [r for r in responses if r.tag == "response_num"]
        grps = [r for r in responses if r.tag == "response_grp"]
        correct = _correct(item)

        if label == "fill in the blanks":
            return self._fib(q, item, pres, correct)
        q.text = self.rich(self._question_html(pres))
        if label in ("multiple choice", "true/false", "multi-select"):
            return self._choice(q, item, lids, correct, label)
        if label == "likert":
            q.reason = "Likert (opinion scale) questions have no correct answer"
            return q
        if label == "matching":
            return self._matching(q, grps or lids, correct)
        if label == "ordering":
            return self._ordering(q, (grps or lids)[:1], correct)
        if label in ("arithmetic", "significant figures"):
            return self._arithmetic(q, item, nums, correct, label)
        if label == "short answer":
            return self._short(q, strs, correct, item)
        if label == "multi-short answer":
            return self._multi_short(q, strs, correct, item)
        if label == "long answer":
            q.type = ir.QType.ESSAY
            return q
        if label in ("text information", "image", "text", "text only"):
            q.type = ir.QType.DESCRIPTION
            return q
        if label:
            q.reason = f"Brightspace question type \"{meta.get('qmd_questiontype')}\" is not supported"
            return q
        # No D2L label: guess from the response structure
        if lids:
            return self._choice(q, item, lids, correct, label)
        if strs:
            return self._short(q, strs, correct, item)
        if not responses:
            q.type = ir.QType.DESCRIPTION
            return q
        q.reason = "question structure not recognized"
        return q

    # -------------------------------------------------------------- pieces

    def _question_html(self, pres: Optional[Element]) -> str:
        if pres is None:
            return ""
        parts: list[str] = []

        def walk(node: Element):
            for child in node:
                if child.tag.startswith("response_"):
                    continue
                if child.tag == "material":
                    parts.append(material_html(child))
                else:
                    walk(child)

        walk(pres)
        return "".join(p for p in parts if p).strip()

    def _general_feedback(self, item: Element) -> str:
        label = attr(item, "label")
        linked = {attr(df, "linkrefid") for df in item.iter("displayfeedback")}
        texts = []
        for fb in item.iter("itemfeedback"):
            ident = attr(fb, "ident")
            if ident in linked and ident != label:
                continue
            if ident == label or not ident or "general" in ident.lower():
                texts.append(material_html(fb))
        return "".join(t for t in texts if t)

    def _choice_feedback(self, item: Element) -> dict[str, str]:
        """choice ident -> feedback text, via ``displayfeedback`` links."""
        fb_text = {attr(fb, "ident"): _strip(material_html(fb)) for fb in item.iter("itemfeedback")}
        out: dict[str, str] = {}
        for cond in item.iter("respcondition"):
            values = _condition_values(cond)
            for df in cond.iter("displayfeedback"):
                body = fb_text.get(attr(df, "linkrefid"), "")
                if body and len(values) == 1:
                    out.setdefault(values[0][1], body)
        return out

    def _choice(self, q: ir.Question, item: Element, lids: list[Element], correct, label: str) -> ir.Question:
        if not lids:
            q.reason = "choices could not be read"
            return q
        resp = lids[0]
        good = set(_values_for(correct, resp))
        q.multiple = label == "multi-select" or (attr(resp, "rcardinality") or "").lower() == "multiple"
        if not q.multiple and len(good) > 1:
            good = _top_scored(item, resp, good)
        feedback = self._choice_feedback(item)
        q.choices = [ir.Choice(text=self.rich(t), correct=lid in good, feedback=feedback.get(lid, ""))
                     for lid, t in _labels(resp)]
        is_tf = label == "true/false" or (
            not label and len(q.choices) == 2
            and {_strip(c.text.html).lower() for c in q.choices} <= {"true", "false"})
        q.type = ir.QType.TRUEFALSE if is_tf and len(q.choices) == 2 and not q.multiple else ir.QType.MULTICHOICE
        return q

    def _matching(self, q: ir.Question, groups: list[Element], correct) -> ir.Question:
        pool: list[str] = []
        pairs: list[ir.MatchPair] = []
        for grp in groups:
            by_id = {lid: _strip(t) for lid, t in _labels(grp)}
            for t in by_id.values():
                if t and t not in pool:
                    pool.append(t)
            prompt = material_html(grp.find("material"))
            key = attr(grp, "respident") or attr(grp, "ident")
            good = [v for v in correct.get(key, []) if v in by_id]
            if good and prompt:
                pairs.append(ir.MatchPair(prompt=self.rich(prompt), answer=by_id[good[0]]))
        if not pairs:
            q.reason = "matching pairs could not be read"
            return q
        used = {p.answer for p in pairs}
        q.pairs = pairs
        q.distractors = [p for p in pool if p not in used]
        q.type = ir.QType.MATCHING
        return q

    def _ordering(self, q: ir.Question, groups: list[Element], correct) -> ir.Question:
        if not groups:
            q.reason = "ordering items could not be read"
            return q
        labels = _labels(groups[0])
        positions: dict[str, float] = {}
        for lid, _t in labels:
            for v in correct.get(lid, []):
                pos = to_float(v, float("nan"))
                if not math.isnan(pos):
                    positions.setdefault(lid, pos)
                    break
        indexed = list(enumerate(labels))
        if positions:
            indexed.sort(key=lambda t: (positions.get(t[1][0], math.inf), t[0]))
        q.ordering = [_strip(t) for _i, (_lid, t) in indexed if _strip(t)]
        q.type = ir.QType.ORDERING if q.ordering else ir.QType.UNSUPPORTED
        if not q.ordering:
            q.reason = "ordering items could not be read"
        return q

    def _case_sensitive(self, item: Element) -> bool:
        return any((attr(v, "case") or "").lower() == "yes" for v in item.iter("varequal"))

    def _short(self, q: ir.Question, strs: list[Element], correct, item: Element) -> ir.Question:
        q.case_sensitive = self._case_sensitive(item)
        if len(strs) > 1:
            q.blanks = [ir.Blank(answers=_values_for(correct, s)) for s in strs]
            q.text = self.rich(q.text.html + "".join(f" {{{{{i}}}}}" for i in range(1, len(strs) + 1)))
            q.type = ir.QType.CLOZE
            return q
        answers = _values_for(correct, strs[0]) if strs else []
        if not answers:
            # Ungraded short answer: graded by hand
            q.type = ir.QType.ESSAY
            return q
        q.answers = answers
        q.type = ir.QType.SHORTANSWER
        return q

    def _multi_short(self, q: ir.Question, strs: list[Element], correct, item: Element) -> ir.Question:
        answers: list[str] = []
        boxes = 0
        for s in strs:
            for v in _values_for(correct, s):
                if v not in answers:
                    answers.append(v)
            fib = s.find("render_fib")
            boxes += max(1, to_int(attr(fib, "input_boxes"), 1)) if fib is not None else 1
        q.case_sensitive = self._case_sensitive(item)
        if not answers:
            q.type = ir.QType.ESSAY
            return q
        if boxes <= 1:
            q.answers = answers
            q.type = ir.QType.SHORTANSWER
            return q
        q.blanks = [ir.Blank(answers=list(answers)) for _ in range(boxes)]
        q.text = self.rich(q.text.html + "".join(f" {{{{{i}}}}}" for i in range(1, boxes + 1)))
        q.type = ir.QType.CLOZE
        return q

    def _fib(self, q: ir.Question, item: Element, pres: Optional[Element], correct) -> ir.Question:
        """Alternating ``material`` / ``response_str`` in the flow: text, gap, text..."""
        out: list[str] = []
        blanks: list[ir.Blank] = []

        def walk(node: Element):
            for child in node:
                if child.tag == "material":
                    out.append(_unwrap_p(material_html(child)))
                elif child.tag == "response_str":
                    blanks.append(ir.Blank(answers=_values_for(correct, child)))
                    out.append(f" {{{{{len(blanks)}}}}} ")
                elif not child.tag.startswith("response_"):
                    walk(child)

        if pres is not None:
            walk(pres)
        hint = _strip(material_html(item.find("hint")))
        if hint and blanks:
            blanks[0].hint = hint
        joined = re.sub(r"\s+", " ", "".join(out)).strip()
        q.text = self.rich(joined if re.search(r"<(p|div|ul|ol|table|h\d)\b", joined, re.I) else f"<p>{joined}</p>")
        q.case_sensitive = self._case_sensitive(item)
        if not blanks:
            q.reason = "the blanks could not be read"
            return q
        q.blanks = blanks
        q.type = ir.QType.CLOZE
        return q

    def _arithmetic(self, q: ir.Question, item: Element, nums: list[Element], correct, label: str) -> ir.Question:
        values: dict[str, float] = {}
        randomized = False
        for var in item.iter("variable"):
            name = attr(var, "name")
            if not name:
                continue
            lo = to_float(text(var, "minvalue"), 0.0)
            randomized = randomized or to_float(text(var, "maxvalue"), lo) != lo
            places = to_int(text(var, "decimalplaces"), 0)
            values[name] = round(lo, max(0, min(places, 10)))
        formula = ""
        tolerance_el = precision_el = units_el = None
        for cond in item.iter("respcondition"):
            ext = cond.find("respcond_extension")
            if ext is not None and text(ext, "formula"):
                formula = text(ext, "formula")
                tolerance_el, precision_el, units_el = ext.find("tolerance"), ext.find("precision"), ext.find("units")
                break
        if not formula:
            formula = next((text(f) for f in item.iter("formula") if text(f)), "")
        answer = eval_formula(formula, values) if formula else None
        if answer is None:
            # Plain numeric answer key (no formula)
            for respident, value in [p for cond in item.iter("respcondition") if _condition_score(cond) > 0
                                     for p in _condition_values(cond)]:
                num = to_float(value, float("nan"))
                if math.isfinite(num):
                    answer = num
                    break
        if answer is None:
            q.reason = f"the {label} formula could not be evaluated" if formula else "no numeric answer"
            return q
        if precision_el is not None:
            places = to_int(inner_text(precision_el), -1)
            kind = (attr(precision_el, "type") or "").lower()
            if places >= 0 and kind.startswith("sig") and answer:
                answer = float(f"{answer:.{max(1, places)}g}")
            elif places >= 0:
                answer = round(answer, min(places, 10))
        tolerance = 0.0
        if tolerance_el is not None:
            t = abs(to_float(inner_text(tolerance_el), 0.0))
            tolerance = abs(answer) * t / 100 if "percent" in (attr(tolerance_el, "type") or "").lower() else t
        if units_el is not None and inner_text(units_el):
            q.unit = inner_text(units_el)
        # The question text shows the variables: freeze them at the values used
        q.text = self.rich(_VAR.sub(lambda m: _fmt_num(values[m.group(1)]) if m.group(1) in values
                                    else m.group(0), q.text.html))
        q.numeric = [ir.NumericAnswer(value=answer, tolerance=tolerance)]
        q.type = ir.QType.NUMERICAL
        if randomized:
            q.general_feedback = (q.general_feedback or "") + (
                "<p>Variables fixed at: " + ", ".join(f"{k} = {_fmt_num(v)}" for k, v in values.items()) + "</p>")
        return q


# ---------------------------------------------------------------------------
# The reader
# ---------------------------------------------------------------------------


class _Resource:
    __slots__ = ("ident", "type", "href", "title")

    def __init__(self, el: Element):
        self.ident = attr(el, "identifier")
        self.type = (attr(el, "material_type") or "").lower()
        self.href = attr(el, "href")
        self.title = attr(el, "title")


class _Reader:
    def __init__(self, root: str):
        self.index = FileIndex(root)
        self.warnings: list[str] = []
        self.skipped: list[tuple[str, str, str]] = []  # (title, kind, reason)
        self.resources: dict[str, _Resource] = {}
        self.res_order: list[_Resource] = []
        # Tool objects by lowercased resource code / identifier, and the order they came in
        self.quizzes: dict[str, ir.Assessment] = {}
        self.quiz_list: list[ir.Assessment] = []
        self.surveys: dict[str, ir.Page] = {}
        self.survey_list: list[ir.Page] = []
        self.folders: dict[str, ir.AssignmentItem] = {}
        self.folder_list: list[tuple[str, ir.AssignmentItem]] = []  # (category, folder)
        self.topics: dict[str, str] = {}  # discussion topic resource code -> title
        self.used: set[int] = set()
        self.bank_items: dict[str, Element] = {}
        self.bank_sections: dict[str, Element] = {}
        self._libraries: list[tuple[str, Element]] = []
        self._used_items: set[int] = set()  # question elements some quiz or survey uses
        self.file_items: dict[str, dict[str, Element]] = {}  # quiz file name -> label/ident -> item
        self._enforced_cache: dict[str, Optional[ir.Asset]] = {}
        self._res_by_path: Optional[dict[str, list[_Resource]]] = None

    def warn(self, message: str) -> None:
        """A genuine problem: a file that could not be parsed, a reference that leads nowhere."""
        if message not in self.warnings:
            self.warnings.append(message)

    def skip(self, title: str, kind: str, reason: str) -> None:
        """A source item with no LearnHouse equivalent: listed in the report, not a warning."""
        entry = (title, kind, reason)
        if entry not in self.skipped:
            self.skipped.append(entry)

    # ------------------------------------------------------------ resolve

    def _extra(self, url: str) -> Optional[ir.Asset]:
        """``/content/enforced/<orgunit>-<code>/a.png`` (absolute course paths) -> package path."""
        try:
            path = unquote(urlparse((url or "").strip()).path)
        except ValueError:
            return None
        m = _ENFORCED.match(path)
        if not m:
            return None
        rel = m.group(1)
        if rel not in self._enforced_cache:
            full = self.index.get(rel)
            if not full:
                matches = self.index.by_basename(os.path.basename(rel))
                full = matches[0] if len(matches) == 1 else None
            self._enforced_cache[rel] = self.index.asset(full) if full else None
        return self._enforced_cache[rel]

    def resolver(self, base_rel_dir: str = "") -> ir.Resolver:
        return make_resolver(self.index, base_rel_dir, extra=self._extra)

    def rel(self, full: str) -> str:
        return os.path.relpath(full, self.index.root).replace(os.sep, "/")

    def find(self, href: str) -> Optional[str]:
        if not href:
            return None
        for candidate in (href, unquote(href)):
            full = self.index.get(candidate)
            if full:
                return full
        enforced = self._extra(href)
        return enforced.path if enforced else None

    # --------------------------------------------------------------- read

    def read(self) -> ir.Course:
        manifest_path = self.index.get("imsmanifest.xml")
        manifest = try_parse_file(manifest_path) if manifest_path else None
        if manifest_path and manifest is None:
            self.warn("imsmanifest.xml could not be parsed; only the tool files were read")
        if manifest is not None:
            for res in manifest.iter("resource"):
                r = _Resource(res)
                if r.ident:
                    self.resources[r.ident] = r
                self.res_order.append(r)

        course = ir.Course(title="", source=KEY, id=attr(manifest, "identifier"))
        self._course_meta(manifest, course)
        self._load_tools()

        sections: list[ir.Section] = []
        org = manifest.find("organizations/organization") if manifest is not None else None
        top = children(org, "item")
        if top:
            loose: Optional[ir.Section] = None
            for el in top:
                if self._is_module(el):
                    loose = None
                    self._module(el, [], True, sections)
                else:
                    if loose is None:
                        loose = ir.Section(title=course.title or "Course content", id=f"{course.id}:root")
                        sections.append(loose)
                    item = self._topic(el, True)
                    if item is not None:
                        loose.items.append(item)
        else:
            loose = ir.Section(title="Course content", id="content")
            for r in self.res_order:
                if r.type in ("content", "contentlink"):
                    item = self._resource_item(r, r.title or slug_title(r.href), r.ident, True, "")
                    if item is not None:
                        loose.items.append(item)
            if loose.items:
                sections.append(loose)

        if course.title == UNTITLED and len(top) == 1 and self._is_module(top[0]):
            # D2L manifests often carry no title: a course wrapped in one
            # top-level module is named after it, without repeating it in
            # every chapter name ("Calculus, Volume 1 › Chapter 2")
            module_title = text(top[0], "title")
            if module_title:
                course.title = module_title
                prefix = f"{module_title} › "
                for s in sections:
                    if s.title.startswith(prefix):
                        s.title = s.title[len(prefix):]
        sections.extend(self._unlinked_tools())
        sections.extend(self._library_sections())
        course.sections = sections
        course.warnings = self.warnings
        course.skipped = self.skipped
        return course

    # --------------------------------------------------------------- meta

    def _course_meta(self, manifest: Optional[Element], course: ir.Course) -> None:
        general = manifest.find("metadata/lom/general") if manifest is not None else None
        if general is not None:
            course.title = inner_text(general.find("title")) if general.find("title") is not None else ""
            course.short_name = inner_text(general.find("keyword")) if general.find("keyword") is not None else ""
            course.language = text(general, "language")
            desc = general.find("description")
            if desc is not None and inner_text(desc):
                course.summary = ir.RichText(_plain_to_html(inner_text(desc)), self.resolver())
        conf_res = next((r for r in self.res_order if r.type == "orgunitconfig"), None)
        conf_path = self.find(conf_res.href) if conf_res else self.index.get("orgunitconfig/orgunitconfig.xml")
        conf = try_parse_file(conf_path) if conf_path else None
        if conf is not None:
            course.title = course.title or attr(conf, "name") or text(conf, "name") or attr(conf, "title")
            course.short_name = course.short_name or attr(conf, "code") or text(conf, "code")
        if not course.title and manifest is not None:
            course.title = text(manifest, "organizations/organization/title")
        course.title = course.title or UNTITLED

        img_res = next((r for r in self.res_order if r.type == "d2lcourseimage"), None)
        img_xml = self.find(img_res.href) if img_res else self.index.get("courseimage_d2l.xml")
        img = try_parse_file(img_xml) if img_xml else None
        location = text(img, "course_image/picLocation") if img is not None else ""
        if location:
            full = self.find(location)
            if full:
                course.thumbnail = self.index.asset(full)

    # -------------------------------------------------------------- tools

    def _files_of(self, material_type: str, pattern: str) -> list[str]:
        """Tool files from the manifest, then same-named files it forgot to list."""
        paths = []
        for r in self.res_order:
            if r.type == material_type:
                full = self.find(r.href)
                if full and full not in paths:
                    paths.append(full)
                elif not full and material_type in _REQUIRED_FILES:
                    self.warn(f"File {r.href} is listed in the manifest but missing from the export")
        rx = re.compile(pattern, re.I)
        for f in sorted(os.listdir(self.index.root)):
            full = os.path.join(self.index.root, f)
            if rx.match(f) and os.path.isfile(full) and full not in paths:
                paths.append(full)
        return paths

    def _load_tools(self) -> None:
        for path in self._files_of("d2lquestionlibrary", r"^questiondb\.xml$"):
            self._load_bank(path)
        # Parse every quiz first: an itemref can point at a question kept in
        # another quiz's file (``<d2l_2p0:file href="quiz_d2l_57713.xml"/>``)
        docs = [(path, self._parse_assessments(path), False)
                for path in self._files_of("d2lquiz", r"^quiz_d2l_\d+\.xml$")]
        docs += [(path, self._parse_assessments(path), True)
                 for path in self._files_of("d2lsurvey", r"^survey_d2l_\d+\.xml$")]
        for path, doc, survey in docs:
            if doc is not None:
                self._load_quizzes(path, doc, survey=survey)
        for path in self._files_of("d2ldropbox", r"^dropbox_d2l\.xml$"):
            self._load_dropbox(path)
        for path in self._files_of("d2ldiscussion", r"^discussion_d2l_\d+\.xml$"):
            doc = try_parse_file(path)
            if doc is None:
                continue
            # Topic titles name the target of ``quickLink?type=discuss`` items
            for topic in doc.iter("topic"):
                code = (attr(topic, "resource_code") or "").lower()
                if code:
                    self.topics[code] = text(topic, "content/title")
            for forum in doc.iter("forum"):
                count = len(list(forum.iter("topic")))
                self.skip(text(forum, "content/title") or "Discussion forum", "discussion",
                          "discussions are not migrated" + (f" ({count} topics)" if count > 1 else ""))
        news = 0
        for path in self._files_of("d2lnews", r"^news_d2l\.xml$"):
            doc = try_parse_file(path)
            news += len(children(doc, "item")) if doc is not None else 0
        if news:
            self.skip("Announcements", "announcement", f"{news} announcements are not migrated")
        seen: set[str] = set()
        for r in self.res_order:
            if r.type in _SILENT_TOOLS or r.type in seen:
                continue
            seen.add(r.type)
            if r.type in _SKIPPED_TOOLS:
                title, kind = _SKIPPED_TOOLS[r.type]
                self.skip(title, kind, "not migrated")
            else:
                self.skip(r.type, r.type, "Brightspace component not supported")

    def _load_bank(self, path: str) -> None:
        doc = try_parse_file(path)
        if doc is None:
            self.warn(f"The question library {os.path.basename(path)} could not be parsed")
            return
        self._libraries.append((path, doc))
        for section in doc.iter("section"):
            ident = attr(section, "ident")
            if ident:
                self.bank_sections.setdefault(ident, section)
        for item in doc.iter("item"):
            for key in (attr(item, "label"), attr(item, "ident")):
                if key:
                    self.bank_items.setdefault(key, item)

    def _parse_assessments(self, path: str) -> Optional[Element]:
        doc = try_parse_file(path)
        if doc is None:
            self.warn(f"{os.path.basename(path)} could not be parsed and was skipped")
            return None
        items = self.file_items.setdefault(os.path.basename(path).lower(), {})
        for item in doc.iter("item"):
            for key in (attr(item, "label"), attr(item, "ident")):
                if key:
                    items.setdefault(key, item)
        return doc

    def _ref_item(self, ref: Element) -> Optional[Element]:
        key = attr(ref, "linkrefid")
        file_el = ref.find("file")
        href = os.path.basename((attr(file_el, "href") or "").replace("\\", "/")).lower()
        if href and key in self.file_items.get(href, {}):
            return self.file_items[href][key]
        if key in self.bank_items:
            return self.bank_items[key]
        return next((items[key] for items in self.file_items.values() if key in items), None)

    def _load_quizzes(self, path: str, doc: Element, *, survey: bool) -> None:
        parser = _ItemParser(self.resolver(os.path.dirname(self.rel(path))))
        if self._res_by_path is None:
            self._res_by_path = {}
            for r in self.res_order:
                if r.href and r.type in ("d2lquiz", "d2lsurvey"):
                    full = self.find(r.href)
                    if full:
                        self._res_by_path.setdefault(full, []).append(r)
        file_res = self._res_by_path.get(path, [])
        for a in doc.iter("assessment"):
            obj = self._survey(a, parser) if survey else self._quiz(a, parser)
            keys = {attr(a, "resource_code"), attr(a, "ident"), attr(a, "id")}
            keys.update(r.ident for r in file_res)
            keys = {k.lower() for k in keys if k}
            target = self.surveys if survey else self.quizzes
            for k in keys:
                target.setdefault(k, obj)
            (self.survey_list if survey else self.quiz_list).append(obj)

    def _questions(self, container: Element, parser: _ItemParser, title: str) -> list[tuple[ir.Question, Element]]:
        """(question, source item) of a quiz section in order, following references."""
        out: list[tuple[ir.Question, Element]] = []
        for child in container:
            if child.tag == "item":
                self._used_items.add(id(child))
                out.append((parser.parse(child), child))
            elif child.tag == "itemref":
                ref = self._ref_item(child)
                if ref is None:
                    self.warn(f"\"{title}\": a question from the question library is missing from the export")
                    continue
                self._used_items.add(id(ref))
                q = parser.parse(ref)
                pts = to_float(text(child, "points"), 0.0)
                if pts > 0:
                    q.points = pts
                out.append((q, ref))
            elif child.tag == "sectionref":
                ref = self.bank_sections.get(attr(child, "linkrefid"))
                if ref is None:
                    self.warn(f"\"{title}\": a question library section is missing from the export")
                    continue
                out.extend(self._questions(ref, parser, title))
            elif child.tag == "section":
                # A random section draws N of its questions in Brightspace: all are imported
                out.extend(self._questions(child, parser, title))
        return out

    def _quiz(self, a: Element, parser: _ItemParser) -> ir.Assessment:
        title = attr(a, "title") or "Quiz"
        proc = a.find("assess_procextension")
        intro = self._intro(a)
        attempts_raw = text(proc, "attempts_allowed").lower() if proc is not None else ""
        if attempts_raw in ("unlimited", "0"):
            attempts = 0
        else:
            attempts = max(1, to_int(attempts_raw, 1))
        time_limit = None
        if proc is not None and to_bool(text(proc, "enforce_time_limit"), False):
            time_limit = to_int(text(proc, "time_limit"), 0) or None
        due = None
        if proc is not None:
            due = _timestamp(proc.find("due_date")) or _timestamp(proc.find("date_due")) \
                or _timestamp(proc.find("date_end"))
        feedback = a.find("assessfeedback")
        show = to_bool(text(feedback, "show_correct_answers"), False) if feedback is not None else False
        shuffle = any((attr(o, "order_type") or "").lower() == "random" for o in a.iter("order"))
        questions: list[ir.Question] = []
        for section in children(a, "section"):
            questions.extend(q for q, _el in self._questions(section, parser, title))
        visible = to_bool(text(proc, "is_active"), True) if proc is not None else True
        return ir.Assessment(title=title, questions=questions, intro=ir.RichText(intro, parser.resolve),
                             due_date=due, max_attempts=attempts, show_correct_answers=show,
                             time_limit_minutes=time_limit, shuffle=shuffle, id=attr(a, "ident"),
                             visible=visible)

    def _intro(self, a: Element) -> str:
        parts: list[str] = []
        for container in (a.find("rubric"), a.find("assess_procextension/intro_message"),
                          a.find("assess_procextension/description")):
            if container is None:
                continue
            nodes = list(container.iter("mattext")) or [container]
            for node in nodes:
                if (attr(node, "isdisplayed") or "yes").lower() == "no":
                    continue
                body = node.text or ""
                ttype = (attr(node, "texttype") or "").lower()
                parts.append(body if ttype == "text/html" or "<" in body else _plain_to_html(body))
        return "".join(p for p in parts if p.strip())

    def _survey(self, a: Element, parser: _ItemParser) -> ir.Page:
        """Surveys have no answers to grade: a page listing their questions."""
        title = attr(a, "title") or "Survey"
        parts: list[ir.Part] = []
        intro = self._intro(a)
        if intro:
            parts.append(ir.HtmlPart(ir.RichText(intro, parser.resolve)))
        questions: list[tuple[ir.Question, Element]] = []
        for section in children(a, "section"):
            questions.extend(self._questions(section, parser, title))
        for i, (q, item) in enumerate(questions, start=1):
            body = q.text.html or html.escape(q.title or f"Question {i}")
            options = []
            for resp in item.iter():
                if resp.tag in ("response_lid", "response_grp"):
                    options.extend(_strip(t) for _lid, t in _labels(resp))
            listing = "".join(f"<li>{html.escape(o)}</li>" for o in options if o)
            fragment = f"<p><strong>{i}.</strong></p>{body}" + (f"<ul>{listing}</ul>" if listing else "")
            parts.append(ir.HtmlPart(ir.RichText(fragment, parser.resolve)))
        if not questions:
            parts.append(ir.HtmlPart(ir.RichText("<p>This survey had no questions in the export.</p>")))
        proc = a.find("assess_procextension")
        visible = to_bool(text(proc, "is_active"), True) if proc is not None else True
        return ir.Page(title=title, parts=parts, id=attr(a, "ident"), visible=visible)

    def _load_dropbox(self, path: str) -> None:
        doc = try_parse_file(path)
        if doc is None:
            self.warn(f"{os.path.basename(path)} could not be parsed; assignments were skipped")
            return
        resolve = self.resolver(os.path.dirname(self.rel(path)))
        parents = {child: parent for parent in doc.iter() for child in parent}
        for folder in doc.iter("folder"):
            parent = parents.get(folder)
            category = attr(parent, "name") if parent is not None and parent.tag == "category" else ""
            item = self._folder(folder, resolve)
            for key in (attr(folder, "resource_code"), attr(folder, "id")):
                if key:
                    self.folders.setdefault(key.lower(), item)
            self.folder_list.append((category, item))

    def _folder(self, folder: Element, resolve: ir.Resolver) -> ir.AssignmentItem:
        title = attr(folder, "name") or "Assignment"
        instr = folder.find("instructions")
        body = text(instr, "text") if instr is not None else ""
        if body and (attr(instr, "text_type") or "").lower() != "text/html" and "<" not in body:
            body = _plain_to_html(body)
        attachments: list[ir.Asset] = []
        links: list[str] = []
        att = folder.find("attachment_set")
        if att is not None:
            for link in att.iter("link"):
                url = attr(link, "url") or attr(link, "href")
                if url:
                    name = attr(link, "name") or url
                    links.append(f'<li><a href="{html.escape(url, quote=True)}">{html.escape(name)}</a></li>')
            for f in att.iter():
                if f.tag in ("link", "links", "attachment_set") or f is att:
                    continue
                ref = attr(f, "path") or attr(f, "href") or attr(f, "file_path") or attr(f, "file") \
                    or attr(f, "name") or (f.text or "").strip()
                full = self.find(ref) if ref else None
                if full:
                    attachments.append(self.index.asset(full, attr(f, "name") or None))
                elif ref and f.tag in ("file", "attachment"):
                    self.skip(f"{title}: {attr(f, 'name') or os.path.basename(ref)}", "file",
                              "missing from the export")
        if links:
            body += f"<ul>{''.join(links)}</ul>"
        due = iso_from_text(text(folder, "date_due")) or iso_from_text(text(folder, "availability_end/availability_date")) \
            or iso_from_text(text(folder, "date_end"))
        out_of = to_float(attr(folder, "out_of"), 0.0)
        sub_type = attr(folder, "submission_type", "0").strip()
        allow_text = sub_type == "1" or to_bool(attr(folder, "allow_text_submission"), False)
        allow_file = sub_type not in ("1",)
        # Submitted on paper or in person (sub_type 2/3): imported as a file submission
        return ir.AssignmentItem(title=title, instructions=ir.RichText(body, resolve), due_date=due,
                                 allow_file=allow_file, allow_text=allow_text, points=out_of or None,
                                 graded=bool(out_of or attr(folder, "grade_item")), attachments=attachments,
                                 id=attr(folder, "resource_code") or attr(folder, "id"), visible=_visible(folder))

    # ------------------------------------------------------------ content

    def _is_module(self, el: Element) -> bool:
        res = self.resources.get(attr(el, "identifierref"))
        if res is not None and (res.type == "contentmodule" or (res.type == "webcontent" and not res.href)):
            return True
        return bool(children(el, "item"))

    def _module(self, el: Element, path: list[str], parent_visible: bool, out: list[ir.Section]) -> None:
        title = text(el, "title") or "Module"
        visible = parent_visible and _visible(el)
        desc = attr(el, "description")
        section = ir.Section(title=" › ".join(path + [title]), id=attr(el, "identifier"), visible=visible,
                             summary=ir.RichText(desc, self.resolver()) if desc.strip() else ir.RichText())
        out.append(section)
        for child in children(el, "item"):
            if self._is_module(child):
                self._module(child, path + [title], visible, out)
            else:
                item = self._topic(child, visible)
                if item is not None:
                    section.items.append(item)

    def _topic(self, el: Element, parent_visible: bool):
        title = text(el, "title")
        ident = attr(el, "identifier")
        visible = parent_visible and _visible(el)
        res = self.resources.get(attr(el, "identifierref"))
        if res is None:
            self.skip(title or ident, "topic", "missing from the export")
            return None
        item = self._resource_item(res, title or res.title or slug_title(res.href), ident, visible,
                                   attr(el, "description"))
        if item is None:
            return None
        if not visible and hasattr(item, "visible"):
            item.visible = False
        due = iso_from_text(attr(el, "date_due") or attr(el, "due_date") or attr(el, "date_end")
                            or attr(el, "end_date"))
        if due and isinstance(item, (ir.Assessment, ir.AssignmentItem)) and not item.due_date:
            item.due_date = due
        return item

    def _resource_item(self, res: _Resource, title: str, ident: str, visible: bool, description: str):
        desc = description if (description or "").strip() else ""
        if res.type == "content":
            return self._file_item(res.href, title, ident, visible, desc)
        if res.type == "contentlink":
            return self._link_item(res.href, title, ident, visible, desc)
        if res.type == "d2lquiz":
            return self._claim(self.quizzes.get(res.ident.lower()), "quiz", title, desc)
        if res.type == "d2lsurvey":
            return self._claim(self.surveys.get(res.ident.lower()), "survey", title, desc)
        kind = _SKIPPED_TOOLS[res.type][1] if res.type in _SKIPPED_TOOLS else res.type or "resource"
        return ir.UnsupportedItem(title=title, kind=kind, reason=f"a Brightspace {kind} cannot be imported", id=ident)

    def _claim(self, obj, kind: str, title: str, desc: str):
        if obj is None:
            return ir.UnsupportedItem(title=title, kind=kind, reason=f"the linked {kind} is not in the export (it was "
                                      "not selected when the course was exported)")
        if id(obj) in self.used:
            # Linked from several topics: imported once, where it was first met
            return None
        self.used.add(id(obj))
        if desc:
            if isinstance(obj, ir.Assessment) and obj.intro.is_empty():
                obj.intro = ir.RichText(desc, self.resolver())
            elif isinstance(obj, ir.AssignmentItem) and obj.instructions.is_empty():
                obj.instructions = ir.RichText(desc, self.resolver())
        return obj

    def _desc_parts(self, desc: str) -> list[ir.Part]:
        return [ir.HtmlPart(ir.RichText(desc, self.resolver()))] if desc else []

    def _file_item(self, href: str, title: str, ident: str, visible: bool, desc: str):
        full = self.find(href)
        if not full:
            # The writer lists unsupported items in the report
            return ir.UnsupportedItem(title=title, kind="file", reason="missing from the export", id=ident)
        asset = self.index.asset(full)
        ext = asset.extension
        if ext in ("html", "htm", "xhtml"):
            try:
                # The shared converter renders a doctype as a stray "html" paragraph
                body = _DOCTYPE.sub("", _read_text_file(full))
            except OSError as e:  # unreadable, or over the size the reader loads
                self.warn(f"Could not read '{title}': {error_text(e)}")
                return ir.UnsupportedItem(title=title, kind="file", reason=f"unreadable file: {error_text(e)}",
                                          id=ident)
            resolve = self.resolver(os.path.dirname(self.rel(full)))
            return ir.Page(title=title, parts=self._desc_parts(desc) + [ir.HtmlPart(ir.RichText(body, resolve))],
                           id=ident, visible=visible)
        kind = media_kind_for(asset)
        if kind == ir.MediaKind.PDF:
            return ir.DocumentItem(title=title, asset=asset, id=ident, visible=visible)
        if kind == ir.MediaKind.VIDEO:
            return ir.VideoItem(title=title, asset=asset, id=ident, visible=visible,
                                description=ir.RichText(desc, self.resolver()) if desc else None)
        if kind in (ir.MediaKind.AUDIO, ir.MediaKind.IMAGE):
            return ir.Page(title=title, parts=self._desc_parts(desc) + [ir.MediaPart(kind, asset=asset, title=title)],
                           id=ident, visible=visible)
        if ext == "zip" and _is_scorm(full):
            return ir.ScormItem(title=title, package=asset, id=ident, visible=visible)
        return ir.Page(title=title, parts=self._desc_parts(desc) + [ir.FilePart(asset, title=title)], id=ident,
                       visible=visible)

    def _link_item(self, href: str, title: str, ident: str, visible: bool, desc: str):
        href = (href or "").strip()
        ql = _quicklink(href)
        if ql is not None:
            kind, code = ql
            if kind == "quiz":
                return self._claim(self.quizzes.get(code), "quiz", title, desc)
            if kind == "dropbox":
                return self._claim(self.folders.get(code), "assignment", title, desc)
            if kind == "survey":
                return self._claim(self.surveys.get(code), "survey", title, desc)
            label = _LINK_KINDS.get(kind, kind or "tool")
            if kind == "discuss":
                topic = self.topics.get(code)
                reason = "discussions are not migrated" + (f" (topic \"{topic}\")" if topic else "")
            else:
                reason = f"links to a Brightspace {label}, which cannot be imported"
            return ir.UnsupportedItem(title=title, kind=label, reason=reason, id=ident)
        try:
            parsed = urlparse(href)
        except ValueError:
            parsed = urlparse("")
        if parsed.scheme in ("http", "https") and parsed.netloc and parsed.path.lower().startswith("/d2l/"):
            # A page of the old Brightspace site (LTI launch, tool page): useless once migrated
            lti = "/lti/" in parsed.path.lower()
            return ir.UnsupportedItem(title=title, kind="LTI tool" if lti else "link", id=ident,
                                      reason="launches an external tool (LTI) configured in Brightspace" if lti
                                      else "links to a page of the original Brightspace site")
        if parsed.scheme in ("http", "https") and parsed.netloc:
            if youtube_id(href) or vimeo_id(href):
                return ir.VideoItem(title=title, url=href, id=ident, visible=visible,
                                    description=ir.RichText(desc, self.resolver()) if desc else None)
            return ir.Page(title=title, parts=[ir.LinkPart(url=href, title=title, description=html_to_text(desc))],
                           id=ident, visible=visible)
        if href and self.find(href):
            return self._file_item(href, title, ident, visible, desc)
        return ir.UnsupportedItem(title=title, kind="link", reason="link to a Brightspace page that does not exist "
                                  "outside the original course", id=ident)

    # ------------------------------------------------------------- unlinked

    def _library_sections(self) -> list[ir.Section]:
        """Question library folders no quiz uses: unpublished assessments, so the
        questions are not lost (a library-only export would otherwise be empty)."""
        items: list[ir.Assessment] = []

        def walk(container: Element, parents: list[str], parser: _ItemParser) -> None:
            for section in children(container, "section"):
                title = _section_title(section, parents)
                unused = [it for it in children(section, "item") if id(it) not in self._used_items]
                questions = [parser.parse(it) for it in unused]
                if questions:
                    items.append(ir.Assessment(title=title, questions=questions, visible=False,
                                               id=f"d2l:library:{attr(section, 'ident') or title}"))
                walk(section, parents + [attr(section, "title") or "Questions"], parser)

        for path, doc in self._libraries:
            parser = _ItemParser(self.resolver(os.path.dirname(self.rel(path))))
            for bank in list(doc.iter("objectbank")) or [doc]:
                loose = [it for it in children(bank, "item") if id(it) not in self._used_items]
                if loose:
                    items.append(ir.Assessment(title="Question library", visible=False,
                                               questions=[parser.parse(it) for it in loose],
                                               id=f"d2l:library:{attr(bank, 'ident') or 'root'}"))
                walk(bank, [], parser)
        if not items:
            return []
        return [ir.Section(title="Question library", items=items, id="d2l:library", visible=False)]

    def _unlinked_tools(self) -> list[ir.Section]:
        out: list[ir.Section] = []
        quizzes = [q for q in self.quiz_list if id(q) not in self.used]
        if quizzes:
            out.append(ir.Section(title="Quizzes", items=list(quizzes), id="d2l:quizzes"))
        by_cat: dict[str, list[ir.AssignmentItem]] = {}
        for cat, folder in self.folder_list:
            if id(folder) not in self.used:
                by_cat.setdefault(cat, []).append(folder)
        for cat, folders in by_cat.items():
            out.append(ir.Section(title=f"Assignments: {cat}" if cat else "Assignments", items=list(folders),
                                  id=f"d2l:dropbox:{cat}"))
        surveys = [s for s in self.survey_list if id(s) not in self.used]
        if surveys:
            out.append(ir.Section(title="Surveys", items=list(surveys), id="d2l:surveys"))
        for section in out:
            for item in section.items:
                self.used.add(id(item))
        return out


def _section_title(section: Element, parents: list[str]) -> str:
    return " › ".join(parents + [attr(section, "title") or "Questions"])


def _is_scorm(path: str) -> bool:
    try:
        with zipfile.ZipFile(path) as z:
            return any(n.lower().rstrip("/").split("/")[-1] == "imsmanifest.xml" and n.count("/") <= 1
                       for n in z.namelist())
    except (zipfile.BadZipFile, OSError):
        return False
