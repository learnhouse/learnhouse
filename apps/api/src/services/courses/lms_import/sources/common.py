"""Helpers shared by the source readers."""

from __future__ import annotations

import mimetypes
import unicodedata
import os
import re
from typing import Callable, Optional
from urllib.parse import unquote, urlparse

from ..ir import Asset, Resolver

# Placeholders the exporters put in front of package-relative URLs
_PLACEHOLDERS = (
    "$IMS-CC-FILEBASE$", "%24IMS-CC-FILEBASE%24", "$IMS_CC_FILEBASE$", "%24IMS_CC_FILEBASE%24",
    "@X@EmbeddedFile.requestUrlStub@X@", "@X@EmbeddedFile.location@X@", "@X@EmbeddedFile.unsafeHtml@X@",
    "$CANVAS_COURSE_REFERENCE$/files",
)


def _key(path: str) -> str:
    """Lookup key: case-folded and NFC-normalized (macOS zips store NFD names)."""
    return unicodedata.normalize("NFC", path).lower()


class FileIndex:
    """Case-insensitive lookup of files under an extraction root.

    Exports made on Windows or by hand often disagree with their own metadata
    on case ("Images/A.PNG" vs "images/a.png").
    """

    def __init__(self, root: str):
        self.root = os.path.realpath(root)
        self._by_lower: dict[str, str] = {}
        self._by_name: dict[str, list[str]] = {}
        for dirpath, _dirs, files in os.walk(self.root):
            for f in files:
                full = os.path.join(dirpath, f)
                rel = os.path.relpath(full, self.root).replace(os.sep, "/")
                self._by_lower.setdefault(_key(rel), full)
                self._by_name.setdefault(_key(f), []).append(full)

    def get(self, rel: str) -> Optional[str]:
        rel = rel.replace("\\", "/").lstrip("/")
        parts = []
        for p in rel.split("/"):
            if p in ("", "."):
                continue
            if p == "..":
                if parts:
                    parts.pop()
                continue
            parts.append(p)
        if not parts:
            return None
        return self._by_lower.get(_key("/".join(parts)))

    def by_basename(self, name: str) -> list[str]:
        return list(self._by_name.get(_key(name), []))

    def asset(self, full: Optional[str], name: Optional[str] = None) -> Optional[Asset]:
        if not full:
            return None
        name = name or os.path.basename(full)
        return Asset(path=full, name=name, mime=mimetypes.guess_type(name)[0])


def clean_url(url: str) -> str:
    """Strip query/fragment and decode a package-relative URL."""
    url = (url or "").strip()
    for ph in _PLACEHOLDERS:
        url = url.replace(ph, "")
    try:
        parsed = urlparse(url)
    except ValueError:
        return ""
    if parsed.scheme or parsed.netloc:
        return ""
    path = unquote(parsed.path)
    return path.replace("\\", "/")


def make_resolver(index: FileIndex, base_rel_dir: str = "",
                  extra: Optional[Callable[[str], Optional[Asset]]] = None,
                  basename_fallback: bool = True) -> Resolver:
    """Resolver for URLs in a document stored at ``base_rel_dir``.

    Tries, in order: ``extra`` (reader-specific schemes), the URL relative to
    the document, the URL relative to the package root, then a unique file
    with the same name anywhere in the package.
    """

    def resolve(url: str) -> Optional[Asset]:
        if extra is not None:
            found = extra(url)
            if found is not None:
                return found
        rel = clean_url(url)
        if not rel:
            return None
        candidates = []
        if base_rel_dir and not rel.startswith("/"):
            candidates.append(f"{base_rel_dir.rstrip('/')}/{rel}")
        candidates.append(rel)
        for c in candidates:
            full = index.get(c)
            if full:
                return index.asset(full)
        if basename_fallback:
            matches = index.by_basename(os.path.basename(rel))
            if len(matches) == 1:
                return index.asset(matches[0])
        return None

    return resolve


def slug_title(name: str) -> str:
    """Readable title from a file name: "intro_to-python.pdf" -> "Intro to python"."""
    base = os.path.splitext(os.path.basename(name or ""))[0]
    base = re.sub(r"[_\-]+", " ", base).strip()
    return base[:1].upper() + base[1:] if base else (name or "Untitled")


def iso_from_timestamp(ts) -> Optional[str]:
    """ISO 8601 from a Unix timestamp (Moodle) or None when unset/zero."""
    from datetime import datetime, timezone

    try:
        value = int(float(str(ts)))
    except (TypeError, ValueError, OverflowError):
        return None
    if value <= 0:
        return None
    try:
        return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
    except (ValueError, OverflowError, OSError):  # millisecond epochs and other out-of-range values
        return None


def iso_from_text(value: Optional[str]) -> Optional[str]:
    """Normalize the many date formats in exports to ISO 8601, or None."""
    from datetime import datetime, timezone

    if not value:
        return None
    v = value.strip()
    if not v:
        return None
    if v.isdigit() and len(v) >= 9:
        return iso_from_timestamp(v)
    fmts = ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d %H:%M:%S%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S %Z", "%Y-%m-%d", "%Y%m%dT%H%M%S",
            "%m/%d/%Y %H:%M", "%m/%d/%Y")
    for fmt in fmts:
        try:
            dt = datetime.strptime(v.replace("Z", "+0000") if "%z" in fmt else v, fmt)
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    try:
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except ValueError:
        return None
