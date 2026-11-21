"""Whether an org uses AI search at all.

Indexing only pays off where the copilot can read the index, so the pipeline
and the periodic backfill skip orgs with AI or the copilot switched off. When
an org turns them back on, the backfill finds its content unindexed and
catches up.
"""

from __future__ import annotations

from typing import Iterable, Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organization_config import OrganizationConfig


def ai_block_reason(config: Optional[dict], org_id: int) -> Optional[str]:
    """Why an org cannot use the copilot, or None when it can. An org with no
    config is not restricted."""
    if not config:
        return None
    from src.security.features_utils.resolve import resolve_feature

    if not resolve_feature("ai", config, org_id)["enabled"]:
        return "AI features are disabled for this organization"
    # Learner Ask AI: copilot_enabled (historical) or features.ask_ai.
    from src.security.features_utils.ai_features import ai_feature_switches

    if not ai_feature_switches(config)["ask_ai"]:
        return "Copilot is disabled for this organization"
    return None


async def orgs_using_ai(org_ids: Iterable[int], db: AsyncSession) -> set[int]:
    """The subset of ``org_ids`` whose content is worth indexing."""
    org_ids = set(org_ids)
    if not org_ids:
        return set()
    # No embeddings provider configured (e.g. a self-host without an AI key):
    # indexing could only fail, so nothing is worth indexing.
    # Same without pgvector: the database has no table to index into.
    from src.core.migrations import pgvector_available
    from src.services.ai.llm.embeddings import embeddings_configured

    if not embeddings_configured() or not pgvector_available():
        return set()
    configs = dict((await db.execute(
        select(OrganizationConfig.org_id, OrganizationConfig.config).where(
            OrganizationConfig.org_id.in_(org_ids)  # type: ignore[union-attr]
        )
    )).all())
    return {org_id for org_id in org_ids if ai_block_reason(configs.get(org_id), org_id) is None}
