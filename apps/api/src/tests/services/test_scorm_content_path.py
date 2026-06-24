"""
SCORM content-file path resolution (get_scorm_content_path).

Covers query-string/fragment stripping (Storyline/Rise launch paths), nested
paths, and traversal rejection. Skips cleanly when EE is absent.
"""

import pytest

scorm = pytest.importorskip("ee.services.scorm.scorm")


def _make_tree(tmp_path, org, course, act, files):
    base = tmp_path / f"content/orgs/{org}/courses/{course}/activities/{act}/scorm/extracted"
    base.mkdir(parents=True)
    for name, content in files.items():
        p = base / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
    return base


class TestContentPathResolution:
    def test_query_string_and_fragment_stripped(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        _make_tree(tmp_path, "org_x", "course_x", "activity_x", {"story.html": "<html>"})
        path = scorm.get_scorm_content_path(
            "org_x", "course_x", "activity_x", "story.html?v=2&lang=en#start")
        assert path is not None
        assert path.endswith("story.html")

    def test_nested_path_resolves(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        _make_tree(tmp_path, "o", "c", "a", {"lesson1/index.html": "<html>"})
        path = scorm.get_scorm_content_path("o", "c", "a", "lesson1/index.html")
        assert path is not None and path.endswith("lesson1/index.html")

    def test_traversal_returns_none(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        _make_tree(tmp_path, "o", "c", "a", {"index.html": "x"})
        assert scorm.get_scorm_content_path("o", "c", "a", "../../../../etc/passwd") is None

    def test_missing_file_returns_none(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        _make_tree(tmp_path, "o", "c", "a", {"index.html": "x"})
        assert scorm.get_scorm_content_path("o", "c", "a", "nope.html") is None
