"""
XML helpers for export metadata.

Exports are untrusted, so parsing goes through defusedxml (no entity
expansion, no external DTDs). Namespaces are stripped from tags and attribute
names on load: every LMS ships several revisions of the same schemas (IMS CC
1.0 to 1.3, QTI dialects) and readers only care about local names.
"""

from __future__ import annotations

import math
import os
import re
from typing import Iterable, Optional
from xml.etree.ElementTree import Element

from defusedxml import ElementTree as SafeET

# XML 1.0 forbids most C0 control characters, but real exports contain them
_INVALID_XML_CHARS = re.compile(rb"[\x00-\x08\x0b\x0c\x0e-\x1f]")
# ... and the same characters written as character references (&#8; &#x1B;)
_INVALID_CHAR_REFS = re.compile(rb"&#(?:0*(?:[0-8]|1[124-9]|2[0-9]|3[01])|[xX]0*(?:[0-8bBcCeEfF]|1[0-9a-fA-F]));")
_UTF16_BOMS = (b"\xff\xfe", b"\xfe\xff")
_XML_DECL_ENCODING = re.compile(r"""^(\s*<\?xml[^>]*?)\s+encoding\s*=\s*["'][^"']*["']""")


class XmlError(Exception):
    pass


class FileTooLarge(XmlError, OSError):
    """A file of the export is bigger than the reader will load into memory."""


# Whole files are read into memory to be parsed; a crafted export must not
# make one read take the API process down. Real exports stay far below:
# Moodle's largest XML (questions.xml of a big course bank) is tens of MB.
MAX_XML_BYTES = 256 * 1024 * 1024
MAX_TEXT_BYTES = 32 * 1024 * 1024


def read_limited(path: str, limit: int = MAX_XML_BYTES) -> bytes:
    if os.path.getsize(path) > limit:
        raise FileTooLarge(f"{os.path.basename(path)} is larger than {limit // (1024 * 1024)} MB")
    with open(path, "rb") as f:
        return f.read(limit + 1)[:limit]


def _strip_ns(el: Element) -> Element:
    for node in el.iter():
        if isinstance(node.tag, str) and "}" in node.tag:
            node.tag = node.tag.split("}", 1)[1]
        if node.attrib:
            for key in list(node.attrib):
                if "}" in key:
                    local = key.split("}", 1)[1]
                    # Keep both: xml:lang and xlink:href style lookups
                    node.attrib.setdefault(local, node.attrib[key])
    return el


def _clean(data: bytes) -> bytes:
    if data.startswith(_UTF16_BOMS):
        # Stripping NUL bytes would corrupt UTF-16, so re-encode as UTF-8 first
        try:
            text = data.decode("utf-16")
        except UnicodeDecodeError:
            return data
        data = _XML_DECL_ENCODING.sub(r"\1", text, count=1).encode("utf-8")
    return _INVALID_CHAR_REFS.sub(b"", _INVALID_XML_CHARS.sub(b"", data))


_NAMED_ENTITY = re.compile(rb"&([A-Za-z][A-Za-z0-9]{1,31});")
_XML_ENTITIES = {b"amp", b"lt", b"gt", b"quot", b"apos"}


def _numeric_entities(data: bytes) -> bytes:
    """``&nbsp;`` -> ``&#160;``: HTML named entities XML parsers do not know."""
    from html.entities import name2codepoint

    def repl(m: re.Match) -> bytes:
        name = m.group(1)
        if name in _XML_ENTITIES or name.decode("ascii") not in name2codepoint:
            return m.group(0)
        return b"&#%d;" % name2codepoint[name.decode("ascii")]

    return _NAMED_ENTITY.sub(repl, data)


# "&" that does not start a character or entity reference ("Hospitality & Tourism")
_BARE_AMP = re.compile(rb"&(?!#[0-9]+;|#[xX][0-9a-fA-F]+;|[A-Za-z_][A-Za-z0-9._-]*;)")


def parse_bytes(data: bytes) -> Element:
    data = _clean(data)
    try:
        return _strip_ns(SafeET.fromstring(data))
    except Exception as e:  # ParseError and defusedxml's DTD/entity refusals
        message = str(e).lower()
        # Exporters write HTML entities (&nbsp;, Moodle) or a bare "&" (D2L
        # manifest metadata) into XML: repair those once before giving up
        if "undefined entity" in message or "not well-formed" in message:
            repaired = _BARE_AMP.sub(b"&amp;", _numeric_entities(data))
            if repaired != data:
                try:
                    return _strip_ns(SafeET.fromstring(repaired))
                except Exception as e2:
                    raise XmlError(str(e2)) from e2
        raise XmlError(str(e)) from e


def parse_file(path: str) -> Element:
    return parse_bytes(read_limited(path))


def try_parse_file(path: str) -> Optional[Element]:
    try:
        return parse_file(path)
    except (OSError, XmlError):
        return None


def local(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def text(el: Optional[Element], path: str = "", default: str = "") -> str:
    """Text of ``el.find(path)`` (or ``el``), stripped; ``default`` if missing."""
    if el is None:
        return default
    node = el.find(path) if path else el
    if node is None or node.text is None:
        return default
    return node.text.strip()


def inner_text(el: Optional[Element]) -> str:
    """All text under ``el``, concatenated."""
    if el is None:
        return ""
    return "".join(el.itertext()).strip()


def attr(el: Optional[Element], name: str, default: str = "") -> str:
    if el is None:
        return default
    value = el.get(name)
    return value if value is not None else default


def children(el: Optional[Element], tag: str) -> list[Element]:
    if el is None:
        return []
    return [c for c in el if c.tag == tag]


def first(items: Iterable[Element]) -> Optional[Element]:
    for item in items:
        return item
    return None


def to_int(value, default: int = 0) -> int:
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError, OverflowError):
        return default


def to_float(value, default: float = 0.0) -> float:
    try:
        result = float(str(value).strip())
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def to_bool(value, default: bool = False) -> bool:
    if value is None:
        return default
    v = str(value).strip().lower()
    if v in ("1", "true", "yes", "y", "on"):
        return True
    if v in ("0", "false", "no", "n", "off", ""):
        return False
    return default
