"""Fetch approved KB content to augment the Copilot RAG prompt.

KB has no status filter on search and hits carry no status, so we resolve each
hit to its entity row and keep only `status == "approved"`. Any failure degrades
to an empty string — the Copilot answers from its own corpus.
"""

import logging

import httpx

logger = logging.getLogger(__name__)

_SEARCH_LIMIT = 5
_TIMEOUT = 5.0


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

            approved: list[str] = []
            for hit in hits:
                row = await client.get(
                    f"{base}/entities/{hit['type']}/{hit['id']}",
                    headers=headers,
                    timeout=_TIMEOUT,
                )
                if row.status_code == 200 and row.json().get("status") == "approved":
                    text = hit.get("snippet") or hit.get("summary") or ""
                    if text:
                        approved.append(text)
            return "\n\n".join(approved)
    except Exception:
        logger.warning("KB context fetch failed; continuing without it", exc_info=True)
        return ""
