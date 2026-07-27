"""Resolve raw analytics identifiers into human-readable names.

Analytics rows come out of the event pipeline carrying only ``course_uuid`` /
``activity_uuid``. Nothing downstream — dashboards, exports, the per-student audit
dossier — should ever show a caller a bare UUID, so every consumer runs its rows
through :func:`enrich_with_metadata` first.

Lives in ``services`` rather than in the analytics router because the audit dossier
service needs it too, and a service importing from ``src.routers`` would be a layering
inversion (the analytics router also pulls in the Tinybird HTTP setup).
"""
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.courses import Course


async def enrich_with_metadata(rows: list[dict], db_session: AsyncSession) -> list[dict]:
    """Enrich analytics result rows with course/activity metadata from PostgreSQL.

    Mutates and returns ``rows``. Rows without a recognised uuid are left untouched.
    """
    if not rows:
        return rows

    # Collect unique course_uuids
    course_uuids = set()
    for row in rows:
        if row.get("course_uuid"):
            course_uuids.add(row["course_uuid"])

    # Batch fetch courses
    course_map: dict[str, Course] = {}
    if course_uuids:
        courses = (await db_session.execute(
            select(Course).where(Course.course_uuid.in_(list(course_uuids)))  # type: ignore
        )).scalars().all()
        course_map = {c.course_uuid: c for c in courses}

    # Collect unique activity_uuids
    activity_uuids = set()
    for row in rows:
        for key in ("activity_uuid", "last_activity_uuid"):
            if row.get(key):
                activity_uuids.add(row[key])

    # Batch fetch activities
    activity_map: dict[str, Activity] = {}
    if activity_uuids:
        activities = (await db_session.execute(
            select(Activity).where(Activity.activity_uuid.in_(list(activity_uuids)))  # type: ignore
        )).scalars().all()
        activity_map = {a.activity_uuid: a for a in activities}

        # Also resolve course_uuid for activities (needed when rows don't have course_uuid)
        activity_course_ids = {a.course_id for a in activities if a.course_id}
        missing_course_ids = activity_course_ids - {c.id for c in course_map.values()}
        if missing_course_ids:
            extra_courses = (await db_session.execute(
                select(Course).where(Course.id.in_(list(missing_course_ids)))  # type: ignore
            )).scalars().all()
            for c in extra_courses:
                course_map[c.course_uuid] = c

    # Build course_id -> course_uuid lookup for activity enrichment
    course_id_to_obj = {c.id: c for c in course_map.values()}

    # Inject metadata into rows
    for row in rows:
        if row.get("course_uuid"):
            course = course_map.get(row["course_uuid"])
            if course:
                row["course_name"] = course.name
                row["thumbnail_image"] = course.thumbnail_image or ""

        for key in ("activity_uuid", "last_activity_uuid"):
            if row.get(key):
                activity = activity_map.get(row[key])
                if activity:
                    name_key = "activity_name" if key == "activity_uuid" else "last_activity_name"
                    row[name_key] = activity.name
                    # If row doesn't have course_uuid, resolve it from the activity
                    if not row.get("course_uuid") and activity.course_id:
                        parent_course = course_id_to_obj.get(activity.course_id)
                        if parent_course:
                            row["course_uuid"] = parent_course.course_uuid
                            row["course_name"] = parent_course.name

    return rows
