"""Email invitations, the admin side: send, list, edit, resend, copy link,
revoke, and bulk actions.

Every invitation is addressed to one email and carries the role, user groups
and courses to apply when the person joins, an optional personal note and an
expiry. The email holds a personal link (``/signup?invite=<token>``); only the
token's SHA-256 is stored. Resending mints a new emailed link (retiring the
previous one); copying a link to share by hand mints a separate one, so the
emailed link keeps working.

People who already belong are skipped (and reported as such) unless the
admin explicitly asks to update existing members, in which case their role
goes through the same checks as a role change on the members page.
"""

import logging
from typing import Literal, Optional, Union

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.ee_hooks import audit_event
from src.db.courses.courses import Course
from src.db.org_invitations import InvitationStatus, OrgInvitation
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.db.usergroups import UserGroup
from src.db.users import User
from src.services.email.dates import human_date
from src.services.orgs.invitations import policy
from src.services.orgs.invitations.policy import (
    Caller,
    DEFAULT_EXPIRY_DAYS,
    MAX_EXPIRY_DAYS,
    iso,
    utcnow,
)

logger = logging.getLogger(__name__)

PAGE_LIMIT = 200
BULK_LIMIT = 100
STATUSES = tuple(s.value for s in InvitationStatus)


class InvitationSettings(BaseModel):
    role_id: Optional[int] = None
    role_uuid: Optional[str] = Field(default=None, max_length=100)
    usergroup_ids: list[int] = Field(default_factory=list, max_length=policy.MAX_TARGETS)
    course_uuids: list[str] = Field(default_factory=list, max_length=policy.MAX_TARGETS)
    message: Optional[str] = Field(default=None, max_length=policy.MAX_MESSAGE_LENGTH * 2)
    expires_in_days: int = Field(default=DEFAULT_EXPIRY_DAYS, ge=1, le=MAX_EXPIRY_DAYS)


class InvitationCreate(InvitationSettings):
    emails: Union[list[str], str] = Field(..., description="Addresses, as a list or pasted text")
    update_existing_members: bool = False


class InvitationPreview(BaseModel):
    emails: Union[list[str], str]
    role_id: Optional[int] = None
    role_uuid: Optional[str] = Field(default=None, max_length=100)
    update_existing_members: bool = False


class InvitationUpdate(BaseModel):
    role_id: Optional[int] = None
    role_uuid: Optional[str] = Field(default=None, max_length=100)
    usergroup_ids: Optional[list[int]] = Field(default=None, max_length=policy.MAX_TARGETS)
    course_uuids: Optional[list[str]] = Field(default=None, max_length=policy.MAX_TARGETS)
    message: Optional[str] = Field(default=None, max_length=policy.MAX_MESSAGE_LENGTH * 2)
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=MAX_EXPIRY_DAYS)


class InvitationResend(BaseModel):
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=MAX_EXPIRY_DAYS)


class InvitationBulk(BaseModel):
    action: Literal["resend", "revoke"]
    invitation_uuids: list[str] = Field(..., min_length=1, max_length=BULK_LIMIT)


# ---------------------------------------------------------------------------
# Shared pieces
# ---------------------------------------------------------------------------


async def _context(request: Request, db_session: AsyncSession, org_id: int, current_user: Caller) -> tuple[Organization, int]:
    org = await policy.load_org(db_session, org_id)
    acting = await policy.require_invite_manager(request, db_session, org, current_user)
    return org, acting


async def _sending_context(request: Request, db_session: AsyncSession, org_id: int, current_user: Caller) -> tuple[Organization, User]:
    """Checks before anything is mailed: the demo guard, the manager right,
    a real member as the sender, and the free-tier account-age gate."""
    from src.services.demo.guards import require_not_demo_org
    from src.services.security.account_age import enforce_free_tier_age_gate

    org, acting = await _context(request, db_session, org_id, current_user)
    await require_not_demo_org(org.id, db_session)
    sender = await db_session.get(User, acting) if acting else None
    if sender is None:
        raise HTTPException(status_code=403, detail="Invitations must come from a member")
    await enforce_free_tier_age_gate(org.id, acting, db_session, action="invite members")
    return org, sender


async def _load(db_session: AsyncSession, org: Organization, invitation_uuid: str) -> OrgInvitation:
    """An invitation of this org (another org's uuid is a plain 404)."""
    inv = (await db_session.execute(
        select(OrgInvitation).where(
            OrgInvitation.invitation_uuid == invitation_uuid,
            OrgInvitation.org_id == org.id,
        )
    )).scalars().first()
    if inv is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    return inv


async def _lock_org(db_session: AsyncSession, org_id: int) -> None:
    """Serialise capacity checks per org until the caller commits (SELECT ...
    FOR UPDATE on Postgres; SQLite ignores it and serialises writes anyway),
    so two sends can't both pass the plan check and overshoot it."""
    await db_session.execute(select(Organization.id).where(Organization.id == org_id).with_for_update())


async def _expire_stale(db_session: AsyncSession, org_id: int, *, commit: bool = True) -> None:
    """Pending invitations past their expiry become expired (``commit``
    False: staged in the caller's transaction, under its org lock)."""
    now = utcnow()
    await db_session.execute(
        update(OrgInvitation)
        .where(
            OrgInvitation.org_id == org_id,
            OrgInvitation.status == InvitationStatus.PENDING.value,
            OrgInvitation.expires_at <= now,
        )
        .values(status=InvitationStatus.EXPIRED.value, updated_at=now)
        .execution_options(synchronize_session="fetch")
    )
    if commit:
        await db_session.commit()


async def _signup_url(request: Request, db_session: AsyncSession, org: Organization, token: str) -> str:
    from src.services.email.utils import get_org_signup_base_url

    base = await get_org_signup_base_url(org.slug, request, db_session=db_session, org_id=org.id)
    return f"{base}/signup?invite={token}"


async def _send_email(
    request: Request,
    db_session: AsyncSession,
    org: Organization,
    sender: User,
    inv: OrgInvitation,
    token: str,
    role: Optional[Role],
) -> bool:
    """The branded invitation email with the personal link. Never raises."""
    from src.services.email.branding import resolve_org_email_branding
    from src.services.security.profile_validation import sanitize_display_name
    from src.services.users.emails import send_invitation_email

    try:
        url = await _signup_url(request, db_session, org, token)
        org_config = (await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        )).scalars().first()
        branding = resolve_org_email_branding(org, org_config, request)
        result = send_invitation_email(
            email=inv.email,
            org_name=sanitize_display_name(org.name, fallback="A LearnHouse organization"),
            inviter_username=sanitize_display_name(sender.username),
            signup_url=url,
            role_name=role_label(role, branding.lang),
            message=inv.message,
            expires_on=human_date(policy.aware(inv.expires_at), branding.lang),
            **branding.as_kwargs(),
        )
        return result is not None
    except Exception:
        logger.exception("Failed to send the invitation email for %s", inv.invitation_uuid)
        return False


# Built-in roles by id (always seeded as 1-4, like ADMIN_ROLE_ID and
# USER_ROLE_ID): their names in emails come from the translations.
_BUILT_IN_ROLE_KEYS = {1: "role.admin", 2: "role.maintainer", 3: "role.instructor", 4: "role.user"}


def role_label(role: Optional[Role], lang: str) -> Optional[str]:
    """A role as the reader's app names it: a built-in role translated
    ("Learner" for the stored "User"), a custom role by its own name."""
    if role is None:
        return None
    key = _BUILT_IN_ROLE_KEYS.get(role.id)
    if key is None:
        return role.name
    from src.services.email.translations import t

    return t(lang, key)


def _record_send(inv: OrgInvitation, sent: bool) -> None:
    now = utcnow()
    inv.email_sent = sent
    inv.send_count = (inv.send_count or 0) + 1
    inv.last_sent_at = now
    inv.updated_at = now


async def _names(db_session: AsyncSession, invitations: list[OrgInvitation]) -> dict:
    """Roles, groups, courses and people the listed invitations point at."""
    role_ids = {i.role_id for i in invitations if i.role_id}
    group_ids = {int(g) for i in invitations for g in (i.usergroup_ids or []) if str(g).isdigit()}
    course_uuids = {str(c) for i in invitations for c in (i.course_uuids or [])}
    user_ids = {u for i in invitations for u in (i.invited_by_user_id, i.accepted_user_id) if u}
    roles = groups = courses = users = {}
    if role_ids:
        roles = {r.id: r for r in (await db_session.execute(select(Role).where(Role.id.in_(role_ids)))).scalars().all()}  # type: ignore[attr-defined]
    if group_ids:
        groups = {g.id: g for g in (await db_session.execute(select(UserGroup).where(UserGroup.id.in_(group_ids)))).scalars().all()}  # type: ignore[attr-defined]
    if course_uuids:
        courses = {c.course_uuid: c for c in (await db_session.execute(select(Course).where(Course.course_uuid.in_(course_uuids)))).scalars().all()}  # type: ignore[attr-defined]
    if user_ids:
        users = {u.id: u for u in (await db_session.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()}  # type: ignore[attr-defined]
    return {"roles": roles, "groups": groups, "courses": courses, "users": users}


def _person(user: Optional[User]) -> Optional[dict]:
    if user is None:
        return None
    name = " ".join(p for p in (user.first_name, user.last_name) if p).strip()
    return {"id": user.id, "user_uuid": user.user_uuid, "username": user.username, "name": name or user.username, "avatar_image": user.avatar_image}


def _role_ref(role: Optional[Role]) -> Optional[dict]:
    if role is None:
        return None
    return {"id": role.id, "role_uuid": role.role_uuid, "name": role.name}


def serialize(inv: OrgInvitation, names: dict) -> dict:
    role = names["roles"].get(inv.role_id) if inv.role_id else None
    return {
        "invitation_uuid": inv.invitation_uuid,
        "email": inv.email,
        "status": policy.effective_status(inv),
        "role": _role_ref(role),
        "usergroups": [
            {"id": g.id, "usergroup_uuid": g.usergroup_uuid, "name": g.name}
            for g in (names["groups"].get(int(i)) for i in (inv.usergroup_ids or []) if str(i).isdigit())
            if g is not None and g.org_id == inv.org_id
        ],
        "courses": [
            {"course_uuid": c.course_uuid, "name": c.name}
            for c in (names["courses"].get(str(u)) for u in (inv.course_uuids or []))
            if c is not None and c.org_id == inv.org_id
        ],
        "message": inv.message,
        "invited_by": _person(names["users"].get(inv.invited_by_user_id)),
        "accepted_by": _person(names["users"].get(inv.accepted_user_id)),
        "created_at": iso(inv.created_at),
        "updated_at": iso(inv.updated_at),
        "expires_at": iso(inv.expires_at),
        "accepted_at": iso(inv.accepted_at),
        "last_sent_at": iso(inv.last_sent_at),
        "email_sent": bool(inv.email_sent),
        "send_count": inv.send_count or 0,
        "legacy": False,
    }


async def _serialize_one(db_session: AsyncSession, inv: OrgInvitation) -> dict:
    return serialize(inv, await _names(db_session, [inv]))


async def _members_by_email(db_session: AsyncSession, org_id: int, emails: list[str]) -> dict[str, UserOrganization]:
    if not emails:
        return {}
    rows = (await db_session.execute(
        select(func.lower(User.email), UserOrganization)
        .join(UserOrganization, UserOrganization.user_id == User.id)  # type: ignore[arg-type]
        .where(UserOrganization.org_id == org_id, func.lower(User.email).in_(emails))
    )).all()
    return {email: membership for email, membership in rows}


async def _pending_by_email(db_session: AsyncSession, org_id: int, emails: list[str]) -> dict[str, OrgInvitation]:
    if not emails:
        return {}
    rows = (await db_session.execute(
        select(OrgInvitation).where(
            OrgInvitation.org_id == org_id,
            OrgInvitation.email.in_(emails),  # type: ignore[attr-defined]
            OrgInvitation.status == InvitationStatus.PENDING.value,
            OrgInvitation.expires_at > utcnow(),
        )
    )).scalars().all()
    return {inv.email: inv for inv in rows}


async def _seat_holders(db_session: AsyncSession, role_ids: set[int]) -> set[int]:
    """Which of these role ids open the dashboard (count as admin seats)."""
    if not role_ids:
        return set()
    roles = (await db_session.execute(select(Role).where(Role.id.in_(role_ids)))).scalars().all()  # type: ignore[attr-defined]
    return {r.id for r in roles if policy.occupies_seat(r)}


async def _plan_demand(
    db_session: AsyncSession,
    role: Role,
    new_emails: list[str],
    pending: dict[str, OrgInvitation],
    members_to_update: list[UserOrganization],
) -> tuple[int, int]:
    """(new members, new admin seats) this send would add on top of what is
    already used or pending."""
    new_members = sum(1 for e in new_emails if e not in pending)
    if not policy.occupies_seat(role):
        return new_members, 0
    seat_roles = await _seat_holders(
        db_session, {i.role_id for i in pending.values() if i.role_id} | {m.role_id for m in members_to_update if m.role_id}
    )
    new_seats = sum(1 for e in new_emails if e not in pending or pending[e].role_id not in seat_roles)
    new_seats += sum(1 for m in members_to_update if m.role_id not in seat_roles)
    return new_members, new_seats


def _batch_cap(count: int) -> None:
    from src.services.security.rate_limiting import INVITE_MAX_BATCH_SIZE

    if count > INVITE_MAX_BATCH_SIZE:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVITE_BATCH_TOO_LARGE",
                "message": f"You can invite at most {INVITE_MAX_BATCH_SIZE} people at a time.",
                "max_batch_size": INVITE_MAX_BATCH_SIZE,
            },
        )


# ---------------------------------------------------------------------------
# Options and preview
# ---------------------------------------------------------------------------


async def invitation_options(request: Request, db_session: AsyncSession, org_id: int, current_user: Caller) -> dict:
    """What the invite dialog offers this caller: the org's roles (which ones
    they may grant, which take an admin seat, which an invite code may carry),
    plan capacity and the expiry bounds."""
    org, _acting = await _context(request, db_session, org_id, current_user)
    roles = (await db_session.execute(
        select(Role).where(or_(Role.org_id.is_(None), Role.org_id == org.id)).order_by(Role.id)  # type: ignore[union-attr]
    )).scalars().all()
    unrestricted, caller_role = await policy.caller_grant_ceiling(db_session, org, current_user)
    user_role = await policy.builtin_user_role(db_session)
    out = []
    for role in roles:
        refusal = policy.grant_refusal(role, unrestricted, caller_role, current_user)
        out.append({
            "id": role.id,
            "role_uuid": role.role_uuid,
            "name": role.name,
            "description": role.description,
            "is_global": role.org_id is None,
            "grantable": refusal is None,
            "refusal": refusal,
            "occupies_seat": policy.occupies_seat(role),
            "code_allowed": policy.code_role_allowed(role, user_role) and refusal is None,
        })
    return {
        "roles": out,
        "default_role_id": policy.USER_ROLE_ID,
        "capacity": await policy.capacity(db_session, org.id),
        "expiry": {"default_days": DEFAULT_EXPIRY_DAYS, "max_days": MAX_EXPIRY_DAYS},
        "max_batch_size": _max_batch(),
    }


def _max_batch() -> int:
    from src.services.security.rate_limiting import INVITE_MAX_BATCH_SIZE

    return INVITE_MAX_BATCH_SIZE


async def preview_invitations(request: Request, db_session: AsyncSession, org_id: int, body: InvitationPreview, current_user: Caller) -> dict:
    """Who in this list is new, already invited or already a member, and
    whether the plan has room. Membership in this org is shown to the org's
    invitation managers only; whether an address has an account elsewhere is
    never revealed."""
    org, _acting = await _context(request, db_session, org_id, current_user)
    valid, invalid = policy.parse_emails(body.emails)
    role = await policy.resolve_role(db_session, org, body.role_id, body.role_uuid)
    members = await _members_by_email(db_session, org.id, valid)
    pending = await _pending_by_email(db_session, org.id, valid)
    rows = []
    for email in valid:
        status = "member" if email in members else "pending" if email in pending else "new"
        rows.append({"email": email, "status": status})
    rows.extend({"email": e, "status": "invalid"} for e in invalid)
    new_emails = [e for e in valid if e not in members]
    to_update = [members[e] for e in valid if e in members] if body.update_existing_members else []
    new_members, new_seats = await _plan_demand(db_session, role, new_emails, pending, to_update)
    cap = await policy.capacity(db_session, org.id)
    counts = {k: sum(1 for r in rows if r["status"] == k) for k in ("new", "pending", "member", "invalid")}
    return {
        "emails": rows,
        "counts": counts,
        "capacity": cap,
        "occupies_seat": policy.occupies_seat(role),
        "blocked": policy.capacity_refusal(cap, new_members, new_seats),
    }


# ---------------------------------------------------------------------------
# Send
# ---------------------------------------------------------------------------


async def _update_member(
    request: Request,
    db_session: AsyncSession,
    org: Organization,
    membership: UserOrganization,
    role: Role,
    groups: list[UserGroup],
    courses: list[Course],
    current_user: Caller,
    sender: User,
) -> dict:
    """Apply the invitation's settings to someone who already belongs. The
    role goes through ``update_user_role`` (own role, staff, last admin and
    seat rules); groups and courses are added."""
    from src.services.orgs.invitations.apply import _after_grants, _grant_courses, _grant_groups
    from src.services.orgs.users import update_user_role

    member = await db_session.get(User, membership.user_id)
    reason = None
    if membership.role_id != role.id:
        try:
            await update_user_role(request, org.id, membership.user_id, role.role_uuid, db_session, current_user)
        except HTTPException as exc:
            detail = exc.detail
            reason = detail.get("message") if isinstance(detail, dict) else str(detail)
    added_groups = await _grant_groups(db_session, org.id, membership.user_id, [g.id for g in groups], "manual", sender.id)
    added_courses = await _grant_courses(db_session, org.id, membership.user_id, [c.course_uuid for c in courses])
    await db_session.commit()
    if member is not None:
        await _after_grants(request, db_session, org, member, added_groups, added_courses, "invitation")
    return {"status": "member_update_failed" if reason else "member_updated", "reason": reason}


async def create_invitations(request: Request, db_session: AsyncSession, org_id: int, body: InvitationCreate, current_user: Caller) -> dict:
    from src.services.analytics import events as analytics_events
    from src.services.analytics.analytics import track
    from src.services.security.rate_limiting import enforce_invite_rate_limit
    from src.services.webhooks.dispatch import dispatch_webhooks

    org, sender = await _sending_context(request, db_session, org_id, current_user)
    valid, invalid = policy.parse_emails(body.emails)
    if not valid and not invalid:
        raise HTTPException(status_code=400, detail={"code": "INVITE_NO_EMAILS", "message": "Add at least one email address."})
    _batch_cap(len(valid))

    role = await policy.resolve_role(db_session, org, body.role_id, body.role_uuid)
    await policy.assert_can_grant_role(db_session, org, current_user, role)
    groups, courses = await policy.validate_targets(db_session, org, body.usergroup_ids, body.course_uuids)
    message = policy.clean_message(body.message)
    expires_at = policy.expiry_from_days(body.expires_in_days)

    # Under the org lock: who is pending is read after it, so two sends to the
    # same address can't both create a pending invitation (one per address).
    await _lock_org(db_session, org.id)
    await _expire_stale(db_session, org.id, commit=False)
    members = await _members_by_email(db_session, org.id, valid)
    pending = await _pending_by_email(db_session, org.id, valid)
    new_emails = [e for e in valid if e not in members]
    to_update = [members[e] for e in valid if e in members] if body.update_existing_members else []

    new_members, new_seats = await _plan_demand(db_session, role, new_emails, pending, to_update)
    await policy.check_capacity(db_session, org.id, new_members, new_seats)
    if new_emails:
        enforce_invite_rate_limit(org.id, sender.id, len(new_emails))

    # Rows first (one commit), then the emails, then their outcome.
    now = utcnow()
    staged: list[tuple[OrgInvitation, str, str]] = []
    for email in new_emails:
        token, digest = policy.mint_token()
        inv = pending.get(email)
        outcome = "resent" if inv is not None else "sent"
        if inv is None:
            inv = OrgInvitation(
                invitation_uuid=policy.new_invitation_uuid(),
                org_id=org.id,
                email=email,
                created_at=now,
                status=InvitationStatus.PENDING.value,
            )
        inv.role_id = role.id
        inv.usergroup_ids = [g.id for g in groups]
        inv.course_uuids = [c.course_uuid for c in courses]
        inv.message = message
        inv.invited_by_user_id = sender.id
        inv.token_hash = digest
        inv.token_delivery = "email"
        # Re-invited (maybe with another role): a link copied earlier stops
        # working, so it can't carry the new settings to whoever holds it.
        inv.copy_token_hash = None
        inv.expires_at = expires_at
        inv.updated_at = now
        db_session.add(inv)
        staged.append((inv, token, outcome))
    await db_session.commit()
    _drop_legacy(org, [inv.email for inv, _t, _o in staged])

    results: list[dict] = []
    for inv, token, outcome in staged:
        sent = await _send_email(request, db_session, org, sender, inv, token, role)
        _record_send(inv, sent)
        db_session.add(inv)
        results.append({"email": inv.email, "status": outcome if sent else "email_failed", "invitation_uuid": inv.invitation_uuid})
    await db_session.commit()

    for email in valid:
        if email not in members:
            continue
        if body.update_existing_members:
            row = await _update_member(request, db_session, org, members[email], role, groups, courses, current_user, sender)
            results.append({"email": email, **row})
        else:
            results.append({"email": email, "status": "already_member"})
    results.extend({"email": e, "status": "invalid_email"} for e in invalid)

    summary = {key: sum(1 for r in results if r["status"] == key) for key in (
        "sent", "resent", "email_failed", "already_member", "member_updated", "member_update_failed", "invalid_email",
    )}
    summary["total"] = len(results)
    invited = [r["email"] for r in results if r["status"] in ("sent", "resent", "email_failed")]
    if invited:
        await track(
            event_name=analytics_events.USER_INVITED,
            org_id=org.id,
            user_id=sender.id,
            properties={"invite_method": "email", "count": len(invited)},
        )
        audit_event(
            request, action="members.invited", org_id=org.id, actor=current_user,
            target_type="organization", target_id=org.id,
            details={
                "count": len(invited),
                "emails": invited[:50],
                "role": role.name,
                "usergroup_ids": [g.id for g in groups],
                "course_uuids": [c.course_uuid for c in courses],
                "expires_in_days": body.expires_in_days,
                "email_failures": summary["email_failed"],
                "updated_members": summary["member_updated"],
            },
        )
        await dispatch_webhooks(
            event_name="user_invited_to_org",
            org_id=org.id,
            data={
                "org_id": org.id,
                "emails": invited,
                "invited_by": sender.user_uuid,
                "role_uuid": role.role_uuid,
                "usergroup_ids": [g.id for g in groups],
                "course_uuids": [c.course_uuid for c in courses],
            },
        )
    return {"detail": "Users invited", "results": results, "summary": summary}


# ---------------------------------------------------------------------------
# List and manage
# ---------------------------------------------------------------------------


async def list_invitations(
    request: Request,
    db_session: AsyncSession,
    org_id: int,
    current_user: Caller,
    status: Optional[str] = None,
    query: Optional[str] = None,
    page: int = 1,
    limit: int = 50,
) -> dict:
    org, _acting = await _context(request, db_session, org_id, current_user)
    if status and status not in STATUSES:
        raise HTTPException(status_code=400, detail="Unknown invitation status")
    await _expire_stale(db_session, org.id)
    limit = max(1, min(int(limit), PAGE_LIMIT))
    page = max(1, int(page))

    counts = dict((await db_session.execute(
        select(OrgInvitation.status, func.count()).where(OrgInvitation.org_id == org.id).group_by(OrgInvitation.status)
    )).all())
    filters = [OrgInvitation.org_id == org.id]
    if status:
        filters.append(OrgInvitation.status == status)
    q = (query or "").strip().lower()
    if q:
        from src.services.search.normalization import LIKE_ESCAPE_CHAR, build_like_pattern

        filters.append(OrgInvitation.email.like(build_like_pattern(q), escape=LIKE_ESCAPE_CHAR))  # type: ignore[attr-defined]
    total = (await db_session.execute(select(func.count()).select_from(OrgInvitation).where(*filters))).scalar_one()
    rows = list((await db_session.execute(
        select(OrgInvitation).where(*filters)
        .order_by(OrgInvitation.created_at.desc(), OrgInvitation.id.desc())  # type: ignore[union-attr]
        .offset((page - 1) * limit).limit(limit)
    )).scalars().all())
    names = await _names(db_session, rows)

    legacy = []
    if status in (None, InvitationStatus.PENDING.value):
        legacy = [row for row in _legacy_pending(org) if not q or q in row["email"]]
    return {
        "items": [serialize(inv, names) for inv in rows],
        "legacy": legacy,
        "total": total,
        "page": page,
        "limit": limit,
        "counts": {s: int(counts.get(s, 0)) for s in STATUSES},
    }


def legacy_records(org: Organization) -> list[dict]:
    """Invitation records sent before they moved to the database (Redis,
    until they expire), as stored. Empty when Redis is unavailable."""
    import json

    from src.core.redis import get_redis_client

    r = get_redis_client()
    if r is None:
        return []
    out = []
    try:
        for key in r.scan_iter(match=f"invited_user:*:org:{org.org_uuid}", count=200):
            raw = r.get(key)
            if raw:
                out.append(json.loads(raw))
    except Exception:
        logger.warning("Could not read legacy invitations for org %s", org.id, exc_info=True)
        return []
    return out


def _legacy_pending(org: Organization) -> list[dict]:
    """The pending ones, shown so they can still be withdrawn."""
    out = [
        {
            "email": str(record.get("email") or ""),
            "status": "pending",
            "created_at": record.get("created_at"),
            "email_sent": bool(record.get("email_sent")),
            "legacy": True,
        }
        for record in legacy_records(org)
        if record.get("pending", True)
    ]
    out.sort(key=lambda r: r["created_at"] or "", reverse=True)
    return out


def _drop_legacy(org: Organization, emails: list[str]) -> None:
    """A database invitation replaces a Redis one for the same address."""
    from src.core.redis import get_redis_client

    r = get_redis_client()
    if r is None or not emails:
        return
    try:
        r.delete(*[f"invited_user:{e}:org:{org.org_uuid}" for e in emails])
    except Exception:
        logger.warning("Could not drop legacy invitations for org %s", org.id, exc_info=True)


def _require_status(inv: OrgInvitation, allowed: tuple[str, ...], message: str) -> None:
    if policy.effective_status(inv) not in allowed:
        raise HTTPException(status_code=409, detail={"code": "INVITATION_NOT_EDITABLE", "message": message})


async def _transition(db_session: AsyncSession, inv: OrgInvitation, from_statuses: tuple[str, ...], message: str, **values) -> None:
    """Change ``inv`` only while it is still in one of ``from_statuses``, in
    one conditional UPDATE (staged; the caller commits): an invitation
    accepted meanwhile is never turned back into a pending, revoked or
    declined one. 409 when it moved on."""
    result = await db_session.execute(
        update(OrgInvitation)
        .where(OrgInvitation.id == inv.id, OrgInvitation.status.in_(from_statuses))  # type: ignore[attr-defined]
        .values(**values)
        .execution_options(synchronize_session="fetch")
    )
    if result.rowcount != 1:
        await db_session.refresh(inv)
        raise HTTPException(status_code=409, detail={"code": "INVITATION_NOT_EDITABLE", "message": message})


async def update_invitation(
    request: Request, db_session: AsyncSession, org_id: int, invitation_uuid: str, body: InvitationUpdate, current_user: Caller
) -> dict:
    """Change a pending invitation's role, groups, courses, note or expiry."""
    org, _acting = await _context(request, db_session, org_id, current_user)
    inv = await _load(db_session, org, invitation_uuid)
    _require_status(inv, (InvitationStatus.PENDING.value,), "Only pending invitations can be changed.")

    changes: dict = {}
    old_role = await db_session.get(Role, inv.role_id) if inv.role_id else None
    if body.role_id is not None or body.role_uuid:
        role = await policy.resolve_role(db_session, org, body.role_id, body.role_uuid)
        await policy.assert_can_grant_role(db_session, org, current_user, role)
        if role.id != inv.role_id:
            if policy.occupies_seat(role) and not policy.occupies_seat(old_role):
                await _lock_org(db_session, org.id)
                await policy.check_capacity(db_session, org.id, 0, 1)
            changes["role"] = {"from": old_role.name if old_role else None, "to": role.name}
            inv.role_id = role.id
            # A link copied for the old settings stops working.
            inv.copy_token_hash = None
    elif old_role is not None:
        # Changing other settings still needs the right to grant the role.
        await policy.assert_can_grant_role(db_session, org, current_user, old_role)
    if body.usergroup_ids is not None or body.course_uuids is not None:
        groups, courses = await policy.validate_targets(
            db_session, org,
            inv.usergroup_ids if body.usergroup_ids is None else body.usergroup_ids,
            inv.course_uuids if body.course_uuids is None else body.course_uuids,
        )
        new_groups, new_courses = [g.id for g in groups], [c.course_uuid for c in courses]
        if new_groups != list(inv.usergroup_ids or []):
            changes["usergroup_ids"] = {"from": list(inv.usergroup_ids or []), "to": new_groups}
            inv.usergroup_ids = new_groups
            inv.copy_token_hash = None
        if new_courses != list(inv.course_uuids or []):
            changes["course_uuids"] = {"from": list(inv.course_uuids or []), "to": new_courses}
            inv.course_uuids = new_courses
            inv.copy_token_hash = None
    if body.message is not None:
        message = policy.clean_message(body.message)
        if message != inv.message:
            changes["message"] = {"from": bool(inv.message), "to": bool(message)}
            inv.message = message
    if body.expires_in_days is not None:
        inv.expires_at = policy.expiry_from_days(body.expires_in_days)
        changes["expires_at"] = {"to": iso(inv.expires_at)}
    inv.updated_at = utcnow()
    db_session.add(inv)
    await db_session.commit()
    if changes:
        audit_event(
            request, action="members.invitation.updated", org_id=org.id, actor=current_user,
            target_type="invitation", target_id=inv.invitation_uuid, target_name=inv.email,
            changes=changes,
        )
    return await _serialize_one(db_session, inv)


async def _rotate_and_send(
    request: Request,
    db_session: AsyncSession,
    org: Organization,
    sender: User,
    inv: OrgInvitation,
    current_user: Caller,
    expires_in_days: Optional[int],
) -> bool:
    """New token (the old link stops working), fresh expiry, email it."""
    role = await db_session.get(Role, inv.role_id) if inv.role_id else None
    if role is not None:
        await policy.assert_can_grant_role(db_session, org, current_user, role)
    if policy.effective_status(inv) == InvitationStatus.EXPIRED.value:
        # Back to pending: it counts against the plan again, and only while
        # no newer invitation is pending for the address (one per address).
        await _lock_org(db_session, org.id)
        await _expire_stale(db_session, org.id, commit=False)
        newer = (await db_session.execute(
            select(OrgInvitation.id).where(
                OrgInvitation.org_id == org.id,
                OrgInvitation.email == inv.email,
                OrgInvitation.status == InvitationStatus.PENDING.value,
                OrgInvitation.id != inv.id,
            )
        )).first()
        if newer is not None:
            raise HTTPException(status_code=409, detail={
                "code": "INVITATION_SUPERSEDED",
                "message": "A newer invitation is pending for this address. Send that one again instead.",
            })
        await policy.check_capacity(db_session, org.id, 1, 1 if policy.occupies_seat(role) else 0)
    token, digest = policy.mint_token()
    await _transition(
        db_session, inv, (InvitationStatus.PENDING.value, InvitationStatus.EXPIRED.value),
        "Only pending or expired invitations can be sent again.",
        token_hash=digest,
        token_delivery="email",
        status=InvitationStatus.PENDING.value,
        expires_at=policy.expiry_from_days(expires_in_days),
        updated_at=utcnow(),
    )
    await db_session.commit()
    sent = await _send_email(request, db_session, org, sender, inv, token, role)
    _record_send(inv, sent)
    db_session.add(inv)
    await db_session.commit()
    audit_event(
        request, action="members.invitation.resent", org_id=org.id, actor=current_user,
        target_type="invitation", target_id=inv.invitation_uuid, target_name=inv.email,
        details={"email_sent": sent},
    )
    return sent


async def resend_invitation(
    request: Request, db_session: AsyncSession, org_id: int, invitation_uuid: str, body: InvitationResend, current_user: Caller
) -> dict:
    from src.services.security.rate_limiting import enforce_invite_rate_limit

    org, sender = await _sending_context(request, db_session, org_id, current_user)
    inv = await _load(db_session, org, invitation_uuid)
    _require_status(
        inv, (InvitationStatus.PENDING.value, InvitationStatus.EXPIRED.value),
        "Only pending or expired invitations can be sent again.",
    )
    enforce_invite_rate_limit(org.id, sender.id, 1)
    sent = await _rotate_and_send(request, db_session, org, sender, inv, current_user, body.expires_in_days)
    return {**(await _serialize_one(db_session, inv)), "resent": sent}


async def invitation_link(request: Request, db_session: AsyncSession, org_id: int, invitation_uuid: str, current_user: Caller) -> dict:
    """A fresh personal link to share by hand. The token is only ever stored
    hashed, so this mints a new one (replacing the previously copied link),
    kept apart from the emailed link, which keeps working. A copied link
    doesn't prove the invitee's inbox, so they verify their email before the
    invitation applies."""
    org, _sender = await _sending_context(request, db_session, org_id, current_user)
    inv = await _load(db_session, org, invitation_uuid)
    _require_status(inv, (InvitationStatus.PENDING.value,), "Only pending invitations have a link.")
    role = await db_session.get(Role, inv.role_id) if inv.role_id else None
    if role is not None:
        await policy.assert_can_grant_role(db_session, org, current_user, role)
    token, digest = policy.mint_token()
    # Handed to the admin, not mailed to the address: following it proves
    # nothing about the inbox, so joining waits for the email to be verified.
    inv.copy_token_hash = digest
    inv.updated_at = utcnow()
    db_session.add(inv)
    await db_session.commit()
    audit_event(
        request, action="members.invitation.link_copied", org_id=org.id, actor=current_user,
        target_type="invitation", target_id=inv.invitation_uuid, target_name=inv.email,
    )
    return {"url": await _signup_url(request, db_session, org, token), "expires_at": iso(inv.expires_at)}


async def _revoke(request: Request, db_session: AsyncSession, org: Organization, inv: OrgInvitation, current_user: Caller) -> None:
    # Withdrawing an invitation takes the same right as granting its role: a
    # Maintainer can't revoke an Admin's or Maintainer's invitation.
    role = await db_session.get(Role, inv.role_id) if inv.role_id else None
    if role is not None:
        await policy.assert_can_grant_role(db_session, org, current_user, role)
    await _transition(
        db_session, inv, (InvitationStatus.PENDING.value, InvitationStatus.EXPIRED.value),
        "Only pending or expired invitations can be revoked.",
        status=InvitationStatus.REVOKED.value, updated_at=utcnow(),
    )
    await db_session.commit()
    audit_event(
        request, action="members.invitation.revoked", org_id=org.id, actor=current_user,
        target_type="invitation", target_id=inv.invitation_uuid, target_name=inv.email,
    )


async def revoke_invitation(request: Request, db_session: AsyncSession, org_id: int, invitation_uuid: str, current_user: Caller) -> dict:
    org, _acting = await _context(request, db_session, org_id, current_user)
    inv = await _load(db_session, org, invitation_uuid)
    _require_status(
        inv, (InvitationStatus.PENDING.value, InvitationStatus.EXPIRED.value),
        "Only pending or expired invitations can be revoked.",
    )
    await _revoke(request, db_session, org, inv, current_user)
    return await _serialize_one(db_session, inv)


async def bulk_invitations(request: Request, db_session: AsyncSession, org_id: int, body: InvitationBulk, current_user: Caller) -> dict:
    """Resend or revoke several invitations; each one reports its outcome."""
    from src.services.security.rate_limiting import enforce_invite_rate_limit

    if body.action == "resend":
        org, sender = await _sending_context(request, db_session, org_id, current_user)
    else:
        org, _acting = await _context(request, db_session, org_id, current_user)
        sender = None
    uuids = list(dict.fromkeys(body.invitation_uuids))
    rows = {
        inv.invitation_uuid: inv
        for inv in (await db_session.execute(
            select(OrgInvitation).where(OrgInvitation.org_id == org.id, OrgInvitation.invitation_uuid.in_(uuids))  # type: ignore[attr-defined]
        )).scalars().all()
    }
    open_states = (InvitationStatus.PENDING.value, InvitationStatus.EXPIRED.value)
    actionable = [rows[u] for u in uuids if u in rows and policy.effective_status(rows[u]) in open_states]
    if body.action == "resend" and actionable:
        enforce_invite_rate_limit(org.id, sender.id, len(actionable))

    results = []
    for uuid_ in uuids:
        inv = rows.get(uuid_)
        if inv is None:
            results.append({"invitation_uuid": uuid_, "status": "not_found"})
            continue
        if inv not in actionable:
            results.append({"invitation_uuid": uuid_, "status": "skipped"})
            continue
        try:
            if body.action == "resend":
                sent = await _rotate_and_send(request, db_session, org, sender, inv, current_user, None)
                results.append({"invitation_uuid": uuid_, "status": "resent" if sent else "email_failed"})
            else:
                await _revoke(request, db_session, org, inv, current_user)
                results.append({"invitation_uuid": uuid_, "status": "revoked"})
        except HTTPException as exc:
            detail = exc.detail
            results.append({
                "invitation_uuid": uuid_,
                "status": "failed",
                "reason": detail.get("message") if isinstance(detail, dict) else str(detail),
            })
    return {"action": body.action, "results": results}


async def revoke_by_email(request: Request, db_session: AsyncSession, org: Organization, email: str, current_user: Caller) -> bool:
    """Withdraw the pending invitation for an address (legacy endpoint and
    Atlas). True when there was one."""
    email = policy.normalize_email(email)
    rows = (await db_session.execute(
        select(OrgInvitation).where(
            OrgInvitation.org_id == org.id,
            OrgInvitation.email == email,
            OrgInvitation.status == InvitationStatus.PENDING.value,
        )
    )).scalars().all()
    for inv in rows:
        await _revoke(request, db_session, org, inv, current_user)
    return bool(rows)

