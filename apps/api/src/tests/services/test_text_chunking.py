"""Token budgets and complete source coverage for local RAG chunking."""

import pytest
import tiktoken

from src.services.ai.rag.text_chunking import split_text


def _tokens(text):
    return tiktoken.get_encoding("cl100k_base").encode_ordinary(text)


@pytest.mark.parametrize("text", ["", "  \n\t", "\r\n\r\n"])
def test_empty_text_has_no_chunks(text):
    assert split_text(text, 512, 50) == []


def test_short_text_is_preserved_as_one_chunk():
    text = "  First sentence. Second sentence without punctuation\n"
    assert split_text(text, 512, 50) == [text]


@pytest.mark.parametrize("text", [
    "Hello world! " * 1000,
    "مرحبا بالعالم. 日本語の文章です。 👩🏽‍🚀🚀 café e\u0301\n" * 300,
    "a" * 30000,
    "🧑🏽‍💻" * 1000,
    "<|endoftext|> should be ordinary user content. " * 300,
], ids=["english", "multilingual", "unbroken", "emoji", "special-token-text"])
def test_zero_overlap_preserves_every_character_and_token_budget(text):
    chunks = split_text(text, 64, 0)
    assert "".join(chunks) == text
    assert all(chunk and len(_tokens(chunk)) <= 64 for chunk in chunks)
    assert all("\ufffd" not in chunk for chunk in chunks)


@pytest.mark.parametrize("size,overlap", [(64, 12), (8, 7)])
@pytest.mark.parametrize("kind", ["paragraphs", "unbroken", "multilingual"])
def test_overlap_is_deterministic_bounded_and_loses_no_text(size, overlap, kind):
    if kind == "paragraphs":
        text = "\n\n".join(f"Lesson {i:04}: a distinct point about learning number {i}." for i in range(30))
    elif kind == "unbroken":
        text = " ".join(f"distinct_word_{i:04}" for i in range(100))
    else:
        text = "\n".join(f"{i:04} 日本語の文章です。 👩🏽‍🚀 مرحبا بالعالم {i:04}." for i in range(30))
    chunks = split_text(text, size, overlap)
    assert chunks == split_text(text, size, overlap)
    _assert_complete_overlap(text, chunks, size, overlap)


def _assert_complete_overlap(text, chunks, size, overlap_budget):
    previous_start = previous_end = 0
    overlap_seen = False
    for index, chunk in enumerate(chunks):
        start = 0 if index == 0 else text.find(chunk, previous_start + 1)
        while index and start >= 0 and (
            start + len(chunk) <= previous_end
            or len(_tokens(text[start:previous_end])) > overlap_budget
        ):
            start = text.find(chunk, start + 1)
        assert 0 <= start <= previous_end
        assert start + len(chunk) > previous_end
        assert len(_tokens(chunk)) <= size
        if index:
            overlap = text[start:previous_end]
            assert len(_tokens(overlap)) <= overlap_budget
            overlap_seen |= bool(overlap)
        previous_start, previous_end = start, start + len(chunk)
    assert previous_end == len(text)
    assert overlap_seen


def test_embedding_service_uses_default_budget_and_overlap():
    from src.services.ai.rag.embedding_service import chunk_text

    text = "\n\n".join(f"Lesson {i:04}: a distinct point about learning number {i}." for i in range(300))
    chunks = chunk_text(text)
    assert len(chunks) > 1
    assert chunks == split_text(text, 512, 50)
    _assert_complete_overlap(text, chunks, 512, 50)


def test_chunk_prefers_complete_sentences_and_paragraphs():
    sentence = "Learning works better through practice.\n\n"
    chunks = split_text(sentence * 100, 32, 0)
    assert len(chunks) > 1
    assert all(chunk.endswith(".\n\n") for chunk in chunks)


@pytest.mark.parametrize("size,overlap", [(0, 0), (3, 0), (8, -1), (8, 8)])
def test_invalid_budgets_are_rejected(size, overlap):
    with pytest.raises(ValueError):
        split_text("lesson", size, overlap)
