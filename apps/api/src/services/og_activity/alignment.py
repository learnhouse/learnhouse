"""Resolve a launch's alignment to top-level KB knowledge-graph nodes.

A launch reaches these via OUTGOING edges (e.g. launch --for_product--> product
--serves_market--> market). We run a type-filtered BFS, dedupe, and resolve
each node's display name. Any KB failure degrades to an empty alignment — the
course is still created, just without alignment metadata.
"""

import logging
import re
from typing import Optional, Protocol

from pydantic import BaseModel

logger = logging.getLogger(__name__)

ALIGNMENT_TYPES = ["product", "market", "capability", "persona", "customer"]


class _Traverser(Protocol):
    async def traverse(self, from_id: str, from_type: str, target_types: list[str], *, max_depth: int = 3) -> list[dict]: ...
    async def get_entity(self, entity_type: str, entity_id: str) -> dict: ...


class AlignmentRef(BaseModel):
    type: str
    id: str
    name: str
    rel_type: Optional[str] = None


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


async def resolve_alignment(
    launch_id: str,
    kb_client: _Traverser,
    *,
    types: Optional[list[str]] = None,
    max_depth: int = 3,
) -> list[AlignmentRef]:
    types = types or ALIGNMENT_TYPES
    try:
        rows = await kb_client.traverse(launch_id, "launch", types, max_depth=max_depth)
    except Exception:
        logger.warning("KB alignment traverse failed for launch %s; continuing without alignment", launch_id, exc_info=True)
        return []

    refs: list[AlignmentRef] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        node_type, node_id = row.get("type"), row.get("id")
        if not node_type or not node_id or (node_type, node_id) in seen:
            continue
        seen.add((node_type, node_id))
        name = row.get("name")
        if not name:
            try:
                entity = await kb_client.get_entity(node_type, node_id)
                name = entity.get("name") or entity.get("slug") or node_id
            except Exception:
                logger.warning(
                    "KB get_entity failed for %s/%s; falling back to id", node_type, node_id, exc_info=True
                )
                name = node_id
        refs.append(AlignmentRef(type=node_type, id=node_id, name=name, rel_type=row.get("relType")))
    return refs


def alignment_tags(refs: list[AlignmentRef]) -> str:
    """Comma-separated `type:slug` tags for LearnHouse course discovery."""
    return ",".join(f"{r.type}:{_slug(r.name)}" for r in refs)


def alignment_metadata(refs: list[AlignmentRef]) -> list[dict]:
    """Structured alignment for `extra_metadata.kb_alignment`."""
    return [r.model_dump() for r in refs]
