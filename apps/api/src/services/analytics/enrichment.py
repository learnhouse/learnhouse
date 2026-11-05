"""Resolve raw analytics identifiers into human-readable names.

Analytics rows come out of the event pipeline carrying only uuids
(``course_uuid`` / ``activity_uuid``, and for the per-feature dashboards
``community_uuid``, ``path_uuid``, ``podcast_uuid``, ``episode_uuid``,
``resource_uuid`` and ``kind`` + ``uuid`` for boards and playgrounds).
Nothing downstream (dashboards, exports, the per-student audit
dossier) should ever show a caller a bare UUID, so every consumer runs its rows
through :func:`enrich_with_metadata` first.

Lives in ``services`` rather than in the analytics router because the audit dossier
service needs it too, and a service importing from ``src.routers`` would be a layering
inversion (the analytics router also carries the endpoints and their auth gates).
"""
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.boards import Board
from src.db.communities.communities import Community
from src.db.courses.activities import Activity
from src.db.courses.courses import Course
from src.db.folders.folders import Folder
from src.db.media.media import Media
from src.db.paths import Path as LearningPath
from src.db.playgrounds import Playground
from src.db.podcasts.episodes import PodcastEpisode
from src.db.podcasts.podcasts import Podcast

# Row key holding a uuid -> (model, uuid column, display column, key the name lands in).
_NAMED_KEYS = {
    "community_uuid": (Community, "community_uuid", "name", "community_name"),
    "path_uuid": (LearningPath, "path_uuid", "name", "path_name"),
    "podcast_uuid": (Podcast, "podcast_uuid", "name", "podcast_name"),
    "episode_uuid": (PodcastEpisode, "episode_uuid", "title", "episode_title"),
}

# Rows shaped ``{"kind": ..., "uuid": ...}`` (top boards and playgrounds).
_KIND_MODELS = {
    "board": (Board, "board_uuid"),
    "playground": (Playground, "playground_uuid"),
}

# Library items are referenced by a prefixed uuid; the prefix says which table
# holds the name (same prefixes as ``services/folders``).
_RESOURCE_PREFIXES = {
    "course_": (Course, "course_uuid"),
    "podcast_": (Podcast, "podcast_uuid"),
    "community_": (Community, "community_uuid"),
    "board_": (Board, "board_uuid"),
    "playground_": (Playground, "playground_uuid"),
    "media_": (Media, "media_uuid"),
    "folder_": (Folder, "folder_uuid"),
    "path_": (LearningPath, "path_uuid"),
}


async def enrich_with_metadata(
    rows: list[dict], db_session: AsyncSession, org_id: int | None = None
) -> list[dict]:
    """Enrich analytics result rows with course/activity metadata from PostgreSQL.

    Mutates and returns ``rows``. Rows without a recognised uuid are left untouched.

    Event uuids come from client-supplied event properties, so pass ``org_id`` to
    resolve names only for that org's courses and activities: a uuid from another
    org must not turn into that org's course name on this org's dashboard.
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
        query = select(Course).where(Course.course_uuid.in_(list(course_uuids)))  # type: ignore
        if org_id is not None:
            query = query.where(Course.org_id == org_id)
        courses = (await db_session.execute(query)).scalars().all()
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
        query = select(Activity).where(Activity.activity_uuid.in_(list(activity_uuids)))  # type: ignore
        if org_id is not None:
            query = query.where(Activity.org_id == org_id)
        activities = (await db_session.execute(query)).scalars().all()
        activity_map = {a.activity_uuid: a for a in activities}

        # Also resolve course_uuid for activities (needed when rows don't have course_uuid)
        activity_course_ids = {a.course_id for a in activities if a.course_id}
        missing_course_ids = activity_course_ids - {c.id for c in course_map.values()}
        if missing_course_ids:
            query = select(Course).where(Course.id.in_(list(missing_course_ids)))  # type: ignore
            if org_id is not None:
                query = query.where(Course.org_id == org_id)
            extra_courses = (await db_session.execute(query)).scalars().all()
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

    await _enrich_feature_names(rows, db_session, org_id)
    return rows


async def _names(
    db_session: AsyncSession,
    model,
    uuid_field: str,
    uuids: set[str],
    org_id: int | None,
    name_field: str = "name",
) -> dict[str, str]:
    """uuid -> display name for ``model`` rows, restricted to ``org_id`` when given."""
    if not uuids:
        return {}
    uuid_col = getattr(model, uuid_field)
    query = select(uuid_col, getattr(model, name_field)).where(uuid_col.in_(sorted(uuids)))
    if org_id is not None:
        query = query.where(model.org_id == org_id)
    return {uuid: name for uuid, name in (await db_session.execute(query)).all()}


def _str_value(row: dict, key: str) -> str:
    value = row.get(key)
    return value if isinstance(value, str) else ""


async def _enrich_feature_names(
    rows: list[dict], db_session: AsyncSession, org_id: int | None
) -> None:
    """Names for the per-feature dashboards: communities, paths, podcasts and
    episodes, boards and playgrounds, library resources. One query per kind
    that actually appears in ``rows``, with the same org scoping as courses."""
    for key, (model, uuid_field, name_field, target) in _NAMED_KEYS.items():
        uuids = {_str_value(row, key) for row in rows} - {""}
        names = await _names(db_session, model, uuid_field, uuids, org_id, name_field)
        for row in rows:
            name = names.get(_str_value(row, key))
            if name is not None:
                row[target] = name

    for kind, (model, uuid_field) in _KIND_MODELS.items():
        kind_rows = [row for row in rows if row.get("kind") == kind and _str_value(row, "uuid")]
        names = await _names(db_session, model, uuid_field, {row["uuid"] for row in kind_rows}, org_id)
        for row in kind_rows:
            name = names.get(row["uuid"])
            if name is not None:
                row["name"] = name

    by_prefix: dict[str, set[str]] = {}
    for row in rows:
        uuid = _str_value(row, "resource_uuid")
        prefix = next((p for p in _RESOURCE_PREFIXES if uuid.startswith(p)), None)
        if prefix:
            by_prefix.setdefault(prefix, set()).add(uuid)
    resource_names: dict[str, str] = {}
    for prefix, uuids in by_prefix.items():
        model, uuid_field = _RESOURCE_PREFIXES[prefix]
        resource_names.update(await _names(db_session, model, uuid_field, uuids, org_id))
    for row in rows:
        name = resource_names.get(_str_value(row, "resource_uuid"))
        if name is not None:
            row["resource_name"] = name
