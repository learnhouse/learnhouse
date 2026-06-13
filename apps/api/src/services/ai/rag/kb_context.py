"""Fetch approved KB content to augment the Copilot RAG prompt.

KB has no status filter on search and hits carry no status, so we resolve each
hit to its entity row and keep only `status == "approved"`. Any failure degrades
to an empty string — the Copilot answers from its own corpus.
"""

import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

_SEARCH_LIMIT = 5
_TIMEOUT = 5.0
# Single budget for the per-hit resolution fan-out. The lookups run
# concurrently, so this caps the added latency on the interactive answer path
# to ~one slow request rather than the serial sum of all of them.
_LOOKUP_BUDGET = 6.0


async def _approved_text(client: httpx.AsyncClient, base: str, headers: dict, hit: dict) -> str | None:
    """Resolve one hit to its entity row; return its text iff status==approved.

    Best-effort: any failure resolving this hit yields None so a single bad
    lookup never sinks the whole fan-out.
    """
    try:
        row = await client.get(
            f"{base}/entities/{hit['type']}/{hit['id']}",
            headers=headers,
            timeout=_TIMEOUT,
        )
    except Exception:
        return None
    if row.status_code == 200 and row.json().get("status") == "approved":
        return hit.get("snippet") or hit.get("summary") or None
    return None


async def fetch_kb_context(question: str, kb_api_url: str, kb_token: str) -> str:
    base = kb_api_url.rstrip("/")
    headers = {"Authorization": f"Bearer {kb_token}"}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{base}/search/hybrid",
                params={"q": question, "limit": _SEARCH_LIMIT},
                headers=headers,
                timeout=_TIMEOUT,
            )
            resp.raise_for_status()
            hits = resp.json()  # bare list of SearchHit

            # Resolve every hit concurrently under one overall deadline. gather
            # preserves input order, so approved snippets keep their hit ranking.
            texts = await asyncio.wait_for(
                asyncio.gather(*(_approved_text(client, base, headers, h) for h in hits)),
                timeout=_LOOKUP_BUDGET,
            )
            return "\n\n".join(t for t in texts if t)
    except Exception:
        logger.warning("KB context fetch failed; continuing without it", exc_info=True)
        return ""
