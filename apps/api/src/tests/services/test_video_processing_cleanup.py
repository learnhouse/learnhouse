"""ensure_faststart temp-file cleanup in src/services/utils/video_processing.py.

ensure_faststart is best-effort and must never raise: even if the leftover
remux temp file can't be deleted, the caller just gets False.
"""

import os
import subprocess

from src.services.utils import video_processing as vp


def test_failed_remux_with_undeletable_temp_file_returns_false(tmp_path, monkeypatch):
    src = tmp_path / "clip.mp4"
    src.write_bytes(b"original")
    tmp_out = f"{src}.faststart.mp4"

    monkeypatch.setattr(vp, "is_faststart", lambda p: False)
    monkeypatch.setattr(vp, "_ffmpeg_available", lambda: True)

    def _run(args, **kwargs):
        # ffmpeg wrote a partial output, then failed.
        with open(tmp_out, "wb") as f:
            f.write(b"partial")
        return subprocess.CompletedProcess(args, 1, stdout="", stderr="moov atom not found")

    monkeypatch.setattr(vp.subprocess, "run", _run)
    remove_attempts = []

    def _remove(path):
        remove_attempts.append(path)
        raise OSError("EPERM")

    monkeypatch.setattr(vp.os, "remove", _remove)

    assert vp.ensure_faststart(str(src)) is False
    monkeypatch.undo()

    assert remove_attempts == [tmp_out]
    assert src.read_bytes() == b"original"  # original never replaced
    os.remove(tmp_out)
