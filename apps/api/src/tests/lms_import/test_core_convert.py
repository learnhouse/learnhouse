"""convert: format detection, reading and end-to-end conversion (with fake source readers)."""

from __future__ import annotations

import importlib
import json
import os
import zipfile
from types import SimpleNamespace

import pytest

from src.services.courses.lms_import.convert import (
    ConversionError,
    ConversionResult,
    Detection,
    convert,
    convert_to_directory,
    detect,
    read_course,
    source_choices,
)
from src.services.courses.lms_import.ir import Course, HtmlPart, Page, RichText, Section
from src.services.courses.lms_import.package import ConvertOptions

# The package re-exports the convert() function under the submodule's name
convert_mod = importlib.import_module("src.services.courses.lms_import.convert")


def sample_course(root: str = "") -> Course:
    return Course(title="Fake course", source="wrong", id="fc", sections=[
        Section(title="S", items=[Page(title="Hello", parts=[HtmlPart(RichText("<p>Hi</p>"))]),
                                  Page(title="Hidden", visible=False)])])


def fake(key, label=None, score=0, read=None):
    def detect_fn(root):
        if isinstance(score, Exception):
            raise score
        return score(root) if callable(score) else score

    return SimpleNamespace(KEY=key, LABEL=label or key.title(), detect=detect_fn, read=read or sample_course)


def install(monkeypatch, *modules):
    by_key = {m.KEY: m for m in modules}

    def get_source(key):
        if key not in by_key:
            raise KeyError(key)
        return by_key[key]

    monkeypatch.setattr(convert_mod, "SOURCE_MODULES", tuple(by_key))
    monkeypatch.setattr(convert_mod, "all_sources", lambda: list(modules))
    monkeypatch.setattr(convert_mod, "get_source", get_source)
    return by_key


@pytest.fixture
def export_dir(tmp_path):
    d = tmp_path / "export"
    d.mkdir()
    (d / "marker.xml").write_text("<x/>")
    return d


# ---------------------------------------------------------------------------
# detect / source_choices / read_course
# ---------------------------------------------------------------------------


def test_detect_orders_by_score_then_registry(monkeypatch, tmp_path):
    install(monkeypatch, fake("alpha", score=50), fake("beta", score=90), fake("gamma", score=50),
            fake("none", score=0), fake("nil", score=None), fake("broken", score=RuntimeError("boom")),
            fake("str", score=lambda _r: "70"))
    found = detect(str(tmp_path))
    assert [(d.key, d.score) for d in found] == [("beta", 90), ("str", 70), ("alpha", 50), ("gamma", 50)]
    assert found[0] == Detection("beta", "Beta", 90)


def test_detect_tolerates_modules_missing_from_registry(monkeypatch, tmp_path):
    install(monkeypatch, fake("a", score=10))
    stray = fake("stray", score=10)
    monkeypatch.setattr(convert_mod, "all_sources", lambda: [stray, convert_mod.get_source("a")])
    assert [d.key for d in detect(str(tmp_path))] == ["a", "stray"]


def test_source_choices(monkeypatch):
    install(monkeypatch, fake("moodle", "Moodle"), fake("canvas", "Canvas"))
    assert source_choices() == [("moodle", "Moodle"), ("canvas", "Canvas")]


def test_real_registry_lists_every_reader():
    keys = [k for k, _ in source_choices()]
    assert keys == list(convert_mod.SOURCE_MODULES)
    with pytest.raises(KeyError):
        convert_mod.get_source("nope")


def test_read_course_auto_and_explicit(monkeypatch, export_dir):
    seen = []

    def read(root):
        seen.append(root)
        return sample_course()

    install(monkeypatch, fake("low", score=10), fake("high", "High LMS", score=80, read=read))
    course = read_course(str(export_dir))
    assert course.source == "high" and seen == [str(export_dir)]
    assert read_course(str(export_dir), "low").source == "low"


def test_read_course_errors(monkeypatch, export_dir):
    def bad(_root):
        raise ValueError("malformed moodle_backup.xml")

    def conv_err(_root):
        raise ConversionError("specific message")

    install(monkeypatch, fake("a", "Alpha"), fake("b", "Beta", read=bad), fake("c", "Gamma", read=conv_err))
    with pytest.raises(ConversionError, match="Unrecognized export. Supported: Alpha, Beta, Gamma"):
        read_course(str(export_dir))
    with pytest.raises(ConversionError, match="Unknown source 'zzz'"):
        read_course(str(export_dir), "zzz")
    with pytest.raises(ConversionError, match="Could not read the Beta export: malformed") as exc:
        read_course(str(export_dir), "b")
    assert isinstance(exc.value.__cause__, ValueError)
    with pytest.raises(ConversionError, match="^specific message$"):
        read_course(str(export_dir), "c")


# ---------------------------------------------------------------------------
# convert_to_directory / convert
# ---------------------------------------------------------------------------


def _zip_dir(src, dest, prefix=""):
    with zipfile.ZipFile(dest, "w") as zf:
        for dirpath, _d, files in os.walk(src):
            for f in files:
                full = os.path.join(dirpath, f)
                zf.write(full, prefix + os.path.relpath(full, src))
    return str(dest)


def test_convert_to_directory_from_folder(monkeypatch, tmp_path, export_dir):
    install(monkeypatch, fake("fake", score=100))
    out = tmp_path / "pkg"
    result = convert_to_directory(str(export_dir), str(out), work_dir=str(tmp_path / "work"))
    assert isinstance(result, ConversionResult)
    assert result.package_dir == str(out) and result.zip_path is None
    assert result.course.source == "fake"
    assert result.report.source == "fake" and result.report.course_title == "Fake course"
    assert json.load(open(out / "manifest.json"))["source"]["lms"] == "fake"


def test_convert_to_directory_options(monkeypatch, tmp_path, export_dir):
    install(monkeypatch, fake("fake", score=100))
    result = convert_to_directory(str(export_dir), str(tmp_path / "pkg"), work_dir=str(tmp_path / "w"),
                                  options=ConvertOptions(include_hidden=False))
    assert [s.title for s in result.report.skipped] == ["Hidden"]


def test_convert_to_directory_errors(monkeypatch, tmp_path, export_dir):
    install(monkeypatch, fake("fake", score=100))
    bad = tmp_path / "bad.bin"
    bad.write_bytes(b"nope")
    with pytest.raises(ConversionError, match="Unsupported file"):
        convert_to_directory(str(bad), str(tmp_path / "o1"), work_dir=str(tmp_path / "w1"))
    full = tmp_path / "full"
    full.mkdir()
    (full / "x").write_text("x")
    with pytest.raises(ConversionError, match="not empty"):
        convert_to_directory(str(export_dir), str(full), work_dir=str(tmp_path / "w2"))
    empty = tmp_path / "empty"
    empty.mkdir()
    convert_to_directory(str(export_dir), str(empty), work_dir=str(tmp_path / "w3"))
    assert (empty / "manifest.json").exists()


def test_convert_zip_in_zip_out(monkeypatch, tmp_path, export_dir):
    seen = []
    install(monkeypatch, fake("fake", score=lambda root: seen.append(root) or (100 if os.path.exists(
        os.path.join(root, "marker.xml")) else 0)))
    archive = _zip_dir(export_dir, tmp_path / "export.zip", prefix="wrapper/")
    out = tmp_path / "nested" / "dir" / "course.ZIP"
    result = convert(archive, str(out))
    assert result.zip_path == str(out) and out.is_file()
    with zipfile.ZipFile(out) as zf:
        assert "manifest.json" in zf.namelist()
    # the temporary work directory is removed
    assert not os.path.exists(result.package_dir)


def test_convert_directory_output_and_own_work_dir(monkeypatch, tmp_path, export_dir):
    install(monkeypatch, fake("fake", score=100))
    work = tmp_path / "work"
    work.mkdir()
    result = convert(str(export_dir), str(tmp_path / "out_dir"), work_dir=str(work))
    assert result.zip_path is None and (tmp_path / "out_dir" / "manifest.json").exists()
    assert work.exists()  # caller-owned work dir is kept
    zipped = convert(str(export_dir), str(tmp_path / "c.zip"), work_dir=str(tmp_path / "work2"))
    assert os.path.isdir(zipped.package_dir)


def test_convert_cleans_up_on_failure(monkeypatch, tmp_path, export_dir):
    install(monkeypatch, fake("fake", score=0))
    made = []
    real = convert_mod.tempfile.mkdtemp

    def mkdtemp(**kw):
        made.append(real(**kw))
        return made[-1]

    monkeypatch.setattr(convert_mod.tempfile, "mkdtemp", mkdtemp)
    with pytest.raises(ConversionError):
        convert(str(export_dir), str(tmp_path / "x.zip"))
    assert made and not os.path.exists(made[0])


# ---------------------------------------------------------------------------
# _unwrap
# ---------------------------------------------------------------------------


def test_unwrap_single_folders(monkeypatch, tmp_path):
    install(monkeypatch, fake("fake", score=lambda root: 100 if os.path.exists(os.path.join(root, "m.xml")) else 0))
    root = tmp_path / "r"
    inner = root / "a" / "b"
    inner.mkdir(parents=True)
    (inner / "m.xml").write_text("x")
    (root / ".DS_Store").write_text("x")
    (root / "__MACOSX").mkdir()
    assert convert_mod._unwrap(str(root)) == str(inner)


def test_unwrap_stops_where_detected(monkeypatch, tmp_path):
    install(monkeypatch, fake("fake", score=100))
    root = tmp_path / "r"
    (root / "only").mkdir(parents=True)
    assert convert_mod._unwrap(str(root)) == str(root)


def test_unwrap_depth_limit_and_multiple_entries(monkeypatch, tmp_path):
    install(monkeypatch, fake("fake", score=0))
    deep = tmp_path / "r" / "1" / "2" / "3" / "4"
    deep.mkdir(parents=True)
    assert convert_mod._unwrap(str(tmp_path / "r")) == str(tmp_path / "r" / "1" / "2" / "3")
    multi = tmp_path / "m"
    (multi / "a").mkdir(parents=True)
    (multi / "b.txt").write_text("x")
    assert convert_mod._unwrap(str(multi)) == str(multi)
    single_file = tmp_path / "f"
    single_file.mkdir()
    (single_file / "only.xml").write_text("x")
    assert convert_mod._unwrap(str(single_file)) == str(single_file)
