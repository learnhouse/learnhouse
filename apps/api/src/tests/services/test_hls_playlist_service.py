"""Unit tests for src/services/utils/hls_playlist.py (playlist URL rewriting)."""

from src.services.utils.hls_playlist import rewrite_playlist, _resolve_key


def _presign(key: str):
    return f"https://r2.example/{key}?sig=abc"


def test_segments_rewritten_to_presigned_urls():
    playlist = (
        "#EXTM3U\n"
        "#EXT-X-TARGETDURATION:6\n"
        "#EXTINF:6.0,\n"
        "seg_0000.ts\n"
        "#EXTINF:6.0,\n"
        "seg_0001.ts\n"
        "#EXT-X-ENDLIST\n"
    )
    out = rewrite_playlist(playlist, "content/o/hls/v480p", _presign)
    assert "https://r2.example/content/o/hls/v480p/seg_0000.ts?sig=abc" in out
    assert "https://r2.example/content/o/hls/v480p/seg_0001.ts?sig=abc" in out
    # Original bare segment names must be gone.
    assert "\nseg_0000.ts" not in out
    # Comments/tags are preserved verbatim.
    assert "#EXT-X-TARGETDURATION:6" in out
    assert "#EXT-X-ENDLIST" in out


def test_nested_playlist_refs_stay_relative():
    master = (
        "#EXTM3U\n"
        '#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720\n'
        "v720p/index.m3u8\n"
        '#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360\n'
        "v360p/index.m3u8\n"
    )
    out = rewrite_playlist(master, "content/o/hls", _presign)
    # Rendition playlists must remain relative so they re-enter the API endpoint.
    assert "v720p/index.m3u8" in out
    assert "v360p/index.m3u8" in out
    assert "r2.example" not in out


def test_absolute_urls_pass_through_untouched():
    playlist = "#EXTM3U\nhttps://cdn.example/already.ts\n"
    out = rewrite_playlist(playlist, "content/o/hls/v480p", _presign)
    assert "https://cdn.example/already.ts" in out
    assert "r2.example" not in out


def test_failed_presign_leaves_line_unchanged():
    playlist = "#EXTM3U\n#EXTINF:6.0,\nseg_0000.ts\n"
    out = rewrite_playlist(playlist, "content/o/hls/v480p", lambda key: None)
    assert "seg_0000.ts" in out
    assert "r2.example" not in out


def test_blank_lines_and_comments_preserved():
    playlist = "#EXTM3U\n\n#COMMENT\n"
    out = rewrite_playlist(playlist, "content/o/hls", _presign)
    assert "#EXTM3U" in out
    assert "#COMMENT" in out


def test_resolve_key_handles_subdirs_and_parent():
    assert _resolve_key("content/o/hls/v480p", "seg_0000.ts") == "content/o/hls/v480p/seg_0000.ts"
    assert _resolve_key("content/o/hls/v480p", "../v720p/seg.ts") == "content/o/hls/v720p/seg.ts"
    assert _resolve_key("content/o/hls", "./master.m3u8") == "content/o/hls/master.m3u8"


# --- Edge cases added during hardening audit -------------------------------

_ROOT = "content/orgs/O/courses/C/activities/A/video/hls"


def test_resolve_key_clamps_traversal_escape():
    base = f"{_ROOT}/v480p"
    # A crafted ../ chain that would escape the activity's hls dir → None.
    assert _resolve_key(base, "../../../../../../secret/x.ts", _ROOT) is None
    # A legitimate in-tree reference still resolves.
    assert _resolve_key(base, "seg_0000.ts", _ROOT) == f"{_ROOT}/v480p/seg_0000.ts"
    # ../enc.key stays within root (used by encrypted renditions).
    assert _resolve_key(base, "../enc.key", _ROOT) == f"{_ROOT}/enc.key"


def test_rewrite_leaves_escaping_segment_untouched():
    base = f"{_ROOT}/v480p"
    pl = "#EXTM3U\n#EXTINF:6,\n../../../../../../secret/x.ts\n"
    out = rewrite_playlist(pl, base, lambda k: "SIGNED:" + k)
    assert "SIGNED:" not in out  # escape was refused
    assert "../../../../../../secret/x.ts" in out


def test_segment_with_query_params_is_presigned():
    out = rewrite_playlist("#EXTM3U\nseg_0000.ts?foo=bar\n", f"{_ROOT}/v480p", _presign)
    # Extension detection ignores the query; the whole ref is signed.
    assert "sig=abc" in out  # segment was rewritten to the presigned URL
    assert "seg_0000.ts" in out


def test_uppercase_and_protocol_relative_absolute_urls_passthrough():
    out = rewrite_playlist(
        "#EXTM3U\nHTTPS://cdn/x.ts\n//cdn/y.ts\n", f"{_ROOT}/v480p", _presign
    )
    assert "HTTPS://cdn/x.ts" in out
    assert "//cdn/y.ts" in out
    assert "r2.example" not in out


def test_ext_x_key_tag_is_preserved_verbatim():
    # The AES key URI lives in a #-tag and must NOT be presigned/rewritten.
    pl = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../enc.key",IV=0x1\nseg_0.ts\n'
    out = rewrite_playlist(pl, f"{_ROOT}/v480p", _presign)
    assert 'URI="../enc.key"' in out


def test_ext_x_map_init_segment_is_presigned():
    # fMP4 init segment (defensive: we emit TS, but handle it if ever enabled).
    pl = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nseg_0.m4s\n'
    out = rewrite_playlist(pl, f"{_ROOT}/v480p", _presign)
    assert 'URI="https://r2.example/' in out and "init.mp4" in out


def test_crlf_line_endings_handled():
    out = rewrite_playlist("#EXTM3U\r\nseg_0000.ts\r\n", f"{_ROOT}/v480p", _presign)
    assert "sig=abc" in out  # segment was rewritten to the presigned URL
