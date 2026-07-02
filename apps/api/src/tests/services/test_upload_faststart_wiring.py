"""The upload pipeline must apply faststart to stored videos."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import src.services.utils.upload_content as upload_content_mod
from src.services.utils.upload_content import upload_content, _safe_content_path


def test_safe_content_path_contains_within_root(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    p = _safe_content_path("orgs", "org_x", "courses/c/video", "clip.mp4")
    import os
    assert os.path.isabs(p)
    assert p == os.path.realpath("content/orgs/org_x/courses/c/video/clip.mp4")


def test_safe_content_path_rejects_traversal(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    for bad in [("..", "escape.mp4"), ("orgs", "../../etc/passwd"), ("orgs", "x\x00.mp4")]:
        with pytest.raises(HTTPException) as ei:
            _safe_content_path(*bad)
        assert ei.value.status_code == 400


async def test_filesystem_upload_invokes_faststart(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    cfg = SimpleNamespace(
        hosting_config=SimpleNamespace(
            content_delivery=SimpleNamespace(type="filesystem")
        )
    )
    monkeypatch.setattr(upload_content_mod, "get_learnhouse_config", lambda: cfg)

    seen = {}
    monkeypatch.setattr(
        upload_content_mod, "ensure_faststart",
        lambda path: seen.setdefault("path", path),
    )

    await upload_content(
        directory="courses/c/activities/a/video",
        type_of_dir="orgs",
        uuid="org_x",
        file_binary=b"videobytes",
        file_and_format="clip.mp4",
    )

    written = tmp_path / "content/orgs/org_x/courses/c/activities/a/video/clip.mp4"
    assert written.read_bytes() == b"videobytes"
    # faststart was applied to the freshly-written file.
    assert seen["path"].endswith(
        "content/orgs/org_x/courses/c/activities/a/video/clip.mp4"
    )


def test_safe_content_path_rejects_absolute_escape(tmp_path, monkeypatch):
    # An absolute part resets the join and escapes the content root → 400 via
    # the realpath/commonpath containment check (not the ".." fast-path).
    monkeypatch.chdir(tmp_path)
    with pytest.raises(HTTPException) as ei:
        _safe_content_path("orgs", "/etc/passwd")
    assert ei.value.status_code == 400
