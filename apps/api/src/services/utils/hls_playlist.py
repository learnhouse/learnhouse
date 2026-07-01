"""
HLS playlist rewriting for auth-preserving delivery.

The API serves `.m3u8` playlists after an RBAC check; segments are streamed
directly from R2 via presigned URLs. To make that work we rewrite each playlist:

- A segment reference (`.ts` / `.m4s`) → a presigned R2 URL, so the player pulls
  segments straight from R2 with no per-segment API round-trip.
- A nested playlist reference (`.m3u8`, i.e. master → rendition) → left relative,
  so it re-enters the API endpoint and gets its own RBAC + presign pass.
- Comments (`#...`), blank lines, and absolute URLs are passed through untouched.

Segment/playlist paths are relative to the *directory of the playlist being
served*, mirroring the on-disk/R2 layout.
"""

from __future__ import annotations

from typing import Callable

_SEGMENT_SUFFIXES = (".ts", ".m4s", ".mp4")
_PLAYLIST_SUFFIXES = (".m3u8",)


def rewrite_playlist(
    text: str,
    playlist_dir_key: str,
    presign: Callable[[str], str | None],
) -> str:
    """
    Rewrite a playlist's URIs.

    Args:
        text: raw .m3u8 contents.
        playlist_dir_key: R2 key of the directory containing this playlist
            (no trailing slash), e.g. "content/orgs/.../video/hls/v720p".
        presign: maps an absolute R2 key → presigned URL (or None on failure).

    Returns the rewritten playlist. Lines whose segment fails to presign are
    left as-is (the player will simply fail that segment rather than the load).
    """
    base = playlist_dir_key.rstrip("/")
    out_lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            out_lines.append(line)
            continue
        # Absolute URLs (already presigned or external) pass through.
        if stripped.startswith("http://") or stripped.startswith("https://"):
            out_lines.append(line)
            continue

        lower = stripped.lower()
        if lower.endswith(_SEGMENT_SUFFIXES):
            key = _resolve_key(base, stripped)
            signed = presign(key)
            out_lines.append(signed if signed else line)
        elif lower.endswith(_PLAYLIST_SUFFIXES):
            # Leave relative so the nested playlist re-enters the API endpoint.
            out_lines.append(line)
        else:
            out_lines.append(line)
    return "\n".join(out_lines) + "\n"


def _resolve_key(base_dir_key: str, relative: str) -> str:
    """Join a relative URI (possibly with ../ or subdirs) onto a base key."""
    parts = base_dir_key.split("/")
    for part in relative.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return "/".join(parts)
