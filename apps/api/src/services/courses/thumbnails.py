import asyncio
from typing import Any, Iterable, Literal

from fastapi import UploadFile
from src.services.utils.upload_content import content_exists, upload_file

ThumbnailStatus = Literal["ok", "missing", "broken"]

# Storage checks run side by side, a few at a time (S3 HEAD requests).
_CHECK_CONCURRENCY = 16


async def upload_thumbnail(thumbnail_file: UploadFile, org_uuid: str, course_id: int) -> str:
    """Upload a course thumbnail image with file validation."""
    return await upload_file(
        file=thumbnail_file,
        directory=f"courses/{course_id}/thumbnails",
        type_of_dir="orgs",
        uuid=org_uuid,
        allowed_types=["image", "video"],
        filename_prefix="thumbnail",
    )


async def thumbnail_status(org_uuid: str, course: Any) -> ThumbnailStatus:
    """Whether a course's cover shows: "missing" when none is set, "broken"
    when the stored file is gone (the course card then falls back to the
    placeholder), else "ok". An image wins over a video, like the card."""
    name = (getattr(course, "thumbnail_image", None) or "").strip() or (
        getattr(course, "thumbnail_video", None) or ""
    ).strip()
    if not name:
        return "missing"
    if name.startswith(("http://", "https://")):
        return "ok"
    exists = await content_exists(f"courses/{course.course_uuid}/thumbnails", "orgs", org_uuid, name)
    return "ok" if exists else "broken"


async def thumbnail_statuses(org_uuid: str, courses: Iterable[Any]) -> dict[str, ThumbnailStatus]:
    """thumbnail_status for many courses at once, keyed by course_uuid."""
    gate = asyncio.Semaphore(_CHECK_CONCURRENCY)

    async def one(course: Any) -> tuple[str, ThumbnailStatus]:
        async with gate:
            return course.course_uuid, await thumbnail_status(org_uuid, course)

    return dict(await asyncio.gather(*(one(c) for c in courses)))
