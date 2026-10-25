"""Resource bounds, error text, grading safety and conversion-job limits."""

from __future__ import annotations

import asyncio
import json
import subprocess
import time
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from src.services.courses.lms_import import package, xmlutil
from src.services.courses.lms_import.ir import (
    Assessment,
    AssignmentItem,
    Blank,
    Choice,
    MediaKind,
    MediaPart,
    Question,
    QType,
    RichText,
    ScormItem,
)
from src.services.courses.lms_import.questions import IdFactory, build_tasks
from src.services.courses.lms_import.report import error_text
from src.services.courses.lms_import.sources import canvas, moodle
from src.services.courses.transfer import lms_import_service as svc
from src.tests.lms_import.test_core_package import MP3, MP4, SCORM12, Files, _page_media, course_with, mc, write
from src.tests.lms_import import test_lms_import_service as service_tests
from src.tests.lms_import.test_lms_import_service import SVC, _fake_convert, _upload, _wait_all

lms_env = service_tests.lms_env

ISO2_MP4 = b"\x00\x00\x00\x18ftypiso2\x00\x00\x02\x00iso2avc1" + b"\x00" * 64
SYNC_FFFA_MP3 = b"\xff\xfa\x90\x00" + b"\x00" * 64


# ---------------------------------------------------------------------------
# Error text shown to uploaders
# ---------------------------------------------------------------------------


def test_error_text_hides_server_paths():
    e = FileNotFoundError(2, "No such file or directory", "/tmp/learnhouse_imports/abc/work/source/x.xml")
    assert error_text(e) == "No such file or directory: x.xml"
    assert error_text(OSError(5, "Input/output error")) == "Input/output error"
    assert error_text(ValueError("bad value in /srv/app/tmp/abc/file.xml here")) == "bad value in file.xml here"
    assert error_text(KeyError()) == "KeyError"
    assert error_text(ValueError("ratio 3/4 is fine")) == "ratio 3/4 is fine"


def test_ffmpeg_error_text():
    stderr = b"[mov] /tmp/x/work/a.mov: Invalid data found when processing input\n"
    assert package._ffmpeg_error(subprocess.CalledProcessError(1, ["ffmpeg", "/tmp/x/a"], stderr=stderr)) == \
        "[mov] a.mov: Invalid data found when processing input"
    assert package._ffmpeg_error(subprocess.CalledProcessError(3, ["ffmpeg"], stderr=b"")) == \
        "ffmpeg exited with status 3"
    assert package._ffmpeg_error(subprocess.TimeoutExpired(["ffmpeg"], 5)) == "took too long"
    assert package._ffmpeg_error(OSError(13, "Permission denied", "/usr/bin/ffmpeg")) == "Permission denied: ffmpeg"


# ---------------------------------------------------------------------------
# Memory: files are never read whole past a limit
# ---------------------------------------------------------------------------


def test_read_limited(tmp_path, monkeypatch):
    p = tmp_path / "big.xml"
    p.write_bytes(b"<a>" + b"x" * 100 + b"</a>")
    assert xmlutil.read_limited(str(p), 1000).startswith(b"<a>")
    with pytest.raises(xmlutil.FileTooLarge) as exc:
        xmlutil.read_limited(str(p), 50)
    assert isinstance(exc.value, OSError) and isinstance(exc.value, xmlutil.XmlError)
    assert "big.xml is larger than 0 MB" in str(exc.value)
    monkeypatch.setattr(xmlutil, "MAX_XML_BYTES", 10)
    monkeypatch.setattr(xmlutil.read_limited, "__defaults__", (10,))
    with pytest.raises(xmlutil.FileTooLarge):
        xmlutil.parse_file(str(p))
    assert xmlutil.try_parse_file(str(p)) is None


def test_moodle_skips_oversized_xml_with_a_warning(tmp_path, monkeypatch):
    p = tmp_path / "questions.xml"
    p.write_bytes(b"<question_categories/>" + b" " * 100)
    warnings = []
    monkeypatch.setattr(moodle, "read_limited", lambda path: xmlutil.read_limited(path, 20))
    assert moodle._parse(str(p), warnings.append) is None
    assert warnings and "questions.xml is larger than" in warnings[0]
    assert moodle._parse(str(p)) is None  # no warn callback
    assert moodle._parse(str(tmp_path / "missing.xml")) is None


def test_canvas_reference_scan_skips_huge_files(tmp_path, monkeypatch):
    (tmp_path / "small.html").write_text('<a href="/media_objects/m-small">x</a>')
    (tmp_path / "huge.html").write_text('<a href="/media_objects/m-huge">x</a>' + " " * 200)
    monkeypatch.setattr(canvas, "MAX_TEXT_BYTES", 100)
    reader = canvas.CanvasReader.__new__(canvas.CanvasReader)
    reader.root = str(tmp_path)
    seen = []
    reader.media_asset = lambda ref: seen.append(ref) or None
    reader._referenced_files()
    assert seen == ["media_objects/m-small"]


# ---------------------------------------------------------------------------
# Media the course importer would reject is converted, not kept as is
# ---------------------------------------------------------------------------


def test_sniff_matches_the_importer_validators(tmp_path):
    files = Files(str(tmp_path))
    assert package._sniff_ok(files.raw("ok.mp4", MP4).path, "mp4")
    assert not package._sniff_ok(files.raw("iso2.mp4", ISO2_MP4).path, "mp4")
    assert package._sniff_ok(files.raw("ok.mp3", MP3).path, "mp3")
    assert not package._sniff_ok(files.raw("fffa.mp3", SYNC_FFFA_MP3).path, "mp3")


def test_unaccepted_variants_are_remuxed_or_transcoded(tmp_path, monkeypatch):
    monkeypatch.setattr(package, "_ffmpeg", lambda: "/usr/bin/ffmpeg")
    calls = []

    def fake_run(args, check, timeout, capture_output):
        calls.append(args)
        if "copy" in args and len([c for c in calls if "copy" in c]) == 2:
            raise subprocess.CalledProcessError(1, args, stderr=b"codec not supported in container")
        with open(args[-1], "wb") as f:
            f.write(MP4 if args[-1].endswith(".mp4") else MP3)
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(package.subprocess, "run", fake_run)
    files = Files(str(tmp_path / "src"))
    act, nodes, report = _page_media(tmp_path, [
        MediaPart(MediaKind.VIDEO, asset=files.raw("a.mp4", ISO2_MP4)),  # rewrapped
        MediaPart(MediaKind.VIDEO, asset=files.raw("b.mp4", ISO2_MP4)),  # rewrap fails, re-encoded
        MediaPart(MediaKind.AUDIO, asset=files.raw("c.mp3", SYNC_FFFA_MP3)),  # re-encoded
    ])
    assert [n["attrs"]["blockObject"]["content"]["file_format"] for n in nodes] == ["mp4", "mp4", "mp3"]
    assert ["copy" in c for c in calls] == [True, True, False, False]
    assert "libx264" in calls[2] and "libmp3lame" in calls[3]
    assert all(c[c.index("-threads") + 1] == "2" and "-fs" in c for c in calls)
    assert report.counts["transcoded"] == 3
    assert not any("Could not convert" in w for w in report.warnings)  # the failed rewrap is silent


def test_unaccepted_variant_without_transcoding_is_left_out(tmp_path):
    files = Files(str(tmp_path / "src"))
    _, nodes, report = _page_media(tmp_path, [MediaPart(MediaKind.VIDEO, asset=files.raw("a.mp4", ISO2_MP4))],
                                   transcode=False)
    # The player would refuse it: kept as a download (zipped, since the Library refuses it too)
    assert [n["type"] for n in nodes] == ["blockLibrary"]
    assert nodes[0]["attrs"]["snapshot"]["file_format"] == "zip" and report.warnings == []


def test_conversion_output_must_pass_the_validators(tmp_path, monkeypatch):
    monkeypatch.setattr(package, "_ffmpeg", lambda: "/usr/bin/ffmpeg")

    def fake_run(args, **_k):
        with open(args[-1], "wb") as f:
            f.write(b"garbage" * 10)
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(package.subprocess, "run", fake_run)
    files = Files(str(tmp_path / "src"))
    _, nodes, report = _page_media(tmp_path, [MediaPart(MediaKind.VIDEO, asset=files.raw("v.mov", b"moov")),
                                              MediaPart(MediaKind.VIDEO, asset=files.raw("w.mp4", ISO2_MP4))])
    assert [n["type"] for n in nodes] == ["blockLibrary", "blockLibrary"]  # downloads instead
    assert any("Could not convert v.mov: unexpected output" in w for w in report.warnings)
    assert any("Could not convert w.mp4: unexpected output" in w for w in report.warnings)


def test_transcoding_time_budget(tmp_path, monkeypatch):
    monkeypatch.setattr(package, "_ffmpeg", lambda: "/usr/bin/ffmpeg")
    monkeypatch.setattr(package, "TRANSCODE_TOTAL_SECONDS", 5)
    timeouts = []
    clock = iter([0.0, 10.0])
    monkeypatch.setattr(package.time, "monotonic", lambda: next(clock))

    def fake_run(args, check, timeout, capture_output):
        timeouts.append(timeout)
        with open(args[-1], "wb") as f:
            f.write(MP4)
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(package.subprocess, "run", fake_run)
    files = Files(str(tmp_path / "src"))
    _, nodes, report = _page_media(tmp_path, [MediaPart(MediaKind.VIDEO, asset=files.raw("a.mov", b"moov")),
                                              MediaPart(MediaKind.VIDEO, asset=files.raw("b.mov", b"moov"))])
    assert [n["type"] for n in nodes] == ["blockVideo", "blockLibrary"] and timeouts == [5]
    assert any("Media conversion time limit reached; b.mov is a download instead" in w for w in report.warnings)


def test_tree_size(tmp_path):
    (tmp_path / "a").write_bytes(b"12345")
    (tmp_path / "d").mkdir()
    (tmp_path / "d" / "b").write_bytes(b"123")
    (tmp_path / "link").symlink_to(tmp_path / "missing")
    assert package._tree_size(str(tmp_path)) == 8 + len(str(tmp_path / "missing"))


def test_scorm_total_size_budget(tmp_path, monkeypatch):
    files = Files(str(tmp_path / "src"))
    first, second = files.scorm("one.zip", SCORM12), files.scorm("two.zip", SCORM12)
    monkeypatch.setattr(package, "_tree_size", lambda _path: package.SCORM_TOTAL_BYTES)  # the first one fills it
    pkg, report = write(course_with(ScormItem(title="One", package=first), ScormItem(title="Two", package=second)),
                        tmp_path)
    assert [a["name"] for a in pkg.activities()] == ["One"]
    assert [(s.title, s.reason) for s in report.skipped] == [
        ("Two", "the SCORM packages of this export are too large in total")]


# ---------------------------------------------------------------------------
# Grading safety
# ---------------------------------------------------------------------------


def _assignment(pkg, title):
    return [a for a in pkg.by_name(title) if a["activity_type"] == "TYPE_ASSIGNMENT"][0]["_assignment"]


def test_past_due_dates_are_removed_unless_kept(tmp_path):
    quiz = Assessment(title="Old quiz", questions=[mc()], due_date="2020-03-01T23:59:00+00:00", id="q1")
    essay = AssignmentItem(title="Old essay", instructions=RichText("<p>Write</p>"), due_date="2021-01-01", id="e1")
    future = Assessment(title="Next quiz", questions=[mc()], due_date="2099-01-01T00:00:00Z", id="q2")
    odd = Assessment(title="Odd date", questions=[mc()], due_date="next friday", id="q3")
    pkg, report = write(course_with(quiz, essay, future, odd), tmp_path)
    assert _assignment(pkg, "Old quiz")["assignment"]["due_date"] is None
    assert _assignment(pkg, "Old essay")["assignment"]["due_date"] is None
    assert _assignment(pkg, "Next quiz")["assignment"]["due_date"] == "2099-01-01T00:00:00Z"
    assert _assignment(pkg, "Odd date")["assignment"]["due_date"] == "next friday"
    assert report.counts["past_due_dates_removed"] == 2
    assert report.warnings == []

    pkg, _ = write(course_with(quiz), tmp_path, name="kept", keep_past_due_dates=True)
    assert _assignment(pkg, "Old quiz")["assignment"]["due_date"] == "2020-03-01T23:59:00+00:00"


@pytest.mark.parametrize("question", [
    Question(type=QType.MULTICHOICE, text=RichText("Opinion?"),
             choices=[Choice(RichText("yes"), False), Choice(RichText("no"), False)]),
    Question(type=QType.CLOZE, text=RichText("A {{1}}"), blanks=[Blank(answers=[" "])]),
    Question(type=QType.SHORTANSWER, text=RichText("Why?"), answers=[]),
])
def test_questions_without_a_key_make_the_assignment_hand_graded(tmp_path, question):
    build = build_tasks([mc(), question], IdFactory("t"))
    assert build.has_manual
    pkg, _ = write(course_with(Assessment(title="Survey", questions=[mc(), question], id="s")), tmp_path)
    assert _assignment(pkg, "Survey")["assignment"]["auto_grading"] is False


def test_keyed_questions_stay_auto_graded():
    numeric_gap = Question(type=QType.CLOZE, text=RichText("{{1}}"), blanks=[Blank(numeric=None, answers=["4"])])
    no_options = Question(type=QType.MULTICHOICE, text=RichText("Empty"), choices=[])
    build = build_tasks([mc(), numeric_gap, no_options], IdFactory("t"))
    assert not build.has_manual


def test_wildcard_answers_are_shown_as_written():
    q = Question(type=QType.SHORTANSWER, text=RichText("Capital?"), answers=["Par*", "paris"],
                 general_feedback="<p>It is Paris.</p>")
    task = build_tasks([q], IdFactory("t")).tasks[0]
    assert task.contents["match_mode"] == "regex"
    assert task.contents["explanation"] == "It is Paris.\n\nAccepted answers: Par*; paris"
    regex = Question(type=QType.SHORTANSWER, text=RichText("Regex"), answers=["^a+$"], regex=True)
    assert "Accepted answers" not in build_tasks([regex], IdFactory("t")).tasks[0].contents["explanation"]


# ---------------------------------------------------------------------------
# Conversion job limits
# ---------------------------------------------------------------------------


async def test_too_many_conversions_are_refused(db, org, admin_user, regular_user, mock_request, lms_env):
    release = asyncio.Event()

    def slow_convert(*args, **kwargs):
        while not release.is_set():
            time.sleep(0.01)
        return _fake_convert(*args, **kwargs)

    with patch(f"{SVC}.convert_to_directory", side_effect=slow_convert):
        for _ in range(svc.MAX_CONVERSIONS_PER_USER):
            await svc.start_lms_import(mock_request, _upload(), org.id, "auto", "assignment", admin_user, db)
        with pytest.raises(HTTPException) as exc:
            await svc.start_lms_import(mock_request, _upload(), org.id, "auto", "assignment", admin_user, db)
        assert exc.value.status_code == 429
        # Another user is still accepted until the server-wide queue is full
        with patch(f"{SVC}.MAX_QUEUED_CONVERSIONS", svc.MAX_CONVERSIONS_PER_USER + 1):
            await svc.start_lms_import(mock_request, _upload(), org.id, "auto", "assignment", regular_user, db)
            with pytest.raises(HTTPException) as exc:
                await svc.start_lms_import(mock_request, _upload(), org.id, "auto", "assignment", regular_user, db)
            assert exc.value.status_code == 429
        release.set()
        await _wait_all()
    assert not svc._running_by_owner
    # Slots are free again once the conversions finished
    with patch(f"{SVC}.convert_to_directory", side_effect=_fake_convert):
        await svc.start_lms_import(mock_request, _upload(), org.id, "auto", "assignment", admin_user, db)
        await _wait_all()


async def test_heartbeat_and_interrupted_conversions(db, org, admin_user, mock_request, lms_env, monkeypatch):
    monkeypatch.setattr(svc, "HEARTBEAT_SECONDS", 0.01)
    release = asyncio.Event()

    def slow_convert(*args, **kwargs):
        while not release.is_set():
            time.sleep(0.01)
        return _fake_convert(*args, **kwargs)

    with patch(f"{SVC}.convert_to_directory", side_effect=slow_convert):
        started = await svc.start_lms_import(mock_request, _upload(), org.id, "auto", "assignment", admin_user, db)
        status_file = lms_env / started.temp_id / svc.STATUS_FILE
        first = json.loads(status_file.read_text())["updated_at"]
        await asyncio.sleep(0.1)
        assert json.loads(status_file.read_text())["updated_at"] > first  # refreshed while running
        with patch(f"{SVC}._write_status", side_effect=OSError("disk full")):
            await asyncio.sleep(0.05)  # a failed refresh does not stop the job
        release.set()
        await _wait_all()
    assert (await svc.get_lms_import_status(mock_request, started.temp_id, org.id, admin_user, db)).status == "ready"

    # A "processing" status nobody refreshes any more: the API restarted mid-conversion
    status_file.write_text(json.dumps({"status": "processing", "owner": svc.lms_principal(admin_user),
                                       "updated_at": time.time() - svc.STALE_PROCESSING_SECONDS - 1}))
    status = await svc.get_lms_import_status(mock_request, started.temp_id, org.id, admin_user, db)
    assert status.status == "failed" and "interrupted" in status.error
    status_file.write_text(json.dumps({"status": "processing", "owner": svc.lms_principal(admin_user),
                                       "updated_at": time.time()}))
    status = await svc.get_lms_import_status(mock_request, started.temp_id, org.id, admin_user, db)
    assert status.status == "processing"


# ---------------------------------------------------------------------------
# Page quiz mode keeps what quiz blocks cannot show
# ---------------------------------------------------------------------------


def test_page_mode_keeps_images_tables_and_unsupported_questions(tmp_path):
    files = Files(str(tmp_path / "src"))
    graph, a_png, b_png = files.image("graph.png"), files.image("a.png"), files.image("b.png")
    resolve = files.resolver({"graph.png": graph, "a.png": a_png, "b.png": b_png})
    with_graph = mc('<p>Read the graph</p><img src="graph.png">')
    with_graph.text = RichText('<p>Read the graph</p><img src="graph.png">', resolve)
    table = mc("<p>The table below</p><table><tr><td>1</td><td>2</td></tr></table>")
    pictures = Question(type=QType.MULTICHOICE, text=RichText("<p>Which curve?</p>"), choices=[
        Choice(RichText('<img src="a.png" alt="the right one">', resolve), True),
        Choice(RichText('<img src="b.png">', resolve), False)])
    stack = Question(type=QType.UNSUPPORTED, text=RichText("<p>Differentiate x^2</p>"), source_type="stack")
    intro = Question(type=QType.DESCRIPTION, text=RichText("<p>Part two</p>"))
    plain = mc("Plain one")
    quiz = Assessment(title="Practice", questions=[plain, with_graph, intro, table, pictures, stack], id="p")
    pkg, report = write(course_with(quiz), tmp_path, quiz_mode="page")
    nodes = pkg.one("Practice")["content"]["content"]
    types = [n["type"] for n in nodes]
    # In source order: plain quiz, Q2 text + image + quiz, description, Q4 table + quiz, Q5 options, Q6 text
    assert types.count("blockQuiz") == 4 and "table" in types and types.count("blockImage") == 3
    text = json.dumps(nodes)
    assert text.index("Plain one") < text.index("Read the graph") < text.index("Part two") \
        < text.index("The table below") < text.index("Which curve?") < text.index("Differentiate")
    options = [a["answer"] for n in nodes if n["type"] == "blockQuiz"
               for q in n["attrs"]["questions"] for a in q["answers"]]
    assert "Option A" in options and "Option B" in options
    assert "the right one" not in text.split("Which curve?")[1].split("blockQuiz")[1]  # alt text not in answers
    assert ("Differentiate x^2", "stack question", "no interactive equivalent; its text was kept") in [
        (s.title, s.kind, s.reason) for s in report.skipped]
    assert report.warnings == []


def test_page_mode_skips_empty_quizzes(tmp_path):
    pkg, report = write(course_with(Assessment(title="Empty", questions=[], id="e")), tmp_path, quiz_mode="page")
    assert pkg.activities() == []
    assert [(s.title, s.reason) for s in report.skipped] == [("Empty", "no questions in the export")]


def test_course_title_falls_back_to_the_file_name(tmp_path):
    from src.services.courses.lms_import.convert import convert, title_from_filename

    assert title_from_filename("/x/D2LExport_Calculus_1.zip") == "D2LExport Calculus 1"
    assert title_from_filename("C:\\exports\\my+course.tar.gz") == "my course"
    assert title_from_filename("backup.mbz") == "backup" and title_from_filename("") == ""
    src = tmp_path / "export"
    src.mkdir()
    (src / "quiz_d2l_5.xml").write_text('<questestinterop><assessment title="Q" ident="a"/></questestinterop>')
    result = convert(str(src), str(tmp_path / "out"), options=package.ConvertOptions(fallback_title="Calc 1"))
    assert result.course.title == "Calc 1"
    result = convert(str(src), str(tmp_path / "out2"),
                     options=package.ConvertOptions(fallback_title="Chapter_07_Alkenes"))
    assert result.course.title == "Chapter 07 Alkenes"


# ---------------------------------------------------------------------------
# A wrapper archive holding several exports
# ---------------------------------------------------------------------------


def _zip(path, files: dict) -> str:
    import zipfile

    with zipfile.ZipFile(path, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    return str(path)


def _d2l_quiz(title: str) -> str:
    return (f'<questestinterop><assessment title="{title}" ident="{title}"><section ident="s">'
            '<item ident="i1" label="i1"><presentation><material><mattext>Sky blue?</mattext></material>'
            '<response_lid ident="r" rcardinality="Single"><render_choice>'
            '<response_label ident="t"><material><mattext>True</mattext></material></response_label>'
            '<response_label ident="f"><material><mattext>False</mattext></material></response_label>'
            '</render_choice></response_lid></presentation><resprocessing><respcondition>'
            '<conditionvar><varequal respident="r">t</varequal></conditionvar>'
            '<setvar action="Set" varname="SCORE">100</setvar></respcondition></resprocessing></item>'
            "</section></assessment></questestinterop>")


def test_archive_of_exports_becomes_one_course(tmp_path):
    from src.services.courses.lms_import.convert import convert

    inner = tmp_path / "inner"
    inner.mkdir()
    ch1 = _zip(inner / "Chapter_01.zip", {"quiz_d2l_1.xml": _d2l_quiz("Quiz one")})
    ch2 = _zip(inner / "Chapter_02.zip", {"quiz_d2l_2.xml": _d2l_quiz("Quiz two")})
    junk = _zip(inner / "notes.zip", {"readme.txt": "nothing to see"})
    outer = _zip(tmp_path / "Test_Bank.zip", {
        "bank/Chapter_02.zip": open(ch2, "rb").read(), "bank/Chapter_01.zip": open(ch1, "rb").read(),
        "bank/notes.zip": open(junk, "rb").read()})
    result = convert(outer, str(tmp_path / "out"), options=package.ConvertOptions(fallback_title="Test Bank"))
    course = result.course
    assert course.title == "Test Bank" and course.source == "brightspace"
    # The inner exports have no title: chapters are named after the course (the wrapper's file name)
    assert [s.title for s in course.sections] == ["Test Bank", "Test Bank"]
    assert [s.items[0].title for s in course.sections] == ["Quiz one", "Quiz two"]
    assert course.warnings == []
    assert [s for s in course.skipped if s[0] == "notes.zip" and s[1] == "export"
            and s[2].startswith("Unrecognized export")]


def test_archive_of_unreadable_exports_fails(tmp_path, monkeypatch):
    import sys

    conv = sys.modules["src.services.courses.lms_import.convert"]  # the module, not the function

    inner = _zip(tmp_path / "a.zip", {"readme.txt": "x"})
    outer = _zip(tmp_path / "outer.zip", {"a.zip": open(inner, "rb").read()})
    with pytest.raises(conv.ConversionError, match="None of the exports"):
        conv.convert(outer, str(tmp_path / "out"))
    monkeypatch.setattr(conv, "MAX_NESTED_EXPORTS", 0)
    with pytest.raises(conv.ConversionError, match="more than 0 exports"):
        conv.convert(outer, str(tmp_path / "out2"))


def test_bundle_chapter_names_from_file_name_titles(tmp_path, monkeypatch):
    import sys

    from src.services.courses.lms_import import ir as ir_mod

    conv = sys.modules["src.services.courses.lms_import.convert"]
    monkeypatch.setattr(conv, "read_course", lambda root, source="auto": ir_mod.Course(
        title="Chapter_09_Alkynes", source="blackboard", sections=[ir_mod.Section("Question pools", id="p")]))
    inner = _zip(tmp_path / "c9.zip", {"x.txt": "x"})
    course = conv._read_bundle([inner], str(tmp_path / "w"), "auto", conv.DEFAULT_LIMITS)
    assert [s.title for s in course.sections] == ["Chapter 09 Alkynes"]
