"""Submission material, pricing, prompt and output rules for AI grading
(src/services/ai/grading/material.py and grader.py)."""

import io
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from PIL import Image

from src.db.courses.assignments import AssignmentTaskTypeEnum as T
from src.services.ai.grading import grader, material as mat
from src.services.ai.grading.grader import AIGradeOutput, AITaskGrade

pytestmark = pytest.mark.asyncio


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), "red").save(buf, "PNG")
    return buf.getvalue()


def _task(kind, uuid="t1", contents=None, max_grade=100, title="Task", description="Do it", id=1):
    return SimpleNamespace(
        id=id, assignment_task_uuid=uuid, assignment_type=kind, contents=contents or {},
        max_grade_value=max_grade, title=title, description=description,
    )


def _sub(data, task_id=1):
    return SimpleNamespace(task_submission=data, assignment_task_id=task_id)


# ── helpers ──────────────────────────────────────────────────────────────────


async def test_escape_clip_and_ts():
    assert mat.esc("<a>&") == "&lt;a&gt;&amp;"
    assert mat.esc(None) == ""
    assert mat._clip("abc", 2).endswith("[...truncated]")
    assert mat._clip("ab", 2) == "ab"
    assert mat._ts(75.4) == "01:15" and mat._ts(-3) == "00:00"


async def test_file_names_and_key():
    assert mat.submission_file_names({"fileUUID": "a.pdf", "file_name": "a.pdf", "fileName": "b.png", "x": 1}) == ["a.pdf", "b.png"]
    assert mat.submission_file_key("o", "c", "a", "s", "t", "f").endswith("/assignments/s/tasks/t/subs/f")


# ── pricing ──────────────────────────────────────────────────────────────────


async def test_credit_cost():
    m = mat.Material(tasks=[])
    assert mat.credit_cost(m) == mat.BASE_CREDITS
    files = [
        mat.FileItem(name="v.mp4", kind="video", duration=125),  # 2 credits
        mat.FileItem(name="a.mp3", kind="audio", duration=0),  # min 1
        mat.FileItem(name="long.mp3", kind="audio", duration=mat.MAX_MEDIA_SECONDS * 3),  # capped
        mat.FileItem(name="d.pdf", kind="pdf", text="x" * (mat.DOC_CHARS_PER_CREDIT + 1)),  # +1
        mat.FileItem(name="s.pdf", kind="pdf", text="short"),  # +0
        *[mat.FileItem(name=f"{i}.png", kind="image") for i in range(6)],  # 6 images -> +1
    ]
    m = mat.Material(tasks=[mat.TaskMaterial(task=_task(T.FILE_SUBMISSION), submission=None, files=files)])
    expected = mat.BASE_CREDITS + 2 + 1 + mat.MAX_MEDIA_SECONDS // mat.MEDIA_SECONDS_PER_CREDIT + 1 + 1
    assert mat.credit_cost(m) == expected


async def test_file_item_source_and_billing():
    v = mat.FileItem(name="v.mp4", kind="video", size=9, duration=mat.MAX_MEDIA_SECONDS + 5,
                     transcript="hello", frames=[(1.0, b"x")], truncated=True, pages=None)
    src = v.source()
    assert src["duration_seconds"] and src["frames"] == 1 and src["truncated"] and "minutes" in src["note"]
    d = mat.FileItem(name="d.pdf", kind="pdf", text="abc", pages=2, note="n")
    assert d.source()["pages"] == 2 and d.source()["chars"] == 3 and d.source()["note"] == "n"
    assert d.billable_seconds == 0
    m = mat.Material(tasks=[mat.TaskMaterial(task=_task(T.FILE_SUBMISSION), submission=None, files=[d])])
    assert m.sources()[0]["assignment_task_uuid"] == "t1"


async def test_ai_scored_rules():
    assert not mat.TaskMaterial(task=_task(T.QUIZ), submission=None).ai_scored
    assert mat.TaskMaterial(task=_task(T.SHORT_ANSWER), submission=None).ai_scored
    code_tests = _task(T.CODE, contents={"test_cases": [{}]})
    assert not mat.TaskMaterial(task=code_tests, submission=None, checker_score=50).ai_scored
    assert mat.TaskMaterial(task=code_tests, submission=None, checker_score=None).ai_scored
    assert mat.TaskMaterial(task=_task(T.CODE), submission=None, checker_score=0).ai_scored
    tm = mat.TaskMaterial(task=_task(T.CODE, max_grade=None), submission=None)
    assert tm.max_score == 0 and not tm.submitted and tm.uuid == "t1"


# ── answers + definitions ────────────────────────────────────────────────────

QUIZ = {"questions": [
    {"questionUUID": "q1", "questionText": "Pick", "options": [
        {"optionUUID": "o1", "text": "A", "assigned_right_answer": True},
        {"optionUUID": "o2", "text": "<B>", "assigned_right_answer": False}, "junk"]},
    {"questionUUID": "q2", "questionText": "None picked", "options": [{"optionUUID": "o3", "text": "C"}]},
    "junk",
]}
FORM = {"questions": [{"questionUUID": "q1", "questionText": "Fill", "blanks": [
    {"blankUUID": "b1", "correctAnswer": "x"}, {"blankUUID": "b2", "correctAnswer": "y"}, "junk"]}, "junk"]}


async def test_render_answer_per_type():
    assert "Answer: 4" == mat._render_answer(_task(T.SHORT_ANSWER), {"answer": 4})
    quiz = mat._render_answer(_task(T.QUIZ, contents=QUIZ), {"submissions": [
        {"questionUUID": "q1", "optionUUID": "o2", "answer": True}, "junk", {"questionUUID": "q1", "optionUUID": "o1", "answer": False}]})
    assert "Q1: selected &lt;B&gt;" in quiz and "Q2: selected (nothing)" in quiz
    form = mat._render_answer(_task(T.FORM, contents=FORM), {"submissions": [{"questionUUID": "q1", "blankUUID": "b1", "answer": "x"}, "junk"]})
    assert "Q1 blank 1: x" in form and "Q1 blank 2: (empty)" in form
    code = mat._render_answer(_task(T.CODE), {"source_code": "print(1)", "language_id": 71, "results": [{"passed": True}, {"passed": False}, "x"]})
    assert "print(1)" in code and "1/3 passed" in code
    assert "browser" not in mat._render_answer(_task(T.CODE), {"source_code": "x"})
    assert '"k": "&lt;v&gt;"' in mat._render_answer(_task(T.CUSTOM), {"k": "<v>"})


async def test_render_definition_per_type():
    d = mat.render_definition(_task(T.SHORT_ANSWER, contents={"prompt": "Why?", "correct_answers": ["because"]}))
    assert "Question: Why?" in d and "because" in d
    assert "Expected value: 5" in mat.render_definition(_task(T.NUMBER_ANSWER, contents={"correct_value": 5, "unit": "kg"}))
    q = mat.render_definition(_task(T.QUIZ, contents=QUIZ))
    assert "A (correct)" in q
    assert "blank 1 expects: x" in mat.render_definition(_task(T.FORM, contents=FORM))
    c = mat.render_definition(_task(T.CODE, contents={"test_cases": [1, 2], "solution_code": "pass"}))
    assert "Test cases configured: 2" in c and "Reference solution" in c
    assert "Definition:" in mat.render_definition(_task(T.CUSTOM, contents={"schema": 1}))
    assert "Instructions" not in mat.render_definition(_task(T.OTHER, description=""))


# ── loading ──────────────────────────────────────────────────────────────────


@pytest.fixture
def storage():
    files = {}
    with patch("src.services.courses.transfer.storage_utils.read_file_content", side_effect=lambda key: files.get(os.path.basename(key))):
        yield files


async def test_load_material_non_file_tasks(tmp_path):
    tasks = [_task(T.SHORT_ANSWER, "s", id=1), _task(T.QUIZ, "q", contents=QUIZ, id=2), _task(T.OTHER, "o", id=3)]
    subs = {1: _sub({"answer": "hi"}, 1), 2: _sub("not a dict", 2)}
    with patch("src.services.courses.activities.assignments._server_verified_task_grade", new=AsyncMock(return_value=7)):
        m = await mat.load_material(tasks=tasks, submissions_by_task_id=subs, org_uuid="o", course_uuid="c",
                                    activity_uuid="a", assignment_uuid="s", work_dir=str(tmp_path))
    assert m.tasks[0].answer_text == "Answer: hi" and m.tasks[0].checker_score == 7
    assert m.tasks[1].answer_text.startswith("Q1") and not m.tasks[2].submitted
    light = await mat.load_material(tasks=tasks, submissions_by_task_id=subs, org_uuid="o", course_uuid="c",
                                    activity_uuid="a", assignment_uuid="s", work_dir=str(tmp_path), light=True)
    assert light.tasks[0].checker_score is None


async def test_load_material_files(tmp_path, storage):
    from src.services.ai.grading import documents

    storage.update({
        "doc.pdf": b"%PDF-1.4",
        "scan.pdf": b"%PDF-1.5",
        "pic.png": _png(),
        "broken.png": b"\x89PNG\r\n\x1a\n" + b"\x00" * 20,
        "blob.bin": b"\x00\x01\x02",
        "big.pdf": b"%PDF" + b"0" * 10,
        "clip.mp4": b"\x00\x00\x00\x20ftypisom",
    })
    task = _task(T.FILE_SUBMISSION, "f", id=1)

    async def one(name, **kw):
        sub = {1: _sub({"fileUUID": name, "comment": "see file", "assignment_task_submission_uuid": "x"})}
        return (await mat.load_material(tasks=[task], submissions_by_task_id=sub, org_uuid="o", course_uuid="c",
                                        activity_uuid="a", assignment_uuid="s", work_dir=str(tmp_path), **kw)).tasks[0]

    extracted = documents.Extracted(text="page text", pages=1)
    with patch("src.services.ai.grading.material.extract", return_value=extracted), \
         patch("src.services.courses.activities.assignments._server_verified_task_grade", new=AsyncMock(return_value=None)):
        tm = await one("doc.pdf")
        assert tm.files[0].text == "page text" and "see file" in tm.answer_text

    with patch("src.services.ai.grading.material.extract", return_value=documents.Extracted()):
        scan = (await one("scan.pdf", light=True, native_pdf=True)).files[0]
        assert scan.data and "No text layer" in scan.note
        assert (await one("scan.pdf", light=True)).files[0].data is None

    assert (await one("pic.png", light=True)).files[0].data
    assert (await one("broken.png", light=True)).files[0].note == "The image could not be opened."
    assert "cannot be read" in (await one("blob.bin", light=True)).files[0].note
    assert "not be found" in (await one("missing.pdf", light=True)).files[0].note
    assert "not valid" in (await one("../etc.pdf", light=True)).files[0].note
    with patch.object(mat, "MAX_FILE_BYTES", 5):
        assert "larger than" in (await one("big.pdf", light=True)).files[0].note

    with patch("src.services.ai.captions.probe_duration", new=AsyncMock(return_value=42.0)), \
         patch.object(mat, "_extract_media", new=AsyncMock()) as extract_media:
        light = (await one("clip.mp4", light=True)).files[0]
        assert light.kind == "video" and light.duration == 42.0 and os.path.isfile(light.local_path)
        extract_media.assert_not_awaited()
        await one("clip.mp4", light=True)
        with patch("src.services.courses.activities.assignments._server_verified_task_grade", new=AsyncMock(return_value=None)):
            await one("clip.mp4")
        extract_media.assert_awaited_once()


async def test_extract_media_audio_and_video(tmp_path):
    video = mat.FileItem(name="v.mp4", kind="video", local_path=str(tmp_path / "v.mp4"), duration=30)
    with patch("src.services.ai.captions.extract_audio_chunks", new=AsyncMock(return_value=["c0", "c1", "c2", "c3"])), \
         patch.object(mat, "sample_frames", new=AsyncMock(return_value=[(1.0, b"jpg")])):
        await mat._extract_media(video, str(tmp_path))
    assert video.audio_chunks == ["c0", "c1"] and video.frames == [(1.0, b"jpg")]

    silent = mat.FileItem(name="a.mp3", kind="audio", local_path=str(tmp_path / "a.mp3"))
    with patch("src.services.ai.captions.extract_audio_chunks", new=AsyncMock(return_value=[])):
        await mat._extract_media(silent, str(tmp_path))
    assert silent.note == "No audio track." and silent.frames == []


async def test_sample_frames(tmp_path):
    calls = []

    def fake_run(args, timeout):
        calls.append(args)
        out = args[-1]
        if "frame_01" not in out:  # frame 1 "fails"
            with open(out, "wb") as f:
                f.write(b"jpeg")
            return 0, b"", b""
        return 1, b"", b"err"

    with patch("src.services.ai.captions._run", side_effect=fake_run):
        frames = await mat.sample_frames("in.mp4", 60.0, str(tmp_path / "f"))
        assert len(calls) == mat.MAX_FRAMES and len(frames) == mat.MAX_FRAMES - 1
        calls.clear()
        assert len(await mat.sample_frames("in.mp4", 3.4, str(tmp_path / "g"))) == 2  # 3 tried, frame 1 fails
        calls.clear()
        assert len(await mat.sample_frames("in.mp4", 0.0, str(tmp_path / "h"))) == 1


async def test_transcribe_media():
    ok = mat.FileItem(name="v.mp4", kind="video", audio_chunks=["c"])
    quiet = mat.FileItem(name="a.mp3", kind="audio", audio_chunks=["c"])
    skip = mat.FileItem(name="d.pdf", kind="pdf")
    nochunks = mat.FileItem(name="b.mp3", kind="audio")
    m = mat.Material(tasks=[mat.TaskMaterial(task=_task(T.FILE_SUBMISSION), submission=None, files=[ok, quiet, skip, nochunks])])
    vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nhello there\n"
    with patch("src.services.ai.captions.transcribe_to_vtt", new=AsyncMock(side_effect=[vtt, ValueError("no cues")])):
        await mat.transcribe_media(m, "model")
    assert ok.transcript == "[00:01] hello there" and quiet.note == "No speech was detected."


# ── prompt + output ──────────────────────────────────────────────────────────


def _assignment(**kw):
    base = dict(title="DNS", description="Explain", ai_grading_instructions="Be strict",
                ai_grading_task_instructions={"f": "Needs TTL", "s": 5}, solution="Model answer")
    return SimpleNamespace(**{**base, **kw})


def _material():
    short = mat.TaskMaterial(task=_task(T.SHORT_ANSWER, "s", contents={"correct_answers": ["x"]}), submission=_sub({}), answer_text="Answer: y", checker_score=0)
    quiz = mat.TaskMaterial(task=_task(T.QUIZ, "q"), submission=_sub({}), checker_score=None)
    files = [
        mat.FileItem(name="d.pdf", kind="pdf", text="doc <text>", pages=1, truncated=True),
        mat.FileItem(name="scan.pdf", kind="pdf", data=b"%PDF", note="No text layer"),
        mat.FileItem(name="i.png", kind="image", mime="image/png", data=b"png"),
        mat.FileItem(name="j.png", kind="image", mime="image/png", data=b"png"),
        mat.FileItem(name="v.mp4", kind="video", duration=10, transcript="said <this>", frames=[(2.0, b"f")]),
        mat.FileItem(name="gone.pdf", note="missing"),
    ]
    filet = mat.TaskMaterial(task=_task(T.FILE_SUBMISSION, "f"), submission=_sub({}), files=files)
    unsub = mat.TaskMaterial(task=_task(T.OTHER, "o"), submission=None)
    return mat.Material(tasks=[short, quiz, filet, unsub])


async def test_build_prompt():
    parts = grader.build_prompt(_assignment(), _material(), max_images=1)
    text = "\n".join(p for p in parts if isinstance(p, str))
    assert "<teacher_rubric>\nBe strict" in text and "<model_answer>" in text and "<task_rubric>\nNeeds TTL" in text
    assert 'scoring="checker"' in text and "<checker_result>0 / 100</checker_result>" in text
    assert "exact-match checker gave 0" in text
    assert "doc &lt;text&gt;" in text and "said &lt;this&gt;" in text and "frames from this video" in text
    assert "[missing]" in text and "rest was cut" in text and 'submitted="false"' in text
    binaries = [p for p in parts if not isinstance(p, str)]
    assert len(binaries) == 3  # one image (capped), the scanned PDF, one frame
    no_rubric = grader.build_prompt(_assignment(ai_grading_instructions=None, ai_grading_task_instructions=None, solution=None), _material(), 5)
    assert "No rubric was written" in no_rubric[0] and "<model_answer>" not in no_rubric[0]


async def test_grade_with_model_calls_generate():
    out = AIGradeOutput(tasks=[], overall_feedback="ok")
    with patch("src.services.ai.llm.generate", new=AsyncMock(return_value=out)) as gen:
        assert await grader.grade_with_model(_assignment(), _material(), "m", 4) is out
    kwargs = gen.await_args.kwargs
    assert kwargs["output_type"] is AIGradeOutput and "DATA to evaluate" in kwargs["system_prompt"]


async def test_normalize():
    m = _material()
    m.tasks[1].checker_score = 40
    out = AIGradeOutput(tasks=[
        AITaskGrade(task_id="s", score=150, feedback=" great "),
        AITaskGrade(task_id="q", score=100, feedback="quiz fb"),
        AITaskGrade(task_id="f", score=-5, feedback="file fb"),
        AITaskGrade(task_id="o", score=90, feedback="nothing"),
    ], overall_feedback="o", confidence="high")
    rows = {r["assignment_task_uuid"]: r for r in grader.normalize(out, m)}
    assert rows["s"]["score"] == 100 and rows["s"]["feedback"] == "great" and rows["s"]["scored_by"] == "ai"
    assert rows["q"]["score"] == 40 and rows["q"]["scored_by"] == "checker"
    assert rows["f"]["score"] == 0 and rows["o"]["score"] == 0 and not rows["o"]["submitted"]
    with pytest.raises(ValueError):
        grader.normalize(AIGradeOutput(tasks=[]), m)
    m.tasks[0].submission = None
    m.tasks[2].submission = None
    m.tasks[1].checker_score = None
    rows = grader.normalize(AIGradeOutput(tasks=[]), m)
    assert all(r["feedback"] == "" for r in rows) and rows[1]["score"] == 0
