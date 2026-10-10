"""Source extractors: every kind of course content becomes indexable text."""

from datetime import datetime
from unittest.mock import patch

import pytest

from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.courses.blocks import Block, BlockTypeEnum
from src.db.courses.chapters import Chapter
from src.services.ai.rag import formats
from src.services.ai.rag.sources import dynamic, extract
from src.services.ai.rag.types import ContentRef, SourceType
from src.tests.services.rag_helpers import (
    VTT,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
    add_activity,
    make_pdf,
)

ACTIVITY_DIR = "content/orgs/org_test/courses/course_test/activities"


def _storage(files: dict):
    """Patch reads from storage; returns the list of keys that were read."""
    reads: list[str] = []

    def read(key):
        reads.append(key)
        return files.get(key)

    return reads, read


def _texts(extraction, source_type=None):
    return [s.text for s in extraction.segments if source_type is None or s.source_type == source_type]


async def _extract(db, activity_id):
    return await extract(ContentRef.activity(activity_id), db)


# ---------------------------------------------------------------------------
# Every activity
# ---------------------------------------------------------------------------


class TestActivitySummary:
    async def test_every_activity_is_findable_by_name_and_details(self, db, org, course, chapter):
        await add_activity(
            db, org, course, chapter, 10,
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_EMBED,
            content={"embed_url": "https://example.com/widget"},
            name="Interactive periodic table",
            details={"description": "Explore the elements", "embed_url": "https://example.com/x"},
        )
        extraction = await _extract(db, 10)
        assert extraction.chapter_name == "Test Chapter"
        assert extraction.course_name == "Test Course"
        summary = _texts(extraction, SourceType.ACTIVITY)
        assert summary == ["Activity: Interactive periodic table\nExplore the elements"]
        # Links are not prose and are never fetched.
        assert "https://" not in "\n".join(_texts(extraction))

    async def test_extractor_failure_keeps_the_summary(self, db, org, course, chapter):
        await add_activity(
            db, org, course, chapter, 11,
            activity_type=ActivityTypeEnum.TYPE_DOCUMENT,
            sub_type=ActivitySubTypeEnum.SUBTYPE_DOCUMENT_PDF,
            content={"filename": "doc.pdf"},
            name="Broken doc",
        )
        with patch("src.services.ai.rag.formats.read_file_content", side_effect=RuntimeError("boom")):
            extraction = await _extract(db, 11)
        assert _texts(extraction) == ["Activity: Broken doc"]

    async def test_missing_activity_is_none(self, db, org, course):
        assert await _extract(db, 999) is None
        assert await extract(ContentRef.course(999), db) is None


# ---------------------------------------------------------------------------
# Dynamic pages
# ---------------------------------------------------------------------------


def _doc(*nodes):
    return {"type": "doc", "content": list(nodes)}


class TestTipTapAttributeNodes:
    def test_quiz_keeps_questions_and_answers_but_not_the_key(self):
        text = dynamic.extract_text_from_prosemirror(_doc({
            "type": "blockQuiz",
            "attrs": {"questions": [{
                "question": "Powerhouse of the cell?",
                "answers": [
                    {"answer": "Mitochondria", "correct": True},
                    {"answer": "Nucleus", "correct": False},
                ],
            }]},
        }))
        assert text == "Quiz question: Powerhouse of the cell?\n- Mitochondria\n- Nucleus"
        assert "correct" not in text.lower() and "True" not in text

    def test_flipcards_inside_a_grid(self):
        text = dynamic.extract_text_from_prosemirror(_doc({
            "type": "flipcardGrid",
            "content": [
                {"type": "flipcard", "attrs": {"question": "ATP?", "answer": "Energy currency"}},
                {"type": "flipcard", "attrs": {"question": "DNA?", "answer": ""}},
            ],
        }))
        assert text == "Flashcard: ATP?\nAnswer: Energy currency\nFlashcard: DNA?"

    def test_scenarios(self):
        text = dynamic.extract_text_from_prosemirror(_doc({
            "type": "scenarios",
            "attrs": {"title": "Lab safety", "scenarios": [
                {"id": "1", "text": "Acid spills.", "options": [{"text": "Rinse"}, {"text": ""}]},
                "junk",
            ]},
        }))
        assert text == "Scenario: Lab safety\nAcid spills.\n- Rinse"

    def test_code_playground_never_includes_solution_or_tests(self):
        text = dynamic.extract_text_from_prosemirror(_doc({
            "type": "blockCode",
            "attrs": {
                "languageName": "Python 3",
                "description": "Reverse a list",
                "hints": ["Use slicing", ""],
                "starterCode": "def rev(xs):\n    pass",
                "solutionCode": "SECRET_SOLUTION",
                "testCases": [{"expectedStdout": "SECRET_OUTPUT"}],
            },
        }))
        assert "Coding exercise (Python 3): Reverse a list" in text
        assert "Hint: Use slicing" in text
        assert "def rev(xs):" in text
        assert "SECRET" not in text

    def test_math_web_preview_library_and_magic(self):
        text = dynamic.extract_text_from_prosemirror(_doc(
            {"type": "blockMathEquation", "attrs": {"math_equation": "E = mc^2"}},
            {"type": "blockWebPreview", "attrs": {"url": "https://x.y", "title": "Docs", "description": "Reference"}},
            {"type": "blockLibrary", "attrs": {"snapshot": {"name": "Syllabus.pdf"}}},
            {"type": "blockMagic", "attrs": {
                "title": "Simulator",
                "htmlContent": "<div>Drag the slider</div><script>steal()</script>",
            }},
            {"type": "blockMagic", "attrs": {"title": "Empty", "htmlContent": None}},
        ))
        assert text == (
            "$$ E = mc^2 $$\nLink: Docs\nReference\nResource: Syllabus.pdf\n"
            "Interactive element: Simulator\nDrag the slider"
        )

    def test_malformed_attribute_nodes_are_skipped(self):
        text = dynamic.extract_text_from_prosemirror(_doc(
            {"type": "blockQuiz", "attrs": "nope"},
            {"type": "blockQuiz", "attrs": {"questions": [{"question": ""}, 5]}},
            {"type": "flipcard"},
            {"type": "blockLibrary", "attrs": {"snapshot": "x"}},
            {"type": "blockCode", "attrs": {"hints": None}},
        ))
        assert text == ""


def _block(block_id, activity, block_type, **content):
    return Block(
        id=block_id,
        block_type=block_type,
        content={"activity_uuid": activity.activity_uuid, **content},
        org_id=activity.org_id,
        course_id=activity.course_id,
        activity_id=activity.id,
        block_uuid=f"block_{block_id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )


class TestDynamicPageBlocks:
    async def _page(self, db, org, course, chapter, blocks):
        activity = await add_activity(
            db, org, course, chapter, 20,
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content=_doc({"type": "paragraph", "content": [{"type": "text", "text": "Intro"}]}),
            name="Cells",
        )
        for block in blocks(activity):
            db.add(block)
        await db.commit()
        return activity

    async def test_pdf_block_is_read_from_its_real_path_per_page(self, db, org, course, chapter):
        await self._page(db, org, course, chapter, lambda a: [
            _block(1, a, BlockTypeEnum.BLOCK_DOCUMENT_PDF, file_id="block_abc", file_format="pdf"),
        ])
        key = f"{ACTIVITY_DIR}/activity_20/dynamic/blocks/pdfBlock/block_1/block_abc.pdf"
        reads, read = _storage({key: make_pdf(["Page one text", "Page two text"])})
        with patch("src.services.ai.rag.formats.read_file_content", side_effect=read):
            extraction = await _extract(db, 20)

        assert reads == [key]
        pdf = [s for s in extraction.segments if s.source_type == SourceType.PDF_BLOCK]
        assert [(s.text, s.locator, s.block_uuid) for s in pdf] == [
            ("Page one text", {"page": 1}, "block_1"),
            ("Page two text", {"page": 2}, "block_1"),
        ]
        assert _texts(extraction, SourceType.PAGE) == ["Intro"]

    @pytest.mark.parametrize("file_id,file_format", [
        ("../../etc/passwd", "pdf"),
        ("block_abc", "pdf/../../x"),
        (None, "pdf"),
    ])
    async def test_pdf_block_with_unsafe_file_name_is_never_read(self, db, org, course, chapter, file_id, file_format):
        await self._page(db, org, course, chapter, lambda a: [
            _block(1, a, BlockTypeEnum.BLOCK_DOCUMENT_PDF, file_id=file_id, file_format=file_format),
        ])
        reads, read = _storage({})
        with patch("src.services.ai.rag.formats.read_file_content", side_effect=read):
            await _extract(db, 20)
        assert reads == []

    async def test_audio_block_transcript_is_indexed_with_timestamps(self, db, org, course, chapter):
        await self._page(db, org, course, chapter, lambda a: [
            _block(2, a, BlockTypeEnum.BLOCK_AUDIO, file_id="block_x", file_format="mp3", file_name="lecture.mp3"),
        ])
        transcript = f"{ACTIVITY_DIR}/activity_20/dynamic/blocks/audioBlock/block_2/transcripts/block_x.mp3.vtt"
        _, read = _storage({transcript: VTT.encode()})
        with patch("src.services.ai.rag.media.read_file_content", side_effect=read):
            extraction = await _extract(db, 20)

        audio = [s for s in extraction.segments if s.source_type == SourceType.AUDIO_BLOCK]
        assert audio[0].text == "Audio in activity 'Cells': lecture.mp3"
        assert [(s.text, s.locator) for s in audio[1:]] == [
            ("Mitochondria make energy. They have their own DNA.", {"start": 1.0}),
            ("Ribosomes build proteins.", {"start": 65.0}),
        ]
        assert extraction.pending_media == []

    async def test_video_block_without_transcript_is_queued_once(self, db, org, course, chapter):
        await self._page(db, org, course, chapter, lambda a: [
            _block(3, a, BlockTypeEnum.BLOCK_VIDEO, file_id="block_v", file_format="mp4"),
            _block(4, a, BlockTypeEnum.BLOCK_VIDEO, file_id="block_w", file_format="mp4",
                   transcript={"source": "block_w.mp4", "status": "failed"}),
        ])
        with patch("src.services.ai.rag.media.read_file_content", return_value=None):
            extraction = await _extract(db, 20)

        # block_4 was already attempted for this exact file: not retried automatically.
        assert [m.owner_id for m in extraction.pending_media] == [3]
        media = extraction.pending_media[0]
        assert media.owner == "block"
        assert media.source_key == f"{ACTIVITY_DIR}/activity_20/dynamic/blocks/videoBlock/block_3/block_v.mp4"

    async def test_image_and_custom_blocks(self, db, org, course, chapter):
        await self._page(db, org, course, chapter, lambda a: [
            _block(5, a, BlockTypeEnum.BLOCK_IMAGE, file_name="cell.png", alt="Animal cell diagram"),
            _block(6, a, BlockTypeEnum.BLOCK_CUSTOM, note="Remember the membrane", size=3),
        ])
        extraction = await _extract(db, 20)
        assert _texts(extraction, SourceType.IMAGE_BLOCK) == [
            "Image in activity 'Cells'. File: cell.png. Description: Animal cell diagram"
        ]
        assert _texts(extraction, SourceType.CUSTOM_BLOCK) == ["Remember the membrane"]


# ---------------------------------------------------------------------------
# Documents, video, custom
# ---------------------------------------------------------------------------


class TestDocument:
    async def test_pdf_is_read_from_the_filename_the_upload_stored(self, db, org, course, chapter):
        await add_activity(
            db, org, course, chapter, 30,
            activity_type=ActivityTypeEnum.TYPE_DOCUMENT,
            sub_type=ActivitySubTypeEnum.SUBTYPE_DOCUMENT_PDF,
            content={"filename": "documentpdf_123.pdf", "activity_uuid": "activity_30"},
        )
        key = f"{ACTIVITY_DIR}/activity_30/documentpdf/documentpdf_123.pdf"
        reads, read = _storage({key: make_pdf(["Osmosis basics", "", "Diffusion"])})
        with patch("src.services.ai.rag.formats.read_file_content", side_effect=read):
            extraction = await _extract(db, 30)
        assert reads == [key]
        docs = [s for s in extraction.segments if s.source_type == SourceType.DOCUMENT]
        assert [(s.text, s.locator) for s in docs] == [
            ("Osmosis basics", {"page": 1}),
            ("Diffusion", {"page": 3}),
        ]

    @pytest.mark.parametrize("content", [{"filename": "../../../etc/passwd"}, {"file_id": "x.pdf"}, {}])
    async def test_unsafe_or_missing_filename_is_not_read(self, db, org, course, chapter, content):
        await add_activity(
            db, org, course, chapter, 31,
            activity_type=ActivityTypeEnum.TYPE_DOCUMENT,
            sub_type=ActivitySubTypeEnum.SUBTYPE_DOCUMENT_PDF,
            content=content,
        )
        reads, read = _storage({})
        with patch("src.services.ai.rag.formats.read_file_content", side_effect=read):
            await _extract(db, 31)
        assert reads == []


class TestVideo:
    async def test_hosted_video_is_indexed_from_its_transcript(self, db, org, course, chapter):
        await add_activity(
            db, org, course, chapter, 40,
            activity_type=ActivityTypeEnum.TYPE_VIDEO,
            sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
            content={"filename": "video_1.mp4"},
        )
        key = f"{ACTIVITY_DIR}/activity_40/video/transcripts/video_1.mp4.vtt"
        _, read = _storage({key: VTT.encode()})
        with patch("src.services.ai.rag.media.read_file_content", side_effect=read):
            extraction = await _extract(db, 40)
        video = [s for s in extraction.segments if s.source_type == SourceType.VIDEO]
        assert [s.locator for s in video] == [{"start": 1.0}, {"start": 65.0}]

    async def test_ready_captions_are_used_when_there_is_no_transcript(self, db, org, course, chapter):
        await add_activity(
            db, org, course, chapter, 41,
            activity_type=ActivityTypeEnum.TYPE_VIDEO,
            sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
            content={"filename": "video_2.mp4"},
            extra_metadata={"captions": {"source_language": "fr", "languages": [
                {"code": "en", "status": "ready"}, {"code": "fr", "status": "ready"},
            ]}},
        )
        captions = f"{ACTIVITY_DIR}/activity_41/video/captions/fr.vtt"
        reads, read = _storage({captions: VTT.encode()})
        with patch("src.services.ai.rag.media.read_file_content", side_effect=read):
            extraction = await _extract(db, 41)
        assert reads[-1] == captions
        assert extraction.pending_media == []
        assert len(_texts(extraction, SourceType.VIDEO)) == 2

    async def test_untranscribed_video_is_queued_for_transcription(self, db, org, course, chapter):
        await add_activity(
            db, org, course, chapter, 42,
            activity_type=ActivityTypeEnum.TYPE_VIDEO,
            sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
            content={"filename": "video_3.mp4"},
            extra_metadata={"transcript": {"source": "an_older_upload.mp4", "status": "done"}},
        )
        with patch("src.services.ai.rag.media.read_file_content", return_value=None):
            extraction = await _extract(db, 42)
        # The stored status is for a replaced file, so this one is new.
        assert [(m.owner, m.owner_id) for m in extraction.pending_media] == [("activity", 42)]

    async def test_youtube_is_indexed_by_name_only(self, db, org, course, chapter):
        await add_activity(
            db, org, course, chapter, 43,
            activity_type=ActivityTypeEnum.TYPE_VIDEO,
            sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE,
            content={"uri": "https://youtube.com/watch?v=x"},
            name="Intro lecture",
        )
        extraction = await _extract(db, 43)
        assert _texts(extraction) == ["Activity: Intro lecture"]
        assert extraction.pending_media == []


class TestCustom:
    async def test_custom_content_prose_only(self, db, org, course, chapter):
        await add_activity(
            db, org, course, chapter, 50,
            activity_type=ActivityTypeEnum.TYPE_CUSTOM,
            sub_type=ActivitySubTypeEnum.SUBTYPE_CUSTOM,
            content={"title": "Glossary", "items": [{"term": "Cell", "id": "c1", "url": "https://x"}]},
        )
        extraction = await _extract(db, 50)
        assert _texts(extraction, SourceType.CUSTOM) == ["Glossary\nCell"]


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------


SECRET = "SECRET_ANSWER_KEY"


async def _assignment(db, org, course, chapter, activity, *, published=True):
    assignment = Assignment(
        id=1, title="Cell biology homework", description="Answer every question.",
        due_date=None, published=published, grading_type=GradingTypeEnum.NUMERIC,
        solution=SECRET, solution_file="solution.pdf",
        org_id=org.id, course_id=course.id, chapter_id=chapter.id, activity_id=activity.id,
        assignment_uuid="assignment_1", creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(assignment)
    tasks = [
        (AssignmentTaskTypeEnum.QUIZ, {"questions": [{
            "questionText": "Which organelle makes ATP?",
            "options": [
                {"text": "Mitochondria", "assigned_right_answer": SECRET},
                {"text": "Golgi", "assigned_right_answer": False},
            ],
        }]}),
        (AssignmentTaskTypeEnum.FORM, {"questions": [{
            "questionText": "Fill the blank", "blanks": [{"correctAnswer": SECRET}],
        }]}),
        (AssignmentTaskTypeEnum.SHORT_ANSWER, {"correct_answers": [SECRET], "explanation": SECRET}),
        (AssignmentTaskTypeEnum.NUMBER_ANSWER, {"correct_value": SECRET, "tolerance": 0}),
        (AssignmentTaskTypeEnum.CODE, {"solution_code": SECRET, "test_cases": [{"expectedStdout": SECRET}]}),
    ]
    for i, (task_type, contents) in enumerate(tasks, start=1):
        db.add(AssignmentTask(
            id=i, title=f"Task {i}", description=f"Do part {i}", hint=f"Hint {i}" if i == 1 else "",
            reference_file="brief.pdf" if i == 1 else None, assignment_type=task_type, contents=contents,
            assignment_task_uuid=f"task_{i}", order=len(tasks) - i,
            org_id=org.id, course_id=course.id, chapter_id=chapter.id, activity_id=activity.id,
            assignment_id=1, creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
    await db.commit()


class TestAssignment:
    async def _activity(self, db, org, course, chapter):
        return await add_activity(
            db, org, course, chapter, 60,
            activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
            sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY,
        )

    async def test_indexes_prompts_and_never_answer_keys(self, db, org, course, chapter):
        activity = await self._activity(db, org, course, chapter)
        await _assignment(db, org, course, chapter, activity)
        ref = f"{ACTIVITY_DIR}/activity_60/assignments/assignment_1/tasks/task_1/brief.pdf"
        reads, read = _storage({ref: make_pdf(["Read chapter two"])})
        with patch("src.services.ai.rag.formats.read_file_content", side_effect=read):
            extraction = await _extract(db, 60)

        everything = "\n".join(_texts(extraction))
        assert SECRET not in everything
        assert "solution" not in everything.lower()
        texts = _texts(extraction, SourceType.ASSIGNMENT)
        assert texts[0] == "Assignment: Cell biology homework\nAnswer every question."
        # Tasks follow their authored order (task 5 first here).
        assert texts[1].startswith("Task: Task 5")
        quiz = next(t for t in texts if t.startswith("Task: Task 1"))
        assert quiz == "Task: Task 1\nDo part 1\nHint: Hint 1\nQuestion: Which organelle makes ATP?\n- Mitochondria\n- Golgi"
        assert "Question: Fill the blank" in everything
        pages = [s for s in extraction.segments if s.locator == {"page": 1}]
        assert [(s.text, s.block_uuid) for s in pages] == [("Read chapter two", "task_1")]
        assert reads == [ref]

    async def test_unpublished_assignment_is_not_indexed(self, db, org, course, chapter):
        activity = await self._activity(db, org, course, chapter)
        await _assignment(db, org, course, chapter, activity, published=False)
        extraction = await _extract(db, 60)
        assert _texts(extraction, SourceType.ASSIGNMENT) == []


# ---------------------------------------------------------------------------
# Course-level text
# ---------------------------------------------------------------------------


class TestCourse:
    async def test_course_and_chapters(self, db, org, course, chapter):
        course.about = "A tour of the cell."
        course.learnings = '[{"id": "l1", "text": "Name the organelles", "emoji": "🔬"}]'
        course.tags = "biology,cells"
        db.add(course)
        db.add(Chapter(
            id=2, name="Membranes", description="", org_id=org.id, course_id=course.id,
            chapter_uuid="chapter_2", creation_date="", update_date="",
        ))
        await db.commit()

        extraction = await extract(ContentRef.course(course.id), db)
        assert extraction.activity_id is None
        course_text, *chapters = extraction.segments
        assert course_text.source_type == SourceType.COURSE
        assert course_text.text == (
            "Course: Test Course\nA test course\nAbout: A tour of the cell.\n"
            "What you will learn:\n- Name the organelles\nTags: biology,cells"
        )
        assert [(s.text, s.block_uuid, s.chapter_name) for s in chapters] == [
            ("Chapter: Test Chapter\nA test chapter", "chapter_test", "Test Chapter"),
            ("Chapter: Membranes", "chapter_2", "Membranes"),
        ]

    async def test_plain_text_learnings(self, db, org, course):
        course.learnings = "Everything about cells"
        db.add(course)
        await db.commit()
        extraction = await extract(ContentRef.course(course.id), db)
        assert "What you will learn:\n- Everything about cells" in extraction.segments[0].text


# ---------------------------------------------------------------------------
# Format helpers
# ---------------------------------------------------------------------------


class TestFormats:
    def test_pdf_pages_respects_the_budget(self):
        pages = formats.pdf_pages(make_pdf(["abcdefghij", "klmnopqrst"]), max_chars=15)
        assert pages == [(1, "abcdefghij"), (2, "klmno")]

    def test_pdf_pages_of_garbage_is_empty(self):
        assert formats.pdf_pages(b"not a pdf") == []

    def test_vtt_windows_handles_hours_and_commas(self):
        vtt = "WEBVTT\n\n1\n01:00:00,500 --> 01:00:02,000\nLate cue\n\n00:00:01.000 --> 00:00:02.000\n\n"
        assert formats.vtt_windows(vtt) == [(3600.5, "Late cue")]
        assert formats.vtt_windows("") == []

    def test_html_text_drops_scripts_and_styles(self):
        assert formats.html_text("<style>p{}</style><p>Hi</p><script>x()</script>") == "Hi"

    def test_safe_names(self):
        assert formats.is_safe_file_name("video.mp4")
        for bad in ("", "..", "a/b", "a\\b", "a\x00", None, 3):
            assert not formats.is_safe_file_name(bad)


class TestEERegistration:
    def test_ee_hook_is_called_when_present(self):
        from src.core import ee_hooks

        hooks = type("Hooks", (), {"register_rag_sources": staticmethod(lambda: calls.append(1))})
        calls: list[int] = []
        with patch.object(ee_hooks, "get_ee_hooks", return_value=hooks):
            ee_hooks.register_ee_rag_sources()
        assert calls == [1]

    def test_ee_failure_never_breaks_core(self):
        from src.core import ee_hooks

        def boom():
            raise RuntimeError("bad ee")

        hooks = type("Hooks", (), {"register_rag_sources": staticmethod(boom)})
        with patch.object(ee_hooks, "get_ee_hooks", return_value=hooks):
            ee_hooks.register_ee_rag_sources()  # logged, not raised
        with patch.object(ee_hooks, "get_ee_hooks", return_value=None):
            ee_hooks.register_ee_rag_sources()
