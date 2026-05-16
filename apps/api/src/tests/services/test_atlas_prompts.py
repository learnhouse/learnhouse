"""Snapshots for render_focus_block — guards against prompt drift."""

from src.services.ai.atlas.prompts import render_focus_block


def test_no_context_returns_none_marker():
    out = render_focus_block(page_context=None, course_snapshot=None)
    assert "CURRENT FOCUS" in out
    assert "(none" in out


def test_course_only():
    snapshot = {"name": "Algebra 1", "published": True, "chapters": []}
    out = render_focus_block(
        page_context={"course_uuid": "course_x"},
        course_snapshot=snapshot,
    )
    assert "Algebra 1" in out
    assert "course_x" in out
    assert "published" in out


def test_large_course_falls_back_to_chapter_only():
    chapters = [
        {
            "chapter_id": i,
            "name": f"Chapter {i}",
            "activity_count": 25,
            "activities": [{"name": f"a{j}"} for j in range(25)],
        }
        for i in range(15)
    ]
    out = render_focus_block(
        page_context={"course_uuid": "course_big"},
        course_snapshot={"name": "Big", "chapters": chapters},
        inline_activity_limit=200,
    )
    assert "activity list elided" in out
    assert "a1" not in out  # individual activities not inlined


def test_references_listed():
    out = render_focus_block(
        page_context={"course_uuid": "course_x"},
        course_snapshot={"name": "X", "chapters": []},
        references=[{"type": "activity", "name": "Quiz 1", "uuid": "activity_q1"}],
    )
    assert "USER REFERENCES" in out
    assert "Quiz 1" in out
