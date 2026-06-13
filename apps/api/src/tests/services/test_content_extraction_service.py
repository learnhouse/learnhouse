"""Behavioral tests for the _is_safe_content_path traversal guard.

Covers src/services/ai/rag/content_extraction.py line 14 (import os,
transitively), the helper at lines 32-49, and its two call sites at 203
(PDF block) and 354 (document activity). Block file paths are persisted from
user input, so the guard rejects empty/NUL/absolute/`..` paths before any
file read.
"""
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from src.services.ai.rag import content_extraction as ce


# --- direct unit tests of the helper -------------------------------------

def test_rejects_none():
    assert ce._is_safe_content_path(None) is False


def test_rejects_empty_string():
    assert ce._is_safe_content_path("") is False


def test_rejects_non_string():
    assert ce._is_safe_content_path(12345) is False


def test_rejects_absolute_unix_path():
    assert ce._is_safe_content_path("/etc/passwd") is False


def test_rejects_parent_traversal():
    assert ce._is_safe_content_path("../../x") is False


def test_rejects_traversal_in_middle():
    assert ce._is_safe_content_path("orgs/1/../../etc/passwd") is False


def test_rejects_nul_byte():
    assert ce._is_safe_content_path("a\x00b") is False


def test_rejects_backslash_absolute():
    # backslashes are normalized to forward slashes before the leading-slash check
    assert ce._is_safe_content_path("\\windows\\system32") is False


def test_accepts_safe_relative_path():
    assert ce._is_safe_content_path("orgs/1/courses/2/file.pdf") is True


def test_accepts_simple_filename():
    assert ce._is_safe_content_path("file.pdf") is True


def test_dotdot_substring_in_filename_is_allowed():
    # ".." must be a whole path *component* to be rejected; a filename that
    # merely contains the substring is fine.
    assert ce._is_safe_content_path("orgs/my..notes/file.pdf") is True


# --- call site coverage: PDF block (line 203) ----------------------------

class _FakeBlock:
    def __init__(self, file_path):
        self.block_type = ce.BlockTypeEnum.BLOCK_DOCUMENT_PDF
        self.content = {"file_id": file_path}


def _pdf_block(file_path):
    return ce._extract_block_content(_FakeBlock(file_path), activity_name="A")


def test_pdf_block_unsafe_path_short_circuits_without_reading():
    with patch.object(ce, "read_file_content") as read_mock:
        assert _pdf_block("/etc/passwd") is None
        read_mock.assert_not_called()


def test_pdf_block_safe_path_proceeds_to_read():
    with patch.object(ce, "read_file_content", return_value=b"%PDF-1.4 bytes") as read_mock, \
         patch.object(ce, "extract_text_from_pdf", return_value="extracted text"):
        result = _pdf_block("orgs/1/courses/2/file.pdf")
        read_mock.assert_called_once_with("orgs/1/courses/2/file.pdf")
        assert result == {"text": "extracted text", "source_type": "pdf_block"}


# --- call site coverage: document activity (line 354) --------------------

class _Result:
    """Stand-in for the object returned by AsyncSession.execute()."""

    def __init__(self, items):
        self._items = items

    def scalars(self):
        return self

    def first(self):
        return self._items[0] if self._items else None

    def all(self):
        return self._items


class _FakeDBSession:
    """Returns queued results in call order for each execute()."""

    def __init__(self, results):
        self._results = list(results)

    async def execute(self, _query):
        return self._results.pop(0)


@pytest.mark.asyncio
async def test_document_activity_guard_blocks_unsafe_path():
    course = SimpleNamespace(id=1, name="Course")
    activity = SimpleNamespace(
        id=10,
        name="Doc",
        activity_uuid="act_1",
        activity_type=ce.ActivityTypeEnum.TYPE_DOCUMENT,
        content={"file_id": "../../etc/passwd"},
        course_id=1,
    )
    # execute() call order: course, chapters, activities, chapter_activity
    db = _FakeDBSession([
        _Result([course]),
        _Result([]),          # chapters
        _Result([activity]),  # activities
        _Result([]),          # chapter_activity join
    ])
    with patch.object(ce, "read_file_content") as read_mock:
        results = await ce.extract_all_course_content(1, 1, db)
        read_mock.assert_not_called()
    assert results == []


@pytest.mark.asyncio
async def test_document_activity_safe_path_extracts_text():
    course = SimpleNamespace(id=1, name="Course")
    activity = SimpleNamespace(
        id=10,
        name="Doc",
        activity_uuid="act_1",
        activity_type=ce.ActivityTypeEnum.TYPE_DOCUMENT,
        content={"file_id": "orgs/1/courses/2/file.pdf"},
        course_id=1,
    )
    db = _FakeDBSession([
        _Result([course]),
        _Result([]),
        _Result([activity]),
        _Result([]),
    ])
    with patch.object(ce, "read_file_content", return_value=b"%PDF bytes") as read_mock, \
         patch.object(ce, "extract_text_from_pdf", return_value="doc text"):
        results = await ce.extract_all_course_content(1, 1, db)
        read_mock.assert_called_once_with("orgs/1/courses/2/file.pdf")
    assert len(results) == 1
    assert results[0]["text"] == "doc text"
    assert results[0]["source_type"] == "document_activity"
