"""
Library files in a course package.

A page can hold a ``blockLibrary`` node that points at an organization
Library item (a ``Media`` row: a PDF, an Office document, a zip...). The
package carries those files under ``courses/<course>/library/<media_uuid>/``
with a ``media.json`` next to each, so a course imported elsewhere keeps its
downloads: the importer creates new Library items and rewrites the nodes.
"""

from __future__ import annotations

import os
from typing import Iterator

from src.security.file_validation import FILE_TYPES, max_size_for_extension

# What the Library accepts as uploads (see services/media: image, video,
# document, audio, office, office_legacy, archive); databases are not Library files
LIBRARY_EXTENSIONS = frozenset(
    ext.lstrip(".") for spec in FILE_TYPES.values() for ext in spec["extensions"]
) - {"sqlite", "db", "sqlite3"}

def library_max_size(ext: str) -> int:
    """Largest file the Library accepts for ``ext`` (0 for an extension it rejects)."""
    return max_size_for_extension(ext) if ext in LIBRARY_EXTENSIONS else 0


# Fields of a Media row a ``blockLibrary`` node caches to paint before refetching
SNAPSHOT_FIELDS = ("name", "media_type", "file_format", "file_mime", "file_size", "url", "thumbnail_image")


def library_nodes(content) -> Iterator[dict]:
    """Every ``blockLibrary`` node pointing at a Library media item, in document order."""
    if isinstance(content, dict):
        if content.get("type") == "blockLibrary":
            attrs = content.get("attrs")
            if isinstance(attrs, dict) and attrs.get("resourceType") == "media" \
                    and isinstance(attrs.get("resourceUuid"), str):
                yield content
        for value in content.values():
            yield from library_nodes(value)
    elif isinstance(content, list):
        for value in content:
            yield from library_nodes(value)


def library_refs(content) -> set[str]:
    return {node["attrs"]["resourceUuid"] for node in library_nodes(content)}


def rewrite_library_refs(content, mapping: dict[str, tuple[str, dict]]) -> None:
    """Point the nodes at the imported Library items (``old uuid -> (new uuid, snapshot)``).

    A node whose file is not in the package is emptied: it would otherwise
    name a Library item of some other organization, which learners cannot open.
    """
    for node in library_nodes(content):
        attrs = node["attrs"]
        found = mapping.get(attrs["resourceUuid"])
        if found is None:
            attrs["resourceUuid"] = None
            attrs["resourceType"] = None
            attrs["snapshot"] = None
            continue
        attrs["resourceUuid"], snapshot = found
        attrs["snapshot"] = dict(snapshot)


def library_entry_name(media_uuid: str, file_format: str) -> str:
    return f"{media_uuid}.{file_format}" if file_format else media_uuid


def package_library_dir(course_path: str) -> str:
    return os.path.join(course_path, "library")
