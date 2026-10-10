"""Shared builders for the RAG pipeline tests."""

from contextlib import asynccontextmanager
from datetime import datetime

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity


def make_pdf(pages: list[str]) -> bytes:
    """A minimal, valid PDF with one line of text per page."""
    n = len(pages)
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [%s] /Count %d >>" % (" ".join(f"{4 + 2 * i} 0 R" for i in range(n)), n),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    for i, text in enumerate(pages):
        stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET"
        objects.append(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {5 + 2 * i} 0 R >>"
        )
        objects.append(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")

    out = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


VTT = """WEBVTT

00:00:01.000 --> 00:00:04.000
Mitochondria make energy.

00:00:30.000 --> 00:00:33.000
<v Speaker>They have their own DNA.</v>

00:01:05.000 --> 00:01:09.000
Ribosomes build proteins.
"""


@asynccontextmanager
async def same_session(db):
    """Stand-in for a session factory that hands back the test session."""
    yield db


async def add_activity(db, org, course, chapter, activity_id, *, activity_type, sub_type, content=None,
                       name=None, published=True, extra_metadata=None, details=None):
    activity = Activity(
        id=activity_id,
        name=name or f"Activity {activity_id}",
        activity_type=activity_type,
        activity_sub_type=sub_type,
        content=content or {},
        details=details,
        published=published,
        extra_metadata=extra_metadata,
        org_id=org.id,
        course_id=course.id,
        activity_uuid=f"activity_{activity_id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(activity)
    await db.commit()
    if chapter is not None:
        db.add(ChapterActivity(
            order=activity_id, chapter_id=chapter.id, activity_id=activity_id, course_id=course.id,
            org_id=org.id, creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        await db.commit()
    return activity


__all__ = [
    "ActivitySubTypeEnum",
    "ActivityTypeEnum",
    "VTT",
    "add_activity",
    "make_pdf",
    "same_session",
]
