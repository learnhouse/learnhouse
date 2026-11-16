"""What kind of file a learner handed in, and its readable text.

Core (OSS) counterpart of the Atlas file reader, which lives in EE and so
cannot be imported here. Same approach: the kind comes from the bytes, never
only the name; text comes out of PDF (via the RAG ``pdf_pages`` helper), Word,
PowerPoint, Excel, HTML, plain text and code, and the text files inside a zip.
Images, audio and video have no text here: the grader sends images to the
model as images and transcribes the media.

Office XML is parsed with defusedxml and every zip member is size-capped, so a
crafted document cannot blow up memory.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass

from defusedxml import ElementTree as SafeET

MAX_CHARS = 60_000
MAX_XML_BYTES = 30 * 1024 * 1024
MAX_ZIP_ENTRIES = 200
MAX_ZIP_MEMBER_BYTES = 5 * 1024 * 1024
MAX_SHEET_ROWS = 400

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

TEXT_EXTS = {
    "txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml", "xml", "html", "htm",
    "py", "js", "ts", "tsx", "jsx", "css", "sql", "sh", "rb", "go", "rs", "java", "kt",
    "swift", "c", "h", "cpp", "hpp", "cs", "php", "toml", "ini", "log", "srt", "vtt", "tex", "r",
}


@dataclass
class Extracted:
    text: str = ""
    truncated: bool = False
    pages: int | None = None
    note: str | None = None


def _ext(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in (name or "") else ""


def _decode_text(data: bytes) -> str | None:
    """UTF-8 (or UTF-16 with a BOM) text, or None when the bytes are binary."""
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            return data.decode("utf-16")
        except UnicodeDecodeError:
            return None
    if b"\x00" in data[:4096]:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def sniff(data: bytes, name: str) -> tuple[str, str]:
    """(kind, mime). Kinds: pdf, image, audio, video, document, slides,
    spreadsheet, archive, html, text, unknown."""
    head = data[:16]
    if head.startswith(b"%PDF-"):
        return "pdf", "application/pdf"
    if head.startswith(b"\xff\xd8\xff"):
        return "image", "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image", "image/png"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image", "image/gif"
    if head.startswith(b"RIFF") and head[8:12] == b"WEBP":
        return "image", "image/webp"
    if head.startswith(b"RIFF") and head[8:12] == b"WAVE":
        return "audio", "audio/wav"
    if head.startswith(b"ID3") or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "audio", "audio/mpeg"
    if head.startswith(b"OggS"):
        return "audio", "audio/ogg"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "video", "video/webm"
    if head[4:8] == b"ftyp":
        if head[8:12].startswith(b"M4A") or _ext(name) == "m4a":
            return "audio", "audio/mp4"
        return "video", "video/mp4"
    if head.startswith((b"PK\x03\x04", b"PK\x05\x06")):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                names = set(z.namelist())
        except zipfile.BadZipFile:
            return "unknown", "application/octet-stream"
        if "word/document.xml" in names:
            return "document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if "ppt/presentation.xml" in names:
            return "slides", "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        if "xl/workbook.xml" in names:
            return "spreadsheet", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        return "archive", "application/zip"
    text = _decode_text(data)
    if text is None:
        return "unknown", "application/octet-stream"
    if _ext(name) in ("html", "htm") or text.lstrip()[:200].lower().startswith(("<!doctype html", "<html")):
        return "html", "text/html"
    return "text", "text/plain"


def _cap(parts: list[str], limit: int = MAX_CHARS) -> tuple[str, bool]:
    text = "\n".join(p for p in parts if p).strip()
    if len(text) <= limit:
        return text, False
    return text[:limit], True


def _member(z: zipfile.ZipFile, name: str, limit: int = MAX_XML_BYTES) -> bytes | None:
    try:
        info = z.getinfo(name)
    except KeyError:
        return None
    if info.file_size > limit:
        return None
    return z.read(info)


def _xml(data: bytes | None):
    return SafeET.fromstring(data) if data else None


def _pdf(data: bytes) -> Extracted:
    from src.services.ai.rag.formats import pdf_pages

    pages = pdf_pages(data, max_chars=MAX_CHARS)
    try:
        from pypdf import PdfReader

        count = len(PdfReader(io.BytesIO(data)).pages)
    except Exception:
        count = None
    text, truncated = _cap([f"--- Page {n} ---\n{t}" for n, t in pages])
    truncated = truncated or sum(len(t) for _, t in pages) >= MAX_CHARS
    return Extracted(
        text=text, truncated=truncated, pages=count,
        note=None if text else "No text layer (a scan or images only).",
    )


def _docx(z: zipfile.ZipFile) -> Extracted:
    root = _xml(_member(z, "word/document.xml"))
    body = root.find(f"{_W}body") if root is not None else None
    parts: list[str] = []
    for block in list(body) if body is not None else []:
        if block.tag == f"{_W}p":
            parts.append("".join(t.text or "" for t in block.iter(f"{_W}t")))
        elif block.tag == f"{_W}tbl":
            for row in block.iter(f"{_W}tr"):
                cells = ["".join(t.text or "" for t in c.iter(f"{_W}t")).strip() for c in row.iter(f"{_W}tc")]
                parts.append(" | ".join(cells))
    text, truncated = _cap(parts)
    return Extracted(text=text, truncated=truncated, note=None if text else "The document has no text.")


def _slide_number(member: str) -> int:
    found = re.search(r"slide(\d+)\.xml$", member)
    return int(found.group(1)) if found else 0


def _pptx(z: zipfile.ZipFile) -> Extracted:
    slides = sorted(
        (m for m in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", m)), key=_slide_number
    )
    parts: list[str] = []
    for member in slides:
        root = _xml(_member(z, member))
        lines = [
            "".join(t.text or "" for t in p.iter(f"{_A}t")).strip()
            for p in (root.iter(f"{_A}p") if root is not None else [])
        ]
        parts.append(f"--- Slide {_slide_number(member)} ---\n" + "\n".join(x for x in lines if x))
    text, truncated = _cap(parts)
    return Extracted(text=text, truncated=truncated, pages=len(slides))


def _xlsx(z: zipfile.ZipFile) -> Extracted:
    strings = _xml(_member(z, "xl/sharedStrings.xml"))
    shared = [
        "".join(t.text or "" for t in si.iter(f"{_S}t"))
        for si in (strings.iter(f"{_S}si") if strings is not None else [])
    ]
    sheets = sorted(m for m in z.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", m))
    parts: list[str] = []
    for member in sheets:
        root = _xml(_member(z, member))
        lines = []
        for row in list(root.iter(f"{_S}row"))[:MAX_SHEET_ROWS] if root is not None else []:
            cells = []
            for c in row.iter(f"{_S}c"):
                v = c.find(f"{_S}v")
                raw = (v.text or "") if v is not None else "".join(t.text or "" for t in c.iter(f"{_S}t"))
                if c.get("t") == "s" and raw.isdigit() and int(raw) < len(shared):
                    raw = shared[int(raw)]
                cells.append(raw.strip())
            if any(cells):
                lines.append(" | ".join(cells))
        parts.append(f"--- {member.rsplit('/', 1)[-1]} ---\n" + "\n".join(lines))
    text, truncated = _cap(parts)
    return Extracted(text=text, truncated=truncated, pages=len(sheets))


def _archive(z: zipfile.ZipFile) -> Extracted:
    infos = [i for i in z.infolist() if not i.is_dir()][:MAX_ZIP_ENTRIES]
    parts = [f"Files in the archive ({len(infos)}):", *(f"- {i.filename}" for i in infos)]
    for info in infos:
        if _ext(info.filename) not in TEXT_EXTS or info.file_size > MAX_ZIP_MEMBER_BYTES:
            continue
        body = _decode_text(z.read(info))
        if body:
            parts.append(f"--- {info.filename} ---\n{body}")
    text, truncated = _cap(parts)
    return Extracted(text=text, truncated=truncated)


def extract(kind: str, data: bytes, name: str) -> Extracted:
    """The readable text of a file of ``kind`` (empty for media and images)."""
    if kind == "pdf":
        return _pdf(data)
    if kind in ("document", "slides", "spreadsheet", "archive"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                return {"document": _docx, "slides": _pptx, "spreadsheet": _xlsx, "archive": _archive}[kind](z)
        except (zipfile.BadZipFile, SafeET.ParseError, ValueError):
            return Extracted(note="The file could not be read.")
    if kind in ("html", "text"):
        text = _decode_text(data) or ""
        if kind == "html":
            from src.services.ai.rag.formats import html_text

            text = html_text(text)
        body, truncated = _cap([text])
        return Extracted(text=body, truncated=truncated)
    return Extracted()
