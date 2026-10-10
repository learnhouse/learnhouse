"""Custom activities: any human-readable text in their content."""

from __future__ import annotations

from src.db.courses.activities import Activity, ActivityTypeEnum
from src.services.ai.rag.formats import join, prose_strings
from src.services.ai.rag.sources import SourceContext, source
from src.services.ai.rag.types import Segment, SourceType


@source(ActivityTypeEnum.TYPE_CUSTOM)
async def extract(activity: Activity, ctx: SourceContext) -> list[Segment]:
    return [Segment(text=join(prose_strings(activity.content or {})), source_type=SourceType.CUSTOM)]
