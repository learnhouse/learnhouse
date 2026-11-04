"""Edge cases for #EXT-X-MAP rewriting in src/services/utils/hls_playlist.py.

Only a relative init-segment URI that presigns cleanly gets rewritten; every
other MAP tag must pass through byte-for-byte so the player sees what
ffmpeg wrote.
"""

from src.services.utils.hls_playlist import rewrite_playlist

_ROOT = "content/orgs/o/courses/c/activities/a/video/hls"


def _presign(key: str):
    return f"https://r2.example/{key}?sig=abc"


def test_map_tag_without_uri_is_untouched():
    pl = "#EXTM3U\n#EXT-X-MAP:BYTERANGE=720@0\nseg_0.m4s\n"
    out = rewrite_playlist(pl, f"{_ROOT}/v480p", _presign)
    assert "#EXT-X-MAP:BYTERANGE=720@0" in out.splitlines()


def test_map_tag_with_absolute_uri_is_untouched():
    for uri in ("https://cdn.example/init.mp4", "HTTP://cdn.example/init.mp4", "//cdn/init.mp4"):
        line = f'#EXT-X-MAP:URI="{uri}"'
        out = rewrite_playlist(f"#EXTM3U\n{line}\n", f"{_ROOT}/v480p", _presign)
        assert line in out.splitlines()


def test_map_tag_escaping_hls_root_is_not_presigned():
    """A tampered ../ URI that leaves the activity's hls dir must not be
    presigned (that would hand out a URL to another tenant's object)."""
    signed = []

    def _spy(key):
        signed.append(key)
        return _presign(key)

    line = '#EXT-X-MAP:URI="../../../../other/secret.mp4"'
    out = rewrite_playlist(f"#EXTM3U\n{line}\n", f"{_ROOT}/v480p", _spy)
    assert line in out.splitlines()
    assert signed == []


def test_map_tag_presign_failure_keeps_original():
    line = '#EXT-X-MAP:URI="init.mp4"'
    out = rewrite_playlist(f"#EXTM3U\n{line}\n", f"{_ROOT}/v480p", lambda key: None)
    assert line in out.splitlines()
