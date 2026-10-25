"""
IMS QTI 1.2 question parsing.

Common Cartridge, Canvas, Blackboard and Brightspace all export assessments
as QTI 1.2, each with its own dialect. This module reads the parts they
share: item metadata, the question material, choice/fill-in/numeric
responses, and the scoring conditions that say which answers are correct.
Readers pass a ``type_hint`` hook to map their own question type labels and a
``material_hook`` when their dialect stores text somewhere unusual.

The question type is taken from the dialect metadata when available
(``question_type``, ``cc_profile``, ``bbmd_questiontype``,
``qmd_questiontype``) and otherwise inferred from the response structure.
"""

from __future__ import annotations

import html
import math
import re
from dataclasses import dataclass, field
from typing import Callable, Optional
from xml.etree.ElementTree import Element

from .ir import Blank, Choice, MatchPair, NumericAnswer, Question, QType, Resolver, RichText, no_resolver
from .xmlutil import attr, inner_text, to_float

# Dialect question type labels, lowercased, mapped to IR types.
TYPE_LABELS: dict[str, QType] = {
    # Canvas
    "multiple_choice_question": QType.MULTICHOICE,
    "multiple_answers_question": QType.MULTICHOICE,
    "true_false_question": QType.TRUEFALSE,
    "short_answer_question": QType.SHORTANSWER,
    "fill_in_multiple_blanks_question": QType.CLOZE,
    "multiple_dropdowns_question": QType.CLOZE,
    "matching_question": QType.MATCHING,
    "numerical_question": QType.NUMERICAL,
    "calculated_question": QType.NUMERICAL,
    "essay_question": QType.ESSAY,
    "file_upload_question": QType.FILE_UPLOAD,
    "text_only_question": QType.DESCRIPTION,
    "ordering_question": QType.ORDERING,
    # Common Cartridge profiles
    "cc.multiple_choice.v0p1": QType.MULTICHOICE,
    "cc.multiple_response.v0p1": QType.MULTICHOICE,
    "cc.true_false.v0p1": QType.TRUEFALSE,
    "cc.fib.v0p1": QType.SHORTANSWER,
    "cc.pattern_match.v0p1": QType.SHORTANSWER,
    "cc.essay.v0p1": QType.ESSAY,
    # Blackboard (bbmd_questiontype)
    "multiple choice": QType.MULTICHOICE,
    "multiple answer": QType.MULTICHOICE,
    "true/false": QType.TRUEFALSE,
    "either/or": QType.MULTICHOICE,
    "fill in the blank": QType.SHORTANSWER,
    "fill in the blank plus": QType.CLOZE,
    "jumbled sentence": QType.CLOZE,
    "matching": QType.MATCHING,
    "ordering": QType.ORDERING,
    "numeric": QType.NUMERICAL,
    "calculated": QType.NUMERICAL,
    "essay": QType.ESSAY,
    "short response": QType.ESSAY,
    "file upload": QType.FILE_UPLOAD,
    "opinion scale": QType.MULTICHOICE,
    "quiz bowl": QType.SHORTANSWER,
    "hot spot": QType.UNSUPPORTED,
    # Brightspace (qmd_questiontype)
    "multi-select": QType.MULTICHOICE,
    "long answer": QType.ESSAY,
    "short answer": QType.SHORTANSWER,
    "multi-short answer": QType.CLOZE,
    "fill in the blanks": QType.CLOZE,
    "arithmetic": QType.NUMERICAL,
    "significant figures": QType.NUMERICAL,
    "likert": QType.MULTICHOICE,
}

_MULTI_LABELS = {"multiple_answers_question", "cc.multiple_response.v0p1", "multiple answer", "multi-select"}


@dataclass
class QtiItem:
    """Raw view of one ``<item>`` before it becomes a Question."""

    ident: str
    title: str
    meta: dict[str, str]
    element: Element


@dataclass
class QtiAssessment:
    ident: str = ""
    title: str = ""
    meta: dict[str, str] = field(default_factory=dict)
    questions: list[Question] = field(default_factory=list)
    intro_html: str = ""
    warnings: list[str] = field(default_factory=list)


MaterialHook = Callable[[Element], Optional[str]]
TypeHook = Callable[[QtiItem], Optional[QType]]


# ---------------------------------------------------------------------------
# Material
# ---------------------------------------------------------------------------


def material_html(el: Optional[Element], hook: Optional[MaterialHook] = None) -> str:
    """HTML for a ``<material>`` / ``<flow_mat>`` / ``<flow>`` subtree."""
    if el is None:
        return ""
    if hook is not None:
        custom = hook(el)
        if custom is not None:
            return custom
    out: list[str] = []
    for node in el.iter():
        tag = node.tag
        if tag == "mattext":
            text = node.text or ""
            if (attr(node, "texttype") or "").lower() == "text/html" or _looks_html(text):
                out.append(text)
            else:
                out.append(html.escape(text).replace("\n", "<br>"))
        elif tag == "mat_formattedtext":
            out.append(node.text or "")
        elif tag == "matemtext":
            out.append(f"<em>{html.escape(node.text or '')}</em>")
        elif tag == "matimage":
            uri = attr(node, "uri")
            if uri:
                out.append(f'<img src="{html.escape(uri, quote=True)}" alt="{html.escape(attr(node, "label"))}">')
        elif tag == "matapplication":
            # Blackboard: a file embedded in the question
            uri = attr(node, "uri")
            if uri:
                label = html.escape(attr(node, "label") or uri.rsplit("/", 1)[-1])
                out.append(f'<p><a href="{html.escape(uri, quote=True)}">{label}</a></p>')
        elif tag == "matbreak":
            out.append("<br>")
    return "".join(out).strip()


def _looks_html(text: str) -> bool:
    # No space after "<": "x < b" in plain text is a comparison, not a tag
    return bool(re.search(r"</?(p|div|span|br|img|b|i|strong|em|ul|ol|li|table|a)\b", text or "", re.I))


def material_text(el: Optional[Element], hook: Optional[MaterialHook] = None) -> str:
    from .html_to_tiptap import html_to_text

    return html_to_text(material_html(el, hook))


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------


def qti_metadata(el: Optional[Element]) -> dict[str, str]:
    """``qtimetadatafield`` label/entry pairs plus Blackboard/D2L bbmd_/qmd_ leaves."""
    meta: dict[str, str] = {}
    if el is None:
        return meta
    for f in (*_own_iter(el, "qtimetadatafield"), *_own_iter(el, "qti_metadatafield")):
        label = (f.findtext("fieldlabel") or "").strip()
        if label:
            meta[label.lower()] = (f.findtext("fieldentry") or "").strip()
    md = el.find("itemmetadata")
    if md is not None:
        for leaf in md.iter():
            if leaf is md or len(leaf):
                continue
            if leaf.tag.startswith(("bbmd_", "qmd_")) and leaf.text:
                meta.setdefault(leaf.tag.lower(), leaf.text.strip())
    return meta


def _own_iter(el: Element, tag: str):
    """Descendants named ``tag``, without looking inside nested ``<item>``s.

    An assessment's metadata is its own ``qtimetadata``, not that of the
    items it contains.
    """
    for child in el:
        if child.tag == tag:
            yield child
        if child.tag != "item":
            yield from _own_iter(child, tag)


def _type_from_meta(meta: dict[str, str]) -> tuple[Optional[QType], str]:
    for key in ("question_type", "cc_profile", "bbmd_questiontype", "qmd_questiontype", "interactiontype"):
        label = (meta.get(key) or "").strip().lower()
        if label:
            return TYPE_LABELS.get(label, None), label
    return None, ""


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def _condition_score(cond: Element) -> float:
    total = 0.0
    for setvar in cond.iter("setvar"):
        raw = (setvar.text or "").strip()
        # Blackboard writes the full mark as "SCORE.max"
        value = 1.0 if raw.lower().endswith(".max") else to_float(raw, 0.0)
        action = (attr(setvar, "action") or "Set").lower()
        if action in ("set", "add"):
            total = value if action == "set" else total + value
    return total


def _positive_equals(cond: Element) -> list[tuple[str, str]]:
    """(respident, value) pairs a condition requires, ignoring ``<not>`` branches."""
    pairs: list[tuple[str, str]] = []
    cv = cond.find("conditionvar")
    if cv is None:
        return pairs

    def walk(node: Element, negated: bool):
        for child in node:
            if child.tag == "not":
                walk(child, not negated)
            elif child.tag in ("and", "or"):
                walk(child, negated)
            elif child.tag in ("varequal", "varsubstring") and not negated:
                pairs.append((attr(child, "respident"), (child.text or "").strip()))

    walk(cv, False)
    return pairs


def _rewarded_conditions(item: Element):
    """``<respcondition>`` elements that award points or mark the answer correct."""
    for rp in item.iter("resprocessing"):
        for cond in rp.iter("respcondition"):
            title = (attr(cond, "title") or "").lower()
            if title in ("incorrect", "wrong"):
                continue
            # Blackboard's catch-all "<other/>" branch says nothing about the key
            if cond.find("conditionvar/other") is not None:
                continue
            score = _condition_score(cond)
            links_correct = any((attr(fb, "linkrefid") or "").lower() == "correct"
                                for fb in cond.iter("displayfeedback"))
            if score <= 0 and title != "correct" and not links_correct:
                continue
            yield cond, score


def top_scored(item: Element, ident: str, values: set[str]) -> set[str]:
    """The best-scored of ``values`` for a single-answer question.

    An option worth partial credit (25% for a near miss) also "earns points",
    but marking it correct would turn a single-answer question into a
    multiple-answer one that grades the real answer wrong.
    """
    best: dict[str, float] = {}
    for cond, score in _rewarded_conditions(item):
        for respident, value in _positive_equals(cond):
            if value in values and respident in (ident, ""):
                best[value] = max(best.get(value, 0.0), score)
    if len(set(best.values())) < 2:
        return values
    top = max(best.values())
    return {v for v, s in best.items() if s == top}


def substring_values(item: Element) -> set[str]:
    """Answers given as ``<varsubstring>``: the response must contain them."""
    out: set[str] = set()
    for cond, _score in _rewarded_conditions(item):
        for node in cond.iter("varsubstring"):
            if (node.text or "").strip():
                out.add(node.text.strip())
    return out


def _contains_pattern(value: str) -> str:
    # Exporters use varsubstring both for plain "contains" answers and for
    # patterns (cc.fib "Z[uü]rich"); a value that is not a valid pattern is literal
    try:
        re.compile(value)
    except re.error:
        value = re.escape(value)
    return f".*(?:{value}).*"


def correct_values(item: Element) -> dict[str, list[str]]:
    """respident -> values that earn points, from ``<resprocessing>``."""
    out: dict[str, list[str]] = {}
    for cond, _score in _rewarded_conditions(item):
        for respident, value in _positive_equals(cond):
            out.setdefault(respident, [])
            if value not in out[respident]:
                out[respident].append(value)
    return out


def finite_float(raw: Optional[str]) -> Optional[float]:
    """``float(raw)`` when it is a finite number, else None.

    "inf", "nan" and "1e999" parse as floats but cannot be stored in the
    package JSON; an answer or bound written that way is no answer at all."""
    try:
        value = float((raw or "").strip())
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def _numeric_answers(item: Element) -> list[NumericAnswer]:
    answers: list[NumericAnswer] = []
    for cond in item.iter("respcondition"):
        if _condition_score(cond) <= 0:
            continue
        cv = cond.find("conditionvar")
        if cv is None:
            continue
        exact = cv.find(".//varequal")
        gte = cv.find(".//vargte")
        lte = cv.find(".//varlte")
        if gte is not None and lte is not None:
            lo, hi = finite_float(gte.text), finite_float(lte.text)
            if lo is not None and hi is not None:
                answers.append(NumericAnswer(value=(lo + hi) / 2, tolerance=abs(hi - lo) / 2))
        elif exact is not None and (exact.text or "").strip():
            value = finite_float(exact.text)
            if value is not None:
                answers.append(NumericAnswer(value=value))
    return answers


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------


def _presentation_html(item: Element, hook: Optional[MaterialHook]) -> str:
    """Question text: presentation material outside of the response elements."""
    pres = item.find("presentation")
    if pres is None:
        return ""
    parts: list[str] = []

    def walk(node: Element):
        for child in node:
            if child.tag.startswith("response_"):
                continue
            if child.tag == "material":
                parts.append(material_html(child, hook))
            else:
                walk(child)

    walk(pres)
    return "".join(p for p in parts if p).strip()


def _labels(response: Element, hook: Optional[MaterialHook]) -> list[tuple[str, str]]:
    labels = []
    for label in response.iter("response_label"):
        labels.append((attr(label, "ident"), material_html(label, hook) or html.escape(inner_text(label))))
    return labels


def _feedback(item: Element, hook: Optional[MaterialHook]) -> str:
    """General feedback: the ``itemfeedback`` that is neither correct nor incorrect specific."""
    texts = []
    seen: set[int] = set()
    for fb in item.iter("itemfeedback"):
        ident = (attr(fb, "ident") or "").lower()
        if "incorrect" in ident:  # Canvas "general_incorrect_fb"
            continue
        if ident in ("general_fb", "general", "solution") or "general" in ident or not ident:
            texts.append(material_html(fb, hook))
            seen.update(id(n) for n in fb.iter())
    for sol in item.iter("solution"):
        if id(sol) not in seen:  # already part of an itemfeedback above
            texts.append(material_html(sol, hook))
    return "".join(t for t in texts if t)


_CANVAS_CALCULATED = ("calculated_question", "formula_question")


def parse_item(item: Element, resolve: Resolver = no_resolver, *, type_hook: Optional[TypeHook] = None,
               material_hook: Optional[MaterialHook] = None) -> Question:
    q = _parse_item(item, resolve, type_hook=type_hook, material_hook=material_hook)
    if q.source_type in _CANVAS_CALCULATED:
        canvas_calculated(item, q, resolve)
    return q


def canvas_calculated(el: Element, q: Question, resolve: Resolver) -> None:
    """Canvas formula questions: the first generated variable set becomes a numeric question.

    Also found in Canvas "QTI export" zips read as plain Common Cartridge."""
    calc = el.find(".//itemproc_extension/calculated")
    var_set = calc.find("var_sets/var_set") if calc is not None else None
    if var_set is None:
        q.type = QType.UNSUPPORTED
        q.reason = "formula question without generated values"
        return
    answer = finite_float(var_set.findtext("answer"))
    if answer is None:
        q.type = QType.UNSUPPORTED
        q.reason = "formula question without a numeric answer"
        return
    tolerance_text = (calc.findtext("answer_tolerance") or "").strip()
    if tolerance_text.endswith("%"):
        tolerance = abs(answer) * to_float(tolerance_text[:-1], 0.0) / 100
    else:
        tolerance = abs(to_float(tolerance_text, 0.0))
    if not math.isfinite(tolerance):
        tolerance = 0.0
    body = q.text.html
    for var in var_set.findall("var"):
        name = attr(var, "name")
        if name:
            body = body.replace(f"[{name}]", (var.text or "").strip())
    q.text = RichText(body, resolve)
    q.numeric = [NumericAnswer(value=answer, tolerance=tolerance)]
    q.type = QType.NUMERICAL
    q.reason = ""


def _points(meta: dict[str, str]) -> float:
    """Canvas (``points_possible``) and Common Cartridge (``cc_weighting``) write
    the real value, 0 included (an ungraded Canvas question). Blackboard and
    D2L write ``qmd_weighting`` as 0.0 next to the actual points, so among the
    dialect fallbacks the first positive value wins; 1 when nothing says."""
    for key in ("points_possible", "cc_weighting"):
        raw = (meta.get(key) or "").strip()
        if raw:
            value = to_float(raw, -1.0)
            if math.isfinite(value) and value >= 0:
                return value
    return next((p for p in (to_float(meta.get(k), 0.0) for k in ("qmd_weighting", "bbmd_points",
                                                                      "qmd_absolutescore_max"))
                 if p > 0 and math.isfinite(p)), 1.0)


def _parse_item(item: Element, resolve: Resolver, *, type_hook: Optional[TypeHook],
                material_hook: Optional[MaterialHook]) -> Question:
    meta = qti_metadata(item)
    raw = QtiItem(ident=attr(item, "ident"), title=attr(item, "title"), meta=meta, element=item)
    qtype = type_hook(raw) if type_hook else None
    label = ""
    if qtype is None:
        qtype, label = _type_from_meta(meta)
    else:
        _, label = _type_from_meta(meta)
    text_html = _presentation_html(item, material_hook)
    q = Question(type=QType.UNSUPPORTED, text=RichText(text_html, resolve), title=raw.title, id=raw.ident,
                 points=_points(meta), general_feedback=_feedback(item, material_hook), source_type=label)

    responses_lid = list(item.iter("response_lid"))
    responses_str = list(item.iter("response_str"))
    responses_num = list(item.iter("response_num"))
    responses_grp = list(item.iter("response_grp"))
    correct = correct_values(item)

    if qtype is None:
        qtype = _infer_type(responses_lid, responses_str, responses_num, responses_grp, label)

    if qtype in (QType.MULTICHOICE, QType.TRUEFALSE) and responses_lid:
        resp = responses_lid[0]
        ident = attr(resp, "ident")
        good = set(correct.get(ident, [])) | set(correct.get("", []))
        q.multiple = (attr(resp, "rcardinality") or "").lower() == "multiple" or label in _MULTI_LABELS
        if not q.multiple and len(good) > 1:
            good = top_scored(item, ident, good)
        labels = _labels(resp, material_hook)
        q.choices = [Choice(text=RichText(t, resolve), correct=lid in good) for lid, t in labels]
        if qtype == QType.TRUEFALSE and len(q.choices) != 2:
            qtype = QType.MULTICHOICE
        q.type = qtype
        if "opinion" in label or "likert" in label:
            q.type = QType.DESCRIPTION if not any(c.correct for c in q.choices) else q.type
        return q

    if qtype == QType.MATCHING and (len(responses_lid) > 0 or responses_grp):
        pairs, pool = [], []
        for resp in responses_lid or responses_grp:
            ident = attr(resp, "ident")
            prompt = material_html(resp.find("material"), material_hook)
            labels = _labels(resp, material_hook)
            by_id = {lid: _strip(t) for lid, t in labels}
            for t in by_id.values():
                if t not in pool:
                    pool.append(t)
            good = correct.get(ident, [])
            answer = by_id.get(good[0], "") if good else ""
            if answer:
                pairs.append(MatchPair(prompt=RichText(prompt, resolve), answer=answer))
        q.pairs = pairs
        q.distractors = [p for p in pool if p not in {pr.answer for pr in pairs}]
        q.type = QType.MATCHING if pairs else QType.UNSUPPORTED
        if not pairs:
            q.reason = "matching pairs could not be read"
        return q

    if qtype == QType.ORDERING and responses_lid:
        resp = responses_lid[0]
        labels = _labels(resp, material_hook)
        by_id = {lid: _strip(t) for lid, t in labels}
        order = correct.get(attr(resp, "ident"), [])
        q.ordering = [by_id[i] for i in order if i in by_id] or [t for _, t in labels]
        q.type = QType.ORDERING
        return q

    if qtype == QType.NUMERICAL:
        q.numeric = _numeric_answers(item)
        q.type = QType.NUMERICAL if q.numeric else QType.UNSUPPORTED
        if not q.numeric:
            q.reason = "no numeric answer"
        return q

    if qtype == QType.SHORTANSWER:
        answers = []
        for values in correct.values():
            answers.extend(values)
        if len(responses_str) > 1:
            qtype = QType.CLOZE
        else:
            q.answers = [a for a in dict.fromkeys(answers) if a]
            q.case_sensitive = any(attr(v, "case").lower() == "yes" for v in item.iter("varequal"))
            contains = substring_values(item)
            if contains & set(q.answers):
                # "Contains" answers: match as patterns, exact ones escaped
                q.answers = [_contains_pattern(a) if a in contains else re.escape(a) for a in q.answers]
                q.regex = True
            q.type = QType.SHORTANSWER
            return q

    if qtype == QType.CLOZE:
        blanks: list[Blank] = []
        keys: list[str] = []
        idents = [attr(r, "ident") for r in (responses_str or responses_lid)]
        for i, resp in enumerate(responses_str or responses_lid, start=1):
            ident = attr(resp, "ident")
            values = correct.get(ident, [])
            if resp.tag == "response_lid":
                labels = dict((lid, _strip(t)) for lid, t in _labels(resp, material_hook))
                answers = [labels.get(v, v) for v in values]
                choices = list(labels.values())
                if choices and set(choices) <= set(answers):
                    # Every option is accepted: the labels are the accepted
                    # spellings of a free-text gap (Canvas fill in multiple
                    # blanks), not a dropdown. Showing them would give the answer away.
                    choices = []
                blanks.append(Blank(answers=answers, choices=choices))
            else:
                blanks.append(Blank(answers=values))
            keys.append(_blank_key(resp, ident))
        text = q.text.html
        # Canvas writes the blanks as [name] in the text
        names = list(dict.fromkeys(re.findall(r"\[([A-Za-z0-9_\-]+)\]", text)))
        known = [n for n in names if n in keys]
        if known and len(set(keys)) == len(keys):
            # Number the gaps in text order and only touch brackets that name a gap
            by_key = dict(zip(keys, blanks))
            blanks = [by_key[k] for k in known + [k for k in keys if k not in known]]
            for i, name in enumerate(known, start=1):
                text = text.replace(f"[{name}]", f"{{{{{i}}}}}")
            text = text + "".join(f" {{{{{i}}}}}" for i in range(len(known) + 1, len(blanks) + 1))
        elif names:
            for i, name in enumerate(names, start=1):
                text = text.replace(f"[{name}]", f"{{{{{i}}}}}")
        elif not re.search(r"\{\{\d+\}\}", text):
            text = text + "".join(f" {{{{{i}}}}}" for i in range(1, len(blanks) + 1))
        q.text = RichText(text, resolve)
        q.blanks = blanks
        q.type = QType.CLOZE if blanks and idents else QType.UNSUPPORTED
        return q

    if qtype in (QType.ESSAY, QType.FILE_UPLOAD, QType.DESCRIPTION):
        q.type = qtype
        if qtype == QType.FILE_UPLOAD:
            q.allow_attachments = True
            q.allow_text = False
        return q

    q.type = QType.UNSUPPORTED
    q.reason = q.reason or "question structure not recognized"
    return q


def _blank_key(resp: Element, ident: str) -> str:
    """The name a cloze response goes by in the question text.

    Canvas labels each response with the blank name (``<material>``) and
    prefixes its ident with ``response_``.
    """
    mat = resp.find("material")
    name = inner_text(mat) if mat is not None else ""
    if name:
        return name
    return ident[len("response_"):] if ident.startswith("response_") else ident


def _strip(text_html: str) -> str:
    from .html_to_tiptap import html_to_text

    text = html_to_text(text_html)
    if text:
        return text
    # Image-only answers (Canvas matching): name them after the image
    alt = re.search(r"""<img\b[^>]*\balt\s*=\s*["']([^"']+)""", text_html or "", re.I)
    if alt:
        return alt.group(1).strip()
    src = re.search(r"""<img\b[^>]*\bsrc\s*=\s*["']([^"']+)""", text_html or "", re.I)
    if src:
        return "Image: " + src.group(1).rsplit("/", 1)[-1].split("?", 1)[0]
    return text_html


def _infer_type(lids, strs, nums, grps, label: str) -> QType:
    if nums:
        return QType.NUMERICAL
    if len(lids) > 1 or grps:
        return QType.MATCHING
    if lids:
        labels = list(lids[0].iter("response_label"))
        texts = [inner_text(lb).strip().lower() for lb in labels]
        if len(texts) == 2 and set(texts) <= {"true", "false", "vrai", "faux", "yes", "no", "wahr", "falsch",
                                               "verdadero", "falso"}:
            return QType.TRUEFALSE
        return QType.MULTICHOICE
    if len(strs) > 1:
        return QType.CLOZE
    if strs:
        return QType.SHORTANSWER
    return QType.DESCRIPTION if "text" in label or not label else QType.UNSUPPORTED


def parse_assessment(root: Element, resolve: Resolver = no_resolver, *, type_hook: Optional[TypeHook] = None,
                     material_hook: Optional[MaterialHook] = None) -> list[QtiAssessment]:
    """Every ``<assessment>`` (or bare item bank) in a QTI document."""
    assessments = list(root.iter("assessment"))
    out: list[QtiAssessment] = []
    if not assessments:
        bank = QtiAssessment(ident=attr(root, "ident"), title=attr(root, "title"), meta=qti_metadata(root))
        for item in root.iter("item"):
            bank.questions.append(parse_item(item, resolve, type_hook=type_hook, material_hook=material_hook))
        if bank.questions:
            out.append(bank)
        return out
    for a in assessments:
        qa = QtiAssessment(ident=attr(a, "ident"), title=attr(a, "title"), meta=qti_metadata(a))
        rubric = a.find("rubric")
        if rubric is not None:
            qa.intro_html = material_html(rubric, material_hook)
        pres = a.find("presentation_material")
        if pres is not None:
            qa.intro_html = (qa.intro_html + material_html(pres, material_hook)).strip()
        for item in a.iter("item"):
            qa.questions.append(parse_item(item, resolve, type_hook=type_hook, material_hook=material_hook))
        out.append(qa)
    return out
