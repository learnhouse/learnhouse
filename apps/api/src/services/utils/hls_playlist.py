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
    # Containment root: nothing a playlist references may resolve above the
    # activity's HLS dir (defense-in-depth against a tampered playlist using ../
    # to presign cross-tenant objects).
    idx = base.rfind("/hls")
    root = base[: idx + len("/hls")] if idx != -1 else base

    def _sign_relative(uri: str) -> str | None:
        key = _resolve_key(base, uri, root)
        return presign(key) if key else None

    out_lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            out_lines.append(line)
            continue
        if stripped.startswith("#"):
            # Defense: fMP4 init segments live in an #EXT-X-MAP:URI="..." tag.
            # (We emit TS, so this normally never fires — future-proofing.)
            if stripped.upper().startswith("#EXT-X-MAP:"):
                out_lines.append(_rewrite_map_tag(line, _sign_relative))
            else:
                out_lines.append(line)
            continue
        # Absolute or protocol-relative URLs pass through untouched.
        low = stripped.lower()
        if low.startswith("http://") or low.startswith("https://") or stripped.startswith("//"):
            out_lines.append(line)
            continue

        # Extension test ignores any ?query/#fragment on the URI.
        path_part = stripped.split("?", 1)[0].split("#", 1)[0].lower()
        if path_part.endswith(_SEGMENT_SUFFIXES):
            signed = _sign_relative(stripped)
            out_lines.append(signed if signed else line)
        else:
            # Nested playlists (.m3u8) and anything else stay relative so they
            # re-enter the API endpoint.
            out_lines.append(line)
    return "\n".join(out_lines) + "\n"


def _rewrite_map_tag(line: str, sign_relative) -> str:
    """Presign the URI="..." of an #EXT-X-MAP tag, leaving the rest intact."""
    import re
    m = re.search(r'URI="([^"]+)"', line)
    if not m:
        return line
    uri = m.group(1)
    low = uri.lower()
    if low.startswith("http://") or low.startswith("https://") or uri.startswith("//"):
        return line
    signed = sign_relative(uri)
    if not signed:
        return line
    return line[: m.start(1)] + signed + line[m.end(1):]


def _resolve_key(base_dir_key: str, relative: str, root: str | None = None) -> str | None:
    """Join a relative URI onto a base key, resolving ./ and ../ segments.

    Returns None if the result escapes `root` (when given) — callers treat that
    like a failed presign and leave the line unchanged.
    """
    # Drop any query/fragment before resolving.
    relative = relative.split("?", 1)[0].split("#", 1)[0]
    parts = base_dir_key.split("/")
    for part in relative.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    resolved = "/".join(parts)
    if root is not None and not (resolved == root or resolved.startswith(root + "/")):
        return None
    return resolved
