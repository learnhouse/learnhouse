"""Tests for src/services/ai/chapters.py (captions to video chapters engine)."""

import pytest

from src.services.ai import chapters as chap

VTT = """WEBVTT

00:00.000 --> 00:04.000
<v Narrator>Welcome to the course.</v>

00:01:10.500 --> 00:01:14.000
Now we set up the project
with two lines.

1:02:03.000 --> 1:02:05.000
Wrapping up.
"""


def test_parse_vtt_cues_handles_optional_hours_tags_and_multiline():
    cues = chap.parse_vtt_cues(VTT)
    assert cues == [
        (0.0, 4.0, "Welcome to the course."),
        (70.5, 74.0, "Now we set up the project with two lines."),
        (3723.0, 3725.0, "Wrapping up."),
    ]


def test_parse_vtt_cues_skips_empty_cues_and_garbage():
    assert chap.parse_vtt_cues("") == []
    assert chap.parse_vtt_cues("WEBVTT\n\n00:01.000 --> 00:02.000\n\n") == []


def test_build_transcript_formats_clock_and_samples_long_input():
    cues = chap.parse_vtt_cues(VTT)
    text = chap.build_transcript(cues)
    assert text.splitlines() == [
        "[00:00] Welcome to the course.",
        "[01:10] Now we set up the project with two lines.",
        "[1:02:03] Wrapping up.",
    ]
    many = [(float(i), float(i) + 1, "word " * 20) for i in range(1000)]
    sampled = chap.build_transcript(many, max_chars=5000)
    assert len(sampled) <= 6000
    assert sampled.startswith("[00:00]")


def test_normalize_chapters_sorts_dedupes_clamps_and_forces_zero():
    raw = [
        {"start_seconds": 120, "title": "  Part two. "},
        {"start_seconds": 5, "title": '"Intro"'},
        {"start_seconds": 125, "title": "Too close"},
        {"start_seconds": 999, "title": "Past the end"},
        {"start_seconds": "bad", "title": "Bad time"},
        {"start_seconds": 60, "title": ""},
        {"start_seconds": -3, "title": "Negative"},
    ]
    assert chap.normalize_chapters(raw, duration=300) == [
        {"start": 0.0, "title": "Intro"},
        {"start": 120.0, "title": "Part two"},
    ]


def test_normalize_chapters_needs_two_and_caps_count_and_title():
    assert chap.normalize_chapters([{"start": 0, "title": "Only"}], None) == []
    raw = [{"start": i * 20, "title": "x" * 200} for i in range(40)]
    out = chap.normalize_chapters(raw, None)
    assert len(out) == chap.MAX_CHAPTERS
    assert len(out[0]["title"]) == chap.MAX_TITLE_CHARS


def test_normalize_chapters_accepts_model_objects():
    raw = [chap.GeneratedChapter(start_seconds=0, title="A"), chap.GeneratedChapter(start_seconds=40, title="B")]
    assert chap.normalize_chapters(raw, 100) == [{"start": 0.0, "title": "A"}, {"start": 40.0, "title": "B"}]


async def test_generate_chapters_calls_fast_model_with_transcript(monkeypatch):
    import src.services.ai.llm as llm

    seen = {}

    async def _fake_generate(**kwargs):
        seen.update(kwargs)
        return chap.GeneratedChapters(chapters=[
            chap.GeneratedChapter(start_seconds=0, title="Welcome"),
            chap.GeneratedChapter(start_seconds=70, title="Project setup"),
        ])

    monkeypatch.setattr(llm, "generate", _fake_generate)
    out = await chap.generate_chapters(VTT, "fast-model")
    assert out == [{"start": 0.0, "title": "Welcome"}, {"start": 70.0, "title": "Project setup"}]
    assert seen["model_name"] == "fast-model"
    assert seen["output_type"] is chap.GeneratedChapters
    assert "[01:10] Now we set up the project" in seen["user_prompt"]
    assert "Video length: 1:02:05" in seen["user_prompt"]


async def test_generate_chapters_raises_on_empty_captions_or_output(monkeypatch):
    import src.services.ai.llm as llm

    with pytest.raises(ValueError):
        await chap.generate_chapters("WEBVTT\n", "m")

    async def _one(**kwargs):
        return chap.GeneratedChapters(chapters=[chap.GeneratedChapter(start_seconds=0, title="Only")])

    monkeypatch.setattr(llm, "generate", _one)
    with pytest.raises(ValueError):
        await chap.generate_chapters(VTT, "m")
