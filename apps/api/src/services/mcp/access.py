"""Org-level switch for AI app connections (MCP).

On by default on every plan. An org admin can turn it off; unlike plan
features this toggle is honored on paid plans too, because it is a security
control (whether third-party agents may act in the org), not an entitlement.
"""

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from config.config import get_learnhouse_config
from src.db.organization_config import OrganizationConfig


def mcp_enabled_in_config(config: dict | None) -> bool:
    config = config or {}
    if str(config.get("config_version", "1.0")).startswith("2"):
        return not config.get("admin_toggles", {}).get("mcp", {}).get("disabled", False)
    return config.get("features", {}).get("mcp", {}).get("enabled", True) is not False


async def mcp_enabled_for_org(org_id: int, db_session: AsyncSession) -> bool:
    if not get_learnhouse_config().mcp_config.enabled:
        return False
    row = (
        await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
        )
    ).scalars().first()
    return mcp_enabled_in_config(row.config if row else None)


async def set_mcp_enabled_for_org(org_id: int, enabled: bool, db_session: AsyncSession) -> None:
    import json
    from datetime import datetime

    from fastapi import HTTPException

    row = (
        await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
        )
    ).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Organization config not found")
    # A fresh dict so SQLAlchemy sees the JSON column change.
    config = json.loads(json.dumps(row.config or {}))
    if str(config.get("config_version", "1.0")).startswith("2"):
        config.setdefault("admin_toggles", {}).setdefault("mcp", {})["disabled"] = not enabled
    else:
        config.setdefault("features", {}).setdefault("mcp", {})["enabled"] = enabled
    row.config = config
    row.update_date = str(datetime.now())
    db_session.add(row)
    await db_session.commit()
