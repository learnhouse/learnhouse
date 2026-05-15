"""Pure LLM helper functions used by Atlas tool bodies.

These are not registered as agent tools — the LLM never sees them.
``propose_activity_body_rewrite`` calls them directly when it needs to
draft / rewrite / translate / summarize markdown. Keeping them out of
the tool surface avoids the round-trip "LLM calls generator, gets
markdown back, then calls propose" pattern; we collapse it to a single
``propose_*`` invocation.

Provider: ``google-genai`` (existing project dep). The pipeline's main
agent uses pydantic-ai for orchestration; these are simpler one-shot
text-out calls, so the bare SDK is enough and avoids extra setup cost.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from google import genai

from src.services.ai.base import get_gemini_client

logger = logging.getLogger(__name__)


GENERATOR_MODEL = "gemini-2.5-flash"
GENERATOR_TIMEOUT_S = 30.0


async def draft_from_brief(
    brief: str,
    audience: Optional[str] = None,
    tone: Optional[str] = None,
    length: Optional[str] = None,
) -> str:
    """Net-new activity body from a one-line user brief."""
    audience_clause = f"\nAudience: {audience}." if audience else ""
    tone_clause = f"\nTone: {tone}." if tone else ""
    length_clause = f"\nApprox length: {length}." if length else ""
    prompt = (
        "Draft an instructional activity body in markdown for a learning platform.\n"
        f"Brief: {brief}.{audience_clause}{tone_clause}{length_clause}\n"
        "Output: markdown only, no preamble, no closing remarks. Use headings,\n"
        "bullet lists, short paragraphs. Keep code blocks fenced with the\n"
        "right language tag where relevant."
    )
    return await _ask(prompt)


async def expand_outline(items: list[str], per_item_words: int = 200) -> str:
    """Bullet-point outline → expanded multi-paragraph markdown."""
    joined = "\n".join(f"- {it}" for it in items if it)
    prompt = (
        f"Expand the following outline into a learning-activity body. Aim for "
        f"about {per_item_words} words per bullet. Use one heading per bullet, "
        f"short paragraphs underneath. Output markdown only.\n\n"
        f"Outline:\n{joined}"
    )
    return await _ask(prompt)


async def rewrite_tone(existing_md: str, target_tone: str) -> str:
    """Rewrite a markdown body for a new tone, preserving structure and intent."""
    prompt = (
        f"Rewrite the following markdown to be {target_tone}. Preserve all "
        f"headings, code blocks, and lists; do not invent facts. Output the "
        f"rewritten markdown only, no preamble.\n\n"
        f"---\n{existing_md}\n---"
    )
    return await _ask(prompt)


async def translate(existing_md: str, target_lang: str) -> str:
    """Translate markdown to ``target_lang`` (English name)."""
    prompt = (
        f"Translate the following markdown into {target_lang}. Keep code "
        f"blocks, links, and structural markdown intact. Output the translated "
        f"markdown only, no preamble.\n\n"
        f"---\n{existing_md}\n---"
    )
    return await _ask(prompt)


async def summarize(existing_md: str, max_words: int = 120) -> str:
    """Summarize content to at most ``max_words`` words. Plain prose, no markdown."""
    prompt = (
        f"Summarize the following activity body in at most {max_words} words. "
        f"Plain prose, no markdown, no headings, no lists. Output the summary "
        f"only, no preamble.\n\n"
        f"---\n{existing_md}\n---"
    )
    return await _ask(prompt)


async def suggest_structure(
    topic: str,
    audience: Optional[str] = None,
    chapter_count: int = 5,
) -> str:
    """Draft a course skeleton for a topic. Returns markdown the tool body
    converts into a structured tree before emitting a ``structure.proposal``."""
    audience_clause = f"\nAudience: {audience}." if audience else ""
    prompt = (
        f"Propose a course skeleton on '{topic}' with about {chapter_count} "
        f"chapters.{audience_clause} Output ONLY markdown of the form:\n\n"
        f"# Chapter 1: <name>\n"
        f"- <activity name>: <one-line description>\n"
        f"- <activity name>: <one-line description>\n\n"
        f"# Chapter 2: <name>\n"
        f"- ...\n"
    )
    return await _ask(prompt)


# --- Internals --------------------------------------------------------------


async def _ask(prompt: str) -> str:
    """One-shot Gemini call. Wraps the sync SDK in a thread."""
    def _call() -> str:
        client = get_gemini_client()
        resp = client.models.generate_content(
            model=GENERATOR_MODEL,
            contents=[{"role": "user", "parts": [{"text": prompt}]}],
        )
        return (getattr(resp, "text", "") or "").strip()

    try:
        return await asyncio.wait_for(asyncio.to_thread(_call), timeout=GENERATOR_TIMEOUT_S)
    except asyncio.TimeoutError:
        logger.warning("Atlas generator call timed out (model=%s)", GENERATOR_MODEL)
        return ""
    except Exception as e:
        logger.warning("Atlas generator call failed: %s", e)
        return ""
