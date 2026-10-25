"""End to end: an IR course written as a package, then imported into the DB.

Covers the importer's handling of what the LMS converter produces: assignment
rows and tasks from ``assignment.json`` (with their reference files), block
media, external video links and the activity uuid carried in video/PDF content.
"""

from __future__ import annotations

import json
import os
import struct
import zlib
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.activities import Activity, ActivityTypeEnum
from src.db.courses.assignments import Assignment, AssignmentTask, AssignmentTaskTypeEnum
from src.db.courses.blocks import Block
from src.db.courses.courses import Course
from src.services.courses.lms_import import PackageWriter
from src.services.courses.lms_import import ir
from src.services.courses.lms_import.sources.common import FileIndex, make_resolver
from src.services.courses.transfer.import_service import (
    lms_principal,
    _load_assignment_plan,
    _rename_assignment_dirs,
    import_courses,
    summarize_extracted_package,
)
from src.services.courses.transfer.models import ImportOptions

SERVICE = "src.services.courses.transfer.import_service"


def _png(path) -> None:
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", 4, 3, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + b"\x00\xff\x00" * 4 for _ in range(3))
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def _course(src_dir) -> ir.Course:
    _png(os.path.join(src_dir, "diagram.png"))
    with open(os.path.join(src_dir, "slides.pdf"), "wb") as f:
        f.write(b"%PDF-1.4\n%%EOF\n")
    with open(os.path.join(src_dir, "clip.mp3"), "wb") as f:
        f.write(b"ID3\x03\x00" + b"\x00" * 64)
    resolve = make_resolver(FileIndex(src_dir))
    questions = [
        ir.Question(ir.QType.MULTICHOICE, ir.RichText("<p>2 + 2?</p>"),
                    choices=[ir.Choice(ir.RichText("3")), ir.Choice(ir.RichText("4"), True)]),
        ir.Question(ir.QType.SHORTANSWER, ir.RichText("Capital of France? <img src='diagram.png'>", resolve),
                    answers=["Paris"]),
        ir.Question(ir.QType.NUMERICAL, ir.RichText("Pi to two decimals"), numeric=[ir.NumericAnswer(3.14, 0.005)]),
        ir.Question(ir.QType.ESSAY, ir.RichText("Discuss.")),
    ]
    return ir.Course(
        title="Imported from elsewhere",
        source="moodle",
        id="42",
        summary=ir.RichText("<p>About this course</p>"),
        sections=[ir.Section("Week 1", items=[
            ir.Page("Reading", [ir.HtmlPart(ir.RichText(
                '<p>See <img src="diagram.png"></p><audio src="clip.mp3"></audio>', resolve))]),
            ir.Assessment("Checkpoint", questions, intro=ir.RichText("<p>Answer everything</p>"),
                          due_date="2030-01-01T00:00:00+00:00", max_attempts=3, pass_percent=60,
                          show_correct_answers=True),
            ir.AssignmentItem("Essay hand-in", ir.RichText("<p>Upload your essay</p>"),
                              attachments=[ir.Asset(os.path.join(src_dir, "slides.pdf"), "slides.pdf")]),
            ir.VideoItem("Talk", url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
            ir.DocumentItem("Slides", ir.Asset(os.path.join(src_dir, "slides.pdf"), "slides.pdf")),
        ])],
    )


@pytest.fixture
def import_env(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    imports = tmp_path / "content" / "temp" / "imports"
    imports.mkdir(parents=True)
    monkeypatch.setattr(f"{SERVICE}.TEMP_IMPORT_DIR", str(imports))
    patches = [
        patch(f"{SERVICE}.check_resource_access", new_callable=AsyncMock),
        patch(f"{SERVICE}.require_org_create_permission", new_callable=AsyncMock),
        patch(f"{SERVICE}.check_limits_with_usage", new_callable=AsyncMock),
        patch(f"{SERVICE}.increase_feature_usage", new_callable=AsyncMock),
        patch(f"{SERVICE}.enqueue_course", new_callable=AsyncMock),
        patch(f"{SERVICE}.is_s3_enabled", return_value=False),
    ]
    mocks = [p.start() for p in patches]
    yield {"imports": imports, "limits": mocks[2], "usage": mocks[3]}
    for p in patches:
        p.stop()


def _write_package(tmp_path, imports) -> tuple[str, str]:
    src = tmp_path / "source"
    src.mkdir()
    temp_id = str(uuid4())
    extract_dir = imports / temp_id / "extracted"
    PackageWriter(_course(str(src)), str(extract_dir)).write()
    summary = summarize_extracted_package(str(extract_dir), temp_id)
    return temp_id, summary.courses[0].course_uuid


@pytest.mark.asyncio
async def test_converted_package_imports_assignments_and_media(db, org, admin_user, mock_request, tmp_path,
                                                               import_env):
    temp_id, course_key = _write_package(tmp_path, import_env["imports"])
    org_id = org.id

    result = await import_courses(mock_request, temp_id, org_id, ImportOptions(course_uuids=[course_key]),
                                  admin_user, db)

    assert result.successful == 1, result.courses[0].error
    course = (await db.execute(select(Course).where(Course.course_uuid == result.courses[0].new_uuid))).scalar_one()
    activities = (await db.execute(select(Activity).where(Activity.course_id == course.id))).scalars().all()
    by_name = {a.name: a for a in activities}
    assert set(by_name) == {"Reading", "Checkpoint", "Essay hand-in", "Talk", "Slides"}

    # External video link survives the import
    talk = by_name["Talk"]
    assert talk.content["uri"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert talk.content["activity_uuid"] == talk.activity_uuid

    # The PDF's content points at the new activity and its file exists
    slides = by_name["Slides"]
    assert slides.content["activity_uuid"] == slides.activity_uuid
    pdf_path = (f"content/orgs/{org.org_uuid}/courses/{course.course_uuid}/activities/{slides.activity_uuid}"
                f"/documentpdf/{slides.content['filename']}")
    assert os.path.isfile(pdf_path)

    # Page media: image and audio blocks renamed to the new block uuids
    reading = by_name["Reading"]
    blocks = (await db.execute(select(Block).where(Block.activity_id == reading.id))).scalars().all()
    assert {b.block_type.value for b in blocks} == {"BLOCK_IMAGE", "BLOCK_AUDIO"}
    doc = json.dumps(reading.content)
    for block in blocks:
        assert block.block_uuid in doc
        assert block.content["file_id"] in doc
        folder = {"BLOCK_IMAGE": "imageBlock", "BLOCK_AUDIO": "audioBlock"}[block.block_type.value]
        assert os.path.isfile(
            f"content/orgs/{org.org_uuid}/courses/{course.course_uuid}/activities/{reading.activity_uuid}"
            f"/dynamic/blocks/{folder}/{block.block_uuid}/{block.content['file_id']}.{block.content['file_format']}"
        )

    # Quiz → assignment with typed tasks and answer keys
    quiz = by_name["Checkpoint"]
    assert quiz.activity_type == ActivityTypeEnum.TYPE_ASSIGNMENT
    assignment = (await db.execute(select(Assignment).where(Assignment.activity_id == quiz.id))).scalar_one()
    assert assignment.title == "Checkpoint"
    assert assignment.due_date == "2030-01-01T00:00:00+00:00"
    assert assignment.allow_retries is True and assignment.max_retries == 3
    assert assignment.pass_threshold_percentage == 60
    assert assignment.show_correct_answers is True
    assert assignment.auto_grading is False  # the essay needs a human
    tasks = (await db.execute(
        select(AssignmentTask).where(AssignmentTask.assignment_id == assignment.id).order_by(AssignmentTask.order)
    )).scalars().all()
    assert [t.assignment_type for t in tasks] == [
        AssignmentTaskTypeEnum.QUIZ,
        AssignmentTaskTypeEnum.SHORT_ANSWER,
        AssignmentTaskTypeEnum.NUMBER_ANSWER,
        AssignmentTaskTypeEnum.FILE_SUBMISSION,
    ]
    assert [t.order for t in tasks] == [0, 1, 2, 3]
    assert tasks[0].contents["questions"][0]["options"][1]["assigned_right_answer"] is True
    assert tasks[1].contents["correct_answers"] == ["Paris"]
    assert tasks[2].contents["correct_value"] == 3.14
    # The image in the short answer question became the task's reference file
    assert tasks[1].reference_file
    assert os.path.isfile(
        f"content/orgs/{org.org_uuid}/courses/{course.course_uuid}/activities/{quiz.activity_uuid}"
        f"/assignments/{assignment.assignment_uuid}/tasks/{tasks[1].assignment_task_uuid}/{tasks[1].reference_file}"
    )
    assert all(t.assignment_task_uuid.startswith("assignmenttask_") for t in tasks)

    hand_in = (await db.execute(
        select(Assignment).where(Assignment.activity_id == by_name["Essay hand-in"].id)
    )).scalar_one()
    hand_in_tasks = (await db.execute(
        select(AssignmentTask).where(AssignmentTask.assignment_id == hand_in.id)
    )).scalars().all()
    assert [t.assignment_type for t in hand_in_tasks] == [AssignmentTaskTypeEnum.FILE_SUBMISSION]
    assert hand_in_tasks[0].reference_file.endswith(".pdf")

    # Two assignments counted against the org's usage
    assignment_calls = [c for c in import_env["usage"].await_args_list if c.args[0] == "assignments"]
    assert len(assignment_calls) == 2


@pytest.mark.asyncio
async def test_assignment_limit_fails_the_course_with_a_clear_message(db, org, admin_user, mock_request, tmp_path,
                                                                      import_env):
    temp_id, course_key = _write_package(tmp_path, import_env["imports"])

    async def limits(feature, org_id, session):
        if feature == "assignments":
            raise HTTPException(status_code=403, detail="Assignments is not enabled for this organization")

    import_env["limits"].side_effect = limits
    result = await import_courses(mock_request, temp_id, org.id, ImportOptions(course_uuids=[course_key]),
                                  admin_user, db)
    assert result.failed == 1
    assert "Cannot import assignment 'Checkpoint'" in result.courses[0].error


@pytest.mark.asyncio
async def test_unfinished_lms_conversion_cannot_be_imported(db, org, admin_user, mock_request, import_env):
    temp_id = str(uuid4())
    temp_dir = import_env["imports"] / temp_id
    temp_dir.mkdir()
    owner = lms_principal(admin_user)
    (temp_dir / "lms_status.json").write_text(json.dumps({"status": "processing", "owner": owner}))
    with pytest.raises(HTTPException) as exc:
        await import_courses(mock_request, temp_id, org.id, ImportOptions(course_uuids=["x"]), admin_user, db)
    assert exc.value.status_code == 409
    # Someone else's conversion, or an unreadable status, reads as missing
    for status in (json.dumps({"status": "ready", "owner": "PublicUser:other:999"}), "not json", "[]"):
        (temp_dir / "lms_status.json").write_text(status)
        with pytest.raises(HTTPException) as exc:
            await import_courses(mock_request, temp_id, org.id, ImportOptions(course_uuids=["x"]), admin_user, db)
        assert exc.value.status_code == 404
    assert temp_dir.is_dir()  # never claimed


class TestAssignmentPlan:
    def test_missing_or_invalid_assignment_json(self, tmp_path):
        assert _load_assignment_plan(str(tmp_path)) is None
        (tmp_path / "assignment.json").write_text(json.dumps({"assignment": "nope"}))
        assert _load_assignment_plan(str(tmp_path)) is None

    def test_unsafe_keys_are_ignored(self, tmp_path):
        (tmp_path / "assignment.json").write_text(json.dumps({
            "assignment_uuid": "../../escape",
            "assignment": {"title": "A"},
            "tasks": [{"assignment_task_uuid": "../x", "assignment_type": "QUIZ"}, "not a task"],
        }))
        plan = _load_assignment_plan(str(tmp_path))
        assert plan.old_uuid == ""
        assert len(plan.tasks) == 1 and plan.tasks[0][0] == ""
        # Nothing to rename when the package key was refused
        _rename_assignment_dirs(str(tmp_path), plan)

    def test_rename_drops_unreferenced_and_submission_files(self, tmp_path):
        (tmp_path / "assignment.json").write_text(json.dumps({
            "assignment_uuid": "assignment_old",
            "assignment": {"title": "A"},
            "tasks": [{"assignment_task_uuid": "task_old", "assignment_type": "QUIZ"}],
        }))
        base = tmp_path / "assignments" / "assignment_old"
        (base / "tasks" / "task_old" / "subs").mkdir(parents=True)
        (base / "tasks" / "task_old" / "subs" / "learner.pdf").write_bytes(b"%PDF")
        (base / "tasks" / "task_old" / "ref.pdf").write_bytes(b"%PDF")
        (base / "tasks" / "task_gone").mkdir()
        (base / "solution").mkdir()
        plan = _load_assignment_plan(str(tmp_path))
        _rename_assignment_dirs(str(tmp_path), plan)
        new_base = tmp_path / "assignments" / plan.new_uuid
        new_task = new_base / "tasks" / plan.tasks[0][1]
        assert (new_task / "ref.pdf").is_file()
        assert not (new_task / "subs").exists()
        assert not (new_base / "solution").exists()
        assert not (new_base / "tasks" / "task_gone").exists()


@pytest.mark.asyncio
async def test_assignment_fields_are_sanitized(db, org, admin_user, mock_request, tmp_path, import_env):
    temp_id, course_key = _write_package(tmp_path, import_env["imports"])
    # Tamper with the package the way a hand-made one could
    extract = import_env["imports"] / temp_id / "extracted"
    for root, _dirs, files in os.walk(extract):
        if "assignment.json" in files:
            path = os.path.join(root, "assignment.json")
            data = json.load(open(path))
            data["assignment"].update({
                "grading_type": "BOGUS", "solution_reveal": "SOMETIMES", "max_retries": -4,
                "pass_threshold_percentage": 250, "ungraded": True, "auto_grading": True, "due_date": "",
            })
            data["tasks"].append({"assignment_task_uuid": "t_extra", "assignment_type": "NOT_A_TYPE"})
            data["tasks"][0]["max_grade_value"] = -10
            data["tasks"][0]["reference_file"] = "../../etc/passwd"
            data["tasks"][0]["contents"] = "not a dict"
            json.dump(data, open(path, "w"))
    result = await import_courses(mock_request, temp_id, org.id, ImportOptions(course_uuids=[course_key]),
                                  admin_user, db)
    assert result.successful == 1, result.courses[0].error
    assignments = (await db.execute(select(Assignment))).scalars().all()
    for a in assignments:
        assert a.grading_type.value == "PERCENTAGE"
        assert a.solution_reveal.value == "NEVER"
        assert a.max_retries == 0
        assert a.pass_threshold_percentage is None
        assert a.auto_grading is False and a.ungraded is True
        assert a.due_date is None
    tasks = (await db.execute(select(AssignmentTask))).scalars().all()
    assert all(t.assignment_type.value != "NOT_A_TYPE" for t in tasks)
    first = [t for t in tasks if t.order == 0]
    assert all(t.max_grade_value == 100 and t.reference_file is None and t.contents == {} for t in first)


def _docx(path) -> None:
    """A minimal OOXML-shaped zip: what the Library's office validator accepts."""
    import zipfile

    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<w:document/>")


@pytest.mark.asyncio
async def test_library_files_become_media_items(db, org, admin_user, mock_request, tmp_path, import_env):
    from src.db.folders.folder_content import FolderContent
    from src.db.media.media import Media

    src = tmp_path / "source"
    src.mkdir()
    _docx(src / "handout.docx")
    (src / "notes.ipynb").write_text("{}")
    handout = ir.Asset(str(src / "handout.docx"), "handout.docx")
    notebook = ir.Asset(str(src / "notes.ipynb"), "notes.ipynb")
    course = ir.Course(title="Files", source="moodle", id="f1", sections=[ir.Section("Week 1", items=[
        ir.Page("Materials", [ir.FilePart(handout, title="Handout"), ir.FilePart(notebook)]),
        ir.Page("Again", [ir.FilePart(handout, title="Handout")]),  # the same file, linked twice
    ])])
    temp_id = str(uuid4())
    extract_dir = import_env["imports"] / temp_id / "extracted"
    writer = PackageWriter(course, str(extract_dir))
    writer.write()
    assert writer.report.counts["media_file"] == 2  # one Library item per source file
    summary = summarize_extracted_package(str(extract_dir), temp_id)
    course_key = summary.courses[0].course_uuid

    result = await import_courses(mock_request, temp_id, org.id, ImportOptions(course_uuids=[course_key]),
                                  admin_user, db)
    assert result.successful == 1, result.courses[0].error
    new_course = (await db.execute(select(Course).where(Course.course_uuid == result.courses[0].new_uuid))).scalar_one()
    media = (await db.execute(select(Media).where(Media.org_id == org.id))).scalars().all()
    by_name = {m.name: m for m in media}
    assert set(by_name) == {"Handout", "notes.ipynb (ipynb)"}
    assert by_name["Handout"].file_format == "docx" and by_name["notes.ipynb (ipynb)"].file_format == "zip"
    for m in media:
        assert m.media_uuid.startswith("media_") and m.storage_key.startswith(f"orgs/{org.org_uuid}/media/")
        assert os.path.isfile(f"content/{m.storage_key}") and m.file_size == os.path.getsize(f"content/{m.storage_key}")
        root = (await db.execute(select(FolderContent).where(FolderContent.resource_uuid == m.media_uuid))).scalar_one()
        assert root.folder_id is None and root.org_id == org.id  # at the Library root

    activities = (await db.execute(select(Activity).where(Activity.course_id == new_course.id))).scalars().all()
    pages = {a.name: a for a in activities}
    nodes = [n for n in pages["Materials"].content["content"] if n["type"] == "blockLibrary"]
    assert [n["attrs"]["resourceUuid"] for n in nodes] == [by_name["Handout"].media_uuid,
                                                           by_name["notes.ipynb (ipynb)"].media_uuid]
    assert nodes[0]["attrs"]["snapshot"]["file_size"] == by_name["Handout"].file_size
    again = [n for n in pages["Again"].content["content"] if n["type"] == "blockLibrary"]
    assert again[0]["attrs"]["resourceUuid"] == by_name["Handout"].media_uuid


@pytest.mark.asyncio
async def test_library_block_without_its_file_is_emptied(db, org, admin_user, mock_request, tmp_path, import_env):
    from src.db.media.media import Media

    src = tmp_path / "source"
    src.mkdir()
    temp_id = str(uuid4())
    extract_dir = import_env["imports"] / temp_id / "extracted"
    course = ir.Course(title="Foreign", source="canvas", id="f2",
                       sections=[ir.Section("S", items=[ir.Page("P", [ir.HtmlPart(ir.RichText("<p>x</p>"))])])])
    PackageWriter(course, str(extract_dir)).write()
    # A package edited by hand: a block pointing at some other organization's Library item
    page_dir = next((extract_dir / "courses").glob("*/chapters/*/activities/*"))
    data = json.loads((page_dir / "activity.json").read_text())
    data["content"]["content"].append({"type": "blockLibrary", "attrs": {
        "resourceUuid": "media_elsewhere", "resourceType": "media", "snapshot": {"name": "Secret"}, "display": "inline"}})
    (page_dir / "activity.json").write_text(json.dumps(data))
    course_key = summarize_extracted_package(str(extract_dir), temp_id).courses[0].course_uuid

    result = await import_courses(mock_request, temp_id, org.id, ImportOptions(course_uuids=[course_key]),
                                  admin_user, db)
    assert result.successful == 1, result.courses[0].error
    new_course = (await db.execute(select(Course).where(Course.course_uuid == result.courses[0].new_uuid))).scalar_one()
    page = (await db.execute(select(Activity).where(Activity.course_id == new_course.id))).scalar_one()
    block = [n for n in page.content["content"] if n["type"] == "blockLibrary"][0]
    assert block["attrs"] == {"resourceUuid": None, "resourceType": None, "snapshot": None, "display": "inline"}
    assert (await db.execute(select(Media).where(Media.org_id == org.id))).scalars().all() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("uploaded", [True, False])
async def test_library_files_go_to_object_storage_when_enabled(db, org, admin_user, mock_request, tmp_path,
                                                                import_env, uploaded):
    from src.db.media.media import Media

    src = tmp_path / "source"
    src.mkdir()
    _docx(src / "handout.docx")
    course = ir.Course(title="Files", source="moodle", id="f3", sections=[ir.Section("W", items=[
        ir.Page("Materials", [ir.FilePart(ir.Asset(str(src / "handout.docx"), "handout.docx"), title="Handout")]),
    ])])
    temp_id = str(uuid4())
    extract_dir = import_env["imports"] / temp_id / "extracted"
    PackageWriter(course, str(extract_dir)).write()
    course_key = summarize_extracted_package(str(extract_dir), temp_id).courses[0].course_uuid
    org_id = org.id  # a failed import rolls the session back, expiring the fixture row

    with patch(f"{SERVICE}.is_s3_enabled", return_value=True), \
            patch(f"{SERVICE}.upload_file_to_s3", return_value=uploaded) as upload:
        result = await import_courses(mock_request, temp_id, org_id, ImportOptions(course_uuids=[course_key]),
                                      admin_user, db)
    media = (await db.execute(select(Media).where(Media.org_id == org_id))).scalars().all()
    if uploaded:
        assert result.successful == 1, result.courses[0].error
        assert len(media) == 1
        assert upload.call_args.args == (f"content/{media[0].storage_key}", f"content/{media[0].storage_key}")
    else:
        assert result.successful == 0 and "library file" in result.courses[0].error
        assert media == []
