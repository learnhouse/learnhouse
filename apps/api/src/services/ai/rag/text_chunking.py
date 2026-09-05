"""Sentence-aware, token-bounded chunks without downloadable language models."""

from bisect import bisect_right
import re

import tiktoken


_SENTENCE_END = re.compile(r'''[.!?。！？]+["'”’»)\]]*\s*|\n+''')


def split_text(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    """Keep source characters intact while preferring sentence/paragraph ends.

    Token offsets are calculated once for the full document. Each window is
    checked independently because BPE tokenization can change at a boundary.
    The overlap never exceeds its token budget and every chunk adds new text.
    """
    if chunk_size < 4 or not 0 <= chunk_overlap < chunk_size:
        raise ValueError("chunk_size must be at least 4 and overlap smaller than chunk_size")
    if not text.strip():
        return []

    tokenizer = tiktoken.get_encoding("cl100k_base")
    tokens = tokenizer.encode_ordinary(text)
    decoded, offsets = tokenizer.decode_with_offsets(tokens)
    if decoded != text:
        raise ValueError("Text must contain valid Unicode characters")
    offsets.append(len(text))
    boundaries = [match.end() for match in _SENTENCE_END.finditer(text)]

    chunks: list[str] = []
    start = previous_end = 0
    while start < len(text):
        first_token = max(0, bisect_right(offsets, start) - 1)
        end = offsets[min(first_token + chunk_size, len(tokens))]
        end = max(end, start + 1)
        boundary_index = bisect_right(boundaries, end) - 1
        if end < len(text) and boundary_index >= 0 and boundaries[boundary_index] > previous_end:
            end = boundaries[boundary_index]

        chunk_tokens = tokenizer.encode_ordinary(text[start:end])
        while len(chunk_tokens) > chunk_size:
            end -= 1
            chunk_tokens = tokenizer.encode_ordinary(text[start:end])
        if end <= previous_end:
            # A boundary can retokenize slightly larger than its original
            # window. Drop overlap and retry so even long unbroken text moves
            # forward without sacrificing any source characters.
            start = previous_end
            continue

        chunks.append(text[start:end])
        if end == len(text):
            break

        next_start = end
        if chunk_overlap:
            suffix_bytes = b"".join(
                tokenizer.decode_single_token_bytes(token)
                for token in chunk_tokens[-chunk_overlap:]
            )
            # A token may start midway through a UTF-8 character. Ignoring
            # only that incomplete prefix chooses a later character boundary;
            # emitted chunks always slice the original text, never decoded
            # token fragments, so no character is lost or replaced.
            next_start = end - len(suffix_bytes.decode("utf-8", errors="ignore"))
            while len(tokenizer.encode_ordinary(text[next_start:end])) > chunk_overlap:
                next_start += 1
        start = next_start if next_start > start else end
        previous_end = end

    return chunks
