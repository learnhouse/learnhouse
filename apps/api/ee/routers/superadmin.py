import copy
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import Integer
from sqlmodel import Session, select, func
from src.core.events.database import get_db_session
from src.db.organizations import Organization
from src.db.organization_config import OrganizationConfig
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.db.roles import Role
from src.db.custom_domains import CustomDomain
from src.db.courses.courses import Course
from src.security.superadmin import require_superadmin

logger = logging.getLogger(__name__)

router = APIRouter()


class SuperadminStatusResponse(BaseModel):
    is_superadmin: bool


class AdminUserInfo(BaseModel):
    username: str
    email: str
    avatar_image: str | None = None
    user_uuid: str = ""


class OrganizationWithUserCount(BaseModel):
    id: int
    org_uuid: str
    name: str
    slug: str
    description: str | None = None
    email: str
    logo_image: str | None = None
    thumbnail_image: str | None = None
    creation_date: str
    update_date: str
    user_count: int = 0
    course_count: int = 0
    plan: str = "free"
    custom_domains: list[str] = []
    admin_users: list[AdminUserInfo] = []


class OrgDetailResponse(BaseModel):
    id: int
    org_uuid: str
    name: str
    slug: str
    email: str
    description: str | None = None
    about: str | None = None
    logo_image: str | None = None
    thumbnail_image: str | None = None
    creation_date: str
    update_date: str
    user_count: int = 0
    course_count: int = 0
    plan: str = "free"
    custom_domains: list[str] = []
    admin_users: list[AdminUserInfo] = []
    config: dict = {}


class OrgCourseInfo(BaseModel):
    id: int
    course_uuid: str
    name: str
    description: str | None = None
    thumbnail_image: str | None = None
    published: bool = False
    public: bool = False
    creation_date: str = ""
    update_date: str = ""


class OrgUserInfo(BaseModel):
    id: int
    user_uuid: str
    username: str
    email: str
    avatar_image: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    role_name: str = ""
    creation_date: str = ""


class PaginatedResponse(BaseModel):
    items: list = []
    total: int = 0
    page: int = 1
    limit: int = 20


class PlanUpdateRequest(BaseModel):
    plan: str  # free, standard, pro, enterprise


class GlobalUserInfo(BaseModel):
    id: int
    user_uuid: str
    username: str
    email: str
    first_name: str | None = None
    last_name: str | None = None
    avatar_image: str | None = None
    is_superadmin: bool = False
    org_count: int = 0
    orgs: list[dict] = []  # [{id, name, slug, role_name}]
    creation_date: str = ""
    update_date: str = ""


class OrgSettingsUpdateRequest(BaseModel):
    name: str | None = None
    slug: str | None = None
    email: str | None = None
    description: str | None = None


class OrgConfigUpdateRequest(BaseModel):
    config: dict


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_org_plan(org_config: OrganizationConfig | None) -> str:
    if org_config and org_config.config:
        config_data = org_config.config
        if isinstance(config_data, dict):
            version = config_data.get("config_version", "1.0")
            if version.startswith("2"):
                return config_data.get("plan", "free")
            return config_data.get("cloud", {}).get("plan", "free")
    return "free"


def _get_admin_users(db_session: Session, org_ids: list[int]) -> dict[int, list[AdminUserInfo]]:
    admins_by_org: dict[int, list[AdminUserInfo]] = {}
    if not org_ids:
        return admins_by_org
    admin_stmt = (
        select(User, UserOrganization.org_id, Role)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .join(Role, Role.id == UserOrganization.role_id)
        .where(UserOrganization.org_id.in_(org_ids))
    )
    for user, uo_org_id, role in db_session.exec(admin_stmt).all():
        rights = role.rights
        if isinstance(rights, dict):
            has_dashboard = rights.get("dashboard", {}).get("action_access", False)
        else:
            has_dashboard = getattr(getattr(rights, "dashboard", None), "action_access", False) if rights else False
        if has_dashboard:
            admins_by_org.setdefault(uo_org_id, []).append(
                AdminUserInfo(
                    username=user.username,
                    email=user.email,
                    avatar_image=user.avatar_image,
                    user_uuid=user.user_uuid,
                )
            )
    return admins_by_org


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

@router.get("/status")
async def get_superadmin_status(
    current_user: PublicUser = Depends(require_superadmin),
) -> SuperadminStatusResponse:
    return SuperadminStatusResponse(is_superadmin=True)


# ---------------------------------------------------------------------------
# Global users list
# ---------------------------------------------------------------------------

@router.get("/users")
async def list_all_users(
    page: int = 1,
    limit: int = 20,
    sort: str = "id",
    search: str = "",
    superadmin: str = "",
    min_orgs: int = 0,
    max_orgs: int = 0,
    current_user: PublicUser = Depends(require_superadmin),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """List all users across the platform with org counts and filters."""
    from src.db.organizations import Organization as Org

    offset = (page - 1) * limit

    # Subquery: org count per user
    org_count_subq = (
        select(
            UserOrganization.user_id,
            func.count(UserOrganization.org_id).label("org_count"),
        )
        .group_by(UserOrganization.user_id)
        .subquery()
    )

    # Filters
    filters = []
    if search:
        s = f"%{search}%"
        filters.append(
            (User.username.ilike(s))
            | (User.email.ilike(s))
            | (User.first_name.ilike(s))
            | (User.last_name.ilike(s))
        )
    if superadmin == "yes":
        filters.append(User.is_superadmin == True)
    elif superadmin == "no":
        filters.append(User.is_superadmin == False)
    if min_orgs > 0:
        filters.append(func.coalesce(org_count_subq.c.org_count, 0) >= min_orgs)
    if max_orgs > 0:
        filters.append(func.coalesce(org_count_subq.c.org_count, 0) <= max_orgs)

    # Count query
    count_stmt = (
        select(func.count(User.id))
        .outerjoin(org_count_subq, org_count_subq.c.user_id == User.id)
    )
    for f in filters:
        count_stmt = count_stmt.where(f)
    total = db_session.exec(count_stmt).one()

    # Data query
    org_count_col = func.coalesce(org_count_subq.c.org_count, 0).label("org_count")
    data_stmt = (
        select(User, org_count_col)
        .outerjoin(org_count_subq, org_count_subq.c.user_id == User.id)
    )
    for f in filters:
        data_stmt = data_stmt.where(f)

    sort_map = {
        "newest": User.id.desc(),
        "oldest": User.id.asc(),
        "orgs_desc": org_count_col.desc(),
        "orgs_asc": org_count_col.asc(),
        "username": User.username.asc(),
        "recently_updated": User.update_date.desc(),
    }
    data_stmt = data_stmt.order_by(sort_map.get(sort, User.id))
    data_stmt = data_stmt.offset(offset).limit(limit)

    results = db_session.exec(data_stmt).all()

    # Batch-fetch org memberships for users on this page
    user_ids = [u.id for u, _ in results]
    orgs_by_user: dict[int, list[dict]] = {}
    if user_ids:
        membership_stmt = (
            select(UserOrganization, Org.name, Org.slug, Role.name.label("role_name"))
            .join(Org, Org.id == UserOrganization.org_id)
            .join(Role, Role.id == UserOrganization.role_id)
            .where(UserOrganization.user_id.in_(user_ids))
            .order_by(Org.name)
        )
        for uo, org_name, org_slug, role_name in db_session.exec(membership_stmt).all():
            orgs_by_user.setdefault(uo.user_id, []).append({
                "id": uo.org_id,
                "name": org_name,
                "slug": org_slug,
                "role_name": role_name,
            })

    items = [
        GlobalUserInfo(
            id=user.id,
            user_uuid=user.user_uuid,
            username=user.username,
            email=user.email,
            first_name=user.first_name,
            last_name=user.last_name,
            avatar_image=user.avatar_image,
            is_superadmin=user.is_superadmin,
            org_count=org_count,
            orgs=orgs_by_user.get(user.id, []),
            creation_date=user.creation_date,
            update_date=user.update_date,
        )
        for user, org_count in results
    ]

    return {"items": items, "total": total, "page": page, "limit": limit}


# ---------------------------------------------------------------------------
# Organization list
# ---------------------------------------------------------------------------

@router.get("/organizations")
async def list_all_organizations(
    page: int = 1,
    limit: int = 20,
    sort: str = "id",
    search: str = "",
    plan: str = "",
    current_user: PublicUser = Depends(require_superadmin),
    db_session: Session = Depends(get_db_session),
) -> dict:
    offset = (page - 1) * limit

    # "most_visits" needs Tinybird — handled in a separate path
    if sort == "most_visits":
        return await _list_orgs_by_visits(page, limit, offset, search, plan, db_session)

    # ── shared WHERE filters (used by both count and data queries) ──
    from src.security.rbac.constants import ADMIN_ROLE_ID
    from ee.db.payments.payments import PaymentsConfig
    from src.db.trail_runs import TrailRun

    filters = []
    if search:
        search_filter = f"%{search}%"
        filters.append(
            (Organization.name.ilike(search_filter)) |
            (Organization.slug.ilike(search_filter)) |
            (Organization.email.ilike(search_filter))
        )
    if plan:
        # Support both v2 (config->>'plan') and v1 (config->'cloud'->>'plan')
        from sqlalchemy import func as sa_func
        v2_plan = OrganizationConfig.config["plan"].as_string()
        v1_plan = OrganizationConfig.config["cloud"]["plan"].as_string()
        plan_expr = sa_func.coalesce(v2_plan, v1_plan)
        if plan == "free":
            # Orgs with no config or no plan are implicitly "free"
            from sqlalchemy import or_
            filters.append(or_(plan_expr == "free", plan_expr.is_(None)))
        elif plan == "paid":
            # Any plan that is not free (standard, pro, enterprise, etc.)
            from sqlalchemy import and_ as sa_and
            filters.append(sa_and(plan_expr.isnot(None), plan_expr != "free"))
        else:
            filters.append(plan_expr == plan)

    # ── total count (with all filters applied) ──
    count_stmt = (
        select(func.count(Organization.id))
        .outerjoin(OrganizationConfig, OrganizationConfig.org_id == Organization.id)
    )
    for f in filters:
        count_stmt = count_stmt.where(f)
    total = db_session.exec(count_stmt).one()

    # ── subqueries ──
    user_count_col = func.count(UserOrganization.user_id).label("user_count")

    course_count_subq = (
        select(Course.org_id, func.count(Course.id).label("cc"))
        .group_by(Course.org_id)
        .subquery()
    )
    admin_count_subq = (
        select(UserOrganization.org_id, func.count(UserOrganization.user_id).label("ac"))
        .where(UserOrganization.role_id == ADMIN_ROLE_ID)
        .group_by(UserOrganization.org_id)
        .subquery()
    )
    payments_subq = (
        select(
            PaymentsConfig.org_id,
            func.max(PaymentsConfig.active.cast(Integer)).label("pa"),
        )
        .group_by(PaymentsConfig.org_id)
        .subquery()
    )
    trails_subq = (
        select(TrailRun.org_id, func.count(TrailRun.id).label("tc"))
        .group_by(TrailRun.org_id)
        .subquery()
    )

    # ── main data query ──
    statement = (
        select(Organization, user_count_col, func.coalesce(course_count_subq.c.cc, 0).label("course_count"))
        .outerjoin(OrganizationConfig, OrganizationConfig.org_id == Organization.id)
        .outerjoin(UserOrganization, UserOrganization.org_id == Organization.id)
        .outerjoin(course_count_subq, course_count_subq.c.org_id == Organization.id)
        .outerjoin(admin_count_subq, admin_count_subq.c.org_id == Organization.id)
        .outerjoin(payments_subq, payments_subq.c.org_id == Organization.id)
        .outerjoin(trails_subq, trails_subq.c.org_id == Organization.id)
        .group_by(Organization.id, course_count_subq.c.cc, admin_count_subq.c.ac, payments_subq.c.pa, trails_subq.c.tc)
    )
    for f in filters:
        statement = statement.where(f)

    # ── sorting ──
    course_count_label = func.coalesce(course_count_subq.c.cc, 0)
    sort_map = {
        "users_desc":      user_count_col.desc(),
        "users_asc":       user_count_col.asc(),
        "courses_desc":    course_count_label.desc(),
        "newest":          Organization.id.desc(),
        "oldest":          Organization.id.asc(),
        "most_admins":     func.coalesce(admin_count_subq.c.ac, 0).desc(),
        "payments_active": func.coalesce(payments_subq.c.pa, 0).desc(),
        "most_trails":     func.coalesce(trails_subq.c.tc, 0).desc(),
        "recently_updated": Organization.update_date.desc(),
    }
    statement = statement.order_by(sort_map.get(sort, Organization.id))

    # ── paginate ──
    statement = statement.offset(offset).limit(limit)
    results = db_session.exec(statement).all()

    return _build_org_response(results, page, limit, total, db_session)


def _build_org_response(
    results: list, page: int, limit: int, total: int, db_session: Session,
) -> dict:
    """Enrich org query results with domains, admins, config, and plan."""
    org_ids = [org.id for org, _, _ in results]

    # Batch fetch custom domains
    domains_by_org: dict[int, list[str]] = {}
    if org_ids:
        domain_stmt = select(CustomDomain).where(
            CustomDomain.org_id.in_(org_ids),
            CustomDomain.status == "verified",
        )
        for cd in db_session.exec(domain_stmt).all():
            domains_by_org.setdefault(cd.org_id, []).append(cd.domain)

    admins_by_org = _get_admin_users(db_session, org_ids)

    # Batch fetch configs for plan display
    configs_by_org: dict[int, OrganizationConfig] = {}
    if org_ids:
        config_stmt = select(OrganizationConfig).where(OrganizationConfig.org_id.in_(org_ids))
        for cfg in db_session.exec(config_stmt).all():
            configs_by_org[cfg.org_id] = cfg

    orgs = []
    for org, user_count, course_count in results:
        orgs.append(OrganizationWithUserCount(
            id=org.id,
            org_uuid=org.org_uuid,
            name=org.name,
            slug=org.slug,
            description=org.description,
            email=org.email,
            logo_image=org.logo_image,
            thumbnail_image=org.thumbnail_image,
            creation_date=org.creation_date,
            update_date=org.update_date,
            user_count=user_count,
            course_count=course_count,
            plan=_get_org_plan(configs_by_org.get(org.id)),
            custom_domains=domains_by_org.get(org.id, []),
            admin_users=admins_by_org.get(org.id, []),
        ))

    return {"items": orgs, "total": total, "page": page, "limit": limit}


async def _list_orgs_by_visits(
    page: int, limit: int, offset: int, search: str, plan: str, db_session: Session,
) -> dict:
    """Sort organizations by Tinybird page_view count (last 30 days)."""
    from src.routers.analytics import _execute_tinybird_query

    # 1. Get visit counts per org from Tinybird
    visits_by_org: dict[int, int] = {}
    try:
        sql = """
        SELECT org_id, count() AS views
        FROM events
        WHERE event_name = 'page_view' AND timestamp >= now() - INTERVAL 30 DAY
        GROUP BY org_id
        ORDER BY views DESC
        """
        result = await _execute_tinybird_query(
            query_name="superadmin_org_visits_rank",
            sql=sql, org_id=0, days=30,
        )
        for row in result.get("data", []):
            visits_by_org[int(row["org_id"])] = int(row["views"])
    except Exception as e:
        logger.warning(f"Tinybird visit ranking failed, falling back to default order: {e}")

    # 2. Get all matching org IDs from Postgres (with search + plan filters)
    id_stmt = (
        select(Organization.id)
        .outerjoin(OrganizationConfig, OrganizationConfig.org_id == Organization.id)
    )
    if search:
        search_filter = f"%{search}%"
        id_stmt = id_stmt.where(
            (Organization.name.ilike(search_filter)) |
            (Organization.slug.ilike(search_filter)) |
            (Organization.email.ilike(search_filter))
        )
    if plan:
        # Support both v2 (config->>'plan') and v1 (config->'cloud'->>'plan')
        from sqlalchemy import func as sa_func
        v2_plan = OrganizationConfig.config["plan"].as_string()
        v1_plan = OrganizationConfig.config["cloud"]["plan"].as_string()
        plan_expr = sa_func.coalesce(v2_plan, v1_plan)
        if plan == "free":
            from sqlalchemy import or_
            id_stmt = id_stmt.where(or_(plan_expr == "free", plan_expr.is_(None)))
        elif plan == "paid":
            from sqlalchemy import and_ as sa_and
            id_stmt = id_stmt.where(sa_and(plan_expr.isnot(None), plan_expr != "free"))
        else:
            id_stmt = id_stmt.where(plan_expr == plan)
    all_ids = list(db_session.exec(id_stmt).all())

    # 3. Sort by visit count desc (orgs with no visits go to the end)
    all_ids.sort(key=lambda oid: visits_by_org.get(oid, 0), reverse=True)

    total = len(all_ids)
    page_ids = all_ids[offset : offset + limit]

    if not page_ids:
        return {"items": [], "total": total, "page": page, "limit": limit}

    # 4. Fetch full org data for this page
    user_count_col = func.count(UserOrganization.user_id).label("user_count")
    course_count_subq = (
        select(Course.org_id, func.count(Course.id).label("cc"))
        .group_by(Course.org_id)
        .subquery()
    )
    statement = (
        select(Organization, user_count_col, func.coalesce(course_count_subq.c.cc, 0).label("course_count"))
        .outerjoin(UserOrganization, UserOrganization.org_id == Organization.id)
        .outerjoin(course_count_subq, course_count_subq.c.org_id == Organization.id)
        .where(Organization.id.in_(page_ids))
        .group_by(Organization.id, course_count_subq.c.cc)
    )
    results = db_session.exec(statement).all()

    # 5. Re-sort results to match Tinybird ranking
    results_by_id = {org.id: (org, uc, cc) for org, uc, cc in results}
    ordered = [results_by_id[oid] for oid in page_ids if oid in results_by_id]

    return _build_org_response(ordered, page, limit, total, db_session)


# ---------------------------------------------------------------------------
# Organization visits (must be before {org_id} routes)
# ---------------------------------------------------------------------------

@router.get("/organizations/visits")
async def get_org_weekly_visits(
    current_user: PublicUser = Depends(require_superadmin),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """Get daily page_view counts per org for the last 7 days (for sparklines)."""
    from src.routers.analytics import _execute_tinybird_query

    sql = """
    SELECT
        org_id,
        toDate(timestamp) AS date,
        count() AS views
    FROM events
    WHERE
        event_name = 'page_view'
        AND timestamp >= now() - INTERVAL 7 DAY
    GROUP BY org_id, date
    ORDER BY org_id, date ASC
    """
    try:
        result = await _execute_tinybird_query(
            query_name="superadmin_org_weekly_visits",
            sql=sql,
            org_id=0,
            days=7,
        )
        return result
    except Exception as e:
        logger.warning(f"Failed to fetch org weekly visits: {e}")
        return {"data": [], "rows": 0, "meta": []}


# ---------------------------------------------------------------------------
# Organization detail
# ---------------------------------------------------------------------------

@router.get("/organizations/{org_id}")
async def get_organization_detail(
    org_id: int,
    current_user: PublicUser = Depends(require_superadmin),
    db_session: Session = Depends(get_db_session),
) -> OrgDetailResponse:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # User count
    user_count = db_session.exec(
        select(func.count(UserOrganization.user_id)).where(UserOrganization.org_id == org_id)
    ).one()

    # Course count
    course_count = db_session.exec(
        select(func.count(Course.id)).where(Course.org_id == org_id)
    ).one()

    # Config
    org_config = db_session.exec(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    ).first()

    # Custom domains
    domains = []
    domain_rows = db_session.exec(
        select(CustomDomain).where(CustomDomain.org_id == org_id, CustomDomain.status == "verified")
    ).all()
    for cd in domain_rows:
        domains.append(cd.domain)

    admins = _get_admin_users(db_session, [org_id]).get(org_id, [])

    return OrgDetailResponse(
        id=org.id,
        org_uuid=org.org_uuid,
        name=org.name,
        slug=org.slug,
        email=org.email,
        description=org.description,
        about=org.about,
        logo_image=org.logo_image,
        thumbnail_image=org.thumbnail_image,
        creation_date=org.creation_date,
        update_date=org.update_date,
        user_count=user_count,
        course_count=course_count,
        plan=_get_org_plan(org_config),
        custom_domains=domains,
        admin_users=admins,
        config=org_config.config if org_config else {},
    )


# ---------------------------------------------------------------------------
# Organization courses
# ---------------------------------------------------------------------------

@router.get("/organizations/{org_id}/courses")
async def list_org_courses(
    org_id: int,
    page: int = 1,
    limit: int = 50,
    current_user: PublicUser = Depends(require_superadmin),
    db_session: Session = Depends(get_db_session),
) -> PaginatedResponse:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    total = db_session.exec(
        select(func.count(Course.id)).where(Course.org_id == org_id)
    ).one()

    offset = (page - 1) * limit
    courses = db_session.exec(
        select(Course)
        .where(Course.org_id == org_id)
        .order_by(Course.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()

    items = [
        OrgCourseInfo(
            id=c.id,
            course_uuid=c.course_uuid,
            name=c.name,
            description=c.description,
            thumbnail_image=c.thumbnail_image,
            published=c.published,
            public=c.public,
            creation_date=c.creation_date,
            update_date=c.update_date,
        )
        for c in courses
    ]

    return PaginatedResponse(items=items, total=total, page=page, limit=limit)


# ---------------------------------------------------------------------------
# Organization users
# ---------------------------------------------------------------------------

@router.get("/organizations/{org_id}/users")
async def list_org_users(
    org_id: int,
    page: int = 1,
    limit: int = 50,
    search: str = "",
    current_user: PublicUser = Depends(require_superadmin),
    db_session: Session = Depends(get_db_session),
) -> PaginatedResponse:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    base_query = (
        select(User, Role, UserOrganization.creation_date)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .join(Role, Role.id == UserOrganization.role_id)
        .where(UserOrganization.org_id == org_id)
    )
    count_query = (
        select(func.count(UserOrganization.user_id))
        .where(UserOrganization.org_id == org_id)
    )

    if search:
        search_filter = f"%{search}%"
        base_query = base_query.where(
            (User.username.ilike(search_filter)) |
            (User.email.ilike(search_filter)) |
            (User.first_name.ilike(search_filter)) |
            (User.last_name.ilike(search_filter))
        )
        count_query = count_query.join(User, User.id == UserOrganization.user_id).where(
            (User.username.ilike(search_filter)) |
            (User.email.ilike(search_filter)) |
            (User.first_name.ilike(search_filter)) |
            (User.last_name.ilike(search_filter))
        )

    total = db_session.exec(count_query).one()

    offset = (page - 1) * limit
    rows = db_session.exec(
        base_query.order_by(User.id.desc()).offset(offset).limit(limit)
    ).all()

    items = [
        OrgUserInfo(
            id=user.id,
            user_uuid=user.user_uuid,
            username=user.username,
            email=user.email,
            avatar_image=user.avatar_image,
            first_name=user.first_name,
            last_name=user.last_name,
            role_name=role.name if role else "",
            creation_date=joined_at or "",
        )
        for user, role, joined_at in rows
    ]

    return PaginatedResponse(items=items, total=total, page=page, limit=limit)


# ---------------------------------------------------------------------------
# Update plan
# ---------------------------------------------------------------------------

@router.put("/organizations/{org_id}/plan")
async def update_org_plan(
    org_id: int,
    body: PlanUpdateRequest,
    current_user: PublicUser = Depends(require_superadmin),
    db_session: Session = Depends(get_db_session),
) -> dict:
    valid_plans = ("free", "standard", "pro", "enterprise")
    if body.plan not in valid_plans:
        raise HTTPException(status_code=400, detail=f"Invalid plan. Must be one of: {', '.join(valid_plans)}")

    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    org_config = db_session.exec(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    ).first()

    if not org_config:
        raise HTTPException(status_code=404, detail="Organization config not found")

    # Deep copy to ensure SQLAlchemy detects the change
    config = copy.deepcopy(org_config.config or {})
    version = config.get("config_version", "1.0")
    if version.startswith("2"):
        config["plan"] = body.plan
    else:
        if "cloud" not in config:
            config["cloud"] = {}
        config["cloud"]["plan"] = body.plan
    org_config.config = config
    org_config.update_date = datetime.now().isoformat()
    flag_modified(org_config, "config")

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    return {"status": "ok", "plan": body.plan}


# ---------------------------------------------------------------------------
# Update settings
# ---------------------------------------------------------------------------

@router.put("/organizations/{org_id}/settings")
async def update_org_settings(
    org_id: int,
    body: OrgSettingsUpdateRequest,
    current_user: PublicUser = Depends(require_superadmin),
    db_session: Session = Depends(get_db_session),
) -> dict:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if body.name is not None:
        org.name = body.name
    if body.slug is not None:
        # Check slug uniqueness
        existing = db_session.exec(
            select(Organization).where(Organization.slug == body.slug, Organization.id != org_id)
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Slug already in use")
        org.slug = body.slug
    if body.email is not None:
        org.email = body.email
    if body.description is not None:
        org.description = body.description

    org.update_date = datetime.now().isoformat()
    db_session.add(org)
    db_session.commit()

    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Update full config (features, limits, etc.)
# ---------------------------------------------------------------------------

@router.put("/organizations/{org_id}/config")
async def update_org_config(
    org_id: int,
    body: OrgConfigUpdateRequest,
    current_user: PublicUser = Depends(require_superadmin),
    db_session: Session = Depends(get_db_session),
) -> dict:
    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    org_config = db_session.exec(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    ).first()
    if not org_config:
        raise HTTPException(status_code=404, detail="Organization config not found")

    org_config.config = body.config
    org_config.update_date = datetime.now().isoformat()
    flag_modified(org_config, "config")
    db_session.add(org_config)
    db_session.commit()

    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Organization usage
# ---------------------------------------------------------------------------

@router.get("/organizations/{org_id}/usage")
async def get_org_usage(
    org_id: int,
    current_user: PublicUser = Depends(require_superadmin),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """Get usage and limits for an organization (superadmin auth)."""
    from src.security.features_utils.usage import (
        _get_actual_usage,
        _get_actual_admin_seat_count,
        _is_oss_mode,
    )
    from src.security.features_utils.plans import get_plan_limit

    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    org_config = db_session.exec(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    ).first()

    plan = _get_org_plan(org_config)
    oss_mode = _is_oss_mode()

    courses_usage = _get_actual_usage("courses", org_id, db_session)
    members_usage = _get_actual_usage("members", org_id, db_session)
    admin_seats_usage = _get_actual_admin_seat_count(org_id, db_session)

    courses_limit = 0 if oss_mode else get_plan_limit(plan, "courses")
    members_limit = 0 if oss_mode else get_plan_limit(plan, "members")
    admin_seats_limit = 0 if oss_mode else get_plan_limit(plan, "admin_seats")

    def calc_remaining(usage: int, limit: int) -> int | str:
        if limit == 0:
            return "unlimited"
        return max(0, limit - usage)

    def is_limit_reached(usage: int, limit: int) -> bool:
        if limit == 0:
            return False
        return usage >= limit

    return {
        "org_id": org_id,
        "plan": plan,
        "oss_mode": oss_mode,
        "features": {
            "courses": {
                "usage": courses_usage,
                "limit": courses_limit if courses_limit > 0 else "unlimited",
                "remaining": calc_remaining(courses_usage, courses_limit),
                "limit_reached": is_limit_reached(courses_usage, courses_limit),
            },
            "members": {
                "usage": members_usage,
                "limit": members_limit if members_limit > 0 else "unlimited",
                "remaining": calc_remaining(members_usage, members_limit),
                "limit_reached": is_limit_reached(members_usage, members_limit),
            },
            "admin_seats": {
                "usage": admin_seats_usage,
                "limit": admin_seats_limit if admin_seats_limit > 0 else "unlimited",
                "remaining": calc_remaining(admin_seats_usage, admin_seats_limit),
                "limit_reached": is_limit_reached(admin_seats_usage, admin_seats_limit),
            },
        },
    }


# ---------------------------------------------------------------------------
# Analytics (FIXED: ALL_QUERIES values are tuples, not callables)
# ---------------------------------------------------------------------------

@router.get("/organizations/{org_id}/analytics")
async def get_org_analytics(
    org_id: int,
    days: int = 30,
    current_user: PublicUser = Depends(require_superadmin),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """Get analytics for a specific organization."""
    from src.routers.analytics import _execute_tinybird_query
    from src.services.analytics.queries import CORE_QUERIES

    org = db_session.exec(select(Organization).where(Organization.id == org_id)).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    results = {}
    for query_name, (sql_template, default_days) in CORE_QUERIES.items():
        try:
            effective_days = days if days else default_days
            sql = sql_template.format(org_id=org_id, days=effective_days)
            result = await _execute_tinybird_query(
                query_name=f"superadmin_{query_name}",
                sql=sql,
                org_id=org_id,
                days=effective_days,
            )
            results[query_name] = result
        except Exception as e:
            logger.warning(f"Failed to fetch {query_name} for org {org_id}: {e}")
            results[query_name] = {"data": [], "rows": 0, "meta": []}

    return results


@router.get("/analytics/global")
async def get_global_analytics(
    days: int = 30,
    current_user: PublicUser = Depends(require_superadmin),
) -> dict:
    """Get cross-org global analytics."""
    from src.routers.analytics import _execute_tinybird_query
    from src.services.analytics.queries import CORE_QUERIES

    results = {}
    for query_name, (sql_template, default_days) in CORE_QUERIES.items():
        try:
            effective_days = days if days else default_days
            sql = sql_template.format(org_id=0, days=effective_days)
            result = await _execute_tinybird_query(
                query_name=f"global_{query_name}",
                sql=sql,
                org_id=0,
                days=effective_days,
            )
            results[query_name] = result
        except Exception as e:
            logger.warning(f"Failed to fetch global {query_name}: {e}")
            results[query_name] = {"data": [], "rows": 0, "meta": []}

    return results
