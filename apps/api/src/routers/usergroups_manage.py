"""User groups v2: smart rules, nesting, managers, access windows, join
codes, schedules, progress, bulk tools, the group space, messaging and
history. Mounted on ``/usergroups`` next to the original CRUD routes, with
the same dependencies (signed-in user or API token with the ``usergroups``
scope, Standard plan). Pro-only parts are checked in the services.
"""

from typing import Optional

from fastapi import APIRouter, Body, Depends, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.usergroups import access, bulk, codes, groups, progress, space
from src.services.usergroups.common import load_group, require_org_admin
from src.services.usergroups.sync import sync_org

router = APIRouter()
T = ["usergroups"]


class RulesBody(BaseModel):
    rules: dict = Field(default_factory=dict)
    usergroup_id: Optional[int] = None


class UserIdsBody(BaseModel):
    user_ids: list[int] = Field(default_factory=list, max_length=500)


class UuidsBody(BaseModel):
    resource_uuids: list[str] = Field(default_factory=list, max_length=100)


class JoinBody(BaseModel):
    code: str = Field(..., min_length=4, max_length=40)


# ── org level ───────────────────────────────────────────────────────────


@router.get("/org/{org_id}/overview", tags=T, summary="List groups with types, counts and managers")
async def api_overview(request: Request, org_id: int, db: AsyncSession = Depends(get_db_session),
                       current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.overview(request, db, current_user, org_id)


@router.post("/org/{org_id}/groups", tags=T, summary="Create a group (manual, smart or both; optionally nested)")
async def api_create(request: Request, org_id: int, body: groups.GroupCreateBody, db: AsyncSession = Depends(get_db_session),
                     current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.create_group(request, db, current_user, org_id, body)


@router.post("/org/{org_id}/rules/preview", tags=T, summary="Count the members a rule set would match")
async def api_preview_rules(request: Request, org_id: int, body: RulesBody, db: AsyncSession = Depends(get_db_session),
                            current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.preview_rules(request, db, current_user, org_id, body.rules, body.usergroup_id)


@router.get("/org/{org_id}/rules/options", tags=T, summary="Choices for the rule builder")
async def api_rule_options(request: Request, org_id: int, db: AsyncSession = Depends(get_db_session),
                           current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.rule_options(request, db, current_user, org_id)


@router.post("/org/{org_id}/import/preview", tags=T, summary="Dry-run a CSV of members")
async def api_import_preview(request: Request, org_id: int, body: bulk.ImportBody, db: AsyncSession = Depends(get_db_session),
                             current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await bulk.import_preview(request, db, current_user, org_id, body)


@router.post("/org/{org_id}/import", tags=T, summary="Import a CSV of members (only valid rows are applied)")
async def api_import(request: Request, org_id: int, body: bulk.ImportBody, db: AsyncSession = Depends(get_db_session),
                     current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await bulk.import_apply(request, db, current_user, org_id, body)


@router.post("/org/{org_id}/bulk", tags=T, summary="Add, remove or move many members across groups")
async def api_bulk(request: Request, org_id: int, body: bulk.BulkBody, db: AsyncSession = Depends(get_db_session),
                   current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await bulk.bulk(request, db, current_user, org_id, body)


@router.get("/org/{org_id}/memberships", tags=T, summary="Group memberships of every member (Users table)")
async def api_memberships(request: Request, org_id: int, db: AsyncSession = Depends(get_db_session),
                          current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.membership_map(request, db, current_user, org_id)


@router.get("/org/{org_id}/members/{user_id}/groups", tags=T, summary="Groups one member belongs to")
async def api_member_groups(request: Request, org_id: int, user_id: int, db: AsyncSession = Depends(get_db_session),
                            current_user: PublicUser = Depends(get_current_user)) -> list[dict]:
    await require_org_admin(request, db, current_user, org_id, "read")
    return await groups.groups_of_user(db, org_id, user_id)


@router.get("/org/{org_id}/mine", tags=T, summary="Groups I belong to and groups I manage")
async def api_mine(request: Request, org_id: int, db: AsyncSession = Depends(get_db_session),
                   current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.my_groups(request, db, current_user, org_id)


@router.get("/org/{org_id}/space/{short_uuid}", tags=T, summary="A group's space (members only)")
async def api_space(request: Request, org_id: int, short_uuid: str, db: AsyncSession = Depends(get_db_session),
                    current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await space.space(request, db, current_user, org_id, short_uuid)


@router.post("/org/{org_id}/sync", tags=T, summary="Re-run rules, nesting, schedules and expiries now")
async def api_sync_org(request: Request, org_id: int, db: AsyncSession = Depends(get_db_session),
                       current_user: PublicUser = Depends(get_current_user)) -> dict:
    await require_org_admin(request, db, current_user, org_id)
    return (await sync_org(db, org_id, request=request)).as_dict()


@router.post("/join", tags=T, summary="Join a group with a code")
async def api_join(request: Request, body: JoinBody, db: AsyncSession = Depends(get_db_session),
                   current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await codes.redeem(request, db, current_user, body.code)


# ── group level ─────────────────────────────────────────────────────────


@router.get("/{usergroup_id}/detail", tags=T, summary="A group with its settings, parent, sub-groups and managers")
async def api_detail(request: Request, usergroup_id: int, db: AsyncSession = Depends(get_db_session),
                     current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.detail(request, db, current_user, usergroup_id)


@router.put("/{usergroup_id}/settings", tags=T, summary="Change a group's type, rules, parent, color or settings")
async def api_settings(request: Request, usergroup_id: int, body: groups.GroupSettingsBody, db: AsyncSession = Depends(get_db_session),
                       current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.update_settings(request, db, current_user, usergroup_id, body)


@router.post("/{usergroup_id}/sync", tags=T, summary="Re-run this group's rules now")
async def api_sync_group(request: Request, usergroup_id: int, db: AsyncSession = Depends(get_db_session),
                         current_user: PublicUser = Depends(get_current_user)) -> dict:
    group = await load_group(db, usergroup_id)
    await require_org_admin(request, db, current_user, group.org_id)
    return (await sync_org(db, group.org_id, request=request, only_group_id=group.id)).as_dict()


@router.get("/{usergroup_id}/members", tags=T, summary="Members with how they joined and when they leave")
async def api_members(request: Request, usergroup_id: int, q: str = "", source: str = "", page: int = Query(1, ge=1),
                      per_page: int = Query(50, ge=1, le=200), db: AsyncSession = Depends(get_db_session),
                      current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.list_members(request, db, current_user, usergroup_id, q=q, source=source, page=page, per_page=per_page)


@router.post("/{usergroup_id}/members", tags=T, summary="Add members, optionally from a date and until a date")
async def api_add_members(request: Request, usergroup_id: int, body: groups.MembersBody, db: AsyncSession = Depends(get_db_session),
                          current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.add_members(request, db, current_user, usergroup_id, body)


@router.post("/{usergroup_id}/members/remove", tags=T, summary="Remove members")
async def api_remove_members(request: Request, usergroup_id: int, body: UserIdsBody, db: AsyncSession = Depends(get_db_session),
                             current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.remove_members(request, db, current_user, usergroup_id, body.user_ids)


@router.patch("/{usergroup_id}/members/{user_id}", tags=T, summary="Change when a membership ends")
async def api_update_member(request: Request, usergroup_id: int, user_id: int, body: groups.MemberPatchBody,
                            db: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.update_member(request, db, current_user, usergroup_id, user_id, body)


@router.delete("/{usergroup_id}/schedules/{schedule_id}", tags=T, summary="Cancel a scheduled membership")
async def api_cancel_schedule(request: Request, usergroup_id: int, schedule_id: int, db: AsyncSession = Depends(get_db_session),
                              current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.cancel_schedule(request, db, current_user, usergroup_id, schedule_id)


@router.get("/{usergroup_id}/access", tags=T, summary="What the group unlocks, with access windows")
async def api_access(request: Request, usergroup_id: int, db: AsyncSession = Depends(get_db_session),
                     current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await access.list_access(request, db, current_user, usergroup_id)


@router.get("/{usergroup_id}/access/options", tags=T, summary="Resources the group could unlock")
async def api_access_options(request: Request, usergroup_id: int, q: str = "", kind: str = "",
                             db: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await access.access_options(request, db, current_user, usergroup_id, q, kind)


@router.post("/{usergroup_id}/access", tags=T, summary="Unlock resources for the group, optionally between two dates")
async def api_add_access(request: Request, usergroup_id: int, body: access.AccessBody, db: AsyncSession = Depends(get_db_session),
                         current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await access.add_access(request, db, current_user, usergroup_id, body)


@router.post("/{usergroup_id}/access/remove", tags=T, summary="Stop the group unlocking resources")
async def api_remove_access(request: Request, usergroup_id: int, body: UuidsBody, db: AsyncSession = Depends(get_db_session),
                            current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await access.remove_access(request, db, current_user, usergroup_id, body.resource_uuids)


@router.post("/{usergroup_id}/managers", tags=T, summary="Make a member a group manager (or change their rights)")
async def api_set_manager(request: Request, usergroup_id: int, body: groups.ManagerBody, db: AsyncSession = Depends(get_db_session),
                          current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.set_manager(request, db, current_user, usergroup_id, body)


@router.delete("/{usergroup_id}/managers/{user_id}", tags=T, summary="Remove a group manager")
async def api_remove_manager(request: Request, usergroup_id: int, user_id: int, db: AsyncSession = Depends(get_db_session),
                             current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.remove_manager(request, db, current_user, usergroup_id, user_id)


@router.get("/{usergroup_id}/codes", tags=T, summary="Join codes of a group")
async def api_codes(request: Request, usergroup_id: int, db: AsyncSession = Depends(get_db_session),
                    current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await codes.list_codes(request, db, current_user, usergroup_id)


@router.post("/{usergroup_id}/codes", tags=T, summary="Create a join code")
async def api_create_code(request: Request, usergroup_id: int, body: codes.CodeBody, db: AsyncSession = Depends(get_db_session),
                          current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await codes.create_code(request, db, current_user, usergroup_id, body)


@router.patch("/{usergroup_id}/codes/{code_id}", tags=T, summary="Change or revoke a join code")
async def api_update_code(request: Request, usergroup_id: int, code_id: int, body: codes.CodePatchBody,
                          db: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await codes.update_code(request, db, current_user, usergroup_id, code_id, body)


@router.get("/{usergroup_id}/progress", tags=T, summary="Completion by course, members at risk, weekly activity")
async def api_progress(request: Request, usergroup_id: int, db: AsyncSession = Depends(get_db_session),
                       current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await progress.group_progress(request, db, current_user, usergroup_id)


@router.get("/{usergroup_id}/progress.csv", tags=T, summary="Per-member progress as CSV")
async def api_progress_csv(request: Request, usergroup_id: int, db: AsyncSession = Depends(get_db_session),
                           current_user: PublicUser = Depends(get_current_user)) -> Response:
    text, name = await progress.group_progress_csv(request, db, current_user, usergroup_id)
    return Response(content=text, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.post("/{usergroup_id}/digest", tags=T, summary="Email the progress digest to the group's managers now")
async def api_digest(request: Request, usergroup_id: int, db: AsyncSession = Depends(get_db_session),
                     current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await space.send_digest(request, db, current_user, usergroup_id)


@router.get("/{usergroup_id}/history", tags=T, summary="The group's history")
async def api_history(request: Request, usergroup_id: int, page: int = Query(1, ge=1), db: AsyncSession = Depends(get_db_session),
                      current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await groups.history(request, db, current_user, usergroup_id, page)


@router.get("/{usergroup_id}/announcements", tags=T, summary="Announcements posted to the group")
async def api_announcements(request: Request, usergroup_id: int, db: AsyncSession = Depends(get_db_session),
                            current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await space.list_announcements(request, db, current_user, usergroup_id)


@router.post("/{usergroup_id}/announcements", tags=T, summary="Post an announcement (optionally emailed)")
async def api_post_announcement(request: Request, usergroup_id: int, body: space.AnnouncementBody,
                                db: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await space.post_announcement(request, db, current_user, usergroup_id, body)


@router.delete("/{usergroup_id}/announcements/{announcement_uuid}", tags=T, summary="Delete an announcement")
async def api_delete_announcement(request: Request, usergroup_id: int, announcement_uuid: str,
                                  db: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await space.delete_announcement(request, db, current_user, usergroup_id, announcement_uuid)


@router.post("/{usergroup_id}/message", tags=T, summary="Email every member (newsletter rules apply)")
async def api_message(request: Request, usergroup_id: int, body: space.MessageBody = Body(...),
                      db: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_current_user)) -> dict:
    return await space.message_group(request, db, current_user, usergroup_id, body)
