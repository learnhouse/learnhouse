"""report: conversion report bookkeeping and summary."""

from __future__ import annotations

from src.services.courses.lms_import import report as report_mod
from src.services.courses.lms_import.report import ConversionReport, SkippedItem


def test_warn_dedupes_and_prefixes_context():
    r = ConversionReport()
    r.warn("a")
    r.warn("a")
    r.warn("b", "Week 1 › Page")
    r.warn("b", "Week 1 › Page")
    r.warn("b", "Other")
    assert r.warnings == ["a", "Week 1 › Page: b", "Other: b"]
    assert r.dropped_warnings == 0


def test_warn_cap(monkeypatch):
    monkeypatch.setattr(report_mod, "MAX_WARNINGS", 2)
    r = ConversionReport()
    for i in range(5):
        r.warn(f"w{i}")
    r.warn("w0")  # duplicate of a kept one: not counted as dropped
    assert r.warnings == ["w0", "w1"]
    assert r.dropped_warnings == 3


def test_skip_count_and_to_dict():
    r = ConversionReport(source="moodle", course_title="C")
    r.skip("", "forum", "no forums")
    r.skip("Quiz", "quiz", "empty")
    r.count("chapters")
    r.count("TYPE_DYNAMIC", 3)
    r.count("chapters")
    assert r.skipped[0] == SkippedItem(title="(untitled)", kind="forum", reason="no forums")
    d = r.to_dict()
    assert d == {
        "source": "moodle",
        "course_title": "C",
        "counts": {"TYPE_DYNAMIC": 3, "chapters": 2},
        "warnings": [],
        "dropped_warnings": 0,
        "skipped": [{"title": "(untitled)", "kind": "forum", "reason": "no forums"},
                    {"title": "Quiz", "kind": "quiz", "reason": "empty"}],
        "dropped_skipped": 0,
    }
    assert list(d["counts"]) == ["TYPE_DYNAMIC", "chapters"]  # sorted


def test_skip_dedupes_and_caps(monkeypatch):
    monkeypatch.setattr(report_mod, "MAX_SKIPPED", 2)
    r = ConversionReport()
    for i in range(5):
        r.skip(f"file{i}.png", "file", "missing from the export")
    r.skip("file0.png", "file", "missing from the export")  # duplicate of a kept one: not counted as dropped
    r.skip("file0.png", "file", "other reason")  # same title, different reason: a new item
    assert [s.title for s in r.skipped] == ["file0.png", "file1.png"]
    assert r.dropped_skipped == 4
    assert r.to_dict()["dropped_skipped"] == 4
    assert "Skipped: 6" in r.summary_lines()


def test_skip_dedupe_is_not_quadratic():
    r = ConversionReport()
    for i in range(20000):
        r.skip(f"link{i}.pdf", "file", "missing from the export")
        r.skip("same.pdf", "file", "missing from the export")
    assert len(r.skipped) == report_mod.MAX_SKIPPED
    assert r.dropped_skipped == 20000 - report_mod.MAX_SKIPPED + 1


def test_summary_lines_full():
    r = ConversionReport(source="canvas", course_title="Bio 101")
    for key, n in (("chapters", 4), ("TYPE_DYNAMIC", 10), ("TYPE_VIDEO", 2), ("TYPE_DOCUMENT", 1),
                   ("TYPE_ASSIGNMENT", 3), ("TYPE_SCORM", 1), ("questions", 25), ("assignment_tasks", 5),
                   ("media_image", 7), ("media_video", 1)):
        r.count(key, n)
    r.skip("x", "forum", "no")
    r.warn("w")
    r.dropped_warnings = 2
    assert r.summary_lines() == [
        "Source: canvas",
        "Course: Bio 101",
        "Chapters: 4",
        "Activities: pages 10, videos 2, documents 1, assignments 3, SCORM 1",
        "Questions: 25 in 5 tasks",
        "Media: image 7, video 1",
        "Skipped: 1",
        "Warnings: 3",
    ]


def test_summary_lines_minimal():
    r = ConversionReport(source="moodle", course_title="Empty")
    r.count("questions", 2)
    assert r.summary_lines() == ["Source: moodle", "Course: Empty", "Chapters: 0", "Activities: ",
                                 "Questions: 2 in 0 tasks"]
