"""Tests for the content_extraction helpers other AI features import.

The traversal guard rejects empty/NUL/absolute/`..` paths before any file
read; the TipTap walker output is pinned so moving it into the source
registry changed nothing for quiz, scenario and assignment generation.
"""
import json

from src.services.ai.rag import content_extraction as ce
from src.tests.services.rag_helpers import ActivitySubTypeEnum, ActivityTypeEnum, add_activity


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


# --- walker compatibility ------------------------------------------------
# Output for the node types the walker handled before the source registry,
# including malformed children; must stay byte-identical.

_LEGACY_DOC = json.loads('{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Cells"}]}, {"type": "heading", "attrs": {"level": 99}, "content": [{"type": "text", "text": "Deep"}]}, {"type": "paragraph", "content": [{"type": "text", "text": "A cell is "}, {"type": "text", "marks": [{"type": "bold"}], "text": "small"}, {"type": "hardBreak"}, {"type": "text", "text": "line2"}]}, {"type": "bulletList", "content": [{"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "one"}]}, {"type": "orderedList", "content": [{"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "nested"}]}]}]}]}]}, {"type": "blockquote", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "quoted"}]}, {"type": "paragraph", "content": [{"type": "text", "text": "twice"}]}]}, {"type": "codeBlock", "content": [{"type": "text", "text": "print(1)"}]}, {"type": "calloutInfo", "content": [{"type": "text", "text": "note"}]}, {"type": "calloutWarning", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "warn"}]}]}, {"type": "callout", "attrs": {"type": "info"}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "generic callout"}]}]}, {"type": "table", "content": [{"type": "tableRow", "content": [{"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "a"}]}]}, {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "b"}]}]}]}]}, {"type": "blockH5P", "attrs": {"h5pUrl": "https://h5p.example/1", "title": "Drag"}}, {"type": "blockImage", "attrs": {"blockObject": {"x": 1}}}, {"type": "paragraph", "content": "bad"}, "junk", {"type": "text", "text": "bare"}]}')


def test_walker_output_for_legacy_node_types_is_unchanged():
    assert ce.extract_text_from_prosemirror(_LEGACY_DOC) == (
        "## Cells\n###### Deep\nA cell is small\nline2\n- nested\n- one\n> quoted\n> twice\n"
        "```\nprint(1)\n```\n[calloutInfo] note\n[calloutWarning] warn\ngeneric callout\n"
        "a | b\n[H5P interactive content] Drag\nbare"
    )


def test_walker_ignores_non_documents():
    assert ce.extract_text_from_prosemirror(None) == ""
    assert ce.extract_text_from_prosemirror("text") == ""


# --- extract_all_course_content -------------------------------------------

async def test_extract_all_course_content_one_item_per_activity(db, org, course, chapter):
    await add_activity(
        db, org, course, chapter, 70,
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Hello"}]}]},
        name="Welcome",
    )
    items = await ce.extract_all_course_content(course.id, org.id, db)
    assert items == [{
        "text": "Activity: Welcome\n\nHello",
        "activity_id": 70,
        "activity_uuid": "activity_70",
        "activity_name": "Welcome",
        "chapter_name": "Test Chapter",
        "course_name": "Test Course",
    }]


async def test_extract_all_course_content_is_scoped_to_the_org(db, org, other_org, course, chapter):
    await add_activity(
        db, org, course, chapter, 71,
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
    )
    assert await ce.extract_all_course_content(course.id, other_org.id, db) == []


# --- blockH5P extraction --------------------------------------------------
# The H5P block is embed-only: the interactive content lives on the author's
# own host, so the author-supplied title is the only text the indexer has.

def test_h5p_block_indexes_its_title():
    parts: list[str] = []
    ce._walk_prosemirror_node(
        {
            "type": "blockH5P",
            "attrs": {"h5pUrl": "https://team.h5p.com/content/1/embed", "title": "Cell Quiz"},
        },
        parts,
    )
    assert parts == ["[H5P interactive content] Cell Quiz"]


def test_h5p_block_without_a_title_contributes_nothing():
    parts: list[str] = []
    ce._walk_prosemirror_node(
        {"type": "blockH5P", "attrs": {"h5pUrl": "https://team.h5p.com/content/1/embed"}},
        parts,
    )
    assert parts == []


def test_h5p_block_emptied_by_the_author_stops_being_indexed():
    # Removing the embed clears the URL; a title left over from the old
    # content must not keep showing up in search.
    parts: list[str] = []
    ce._walk_prosemirror_node(
        {"type": "blockH5P", "attrs": {"h5pUrl": "   ", "title": "Cell Quiz"}},
        parts,
    )
    assert parts == []


def test_h5p_block_without_attrs_is_skipped_not_crashed():
    parts: list[str] = []
    ce._walk_prosemirror_node({"type": "blockH5P"}, parts)
    assert parts == []


def test_h5p_block_nested_in_a_document_is_reached():
    parts: list[str] = []
    ce._walk_prosemirror_node(
        {
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "Intro"}]},
                {
                    "type": "blockH5P",
                    "attrs": {"h5pUrl": "https://example.org/h5p/embed/9", "title": "Drag words"},
                },
            ],
        },
        parts,
    )
    assert parts == ["Intro", "[H5P interactive content] Drag words"]
