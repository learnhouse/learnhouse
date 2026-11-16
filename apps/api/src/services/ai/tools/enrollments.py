"""Course enrollment tools: put members in a course, or take them out.

Both wrap the dashboard's own enrollment services
(src/services/orgs/member_enrollments.py), so the rules are the dashboard's:
signed-in org admins and maintainers only, members of this organization
only, courses of this organization only. People are named by user_uuid,
username, email (staff only) or numeric id, or taken from a user group.

Enrolling many people at once, or a whole group, needs a person's approval;
taking anyone out always does, since their progress in the course goes with
it. Each result carries the call that reverses it (`undo`).
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlmodel import select

from src.db.usergroup_user import UserGroupUser
from src.db.users import User
from src.security.rbac import AccessAction
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolDenied, ToolSpec
from src.services.ai.tools.chapters import course_ref
from src.services.ai.tools.results import changed
from src.services.orgs.member_enrollments import enroll_org_member, unenroll_org_member

MAX_PEOPLE_PER_CALL = 200
# More people than this in one call is a bulk change that needs approval.
BULK = 10

_COURSE = Field(..., description="The course: course_uuid (or its name).")
_MEMBERS = Field(
    default_factory=list,
    max_length=MAX_PEOPLE_PER_CALL,
    description="People by user_uuid, username, email or numeric user id; they must belong to the organization.",
)
_GROUP = Field(None, description="A user group (usergroup_uuid): every member of the group is included.")


class EnrollmentParams(BaseModel):
    course_uuid: str = _COURSE
    members: list[str] = _MEMBERS
    usergroup_uuid: str | None = _GROUP

    @model_validator(mode="after")
    def _someone(self):
        if not self.members and not self.usergroup_uuid:
            raise ValueError("Name the people (members) or a user group (usergroup_uuid).")
        return self


def _bulk(p: EnrollmentParams) -> bool:
    return bool(p.usergroup_uuid) or len(p.members) > BULK


async def _people(ctx: ToolContext, p: EnrollmentParams) -> tuple[dict[int, Any], list[dict]]:
    """The members named or grouped, by user id, plus the names that did
    not resolve to a member of this organization."""
    found: dict[int, Any] = {}
    missing: list[dict] = []
    for who in p.members:
        who = (who or "").strip()
        try:
            if who.isdigit():
                user = await ctx.db_session.get(User, int(who))
                if user is None or not await refs.is_member(ctx, user.id):
                    raise HTTPException(status_code=404, detail="not a member")
            else:
                user = await refs.load_member(ctx, who)
        except HTTPException as e:
            if e.status_code == 403:
                raise ToolDenied("email_lookup_denied", str(e.detail))
            missing.append({"member": who, "result": "not_a_member"})
            continue
        found[user.id] = user
    if p.usergroup_uuid:
        group = await refs.load(ctx, "usergroup", p.usergroup_uuid)
        ids = (
            await ctx.db_session.execute(select(UserGroupUser.user_id).where(UserGroupUser.usergroup_id == group.id))
        ).scalars().all()
        for user_id in ids:
            if user_id not in found and await refs.is_member(ctx, user_id):
                found[user_id] = await ctx.db_session.get(User, user_id)
    return found, missing


def _who(user: Any) -> dict:
    name = " ".join(x for x in (user.first_name, user.last_name) if x) or user.username
    return refs.ref("user", user.user_uuid, name)


async def _apply(ctx: ToolContext, p: EnrollmentParams, *, enroll: bool) -> dict:
    course = await refs.load(ctx, "course", p.course_uuid)
    people, missing = await _people(ctx, p)
    done: list[dict] = []
    skipped: list[dict] = []
    for user_id, user in people.items():
        try:
            if enroll:
                await enroll_org_member(ctx.org.id, user_id, course.course_uuid, ctx.user, ctx.db_session)
            else:
                await unenroll_org_member(ctx.org.id, user_id, course.course_uuid, ctx.user, ctx.db_session)
        except HTTPException as e:
            if e.status_code in (401, 403):
                raise  # the caller may not do this at all: stop, don't list it per person
            if enroll and e.status_code == 409:
                reason = "already_enrolled"
            elif not enroll and e.status_code == 404:
                reason = "not_enrolled"
            else:
                reason = "failed"
            skipped.append({**_who(user), "result": reason, "detail": str(e.detail)})
            continue
        done.append(_who(user))

    verb = "Enrolled" if enroll else "Unenrolled"
    summary = f"{verb} {len(done)} {'person' if len(done) == 1 else 'people'} {'in' if enroll else 'from'} '{course.name}'."
    if skipped:
        summary += f" {len(skipped)} skipped (see skipped)."
    if missing:
        summary += f" {len(missing)} not found in this organization."
    if not enroll and done:
        summary += " Their progress in the course was removed."
    out = changed(
        summary,
        course=await course_ref(ctx, course),
        **({"enrolled": done} if enroll else {"unenrolled": done}),
        skipped=skipped or None,
        not_found=missing or None,
    )
    if done:
        out["undo"] = {
            "tool": "unenroll_users_from_course" if enroll else "enroll_users_in_course",
            "args": {"course_uuid": course.course_uuid, "members": [d["uuid"] for d in done]},
        }
    return out


async def _enroll(ctx: ToolContext, p: EnrollmentParams) -> dict:
    return await _apply(ctx, p, enroll=True)


async def _unenroll(ctx: ToolContext, p: EnrollmentParams) -> dict:
    return await _apply(ctx, p, enroll=False)


def _count(p: EnrollmentParams) -> str:
    parts = []
    if p.members:
        parts.append(f"{len(p.members)} {'person' if len(p.members) == 1 else 'people'}")
    if p.usergroup_uuid:
        parts.append("a user group")
    return " and ".join(parts)


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="enroll_users_in_course",
        description=(
            "Enroll members of the organization in a course, named one by one (user_uuid, username, "
            "email or user id) and/or as a whole user group. People already enrolled are skipped. "
            "Admins and maintainers only. More than 10 people, or a group, needs the user's approval."
        ),
        params_model=EnrollmentParams,
        tier=ActionTier.CREATE,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_enroll,
        access="admin",
        # Like the dashboard route: a signed-in person, not an API token.
        api_tokens=False,
        target_param="course_uuid",
        target_kind="course",
        approval_if=_bulk,
        idempotent=True,
        summarize=lambda p: f"Enroll {_count(p)} in course {p.course_uuid}",
        title="Enroll in course",
    ),
    ToolSpec(
        name="unenroll_users_from_course",
        description=(
            "Take members out of a course (by user_uuid, username, email, user id and/or user group). "
            "Their progress in that course is deleted. Admins and maintainers only; always needs the "
            "user's approval."
        ),
        params_model=EnrollmentParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_unenroll,
        access="admin",
        api_tokens=False,
        target_param="course_uuid",
        target_kind="course",
        summarize=lambda p: f"Unenroll {_count(p)} from course {p.course_uuid}",
        title="Unenroll from course",
    ),
]
