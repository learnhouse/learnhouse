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

# The graph-traversal REST path is NOT verified in this repo (the data + shape
# are confirmed via the KB MCP `kb_traverse` tool). Confirm and adjust here.
_TRAVERSE_PATH = "/entities/{from_type}/{from_id}/traverse"


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
        """Outgoing-edge BFS to the given target node types. Tolerates either a
        bare list or a ``{"rows": [...]}`` envelope."""
        path = _TRAVERSE_PATH.format(from_type=from_type, from_id=from_id)
        data = await self._get(path, {"targetTypes": ",".join(target_types), "maxDepth": max_depth})
        if isinstance(data, dict):
            rows = data.get("rows", [])
            return rows if isinstance(rows, list) else []
        return data if isinstance(data, list) else []
