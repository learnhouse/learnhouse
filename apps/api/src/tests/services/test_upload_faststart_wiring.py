"""The upload pipeline must apply faststart to stored videos."""

from types import SimpleNamespace

import src.services.utils.upload_content as upload_content_mod
from src.services.utils.upload_content import upload_content


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
