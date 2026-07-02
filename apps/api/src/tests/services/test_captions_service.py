"""Unit tests for src/services/ai/captions.py (VTT engine — no real model/ffmpeg)."""

import src.services.ai.captions as cap


# --- VTT sanitizing --------------------------------------------------------

def test_sanitize_adds_header_and_strips_fences():
    raw = "```vtt\n00:00:01.000 --> 00:00:02.000\nHello\n```"
    out = cap.sanitize_vtt(raw)
    assert out.startswith("WEBVTT")
    assert "```" not in out
    assert "Hello" in out


def test_sanitize_converts_srt_commas():
    raw = "WEBVTT\n\n00:00:01,500 --> 00:00:02,750\nHi"
    out = cap.sanitize_vtt(raw)
    assert "00:00:01.500 --> 00:00:02.750" in out


def test_sanitize_empty():
    assert cap.sanitize_vtt("") == "WEBVTT\n"


# --- shifting / merging ----------------------------------------------------

def test_shift_vtt_offsets_timestamps():
    vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA\n"
    out = cap.shift_vtt(vtt, 600)  # +10 min
    assert "00:10:01.000 --> 00:10:02.000" in out


def test_shift_vtt_noop_on_zero():
    vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA\n"
    assert cap.shift_vtt(vtt, 0) == vtt


def test_merge_chunks_single_header():
    a = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA\n"
    b = "WEBVTT\n\n00:10:01.000 --> 00:10:02.000\nB\n"
    merged = cap.merge_vtt_chunks([a, b])
    assert merged.count("WEBVTT") == 1
    assert "A" in merged and "B" in merged
    assert "00:10:01.000" in merged


def test_has_cues():
    assert cap.has_cues("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nX")
    assert not cap.has_cues("WEBVTT\n\n(no cues)")


def test_mm_ss_timestamps_recognized():
    # Gemini emits MM:SS.mmm (no hours) — this MUST be recognized as cues,
    # otherwise every real transcript fails with "no cues".
    vtt = "WEBVTT\n\n00:01.800 --> 00:03.200\nHello"
    assert cap.has_cues(vtt)
    shifted = cap.shift_vtt(vtt, 600)  # +10 min -> normalizes to HH:MM:SS
    assert "00:10:01.800 --> 00:10:03.200" in shifted


def test_sanitize_srt_comma_mm_ss():
    out = cap.sanitize_vtt("WEBVTT\n\n00:01,800 --> 00:03,200\nHi")
    assert "00:01.800 --> 00:03.200" in out
    assert cap.has_cues(out)


# --- credit estimation -----------------------------------------------------

def test_estimate_credits():
    assert cap.estimate_credits(0, 0) == 1          # min 1
    assert cap.estimate_credits(60, 0) == 1         # <10min -> 1 chunk
    assert cap.estimate_credits(600, 0) == 1        # exactly 10min -> 1 chunk
    assert cap.estimate_credits(601, 0) == 2        # spills to 2 chunks
    assert cap.estimate_credits(600, 3) == 4        # 1 chunk + 3 translations


# --- transcription / translation (mocked model) ----------------------------

async def test_transcribe_stitches_chunks(monkeypatch, tmp_path):
    calls = {"n": 0}

    async def _fake_generate(**kwargs):
        calls["n"] += 1
        return "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nline"

    import src.services.ai.llm as llm
    monkeypatch.setattr(llm, "generate", _fake_generate)

    c0 = tmp_path / "chunk_0000.mp3"
    c1 = tmp_path / "chunk_0001.mp3"
    c0.write_bytes(b"ID3fake0")
    c1.write_bytes(b"ID3fake1")

    out = await cap.transcribe_to_vtt([str(c0), str(c1)], "gemini-x", source_language="en")
    assert calls["n"] == 2
    assert out.count("WEBVTT") == 1
    # chunk 0 keeps its time, chunk 1 is offset by +10 min.
    assert "00:00:01.000 --> 00:00:02.000" in out
    assert "00:10:01.000 --> 00:10:02.000" in out


async def test_transcribe_raises_without_cues(monkeypatch, tmp_path):
    async def _empty(**kwargs):
        return "WEBVTT\n\n(silence)"

    import src.services.ai.llm as llm
    monkeypatch.setattr(llm, "generate", _empty)
    c0 = tmp_path / "chunk_0000.mp3"
    c0.write_bytes(b"x")
    import pytest
    with pytest.raises(ValueError):
        await cap.transcribe_to_vtt([str(c0)], "gemini-x")


async def test_transcribe_raises_on_no_audio():
    import pytest
    with pytest.raises(ValueError):
        await cap.transcribe_to_vtt([], "gemini-x")


async def test_translate_vtt(monkeypatch):
    async def _fake(**kwargs):
        # echo a translated cue
        return "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nBonjour"

    import src.services.ai.llm as llm
    monkeypatch.setattr(llm, "generate", _fake)
    out = await cap.translate_vtt("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello", "French", "gemini-x")
    assert "Bonjour" in out and out.startswith("WEBVTT")


async def test_translate_raises_without_cues(monkeypatch):
    async def _fake(**kwargs):
        return "sorry I cannot"

    import src.services.ai.llm as llm
    monkeypatch.setattr(llm, "generate", _fake)
    import pytest
    with pytest.raises(ValueError):
        await cap.translate_vtt("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello", "French", "gemini-x")
