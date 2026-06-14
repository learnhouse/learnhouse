"""Thin async KB REST client for the activity ingestion job.

Mirrors the auth/transport conventions already used by
``src/services/ai/rag/kb_context.py`` and ``src/jobs/kb_sync.py``: Bearer-token
auth, bare-JSON-array responses, and client-side status filtering (the KB API
exposes no ``status`` query param).
"""

import logging
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT = 30.0
_DEFAULT_LIMIT = 200


def approved(rows: list[dict]) -> list[dict]:
    """Keep only rows whose ``status == 'approved'`` (client-side filter)."""
    return [r for r in rows if r.get("status") == "approved"]


class KbClient:
    def __init__(self, base_url: str, token: str, *, timeout: float = _TIMEOUT) -> None:
        self._base = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"}
        self._timeout = timeout

    async def _get(self, path: str, params: Optional[dict] = None) -> Any:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self._base}{path}",
                params=params,
                headers=self._headers,
                timeout=self._timeout,
            )
            resp.raise_for_status()
            return resp.json()

    async def list_artifacts(self, *, limit: int = _DEFAULT_LIMIT, offset: int = 0) -> list[dict]:
        """Slim list of launch artifacts (no bodyMd). Bare array."""
        return await self._get("/entities/launch_artifact", {"limit": limit, "offset": offset})

    async def list_all_artifacts(self, *, page_size: int = _DEFAULT_LIMIT) -> list[dict]:
        """All launch artifacts, paging until a short page. Avoids the
        single-call truncation at the default limit."""
        rows: list[dict] = []
        offset = 0
        while True:
            page = await self.list_artifacts(limit=page_size, offset=offset)
            rows.extend(page)
            if len(page) < page_size:
                break
            offset += page_size
        return rows

    async def get_entity(self, entity_type: str, entity_id: str) -> dict:
        """Full entity row (includes bodyMd / attachments for launch_artifact)."""
        return await self._get(f"/entities/{entity_type}/{entity_id}")

    async def traverse(
        self,
        from_id: str,
        from_type: str,
        target_types: list[str],
        *,
        max_depth: int = 3,
    ) -> list[dict]:
        """Outgoing-edge BFS to the given target node types via `POST /traverse`.
        Returns the bare array of nodes (`{id, type, relType, depth}`); tolerates
        a `{"rows": [...]}` envelope defensively."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self._base}/traverse",
                json={
                    "fromId": from_id,
                    "fromType": from_type,
                    "targetTypes": list(target_types),
                    "maxDepth": max_depth,
                },
                headers=self._headers,
                timeout=self._timeout,
            )
            resp.raise_for_status()
            data = resp.json()
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            rows = data.get("rows", [])
            return rows if isinstance(rows, list) else []
        return []
