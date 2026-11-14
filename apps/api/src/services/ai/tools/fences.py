"""Rich blocks written as fenced Markdown blocks.

Markdown has no quiz or flipcard, so a page written in one call could not
hold them. These fences fill the gap; models write them as reliably as code
fences, and they read back the same way:

    ```quiz
    Q: Where does photosynthesis happen?
    - [x] In the chloroplasts
    - [ ] In the nucleus
    > Chloroplasts hold the chlorophyll that captures light.
    ```

    ```flipcards
    columns: 3
    Stomata :: Pores that let gases in and out
    Xylem :: Tubes that carry water up from the roots
    ```

    ```embed
    https://www.youtube.com/watch?v=aqz-KE-bpKQ
    height: 400
    ```

    ```button
    [Open the lab sheet](https://example.org/lab.pdf)
    color: green
    ```

    ```badge
    Key idea
    emoji: ⭐
    ```

    ```exercise
    language: python
    difficulty: easy
    Read two numbers and print their sum.
    --- starter
    a = int(input())
    --- solution
    print(int(input()) + int(input()))
    --- test Small numbers
    input:
    2
    3
    output:
    5
    --- hint
    Convert each line with int().
    ```

    ```scenario
    title: Pick a storage class
    # start
    Data is read every minute. Which class?
    - Standard -> right
    - Glacier -> start
    # right
    Right: hot data belongs in Standard.
    - Finish
    ```

    ```preview
    https://aws.amazon.com/s3/
    title: Amazon S3
    button: Visit S3
    ```

    ```h5p
    https://h5p.org/h5p/embed/712
    title: Drag the words
    ```

    ```widget
    title: Cost calculator
    height: 500
    <!DOCTYPE html><html>...</html>
    ```

Every fence parses in one pass over its lines and raises FenceError with a
message a model can act on. The renderers write the same syntax back, so
reading a page as Markdown and writing it again keeps these blocks (quiz and
answer ids are generated again, nothing depends on them). Exercises and
scenarios are written back only when parsing the fence gives the same block
again. Previews, H5P and widgets are only written: changing one needs
approval, so they read back as block comments that keep them exactly.
"""

from __future__ import annotations

import re
import uuid
from typing import Any, Callable

from src.services.ai.tools import doc_ops as d
from src.services.ai.tools.embeds import parse_embed

# fence language -> kind
KINDS = {
    "quiz": "quiz",
    "flipcards": "flipcards",
    "flipcard": "flipcards",
    "embed": "embed",
    "video": "embed",
    "youtube": "embed",
    "button": "button",
    "badge": "badge",
    "exercise": "exercise",
    "codeexercise": "exercise",
    "code-exercise": "exercise",
    "scenario": "scenario",
    "scenarios": "scenario",
    "preview": "preview",
    "linkpreview": "preview",
    "link-preview": "preview",
    "h5p": "h5p",
    "widget": "widget",
    "interactive": "widget",
}

MAX_QUESTIONS = 50
MAX_OPTIONS = 12
MAX_CARDS = 60
MAX_TESTS = 50
MAX_FILES = 10
MAX_HINTS = 20
MAX_STEPS = 100
MAX_STEP_OPTIONS = 12
WIDGET_HEIGHT = 400
SCENARIO_TITLE = "Interactive Scenario"
WIDGET_TITLE = "Interactive Element"

# Judge0 languages the code exercise runs: (id, name shown, fence names).
LANGUAGES: tuple[tuple[int, str, tuple[str, ...]], ...] = (
    (71, "Python 3", ("python", "python3", "py")),
    (63, "JavaScript (Node)", ("javascript", "js", "node")),
    (74, "TypeScript", ("typescript", "ts")),
    (62, "Java", ("java",)),
    (54, "C++", ("cpp", "c++")),
    (50, "C", ("c",)),
    (73, "Rust", ("rust", "rs")),
    (60, "Go", ("go", "golang")),
    (68, "PHP", ("php",)),
    (72, "Ruby", ("ruby", "rb")),
    (78, "Kotlin", ("kotlin", "kt")),
    (51, "C#", ("csharp", "c#", "cs")),
    (83, "Swift", ("swift",)),
    (81, "Scala", ("scala",)),
    (85, "Perl", ("perl",)),
    (80, "R", ("r",)),
    (90, "Dart", ("dart",)),
    (61, "Haskell", ("haskell", "hs")),
    (64, "Lua", ("lua",)),
    (57, "Elixir", ("elixir", "ex")),
    (86, "Clojure", ("clojure", "clj")),
    (82, "SQL", ("sql", "sqlite")),
    (46, "Bash", ("bash", "sh", "shell")),
    (79, "Objective-C", ("objective-c", "objc")),
    (77, "Pascal", ("pascal",)),
    (59, "Fortran", ("fortran",)),
    (69, "Prolog", ("prolog",)),
    (55, "Common Lisp", ("lisp", "common-lisp")),
    (91, "PowerShell", ("powershell", "ps1")),
    (45, "Assembly (NASM)", ("assembly", "nasm", "asm")),
)
_LANGUAGE_BY_NAME = {alias: (lid, name) for lid, name, aliases in LANGUAGES for alias in aliases}
_LANGUAGE_BY_ID = {lid: (name, aliases[0]) for lid, name, aliases in LANGUAGES}
DIFFICULTIES = ("easy", "medium", "hard")
COLORS = (
    "sky",
    "green",
    "yellow",
    "red",
    "purple",
    "teal",
    "amber",
    "indigo",
    "neutral",
    "blue",
)
ALIGNMENTS = ("left", "center", "right")
SIZES = ("small", "medium", "large")
EMBED_HEIGHT = 400

_OPTION = re.compile(r"^\s*(?:[-*+]\s*)?[\[(]\s*([xX✓✔]?)\s*[\])]\s*(.*)$")
_QUESTION_PREFIX = re.compile(
    r"^(?:Q(?:uestion)?\s*\d{0,3}\s*[:.)]|\d{1,3}\s*[.)])\s*", re.I
)
_SETTING = re.compile(r"^\s*([A-Za-z_]{2,20})\s*:\s*(.+?)\s*$")
_BULLET = re.compile(r"^[-*+]\s+")
_FRONT = re.compile(r"^(?:front|q|question)\s*:\s*(.*)$", re.I)
_BACK = re.compile(r"^(?:back|a|answer)\s*:\s*(.*)$", re.I)
_LINK = re.compile(r"^(\S{0,8}?)\s*\[([^\]]{1,200})\]\(<?(https?://[^\s)>]+)>?\)\s*$")
_URL = re.compile(r"^<?(https?://\S+?)>?$")


class FenceError(ValueError):
    """The fence could not be read; the message says what to change."""


def _snip(text: str, limit: int = 60) -> str:
    return d.clip(" ".join(text.split()), limit)[0]


def _lines(body: str) -> list[str]:
    return [line.strip() for line in body.split("\n") if line.strip()]


def _plain(text: str, inline: Callable[[str], list[dict]]) -> str:
    """Inline Markdown reduced to its text (bold and links are dropped)."""
    return d.inline_text(d.paragraph(inline(text))).strip()


def _choice(name: str, value: str, allowed: tuple[str, ...]) -> str:
    value = value.strip().lower()
    if value not in allowed:
        raise FenceError(
            f"{name} must be one of {', '.join(allowed)}, not '{_snip(value)}'"
        )
    return value


def _number(name: str, value: str, low: int, high: int) -> int:
    value = value.strip().rstrip("px")
    if not value.isdigit() or not low <= int(value) <= high:
        raise FenceError(
            f"{name} must be a whole number from {low} to {high}, not '{_snip(value)}'"
        )
    return int(value)


def parse(kind: str, body: str, inline: Callable[[str], list[dict]]) -> dict:
    """The node for a fence of `kind` (a key of KINDS' values)."""
    if kind == "quiz":
        return _quiz(body, inline)
    if kind == "flipcards":
        return _flipcards(body, inline)
    if kind == "embed":
        return _embed(body)
    if kind == "button":
        return _button(body, inline)
    if kind == "exercise":
        return _exercise(body)
    if kind == "scenario":
        return _scenario(body)
    if kind == "preview":
        return _preview(body)
    if kind == "h5p":
        return _h5p(body)
    if kind == "widget":
        return _widget(body)
    return _badge(body, inline)


# ─── quiz ────────────────────────────────────────────────────────────────────


def _quiz(body: str, inline: Callable[[str], list[dict]]) -> dict:
    questions: list[dict] = []
    current: dict | None = None
    for line in _lines(body):
        option = _OPTION.match(line)
        if option:
            if current is None:
                raise FenceError(
                    "an option appears before any question; start with the question text"
                )
            current["options"].append(
                {
                    "text": _plain(option.group(2), inline),
                    "correct": bool(option.group(1)),
                }
            )
            continue
        if current is not None and current["options"]:
            if line.startswith(">"):
                current["explanation"].append(line.lstrip("> ").strip())
                continue
            if line.lower().startswith("explanation:"):
                current["explanation"].append(line.split(":", 1)[1].strip())
                continue
        if current is None or current["options"]:
            current = {"text": [], "options": [], "explanation": []}
            questions.append(current)
        current["text"].append(_QUESTION_PREFIX.sub("", line, count=1))
    if not questions:
        raise FenceError(
            "the quiz has no questions; write a question line, then its options as - [x] right / - [ ] wrong"
        )
    if len(questions) > MAX_QUESTIONS:
        raise FenceError(f"a quiz holds at most {MAX_QUESTIONS} questions")
    simple = []
    for k, q in enumerate(questions, 1):
        text = _plain(" ".join(q["text"]), inline)
        if not text:
            raise FenceError(f"question {k} has no text")
        options = q["options"]
        if not 2 <= len(options) <= MAX_OPTIONS:
            raise FenceError(
                f"question {k} ('{_snip(text)}') has {len(options)} option{'s' if len(options) != 1 else ''}; "
                f"write 2 to {MAX_OPTIONS}, one per line, as - [x] right / - [ ] wrong"
            )
        if any(not o["text"] for o in options):
            raise FenceError(f"question {k} ('{_snip(text)}') has an empty option")
        if not any(o["correct"] for o in options):
            raise FenceError(
                f"question {k} ('{_snip(text)}') has no correct option; mark at least one with [x]"
            )
        item: dict[str, Any] = {"text": text, "options": options}
        if q["explanation"]:
            item["explanation"] = " ".join(q["explanation"])
        simple.append(item)
    return d.quiz_node(simple)


# ─── flipcards ───────────────────────────────────────────────────────────────


def _card(front: str, back: str, color: str, size: str) -> dict:
    return {
        "type": "flipcard",
        "attrs": {
            "question": front,
            "answer": back,
            "color": color,
            "alignment": "center",
            "size": size,
        },
    }


def _flipcards(body: str, inline: Callable[[str], list[dict]]) -> dict:
    columns: int | None = None
    color, size = "blue", "medium"
    cards: list[tuple[str, str]] = []
    front: str | None = None
    for line in _lines(body):
        setting = _SETTING.match(line)
        key = setting.group(1).lower() if setting else None
        if key == "columns":
            columns = _number("columns", setting.group(2), 1, 4)
            continue
        if key == "color":
            color = _choice("color", setting.group(2), COLORS)
            continue
        if key == "size":
            size = _choice("size", setting.group(2), SIZES)
            continue
        line = _BULLET.sub("", line, count=1)
        if "::" in line:
            a, b = line.split("::", 1)
            cards.append((a.strip(), b.strip()))
            continue
        head = _FRONT.match(line)
        if head:
            if front is not None:
                raise FenceError(
                    f"the card '{_snip(front)}' has no back; add a Back: line"
                )
            front = head.group(1).strip()
            continue
        tail = _BACK.match(line)
        if tail:
            if front is None:
                raise FenceError("a Back: line appears before its Front: line")
            cards.append((front, tail.group(1).strip()))
            front = None
            continue
        raise FenceError(
            f"cannot read the flipcard line '{_snip(line)}'; write one card per line as Front :: Back"
        )
    if front is not None:
        raise FenceError(f"the card '{_snip(front)}' has no back; add a Back: line")
    if not cards:
        raise FenceError("no cards; write one per line as Front :: Back")
    if len(cards) > MAX_CARDS:
        raise FenceError(f"at most {MAX_CARDS} cards per fence")
    nodes = []
    for front_text, back_text in cards:
        front_plain, back_plain = _plain(front_text, inline), _plain(back_text, inline)
        if not front_plain or not back_plain:
            raise FenceError(
                f"the card '{_snip(front_text or back_text)}' needs both a front and a back"
            )
        nodes.append(_card(front_plain, back_plain, color, size))
    if len(nodes) == 1 and columns is None:
        return nodes[0]
    return {
        "type": "flipcardGrid",
        "attrs": {"columns": columns or min(len(nodes), 3)},
        "content": nodes,
    }


# ─── embed ───────────────────────────────────────────────────────────────────


def embed_url(url: str) -> str:
    """The URL a provider wants in an iframe, from the one people share."""
    parsed = parse_embed(url)
    return parsed.embed_url if parsed is not None else url


def _embed(body: str) -> dict:
    url: str | None = None
    height = EMBED_HEIGHT
    height_set = False
    alignment = "center"
    for line in _lines(body):
        setting = _SETTING.match(line)
        key = setting.group(1).lower() if setting else None
        if key == "height":
            height = _number("height", setting.group(2), 100, 2000)
            height_set = True
            continue
        if key in ("align", "alignment"):
            alignment = _choice("alignment", setting.group(2), ALIGNMENTS)
            continue
        if key == "url":
            line = setting.group(2)
        found = _URL.match(line)
        if found and url is None:
            url = found.group(1)
            continue
        if found:
            raise FenceError("an embed holds one URL; use one fence per video or page")
        raise FenceError(
            f"cannot read the embed line '{_snip(line)}'; give one http(s) URL, and optionally height: 400"
        )
    if url is None:
        raise FenceError("an embed needs an http(s) URL on its own line")
    return embed_node(url, height=height if height_set else None, alignment=alignment)


def embed_node(url: str, *, height: int | None = None, alignment: str = "center", caption: str | None = None) -> dict:
    """A blockEmbed for a link, framed like the editor frames a pasted link:
    known services (YouTube, Vimeo, Loom, Figma, Google Docs/Slides/Sheets/
    Forms/Drive/Maps, CodePen, CodeSandbox, Spotify, SoundCloud, Miro, Canva,
    Desmos, GeoGebra) get their player URL and shape; others are framed as given."""
    attrs: dict[str, Any] = {
        "embedUrl": url,
        "embedCode": None,
        "embedType": "url",
        "embedHeight": height or EMBED_HEIGHT,
        "embedAspectRatio": None,
        "embedWidth": "100%",
        "alignment": alignment,
    }
    parsed = parse_embed(url)
    if parsed is not None:
        attrs.update(parsed.attrs())
        if height:
            # An explicit height wins over the provider's shape.
            attrs["embedHeight"] = height
            attrs["embedAspectRatio"] = None
    if caption:
        attrs["caption"] = caption
    return {"type": "blockEmbed", "attrs": attrs}


# ─── button and badge ────────────────────────────────────────────────────────


def _button(body: str, inline: Callable[[str], list[dict]]) -> dict:
    attrs: dict[str, Any] = {
        "emoji": "🔗",
        "link": None,
        "color": "blue",
        "alignment": "left",
    }
    label: str | None = None
    for line in _lines(body):
        setting = _SETTING.match(line)
        key = setting.group(1).lower() if setting else None
        if key == "color":
            attrs["color"] = _choice("color", setting.group(2), COLORS)
            continue
        if key in ("align", "alignment"):
            attrs["alignment"] = _choice("alignment", setting.group(2), ALIGNMENTS)
            continue
        if key == "emoji":
            attrs["emoji"] = setting.group(2)[:8]
            continue
        link = _LINK.match(line)
        if link and label is None:
            if link.group(1):
                attrs["emoji"] = link.group(1)
            label, attrs["link"] = _plain(link.group(2), inline), link.group(3)
            continue
        raise FenceError(
            f"cannot read the button line '{_snip(line)}'; write [Label](https://...) and optionally color: green"
        )
    if not label:
        raise FenceError("a button needs its label and link as [Label](https://...)")
    return {"type": "button", "attrs": attrs, "content": [d.text_node(label)]}


def _badge(body: str, inline: Callable[[str], list[dict]]) -> dict:
    attrs: dict[str, Any] = {"color": "sky", "emoji": "💡"}
    text: list[str] = []
    for line in _lines(body):
        setting = _SETTING.match(line)
        key = setting.group(1).lower() if setting else None
        if key == "color":
            attrs["color"] = _choice("color", setting.group(2), COLORS)
            continue
        if key == "emoji":
            attrs["emoji"] = setting.group(2)[:8]
            continue
        text.append(line)
    label = _plain(" ".join(text), inline)
    if not label:
        raise FenceError("a badge needs its text on a line of its own")
    if len(label) > 80:
        raise FenceError(
            "badge text is at most 80 characters; use a callout for longer notes"
        )
    return {"type": "badge", "attrs": attrs, "content": [d.text_node(label)]}


# ─── shared: leading settings, raw text ──────────────────────────────────────


def _settings(raw: list[str], known: tuple[str, ...]) -> tuple[dict[str, str], int]:
    """Settings on the fence's first lines, as {key: value}, and the index of
    the first line after them. Only `known` keys count, so a first line of
    prose like "Note: ..." starts the body instead."""
    out: dict[str, str] = {}
    i = 0
    while i < len(raw):
        line = raw[i].strip()
        if not line:
            i += 1
            continue
        setting = _SETTING.match(line)
        key = setting.group(1).lower() if setting else None
        if key not in known:
            break
        out[key] = setting.group(2)
        i += 1
    return out, i


def _trim(raw: list[str]) -> str:
    """Lines joined back, without blank lines around them; inner lines keep
    their indentation."""
    start, end = 0, len(raw)
    while start < end and not raw[start].strip():
        start += 1
    while end > start and not raw[end - 1].strip():
        end -= 1
    return "\n".join(line.rstrip() for line in raw[start:end])


def _short_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


# ─── code exercise ───────────────────────────────────────────────────────────

_SECTION = re.compile(r"^\s*-{3,}\s*(starter|solution|test|hints?|file)\b[ \t]*:?[ \t]*(.*?)\s*$", re.I)
# "time limit:" and friends are written with a space; settings keys use "_".
_TWO_WORD = re.compile(r"^(\s*)(time|space)[ \t]+(limit|complexity)(\s*:)", re.I)
_DURATION = re.compile(r"^(\d{1,6}(?:\.\d{1,3})?)\s*(ms|s|sec|secs|seconds?|m|min|mins|minutes?|h|hours?)?$", re.I)
_FILE_NAME = re.compile(r"^[\w.\-]{1,100}$")
_EXERCISE_SETTINGS = (
    "language", "lang", "difficulty", "attempts", "timed", "time_limit", "time_complexity", "space_complexity",
)
_IO = re.compile(r"^\s*(input|stdin|output|expected|expected output|stdout)\s*:\s?(.*)$", re.I)
# "--- test Edge case (hidden)": learners see whether a hidden test passed, not its input/output.
_HIDDEN_TEST = re.compile(r"^(.*?)\s*\(hidden\)$", re.I)


def language(value: str) -> tuple[int, str]:
    found = _LANGUAGE_BY_NAME.get(value.strip().lower())
    if found is None:
        names = ", ".join(aliases[0] for _id, _name, aliases in LANGUAGES)
        raise FenceError(f"unknown language '{_snip(value)}'; use one of {names}")
    return found


def _test(label: str, raw: list[str], number: int) -> dict:
    hidden = _HIDDEN_TEST.match(label or "")
    if hidden:
        label = hidden.group(1)
    parts: dict[str, list[str]] = {}
    current: list[str] | None = None
    for line in raw:
        marker = _IO.match(line)
        if marker:
            key = "input" if marker.group(1).lower() in ("input", "stdin") else "output"
            if key in parts:
                raise FenceError(f"test {number} has two {key}: lines")
            current = parts[key] = []
            if marker.group(2).strip():
                current.append(marker.group(2))
            continue
        if current is None:
            if line.strip():
                raise FenceError(
                    f"test {number} needs input: and output: lines, each followed by its text"
                )
            continue
        current.append(line)
    if "output" not in parts:
        raise FenceError(f"test {number} has no output: line with the expected output")
    test = {
        "id": _short_id("test"),
        "label": label or f"Test {number}",
        "stdin": _trim(parts.get("input", [])),
        "expectedStdout": _trim(parts["output"]),
    }
    if hidden:
        test["hidden"] = True
    return test


def _duration(name: str, value: str, unit: str, low_ms: int, high_ms: int) -> int:
    """Milliseconds from "90s", "10m", "1.5 min", "500ms" (a bare number is in `unit`)."""
    found = _DURATION.match(value.strip())
    scale = {"ms": 1, "s": 1000, "m": 60_000, "h": 3_600_000}
    ms = None
    if found:
        given = (found.group(2) or unit).lower()
        ms = round(float(found.group(1)) * scale["ms" if given == "ms" else given[0]])
    if ms is None or not low_ms <= ms <= high_ms:
        raise FenceError(
            f"{name} is a duration such as 90s or 10m, from {_shown_ms(low_ms)} to {_shown_ms(high_ms)}, "
            f"not '{_snip(value)}'"
        )
    return ms


def _shown_ms(ms: int) -> str:
    if ms % 60_000 == 0:
        return f"{ms // 60_000}m"
    if ms % 1000 == 0:
        return f"{ms // 1000}s"
    return f"{ms}ms"


def _hints(raw: list[str]) -> list[str]:
    lines = [line.strip() for line in raw if line.strip()]
    if lines and all(_BULLET.match(line) for line in lines):
        return [_BULLET.sub("", line, count=1).strip() for line in lines]
    text = _trim(raw)
    return [text] if text else []


def _exercise(body: str) -> dict:
    raw = [_TWO_WORD.sub(lambda m: f"{m.group(1)}{m.group(2)}_{m.group(3)}{m.group(4)}", line) for line in body.split("\n")]
    settings, i = _settings(raw, _EXERCISE_SETTINGS)
    head: list[str] = []
    sections: list[tuple[str, str, list[str]]] = []
    for line in raw[i:]:
        section = _SECTION.match(line)
        if section:
            sections.append((section.group(1).lower(), section.group(2), []))
        elif sections:
            sections[-1][2].append(line)
        else:
            head.append(line)
    description = _trim(head)
    if not description:
        raise FenceError(
            "an exercise needs its task on the lines after the settings, before any --- section"
        )
    lid, lname = language(settings.get("language") or settings.get("lang") or "python")
    attrs: dict[str, Any] = {
        "languageId": lid,
        "languageName": lname,
        "description": description,
        "starterCode": "",
        "solutionCode": "",
        "testCases": [],
        "hints": [],
        "difficulty": _choice("difficulty", settings.get("difficulty", "medium"), DIFFICULTIES),
        "maxAttemptsBeforeReveal": _number("attempts", settings.get("attempts", "3"), 0, 20),
    }
    if "timed" in settings:
        attrs["timedMode"] = True
        attrs["timedDurationMs"] = _duration("timed", settings["timed"], "m", 30_000, 4 * 3_600_000)
    if "time_limit" in settings:
        attrs["timeLimitMs"] = _duration("time limit", settings["time_limit"], "s", 100, 60_000)
    for key in ("time_complexity", "space_complexity"):
        if key in settings:
            head_word = key.split("_")[0]
            attrs[f"{head_word}Complexity"] = settings[key][:100]
    files: list[dict] = []
    seen: set[str] = set()
    for name, title, lines in sections:
        if name in ("starter", "solution"):
            if name in seen:
                raise FenceError(f"an exercise has one --- {name} section")
            seen.add(name)
            code = _trim(lines)
            attrs[f"{name}Code"] = code + "\n" if code else ""
        elif name == "test":
            attrs["testCases"].append(_test(title, lines, len(attrs["testCases"]) + 1))
        elif name == "file":
            if not _FILE_NAME.match(title or ""):
                raise FenceError(f"--- file needs a file name such as utils.py, not '{_snip(title)}'")
            if any(f["name"] == title for f in files):
                raise FenceError(f"two --- file sections are named {title}")
            files.append({"name": title, "content": _trim(lines) + "\n"})
        else:
            attrs["hints"].extend(_hints(lines))
    if len(files) > MAX_FILES:
        raise FenceError(f"an exercise holds at most {MAX_FILES} extra files")
    if files:
        attrs["additionalFiles"] = files
    if len(attrs["testCases"]) > MAX_TESTS:
        raise FenceError(f"an exercise holds at most {MAX_TESTS} tests")
    if len(attrs["hints"]) > MAX_HINTS:
        raise FenceError(f"an exercise holds at most {MAX_HINTS} hints")
    return {"type": "blockCode", "attrs": attrs}


def _exercise_lines(node: dict) -> list[str]:
    a = node.get("attrs") or {}
    _name, keyword = _LANGUAGE_BY_ID[a.get("languageId")]
    lines = [f"language: {keyword}"] + _setting_lines(
        [
            ("difficulty", a.get("difficulty"), "medium"),
            ("attempts", a.get("maxAttemptsBeforeReveal"), 3),
            ("timed", _shown_ms(int(a.get("timedDurationMs") or 300000)) if a.get("timedMode") else None, None),
            ("time limit", _shown_ms(int(a["timeLimitMs"])) if a.get("timeLimitMs") else None, "10s"),
            ("time complexity", a.get("timeComplexity"), ""),
            ("space complexity", a.get("spaceComplexity"), ""),
        ]
    )
    lines += ["", *str(a.get("description") or "").split("\n")]
    for name in ("starter", "solution"):
        code = str(a.get(f"{name}Code") or "").rstrip("\n")
        if code:
            lines += [f"--- {name}", *code.split("\n")]
    for test in a.get("testCases") or []:
        hidden = " (hidden)" if test.get("hidden") is True else ""
        lines.append(f"--- test {_text_line(test.get('label'))}{hidden}".rstrip())
        stdin = str(test.get("stdin") or "")
        if stdin:
            lines += ["input:", *stdin.split("\n")]
        lines += ["output:", *str(test.get("expectedStdout") or "").split("\n")]
    for hint in a.get("hints") or []:
        lines += ["--- hint", *str(hint).split("\n")]
    for extra in a.get("additionalFiles") or []:
        lines += [f"--- file {extra.get('name')}", *str(extra.get("content") or "").rstrip("\n").split("\n")]
    return lines


# Settings the fence cannot write: an exercise using one stays a block comment.
_EXERCISE_DEFAULTS = {
    "mode": ("advanced",),
    "sqliteDbPath": ("",),
    "sqliteDbName": ("",),
}


def _exercise_key(node: dict) -> Any:
    a = node.get("attrs") or {}
    extras = sorted(
        k for k, v in a.items()
        if k in _EXERCISE_DEFAULTS and v is not None and v not in _EXERCISE_DEFAULTS[k]
    )
    if not a.get("timedMode") and a.get("timedDurationMs") not in (None, 300000):
        extras.append("timedDurationMs")
    attempts = a.get("maxAttemptsBeforeReveal")
    return (
        a.get("languageId"),
        str(a.get("description") or "").strip(),
        str(a.get("starterCode") or "").rstrip(),
        str(a.get("solutionCode") or "").rstrip(),
        [
            (t.get("label"), str(t.get("stdin") or "").strip("\n"), str(t.get("expectedStdout") or "").strip("\n"),
             t.get("hidden") is True)
            for t in a.get("testCases") or []
        ],
        list(a.get("hints") or []),
        a.get("difficulty") or "medium",
        3 if attempts is None else attempts,
        bool(a.get("timedMode")),
        int(a.get("timedDurationMs") or 300000) if a.get("timedMode") else None,
        int(a.get("timeLimitMs") or 10000),
        str(a.get("timeComplexity") or ""),
        str(a.get("spaceComplexity") or ""),
        [(f.get("name"), str(f.get("content") or "").rstrip("\n")) for f in a.get("additionalFiles") or []],
        extras,
    )


# ─── branching scenario ──────────────────────────────────────────────────────

_STEP = re.compile(r"^#{1,3}\s+(.+?)\s*$")
_STEP_OPTION = re.compile(r"^[-*+]\s+(.*?)(?:\s*(?:->|→)\s*(.*?))?\s*$")
_IMAGE = re.compile(r"^image\s*:\s*(\S+)\s*$", re.I)
_ENDS = ("", "end", "finish", "done")


def _scenario(body: str) -> dict:
    raw = body.split("\n")
    settings, i = _settings(raw, ("title",))
    steps: list[dict] = []
    for line in raw[i:]:
        s = line.strip()
        if not s:
            continue
        head = _STEP.match(s)
        if head:
            steps.append({"id": head.group(1)[:100], "text": [], "imageUrl": "", "options": []})
            continue
        if not steps:
            raise FenceError("start each step with a line like '# start'; settings (title:) go above it")
        step = steps[-1]
        image = _IMAGE.match(s)
        if image:
            if not d.is_web_url(image.group(1)):
                raise FenceError(f"image must be an http(s) URL, not '{_snip(image.group(1))}'")
            step["imageUrl"] = image.group(1)
            continue
        option = _STEP_OPTION.match(s)
        if option:
            step["options"].append((option.group(1), (option.group(2) or "").strip()))
            continue
        if step["options"]:
            raise FenceError(
                f"in step '{_snip(step['id'])}', text comes before its options; write the text, then '- option -> step'"
            )
        step["text"].append(s)
    if not steps:
        raise FenceError("a scenario needs at least one step: '# start', its text, then '- option -> step' lines")
    if len(steps) > MAX_STEPS:
        raise FenceError(f"a scenario holds at most {MAX_STEPS} steps")
    ids = [step["id"] for step in steps]
    if len(set(ids)) != len(ids):
        dup = next(x for x in ids if ids.count(x) > 1)
        raise FenceError(f"two steps are named '{_snip(dup)}'; step names must be unique")
    out = []
    for step in steps:
        text = "\n".join(step["text"])
        if not text:
            raise FenceError(f"step '{_snip(step['id'])}' has no text")
        if len(step["options"]) > MAX_STEP_OPTIONS:
            raise FenceError(f"step '{_snip(step['id'])}' has more than {MAX_STEP_OPTIONS} options")
        options = []
        for label, target in step["options"]:
            if not label:
                raise FenceError(f"step '{_snip(step['id'])}' has an empty option")
            if target in ids:
                nxt = target
            elif target.lower() in _ENDS:
                nxt = None
            else:
                raise FenceError(
                    f"the option '{_snip(label)}' leads to '{_snip(target)}', which is not a step; "
                    "name an existing step or write -> end"
                )
            options.append({"id": _short_id("opt"), "text": label, "nextScenarioId": nxt})
        out.append({"id": step["id"], "text": text, "imageUrl": step["imageUrl"], "options": options})
    title = (settings.get("title") or SCENARIO_TITLE)[:500]
    return {
        "type": "scenarios",
        "attrs": {"title": title, "scenarios": out, "currentScenarioId": out[0]["id"]},
    }


def _scenario_lines(node: dict) -> list[str]:
    a = node.get("attrs") or {}
    lines = [f"title: {_text_line(a.get('title') or SCENARIO_TITLE)}"]
    for step in a.get("scenarios") or []:
        lines += ["", f"# {step['id']}", *str(step.get("text") or "").split("\n")]
        if step.get("imageUrl"):
            lines.append(f"image: {step['imageUrl']}")
        for option in step.get("options") or []:
            target = option.get("nextScenarioId")
            lines.append(f"- {option['text']}" + (f" -> {target}" if target is not None else ""))
    return lines


def _scenario_key(node: dict) -> Any:
    a = node.get("attrs") or {}
    return (
        a.get("title") or SCENARIO_TITLE,
        [
            (
                s.get("id"),
                s.get("text"),
                s.get("imageUrl") or "",
                [(o.get("text"), o.get("nextScenarioId")) for o in s.get("options") or []],
            )
            for s in a.get("scenarios") or []
        ],
    )


# ─── web preview, H5P and widget ─────────────────────────────────────────────


def _url_and_settings(body: str, what: str, known: tuple[str, ...]) -> tuple[str, dict[str, str]]:
    url: str | None = None
    settings: dict[str, str] = {}
    for line in _lines(body):
        found = _URL.match(line)
        if found and url is None:
            url = found.group(1)
            continue
        setting = _SETTING.match(line)
        key = setting.group(1).lower() if setting else None
        if key == "url" and url is None and _URL.match(setting.group(2)):
            url = _URL.match(setting.group(2)).group(1)
            continue
        if key in known:
            settings[key] = setting.group(2)
            continue
        raise FenceError(
            f"cannot read the {what} line '{_snip(line)}'; give one http(s) URL, then "
            + ", ".join(f"{k}: ..." for k in known)
        )
    if url is None:
        raise FenceError(f"a {what} needs an http(s) URL on its own line")
    return url, settings


def _preview(body: str) -> dict:
    url, s = _url_and_settings(body, "preview", ("title", "description", "button", "align", "alignment"))
    attrs: dict[str, Any] = {
        "url": url,
        "title": s.get("title"),
        "description": s.get("description"),
        "alignment": _choice("alignment", s.get("align") or s.get("alignment") or "left", ALIGNMENTS),
        "buttonLabel": s.get("button") or "Visit Site",
        "showButton": "button" in s,
    }
    if attrs["title"] and len(attrs["title"]) > 500:
        raise FenceError("a preview title is at most 500 characters")
    return {"type": "blockWebPreview", "attrs": attrs}


def _h5p(body: str) -> dict:
    url, s = _url_and_settings(body, "H5P block", ("title", "height"))
    return {
        "type": "blockH5P",
        "attrs": {
            "h5pUrl": url,
            "title": (s.get("title") or "")[:500],
            "height": _number("height", s.get("height", "400"), 50, 5000),
        },
    }


def _widget(body: str) -> dict:
    raw = body.split("\n")
    settings, i = _settings(raw, ("title", "height"))
    html = _trim(raw[i:])
    if not html:
        raise FenceError("a widget needs its HTML after the settings: one full document, inline CSS and JS")
    return {
        "type": "blockMagic",
        "attrs": {
            "blockUuid": _short_id("mb"),
            "title": (settings.get("title") or WIDGET_TITLE)[:200],
            "height": _number("height", settings.get("height", str(WIDGET_HEIGHT)), 50, 5000),
            "htmlContent": html,
        },
    }


# Blocks written back only when the fence gives the same block again:
# node type -> (fence kind, body lines, what must survive the trip).
_ROUND_TRIP: dict[str, tuple[str, Callable[[dict], list[str]], Callable[[dict], Any]]] = {
    "blockCode": ("exercise", _exercise_lines, _exercise_key),
    "scenarios": ("scenario", _scenario_lines, _scenario_key),
}


def _round_trips(node: dict) -> bool:
    kind, lines_of, key = _ROUND_TRIP[d.kind(node)]
    try:
        again = parse(kind, "\n".join(lines_of(node)), lambda text: [d.text_node(text)])
        return key(again) == key(node)
    except (FenceError, KeyError, TypeError, ValueError, AttributeError):
        return False


# ─── rendering ───────────────────────────────────────────────────────────────


def _fence(language: str, lines: list[str]) -> list[str]:
    marker = "```"
    while any(marker in line for line in lines):
        marker += "`"
    return [marker + language, *lines, marker]


def _setting_lines(pairs: list[tuple[str, Any, Any]]) -> list[str]:
    return [
        f"{name}: {value}"
        for name, value, default in pairs
        if value not in (None, "", default)
    ]


def renders(node: dict) -> bool:
    """Whether render() can write this block as a fence without loss."""
    t = d.kind(node)
    a = node.get("attrs") or {}
    if t in _ROUND_TRIP:
        return _round_trips(node)
    if t == "blockQuiz":
        return bool(a.get("questions")) and all(
            _simple_question(q) for q in a["questions"]
        )
    if t == "flipcard":
        return bool(a.get("question")) and bool(a.get("answer"))
    if t == "flipcardGrid":
        cards = d.children(node)
        return bool(cards) and all(
            renders(c) and _same_style(c, cards[0]) for c in cards
        )
    if t == "blockEmbed":
        return (
            bool(a.get("embedUrl"))
            and not a.get("embedCode")
            and a.get("embedType") in (None, "url")
        )
    if t in ("button", "badge"):
        return bool(d.inline_text(node).strip()) and (
            t == "badge" or bool(a.get("link"))
        )
    return False


def _simple_question(q: Any) -> bool:
    if not isinstance(q, dict) or not str(q.get("question") or "").strip():
        return False
    answers = q.get("answers")
    return (
        isinstance(answers, list)
        and 2 <= len(answers) <= MAX_OPTIONS
        and all(
            isinstance(x, dict) and str(x.get("answer") or "").strip() for x in answers
        )
        and any(x.get("correct") for x in answers)
    )


def _same_style(a: dict, b: dict) -> bool:
    aa, ba = a.get("attrs") or {}, b.get("attrs") or {}
    return (aa.get("color"), aa.get("size")) == (ba.get("color"), ba.get("size"))


def _text_line(text: Any) -> str:
    return " ".join(str(text or "").split())


def render(node: dict, inline_markdown: Callable[..., str]) -> list[str]:
    """The fence for a block renders() accepted."""
    t = d.kind(node)
    a = node.get("attrs") or {}
    if t in _ROUND_TRIP:
        kind, lines_of, _key = _ROUND_TRIP[t]
        return _fence(kind, lines_of(node))
    if t == "blockQuiz":
        lines: list[str] = []
        for q in a["questions"]:
            if lines:
                lines.append("")
            lines.append(f"Q: {_text_line(q['question'])}")
            for answer in q["answers"]:
                lines.append(
                    f"- [{'x' if answer.get('correct') else ' '}] {_text_line(answer['answer'])}"
                )
            if str(q.get("explanation") or "").strip():
                lines.append(f"> {_text_line(q['explanation'])}")
        return _fence("quiz", lines)
    if t in ("flipcard", "flipcardGrid"):
        cards = d.children(node) if t == "flipcardGrid" else [node]
        style = cards[0].get("attrs") or {}
        lines = _setting_lines(
            [
                ("columns", a.get("columns") if t == "flipcardGrid" else None, None),
                ("color", style.get("color"), "blue"),
                ("size", style.get("size"), "medium"),
            ]
        )
        for card in cards:
            ca = card.get("attrs") or {}
            lines.append(
                f"{_text_line(ca.get('question')).replace('::', ':')} :: {_text_line(ca.get('answer'))}"
            )
        return _fence("flipcards", lines)
    if t == "blockEmbed":
        parsed = parse_embed(str(a.get("embedSourceUrl") or ""))
        url, default_height = str(a["embedUrl"]).strip(), EMBED_HEIGHT
        if parsed is not None:
            url, default_height = parsed.source_url, parsed.height or 300
            if a.get("embedAspectRatio") != parsed.aspect:
                default_height = -1  # a custom frame: always write its height
        lines = [url] + _setting_lines(
            [
                ("height", a.get("embedHeight"), default_height),
                ("align", a.get("alignment"), "center"),
            ]
        )
        return _fence("embed", lines)
    label = _text_line(d.inline_text(node))
    if t == "button":
        emoji = str(a.get("emoji") or "").strip()
        first = f"{emoji} " if emoji and emoji != "🔗" else ""
        lines = [f"{first}[{label.replace(']', '')}]({a['link']})"] + _setting_lines(
            [
                ("color", a.get("color"), "blue"),
                ("align", a.get("alignment"), "left"),
            ]
        )
        return _fence("button", lines)
    lines = [label] + _setting_lines(
        [("color", a.get("color"), "sky"), ("emoji", a.get("emoji"), "💡")]
    )
    return _fence("badge", lines)
