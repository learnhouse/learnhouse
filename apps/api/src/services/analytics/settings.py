"""Per-org analytics settings: retention and privacy.

Every org keeps 1 year of analytics by default and may choose less. Keeping
more than a year (up to 7) is an Enterprise feature. Settings are read on every
beacon, so they're cached in-process for a minute.
"""

import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.analytics import DEFAULT_RETENTION_DAYS, AnalyticsSettings
from src.security.features_utils.plan_check import get_org_plan
from src.security.features_utils.plans import plan_meets_requirement

STANDARD_RETENTION_DAYS = (90, 180, 365)
EXTENDED_RETENTION_DAYS = (730, 1095, 1825, 2555)
CACHE_TTL_SECONDS = 60

_cache: dict[int, tuple[float, "SettingsView"]] = {}


@dataclass(frozen=True)
class SettingsView:
    retention_days: int = DEFAULT_RETENTION_DAYS
    track_anonymous: bool = True
    collect_location: bool = True
    exclude_staff: bool = False

    def as_dict(self) -> dict:
        return asdict(self)


def invalidate(org_id: int) -> None:
    _cache.pop(org_id, None)


async def get_settings(org_id: int, db_session: AsyncSession) -> SettingsView:
    cached = _cache.get(org_id)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    row = (
        await db_session.execute(select(AnalyticsSettings).where(AnalyticsSettings.org_id == org_id))
    ).scalars().first()
    view = SettingsView() if row is None else SettingsView(
        retention_days=row.retention_days,
        track_anonymous=row.track_anonymous,
        collect_location=row.collect_location,
        exclude_staff=row.exclude_staff,
    )
    _cache[org_id] = (time.monotonic() + CACHE_TTL_SECONDS, view)
    return view


async def can_extend_retention(org_id: int, db_session: AsyncSession) -> bool:
    return plan_meets_requirement(await get_org_plan(org_id, db_session), "enterprise")


async def retention_options(org_id: int, db_session: AsyncSession) -> dict:
    extended = await can_extend_retention(org_id, db_session)
    return {
        "standard": list(STANDARD_RETENTION_DAYS),
        "extended": list(EXTENDED_RETENTION_DAYS),
        "extended_available": extended,
    }


async def update_settings(org_id: int, changes: dict, db_session: AsyncSession) -> SettingsView:
    current = await get_settings(org_id, db_session)
    merged = {**current.as_dict(), **{k: v for k, v in changes.items() if v is not None}}

    retention = merged["retention_days"]
    if retention in EXTENDED_RETENTION_DAYS:
        if not await can_extend_retention(org_id, db_session):
            raise HTTPException(
                status_code=403,
                detail="Keeping analytics for more than a year requires the Enterprise plan.",
            )
    elif retention not in STANDARD_RETENTION_DAYS:
        raise HTTPException(status_code=400, detail="Unsupported retention period")

    row = (
        await db_session.execute(select(AnalyticsSettings).where(AnalyticsSettings.org_id == org_id))
    ).scalars().first()
    if row is None:
        row = AnalyticsSettings(org_id=org_id)
    for key, value in merged.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    db_session.add(row)
    await db_session.commit()
    invalidate(org_id)
    return SettingsView(**merged)
