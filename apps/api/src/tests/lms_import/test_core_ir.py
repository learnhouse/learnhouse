"""ir: the small behaviours of the intermediate representation."""

from __future__ import annotations

import runpy
import sys

import pytest

from src.services.courses.lms_import.ir import Asset, Course, Question, QType, RichText, no_resolver


def test_asset_extension_and_exists(tmp_path):
    f = tmp_path / "Photo.JPEG"
    f.write_bytes(b"x")
    assert Asset(path=str(f), name="Photo.JPEG").extension == "jpeg"
    assert Asset(path="/x/archive.tar.gz", name="").extension == "gz"
    assert Asset(path="/x/noext", name="noext").extension == ""
    assert Asset(path=str(f), name="Photo.JPEG").exists()
    assert not Asset(path=str(tmp_path), name="dir").exists()
    assert not Asset(path=str(tmp_path / "missing"), name="m").exists()


def test_rich_text_defaults():
    assert no_resolver("anything") is None
    assert RichText().is_empty() and RichText("  \n").is_empty() and RichText(None).is_empty()
    assert not RichText("<p>x</p>").is_empty()
    assert RichText().resolve is no_resolver


def test_defaults_are_not_shared():
    a, b = Question(type=QType.MULTICHOICE), Question(type=QType.MULTICHOICE)
    a.choices.append("x")
    assert b.choices == []
    c1, c2 = Course(title="a", source="s"), Course(title="b", source="s")
    c1.warnings.append("w")
    assert c2.warnings == []
    assert QType("cloze") is QType.CLOZE and QType.CLOZE == "cloze"


def test_module_entry_point(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["learnhouse-lms-import", "--help"])
    with pytest.raises(SystemExit) as exc:
        runpy.run_module("src.services.courses.lms_import", run_name="__main__")
    assert exc.value.code == 0
