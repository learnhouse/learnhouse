"""Document activities: uploaded PDFs, one segment per page."""

from __future__ import annotations


from src.db.courses.activities import Activity, ActivityTypeEnum
from src.services.ai.rag.formats import is_safe_file_name, read_pdf_pages
from src.services.ai.rag.sources import SourceContext, source
from src.services.ai.rag.types import Segment, SourceType


@source(ActivityTypeEnum.TYPE_DOCUMENT)
async def extract(activity: Activity, ctx: SourceContext) -> list[Segment]:
    filename = (activity.content or {}).get("filename")
    if not is_safe_file_name(filename):
        return []
    return [
        Segment(text=text, source_type=SourceType.DOCUMENT, locator={"page": page})
        for page, text in await read_pdf_pages(f"{ctx.activity_dir()}/documentpdf/{filename}")
    ]
