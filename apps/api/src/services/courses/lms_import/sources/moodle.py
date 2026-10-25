"""
Moodle reader.

Two backup generations are understood:

* Moodle 2.0 and later (``.mbz``): ``moodle_backup.xml`` at the root lists the
  sections and activities; each lives in its own folder
  (``sections/section_<id>/section.xml``, ``activities/<mod>_<cmid>/``).
  Files are stored once by content hash under ``files/<hash[:2]>/<hash>`` and
  ``files.xml`` maps them back to (context, component, file area, item id,
  path, name). HTML refers to them as ``@@PLUGINFILE@@/path/name`` relative
  to the area of the field it sits in. ``questions.xml`` holds the question
  bank: since Moodle 4.0 questions are versioned through question bank
  entries and quiz slots point at entries (``question_reference``) or at a
  category for random questions (``question_set_reference``).

* Moodle 1.9 (``moodle.xml`` with a ``MOODLE_BACKUP`` root and
  ``course_files/``): sections, resources, labels, quizzes, the question bank
  and a few other activities are read; the rest is reported as skipped.

Reporting: ``warn`` is for problems the user must look at (unreadable or
repaired files, questions missing from the bank); ``skip`` lists source items
that are not migrated. Known design differences (random questions expanded to
their category, scale grading, peer assessment...) are documented and silent.

Everything here is untrusted: XML goes through ``xmlutil`` (defusedxml), paths
from the metadata are only used through ``safe_join``/``FileIndex`` and
content hashes must look like hashes before they become file names.
"""

from __future__ import annotations

import ast
import contextvars
import html as html_lib
import json
import math
import os
import posixpath
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html.entities import name2codepoint
from typing import Callable, Iterable, Optional
from urllib.parse import unquote, urlparse
from xml.etree.ElementTree import Element

from .. import ir
from ..archive import safe_join
from ..html_to_tiptap import html_to_text, media_kind_for, vimeo_id, youtube_id
from ..questions import JUDGE0_LANGUAGES
from ..xmlutil import FileTooLarge, XmlError, children, parse_bytes, read_limited, to_bool, to_float, to_int
from .common import FileIndex, iso_from_timestamp, make_resolver, slug_title
from ..report import error_text

KEY = "moodle"
LABEL = "Moodle"

NULL = "$@NULL@$"

# Readers never load an HTML file bigger than this into a page
_MAX_HTML_BYTES = 10 * 1024 * 1024

_HASH_RE = re.compile(r"^[0-9a-f]{40}$")
_MODNAME_RE = re.compile(r"[a-z][a-z0-9_]*")
# Links the backup encoder put in place of course URLs ($@PAGEVIEWBYID*12@$)
_ENCODED_LINK_RE = re.compile(r"\$@(?!PLUGINFILEBYCONTEXT)[A-Z0-9_]+\*[^@\s\"']*@\$")
# Links to files of another context of the course: $@PLUGINFILEBYCONTEXT*<ctx>@$/<component>/<area>/<item>/<path>
_BY_CONTEXT_RE = re.compile(r"\$@PLUGINFILEBYCONTEXT(URLENCODED)?\*(\d+)@\$(.*)", re.S)

_HTML_EXTS = {"html", "htm", "xhtml"}

_UNSUPPORTED_REASONS = {
    "forum": "forum discussions are not migrated",
    "hsuforum": "forum discussions are not migrated",
    "oublog": "blogs are student work and are not migrated",
    "chat": "chat rooms are not migrated",
    "data": "database activities are not migrated",
    "bigbluebuttonbn": "live sessions (BigBlueButton) are not migrated",
    "lti": "external tools (LTI) are not migrated",
    "h5pactivity": "H5P content is not migrated",
    "hvp": "H5P content is not migrated",
    "attendance": "attendance tracking is not migrated",
    "zoom": "live sessions (Zoom) are not migrated",
    "journal": "journals are student work and are not migrated",
    "certificate": "certificates are not migrated",
    "customcert": "certificates are not migrated",
    "imscc": "embedded IMS Common Cartridges are not migrated; import the cartridge itself",
    "wiki": "wiki pages are only in backups made with user data",
}

_QTYPE_REASONS = {
    "ddimageortext": "drag and drop onto an image is not supported",
    "ddmarker": "drag markers onto an image is not supported",
    "ddmatch": "drag and drop matching is not supported",
    "random": "random question outside a quiz",
    "missingtype": "the question type plugin was missing on the source site",
    "stack": "STACK questions are computed by a computer algebra system and cannot be converted",
    "formulas": "formulas questions are computed per attempt and cannot be converted",
}

# Lesson page types (mod/lesson/locallib.php)
_LESSON_SHORTANSWER = 1
_LESSON_TRUEFALSE = 2
_LESSON_MULTICHOICE = 3
_LESSON_MATCHING = 5
_LESSON_NUMERICAL = 8
_LESSON_ESSAY = 10
_LESSON_BRANCHTABLE = 20
_LESSON_STRUCTURE = (21, 30, 31)  # end of branch, cluster, end of cluster
# Jumps that lesson::jumpto_is_correct() counts as correct besides a jump to a later page
# (next page, end of lesson, unseen branch page, random page, cluster jump)
_LESSON_FORWARD_JUMPS = (-1, -9, -50, -60, -80)

# Quiz review option bits (mod/quiz/classes/question/display_options.php)
_REVIEW_AFTER_ATTEMPT = 0x01000 | 0x00100 | 0x00010


# ---------------------------------------------------------------------------
# Module interface
# ---------------------------------------------------------------------------


def detect(root: str) -> int:
    if os.path.isfile(os.path.join(root, "moodle_backup.xml")):
        return 100
    legacy = os.path.join(root, "moodle.xml")
    if os.path.isfile(legacy):
        try:
            with open(legacy, "rb") as f:
                head = f.read(4096)
        except OSError:
            return 0
        if b"<MOODLE_BACKUP" in head:
            return 90
    return 0


def read(root: str) -> ir.Course:
    root = os.path.realpath(root)
    if os.path.isfile(os.path.join(root, "moodle_backup.xml")):
        return _Moodle2Reader(root).read()
    if os.path.isfile(os.path.join(root, "moodle.xml")):
        return _LegacyReader(root).read()
    raise ValueError("Not a Moodle backup: moodle_backup.xml (or moodle.xml for Moodle 1.9) is missing")


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _raw(el: Optional[Element], path: str = "") -> str:
    """Text of a field, '' for missing or NULL. Not stripped (HTML)."""
    if el is None:
        return ""
    node = el.find(path) if path else el
    if node is None or node.text is None:
        return ""
    value = node.text
    if value.strip() == NULL:
        return ""
    if "mlang" in value or "multilang" in value or "<lang" in value:
        value = filter_multilang(value, _LANG.get())
    return value


# Language picked from multi-language texts; set while a backup is read
_LANG: contextvars.ContextVar[str] = contextvars.ContextVar("moodle_lang", default="")

# filter_multilang2: {mlang en}English{mlang}{mlang fr,de}Autre{mlang}
_MLANG2_RE = re.compile(r"\{\s*mlang\s+([^}]*)\}(.*?)\{\s*mlang\s*\}", re.S | re.I)
# core filter_multilang: <span lang="en" class="multilang">...</span> or <lang lang="en">...</lang>
_MLANG_RE = re.compile(r"<(span|lang)\b([^>]*)>(.*?)</\1\s*>", re.S | re.I)


def _pick_language(blocks: list[tuple[list[str], str]], lang: str) -> str:
    wanted = []
    if lang:
        wanted += [lang.lower(), lang.lower().split("_")[0]]
    wanted += ["en", "other"]
    for code in wanted:
        for langs, content in blocks:
            if code in langs:
                return content
    return blocks[0][1]


def _filter_runs(text: str, matches: list, lang: str) -> str:
    """Replace each run of adjacent language blocks by the block for ``lang``."""
    out, pos, run, run_start = [], 0, [], 0
    for m, langs, content in matches + [(None, None, None)]:
        if run and (m is None or text[run[-1][0].end():m.start()].strip()):
            out.append(text[pos:run_start])
            out.append(_pick_language([(lg, c) for _m, lg, c in run], lang))
            pos = run[-1][0].end()
            run = []
        if m is None:
            break
        if not run:
            run_start = m.start()
        run.append((m, langs, content))
    out.append(text[pos:])
    return "".join(out)


def filter_multilang(text: str, lang: str = "") -> str:
    """Keep one language of Moodle multi-language content (both multilang filters)."""
    if not text:
        return text
    matches = [(m, [x.strip().lower() for x in m.group(1).split(",") if x.strip()], m.group(2))
               for m in _MLANG2_RE.finditer(text)]
    if matches:
        text = _filter_runs(text, matches, lang)
    spans = []
    for m in _MLANG_RE.finditer(text):
        attrs = m.group(2)
        code = re.search(r"""\blang\s*=\s*["']([^"']+)["']""", attrs, re.I)
        if code and (m.group(1).lower() == "lang" or re.search(r"\bmultilang\b", attrs, re.I)):
            spans.append((m, [code.group(1).strip().lower().replace("-", "_"),
                              code.group(1).strip().lower().split("-")[0].split("_")[0]], m.group(3)))
    if spans:
        text = _filter_runs(text, spans, lang)
    return text


_XML_DECL_RE = re.compile(rb"<\?xml[^>]*\?>")
_ENTITY_RE = re.compile(rb"&(#\d+;|#x[0-9a-fA-F]+;|[A-Za-z][A-Za-z0-9]*;)?")


def _repair_xml(data: bytes) -> bytes:
    """Fix the damage hand-edited backups show: repeated XML declarations, HTML entities, bare ``&``."""
    first = _XML_DECL_RE.search(data)
    if first is not None:
        data = data[:first.end()] + _XML_DECL_RE.sub(b"", data[first.end():])
        data = data[first.start():]

    def entity(m: re.Match) -> bytes:
        ref = m.group(1)
        if ref is None:
            return b"&amp;"
        if ref.startswith(b"#"):
            return m.group(0)
        name = ref[:-1].decode("ascii")
        if name in ("amp", "lt", "gt", "quot", "apos"):
            return m.group(0)
        cp = name2codepoint.get(name)
        return f"&#{cp};".encode() if cp else b"&amp;" + ref

    return _ENTITY_RE.sub(entity, data)


def _parse(path: Optional[str], warn: Optional[Callable[[str], None]] = None) -> Optional[Element]:
    """Parse a backup XML file; damaged files are repaired once before giving up."""
    if not path:
        return None
    try:
        data = read_limited(path)
    except FileTooLarge as e:
        if warn:
            warn(f"Skipped {e}")
        return None
    except OSError:
        return None
    try:
        return parse_bytes(data)
    except XmlError:
        pass
    where = "/".join([os.path.basename(os.path.dirname(path)), os.path.basename(path)])
    try:
        el = parse_bytes(_repair_xml(data))
    except XmlError:
        if warn is not None:
            warn(f"{where} is not well-formed XML and could not be read")
        return None
    if warn is not None:
        warn(f"{where} was not well-formed XML and was repaired: check its content")
    return el


def _t(el: Optional[Element], path: str = "") -> str:
    return _raw(el, path).strip()


def _flag(el: Optional[Element], path: str, default: bool = False) -> bool:
    """Boolean field; ``default`` when the field is missing, empty or NULL (older backups lack newer fields)."""
    value = _t(el, path)
    return to_bool(value, default) if value else default


def _eid(el: Optional[Element]) -> str:
    """Id of a record: attribute in 2.x backups, child element in 1.9."""
    if el is None:
        return ""
    return (el.get("id") or _t(el, "id") or "").strip()


def _clean_html(text: str) -> str:
    return _ENCODED_LINK_RE.sub("#", text or "")


def _format_html(text: str, fmt: str = "1") -> str:
    """HTML for a Moodle text field in ``fmt`` (0 auto, 1 HTML, 2 plain, 4 markdown)."""
    text = text or ""
    fmt = (fmt or "1").strip()
    if fmt == "1" or not text.strip():
        return text
    if fmt == "0" and re.search(r"<[a-zA-Z][^>]*>", text):
        return text
    paragraphs = [p for p in re.split(r"\n\s*\n", text.replace("\r\n", "\n")) if p.strip()]
    return "".join("<p>" + html_lib.escape(p.strip()).replace("\n", "<br>") + "</p>" for p in paragraphs)


def _plain(html: str) -> str:
    return html_to_text(html or "").strip()


def _php_option(serialized: str, key: str) -> Optional[str]:
    """Value of ``key`` in a PHP-serialized array of scalars (displayoptions)."""
    m = re.search(r's:\d+:"' + re.escape(key) + r'";(?:s:\d+:"([^"]*)"|i:(-?\d+)|b:(\d))', serialized or "")
    if not m:
        return None
    return next(g for g in m.groups() if g is not None)


def _num(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else repr(float(value))


def _first_line(html: str, limit: int = 80) -> str:
    text = _plain(html)
    line = next((ln.strip() for ln in text.splitlines() if ln.strip()), "")
    return line if len(line) <= limit else line[: limit - 1].rstrip() + "…"


def _read_text_file(path: str) -> str:
    try:
        with open(path, "rb") as f:
            data = f.read(_MAX_HTML_BYTES + 1)
    except OSError:
        return ""
    data = data[:_MAX_HTML_BYTES]
    for enc in ("utf-8", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")  # pragma: no cover - cp1252 decodes nearly anything


def _lowercase_tags(el: Element) -> Element:
    for node in el.iter():
        if isinstance(node.tag, str):
            node.tag = node.tag.lower()
    return el


# ---------------------------------------------------------------------------
# Safe evaluation of calculated-question formulas
# ---------------------------------------------------------------------------

_FUNCS: dict[str, Callable] = {
    "abs": abs, "acos": math.acos, "acosh": math.acosh, "asin": math.asin, "asinh": math.asinh,
    "atan": math.atan, "atan2": math.atan2, "atanh": math.atanh, "ceil": math.ceil, "cos": math.cos,
    "cosh": math.cosh, "deg2rad": math.radians, "exp": math.exp, "expm1": math.expm1, "floor": math.floor,
    "fmod": math.fmod, "log10": math.log10, "log1p": math.log1p, "log": math.log, "pi": lambda: math.pi,
    "pow": None, "rad2deg": math.degrees, "round": round, "sin": math.sin, "sinh": math.sinh,
    "sqrt": math.sqrt, "tan": math.tan, "tanh": math.tanh, "max": max, "min": min,
}


def _safe_pow(base: float, exp: float) -> float:
    if abs(exp) > 1000 or (abs(base) > 1e6 and abs(exp) > 50):
        raise ValueError("exponent too large")
    return float(base) ** float(exp)


def eval_formula(expr: str) -> Optional[float]:
    """Evaluate a Moodle calculated-question formula (numbers already substituted)."""
    expr = (expr or "").strip()
    if not expr or len(expr) > 500:
        return None
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError:
        return None

    def ev(node) -> float:
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return float(node.value)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            v = ev(node.operand)
            return -v if isinstance(node.op, ast.USub) else v
        if isinstance(node, ast.BinOp):
            a, b = ev(node.left), ev(node.right)
            if isinstance(node.op, ast.Add):
                return a + b
            if isinstance(node.op, ast.Sub):
                return a - b
            if isinstance(node.op, ast.Mult):
                return a * b
            if isinstance(node.op, ast.Div):
                return a / b
            if isinstance(node.op, ast.Mod):
                return math.fmod(a, b)
            if isinstance(node.op, ast.Pow):
                return _safe_pow(a, b)
            raise ValueError("operator")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and not node.keywords:
            name = node.func.id.lower()
            if name not in _FUNCS:
                raise ValueError(name)
            args = [ev(a) for a in node.args]
            if name == "pow":
                return _safe_pow(*args)
            return float(_FUNCS[name](*args))
        raise ValueError("expression")

    try:
        value = ev(tree)
    except (ValueError, TypeError, ZeroDivisionError, OverflowError, RecursionError):
        return None
    if math.isnan(value) or math.isinf(value):
        return None
    return value


# ---------------------------------------------------------------------------
# Cloze (embedded answers) syntax
# ---------------------------------------------------------------------------

_CLOZE_RE = re.compile(r"\{(\d*):([A-Za-z_]+):((?:\\.|[^}\\])*)\}")
_CLOZE_SA = {"SHORTANSWER", "SA", "MW", "SHORTANSWER_C", "SAC", "MWC"}
_CLOZE_NM = {"NUMERICAL", "NM"}
_CLOZE_MC = {"MULTICHOICE", "MC", "MULTICHOICE_V", "MCV", "MULTICHOICE_H", "MCH", "MULTICHOICE_S", "MCS",
             "MULTICHOICE_VS", "MCVS", "MULTICHOICE_HS", "MCHS", "MULTIRESPONSE", "MR", "MULTIRESPONSE_H", "MRH",
             "MULTIRESPONSE_V", "MRV", "MULTIRESPONSE_S", "MRS", "MULTIRESPONSE_HS", "MRHS", "MULTIRESPONSE_VS",
             "MRVS"}


def _split_unescaped(text: str, sep: str) -> list[str]:
    out, buf, i = [], [], 0
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text):
            buf.append(text[i:i + 2])
            i += 2
            continue
        if ch == sep:
            out.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
        i += 1
    out.append("".join(buf))
    return out


def _unescape_cloze(text: str) -> str:
    return re.sub(r"\\(.)", r"\1", text)


def _cloze_answers(body: str) -> list[tuple[float, str]]:
    """(fraction, plain answer) for each ``~``-separated answer of a cloze gap."""
    out = []
    for part in _split_unescaped(body, "~"):
        if not part.strip():
            continue
        fraction = 0.0
        m = re.match(r"\s*(=|%(-?\d+(?:\.\d+)?)%)", part)
        if m:
            fraction = 1.0 if m.group(1) == "=" else float(m.group(2)) / 100.0
            part = part[m.end():]
        answer = _split_unescaped(part, "#")[0]
        out.append((fraction, _plain(_unescape_cloze(answer))))
    return out


def cloze_blank(qtype: str, body: str) -> Optional[ir.Blank]:
    """Blank for one ``{n:TYPE:answers}`` gap, None for an unknown type."""
    qtype = qtype.upper()
    answers = _cloze_answers(body)
    best = max((f for f, _a in answers), default=0.0)
    correct = [a for f, a in answers if f >= 1.0] or [a for f, a in answers if best > 0 and f == best]
    if qtype in _CLOZE_SA:
        return ir.Blank(answers=[a for a in correct if a and a != "*"])
    if qtype in _CLOZE_NM:
        candidates = [fa for fa in answers if fa[0] >= 1.0] or [fa for fa in answers if best > 0 and fa[0] == best]
        for _f, a in candidates:
            value, _sep, tol = a.partition(":")
            try:
                num = float(value)
            except ValueError:
                continue
            return ir.Blank(answers=[value.strip()],
                            numeric=ir.NumericAnswer(num, abs(to_float(tol, 0.0)) if tol else 0.0))
        return ir.Blank()
    if qtype in _CLOZE_MC:
        if qtype.startswith("MR") or qtype.startswith("MULTIRESPONSE"):
            correct = [a for f, a in answers if f > 0]
        return ir.Blank(answers=correct, choices=[a for _f, a in answers])
    return None


def parse_cloze_text(text: str) -> tuple[str, list[ir.Blank]]:
    """Replace every ``{n:TYPE:...}`` gap by ``{{k}}`` and return the blanks."""
    blanks: list[ir.Blank] = []

    def sub(m: re.Match) -> str:
        blank = cloze_blank(m.group(2), m.group(3))
        if blank is None:
            return m.group(0)
        blanks.append(blank)
        return "{{%d}}" % len(blanks)

    return _CLOZE_RE.sub(sub, text or ""), blanks


# ---------------------------------------------------------------------------
# files.xml
# ---------------------------------------------------------------------------


@dataclass
class _FileRec:
    contextid: str
    component: str
    filearea: str
    itemid: str
    filepath: str
    filename: str
    mimetype: str
    sortorder: int
    path: str  # absolute path of the content file

    @property
    def full(self) -> str:
        return (self.filepath or "/") + self.filename


class _FileStore:
    def __init__(self, root: str, index: FileIndex, warn: Optional[Callable[[str], None]] = None):
        self.root = root
        self.index = index
        self.records: list[_FileRec] = []
        seen: set[tuple] = set()
        self._by_area: dict[tuple[str, str], list[_FileRec]] = {}
        self._by_item: dict[tuple[str, str, str], list[_FileRec]] = {}
        self._by_ctx_name: dict[tuple[str, str], list[_FileRec]] = {}
        # An unreadable files.xml is reported once here; every file would otherwise just be "missing"
        doc = _parse(os.path.join(root, "files.xml"), warn)
        for f in children(doc, "file"):
            name = _raw(f, "filename")
            digest = _t(f, "contenthash").lower()
            if not name or name == "." or not _HASH_RE.match(digest):
                continue
            filepath = _raw(f, "filepath") or "/"
            if not filepath.startswith("/"):
                filepath = "/" + filepath
            if not filepath.endswith("/"):
                filepath += "/"
            rec = _FileRec(
                contextid=_t(f, "contextid"), component=_t(f, "component"), filearea=_t(f, "filearea"),
                itemid=_t(f, "itemid") or "0", filepath=filepath, filename=name, mimetype=_t(f, "mimetype"),
                sortorder=to_int(_t(f, "sortorder")),
                path=os.path.join(root, "files", digest[:2], digest),
            )
            # The same file can be listed twice (several annotations)
            key = (rec.contextid, rec.component, rec.filearea, rec.itemid, rec.full)
            if key in seen:
                continue
            seen.add(key)
            self.records.append(rec)
            self._by_area.setdefault((rec.component, rec.filearea), []).append(rec)
            self._by_item.setdefault((rec.component, rec.filearea, rec.itemid), []).append(rec)
            self._by_ctx_name.setdefault((rec.contextid, name.lower()), []).append(rec)

    def area(self, component: str, filearea: str, itemid: Optional[str] = None,
             contextid: Optional[str] = None) -> list[_FileRec]:
        if itemid is None:
            recs = list(self._by_area.get((component, filearea), []))
        else:
            recs = list(self._by_item.get((component, filearea, str(itemid)), []))
        if contextid:
            scoped = [r for r in recs if r.contextid == str(contextid)]
            # Item ids identify records globally (question ids, chapter ids...);
            # area-wide ids (0) only make sense inside their context.
            if scoped or itemid in (None, "0", 0):
                recs = scoped
        return sorted(recs, key=lambda r: (r.filepath, r.filename))

    @staticmethod
    def asset(rec: _FileRec) -> ir.Asset:
        return ir.Asset(path=rec.path, name=rec.filename, mime=rec.mimetype or None)

    def _by_context(self, m: re.Match) -> Optional[ir.Asset]:
        tail = m.group(3)
        if m.group(1):  # URL-encoded variant: slashes are %2F
            tail = unquote(tail)
        tail = unquote(re.split(r"[?#]", tail, maxsplit=1)[0])
        parts = [p for p in tail.split("/") if p]
        if len(parts) < 3:
            return None
        recs = self.area(parts[0], parts[1], None, m.group(2))
        # With or without an item id in the URL (page content carries a revision there)
        wanted = {("/" + "/".join(parts[3:])).lower(), ("/" + "/".join(parts[2:])).lower()}
        for rec in recs:
            if rec.full.lower() in wanted:
                return self.asset(rec)
        same = [r for r in recs if r.filename.lower() == parts[-1].lower()]
        return self.asset(same[0]) if len(same) == 1 else None

    def resolver(self, areas: Iterable[tuple[str, str, Optional[str]]], contextid: Optional[str],
                 base_dir: str = "/") -> ir.Resolver:
        recs: list[_FileRec] = []
        for component, filearea, itemid in areas:
            recs.extend(self.area(component, filearea, itemid, contextid))
        by_full: dict[str, _FileRec] = {}
        by_name: dict[str, list[_FileRec]] = {}
        for r in recs:
            by_full.setdefault(r.full.lower(), r)
            by_name.setdefault(r.filename.lower(), []).append(r)
        ctx = str(contextid or "")

        def extra(url: str) -> Optional[ir.Asset]:
            u = html_lib.unescape((url or "").strip())
            by_context = _BY_CONTEXT_RE.search(u)
            if by_context:
                return self._by_context(by_context)
            if "@@PLUGINFILE@@" in u:
                rel = u.split("@@PLUGINFILE@@", 1)[1]
                rel = unquote(re.split(r"[?#]", rel, maxsplit=1)[0])
                full = posixpath.normpath("/" + rel.lstrip("/"))
            else:
                try:
                    parsed = urlparse(u)
                except ValueError:
                    return None
                if parsed.scheme or parsed.netloc or not parsed.path:
                    return None
                rel = unquote(parsed.path)
                full = posixpath.normpath(rel if rel.startswith("/") else posixpath.join(base_dir, rel))
                full = "/" + full.lstrip("/")
            rec = by_full.get(full.lower())
            if rec is None:
                name = posixpath.basename(full).lower()
                same = by_name.get(name, [])
                if len(same) == 1:
                    rec = same[0]
                elif ctx and not same:
                    others = self._by_ctx_name.get((ctx, name), [])
                    if len(others) == 1:
                        rec = others[0]
            return self.asset(rec) if rec is not None else None

        return make_resolver(self.index, extra=extra, basename_fallback=False)


# ---------------------------------------------------------------------------
# Question bank (questions.xml, or the 1.9 QUESTION_CATEGORIES)
# ---------------------------------------------------------------------------


class _Bank:
    def __init__(self, categories: list[Element]):
        self.categories: dict[str, Element] = {}
        self.children: dict[str, list[str]] = {}
        self.questions: dict[str, tuple[Element, str]] = {}  # id -> (element, category id)
        self.entries: dict[str, list[tuple[int, str, Element]]] = {}  # entry id -> versions
        self.current: dict[str, list[Element]] = {}  # category id -> questions students can draw
        for cat in categories:
            cid = _eid(cat)
            if not cid:
                continue
            self.categories[cid] = cat
            self.children.setdefault(_t(cat, "parent") or "0", []).append(cid)
            entries = cat.find("question_bank_entries")
            if entries is not None:  # Moodle 4.0+
                for entry in children(entries, "question_bank_entry"):
                    eid = _eid(entry)
                    versions = []
                    for qv in entry.iter("question_versions"):
                        for q in children(qv.find("questions"), "question"):
                            if not _eid(q):
                                continue
                            self.questions[_eid(q)] = (q, cid)
                            versions.append((to_int(_t(qv, "version"), 1), _t(qv, "status") or "ready", q))
                    versions.sort(key=lambda v: v[0])
                    self.entries[eid] = versions
                    latest = self._pick(versions)
                    status = next((st for _v, st, qq in versions if qq is latest), "ready")
                    if latest is not None and status != "hidden":
                        self.current.setdefault(cid, []).append(latest)
                # Records outside an entry (subquestions of older exports)
                for q in cat.iter("question"):
                    if _eid(q) and q.find("qtype") is not None:
                        self.questions.setdefault(_eid(q), (q, cid))
            else:
                for q in cat.iter("question"):
                    qid = _eid(q)
                    if not qid or q.find("qtype") is None:
                        continue
                    self.questions[qid] = (q, cid)
                    if not _flag(q, "hidden"):
                        self.current.setdefault(cid, []).append(q)

    @staticmethod
    def _pick(versions: list[tuple[int, str, Element]], version: Optional[int] = None) -> Optional[Element]:
        if not versions:
            return None
        if version:
            for v, _s, q in versions:
                if v == version:
                    return q
        ready = [q for _v, s, q in versions if s == "ready"]
        return ready[-1] if ready else versions[-1][2]

    def entry_question(self, entry_id: str, version: Optional[int] = None) -> Optional[Element]:
        return self._pick(self.entries.get(entry_id, []), version)

    def question(self, qid: str) -> Optional[Element]:
        found = self.questions.get(str(qid))
        return found[0] if found else None

    def category_of(self, qid: str) -> str:
        found = self.questions.get(str(qid))
        return found[1] if found else ""

    def context_of(self, qid: str) -> str:
        return _t(self.categories.get(self.category_of(qid)), "contextid")

    def category_name(self, cid: str) -> str:
        return _t(self.categories.get(cid), "name") or cid

    def drawable(self, cid: str, subcategories: bool = False) -> list[Element]:
        """Questions a random slot can draw from category ``cid``."""
        cats = [cid]
        if subcategories:
            i = 0
            while i < len(cats) and len(cats) < 10_000:
                cats.extend(c for c in self.children.get(cats[i], []) if c not in cats)
                i += 1
        out = []
        for c in cats:
            for q in self.current.get(c, []):
                if (_t(q, "parent") or "0") != "0" or _t(q, "qtype") in ("random", "randomsamatch", "description"):
                    continue
                out.append(q)
        return out


# ---------------------------------------------------------------------------
# Question conversion (shared by 2.x and 1.9)
# ---------------------------------------------------------------------------

RichFactory = Callable[[str, str, str, str, str], ir.RichText]  # html, component, filearea, itemid, ctx


class _Questions:
    def __init__(self, bank: _Bank, rich: RichFactory):
        self.bank = bank
        self.rich = rich

    # ------------------------------------------------------------ helpers

    @staticmethod
    def _plug(q: Element) -> Element:
        qtype = _t(q, "qtype")
        plug = q.find(f"plugin_qtype_{qtype}_question")
        return plug if plug is not None else q

    @staticmethod
    def _answers(plug: Element) -> list[dict]:
        out = []
        holder = plug.find("answers")
        for a in children(holder, "answer"):
            text = _raw(a, "answertext") if a.find("answertext") is not None else _raw(a, "answer_text")
            out.append({"id": _eid(a), "text": text, "format": _t(a, "answerformat") or "1",
                        "fraction": to_float(_t(a, "fraction")), "feedback": _raw(a, "feedback")})
        return out

    def _answer_rich(self, a: dict, ctx: str) -> ir.RichText:
        return self.rich(_format_html(a["text"], a["format"] if a["format"] in ("1", "0") else "2"),
                         "question", "answer", a["id"], ctx)

    @staticmethod
    def _correct(answers: list[dict]) -> list[dict]:
        full = [a for a in answers if a["fraction"] >= 0.999]
        if full:
            return full
        best = max((a["fraction"] for a in answers), default=0.0)
        return [a for a in answers if best > 0 and a["fraction"] == best]

    # ------------------------------------------------------------ public

    def convert(self, q: Element, points: Optional[float] = None) -> ir.Question:
        qid = _eid(q)
        qtype = (_t(q, "qtype") or "").lower()
        ctx = self.bank.context_of(qid)
        text_html = _format_html(_raw(q, "questiontext"), _t(q, "questiontextformat") or "1")
        out = ir.Question(
            type=ir.QType.UNSUPPORTED,
            text=self.rich(text_html, "question", "questiontext", qid, ctx),
            title=_t(q, "name"),
            id=f"question_{qid}",
            points=to_float(_t(q, "defaultmark") or _t(q, "defaultgrade"), 1.0) or 1.0,
            general_feedback=_format_html(_raw(q, "generalfeedback"), _t(q, "generalfeedbackformat") or "1"),
            source_type=qtype,
        )
        if points is not None and points > 0:
            out.points = points
        handler = getattr(self, f"_q_{qtype}", None)
        if handler is None:
            out.reason = _QTYPE_REASONS.get(qtype, f"question type '{qtype or 'unknown'}' is not supported")
            return out
        try:
            handler(q, out, self._plug(q), ctx)
        except Exception as e:  # a malformed question must not sink the quiz
            out.type = ir.QType.UNSUPPORTED
            out.reason = f"could not be read ({error_text(e)})"
        return out

    # ------------------------------------------------------------ qtypes

    def _q_description(self, q, out, plug, ctx):
        out.type = ir.QType.DESCRIPTION

    def _q_multichoice(self, q, out, plug, ctx):
        answers = self._answers(plug)
        opts = plug.find("multichoice")
        single = _flag(opts, "single", True)
        best = max((a["fraction"] for a in answers), default=0.0)
        out.type = ir.QType.MULTICHOICE
        out.multiple = not single
        out.partial_credit = not single or any(0 < a["fraction"] < 0.999 for a in answers)
        for a in answers:
            correct = a["fraction"] > 0 if not single else (best > 0 and a["fraction"] >= best - 1e-6)
            out.choices.append(ir.Choice(self._answer_rich(a, ctx), correct, _plain(a["feedback"])))

    def _q_truefalse(self, q, out, plug, ctx):
        out.type = ir.QType.TRUEFALSE
        for a in self._answers(plug):
            out.choices.append(ir.Choice(self._answer_rich(a, ctx), a["fraction"] > 0, _plain(a["feedback"])))

    def _q_shortanswer(self, q, out, plug, ctx):
        out.type = ir.QType.SHORTANSWER
        opts = plug.find("shortanswer")
        out.case_sensitive = _flag(opts, "usecase") if opts is not None else False
        out.answers = [_plain(a["text"]) for a in self._correct(self._answers(plug)) if _plain(a["text"])]

    def _numeric_answers(self, plug: Element, answers: list[dict]) -> list[ir.NumericAnswer]:
        tolerances: dict[str, float] = {}
        # numerical_records/numerical_record in 2.x backups; numerical_answer
        # in some exporters and "numerical" in 1.9
        for na in list(plug.iter("numerical_record")) + list(plug.iter("numerical_answer")) \
                + children(plug, "numerical"):
            tolerances[_t(na, "answer")] = abs(to_float(_t(na, "tolerance")))
        out = []
        for a in self._correct(answers):
            text = _plain(a["text"])
            try:
                value = float(text)
            except ValueError:
                continue  # "*" accepts anything
            out.append(ir.NumericAnswer(value, tolerances.get(a["id"], 0.0)))
        return out

    @staticmethod
    def _unit(plug: Element) -> str:
        units = list(plug.iter("numerical_unit"))
        for u in units:
            if to_float(_t(u, "multiplier"), 0.0) == 1.0:
                return _t(u, "unit")
        return _t(units[0], "unit") if units else ""

    def _q_numerical(self, q, out, plug, ctx):
        out.type = ir.QType.NUMERICAL
        out.numeric = self._numeric_answers(plug, self._answers(plug))
        out.unit = self._unit(plug)

    def _q_essay(self, q, out, plug, ctx):
        out.type = ir.QType.ESSAY
        opts = plug.find("essay")
        fmt = _t(opts, "responseformat") if opts is not None else "editor"
        attachments = to_int(_t(opts, "attachments")) if opts is not None else 0
        out.allow_text = fmt != "noinline"
        out.allow_attachments = attachments != 0 or fmt == "editorfilepicker"

    def _q_match(self, q, out, plug, ctx):
        out.type = ir.QType.MATCHING
        for m in plug.iter("match"):
            answer = _plain(_raw(m, "answertext"))
            prompt_html = _format_html(_raw(m, "questiontext"), _t(m, "questiontextformat") or "1")
            if not _plain(prompt_html) and "<img" not in prompt_html.lower():
                if answer:
                    out.distractors.append(answer)
                continue
            out.pairs.append(ir.MatchPair(self.rich(prompt_html, "qtype_match", "subquestion", _eid(m), ctx),
                                          answer))

    def _q_ordering(self, q, out, plug, ctx):
        out.type = ir.QType.ORDERING
        answers = sorted(enumerate(self._answers(plug)), key=lambda ia: (ia[1]["fraction"], ia[0]))
        out.ordering = [_plain(a["text"]) or f"Item {i + 1}" for i, a in answers]

    def _gaps(self, q, out, plug, ctx, group_of: Callable[[dict], str]):
        answers = self._answers(plug)
        out.type = ir.QType.CLOZE
        groups: dict[str, list[str]] = {}
        for a in answers:
            groups.setdefault(group_of(a), []).append(_plain(a["text"]))

        def sub(m: re.Match) -> str:
            n = int(m.group(1))
            if not 1 <= n <= len(answers):
                return m.group(0)
            a = answers[n - 1]
            out.blanks.append(ir.Blank(answers=[_plain(a["text"])], choices=list(groups.get(group_of(a), []))))
            return "{{%d}}" % len(out.blanks)

        out.text = ir.RichText(re.sub(r"\[\[(\d+)\]\]", sub, out.text.html), out.text.resolve)

    def _q_ddwtos(self, q, out, plug, ctx):
        def group(a: dict) -> str:
            m = re.search(r'draggroup";(?:s:\d+:"(\d+)"|i:(\d+))', a["feedback"] or "")
            return (m.group(1) or m.group(2)) if m else "1"
        self._gaps(q, out, plug, ctx, group)

    def _q_gapselect(self, q, out, plug, ctx):
        self._gaps(q, out, plug, ctx, lambda a: (_plain(a["feedback"]) or "1"))

    def _q_gapfill(self, q, out, plug, ctx):
        opts = plug.find("gapfill")
        delims = (_t(opts, "delimitchars") if opts is not None else "") or "[]"
        display = (_t(opts, "answerdisplay") if opts is not None else "") or "dragdrop"
        out.type = ir.QType.CLOZE
        out.case_sensitive = _flag(opts, "casesensitive") if opts is not None else False
        left, right = delims[0], delims[-1]
        pattern = re.compile(re.escape(left) + r"([^" + re.escape(left + right) + r"]+)" + re.escape(right))
        gaps: list[list[str]] = []

        def sub(m: re.Match) -> str:
            alternatives = [_plain(p) for p in m.group(1).split("|") if _plain(p)]
            gaps.append(alternatives)
            return "{{%d}}" % len(gaps)

        new_html = pattern.sub(sub, out.text.html)
        distractors = [_plain(a["text"]) for a in self._answers(plug) if a["fraction"] <= 0 and _plain(a["text"])]
        wrong = _raw(opts, "wronganswers") if opts is not None else ""
        distractors += [w.strip() for w in wrong.split(",") if w.strip()]
        pool: list[str] = []
        if display in ("dragdrop", "dropdown"):
            for alt in [g[0] for g in gaps if g] + distractors:
                if alt not in pool:
                    pool.append(alt)
        out.blanks = [ir.Blank(answers=g, choices=list(pool)) for g in gaps]
        out.text = ir.RichText(new_html, out.text.resolve)

    def _child_blank(self, child: Optional[Element]) -> ir.Blank:
        if child is None:
            return ir.Blank()
        ctype = _t(child, "qtype")
        plug = self._plug(child)
        answers = self._answers(plug)
        if not answers:
            _text, blanks = parse_cloze_text(_raw(child, "questiontext"))
            return blanks[0] if blanks else ir.Blank()
        if ctype == "numerical":
            nums = self._numeric_answers(plug, answers)
            if nums:
                return ir.Blank(answers=[_num(nums[0].value)], numeric=nums[0])
            return ir.Blank()
        if ctype in ("multichoice", "multiresponse"):
            opts = plug.find("multichoice")
            single = ctype == "multichoice" and _flag(opts, "single", True)
            correct = self._correct(answers) if single else [a for a in answers if a["fraction"] > 0]
            return ir.Blank(answers=[_plain(a["text"]) for a in correct],
                            choices=[_plain(a["text"]) for a in answers])
        return ir.Blank(answers=[_plain(a["text"]) for a in self._correct(answers) if _plain(a["text"]) != "*"])

    def _q_multianswer(self, q, out, plug, ctx):
        out.type = ir.QType.CLOZE
        html = out.text.html
        seq_el = next(iter(plug.iter("multianswer")), None)
        sequence = [s.strip() for s in _t(seq_el, "sequence").split(",") if s.strip()] if seq_el is not None else []
        if "{#" in html and sequence:
            blanks = [self._child_blank(self.bank.question(cid)) for cid in sequence]
            html = re.sub(r"\{#(\d+)\}",
                          lambda m: "{{%s}}" % m.group(1) if 1 <= int(m.group(1)) <= len(blanks) else m.group(0),
                          html)
            out.blanks = blanks
        else:
            html, out.blanks = parse_cloze_text(html)
        out.text = ir.RichText(html, out.text.resolve)
        if not out.blanks:
            out.type = ir.QType.UNSUPPORTED
            out.reason = "embedded answers question without any gap"

    def _datasets(self, plug: Element) -> dict[str, float]:
        values: dict[str, float] = {}
        defs = list(plug.iter("dataset_definition")) + list(plug.iter("datasetdefinition"))
        for d in defs:
            name = _t(d, "name")
            items = list(d.iter("dataset_item")) + list(d.iter("datasetitem"))
            if not name or not items:
                continue
            first_item = min(items, key=lambda it: to_int(_t(it, "number"), 1))
            values[name] = to_float(_t(first_item, "value"))
        return values

    @staticmethod
    def _substitute(text: str, values: dict[str, float]) -> str:
        for name, value in values.items():
            text = text.replace("{" + name + "}", _num(value))
        return text

    def _calc_value(self, formula: str, values: dict[str, float]) -> Optional[float]:
        expr = self._substitute(html_lib.unescape(formula), values)
        if re.search(r"\{[A-Za-z_]", expr):
            return None
        return eval_formula(expr)

    @staticmethod
    def _round(value: float, record: Optional[Element]) -> float:
        if record is None:
            return value
        length = to_int(_t(record, "correctanswerlength"), 2)
        if _t(record, "correctanswerformat") == "2" and value:
            digits = max(1, length) - int(math.floor(math.log10(abs(value)))) - 1
            return round(value, digits)
        return round(value, max(0, length))

    def _q_calculated(self, q, out, plug, ctx):
        values = self._datasets(plug)
        if not values:
            out.type = ir.QType.UNSUPPORTED
            out.reason = "calculated question without dataset values"
            return
        records = {_t(r, "answer"): r for r in list(plug.iter("calculated_record")) + children(plug, "calculated")}
        nums = []
        for a in self._correct(self._answers(plug)):
            value = self._calc_value(_plain(a["text"]), values)
            if value is None:
                continue
            rec = records.get(a["id"])
            value = self._round(value, rec)
            tol = abs(to_float(_t(rec, "tolerance"))) if rec is not None else 0.0
            if _t(rec, "tolerancetype") in ("1", "3", ""):  # relative / geometric
                tol = tol * abs(value)
            nums.append(ir.NumericAnswer(value, tol))
        if not nums:
            out.type = ir.QType.UNSUPPORTED
            out.reason = "calculated question formula could not be evaluated"
            return
        # Converted with the first dataset values (a documented difference)
        out.type = ir.QType.NUMERICAL
        out.numeric = nums
        out.unit = self._unit(plug)
        out.text = ir.RichText(self._substitute(out.text.html, values), out.text.resolve)

    _q_calculatedsimple = _q_calculated

    def _q_calculatedmulti(self, q, out, plug, ctx):
        values = self._datasets(plug)
        if not values:
            out.type = ir.QType.UNSUPPORTED
            out.reason = "calculated question without dataset values"
            return
        opts = plug.find("calculated_options")
        if opts is not None and opts.find("calculated_option") is not None:
            opts = opts.find("calculated_option")  # 2.x: <calculated_options><calculated_option>
        single = _flag(opts, "single", True)

        def fill(text: str) -> str:
            def inline(m: re.Match) -> str:
                v = self._calc_value(m.group(1), values)
                return _num(round(v, 6)) if v is not None else m.group(0)
            return self._substitute(re.sub(r"\{=([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}", inline, text), values)

        answers = self._answers(plug)
        best = max((a["fraction"] for a in answers), default=0.0)
        out.type = ir.QType.MULTICHOICE
        out.multiple = not single
        for a in answers:
            correct = a["fraction"] > 0 if not single else (best > 0 and a["fraction"] >= best - 1e-6)
            out.choices.append(ir.Choice(self.rich(fill(a["text"]), "question", "answer", a["id"], ctx), correct,
                                         _plain(a["feedback"])))
        out.text = ir.RichText(self._substitute(out.text.html, values), out.text.resolve)

    def _q_coderunner(self, q, out, plug, ctx):
        opts = next(iter(plug.iter("coderunner_option")), None)
        crtype = (_t(opts, "coderunnertype") or "").lower()
        if _t(opts, "prototypetype") == "2":
            out.reason = "CodeRunner prototype (a template for other questions, not a question)"
            return
        language = (_t(opts, "language") or crtype).lower()
        lang = next((code for code in (language.split("_")[0], language.rstrip("0123456789")) if code in JUDGE0_LANGUAGES),
                    None)
        if lang is None:
            out.reason = f"CodeRunner '{crtype or 'unknown'}' questions use a language that cannot be run"
            return
        tests, examples = [], []
        for tc in plug.iter("coderunner_testcase"):
            if _t(tc, "testtype") == "1":  # precheck only
                continue
            code, stdin, expected = _raw(tc, "testcode"), _raw(tc, "stdin"), _raw(tc, "expected")
            if code.strip():
                # Tests calling the answer through test code cannot be run; only the examples are kept
                if _flag(tc, "useasexample"):
                    examples.append((code, expected))
            else:
                tests.append((stdin, expected))
        out.type = ir.QType.CODE
        out.code = ir.CodeSpec(language=lang, starter_code=_raw(opts, "answerpreload"),
                               solution_code=_raw(opts, "answer"), test_cases=tests)
        if examples:
            shown = "".join(f"<p><strong>Example</strong></p><pre>{html_lib.escape(c)}</pre>"
                            f"<p>Expected output:</p><pre>{html_lib.escape(e)}</pre>" for c, e in examples)
            out.text = ir.RichText(out.text.html + shown, out.text.resolve)

    def _q_randomsamatch(self, q, out, plug, ctx):
        opts = next(iter(plug.iter("randomsamatch")), None)
        choose = to_int(_t(opts, "choose"), 0) if opts is not None else 0
        subcats = _flag(opts, "subcats", True) if opts is not None else True
        cid = self.bank.category_of(_eid(q))
        pool = [s for s in self.bank.drawable(cid, subcats) if _t(s, "qtype") == "shortanswer"]
        if choose > 0:
            pool = pool[:choose]
        out.type = ir.QType.MATCHING
        for s in pool:
            correct = self._correct(self._answers(self._plug(s)))
            if not correct:
                continue
            sid = _eid(s)
            prompt = self.rich(_format_html(_raw(s, "questiontext"), _t(s, "questiontextformat") or "1"),
                               "question", "questiontext", sid, self.bank.context_of(sid))
            out.pairs.append(ir.MatchPair(prompt, _plain(correct[0]["text"])))
        if not out.pairs:
            out.type = ir.QType.UNSUPPORTED
            out.reason = "random short-answer matching found no short-answer questions in its category"


# ---------------------------------------------------------------------------
# Shared module mapping
# ---------------------------------------------------------------------------


class _Base:
    """Item builders shared by the 2.x and 1.9 readers."""

    course: ir.Course

    def warn(self, message: str) -> None:
        """A problem the user should look at (unreadable or repaired data)."""
        if message not in self.course.warnings:
            self.course.warnings.append(message)

    def skip(self, title: str, kind: str, reason: str) -> None:
        """A source item that is not migrated; the package writer lists it in the report."""
        entry = (title, kind, reason)
        if entry not in self.course.skipped:
            self.course.skipped.append(entry)

    def _xml(self, path: Optional[str]) -> Optional[Element]:
        return _parse(path, self.warn)

    # ---------------------------------------------------------------- files

    def _file_items(self, title: str, mid: str, visible: bool, main: ir.Asset, intro: Optional[ir.RichText],
                    html_loader: Optional[Callable[[], Optional[ir.RichText]]] = None) -> list:
        """Items for a single-file resource."""
        intro_parts = [ir.HtmlPart(intro)] if intro is not None and not intro.is_empty() else []
        ext = main.extension
        kind = media_kind_for(main)
        if kind == ir.MediaKind.PDF and not intro_parts:
            return [ir.DocumentItem(title=title, asset=main, id=mid, visible=visible)]
        if kind == ir.MediaKind.VIDEO:
            return [ir.VideoItem(title=title, asset=main, description=intro if intro_parts else None, id=mid,
                                 visible=visible)]
        if kind is not None:
            return [ir.Page(title=title, parts=intro_parts + [ir.MediaPart(kind, asset=main, title="")], id=mid,
                            visible=visible)]
        if ext in _HTML_EXTS and html_loader is not None:
            body = html_loader()
            if body is not None:
                return [ir.Page(title=title, parts=intro_parts + [ir.HtmlPart(body)], id=mid, visible=visible)]
        # The package writer reports the file as left out (no LearnHouse viewer)
        return [ir.Page(title=title, parts=intro_parts + [ir.FilePart(main, title=main.name)], id=mid,
                        visible=visible)]

    @staticmethod
    def _folder_parts(files: list[tuple[str, ir.Asset]]) -> list:
        """Parts listing ``(directory, asset)`` files, with a heading per subfolder."""
        parts: list = []
        current = "/"
        for directory, asset in files:
            if directory != current:
                current = directory
                if directory.strip("/"):
                    parts.append(ir.HeadingPart(directory.strip("/"), 3))
            kind = media_kind_for(asset)
            if kind is not None:
                parts.append(ir.MediaPart(kind, asset=asset, title=asset.name))
            else:
                parts.append(ir.FilePart(asset, title=asset.name))
        return parts

    def _url_items(self, title: str, mid: str, visible: bool, url: str, intro: Optional[ir.RichText]) -> list:
        url = (url or "").strip()
        if not url:
            return [ir.UnsupportedItem(title=title, kind="url", reason="the link has no address", id=mid)]
        if url.startswith("//"):
            url = "https:" + url
        has_intro = intro is not None and not intro.is_empty()
        if youtube_id(url) or vimeo_id(url) or media_kind_for(url) == ir.MediaKind.VIDEO:
            return [ir.VideoItem(title=title, url=url, description=intro if has_intro else None, id=mid,
                                 visible=visible)]
        parts: list = [ir.HtmlPart(intro)] if has_intro else []
        parts.append(ir.LinkPart(url=url, title=title))
        return [ir.Page(title=title, parts=parts, id=mid, visible=visible)]

    # --------------------------------------------------------------- lesson

    @staticmethod
    def _lesson_order(pages: list[Element]) -> list[Element]:
        by_id = {_eid(p) or _t(p, "pageid"): p for p in pages}
        start = next((p for p in pages if (_t(p, "prevpageid") or "0") == "0"), None)
        ordered: list[Element] = []
        seen: set[str] = set()
        node = start
        while node is not None:
            pid = _eid(node) or _t(node, "pageid")
            if pid in seen:
                break
            seen.add(pid)
            ordered.append(node)
            node = by_id.get(_t(node, "nextpageid") or "0")
        ordered.extend(p for p in pages if (_eid(p) or _t(p, "pageid")) not in seen)
        return ordered

    def _lesson_parts(self, lesson: Element, rich: Callable[[str, str, str], ir.RichText]) -> list:
        """``rich(html, filearea, itemid)`` builds text for the lesson's file areas."""
        custom = _flag(lesson, "custom", True)
        pages = list(lesson.iter("page"))
        parts: list = []
        pending: list[ir.Question] = []

        def flush():
            if pending:
                parts.append(ir.InlineQuizPart(list(pending)))
                pending.clear()

        ordered = self._lesson_order(pages)
        rank = {_eid(p) or _t(p, "pageid"): i for i, p in enumerate(ordered)}
        for page in ordered:
            qtype = to_int(_t(page, "qtype"))
            pid = _eid(page) or _t(page, "pageid")
            title = _t(page, "title")
            contents = rich(_format_html(_raw(page, "contents"), _t(page, "contentsformat") or "1"),
                            "page_contents", pid)
            if qtype in _LESSON_STRUCTURE:
                continue
            if qtype == _LESSON_BRANCHTABLE:
                flush()
                if title:
                    parts.append(ir.HeadingPart(title, 2))
                if not contents.is_empty():
                    parts.append(ir.HtmlPart(contents))
                continue
            q = self._lesson_question(page, qtype, custom, title, contents, rich, rank)
            if q is None:
                self.skip(title or "Untitled", "lesson page", "its question type cannot be converted")
                continue
            pending.append(q)
        flush()
        return parts

    def _lesson_question(self, page: Element, qtype: int, custom: bool, title: str, contents: ir.RichText,
                         rich: Callable[[str, str, str], ir.RichText], rank: dict[str, int]) -> Optional[ir.Question]:
        here = rank.get(_eid(page) or _t(page, "pageid"), -1)

        def jump_is_correct(jumpto: str) -> bool:
            # Without custom scoring an answer is right when it moves forward (lesson::jumpto_is_correct)
            target = to_int(jumpto)
            return target in _LESSON_FORWARD_JUMPS or (target > 0 and rank.get(str(target), -1) > here)

        answers = []
        for a in page.iter("answer"):
            text = _raw(a, "answer_text") if a.find("answer_text") is not None else _raw(a, "answertext")
            correct = to_float(_t(a, "score")) > 0 if custom else jump_is_correct(_t(a, "jumpto"))
            answers.append({"id": _eid(a), "text": text, "response": _raw(a, "response"), "correct": correct,
                            "format": _t(a, "answerformat") or "0"})
        qoption = _flag(page, "qoption")
        q = ir.Question(type=ir.QType.UNSUPPORTED, text=contents, title=title,
                        id=f"lessonpage_{_eid(page) or _t(page, 'pageid')}")
        if qtype in (_LESSON_TRUEFALSE, _LESSON_MULTICHOICE):
            q.type = ir.QType.TRUEFALSE if qtype == _LESSON_TRUEFALSE else ir.QType.MULTICHOICE
            q.multiple = qtype == _LESSON_MULTICHOICE and qoption
            q.choices = [ir.Choice(rich(_format_html(a["text"], a["format"] if a["format"] == "1" else "0"),
                                        "page_answers", a["id"]), a["correct"], _plain(a["response"]))
                         for a in answers]
            return q
        if qtype == _LESSON_SHORTANSWER:
            q.type = ir.QType.SHORTANSWER
            q.case_sensitive = qoption
            q.answers = [_plain(a["text"]) for a in answers if a["correct"] and _plain(a["text"])]
            return q
        if qtype == _LESSON_NUMERICAL:
            q.type = ir.QType.NUMERICAL
            for a in answers:
                if not a["correct"]:
                    continue
                low, sep, high = _plain(a["text"]).partition(":")
                try:
                    if sep:
                        lo, hi = float(low), float(high)
                        q.numeric.append(ir.NumericAnswer((lo + hi) / 2, abs(hi - lo) / 2))
                    else:
                        q.numeric.append(ir.NumericAnswer(float(low)))
                except ValueError:
                    continue
            return q
        if qtype == _LESSON_MATCHING:
            q.type = ir.QType.MATCHING
            for a in answers[2:]:  # the first two hold the correct/wrong jumps
                if _plain(a["text"]):
                    q.pairs.append(ir.MatchPair(rich(a["text"], "page_answers", a["id"]), _plain(a["response"])))
                elif _plain(a["response"]):
                    q.distractors.append(_plain(a["response"]))
            return q
        if qtype == _LESSON_ESSAY:
            q.type = ir.QType.ESSAY
            return q
        return None

    # ------------------------------------------------------------- glossary

    def _glossary_page(self, title: str, mid: str, visible: bool, intro: ir.RichText, entries: list[Element],
                       definition: Callable[[Element], str]) -> ir.Page:
        parts: list = [ir.HtmlPart(intro)] if not intro.is_empty() else []
        cards = []
        for e in entries:
            if (_t(e, "approved") or "1") == "0":
                continue
            concept = _t(e, "concept")
            if concept:
                cards.append((html_lib.escape(concept), definition(e)))
        cards.sort(key=lambda c: c[0].casefold())
        if cards:
            parts.append(ir.FlashcardsPart(cards))
        else:
            self.skip(title, "glossary", "no entries in the backup (entries are only exported with user data)")
        return ir.Page(title=title, parts=parts, id=mid, visible=visible)

    # ---------------------------------------------------------------- polls

    def _poll_page(self, title: str, mid: str, visible: bool, intro: ir.RichText,
                   questions: list[tuple[str, list[str]]]) -> ir.Page:
        """Read-only page listing the questions: responses are not collected."""
        parts: list = [ir.HtmlPart(intro)] if not intro.is_empty() else []
        chunks = []
        for question, options in questions:
            block = f"<p><strong>{question}</strong></p>" if question else ""
            if options:
                block += "<ul>" + "".join(f"<li>{html_lib.escape(o)}</li>" for o in options) + "</ul>"
            chunks.append(block)
        if chunks:
            parts.append(ir.HtmlPart(ir.RichText("".join(chunks))))
        return ir.Page(title=title, parts=parts, id=mid, visible=visible)


# ---------------------------------------------------------------------------
# Moodle 2.x - 5.x
# ---------------------------------------------------------------------------


@dataclass
class _Activity:
    moduleid: str
    sectionid: str
    modulename: str
    title: str
    directory: str


class _Moodle2Reader(_Base):
    def __init__(self, root: str):
        self.root = root
        self.index = FileIndex(root)
        self.course = ir.Course(title="", source=KEY)
        self.files = _FileStore(root, self.index, self.warn)
        self.course_ctx = ""
        self.format = ""
        self.startdate = 0
        self.where = ""  # title of the section or activity being read, for skipped embeds
        doc = self._xml(os.path.join(root, "questions.xml"))
        self.bank = _Bank(children(doc, "question_category"))
        self.questions = _Questions(self.bank, self._question_rich)

    # ---------------------------------------------------------------- text

    def rich(self, html: str, ctx: str, areas: list[tuple[str, str, Optional[str]]], base_dir: str = "/"
             ) -> ir.RichText:
        if "$@HVPEMBEDBYID" in html or "/h5p/embed.php" in html:
            self.skip(self.where or self.course.title, "H5P", "embedded H5P content is not migrated")
        html = _clean_html(html)
        if not html.strip():
            return ir.RichText("")
        return ir.RichText(html, self.files.resolver(areas, ctx, base_dir))

    def _question_rich(self, html: str, component: str, filearea: str, itemid: str, ctx: str) -> ir.RichText:
        return self.rich(html, ctx, [(component, filearea, itemid)])

    def _field(self, el: Element, name: str, ctx: str, component: str, filearea: str,
               itemid: Optional[str] = None) -> ir.RichText:
        html = _format_html(_raw(el, name), _t(el, name + "format") or "1")
        return self.rich(html, ctx, [(component, filearea, itemid)])

    # ---------------------------------------------------------------- read

    def read(self) -> ir.Course:
        course_el = self._xml(os.path.join(self.root, "course", "course.xml"))
        token = _LANG.set(_t(course_el, "lang"))
        try:
            return self._read(course_el)
        finally:
            _LANG.reset(token)

    def _read(self, course_el: Optional[Element]) -> ir.Course:
        mb = self._xml(os.path.join(self.root, "moodle_backup.xml"))
        if mb is None:
            raise ValueError("moodle_backup.xml is not readable XML")
        info = mb.find("information")
        excluded = set()
        for s in mb.iter("setting"):
            if _t(s, "name").endswith("_included") and _t(s, "value") == "0":
                excluded.add(_t(s, "name"))
        self.backup_type = _t(info, "details/detail/type") or "course"
        self._read_course(info, course_el)

        contents = info.find("contents") if info is not None else None
        activities: list[_Activity] = []
        for a in contents.iter("activity") if contents is not None else []:
            act = _Activity(_t(a, "moduleid"), _t(a, "sectionid"), _t(a, "modulename"), _t(a, "title"),
                            _t(a, "directory"))
            if f"{act.modulename}_{act.moduleid}_included" in excluded:
                continue
            activities.append(act)
        self.activities_by_section: dict[str, list[_Activity]] = {}
        for act in activities:
            self.activities_by_section.setdefault(act.sectionid, []).append(act)

        sections = []
        known_sections = {_t(s, "sectionid") for s in contents.iter("section")} if contents is not None else set()
        section_dirs = [_t(s, "directory") for s in contents.iter("section")] if contents is not None else []
        if not section_dirs:
            base = os.path.join(self.root, "sections")
            section_dirs = [f"sections/{d}" for d in sorted(os.listdir(base))] if os.path.isdir(base) else []
        for directory in section_dirs:
            path = safe_join(self.root, f"{directory}/section.xml")
            el = self._xml(path)
            if el is None:
                continue
            known_sections.add(_eid(el))
            if f"section_{_eid(el)}_included" in excluded:
                continue
            sections.append(el)
        sections.sort(key=lambda s: to_int(_t(s, "number")))
        self.delegated = {_t(s, "itemid"): s for s in sections if _t(s, "component") == "mod_subsection"}

        for s in sections:
            if _t(s, "component"):
                continue  # delegated sections are read where their subsection module sits
            self.course.sections.append(self._section(s))
        # Activities whose section is not in the backup would vanish silently
        orphans = [a for a in activities if a.sectionid not in known_sections]
        if orphans and self.backup_type == "activity":
            # A single-activity backup has no section: the activity is the course
            if course_el is None and len(orphans) == 1 and orphans[0].title:
                self.course.title = orphans[0].title
            self.course.sections.append(ir.Section(title=self.course.title, id="section_activity",
                                                   items=self._activity_items(orphans, True, 0)))
        elif orphans:
            self.course.sections.append(ir.Section(title="Other activities", id="section_orphans",
                                                   items=self._activity_items(orphans, True, 0)))
        return self.course

    def _read_course(self, info: Optional[Element], el: Optional[Element]) -> None:
        c = self.course
        if el is None and self.backup_type == "course":
            self.warn("course/course.xml is missing; only the backup summary was read")
        self.course_ctx = (el.get("contextid") if el is not None else "") or _t(info, "original_course_contextid")
        c.title = _t(el, "fullname") or _t(info, "original_course_fullname") or "Moodle course"
        c.short_name = _t(el, "shortname") or _t(info, "original_course_shortname")
        c.id = _eid(el) or _t(info, "original_course_id")
        site = _t(info, "original_site_identifier_hash")
        if site and c.id:
            c.id = f"{site[:12]}:{c.id}"
        if el is not None:
            c.summary = self._field(el, "summary", self.course_ctx, "course", "summary")
            c.language = _t(el, "lang")
            c.tags = [_t(tag, "rawname") or _t(tag, "name") for tag in el.iter("tag")
                      if _t(tag, "rawname") or _t(tag, "name")]
        self.format = _t(el, "format") or _t(info, "original_course_format")
        self.startdate = to_int(_t(el, "startdate"))
        for rec in self.files.area("course", "overviewfiles", None, self.course_ctx):
            if media_kind_for(rec.filename) == ir.MediaKind.IMAGE:
                c.thumbnail = self.files.asset(rec)
                break

    def _section_title(self, s: Element) -> str:
        name = _t(s, "name")
        if name:
            return name
        number = to_int(_t(s, "number"))
        if number == 0:
            return "General"
        if self.format == "weeks" and self.startdate > 0:
            try:
                start = datetime.fromtimestamp(self.startdate, tz=timezone.utc) + timedelta(days=7 * (number - 1),
                                                                                             hours=2)
                end = start + timedelta(days=6)
                return f"{start.day} {start:%B} - {end.day} {end:%B}"
            except (ValueError, OverflowError, OSError):
                pass  # a start date or section number out of range: fall back to the plain name
        return f"Topic {number}" if self.format == "topics" else f"Section {number}"

    def _section(self, s: Element) -> ir.Section:
        sid = _eid(s)
        visible = _flag(s, "visible", True)
        self.where = self._section_title(s)
        section = ir.Section(
            title=self.where,
            summary=self._field(s, "summary", self.course_ctx, "course", "section", sid),
            id=f"section_{sid}",
            visible=visible,
        )
        section.items = self._section_items(s, visible, depth=0)
        return section

    def _section_items(self, s: Element, visible: bool, depth: int) -> list:
        sid = _eid(s)
        acts = self.activities_by_section.get(sid, [])
        by_id = {a.moduleid: a for a in acts}
        ordered: list[_Activity] = []
        for mid in (_t(s, "sequence") or "").split(","):
            act = by_id.pop(mid.strip(), None)
            if act is not None:
                ordered.append(act)
        ordered.extend(a for a in acts if a.moduleid in by_id)
        return self._activity_items(ordered, visible, depth)

    def _activity_items(self, ordered: list[_Activity], visible: bool, depth: int) -> list:
        items: list = []
        last_label: Optional[ir.Page] = None
        for act in ordered:
            try:
                produced, is_label = self._module(act, visible, depth)
            except Exception as e:  # one broken activity must not sink the course
                self.warn(f"Could not read {act.modulename} \"{act.title}\": {error_text(e)}")
                continue
            if is_label and produced and last_label is not None and last_label.visible == produced[0].visible:
                last_label.parts.extend(produced[0].parts)
                continue
            last_label = produced[0] if is_label and produced else None
            items.extend(produced)
        return items

    # -------------------------------------------------------------- modules

    def _module(self, act: _Activity, section_visible: bool, depth: int) -> tuple[list, bool]:
        if not _MODNAME_RE.fullmatch(act.modulename):  # the name becomes a file name and a method name
            self.skip(act.title or act.modulename or "Untitled", "activity", "unknown module type")
            return [], False
        directory = safe_join(self.root, act.directory) if act.directory else None
        if not directory or not os.path.isdir(directory):
            self.skip(act.title or act.modulename, act.modulename, "missing from the backup")
            return [], False
        module = self._xml(os.path.join(directory, "module.xml"))
        if module is not None and _flag(module, "deletioninprogress"):
            return [], False
        visible = section_visible and (module is None or (_flag(module, "visible", True)
                                                          and _flag(module, "visibleoncoursepage", True)))
        doc = self._xml(os.path.join(directory, f"{act.modulename}.xml"))
        inner = doc.find(act.modulename) if doc is not None else None
        mid = f"{act.modulename}_{act.moduleid}"
        title = (_t(inner, "name") if inner is not None else "") or act.title or act.modulename
        self.where = title
        if inner is None:
            if act.modulename in _UNSUPPORTED_REASONS or act.modulename == "subsection":
                return [ir.UnsupportedItem(title=title, kind=act.modulename,
                                           reason=_UNSUPPORTED_REASONS.get(act.modulename, "not in the backup"),
                                           id=mid)], False
            self.skip(title, act.modulename, "no data in the backup")
            return [], False
        ctx = doc.get("contextid") or ""
        m = _ModCtx(act=act, directory=directory, module=module, inner=inner, ctx=ctx, mid=mid, title=title,
                    visible=visible, depth=depth)
        if act.modulename == "qbank":
            return [], False  # Moodle 5 question banks: their questions come with the quizzes using them
        handler = getattr(self, f"_mod_{act.modulename}", None)
        if handler is None:
            reason = _UNSUPPORTED_REASONS.get(act.modulename, f"'{act.modulename}' activities are not migrated")
            return [ir.UnsupportedItem(title=title, kind=act.modulename, reason=reason, id=mid)], False
        return handler(m), act.modulename == "label"

    def _intro(self, m: "_ModCtx") -> ir.RichText:
        return self._field(m.inner, "intro", m.ctx, f"mod_{m.act.modulename}", "intro")

    def _shown_intro(self, m: "_ModCtx") -> Optional[ir.RichText]:
        """The description when the activity's own page or the course page shows it."""
        intro = self._intro(m)
        if intro.is_empty():
            return None
        printintro = _php_option(_raw(m.inner, "displayoptions"), "printintro")
        showdescription = _flag(m.module, "showdescription") if m.module is not None else False
        return intro if (printintro == "1" or showdescription) else None

    def _grade_item(self, m: "_ModCtx") -> Optional[Element]:
        doc = self._xml(os.path.join(m.directory, "grades.xml"))
        items = list(doc.iter("grade_item")) if doc is not None else []
        for it in items:
            if (_t(it, "itemnumber") or "0") == "0":
                return it
        return items[0] if items else None

    def _pass_percent(self, m: "_ModCtx") -> Optional[float]:
        it = self._grade_item(m)
        if it is None:
            return None
        gmax, gpass = to_float(_t(it, "grademax")), to_float(_t(it, "gradepass"))
        if gmax > 0 and gpass > 0:
            return round(min(100.0, gpass / gmax * 100.0), 2)
        return None

    # page / label / book --------------------------------------------------

    def _mod_page(self, m: "_ModCtx") -> list:
        parts: list = []
        intro = self._shown_intro(m)
        if intro is not None:
            parts.append(ir.HtmlPart(intro))
        content = self._field(m.inner, "content", m.ctx, "mod_page", "content")
        if not content.is_empty():
            parts.append(ir.HtmlPart(content))
        return [ir.Page(title=m.title, parts=parts, id=m.mid, visible=m.visible)]

    def _mod_label(self, m: "_ModCtx") -> list:
        intro = self._intro(m)
        if intro.is_empty():
            return []
        title = _first_line(intro.html) or _t(m.inner, "name") or "Label"
        return [ir.Page(title=title, parts=[ir.HtmlPart(intro)], id=m.mid, visible=m.visible)]

    def _mod_book(self, m: "_ModCtx") -> list:
        chapters = sorted(m.inner.iter("chapter"), key=lambda c: (to_int(_t(c, "pagenum")), to_int(_eid(c))))
        groups: list[tuple[Element, list[Element]]] = []
        for ch in chapters:
            if _flag(ch, "subchapter") and groups:
                groups[-1][1].append(ch)
            else:
                groups.append((ch, []))
        intro = self._intro(m)
        show_intro = not intro.is_empty() and m.module is not None and _flag(m.module, "showdescription")
        if not groups:
            parts = [ir.HtmlPart(intro)] if not intro.is_empty() else []
            self.skip(m.title, "book", "empty in the backup")
            return [ir.Page(title=m.title, parts=parts, id=m.mid, visible=m.visible)]
        pages = []
        for index, (chapter, subs) in enumerate(groups):
            chapter_hidden = _flag(chapter, "hidden")
            parts: list = []
            if index == 0 and show_intro:
                parts.append(ir.HtmlPart(intro))
            body = self._field(chapter, "content", m.ctx, "mod_book", "chapter", _eid(chapter))
            if not body.is_empty():
                parts.append(ir.HtmlPart(body))
            for sub in subs:
                if _flag(sub, "hidden") and not chapter_hidden:
                    continue  # hidden from students inside a visible chapter
                parts.append(ir.HeadingPart(_t(sub, "title") or "Untitled", 2))
                sub_body = self._field(sub, "content", m.ctx, "mod_book", "chapter", _eid(sub))
                if not sub_body.is_empty():
                    parts.append(ir.HtmlPart(sub_body))
            chapter_title = _t(chapter, "title") or f"Chapter {index + 1}"
            title = m.title if len(groups) == 1 else f"{m.title}: {chapter_title}"
            pages.append(ir.Page(title=title, parts=parts, id=f"{m.mid}:chapter_{_eid(chapter)}",
                                 visible=m.visible and not chapter_hidden))
        return pages

    # resource / folder / url / imscp ----------------------------------------

    def _html_file(self, rec: _FileRec, ctx: str, component: str, filearea: str, itemid: Optional[str]
                   ) -> Optional[ir.RichText]:
        if not os.path.isfile(rec.path):
            return None
        html = _read_text_file(rec.path)
        return ir.RichText(_clean_html(html), self.files.resolver([(component, filearea, itemid)], ctx,
                                                                   rec.filepath))

    def _mod_resource(self, m: "_ModCtx") -> list:
        recs = self.files.area("mod_resource", "content", None, m.ctx)
        if not recs:
            return [ir.UnsupportedItem(title=m.title, kind="resource", reason="the file is missing from the backup",
                                       id=m.mid)]
        main = max(enumerate(recs), key=lambda ir_: (ir_[1].sortorder, -ir_[0]))[1]
        return self._file_items(m.title, m.mid, m.visible, self.files.asset(main), self._shown_intro(m),
                                lambda: self._html_file(main, m.ctx, "mod_resource", "content", None))

    def _mod_folder(self, m: "_ModCtx") -> list:
        parts: list = []
        intro = self._intro(m)
        if not intro.is_empty():
            parts.append(ir.HtmlPart(intro))
        recs = self.files.area("mod_folder", "content", None, m.ctx)
        if not recs:
            self.skip(m.title, "folder", "empty in the backup")
        parts.extend(self._folder_parts([(r.filepath, self.files.asset(r)) for r in recs]))
        return [ir.Page(title=m.title, parts=parts, id=m.mid, visible=m.visible)]

    def _mod_url(self, m: "_ModCtx") -> list:
        return self._url_items(m.title, m.mid, m.visible, _t(m.inner, "externalurl"), self._shown_intro(m))

    def _mod_imscp(self, m: "_ModCtx") -> list:
        revision = _t(m.inner, "revision")
        recs = self.files.area("mod_imscp", "content", None, m.ctx)
        if revision and any(r.itemid == revision for r in recs):
            recs = [r for r in recs if r.itemid == revision]
        if not recs:
            return [ir.UnsupportedItem(title=m.title, kind="imscp", reason="the content package is missing",
                                       id=m.mid)]
        itemid = recs[0].itemid
        by_full = {r.full.lower(): r for r in recs}
        targets: list[tuple[str, _FileRec]] = []
        manifest = by_full.get("/imsmanifest.xml")
        doc = _parse(manifest.path) if manifest is not None else None
        if doc is not None:
            resources = {res.get("identifier"): res for res in doc.iter("resource")}
            for item in doc.iter("item"):
                res = resources.get(item.get("identifierref") or "")
                href = (res.get("href") or "") if res is not None else ""
                if not href:
                    continue
                full = "/" + posixpath.normpath(unquote(href.split("#")[0].split("?")[0])).lstrip("/")
                rec = by_full.get(full.lower())
                if rec is not None:
                    targets.append((_t(item, "title") or slug_title(rec.filename), rec))
        if not targets:
            first_html = next((r for r in recs if os.path.splitext(r.filename)[1].lower().lstrip(".")
                               in _HTML_EXTS), None)
            if first_html is not None:
                targets.append((m.title, first_html))
        items: list = []
        for index, (item_title, rec) in enumerate(targets):
            title = m.title if len(targets) == 1 else item_title
            items.extend(self._file_items(
                title, f"{m.mid}:{index}", m.visible, self.files.asset(rec), None,
                lambda rec=rec: self._html_file(rec, m.ctx, "mod_imscp", "content", itemid)))
        if not items:
            return [ir.UnsupportedItem(title=m.title, kind="imscp", reason="no page to show in the content package",
                                       id=m.mid)]
        return items

    # quiz -----------------------------------------------------------------

    def _mod_quiz(self, m: "_ModCtx") -> list:
        q = m.inner
        timelimit = to_int(_t(q, "timelimit"))
        shuffle = _flag(q, "shufflequestions") or any(
            _flag(s, "shufflequestions") for s in q.iter("section"))
        review = to_int(_t(q, "reviewrightanswer"))
        assessment = ir.Assessment(
            title=m.title,
            intro=self._intro(m),
            due_date=iso_from_timestamp(_t(q, "timeclose")) or iso_from_timestamp(_t(q, "duedate")),
            max_attempts=max(0, to_int(_t(q, "attempts_number"))),
            pass_percent=self._pass_percent(m),
            show_correct_answers=bool(review & _REVIEW_AFTER_ATTEMPT),
            graded=to_float(_t(q, "grade"), 10.0) > 0,
            time_limit_minutes=-(-timelimit // 60) if timelimit > 0 else None,
            shuffle=shuffle,
            id=m.mid,
            visible=m.visible,
        )
        assessment.questions = self._quiz_questions(q, m.title)
        return [assessment]  # an empty quiz is reported by the package writer

    def _quiz_questions(self, quiz: Element, title: str) -> list[ir.Question]:
        instances = list(quiz.iter("question_instance"))
        legacy_order = [x.strip() for x in (_t(quiz, "questions") or "").split(",") if x.strip() not in ("", "0")]

        def key(inst_index):
            index, inst = inst_index
            slot = _t(inst, "slot")
            if slot:
                return (to_int(slot), index)
            qid = _t(inst, "questionid") or _t(inst, "question")
            return (legacy_order.index(qid) if qid in legacy_order else len(legacy_order) + index, index)

        out: list[ir.Question] = []
        used: set[str] = set()

        def add(qel: Element, points: Optional[float]):
            qid = _eid(qel)
            if qid in used:
                return
            used.add(qid)
            out.append(self.questions.convert(qel, points))

        # A random slot becomes the whole pool of its category (a documented
        # difference); only a category with nothing to draw from is reported
        random_pools: dict[str, int] = {}  # category -> drawable questions

        def add_random(cid: str, subcats: bool, points: Optional[float]):
            drawable = self.bank.drawable(cid, subcats)
            random_pools[cid] = max(random_pools.get(cid, 0), len(drawable))
            for p in drawable:
                if _eid(p) not in used:
                    add(p, points)

        for _index, inst in sorted(enumerate(instances), key=key):
            points = to_float(_t(inst, "maxmark") or _t(inst, "grade"), 0.0) or None
            ref = inst.find("question_reference")
            sref = inst.find("question_set_reference")
            if ref is not None:
                qel = self.bank.entry_question(_t(ref, "questionbankentryid"), to_int(_t(ref, "version")) or None)
                if qel is None:
                    self.warn(f"Quiz \"{title}\": a question is missing from the question bank backup")
                    continue
                add(qel, points)
                continue
            if sref is not None:
                cid, subcats = _filter_category(_raw(sref, "filtercondition"))
                if cid:
                    add_random(cid, subcats, points)
                else:
                    self.warn(f"Quiz \"{title}\": a random question has an unreadable filter")
                continue
            qid = _t(inst, "questionid") or _t(inst, "question")
            qel = self.bank.question(qid)
            if qel is None:
                self.warn(f"Quiz \"{title}\": question {qid} is missing from the question bank backup")
                continue
            if _t(qel, "qtype") == "random":
                add_random(self.bank.category_of(qid), _t(qel, "questiontext") == "1", points)
            else:
                add(qel, points)
        for cid, drawable in random_pools.items():
            if not drawable:
                self.skip(title, "random question",
                          f"category '{self.bank.category_name(cid)}' is missing from the backup or empty")
        return out

    # lesson / glossary ----------------------------------------------------

    def _mod_lesson(self, m: "_ModCtx") -> list:
        parts: list = []
        intro = self._shown_intro(m)
        if intro is not None:
            parts.append(ir.HtmlPart(intro))
        parts.extend(self._lesson_parts(
            m.inner, lambda html, area, itemid: self.rich(html, m.ctx, [("mod_lesson", area, itemid)])))
        return [ir.Page(title=m.title, parts=parts, id=m.mid, visible=m.visible)]

    def _mod_glossary(self, m: "_ModCtx") -> list:
        def definition(e: Element) -> str:
            return _format_html(_raw(e, "definition"), _t(e, "definitionformat") or "1")
        return [self._glossary_page(m.title, m.mid, m.visible, self._intro(m), list(m.inner.iter("entry")),
                                    definition)]

    # assign / workshop ----------------------------------------------------

    def _mod_assign(self, m: "_ModCtx") -> list:
        a = m.inner
        enabled = {}
        for pc in a.iter("plugin_config"):
            if _t(pc, "subtype") == "assignsubmission" and _t(pc, "name") == "enabled":
                enabled[_t(pc, "plugin")] = _flag(pc, "value")
        html = _format_html(_raw(a, "intro"), _t(a, "introformat") or "1")
        activity = _format_html(_raw(a, "activity"), _t(a, "activityformat") or "1")
        if activity.strip():
            html = html + activity
        instructions = self.rich(html, m.ctx, [("mod_assign", "intro", None), ("mod_assign", "activityattachment",
                                                                                 None)])
        grade = to_float(_t(a, "grade"), 100.0)  # negative: a scale, imported as percentage grading
        allow_file, allow_text = enabled.get("file", False), enabled.get("onlinetext", False)
        # No online submission in Moodle (offline work): file upload stands in for it
        attachments = [self.files.asset(r) for r in self.files.area("mod_assign", "introattachment", None, m.ctx)]
        return [ir.AssignmentItem(
            title=m.title, instructions=instructions,
            due_date=iso_from_timestamp(_t(a, "duedate")) or iso_from_timestamp(_t(a, "cutoffdate")),
            allow_file=allow_file or not allow_text, allow_text=allow_text,
            points=grade if grade > 0 else None, pass_percent=self._pass_percent(m), graded=grade != 0,
            attachments=attachments, id=m.mid, visible=m.visible,
        )]

    def _mod_assignment(self, m: "_ModCtx") -> list:
        """mod_assignment, the assignment module before Moodle 2.3 (still found in 2.x backups)."""
        a = m.inner
        atype = _t(a, "assignmenttype")  # offline work becomes a file upload
        grade = to_float(_t(a, "grade"), 100.0)
        return [ir.AssignmentItem(
            title=m.title, instructions=self._intro(m),
            due_date=iso_from_timestamp(_t(a, "timedue")) or iso_from_timestamp(_t(a, "duedate")),
            allow_file=atype != "online", allow_text=atype == "online", points=grade if grade > 0 else None,
            pass_percent=self._pass_percent(m), graded=grade != 0, id=m.mid, visible=m.visible,
        )]

    def _mod_workshop(self, m: "_ModCtx") -> list:
        w = m.inner
        html = _format_html(_raw(w, "intro"), _t(w, "introformat") or "1")
        authors = _format_html(_raw(w, "instructauthors"), _t(w, "instructauthorsformat") or "1")
        if authors.strip():
            html += authors
        instructions = self.rich(html, m.ctx, [("mod_workshop", "intro", None),
                                               ("mod_workshop", "instructauthors", None)])
        text_mode, file_mode = _t(w, "submissiontypetext"), _t(w, "submissiontypefile")
        allow_text = text_mode != "0" if text_mode else True
        allow_file = file_mode != "0" if file_mode else to_int(_t(w, "nattachments")) > 0
        grade = to_float(_t(w, "grade"), 80.0)
        # Becomes a plain assignment: peer assessment is a documented difference
        return [ir.AssignmentItem(
            title=m.title, instructions=instructions, due_date=iso_from_timestamp(_t(w, "submissionend")),
            allow_file=allow_file or not allow_text, allow_text=allow_text, points=grade if grade > 0 else None,
            graded=grade > 0, id=m.mid, visible=m.visible,
        )]

    # scorm / h5p / polls / wiki / subsection ---------------------------------

    def _mod_scorm(self, m: "_ModCtx") -> list:
        s = m.inner
        scormtype = _t(s, "scormtype") or "local"
        if scormtype != "local":
            return [ir.UnsupportedItem(title=m.title, kind="scorm",
                                       reason=f"{scormtype} SCORM packages are not stored in the backup", id=m.mid)]
        recs = self.files.area("mod_scorm", "package", None, m.ctx)
        reference = _t(s, "reference")
        pkg = next((r for r in recs if r.filename == reference), recs[0] if recs else None)
        if pkg is None:
            return [ir.UnsupportedItem(title=m.title, kind="scorm", reason="the package is missing from the backup",
                                       id=m.mid)]
        return [ir.ScormItem(title=m.title, package=self.files.asset(pkg), id=m.mid, visible=m.visible)]

    def _mod_choice(self, m: "_ModCtx") -> list:
        options = [_plain(_raw(o, "text")) for o in m.inner.iter("option") if _plain(_raw(o, "text"))]
        return [self._poll_page(m.title, m.mid, m.visible, self._intro(m), [("", options)])]

    def _mod_feedback(self, m: "_ModCtx") -> list:
        questions = []
        for item in sorted(m.inner.iter("item"), key=lambda i: to_int(_t(i, "position"))):
            typ = _t(item, "typ")
            presentation = _raw(item, "presentation")
            if typ in ("pagebreak", "captcha"):
                continue
            if typ == "label":
                questions.append((presentation, []))
                continue
            options: list[str] = []
            if typ in ("multichoice", "multichoicerated"):
                body = presentation.split(">>>>>", 1)[-1].split("<<<<<", 1)[0]
                options = [_plain(o.split("####", 1)[-1]) for o in body.split("|") if _plain(o.split("####", 1)[-1])]
            questions.append((html_lib.escape(_t(item, "name")), options))
        return [self._poll_page(m.title, m.mid, m.visible, self._intro(m), questions)]

    def _mod_survey(self, m: "_ModCtx") -> list:
        # Built-in questionnaires (COLLES, ATTLS...) are not part of the backup
        self.skip(m.title, "survey", "its built-in questions are not in the backup")
        return [self._poll_page(m.title, m.mid, m.visible, self._intro(m), [])]

    def _mod_questionnaire(self, m: "_ModCtx") -> list:
        questions = []
        for qu in m.inner.iter("question"):
            if _flag(qu, "deleted") or _t(qu, "deleted") == "y":
                continue
            content = _raw(qu, "content")
            options = [_plain(_raw(c, "content")) for c in qu.iter("quest_choice") if _plain(_raw(c, "content"))]
            if _plain(content) or options:
                questions.append((content, options))
        return [self._poll_page(m.title, m.mid, m.visible, self._intro(m), questions)]

    def _mod_wiki(self, m: "_ModCtx") -> list:
        first = _t(m.inner, "firstpagetitle")
        parts: list = []
        intro = self._intro(m)
        if not intro.is_empty():
            parts.append(ir.HtmlPart(intro))
        found = 0
        for sub in m.inner.iter("subwiki"):
            pages = sorted(sub.iter("page"), key=lambda p: (_t(p, "title") != first, to_int(_eid(p))))
            for page in pages:
                html = _raw(page, "cachedcontent")
                if not html.strip():
                    versions = sorted(page.iter("version"), key=lambda v: to_int(_t(v, "version")))
                    html = _raw(versions[-1], "content") if versions else ""
                parts.append(ir.HeadingPart(_t(page, "title") or "Page", 2))
                parts.append(ir.HtmlPart(self.rich(html, m.ctx, [("mod_wiki", "attachments", _eid(sub))])))
                found += 1
        if not found:
            return [ir.UnsupportedItem(title=m.title, kind="wiki", reason=_UNSUPPORTED_REASONS["wiki"], id=m.mid)]
        return [ir.Page(title=m.title, parts=parts, id=m.mid, visible=m.visible)]

    def _mod_subsection(self, m: "_ModCtx") -> list:
        section = self.delegated.get(_eid(m.inner))
        if section is None or m.depth > 3:
            return [ir.UnsupportedItem(title=m.title, kind="subsection", reason="the subsection is empty", id=m.mid)]
        visible = m.visible and _flag(section, "visible", True)
        items: list = []
        summary = self._field(section, "summary", self.course_ctx, "course", "section", _eid(section))
        if not summary.is_empty():
            items.append(ir.Page(title=m.title, parts=[ir.HtmlPart(summary)], id=f"{m.mid}:summary",
                                 visible=visible))
        items.extend(self._section_items(section, visible, m.depth + 1))
        return items


@dataclass
class _ModCtx:
    act: _Activity
    directory: str
    module: Optional[Element]
    inner: Element
    ctx: str
    mid: str
    title: str
    visible: bool
    depth: int


def _filter_category(raw: str) -> tuple[str, bool]:
    """(category id, include subcategories) from a question_set_reference filter."""
    try:
        data = json.loads(html_lib.unescape(raw or "") or "{}")
    except ValueError:
        return "", False
    if not isinstance(data, dict):
        return "", False
    if data.get("questioncategoryid"):  # Moodle 4.0 - 4.2
        sub = data.get("includingsubcategories", data.get("includesubcategories", False))
        return str(data["questioncategoryid"]), to_bool(sub)
    cat = ((data.get("filter") or {}).get("category") or {}) if isinstance(data.get("filter"), dict) else {}
    values = cat.get("values") if isinstance(cat, dict) else None
    if isinstance(values, list) and values and isinstance(values[0], (str, int)):
        options = cat.get("filteroptions")
        sub = options.get("includesubcategories", False) if isinstance(options, dict) else False
        return str(values[0]), to_bool(sub)
    if data.get("cat"):
        return str(data["cat"]).split(",")[0], False
    return "", False


# ---------------------------------------------------------------------------
# Moodle 1.9
# ---------------------------------------------------------------------------


class _LegacyReader(_Base):
    def __init__(self, root: str):
        self.root = root
        self.index = FileIndex(root)
        self.course = ir.Course(title="", source=KEY)
        self.resolve = make_resolver(self.index, "course_files", extra=self._legacy_url)

    def _legacy_url(self, url: str) -> Optional[ir.Asset]:
        u = html_lib.unescape(url or "")
        if "$@FILEPHP@$" not in u:
            return None
        rel = u.split("$@FILEPHP@$", 1)[1].replace("$@SLASH@$", "/")
        rel = unquote(re.split(r"[?#]", rel, maxsplit=1)[0])
        full = self.index.get(f"course_files/{rel}")
        return self.index.asset(full)

    def rich(self, html: str, fmt: str = "1") -> ir.RichText:
        html = _clean_html(_format_html(html, fmt))
        return ir.RichText(html, self.resolve) if html.strip() else ir.RichText("")

    def _course_file(self, ref: str) -> Optional[ir.Asset]:
        full = self.index.get(f"course_files/{ref}")
        return self.index.asset(full)

    def read(self) -> ir.Course:
        doc = self._xml(os.path.join(self.root, "moodle.xml"))
        if doc is None:
            raise ValueError("moodle.xml is not readable XML")
        doc = _lowercase_tags(doc)
        token = _LANG.set(_t(doc, "course/header/lang").replace("_utf8", ""))
        try:
            return self._read(doc)
        finally:
            _LANG.reset(token)

    def _read(self, doc: Element) -> ir.Course:
        course_el = doc.find("course")
        header = course_el.find("header") if course_el is not None else None
        c = self.course
        c.title = _t(header, "fullname") or "Moodle course"
        c.short_name = _t(header, "shortname")
        c.id = _t(header, "id")
        c.summary = self.rich(_raw(header, "summary"))
        c.language = _t(header, "lang")
        self.format = _t(header, "format")

        cats = list(course_el.iter("question_category")) if course_el is not None else []
        self.bank = _Bank(cats)
        self.questions = _Questions(self.bank, lambda html, *_a: self.rich(html))

        self.modules: dict[tuple[str, str], Element] = {}
        mods_el = course_el.find("modules") if course_el is not None else None
        for mod in children(mods_el, "mod"):
            self.modules[(_t(mod, "modtype"), _t(mod, "id"))] = mod

        sections_el = course_el.find("sections") if course_el is not None else None
        sections = sorted(children(sections_el, "section"), key=lambda s: to_int(_t(s, "number")))
        for s in sections:
            number = to_int(_t(s, "number"))
            visible = _flag(s, "visible", True)
            title = "General" if number == 0 else (f"Topic {number}" if self.format != "weeks" else f"Week {number}")
            section = ir.Section(title=title, summary=self.rich(_raw(s, "summary")), id=f"section_{_t(s, 'id')}",
                                 visible=visible)
            last_label: Optional[ir.Page] = None
            mods = s.find("mods")
            for cm in children(mods, "mod"):
                modtype = _t(cm, "type")
                mod = self.modules.get((modtype, _t(cm, "instance")))
                if mod is None:
                    self.skip(modtype or "Untitled", modtype, "missing from the backup")
                    continue
                mvisible = visible and _flag(cm, "visible", True)
                mid = f"{modtype}_{_t(cm, 'id')}"
                title = _t(mod, "name") or modtype
                try:
                    items = self._module(modtype, mod, title, mid, mvisible)
                except Exception as e:
                    self.warn(f"Could not read {modtype} \"{title}\": {error_text(e)}")
                    continue
                if modtype == "label" and items and last_label is not None and last_label.visible == mvisible:
                    last_label.parts.extend(items[0].parts)
                    continue
                last_label = items[0] if modtype == "label" and items else None
                section.items.extend(items)
            c.sections.append(section)
        return c

    def _module(self, modtype: str, mod: Element, title: str, mid: str, visible: bool) -> list:
        if modtype == "label":
            content = self.rich(_raw(mod, "content"))
            if content.is_empty():
                return []
            return [ir.Page(title=_first_line(content.html) or title, parts=[ir.HtmlPart(content)], id=mid,
                            visible=visible)]
        if modtype == "resource":
            return self._resource(mod, title, mid, visible)
        if modtype == "quiz":
            return [self._quiz(mod, title, mid, visible)]
        if modtype == "assignment":
            atype = _t(mod, "assignmenttype")
            grade = to_float(_t(mod, "grade"), 100.0)
            return [ir.AssignmentItem(
                title=title, instructions=self.rich(_raw(mod, "description"), _t(mod, "format") or "1"),
                due_date=iso_from_timestamp(_t(mod, "timedue")), allow_file=atype != "online",
                allow_text=atype == "online", points=grade if grade > 0 else None, graded=grade != 0, id=mid,
                visible=visible)]
        if modtype == "glossary":
            return [self._glossary_page(title, mid, visible, self.rich(_raw(mod, "intro")),
                                        list(mod.iter("entry")), lambda e: _raw(e, "definition"))]
        if modtype == "book":
            parts: list = []
            for ch in sorted(mod.iter("chapter"), key=lambda c: to_int(_t(c, "pagenum"))):
                if _flag(ch, "hidden"):
                    continue
                parts.append(ir.HeadingPart(_t(ch, "title") or "Untitled", 3 if _flag(ch, "subchapter") else 2))
                parts.append(ir.HtmlPart(self.rich(_raw(ch, "content"))))
            return [ir.Page(title=title, parts=parts, id=mid, visible=visible)]
        if modtype == "lesson":
            return [ir.Page(title=title, parts=self._lesson_parts(mod, lambda html, _a, _i: self.rich(html)), id=mid,
                            visible=visible)]
        if modtype == "scorm":
            pkg = self._course_file(_t(mod, "reference"))
            if pkg is None:
                return [ir.UnsupportedItem(title=title, kind="scorm", reason="the package is missing from the backup",
                                           id=mid)]
            return [ir.ScormItem(title=title, package=pkg, id=mid, visible=visible)]
        if modtype == "choice":
            options = [_plain(_raw(o, "text")) for o in mod.iter("option") if _plain(_raw(o, "text"))]
            return [self._poll_page(title, mid, visible, self.rich(_raw(mod, "text")), [("", options)])]
        reason = _UNSUPPORTED_REASONS.get(modtype, f"'{modtype}' activities are not migrated")
        return [ir.UnsupportedItem(title=title, kind=modtype, reason=reason, id=mid)]

    def _resource(self, mod: Element, title: str, mid: str, visible: bool) -> list:
        rtype = _t(mod, "type")
        reference = _t(mod, "reference")
        summary = self.rich(_raw(mod, "summary"))
        intro = summary if not summary.is_empty() else None
        if rtype in ("html", "text"):
            body = self.rich(_raw(mod, "alltext"), "1" if rtype == "html" else "2")
            parts = ([ir.HtmlPart(summary)] if intro else []) + [ir.HtmlPart(body)]
            return [ir.Page(title=title, parts=parts, id=mid, visible=visible)]
        if rtype == "directory":
            prefix = f"course_files/{reference.strip('/')}".rstrip("/") + "/"
            files = []
            base_dir = safe_join(self.root, prefix)
            for dirpath, dirnames, filenames in os.walk(base_dir) if base_dir and os.path.isdir(base_dir) else []:
                dirnames.sort()
                rel_dir = os.path.relpath(dirpath, base_dir).replace(os.sep, "/")
                sub = "/" if rel_dir == "." else f"/{rel_dir}/"
                for name in sorted(filenames):
                    files.append((sub, self.index.asset(os.path.join(dirpath, name))))
            parts = ([ir.HtmlPart(summary)] if intro else []) + self._folder_parts(files)
            if not files:
                self.skip(title, "folder", "empty in the backup")
            return [ir.Page(title=title, parts=parts, id=mid, visible=visible)]
        if rtype == "file":
            if re.match(r"^[a-z][a-z0-9+.-]*://", reference, re.I):
                return self._url_items(title, mid, visible, reference, intro)
            asset = self._course_file(reference)
            if asset is None:
                return [ir.UnsupportedItem(title=title, kind="resource", reason="the file is missing from the backup",
                                           id=mid)]
            base = posixpath.dirname(f"course_files/{reference}")

            def load() -> Optional[ir.RichText]:
                return ir.RichText(_clean_html(_read_text_file(asset.path)), make_resolver(self.index, base,
                                                                                          extra=self._legacy_url))
            return self._file_items(title, mid, visible, asset, intro, load)
        return [ir.UnsupportedItem(title=title, kind="resource", reason=f"'{rtype}' resources are not converted",
                                   id=mid)]

    def _quiz(self, mod: Element, title: str, mid: str, visible: bool) -> ir.Assessment:
        timelimit = to_int(_t(mod, "timelimit"))  # minutes in 1.9
        assessment = ir.Assessment(
            title=title, intro=self.rich(_raw(mod, "intro")), due_date=iso_from_timestamp(_t(mod, "timeclose")),
            max_attempts=max(0, to_int(_t(mod, "attempts_number"))), graded=to_float(_t(mod, "grade"), 10.0) > 0,
            time_limit_minutes=timelimit or None, shuffle=_flag(mod, "shufflequestions"), id=mid,
            visible=visible,
        )
        instances = list(mod.iter("question_instance"))
        grades = {_t(i, "question"): to_float(_t(i, "grade"), 0.0) for i in instances}
        by_instance = {_t(i, "id"): _t(i, "question") for i in instances}
        order = [x.strip() for x in (_t(mod, "questions") or "").split(",") if x.strip() not in ("", "0")]
        # Some exporters list instance ids instead of question ids
        order = [qid if self.bank.question(qid) is not None or qid not in by_instance else by_instance[qid]
                 for qid in order]
        for qid in order or list(grades):
            qel = self.bank.question(qid)
            if qel is None:
                self.warn(f"Quiz \"{title}\": question {qid} is missing from the backup")
                continue
            if _t(qel, "qtype") == "random":
                # Expanded to the whole category, as in 2.x
                pool = self.bank.drawable(self.bank.category_of(qid), _t(qel, "questiontext") == "1")
                existing = {q.id for q in assessment.questions}
                for p in pool:
                    if f"question_{_eid(p)}" not in existing:
                        assessment.questions.append(self.questions.convert(p, grades.get(qid) or None))
                continue
            assessment.questions.append(self.questions.convert(qel, grades.get(qid) or None))
        return assessment
