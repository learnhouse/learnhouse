"""Error-path tests for src/services/utils/hls_transcode.py.

The transcoder promises to never raise: probe, sprite and transcode failures
all degrade to a safe default or None. ffmpeg/ffprobe are faked via
_run_subprocess so these run without spawning anything.
"""

import os

import pytest

from src.services.utils import hls_transcode as ht


def _fake_run(result=None, exc=None):
    calls = []

    async def _run(args, timeout):
        calls.append(args)
        if exc is not None:
            raise exc
        return result

    return _run, calls


@pytest.fixture
def tools(monkeypatch):
    monkeypatch.setattr(ht, "_ffprobe", lambda: "/usr/bin/ffprobe")
    monkeypatch.setattr(ht, "_ffmpeg", lambda: "/usr/bin/ffmpeg")


# --------------------------------------------------------------------------
# _probe
# --------------------------------------------------------------------------

async def test_probe_subprocess_error_returns_unknown(monkeypatch, tools):
    run, _ = _fake_run(exc=OSError("exec format error"))
    monkeypatch.setattr(ht, "_run_subprocess", run)
    assert await ht._probe("x.mp4") == (0, False, 0.0, None)


async def test_probe_invalid_json_returns_unknown(monkeypatch, tools):
    run, _ = _fake_run(result=(0, b"not json{", b""))
    monkeypatch.setattr(ht, "_run_subprocess", run)
    assert await ht._probe("x.mp4") == (0, False, 0.0, None)


async def test_probe_bad_duration_falls_back_to_zero(monkeypatch, tools):
    """A non-numeric duration must not lose the stream info we did read."""
    out = (
        b'{"streams": [{"codec_type": "video", "height": 720},'
        b' {"codec_type": "audio"}], "format": {"duration": "N/A"}}'
    )
    run, _ = _fake_run(result=(0, out, b""))
    monkeypatch.setattr(ht, "_run_subprocess", run)
    assert await ht._probe("x.mp4") == (720, True, 0.0, True)


# --------------------------------------------------------------------------
# generate_sprite_thumbnails
# --------------------------------------------------------------------------

async def test_sprite_subprocess_error_returns_none(monkeypatch, tools, tmp_path):
    run, calls = _fake_run(exc=RuntimeError("thread pool gone"))
    monkeypatch.setattr(ht, "_run_subprocess", run)
    assert await ht.generate_sprite_thumbnails("x.mp4", str(tmp_path), 60.0) is None
    assert len(calls) == 1


# --------------------------------------------------------------------------
# transcode_source_to_hls
# --------------------------------------------------------------------------

@pytest.fixture
def source(tmp_path, monkeypatch, tools):
    src = tmp_path / "in.mp4"
    src.write_bytes(b"\x00" * 16)

    async def _probe(path):
        return 480, True, 12.0, True

    monkeypatch.setattr(ht, "_probe", _probe)
    monkeypatch.setenv("LEARNHOUSE_HLS_ENCRYPT", "true")
    return str(src), str(tmp_path / "out")


def _capture_keyinfo(monkeypatch):
    """Record the keyinfo temp path that transcode creates."""
    import tempfile
    seen = []
    real = tempfile.mkstemp

    def _mkstemp(*a, **k):
        fd, path = real(*a, **k)
        seen.append(path)
        return fd, path

    monkeypatch.setattr(ht.tempfile, "mkstemp", _mkstemp)
    return seen


async def test_transcode_subprocess_error_returns_none_and_cleans_keyinfo(monkeypatch, source):
    src, out = source
    keyinfos = _capture_keyinfo(monkeypatch)
    run, _ = _fake_run(exc=RuntimeError("spawn failed"))
    monkeypatch.setattr(ht, "_run_subprocess", run)

    assert await ht.transcode_source_to_hls(src, out) is None
    assert len(keyinfos) == 1
    assert not os.path.exists(keyinfos[0])  # keyinfo never leaks


async def test_transcode_keyinfo_remove_error_is_ignored(monkeypatch, source):
    """A failure deleting the keyinfo temp file must not turn a finished
    transcode into an exception."""
    src, out = source
    keyinfos = _capture_keyinfo(monkeypatch)
    run, _ = _fake_run(result=(1, b"", b"boom"))
    monkeypatch.setattr(ht, "_run_subprocess", run)
    real_remove = os.remove
    removed = []

    def _remove(path):
        removed.append(path)
        raise OSError("EBUSY")

    monkeypatch.setattr(ht.os, "remove", _remove)
    try:
        assert await ht.transcode_source_to_hls(src, out) is None
    finally:
        monkeypatch.setattr(ht.os, "remove", real_remove)
        for p in keyinfos:
            if os.path.exists(p):
                os.remove(p)
    assert removed == keyinfos


async def test_transcode_without_master_playlist_returns_none(monkeypatch, source):
    """ffmpeg exiting 0 without writing master.m3u8 is still a failure."""
    src, out = source
    monkeypatch.setenv("LEARNHOUSE_HLS_ENCRYPT", "false")
    run, calls = _fake_run(result=(0, b"", b""))
    monkeypatch.setattr(ht, "_run_subprocess", run)
    sprites = []

    async def _sprite(*a, **k):
        sprites.append(a)

    monkeypatch.setattr(ht, "generate_sprite_thumbnails", _sprite)

    assert await ht.transcode_source_to_hls(src, out) is None
    assert len(calls) == 1
    assert sprites == []  # never got as far as the preview sprite
    assert not os.path.exists(os.path.join(out, ht.MASTER_PLAYLIST_NAME))
