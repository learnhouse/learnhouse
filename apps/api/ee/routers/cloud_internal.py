import logging
import os
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select, func
from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.users import User
from src.db.user_organizations import UserOrganization
from src.db.courses.courses import Course
from src.db.roles import Role
from src.services.orgs.orgs import update_org_with_config_no_auth
from src.security.features_utils.plans import (
    PLAN_FEATURE_CONFIGS,
    PLAN_HIERARCHY,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# ── Utils ────────────────────────────────────────────────────────────────────

def check_internal_cloud_key(request: Request):
    provided_key = request.headers.get("CloudInternalKey", "")
    expected_key = os.environ.get("CLOUD_INTERNAL_KEY", "")
    # SECURITY: Use constant-time comparison to prevent timing attacks
    if not provided_key or not expected_key or not secrets.compare_digest(provided_key, expected_key):
        raise HTTPException(status_code=403, detail="Unauthorized")


# ── Endpoints ────────────────────────────────────────────────────────────────

class OrgConfigUpdateBody(BaseModel):
    config: dict


@router.put(
    "/update_org_config",
    summary="Update an organization config (no-auth internal)",
    description=(
        "Internal endpoint used by the control plane to overwrite an organization's "
        "configuration. This bypasses user auth and is protected by the internal "
        "cloud key header at the dependency level."
    ),
    dependencies=[Depends(check_internal_cloud_key)],
    responses={
        200: {"description": "Updated organization config payload returned by the service."},
        403: {"description": "Missing or invalid CloudInternalKey header"},
        404: {"description": "Organization not found"},
    },
)
async def update_org_Config(
    request: Request,
    org_id: int,
    body: OrgConfigUpdateBody,
    db_session: Session = Depends(get_db_session),
):
    res = await update_org_with_config_no_auth(
        request, body.config, org_id, db_session
    )
    return res


class UpdateOrgPlanRequest(BaseModel):
    org_id: int
    plan: str


@router.put(
    "/update_org_plan",
    summary="Update an organization plan",
    description=(
        "Update an organization's plan. Only changes the plan string; all feature "
        "limits and enabled flags are resolved at runtime from the plan name via "
        "plans.py. Requires the internal cloud key header."
    ),
    responses={
        200: {"description": "Plan updated successfully."},
        400: {"description": "Unknown plan name"},
        403: {"description": "Missing or invalid CloudInternalKey header"},
        404: {"description": "Organization or organization config not found"},
    },
)
async def update_org_plan(
    request: Request,
    body: UpdateOrgPlanRequest,
    db_session: Session = Depends(get_db_session),
):
    """
    Update an organization's plan. Only changes the plan string.
    All feature limits/enabled flags are resolved at runtime from
    the plan name via plans.py — no config overwrite needed.
    """
    check_internal_cloud_key(request)

    plan_config = PLAN_FEATURE_CONFIGS.get(body.plan)
    if not plan_config:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown plan: {body.plan}. Valid plans: {', '.join(PLAN_FEATURE_CONFIGS.keys())}",
        )

    # Find the org
    org = db_session.exec(
        select(Organization).where(Organization.id == body.org_id)
    ).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Find the org config
    org_config = db_session.exec(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    ).first()
    if not org_config:
        raise HTTPException(status_code=404, detail="Organization config not found")

    import json
    existing = json.loads(json.dumps(org_config.config or {}))
    version = existing.get("config_version", "1.0")

    if version.startswith("2"):
        # v2: plan is a top-level string
        existing["plan"] = body.plan
        # Free plan forces watermark on
        if body.plan == "free":
            existing.setdefault("customization", {}).setdefault("general", {})
            existing["customization"]["general"]["watermark"] = True
    else:
        # v1: plan is under cloud.plan, also update derived flags
        existing.setdefault("cloud", {})
        existing["cloud"]["plan"] = body.plan
        existing["cloud"]["custom_domain"] = plan_config["cloud"]["custom_domain"]
        existing.setdefault("general", {})
        existing["general"]["watermark"] = plan_config["general"]["watermark"]

    org_config.config = existing
    org_config.update_date = str(datetime.now())

    db_session.add(org_config)
    db_session.commit()
    db_session.refresh(org_config)

    logger.info("Updated org %d to plan '%s'", body.org_id, body.plan)
    return {"detail": f"Organization plan updated to '{body.plan}'"}


@router.get(
    "/plans",
    summary="List available plans and hierarchy",
    description=(
        "Return all available plan configs and the plan hierarchy. The platform app "
        "uses this instead of maintaining its own copy. Requires the internal cloud key."
    ),
    responses={
        200: {"description": "Plan feature configs and plan hierarchy."},
        403: {"description": "Missing or invalid CloudInternalKey header"},
    },
)
async def get_available_plans(request: Request):
    """
    Return all available plan configs. The platform app uses this
    instead of maintaining its own copy.
    """
    check_internal_cloud_key(request)
    return {
        "plans": PLAN_FEATURE_CONFIGS,
        "hierarchy": PLAN_HIERARCHY,
    }


# ── Email Automation Data ─────────────────────────────────────────────────


def _get_org_plan(org_config: OrganizationConfig | None) -> str:
    if org_config and org_config.config:
        config_data = org_config.config
        if isinstance(config_data, dict):
            version = config_data.get("config_version", "1.0")
            if version.startswith("2"):
                return config_data.get("plan", "free")
            return config_data.get("cloud", {}).get("plan", "free")
    return "free"


def _batch_get_admin_emails(
    db_session: Session, org_ids: list[int]
) -> dict[int, list[dict]]:
    """
    Return admin users (users with dashboard access) for multiple orgs
    in a single query. Returns {org_id: [{email, username}, ...]}.
    """
    if not org_ids:
        return {}

    stmt = (
        select(User, Role, UserOrganization.org_id)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .join(Role, Role.id == UserOrganization.role_id)
        .where(UserOrganization.org_id.in_(org_ids))
    )

    admins_by_org: dict[int, list[dict]] = {}
    for user, role, uo_org_id in db_session.exec(stmt).all():
        rights = role.rights
        if isinstance(rights, dict):
            has_dashboard = rights.get("dashboard", {}).get("action_access", False)
        else:
            has_dashboard = (
                getattr(getattr(rights, "dashboard", None), "action_access", False)
                if rights
                else False
            )
        if has_dashboard:
            admins_by_org.setdefault(uo_org_id, []).append({
                "email": user.email,
                "username": user.username,
            })

    return admins_by_org


@router.get(
    "/email_automation_data",
    summary="Get email automation data",
    description=(
        "Returns aggregated data for the platform cron jobs to decide which "
        "transactional emails to send. Includes recent signups, new orgs, new "
        "members, recently published courses, milestone orgs, inactive orgs, and "
        "digest orgs. Requires the internal cloud key."
    ),
    responses={
        200: {"description": "Aggregated email automation dataset."},
        403: {"description": "Missing or invalid CloudInternalKey header"},
    },
)
async def get_email_automation_data(
    request: Request,
    db_session: Session = Depends(get_db_session),
):
    """
    Returns aggregated data for the platform cron jobs to decide
    which transactional emails to send.

    Returned data:
    - recent_signups: users who signed up in the last 48h
    - recent_orgs: orgs created in the last 7 days with course counts
    - recent_members: users who joined an org in the last 48h
    - recently_published_courses: NEW courses (created in last 7d) that are published
    - milestone_orgs: orgs with member counts near milestone thresholds (10/50/100/500)
    - inactive_orgs: orgs with courses+members that haven't been updated in 14-30 days
    - digest_orgs: orgs with 5+ members (for weekly digest)
    """
    check_internal_cloud_key(request)

    now = datetime.now()
    cutoff_48h = now - timedelta(hours=48)
    cutoff_7d = now - timedelta(days=7)

    # ── Shared subqueries ────────────────────────────────────────────────

    course_count_subq = (
        select(Course.org_id, func.count(Course.id).label("cc"))
        .group_by(Course.org_id)
        .subquery()
    )
    member_count_subq = (
        select(
            UserOrganization.org_id,
            func.count(UserOrganization.user_id).label("mc"),
        )
        .group_by(UserOrganization.org_id)
        .subquery()
    )

    # ── Recent signups (last 48h) ────────────────────────────────────────

    recent_users_stmt = select(User).where(User.creation_date >= str(cutoff_48h))
    recent_users = db_session.exec(recent_users_stmt).all()

    user_ids = [u.id for u in recent_users]
    user_org_counts: dict[int, int] = {}
    if user_ids:
        uo_stmt = (
            select(UserOrganization.user_id, func.count(UserOrganization.org_id))
            .where(UserOrganization.user_id.in_(user_ids))
            .group_by(UserOrganization.user_id)
        )
        for uid, count in db_session.exec(uo_stmt).all():
            user_org_counts[uid] = count

    recent_signups = [
        {
            "id": u.id,
            "email": u.email,
            "username": u.username,
            "creation_date": u.creation_date,
            "email_verified": u.email_verified,
            "org_count": user_org_counts.get(u.id, 0),
        }
        for u in recent_users
    ]

    # ── Recent orgs (last 7 days) with course counts ─────────────────────

    recent_orgs_stmt = (
        select(
            Organization,
            func.coalesce(course_count_subq.c.cc, 0).label("course_count"),
            func.coalesce(member_count_subq.c.mc, 0).label("member_count"),
        )
        .outerjoin(course_count_subq, course_count_subq.c.org_id == Organization.id)
        .outerjoin(member_count_subq, member_count_subq.c.org_id == Organization.id)
        .where(Organization.creation_date >= str(cutoff_7d))
    )
    recent_orgs_results = db_session.exec(recent_orgs_stmt).all()

    recent_org_ids = [org.id for org, _, _ in recent_orgs_results]
    configs_by_org: dict[int, OrganizationConfig] = {}
    if recent_org_ids:
        config_stmt = select(OrganizationConfig).where(
            OrganizationConfig.org_id.in_(recent_org_ids)
        )
        for cfg in db_session.exec(config_stmt).all():
            configs_by_org[cfg.org_id] = cfg

    recent_org_admins = _batch_get_admin_emails(db_session, recent_org_ids)

    recent_orgs = []
    for org, course_count, member_count in recent_orgs_results:
        recent_orgs.append({
            "id": org.id,
            "org_uuid": org.org_uuid,
            "name": org.name,
            "slug": org.slug,
            "email": org.email,
            "creation_date": org.creation_date,
            "course_count": course_count,
            "member_count": member_count,
            "plan": _get_org_plan(configs_by_org.get(org.id)),
            "admin_emails": recent_org_admins.get(org.id, []),
        })

    # ── Recent member joins (last 48h) ───────────────────────────────────

    recent_joins_stmt = (
        select(User, Organization, UserOrganization.creation_date)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .join(Organization, Organization.id == UserOrganization.org_id)
        .where(UserOrganization.creation_date >= str(cutoff_48h))
    )
    recent_joins = db_session.exec(recent_joins_stmt).all()

    member_org_ids = list({org.id for _, org, _ in recent_joins})
    member_org_admins = _batch_get_admin_emails(db_session, member_org_ids)

    recent_members = []
    for user, org, joined_at in recent_joins:
        recent_members.append({
            "user_email": user.email,
            "username": user.username,
            "org_id": org.id,
            "org_name": org.name,
            "org_slug": org.slug,
            "joined_at": joined_at,
            "admin_emails": member_org_admins.get(org.id, []),
        })

    # ── Recently published courses ───────────────────────────────────────
    # Courses that are published AND were updated in the last 48h.
    # The cron side uses a permanent dedup key (365 days) per course_id
    # so each course only triggers the email once, even if edited later.

    published_stmt = (
        select(Course, Organization)
        .join(Organization, Organization.id == Course.org_id)
        .where(
            Course.published == True,
            Course.update_date >= str(cutoff_48h),
        )
    )
    published_results = db_session.exec(published_stmt).all()

    pub_org_ids = list({org.id for _, org in published_results})
    pub_org_admins = _batch_get_admin_emails(db_session, pub_org_ids)

    recently_published = []
    for course, org in published_results:
        recently_published.append({
            "course_id": course.id,
            "course_uuid": course.course_uuid,
            "course_name": course.name,
            "org_id": org.id,
            "org_name": org.name,
            "org_slug": org.slug,
            "published_at": course.update_date,
            "admin_emails": pub_org_admins.get(org.id, []),
        })

    # ── Milestone orgs (member count near 10/50/100/500) ─────────────────
    # Only fetch orgs where member_count is within 20% above a threshold.
    # This is: 10-12, 50-60, 100-120, 500-600.

    from sqlalchemy import or_ as sa_or

    mc = func.coalesce(member_count_subq.c.mc, 0)
    milestone_filters = sa_or(
        mc.between(10, 12),
        mc.between(50, 60),
        mc.between(100, 120),
        mc.between(500, 600),
    )

    milestone_stmt = (
        select(
            Organization,
            mc.label("member_count"),
        )
        .outerjoin(member_count_subq, member_count_subq.c.org_id == Organization.id)
        .where(milestone_filters)
    )
    milestone_results = db_session.exec(milestone_stmt).all()

    ms_org_ids = [org.id for org, _ in milestone_results]
    ms_org_admins = _batch_get_admin_emails(db_session, ms_org_ids)

    milestone_orgs = []
    for org, member_count in milestone_results:
        milestone_orgs.append({
            "id": org.id,
            "slug": org.slug,
            "name": org.name,
            "member_count": member_count,
            "admin_emails": ms_org_admins.get(org.id, []),
        })

    # ── Inactive orgs (14-30 days stale, has courses + 2+ members) ───────

    cutoff_14d = str(now - timedelta(days=14))
    cutoff_30d = str(now - timedelta(days=30))

    cc = func.coalesce(course_count_subq.c.cc, 0)
    mc2 = func.coalesce(member_count_subq.c.mc, 0)

    # New members in last 7 days per org
    week_ago = now - timedelta(days=7)
    new_members_week_subq = (
        select(
            UserOrganization.org_id,
            func.count(UserOrganization.user_id).label("nmc"),
        )
        .where(UserOrganization.creation_date >= str(week_ago))
        .group_by(UserOrganization.org_id)
        .subquery()
    )

    inactive_stmt = (
        select(
            Organization,
            cc.label("course_count"),
            mc2.label("member_count"),
            func.coalesce(new_members_week_subq.c.nmc, 0).label("new_members_this_week"),
        )
        .outerjoin(course_count_subq, course_count_subq.c.org_id == Organization.id)
        .outerjoin(member_count_subq, member_count_subq.c.org_id == Organization.id)
        .outerjoin(new_members_week_subq, new_members_week_subq.c.org_id == Organization.id)
        .where(
            Organization.update_date <= cutoff_14d,
            Organization.update_date >= cutoff_30d,
            cc >= 1,
            mc2 >= 2,
        )
    )
    inactive_results = db_session.exec(inactive_stmt).all()

    inact_org_ids = [org.id for org, _, _, _ in inactive_results]
    inact_org_admins = _batch_get_admin_emails(db_session, inact_org_ids)

    inactive_orgs = []
    for org, course_count, member_count, new_members_week in inactive_results:
        inactive_orgs.append({
            "id": org.id,
            "slug": org.slug,
            "name": org.name,
            "update_date": org.update_date,
            "course_count": course_count,
            "member_count": member_count,
            "new_members_this_week": new_members_week,
            "admin_emails": inact_org_admins.get(org.id, []),
        })

    # ── Digest orgs (5+ members, for weekly digest) ──────────────────────

    digest_stmt = (
        select(
            Organization,
            func.coalesce(course_count_subq.c.cc, 0).label("course_count"),
            func.coalesce(member_count_subq.c.mc, 0).label("member_count"),
            func.coalesce(new_members_week_subq.c.nmc, 0).label("new_members_this_week"),
        )
        .outerjoin(course_count_subq, course_count_subq.c.org_id == Organization.id)
        .outerjoin(member_count_subq, member_count_subq.c.org_id == Organization.id)
        .outerjoin(new_members_week_subq, new_members_week_subq.c.org_id == Organization.id)
        .where(func.coalesce(member_count_subq.c.mc, 0) >= 5)
    )
    digest_results = db_session.exec(digest_stmt).all()

    digest_org_ids = [org.id for org, _, _, _ in digest_results]
    digest_org_admins = _batch_get_admin_emails(db_session, digest_org_ids)

    digest_orgs = []
    for org, course_count, member_count, new_members_week in digest_results:
        if new_members_week == 0 and course_count == 0:
            continue
        digest_orgs.append({
            "id": org.id,
            "slug": org.slug,
            "name": org.name,
            "course_count": course_count,
            "member_count": member_count,
            "new_members_this_week": new_members_week,
            "admin_emails": digest_org_admins.get(org.id, []),
        })

    return {
        "recent_signups": recent_signups,
        "recent_orgs": recent_orgs,
        "recent_members": recent_members,
        "recently_published_courses": recently_published,
        "milestone_orgs": milestone_orgs,
        "inactive_orgs": inactive_orgs,
        "digest_orgs": digest_orgs,
        "generated_at": now.isoformat(),
    }
