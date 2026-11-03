"""Course admin tools: a course's completion certificate and its contributors.

Certificates: a course awards one when a certification exists for it; the
dashboard toggle creates and deletes that row, and these tools do the same.
Learners get theirs automatically (AWARD_RULE). Deleting the certification
would destroy every certificate already issued from it, so the service refuses
while any exist; turning certificates off then means revoking them one by one
first, which this tool does only when asked to and after a person approves.
Taking one learner's certificate back is approved the same way.

Contributors (co-authors): active creators, maintainers and contributors can
edit the course; creators and maintainers also manage the contributor list.
Every add, removal or role change changes who can edit the course, so it
needs a person's approval on MCP. Members are loaded from the connected
organization first and every change is reported per member.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select

from src.db.courses.certifications import (
    CertificateUser,
    CertificationCreate,
    CertificationUpdate,
)
from src.db.courses.courses import Course
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.users import User
from src.security.features_utils.plan_check import check_org_plan
from src.security.rbac import AccessAction, check_resource_access
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, require_approval
from src.services.ai.tools.results import Paging, changed, page_of, untrusted
from src.services.courses.certifications import (
    _check_certification_access,
    create_certification,
    delete_certification,
    get_certifications_by_course,
    revoke_user_certificate,
    update_certification,
)
from src.services.courses.contributors import (
    _require_contributor_manager,
    add_bulk_course_contributors,
    get_course_contributors,
    remove_bulk_course_contributors,
    update_course_contributor,
)

MAX_MEMBERS_PER_CALL = 50

AWARD_RULE = (
    "Issued automatically the moment a learner completes the course's last published "
    "activity, or gets the grade that settles its assignments, provided every "
    "assignment in the course is passed (graded at or above its pass mark; ungraded "
    "ones only need handing in). Learners who finished before certificates were "
    "turned on do not get one retroactively."
)

CertificateType = Literal[
    "completion",
    "achievement",
    "assessment",
    "participation",
    "mastery",
    "professional",
    "continuing",
    "workshop",
    "specialization",
]
CertificatePattern = Literal[
    "royal",
    "tech",
    "nature",
    "geometric",
    "vintage",
    "waves",
    "minimal",
    "professional",
    "academic",
    "modern",
]
ContributorRole = Literal["contributor", "maintainer", "reporter"]
ContributorStatus = Literal["active", "pending", "inactive"]

# Tool field -> key in the certification's config (what the web editor reads).
_CONFIG_KEYS = {
    "name": "certification_name",
    "description": "certification_description",
    "type": "certification_type",
    "pattern": "certificate_pattern",
    "instructor": "certificate_instructor",
}
_ROLE_ORDER = {"creator": 0, "maintainer": 1, "contributor": 2, "reporter": 3}
_EDITING_ROLES = {"creator", "maintainer", "contributor"}

_COURSE_UUID = Field(..., max_length=100, description="The course (course_...).")
_MEMBER = Field(..., max_length=320, description="A member by user_uuid, username or email.")


# ─── helpers ─────────────────────────────────────────────────────────────────


async def _course_ref(ctx: ToolContext, course: Course) -> dict:
    url = await refs.web_url(ctx, "course", course=course.course_uuid)
    return refs.ref("course", course.course_uuid, course.name, url)


async def _settings_url(ctx: ToolContext, course: Course, page: str) -> str | None:
    """The course's dashboard tab (certification, contributors)."""
    editor = await refs.web_url(ctx, "course_editor", course=course.course_uuid)
    if not editor or not editor.endswith("/content"):
        return None
    return editor[: -len("content")] + page


def _name(first: str | None, last: str | None) -> str | None:
    return " ".join(p for p in (first, last) if p) or None


async def _can_manage(ctx: ToolContext, course: Course) -> bool:
    try:
        decision = await check_resource_access(
            ctx.request, ctx.db_session, ctx.user, course.course_uuid,
            AccessAction.UPDATE, raise_on_deny=False,
        )
    except HTTPException:
        return False
    return bool(decision.allowed)


async def _certification(ctx: ToolContext, course: Course):
    found = await get_certifications_by_course(ctx.request, course.course_uuid, ctx.user, ctx.db_session)
    return found[0] if found else None


async def _holders(ctx: ToolContext, certification_id: int) -> list[int]:
    return list(
        (
            await ctx.db_session.execute(
                select(CertificateUser.user_id).where(CertificateUser.certification_id == certification_id)
            )
        ).scalars().all()
    )


async def _issued_count(ctx: ToolContext, certification_id: int) -> int:
    return (
        await ctx.db_session.execute(
            select(func.count(CertificateUser.id)).where(CertificateUser.certification_id == certification_id)
        )
    ).scalar_one()


async def _creator_name(ctx: ToolContext, course: Course) -> str:
    """The course creator's name, as the dashboard prefills the instructor."""
    user = (
        await ctx.db_session.execute(
            select(User)
            .join(ResourceAuthor, ResourceAuthor.user_id == User.id)
            .where(
                ResourceAuthor.resource_uuid == course.course_uuid,
                ResourceAuthor.authorship == ResourceAuthorshipEnum.CREATOR,
            )
        )
    ).scalars().first()
    return (_name(user.first_name, user.last_name) or "") if user else ""


async def _certificate_view(ctx: ToolContext, course: Course, *, with_issued: bool) -> dict:
    try:
        await check_org_plan(course.org_id, "pro", "Certifications", ctx.db_session)
    except HTTPException as e:
        return {"available": False, "reason": str(e.detail)}
    try:
        cert = await _certification(ctx, course)
    except HTTPException as e:
        if e.status_code != 403:
            raise
        return {"visible": False, "reason": str(e.detail)}
    url = await _settings_url(ctx, course, "certification")
    if cert is None:
        off: dict[str, Any] = {"enabled": False, "award_rule": AWARD_RULE}
        if url:
            off["settings_url"] = url
        return off
    config = cert.config or {}
    out: dict[str, Any] = {
        "enabled": True,
        "name": config.get("certification_name") or course.name,
        "description": config.get("certification_description") or course.description or "",
        "type": config.get("certification_type") or "completion",
        "pattern": config.get("certificate_pattern") or "professional",
        "instructor": config.get("certificate_instructor") or None,
        "award_rule": AWARD_RULE,
    }
    if with_issued:
        out["issued_count"] = await _issued_count(ctx, cert.id)
    if url:
        out["settings_url"] = url
    return out


def _contributor_row(row: dict, web: dict[str, str | None]) -> dict:
    user = row.get("user") or {}
    role = str(getattr(row.get("authorship"), "value", row.get("authorship"))).lower()
    status = str(getattr(row.get("authorship_status"), "value", row.get("authorship_status"))).lower()
    out = refs.ref(
        "user",
        user.get("user_uuid"),
        _name(user.get("first_name"), user.get("last_name")) or user.get("username"),
        web.get(user.get("username") or ""),
        username=user.get("username"),
        email=user.get("email"),
    )
    out.update(
        role=role,
        status=status,
        can_edit=role in _EDITING_ROLES and status == "active",
        manages_contributors=role in ("creator", "maintainer") and status == "active",
    )
    return out


# ─── get_course_admin ────────────────────────────────────────────────────────


class GetCourseAdminParams(Paging):
    course_uuid: str = _COURSE_UUID


async def _get_course_admin(ctx: ToolContext, p: GetCourseAdminParams):
    course = await refs.load(ctx, "course", p.course_uuid)
    can_manage = await _can_manage(ctx, course)
    rows = await get_course_contributors(ctx.request, course.course_uuid, ctx.user, ctx.db_session)
    web = {
        (r.get("user") or {}).get("username") or "": await refs.web_url(
            ctx, "user", username=(r.get("user") or {}).get("username")
        )
        for r in rows
    }
    items = sorted(
        (_contributor_row(r, web) for r in rows),
        key=lambda c: (_ROLE_ORDER.get(c["role"], 9), (c.get("username") or "").lower()),
    )
    out = {
        "course": await _course_ref(ctx, course),
        "certificate": await _certificate_view(ctx, course, with_issued=can_manage),
        "contributors": page_of(items, p),
    }
    url = await _settings_url(ctx, course, "contributors")
    if url and can_manage:
        out["contributors_url"] = url
    # Contributor names are written by the members themselves.
    return untrusted(out, "contributors")


# ─── set_course_certificate ──────────────────────────────────────────────────


class SetCourseCertificateParams(BaseModel):
    course_uuid: str = _COURSE_UUID
    enabled: bool | None = Field(
        None,
        description=(
            "true turns the certificate on, false turns it off; omit to keep it as is and "
            "only change settings."
        ),
    )
    name: str | None = Field(None, min_length=1, max_length=100, description="Title printed on the certificate.")
    description: str | None = Field(
        None, min_length=1, max_length=500, description="Text printed under the title."
    )
    type: CertificateType | None = Field(None, description="Kind of certificate, printed on it.")
    pattern: CertificatePattern | None = Field(None, description="Background design.")
    instructor: str | None = Field(
        None, max_length=100, description="Instructor name printed on it; empty string to leave it off."
    )
    revoke_issued: bool = Field(
        False,
        description=(
            "With enabled=false: also revoke every certificate already issued, which turning "
            "off requires when there are any. Needs approval."
        ),
    )
    revoke_from: list[str] | None = Field(
        None,
        max_length=MAX_MEMBERS_PER_CALL,
        description=(
            "Take the certificate back from these learners (user_uuid, username or email). "
            "Needs approval."
        ),
    )


def _settings_of(p: SetCourseCertificateParams) -> dict:
    return {
        key: getattr(p, field).strip() if isinstance(getattr(p, field), str) else getattr(p, field)
        for field, key in _CONFIG_KEYS.items()
        if getattr(p, field) is not None
    }


async def _resolve_holders(ctx: ToolContext, cert, who: list[str]) -> tuple[list[dict], list[tuple[str, Any]]]:
    """Per-member results for members without a certificate, and the
    (asked-as, user) pairs that hold one."""
    results: list[dict] = []
    holders: list[tuple[str, Any]] = []
    held = set(await _holders(ctx, cert.id)) if cert else set()
    seen: set[int] = set()
    for name in who:
        try:
            user = await refs.load_member(ctx, name)
        except HTTPException as e:
            if e.status_code == 403:
                raise  # an email lookup this caller may not make
            results.append({"member": name, "result": "not_a_member"})
            continue
        if user.id in seen:
            continue
        seen.add(user.id)
        if user.id not in held:
            results.append({"member": name, "user_uuid": user.user_uuid, "result": "no_certificate"})
            continue
        holders.append((name, user))
    return results, holders


async def _set_course_certificate(ctx: ToolContext, p: SetCourseCertificateParams):
    course = await refs.load(ctx, "course", p.course_uuid)
    settings = _settings_of(p)
    if p.enabled is None and not settings and not p.revoke_from:
        raise HTTPException(status_code=400, detail="Nothing to change: pass enabled, a setting or revoke_from.")
    if p.enabled is False and (settings or p.revoke_from):
        raise HTTPException(
            status_code=400,
            detail="Turning the certificate off takes no settings or revoke_from; send them separately.",
        )
    if p.revoke_issued and p.enabled is not False:
        raise HTTPException(status_code=400, detail="revoke_issued only applies with enabled=false.")

    # Same gates as the certification routes: the plan, then the caller's
    # rights on this course (the certifications bucket for API tokens).
    await check_org_plan(course.org_id, "pro", "Certifications", ctx.db_session)
    action = AccessAction.DELETE if p.enabled is False else AccessAction.UPDATE
    await _check_certification_access(ctx.request, ctx.db_session, ctx.user, course.course_uuid, action)

    cert = await _certification(ctx, course)
    if cert is None and settings and p.enabled is not True:
        raise HTTPException(
            status_code=400,
            detail="This course has no certificate. Pass enabled=true with the settings to turn it on.",
        )
    course_ref = await _course_ref(ctx, course)

    # ── turn off ──
    if p.enabled is False:
        if cert is None:
            return changed(f"Certificates were already off for '{course.name}'.", course=course_ref)
        issued = await _issued_count(ctx, cert.id)
        if issued and not p.revoke_issued:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"{issued} learner(s) hold this course's certificate. Turning it off would "
                    "revoke them all and break the verification links they shared. Leave it on, "
                    "or pass revoke_issued=true to revoke them (needs approval)."
                ),
            )
        if issued:
            require_approval(
                ctx,
                f"Turning certificates off for '{course.name}' revokes the {issued} certificate(s) "
                "already issued; their verification links stop working and this cannot be undone.",
            )
            for user_id in await _holders(ctx, cert.id):
                await revoke_user_certificate(user_id, course.id, ctx.db_session, reason="certification_disabled")
        await delete_certification(ctx.request, cert.certification_uuid, ctx.user, ctx.db_session)
        tail = f" and revoked {issued} issued certificate(s)" if issued else ""
        return changed(
            f"Turned certificates off for '{course.name}'{tail}.",
            course=course_ref,
            certificate={"enabled": False},
            revoked=issued or None,
        )

    # ── revoke from named learners: approval first, before anything changes ──
    revoke_results: list[dict] = []
    holders: list[tuple[str, Any]] = []
    if p.revoke_from:
        revoke_results, holders = await _resolve_holders(ctx, cert, p.revoke_from)
        if holders:
            names = ", ".join(u.username for _, u in holders[:10])
            more = f" and {len(holders) - 10} more" if len(holders) > 10 else ""
            require_approval(
                ctx,
                f"Takes back the '{course.name}' certificate from {len(holders)} learner(s) "
                f"({names}{more}); their verification links stop working.",
            )

    # ── turn on / configure ──
    parts: list[str] = []
    if cert is None and p.enabled is True:
        config = {
            "certification_name": course.name,
            "certification_description": course.description or "",
            "certification_type": "completion",
            "certificate_pattern": "professional",
            "certificate_instructor": await _creator_name(ctx, course),
        } | settings
        await create_certification(
            ctx.request, CertificationCreate(course_id=course.id, config=config), ctx.user, ctx.db_session
        )
        parts.append("turned certificates on")
    elif settings:
        merged = dict(cert.config or {}) | settings
        if merged != (cert.config or {}):
            await update_certification(
                ctx.request, cert.certification_uuid, CertificationUpdate(config=merged), ctx.user, ctx.db_session
            )
            parts.append("updated " + ", ".join(f for f in _CONFIG_KEYS if getattr(p, f) is not None))
    elif p.enabled is True:
        parts.append("certificates were already on")

    for name, user in holders:
        done = await revoke_user_certificate(user.id, course.id, ctx.db_session, reason="revoked_by_staff")
        revoke_results.append(
            {"member": name, "user_uuid": user.user_uuid, "result": "revoked" if done else "no_certificate"}
        )
    revoked = sum(1 for r in revoke_results if r["result"] == "revoked")
    if p.revoke_from:
        parts.append(f"revoked {revoked} certificate(s)")
        if revoked:
            parts.append(
                "a revoked learner can earn it again by completing the course or being regraded"
            )

    return changed(
        f"Certificate for '{course.name}': " + ("; ".join(parts) or "no change") + ".",
        course=course_ref,
        certificate=await _certificate_view(ctx, course, with_issued=True),
        revoke_results=revoke_results or None,
    )


def _summarize_certificate(p: SetCourseCertificateParams) -> str:
    bits = []
    if p.enabled is True:
        bits.append("turn certificates on")
    elif p.enabled is False:
        bits.append(
            "turn certificates off and revoke those already issued" if p.revoke_issued else "turn certificates off"
        )
    fields = [f for f in _CONFIG_KEYS if getattr(p, f) is not None]
    if fields:
        bits.append("set " + ", ".join(fields))
    if p.revoke_from:
        bits.append(f"take the certificate back from {len(p.revoke_from)} learner(s)")
    return f"Course {p.course_uuid}: " + ("; ".join(bits) or "no change")


# ─── manage_course_contributors ──────────────────────────────────────────────


class ContributorChange(BaseModel):
    member: str = _MEMBER
    role: ContributorRole | None = Field(None, description="New role.")
    status: ContributorStatus | None = Field(None, description="New status.")


class ManageCourseContributorsParams(BaseModel):
    course_uuid: str = _COURSE_UUID
    add: list[str] | None = Field(
        None,
        max_length=MAX_MEMBERS_PER_CALL,
        description="Members to add (user_uuid, username or email); they must belong to the organization.",
    )
    role: ContributorRole = Field("contributor", description="Role for the members added.")
    status: ContributorStatus = Field(
        "active", description="Status for the members added: only active ones can edit."
    )
    update: list[ContributorChange] | None = Field(
        None, max_length=MAX_MEMBERS_PER_CALL, description="Role or status changes for current contributors."
    )
    remove: list[str] | None = Field(
        None, max_length=MAX_MEMBERS_PER_CALL, description="Contributors to take off the course."
    )


def _enum_role(role: str) -> ResourceAuthorshipEnum:
    return ResourceAuthorshipEnum(role.upper())


def _enum_status(status: str) -> ResourceAuthorshipStatusEnum:
    return ResourceAuthorshipStatusEnum(status.upper())


async def _authorship(ctx: ToolContext, course: Course, user_id: int) -> ResourceAuthor | None:
    return (
        await ctx.db_session.execute(
            select(ResourceAuthor).where(
                ResourceAuthor.resource_uuid == course.course_uuid,
                ResourceAuthor.user_id == user_id,
            )
        )
    ).scalars().first()


def _failure(reason: str) -> str:
    """A result code for a reason the bulk services give."""
    reason = reason.lower()
    if "already has an authorship" in reason:
        return "already_contributor"
    if "not a contributor" in reason:
        return "not_a_contributor"
    if "remove the course creator" in reason:
        return "is_creator"
    if "remove a maintainer" in reason:
        return "maintainer_needs_creator_or_admin"
    return "not_found"


async def _manage_course_contributors(ctx: ToolContext, p: ManageCourseContributorsParams):
    course = await refs.load(ctx, "course", p.course_uuid)
    add, update, remove = p.add or [], p.update or [], p.remove or []
    if not (add or update or remove):
        raise HTTPException(status_code=400, detail="Nothing to change: pass add, update or remove.")
    # Authorize once up front (course creator or maintainer, or an org admin),
    # so per-member results never reveal anything to someone who may not
    # manage this course.
    await _require_contributor_manager(ctx.request, course.course_uuid, ctx.user, ctx.db_session)

    results: list[dict] = []
    resolved: dict[str, Any] = {}
    seen: dict[int, str] = {}
    for who in [*add, *(c.member for c in update), *remove]:
        if who in resolved:
            raise HTTPException(status_code=400, detail=f"'{who}' is named twice; name each member once.")
        try:
            user = await refs.load_member(ctx, who)
        except HTTPException as e:
            if e.status_code == 403:
                raise  # an email lookup this caller may not make
            resolved[who] = None
            continue
        if user.id in seen:
            raise HTTPException(
                status_code=400, detail=f"'{who}' and '{seen[user.id]}' are the same member; name them once."
            )
        seen[user.id] = who
        resolved[who] = user

    def unresolved(who: str) -> bool:
        if resolved.get(who) is None:
            results.append({"member": who, "result": "not_a_member"})
            return True
        return False

    # ── add ──
    to_add = [who for who in add if not unresolved(who)]
    if to_add:
        out = await add_bulk_course_contributors(
            ctx.request, course.course_uuid, [resolved[w].username for w in to_add], ctx.user, ctx.db_session
        )
        failed = {f["username"]: f["reason"] for f in out.get("failed", [])}
        for who in to_add:
            user = resolved[who]
            if user.username in failed:
                results.append(
                    {"member": who, "user_uuid": user.user_uuid, "result": _failure(failed[user.username])}
                )
                continue
            # The service adds pending contributors; set what was asked for.
            if p.role != "contributor" or p.status != "pending":
                try:
                    await update_course_contributor(
                        ctx.request, course.course_uuid, user.id, _enum_role(p.role), _enum_status(p.status),
                        ctx.user, ctx.db_session,
                    )
                except HTTPException as e:
                    if e.status_code not in (400, 403, 404):
                        raise
                    results.append({
                        "member": who, "user_uuid": user.user_uuid, "result": "added_as_pending",
                        "role": "contributor", "status": "pending", "reason": str(e.detail),
                    })
                    continue
            results.append(
                {"member": who, "user_uuid": user.user_uuid, "result": "added", "role": p.role, "status": p.status}
            )

    # ── update ──
    for change in update:
        who = change.member
        if unresolved(who):
            continue
        user = resolved[who]
        if change.role is None and change.status is None:
            results.append({"member": who, "user_uuid": user.user_uuid, "result": "nothing_to_change"})
            continue
        current = await _authorship(ctx, course, user.id)
        if current is None:
            results.append({"member": who, "user_uuid": user.user_uuid, "result": "not_a_contributor"})
            continue
        role = _enum_role(change.role) if change.role else current.authorship
        status = _enum_status(change.status) if change.status else current.authorship_status
        try:
            await update_course_contributor(
                ctx.request, course.course_uuid, user.id, role, status, ctx.user, ctx.db_session
            )
        except HTTPException as e:
            if e.status_code not in (400, 403, 404):
                raise
            results.append(
                {"member": who, "user_uuid": user.user_uuid, "result": "refused", "reason": str(e.detail)}
            )
            continue
        results.append(
            {
                "member": who,
                "user_uuid": user.user_uuid,
                "result": "updated",
                "role": role.value.lower(),
                "status": status.value.lower(),
            }
        )

    # ── remove ──
    to_remove = [who for who in remove if not unresolved(who)]
    if to_remove:
        out = await remove_bulk_course_contributors(
            ctx.request, course.course_uuid, [resolved[w].username for w in to_remove], ctx.user, ctx.db_session
        )
        failed = {f["username"]: f["reason"] for f in out.get("failed", [])}
        for who in to_remove:
            user = resolved[who]
            result = _failure(failed[user.username]) if user.username in failed else "removed"
            results.append({"member": who, "user_uuid": user.user_uuid, "result": result})

    counts = {k: sum(1 for r in results if r["result"] == k) for k in ("added", "updated", "removed")}
    parts = [f"{n} {k}" for k, n in counts.items() if n]
    skipped = len(results) - sum(counts.values())
    if skipped:
        parts.append(f"{skipped} skipped, see the results")
    return changed(
        f"Contributors of '{course.name}': " + ("; ".join(parts) or "no change") + ".",
        course=await _course_ref(ctx, course),
        results=results,
    )


def _summarize_contributors(p: ManageCourseContributorsParams) -> str:
    bits = []
    if p.add:
        bits.append(f"add {', '.join(p.add[:5])}{' and more' if len(p.add) > 5 else ''} as {p.status} {p.role}(s)")
    for c in (p.update or [])[:5]:
        changes = " and ".join(x for x in (c.role, c.status) if x)
        bits.append(f"make {c.member} {changes or 'unchanged'}")
    if p.update and len(p.update) > 5:
        bits.append(f"change {len(p.update) - 5} more")
    if p.remove:
        bits.append(f"remove {', '.join(p.remove[:5])}{' and more' if len(p.remove) > 5 else ''}")
    return f"Who can edit course {p.course_uuid}: " + ("; ".join(bits) or "no change")


# ─── specs ───────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="get_course_admin",
        title="Get course certificate and contributors",
        description=(
            "A course's completion certificate (on or off, its settings, how it is awarded, "
            "and how many were issued when you can edit the course) and its contributors: "
            "each with role (creator, maintainer, contributor, reporter), status (active, "
            "pending, inactive) and whether they can edit. Contributors are paged."
        ),
        params_model=GetCourseAdminParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.READ,
        execute=_get_course_admin,
        target_param="course_uuid",
        target_kind="course",
    ),
    ToolSpec(
        name="set_course_certificate",
        title="Set course certificate",
        description=(
            "Turn a course's completion certificate on or off, change what it shows (name, "
            "description, type, background pattern, instructor), or take it back from "
            "learners with revoke_from. " + AWARD_RULE + " Turning it off once certificates "
            "were issued revokes them all, so it needs revoke_issued=true; that and "
            "revoke_from need approval. Pro plan."
        ),
        params_model=SetCourseCertificateParams,
        tier=ActionTier.EDIT,
        rights_bucket="certifications",
        access_action=AccessAction.UPDATE,
        execute=_set_course_certificate,
        target_param="course_uuid",
        target_kind="course",
        approval_in_call=True,
        idempotent=True,
        summarize=_summarize_certificate,
    ),
    ToolSpec(
        name="manage_course_contributors",
        title="Manage course contributors",
        description=(
            "Add, remove, or change the role or status of a course's contributors (co-authors), "
            "in one call. Active contributors can edit the course; maintainers also manage "
            "contributors; reporters are listed without edit rights; pending and inactive "
            "people cannot edit. Members added are active contributors unless role or status "
            "say otherwise. Only the course creator, a maintainer or an admin can do this, "
            "and it needs approval. Reports a result per member. List them with get_course_admin."
        ),
        params_model=ManageCourseContributorsParams,
        tier=ActionTier.EDIT,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_manage_course_contributors,
        target_param="course_uuid",
        target_kind="course",
        approval=True,
        idempotent=True,
        summarize=_summarize_contributors,
    ),
]
