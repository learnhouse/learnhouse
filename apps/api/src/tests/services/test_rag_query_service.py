"""Retrieval output: citable sources and labelled context for the model."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from src.services.ai.rag import query_service
from src.services.ai.rag.types import Source


def _row(**overrides):
    row = {
        "id": 1, "course_id": 1, "activity_id": 7, "activity_uuid": "activity_7", "activity_name": "Lecture",
        "chapter_name": "Week 1", "course_name": "Biology", "course_uuid": "course_bio", "source_type": "video",
        "block_uuid": None, "locator": {"start": 192.4}, "chunk_text": "Mitochondria make ATP.", "distance": 0.25,
    }
    row.update(overrides)
    return SimpleNamespace(**row)


class TestSourceFromRow:
    def test_maps_every_field(self):
        source = query_service.source_from_row(_row())
        assert source.to_dict() == {
            "source_type": "video", "course_uuid": "course_bio", "course_name": "Biology",
            "chapter_name": "Week 1", "activity_uuid": "activity_7", "activity_name": "Lecture",
            "block_uuid": None, "locator": {"start": 192.4}, "title": "Lecture",
            "snippet": "Mitochondria make ATP.", "similarity": 0.75,
        }

    def test_course_and_chapter_rows_are_titled_by_what_they_describe(self):
        chapter = query_service.source_from_row(
            _row(activity_id=None, activity_uuid="", activity_name="", source_type="chapter", locator=None)
        )
        assert (chapter.activity_uuid, chapter.title) == (None, "Week 1")
        course = query_service.source_from_row(
            _row(activity_id=None, activity_uuid="", activity_name="", chapter_name="", source_type="course")
        )
        assert course.title == "Biology"

    def test_locator_stored_as_text_is_decoded(self):
        source = query_service.source_from_row(_row(locator=json.dumps({"page": 3}), distance=None))
        assert (source.locator, source.similarity) == ({"page": 3}, None)

    def test_snippet_is_capped(self):
        assert len(query_service.source_from_row(_row(chunk_text="x" * 1000)).snippet) == query_service.SNIPPET_CHARS


class TestLabels:
    def test_format_timestamp(self):
        assert query_service.format_timestamp(0) == "00:00"
        assert query_service.format_timestamp(192.9) == "03:12"
        assert query_service.format_timestamp(3725) == "1:02:05"

    def test_source_label(self):
        label = query_service.source_label
        assert label(Source("video", "c", "C", title="Intro", locator={"start": 75})) == 'Video "Intro" at 01:15'
        assert label(Source("document_activity", "c", "C", title="Guide", locator={"page": 4})) == 'PDF "Guide", page 4'
        assert label(Source("chapter", "c", "C", title="Week 1")) == 'Chapter "Week 1"'
        assert label(Source("something_new", "c", "C", title="X")) == 'Content "X"'


class TestQueryCourseRag:
    async def test_numbers_sources_per_place_and_labels_context(self):
        rows = [
            _row(chunk_text="first"),
            _row(chunk_text="second", locator={"start": 900}),  # same video: same number
            _row(activity_id=None, activity_uuid="", activity_name="", chapter_name="", source_type="course",
                 locator=None, chunk_text="course one"),
            # The course row of another course must not merge with the first one.
            _row(activity_id=None, activity_uuid="", activity_name="", chapter_name="", source_type="course",
                 locator=None, course_uuid="course_chem", course_name="Chemistry", chunk_text="course two"),
        ]
        scope = SimpleNamespace(course_ids=[1])
        with patch.object(query_service, "search_course_content", new=AsyncMock(return_value=rows)):
            result = await query_service.query_course_rag("q", 1, None, scope)

        assert [s["title"] for s in result["sources"]] == ["Lecture", "Biology", "Chemistry"]
        # The best-ranked chunk's moment is the one cited.
        assert result["sources"][0]["locator"] == {"start": 192.4}
        parts = result["context"].split("\n\n---\n\n")
        assert parts[0] == '[Source 1] Video "Lecture" at 03:12\nfirst'
        assert parts[1] == '[Source 1] Video "Lecture" at 15:00\nsecond'
        assert parts[2].startswith('[Source 2] Course "Biology"')
        assert parts[3].startswith('[Source 3] Course "Chemistry"')

    async def test_nothing_found(self):
        with patch.object(query_service, "search_course_content", new=AsyncMock(return_value=[])):
            assert await query_service.query_course_rag("q", 1, None, SimpleNamespace(course_ids=[1])) == {
                "context": "", "sources": [],
            }
