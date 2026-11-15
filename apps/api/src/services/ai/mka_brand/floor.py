"""Deterministic guarantee floor.

Even if the model never calls a Brand Center tool (or MCP is down), every system prompt
carries a compact brand/culture block. The block is a built-in baseline plus the latest
guardrails fetched from the Brand Center, cached for 1h with the last good copy kept
indefinitely. ``augment`` is synchronous (``_agent`` is sync), so refreshes run on a
background thread and never block a request.
"""

from __future__ import annotations

import asyncio
import logging
import re
import threading
import time
from typing import Optional

from src.services.ai.mka_brand import breaker, config, toolset

logger = logging.getLogger(__name__)

CACHE_TTL_S = 3600.0
# ~1.5k tokens at ~4 chars/token.
MAX_BLOCK_CHARS = 6000

BASELINE = """\
MKA USA brand and culture rules (always apply):
- Fidelity first: for transcription, captioning and translation, preserve the source meaning verbatim. Never rewrite, soften or embellish what a speaker said. Use brand knowledge only to correct the spelling of names and terms.
- Ahmadiyya Muslim culture applies. Never depict or describe a likeness of any prophet or Khalifa. Never render Arabic script in generated images. Treat attire, prayer posture, mosques and symbols with respect.
- Use MKA USA naming and terminology consistently. Do not invent facts about the organization; if unsure, say so.
- Brand tools (if available): use check_copy on user-facing copy you write, get_culture_guardrails before describing visuals, and get_brand_context before making claims about the organization. Skip them for pure transcription or translation. If a tool errors, continue without it."""

_DRAFT_RE = re.compile(r"""confidence["']?\s*[:=]\s*["']?draft""", re.IGNORECASE)

_lock = threading.Lock()
_cache: dict = {"text": "", "at": 0.0}  # text is the last good fetched content
_refreshing = False


def _clean(text: str) -> str:
    """Drop unreviewed (draft) paragraphs; keep reviewed / unlabelled ones."""
    paras = [p for p in re.split(r"\n\s*\n", text) if p.strip() and not _DRAFT_RE.search(p)]
    return "\n\n".join(paras).strip()


async def _fetch() -> str:
    guardrails = await toolset.call_tool_text("get_culture_guardrails", {})
    context = await toolset.call_tool_text("get_brand_context", {"brand": config.brand()})
    return _clean(f"{guardrails}\n\n{context}")


async def refresh() -> None:
    """Fetch and cache; on failure keep the last good copy and trip the breaker."""
    global _refreshing
    try:
        if not config.enabled() or breaker.is_open():
            return
        text = await _fetch()
        if text:
            with _lock:
                _cache["text"] = text
                _cache["at"] = time.monotonic()
    except Exception as exc:  # noqa: BLE001 (fail-open)
        breaker.trip(type(exc).__name__)
    finally:
        _refreshing = False


def _schedule_refresh() -> None:
    global _refreshing
    with _lock:
        if _refreshing:
            return
        _refreshing = True

    def _run() -> None:
        asyncio.run(refresh())

    threading.Thread(target=_run, name="mka-brand-floor", daemon=True).start()


def _is_stale() -> bool:
    return not _cache["text"] or (time.monotonic() - _cache["at"]) > CACHE_TTL_S


def build_block() -> str:
    if _is_stale() and not breaker.is_open():
        _schedule_refresh()
    block = BASELINE
    fetched = _cache["text"]
    room = MAX_BLOCK_CHARS - len(block) - 40
    if fetched and room > 200:
        block = f"{block}\n\nBrand Center guardrails:\n{fetched[:room]}"
    return block[:MAX_BLOCK_CHARS]


def augment(system_prompt: Optional[str]) -> Optional[str]:
    """Prepend the brand floor; returns ``system_prompt`` unchanged when disabled."""
    if not config.enabled():
        return system_prompt
    block = build_block()
    return f"{block}\n\n{system_prompt}" if system_prompt else block


def _reset_for_tests() -> None:
    global _refreshing
    with _lock:
        _cache["text"] = ""
        _cache["at"] = 0.0
        _refreshing = False
