"""Unit tests for the Atlas resolver.

Pure tests against a synthetic snapshot — no Redis, no DB, no LLM.
Exercises each resolution path (chip/page/uuid/recent/exact/ordinal/
fuzzy) and the threshold edge cases that decide
Resolved vs Ambiguous vs NotFound.
"""

from __future__ import annotations

import pytest

from src.services.ai.atlas.resolver import (
    Ambiguous,
    NotFound,
    PageContextDTO,
    ReferenceDTO,
    Resolved,
    ResolveRequest,
    resolve,
)
from src.services.ai.atlas.snapshots import (
    ActivityNode,
    ChapterNode,
    CourseSnapshot,
)


@pytest.fixture
def snapshot() -> CourseSnapshot:
    return CourseSnapshot(
        course_uuid="course_abc",
        course_id=1,
        course_name="DNS Fundamentals",
        published=False,
        chapters=[
            ChapterNode(
                uuid="chapter_intro_abcdef",
                id=10,
                name="Introduction",
                position=0,
                activities=[
                    ActivityNode(uuid="activity_a1b2c3d4", name="Welcome", position=0),
                    ActivityNode(uuid="activity_whatdns_a2", name="What is DNS?", position=1),
                ],
            ),
            ChapterNode(
                uuid="chapter_basics_bcdef0",
                id=11,
                name="Network basics",
                position=1,
                activities=[
                    ActivityNode(uuid="activity_subnet_b1", name="Subnetting", position=0),
                    ActivityNode(uuid="activity_ipbasic_b2", name="IP basics", position=1),
                ],
            ),
        ],
    )


def _req(selector: str, kind: str, snapshot=None, **kwargs) -> ResolveRequest:
    pc = kwargs.pop("page_context", None) or PageContextDTO(course_uuid="course_abc")
    return ResolveRequest(
        selector=selector,
        kind=kind,
        page_context=pc,
        snapshot=snapshot,
        **kwargs,
    )


def test_uuid_prefix_match(snapshot):
    r = resolve(_req("activity_a1b2c3d4", "activity", snapshot=snapshot))
    assert isinstance(r, Resolved)
    assert r.via == "uuid"
    assert r.uuid == "activity_a1b2c3d4"


def test_uuid_kind_mismatch_returns_not_found(snapshot):
    # selector is a chapter uuid but caller asked for an activity
    r = resolve(_req("chapter_intro_abcdef", "activity", snapshot=snapshot))
    assert isinstance(r, NotFound)


def test_exact_name_match(snapshot):
    r = resolve(_req("welcome", "activity", snapshot=snapshot))
    assert isinstance(r, Resolved)
    assert r.via == "exact"
    assert r.name == "Welcome"


def test_exact_name_with_punctuation(snapshot):
    r = resolve(_req("what is dns", "activity", snapshot=snapshot))
    assert isinstance(r, Resolved)
    assert r.uuid == "activity_whatdns_a2"


def test_ordinal_match_within_chapter_scope(snapshot):
    pc = PageContextDTO(course_uuid="course_abc", chapter_id=11)
    r = resolve(_req("the second activity", "activity", snapshot=snapshot, page_context=pc))
    assert isinstance(r, Resolved)
    assert r.via == "ordinal"
    assert r.name == "IP basics"


def test_ordinal_chapter_match(snapshot):
    r = resolve(_req("2nd chapter", "chapter", snapshot=snapshot))
    assert isinstance(r, Resolved)
    assert r.via == "ordinal"
    assert r.uuid == "chapter_basics_bcdef0"


def test_ordinal_last_chapter(snapshot):
    r = resolve(_req("last chapter", "chapter", snapshot=snapshot))
    assert isinstance(r, Resolved)
    assert r.name == "Network basics"


def test_page_context_deictic(snapshot):
    pc = PageContextDTO(course_uuid="course_abc", chapter_id=10, activity_uuid="activity_whatdns_a2")
    r = resolve(_req("this", "activity", snapshot=snapshot, page_context=pc))
    assert isinstance(r, Resolved)
    assert r.via == "page"
    assert r.uuid == "activity_whatdns_a2"


def test_chip_reference(snapshot):
    ref = ReferenceDTO(kind="activity", uuid="activity_ipbasic_b2", name="IP basics")
    r = resolve(_req("", "activity", snapshot=snapshot, references=[ref]))
    assert isinstance(r, Resolved)
    assert r.via == "chip"
    assert r.uuid == "activity_ipbasic_b2"


def test_fuzzy_prefix_match(snapshot):
    # "intro" should match the lone "Introduction" chapter (prefix bonus)
    r = resolve(_req("intro", "chapter", snapshot=snapshot))
    assert isinstance(r, Resolved)
    assert r.via == "fuzzy"


def test_not_found_with_suggestions(snapshot):
    r = resolve(_req("quantum gravity", "activity", snapshot=snapshot))
    assert isinstance(r, NotFound)
    # Returns up to 3 closest suggestions even when score is low.
    assert len(r.suggestions) > 0
    assert len(r.suggestions) <= 3


def test_no_snapshot_returns_not_found(snapshot):
    r = resolve(_req("any activity name", "activity", snapshot=None))
    assert isinstance(r, NotFound)
