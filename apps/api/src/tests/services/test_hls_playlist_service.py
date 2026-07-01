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
