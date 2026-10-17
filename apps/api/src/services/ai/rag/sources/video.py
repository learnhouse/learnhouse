"""Video activities: the transcript of hosted videos, cited by timestamp.

YouTube videos have no file to transcribe and are found by name and details
only (activity_summary).
"""

from __future__ import annotations

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.services.ai.rag.formats import is_safe_file_name
from src.services.ai.rag.media import Media, status_of, transcript_segments
from src.services.ai.rag.sources import SourceContext, source
from src.services.ai.rag.types import Segment, SourceType


@source(ActivityTypeEnum.TYPE_VIDEO)
async def extract(activity: Activity, ctx: SourceContext) -> list[Segment]:
    filename = (activity.content or {}).get("filename")
    if activity.activity_sub_type != ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED or not is_safe_file_name(filename):
        return []
    meta = activity.extra_metadata or {}
    media = Media(
        org_id=activity.org_id,
        owner="activity",
        owner_id=activity.id,
        source_key=f"{ctx.activity_dir()}/video/{filename}",
        status=status_of(meta),
        captions=meta.get("captions") if isinstance(meta.get("captions"), dict) else None,
    )
    return await transcript_segments(ctx, media, SourceType.VIDEO)
