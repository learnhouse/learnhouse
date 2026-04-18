from typing import Any, Iterable, List, Sequence
from fastapi import Request
from sqlalchemy import ColumnElement, func, true as sa_true
from sqlmodel import Session, select, or_, and_
from pydantic import BaseModel, ConfigDict
from src.db.users import PublicUser, AnonymousUser, UserRead, User, APITokenUser
from src.db.courses.courses import Course, CourseRead
from src.db.collections import Collection, CollectionRead
from src.db.collections_courses import CollectionCourse
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.communities.communities import Community, CommunityRead
from src.db.communities.discussions import Discussion, DiscussionRead
from src.db.playgrounds import Playground, PlaygroundRead, PlaygroundAccessType
from src.db.podcasts.podcasts import Podcast, PodcastRead
from src.services.courses.courses import search_courses
from src.security.org_auth import is_org_member


class SearchDiscussionRead(DiscussionRead):
    """DiscussionRead plus the parent community UUID so the UI can deep-link
    to `/community/{uuid}/discussion/{uuid}` without another round trip."""

    community_uuid: str = ""


class SearchResult(BaseModel):
    """Paginated search result grouped by resource type.

    Each resource list is capped at `limit` per page; `total_*` holds the full
    count for the whole query so the UI can show per-tab totals.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    courses: List[CourseRead]
    collections: List[CollectionRead]
    users: List[UserRead]
    communities: List[CommunityRead]
    discussions: List[SearchDiscussionRead]
    playgrounds: List[PlaygroundRead]
    podcasts: List[PodcastRead]

    total_courses: int = 0
    total_collections: int = 0
    total_users: int = 0
    total_communities: int = 0
    total_discussions: int = 0
    total_playgrounds: int = 0
    total_podcasts: int = 0


def _empty_result() -> SearchResult:
    return SearchResult(
        courses=[],
        collections=[],
        users=[],
        communities=[],
        discussions=[],
        playgrounds=[],
        podcasts=[],
    )


def _escape_like_wildcards(query: str) -> str:
    """Escape SQL LIKE wildcards to prevent enumeration via pattern matching."""
    return query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


def _ilike_any(columns: Sequence[ColumnElement[Any]], pattern: str) -> ColumnElement[bool]:
    """Return a SQL boolean matching `pattern` against any of the given columns.

    Uses SQLAlchemy's `ilike`, which is parameterized and keeps the driver
    responsible for escaping — no string interpolation on user input.
    """
    return or_(*(column.ilike(pattern) for column in columns))


def _paginate_and_count(
    db_session: Session,
    query,
    page: int,
    limit: int,
) -> tuple[list, int]:
    """Run `query` with LIMIT/OFFSET for the current page and return both the
    page rows and the full unpaginated count in one helper."""
    offset = (page - 1) * limit
    rows = db_session.exec(query.offset(offset).limit(limit)).all()
    total = db_session.exec(
        select(func.count()).select_from(query.order_by(None).subquery())
    ).one()
    return list(rows), int(total)


async def search_across_org(
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    org_slug: str,
    search_query: str,
    db_session: Session,
    page: int = 1,
    limit: int = 10,
) -> SearchResult:
    """Search across the org's resources with per-type access control.

    SECURITY:
    - Anonymous users see public content only; they cannot search users.
    - Authenticated non-members see public content only; they cannot search users.
    - Org members additionally see org-scoped non-public content where the
      resource itself doesn't restrict it further (e.g. unpublished items and
      usergroup-restricted playgrounds are always excluded from search).
    - Pattern matching goes through SQLAlchemy `ilike` — fully parameterized.
    - Limit is capped at 50 per page.
    """
    from fastapi import HTTPException, status

    limit = min(limit, 50)

    pattern = f"%{_escape_like_wildcards(search_query)}%"

    org = db_session.exec(
        select(Organization).where(Organization.slug == org_slug)
    ).first()
    if not org:
        return _empty_result()

    if isinstance(current_user, APITokenUser):
        if org.id != current_user.org_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API token cannot search in organizations outside its scope",
            )
        if current_user.rights:
            rights = current_user.rights
            if isinstance(rights, dict):
                search_rights = rights.get("search", {})
                has_permission = search_rights.get("action_read", False)
            else:
                search_rights = getattr(rights, "search", None)
                has_permission = bool(
                    search_rights and getattr(search_rights, "action_read", False)
                )
            if not has_permission:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="API token does not have search permission",
                )

    is_anon = isinstance(current_user, AnonymousUser)
    user_is_member = (
        not is_anon and is_org_member(current_user.id, org.id, db_session)
    )
    only_public = is_anon or not user_is_member

    # ── Courses ──────────────────────────────────────────────────────────────
    # `search_courses` already applies its own per-user access filter.
    courses = await search_courses(
        request, current_user, org_slug, search_query, db_session, page, limit
    )
    total_courses = len(courses)

    # ── Collections ──────────────────────────────────────────────────────────
    collections_q = (
        select(Collection)
        .where(Collection.org_id == org.id)
        .where(_ilike_any([Collection.name, Collection.description], pattern))
    )
    if is_anon:
        collections_q = collections_q.where(Collection.public == sa_true())
    collections, total_collections = _paginate_and_count(
        db_session, collections_q, page, limit
    )

    # ── Users (org members only; anonymous and non-member traffic is denied) ─
    if only_public:
        users: list = []
        total_users = 0
    else:
        users_q = (
            select(User)
            .join(UserOrganization, and_(
                UserOrganization.user_id == User.id,
                UserOrganization.org_id == org.id,
            ))
            .where(
                _ilike_any(
                    [User.username, User.first_name, User.last_name, User.bio],
                    pattern,
                )
            )
        )
        users, total_users = _paginate_and_count(db_session, users_q, page, limit)

    # ── Communities ──────────────────────────────────────────────────────────
    communities_q = (
        select(Community)
        .where(Community.org_id == org.id)
        .where(_ilike_any([Community.name, Community.description], pattern))
    )
    if only_public:
        communities_q = communities_q.where(Community.public == sa_true())
    communities, total_communities = _paginate_and_count(
        db_session, communities_q, page, limit
    )

    # ── Discussions (inherit access from their community) ────────────────────
    discussions_q = (
        select(Discussion, Community.community_uuid)
        .join(Community, Community.id == Discussion.community_id)
        .where(Discussion.org_id == org.id)
        .where(_ilike_any([Discussion.title, Discussion.content], pattern))
    )
    if only_public:
        discussions_q = discussions_q.where(Community.public == sa_true())
    discussions, total_discussions = _paginate_and_count(
        db_session, discussions_q, page, limit
    )

    # ── Playgrounds (published only; restricted are usergroup-gated elsewhere) ─
    playgrounds_q = (
        select(Playground)
        .where(Playground.org_id == org.id)
        .where(Playground.published == sa_true())
        .where(_ilike_any([Playground.name, Playground.description], pattern))
    )
    if only_public:
        playgrounds_q = playgrounds_q.where(
            Playground.access_type == PlaygroundAccessType.PUBLIC
        )
    else:
        playgrounds_q = playgrounds_q.where(
            Playground.access_type.in_([  # type: ignore[attr-defined]
                PlaygroundAccessType.PUBLIC,
                PlaygroundAccessType.AUTHENTICATED,
            ])
        )
    playgrounds, total_playgrounds = _paginate_and_count(
        db_session, playgrounds_q, page, limit
    )

    # ── Podcasts ─────────────────────────────────────────────────────────────
    podcasts_q = (
        select(Podcast)
        .where(Podcast.org_id == org.id)
        .where(Podcast.published == sa_true())
        .where(_ilike_any([Podcast.name, Podcast.description, Podcast.tags], pattern))
    )
    if only_public:
        podcasts_q = podcasts_q.where(Podcast.public == sa_true())
    podcasts, total_podcasts = _paginate_and_count(
        db_session, podcasts_q, page, limit
    )

    collection_reads = _build_collection_reads(db_session, collections)

    user_reads = [UserRead.model_validate(u) for u in users]
    community_reads = [CommunityRead.model_validate(c) for c in communities]
    discussion_reads = [
        SearchDiscussionRead(
            **discussion.model_dump(),
            community_uuid=community_uuid or "",
        )
        for discussion, community_uuid in discussions
    ]

    playground_reads: list[PlaygroundRead] = []
    for pg in playgrounds:
        read = PlaygroundRead.model_validate(pg)
        read.org_uuid = org.org_uuid
        read.org_slug = org.slug
        playground_reads.append(read)

    podcast_reads = [PodcastRead(**p.model_dump(), authors=[]) for p in podcasts]

    return SearchResult(
        courses=courses,
        collections=collection_reads,
        users=user_reads,
        communities=community_reads,
        discussions=discussion_reads,
        playgrounds=playground_reads,
        podcasts=podcast_reads,
        total_courses=total_courses,
        total_collections=total_collections,
        total_users=total_users,
        total_communities=total_communities,
        total_discussions=total_discussions,
        total_playgrounds=total_playgrounds,
        total_podcasts=total_podcasts,
    )


def _build_collection_reads(
    db_session: Session, collections: Iterable[Collection]
) -> list[CollectionRead]:
    """Hydrate each collection with its course list in a single batched query."""
    collections = list(collections)
    if not collections:
        return []

    collection_ids = [c.id for c in collections]
    batch = db_session.exec(
        select(CollectionCourse, Course)
        .join(Course, CollectionCourse.course_id == Course.id)  # type: ignore[arg-type]
        .where(CollectionCourse.collection_id.in_(collection_ids))  # type: ignore[attr-defined]
        .distinct()
    ).all()

    courses_by_collection: dict[int, list[Course]] = {}
    seen: set[tuple[int, int]] = set()
    for cc, course in batch:
        key = (cc.collection_id, course.id)
        if key in seen:
            continue
        seen.add(key)
        courses_by_collection.setdefault(cc.collection_id, []).append(course)

    return [
        CollectionRead(
            **c.model_dump(),
            courses=courses_by_collection.get(c.id, []),
        )
        for c in collections
    ]
