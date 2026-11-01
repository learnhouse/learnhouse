"""
Map LMS questions onto LearnHouse's native question formats.

Two targets:

* Assignment tasks (graded). Choice-style questions (multiple choice,
  true/false, matching, ordering) become ``QUIZ`` tasks; fill-in-the-blank
  becomes ``FORM``; short answer, numerical, essay/file upload and code get
  their dedicated task types. Consecutive questions of the same task type are
  grouped into one task, so a 20-question multiple choice quiz stays one quiz
  instead of twenty tasks.

* The editor's ``blockQuiz`` (self-check inside a page). It only knows
  multiple choice, so other types fall back to flipcards that show the answer.

Task prompts and quiz texts are plain strings in LearnHouse, so rich question
text is reduced to readable text; a single image in a question is attached as
the task's reference file.
"""

from __future__ import annotations

import math
import re
import uuid
from dataclasses import dataclass, field, replace
from typing import Callable, Optional
from urllib.parse import unquote

from .html_to_tiptap import html_assets, html_to_text
from .ir import Asset, Question, QType, RichText

# blockQuiz UI limit (QuizBlockComponent.tsx)
MAX_BLOCK_QUIZ_ANSWERS = 5

# Judge0 language ids used by CODE tasks and the code playground
JUDGE0_LANGUAGES = {
    "python": 71, "python3": 71, "py": 71,
    "javascript": 63, "js": 63, "node": 63, "nodejs": 63,
    "typescript": 74, "ts": 74,
    "java": 62,
    "cpp": 54, "c++": 54,
    "c": 50,
    "rust": 73,
    "go": 60, "golang": 60,
    "sql": 82, "sqlite": 82,
    "bash": 46, "sh": 46, "shell": 46,
    "ruby": 72, "php": 68, "csharp": 51, "c#": 51, "kotlin": 78, "swift": 83,
    "r": 80, "perl": 85, "scala": 81, "haskell": 61, "lua": 64,
}

_CHOICE_TYPES = (QType.MULTICHOICE, QType.TRUEFALSE, QType.MATCHING, QType.ORDERING)


class IdFactory:
    """Deterministic ids, so converting the same export twice gives the same package."""

    def __init__(self, seed: str):
        self._ns = uuid.uuid5(uuid.NAMESPACE_URL, f"learnhouse-lms-import:{seed}")
        self._n = 0

    def uuid(self) -> str:
        self._n += 1
        return str(uuid.uuid5(self._ns, str(self._n)))

    def __call__(self, prefix: str) -> str:
        return f"{prefix}_{self.uuid()}"


@dataclass
class TaskSpec:
    title: str
    assignment_type: str
    contents: dict
    description: str = ""
    hint: str = ""
    reference: Optional[Asset] = None
    max_grade_value: int = 100
    points: float = 0.0  # source weight, turned into max_grade_value across the assignment


@dataclass
class TaskBuild:
    tasks: list[TaskSpec] = field(default_factory=list)
    # A task needs a human grader: a file submission, or a question without an
    # answer key (the auto-grader would score it 0 for everyone)
    has_manual: bool = False
    skipped: list[tuple[str, str, str]] = field(default_factory=list)  # (title, kind, reason)
    solution_notes: list[str] = field(default_factory=list)


def plain(question_or_html) -> str:
    html = question_or_html.text.html if isinstance(question_or_html, Question) else str(question_or_html or "")
    return html_to_text(html)


_IMG_SRC = re.compile(r"<img\b[^>]*?\bsrc\s*=\s*([\"'])(.*?)\1", re.I | re.S)


def _choice_text(choice) -> str:
    """Plain text of an option (images read as their alt text); a picture without alt
    text is named by its file name so the options stay distinguishable."""
    text = html_to_text(choice.text.html)
    if text:
        return text
    src = _IMG_SRC.search(choice.text.html or "")
    if src:
        name = src.group(2).split("?")[0].rstrip("/").rsplit("/", 1)[-1]
        if name:
            return f"Image: {unquote(name)}"
    return "(image)"


# A "*" wildcard; Moodle writes a literal asterisk as "\*"
_WILDCARD = re.compile(r"(?<!\\)\*")


def _shortanswer_mode(q: Question) -> tuple[list[str], str]:
    answers = [a.strip() for a in q.answers if a and a.strip()]
    if q.regex:
        return answers, "regex"
    if q.wildcard is False:
        return answers, ("exact" if q.case_sensitive else "case_insensitive")
    if q.wildcard or any(_WILDCARD.search(a) for a in answers):
        # Moodle wildcard answers: "*" matches anything
        patterns = []
        for a in answers:
            parts = [re.escape(p.replace("\\*", "*")) for p in _WILDCARD.split(a)]
            patterns.append(".*".join(parts))
        return patterns, "regex"
    answers = [a.replace("\\*", "*") for a in answers]
    return answers, ("exact" if q.case_sensitive else "case_insensitive")


def _has_key(q: Question) -> bool:
    """Whether the auto-grader can score ``q`` as converted."""
    if q.type in (QType.MULTICHOICE, QType.TRUEFALSE):
        return not q.choices or any(c.correct for c in q.choices)
    if q.type == QType.CLOZE:
        return all((b.numeric is not None and _finite(b.numeric.value)) or (b.answers and b.answers[0].strip())
                   for b in q.blanks)
    if q.type == QType.SHORTANSWER:
        return any(a and a.strip() for a in q.answers)
    return True


def _quiz_questions_for(q: Question, ids: IdFactory, skip: Callable[[str, str, str], None]) -> list[dict]:
    """``QUIZ`` task questions for one choice-style question."""
    label = plain(q) or q.title or "Question"
    if q.type in (QType.MULTICHOICE, QType.TRUEFALSE):
        choices = q.choices
        n_correct = sum(1 for c in choices if c.correct)
        if len(choices) < 2:
            # A quiz question needs a choice to make
            skip(label[:80], "question", "fewer than two answer options")
            return []
        return [{
            "questionText": label,
            "questionUUID": ids("question"),
            "response_type": "multiple" if (q.multiple or n_correct > 1) else "single",
            "options": [
                {"optionUUID": ids("option"), "text": _choice_text(c), "fileID": "", "type": "text",
                 "assigned_right_answer": bool(c.correct)}
                for c in choices
            ],
        }]
    if q.type == QType.MATCHING:
        pool = []
        for p in q.pairs:
            if p.answer and p.answer not in pool:
                pool.append(p.answer)
        for d in q.distractors:
            if d and d not in pool:
                pool.append(d)
        if len(pool) < 2 or any(not p.answer for p in q.pairs):
            # Answers that are pictures have no text a quiz option could show
            skip(label[:80], "matching question", "its answers are pictures or missing")
            return []
        out = []
        for p in q.pairs:
            prompt = html_to_text(p.prompt.html) or "…"
            out.append({
                "questionText": f"{label}\n→ {prompt}" if label else prompt,
                "questionUUID": ids("question"),
                "response_type": "single",
                "options": [
                    {"optionUUID": ids("option"), "text": a, "fileID": "", "type": "text",
                     "assigned_right_answer": a == p.answer}
                    for a in pool
                ],
            })
        return out
    if q.type == QType.ORDERING:
        out = []
        for pos, _item in enumerate(q.ordering):
            out.append({
                "questionText": f"{label}\n→ #{pos + 1}",
                "questionUUID": ids("question"),
                "response_type": "single",
                "options": [
                    # By position, not text: a repeated step ("Mix", "Bake", "Mix")
                    # must not mark two options right in a single-answer question
                    {"optionUUID": ids("option"), "text": opt, "fileID": "", "type": "text",
                     "assigned_right_answer": i == pos}
                    for i, opt in enumerate(q.ordering)
                ],
            })
        return out
    return []


def _form_question(q: Question, ids: IdFactory) -> dict:
    text = plain(q)
    blanks = []
    for i, blank in enumerate(q.blanks, start=1):
        if blank.numeric is not None:
            correct = _fmt_number(blank.numeric.value)
        else:
            # A gap holds one expected answer (a single-gap question with
            # several accepted answers became a short answer task instead)
            correct = blank.answers[0] if blank.answers else ""
        b = {
            "blankUUID": ids("blank"),
            "placeholder": " / ".join(blank.choices) if blank.choices else f"({i})",
            "correctAnswer": correct,
        }
        if blank.hint:
            b["hint"] = blank.hint
        blanks.append(b)
        text = text.replace(f"{{{{{i}}}}}", f"____ ({i})")
    return {"questionText": text, "questionUUID": ids("question"), "blanks": blanks}


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and math.isfinite(v)


def _fmt_number(v: float) -> str:
    if not _finite(v):
        return ""
    return str(int(v)) if float(v).is_integer() else repr(float(v))


def _single_reference(q: Question) -> Optional[Asset]:
    assets = html_assets(q.text)
    return assets[0] if assets else None


def build_tasks(questions: list[Question], ids: IdFactory) -> TaskBuild:
    """Group questions into assignment tasks."""
    build = TaskBuild()

    def skip(title: str, kind: str, reason: str) -> None:
        build.skipped.append((title, kind, reason))

    pending_intro: list[str] = []
    group: Optional[TaskSpec] = None
    group_kind: Optional[str] = None
    group_refs: list[Asset] = []
    group_count = 0
    group_points = 0.0
    unsupported: dict[tuple[str, str], list[str]] = {}

    def close_group():
        nonlocal group, group_kind, group_refs, group_count
        if group is not None:
            if group_refs:  # the figures page shows the others
                group.reference = group_refs[0]
            build.tasks.append(group)
        group, group_kind, group_refs, group_count = None, None, [], 0

    def intro_text(own: str = "") -> str:
        parts = pending_intro + ([own] if own else [])
        pending_intro.clear()
        return "\n\n".join(p for p in parts if p)

    def title_for(q: Question, fallback: str) -> str:
        return (q.title or "").strip() or fallback

    for index, q in enumerate(questions, start=1):
        feedback = html_to_text(q.general_feedback) if q.general_feedback else ""
        if feedback:
            build.solution_notes.append(f"{index}. {feedback}")
        if q.type == QType.DESCRIPTION:
            text = plain(q)
            if text:
                pending_intro.append(text)
            continue
        if q.type == QType.UNSUPPORTED:
            # Grouped below: a STACK or drag-and-drop heavy quiz would
            # otherwise flood the report with one line per question
            unsupported.setdefault((q.source_type or "unknown", q.reason), []).append((plain(q) or q.title)[:80])
            continue
        if not _finite(q.points) or q.points < 0:
            q = replace(q, points=0.0)  # NaN/inf/negative weights would break the grading maths below
        if not _has_key(q):
            build.has_manual = True
        if q.type == QType.CLOZE and len(q.blanks) == 1 and q.blanks[0].numeric is None \
                and not q.blanks[0].choices and len(q.blanks[0].answers) > 1:
            # A form gap holds one expected answer: a single gap with several
            # accepted answers is a short answer question
            q = replace(q, type=QType.SHORTANSWER, answers=list(q.blanks[0].answers),
                        text=RichText(q.text.html.replace("{{1}}", "____"), q.text.resolve))

        if q.type in _CHOICE_TYPES:
            # Questions worth the same points share a task (a task has one weight)
            if group_kind != "QUIZ" or group_points != q.points:
                close_group()
                group = TaskSpec(title=title_for(q, "Quiz"), assignment_type="QUIZ",
                                 contents={"questions": [], "grading_mode": "all_or_nothing"},
                                 description=intro_text())
                group_kind, group_points = "QUIZ", q.points
            elif pending_intro:
                group.description = "\n\n".join(p for p in [group.description, intro_text()] if p)
            items = _quiz_questions_for(q, ids, skip)
            if items:
                group.points += q.points
            group.contents["questions"].extend(items)
            if q.multiple and q.partial_credit:
                group.contents["grading_mode"] = "partial_credit"
            ref = _single_reference(q)
            if ref:
                group_refs.append(ref)
            group_count += 1
            if group_count > 1:
                group.title = "Quiz"
            continue

        if q.type == QType.CLOZE:
            if group_kind != "FORM" or group_points != q.points:
                close_group()
                group = TaskSpec(title=title_for(q, "Fill in the blanks"), assignment_type="FORM",
                                 contents={"questions": []}, description=intro_text())
                group_kind, group_points = "FORM", q.points
            elif pending_intro:
                group.description = "\n\n".join(p for p in [group.description, intro_text()] if p)
            group.contents["questions"].append(_form_question(q, ids))
            group.points += q.points
            ref = _single_reference(q)
            if ref:
                group_refs.append(ref)
            group_count += 1
            if group_count > 1:
                group.title = "Fill in the blanks"
            continue

        close_group()
        prompt = plain(q)
        ref = _single_reference(q)
        title = title_for(q, f"Question {index}")
        explanation = html_to_text(q.general_feedback)

        if q.type == QType.SHORTANSWER:
            answers, mode = _shortanswer_mode(q)
            if answers and mode == "regex" and not q.regex:
                # Learners who reveal the answer see correct_answers: show the
                # source's wildcard answers rather than the regex built from them
                accepted = "Accepted answers: " + "; ".join(a.strip() for a in q.answers if a and a.strip())
                explanation = "\n\n".join(p for p in (explanation, accepted) if p)
            build.tasks.append(TaskSpec(
                title=title, assignment_type="SHORT_ANSWER", description=intro_text(), reference=ref,
                points=q.points,
                contents={"prompt": prompt, "correct_answers": answers, "match_mode": mode,
                          "explanation": explanation},
            ))
        elif q.type == QType.NUMERICAL:
            # The first accepted value; a number task holds one. NaN/inf are not JSON
            ans = next((a for a in q.numeric if _finite(a.value)), None)
            if ans is None:
                skip(prompt[:80], "numerical question", "no answer")
                continue
            tolerance = abs(ans.tolerance) if _finite(ans.tolerance) else 0.0
            build.tasks.append(TaskSpec(
                title=title, assignment_type="NUMBER_ANSWER", description=intro_text(), reference=ref,
                points=q.points,
                contents={"prompt": prompt, "correct_value": ans.value, "tolerance": tolerance,
                          "unit": q.unit or "", "explanation": explanation},
            ))
        elif q.type in (QType.ESSAY, QType.FILE_UPLOAD):
            build.has_manual = True
            build.tasks.append(TaskSpec(
                title=title, assignment_type="FILE_SUBMISSION", reference=ref, points=q.points,
                description=intro_text(prompt), contents={},
                hint="" if q.type == QType.FILE_UPLOAD else "Upload your answer as a document.",
            ))
        elif q.type == QType.CODE:
            spec = q.code
            lang = ((spec.language if spec else "") or "python").strip().lower()
            note = f"\n\n(Written for {lang} in the source; this task runs Python.)" if lang not in JUDGE0_LANGUAGES else ""
            build.tasks.append(TaskSpec(
                title=title, assignment_type="CODE", description=intro_text(prompt) + note, reference=ref,
                points=q.points,
                contents={
                    "language_id": JUDGE0_LANGUAGES.get(lang, 71),
                    "starter_code": spec.starter_code if spec else "",
                    "solution_code": spec.solution_code if spec else "",
                    "grading_mode": "equal_weight",
                    "test_cases": [
                        {"id": ids("tc"), "label": f"Test {i}", "stdin": stdin, "expectedStdout": stdout,
                         "hidden": False, "weight": 1}
                        for i, (stdin, stdout) in enumerate(spec.test_cases if spec else [], start=1)
                    ],
                    "allow_student_run": True,
                    "show_test_details_on_fail": True,
                    "show_hidden_test_count": True,
                    "require_passing_to_submit": False,
                    "show_solution_after_submit": False,
                },
            ))
    for (source_type, reason), labels in unsupported.items():
        shown = "; ".join(labels[:3]) + ("; …" if len(labels) > 3 else "")
        title = labels[0] if len(labels) == 1 else f"{len(labels)} questions: {shown}"
        skip(title, f"{source_type} question", reason or "no LearnHouse equivalent")
    close_group()
    if pending_intro and build.tasks:
        last = build.tasks[-1]
        last.description = "\n\n".join(p for p in [last.description, intro_text()] if p)
    # A QUIZ/FORM task that ended up empty (e.g. only broken questions)
    build.tasks = [t for t in build.tasks
                   if t.assignment_type not in ("QUIZ", "FORM") or t.contents.get("questions")]
    # Source point values become task weights: the heaviest task is worth 100
    top = max((t.points for t in build.tasks), default=0.0)
    for t in build.tasks:
        t.max_grade_value = max(1, round(100 * t.points / top)) if top > 0 else 100
    return build


# ---------------------------------------------------------------------------
# In-page quiz (blockQuiz) and flipcards
# ---------------------------------------------------------------------------


def block_quiz_nodes(questions: list[Question], ids: IdFactory, warn: Callable[[str], None]) -> list[dict]:
    """``blockQuiz`` for choice questions; flipcards for everything else."""
    nodes: list[dict] = []
    quiz_questions: list[dict] = []
    cards: list[dict] = []

    def flush_quiz():
        if quiz_questions:
            nodes.append({"type": "blockQuiz", "attrs": {"quizId": ids("quiz"), "questions": list(quiz_questions)}})
            quiz_questions.clear()

    def flush_cards():
        if cards:
            nodes.append({"type": "flipcardGrid", "attrs": {"columns": 2 if len(cards) > 1 else 1},
                          "content": list(cards)})
            cards.clear()

    for q in questions:
        label = re.sub(r"\{\{\d+\}\}", "____", plain(q)) or q.title or "Question"
        if q.type in (QType.MULTICHOICE, QType.TRUEFALSE) and q.choices and (
                not any(c.correct for c in q.choices) or len(q.choices) < 2):
            # Polls and surveys have no answer key: show the question and its
            # options as text rather than a quiz nobody can get right
            flush_quiz()
            flush_cards()
            nodes.append({"type": "paragraph", "content": [{"type": "text", "text": label[:2000],
                                                             "marks": [{"type": "bold"}]}]})
            nodes.append({"type": "bulletList", "content": [
                {"type": "listItem", "content": [{"type": "paragraph",
                                                  "content": [{"type": "text", "text": _choice_text(c)}]}]}
                for c in q.choices]})
            continue
        if q.type in (QType.MULTICHOICE, QType.TRUEFALSE) and q.choices \
                and len(q.choices) <= MAX_BLOCK_QUIZ_ANSWERS:
            # Questions with more options than a quiz block shows become flipcards below
            flush_cards()
            choices = list(q.choices)
            n_correct = sum(1 for c in choices if c.correct)
            quiz_questions.append({
                "question_id": ids("question"),
                "question": label,
                "type": "multiple_choice",
                "response_type": "multiple" if (q.multiple or n_correct > 1) else "single",
                "answers": [{"answer_id": ids("answer"), "answer": _choice_text(c), "correct": bool(c.correct)}
                            for c in choices],
            })
            continue
        answer = _answer_summary(q)
        if q.type == QType.DESCRIPTION or answer is None:
            continue  # unsupported questions are reported by the page writer
        flush_quiz()
        cards.append({"type": "flipcard", "attrs": {"question": label[:500], "answer": answer[:500],
                                                     "color": "blue", "alignment": "center", "size": "medium"}})
    flush_quiz()
    flush_cards()
    return nodes


def _answer_summary(q: Question) -> Optional[str]:
    if q.type == QType.SHORTANSWER:
        return ", ".join(a for a in q.answers if a) or None
    if q.type == QType.NUMERICAL and q.numeric and _finite(q.numeric[0].value):
        n = q.numeric[0]
        text = _fmt_number(n.value) + (f" {q.unit}" if q.unit else "")
        return text + (f" (± {_fmt_number(n.tolerance)})" if n.tolerance else "")
    if q.type == QType.MATCHING and q.pairs:
        return "; ".join(f"{html_to_text(p.prompt.html)} → {p.answer}" for p in q.pairs)
    if q.type == QType.ORDERING and q.ordering:
        return " → ".join(q.ordering)
    if q.type == QType.CLOZE and q.blanks:
        return "; ".join(f"({i}) {b.answers[0] if b.answers else (_fmt_number(b.numeric.value) if b.numeric else '')}"
                         for i, b in enumerate(q.blanks, start=1))
    if q.type in (QType.ESSAY, QType.FILE_UPLOAD, QType.CODE):
        return html_to_text(q.general_feedback) or None
    if q.type in (QType.MULTICHOICE, QType.TRUEFALSE):
        return ", ".join(_choice_text(c) for c in q.choices if c.correct) or None
    return None
