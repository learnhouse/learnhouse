"""Playground tools: interactive HTML pages members build and share.

Playgrounds act as a person: the HTTP routes refuse API tokens, so these
tools do too. Every id is loaded through `refs` (only from the connected
organization) before the playground service runs its own rights checks.
Playground ids are bare uuids, without a prefix. The HTML is member-written
and only returned when asked for.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator

from src.db.playgrounds import PlaygroundAccessType, PlaygroundCreate, PlaygroundUpdate
from src.security.rbac import AccessAction
from src.services.ai.tools import refs, results
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.results import Paging
from src.services.playgrounds.playgrounds import (
    add_usergroup_to_playground,
    create_playground,
    delete_playground,
    duplicate_playground,
    get_playground,
    list_org_playgrounds,
    remove_usergroup_from_playground,
    update_playground,
)

HTML_MAX = 200_000
HTML_RETURN_MAX = 30_000

_ACCESS_HELP = (
    "public = anyone, even signed out; authenticated = any signed-in user; "
    "restricted = only usergroups granted with set_playground_access."
)


# ─── helpers ─────────────────────────────────────────────────────────────────


async def _playground_ref(ctx: ToolContext, pg, **extra) -> dict:
    return refs.ref(
        "playground",
        pg.playground_uuid,
        pg.name,
        await refs.web_url(ctx, "playground", playground=pg.playground_uuid),
        **extra,
    )


def _access(pg) -> str:
    value = getattr(pg.access_type, "value", pg.access_type)
    return str(value).lower()


async def _course_ref(ctx: ToolContext, course_uuid: str | None) -> dict | None:
    if not course_uuid:
        return None
    try:
        course = await refs.load(ctx, "course", course_uuid)
    except HTTPException:
        return None
    return refs.ref(
        "course", course.course_uuid, course.name, await refs.web_url(ctx, "course", course=course.course_uuid)
    )


async def _course_param(ctx: ToolContext, value: str | None) -> str | None:
    """A course_uuid param loaded from this org; "" for "none" (unlink)."""
    if value is None:
        return None
    if value.strip().lower() == "none":
        return ""
    course = await refs.load(ctx, "course", value)
    return course.course_uuid


# ─── params ──────────────────────────────────────────────────────────────────


class ListPlaygroundsParams(Paging):
    pass


class GetPlaygroundParams(BaseModel):
    playground_uuid: str = Field(..., max_length=100, description="The playground's uuid (no prefix).")
    include_html: bool = Field(
        False, description=f"Also return the HTML document (cut at {HTML_RETURN_MAX} chars)."
    )


class CreatePlaygroundParams(BaseModel):
    name: str | None = Field(
        None, min_length=1, max_length=200, description="Name. Required unless copying, where it defaults to the copy's name."
    )
    description: str | None = Field(None, max_length=2000, description="Short description.")
    html: str | None = Field(
        None, max_length=HTML_MAX, description="Full HTML document rendered in a sandboxed frame."
    )
    course_uuid: str | None = Field(None, max_length=100, description="Course to link it to.")
    copy_from_playground_uuid: str | None = Field(
        None, max_length=100, description="Start from a copy of this playground (its HTML and settings)."
    )

    @model_validator(mode="after")
    def _needs_name(self):
        if not self.name and not self.copy_from_playground_uuid:
            raise ValueError("name is required unless copy_from_playground_uuid is given")
        return self


class UpdatePlaygroundParams(BaseModel):
    playground_uuid: str = Field(..., max_length=100, description="The playground to change.")
    name: str | None = Field(None, min_length=1, max_length=200, description="New name.")
    description: str | None = Field(None, max_length=2000, description="New description.")
    html: str | None = Field(None, max_length=HTML_MAX, description="Replaces the whole HTML document.")
    course_uuid: str | None = Field(
        None, max_length=100, description='Course to link, or "none" to unlink.'
    )
    published: bool | None = Field(None, description="Publish (true) or move back to draft (false).")
    access_type: PlaygroundAccessType | None = Field(None, description=f"Who can open it: {_ACCESS_HELP}")


class SetPlaygroundAccessParams(BaseModel):
    playground_uuid: str = Field(..., max_length=100, description="The playground.")
    usergroup_uuid: str = Field(..., max_length=100, description="The usergroup, e.g. usergroup_...")
    grant: bool = Field(..., description="True grants the usergroup access, false revokes it.")


class DeletePlaygroundParams(BaseModel):
    playground_uuid: str = Field(..., max_length=100, description="The playground to delete.")


# ─── executors ───────────────────────────────────────────────────────────────


async def _list_playgrounds(ctx: ToolContext, p: ListPlaygroundsParams):
    # The service filters drafts and restricted ones the caller cannot open.
    playgrounds = await list_org_playgrounds(ctx.request, ctx.org.id, ctx.user, ctx.db_session)
    playgrounds = sorted(playgrounds, key=lambda pg: pg.update_date or "", reverse=True)
    offset = results.offset_of(p.cursor)
    chunk = playgrounds[offset : offset + p.limit]
    items = [
        await _playground_ref(
            ctx,
            pg,
            published=bool(pg.published),
            access=_access(pg),
            author=refs.ref("user", pg.author_user_uuid, pg.author_username) if pg.author_user_uuid else None,
            description=results.clip(pg.description or "") or None,
            updated_at=pg.update_date or None,
        )
        for pg in chunk
    ]
    return results.page(items, offset=offset, limit=p.limit, total=len(playgrounds))


async def _get_playground(ctx: ToolContext, p: GetPlaygroundParams):
    row = await refs.load(ctx, "playground", p.playground_uuid)
    pg = await get_playground(ctx.request, row.playground_uuid, ctx.user, ctx.db_session)
    out: dict[str, Any] = {
        "playground": await _playground_ref(ctx, pg),
        "description": pg.description or "",
        "published": bool(pg.published),
        "access": _access(pg),
        "course": await _course_ref(ctx, pg.course_uuid),
        "author": refs.ref("user", pg.author_user_uuid, pg.author_username) if pg.author_user_uuid else None,
        "html_chars": len(pg.html_content or ""),
        "created_at": pg.creation_date or None,
        "updated_at": pg.update_date or None,
    }
    results.clip_field(out, "description")
    if p.include_html:
        out["html"] = pg.html_content or ""
        results.clip_field(out, "html", HTML_RETURN_MAX)
        return results.untrusted(out)
    return out


async def _create_playground(ctx: ToolContext, p: CreatePlaygroundParams):
    course_uuid = await _course_param(ctx, p.course_uuid)
    if p.copy_from_playground_uuid:
        source = await refs.load(ctx, "playground", p.copy_from_playground_uuid)
        # The service checks create rights and that the caller can read the source.
        copy = await duplicate_playground(ctx.request, source.playground_uuid, ctx.user, ctx.db_session)
        overrides = {
            k: v
            for k, v in {
                "name": p.name,
                "description": p.description,
                "html_content": p.html,
                "course_uuid": course_uuid,
            }.items()
            if v is not None
        }
        if overrides:
            copy = await update_playground(
                ctx.request, copy.playground_uuid, PlaygroundUpdate(**overrides), ctx.user, ctx.db_session
            )
        return results.changed(
            f'Created draft playground "{copy.name}" as a copy of "{source.name}".',
            playground=await _playground_ref(ctx, copy, published=False, access=_access(copy)),
            copied_from=await _playground_ref(ctx, source),
        )

    created = await create_playground(
        ctx.request,
        ctx.org.id,
        PlaygroundCreate(
            name=p.name,
            description=p.description,
            html_content=p.html,
            course_uuid=course_uuid or None,
        ),
        ctx.user,
        ctx.db_session,
    )
    return results.changed(
        f'Created draft playground "{created.name}". Publish it with update_playground.',
        playground=await _playground_ref(ctx, created, published=False, access=_access(created)),
    )


async def _update_playground(ctx: ToolContext, p: UpdatePlaygroundParams):
    row = await refs.load(ctx, "playground", p.playground_uuid)
    patch: dict[str, Any] = {
        k: v
        for k, v in {
            "name": p.name,
            "description": p.description,
            "html_content": p.html,
            "published": p.published,
            "access_type": p.access_type,
        }.items()
        if v is not None
    }
    course_uuid = await _course_param(ctx, p.course_uuid)
    if course_uuid is not None:
        patch["course_uuid"] = course_uuid or None
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to change: pass at least one field.")
    pg = await update_playground(
        ctx.request, row.playground_uuid, PlaygroundUpdate(**patch), ctx.user, ctx.db_session
    )
    fields = ["html" if k == "html_content" else "course" if k == "course_uuid" else k for k in patch]
    return results.changed(
        f'Updated playground "{pg.name}" ({", ".join(fields)}).',
        playground=await _playground_ref(ctx, pg, published=bool(pg.published), access=_access(pg)),
    )


async def _set_playground_access(ctx: ToolContext, p: SetPlaygroundAccessParams):
    row = await refs.load(ctx, "playground", p.playground_uuid)
    group = await refs.load(ctx, "usergroup", p.usergroup_uuid)
    group_ref = refs.ref("usergroup", group.usergroup_uuid, group.name)
    if p.grant:
        await add_usergroup_to_playground(
            ctx.request, row.playground_uuid, group.usergroup_uuid, ctx.user, ctx.db_session
        )
        summary = f'Usergroup "{group.name}" can open playground "{row.name}".'
    else:
        try:
            await remove_usergroup_from_playground(
                ctx.request, row.playground_uuid, group.usergroup_uuid, ctx.user, ctx.db_session
            )
            summary = f'Usergroup "{group.name}" no longer has access to playground "{row.name}".'
        except HTTPException as e:
            if e.status_code != 404 or "not associated" not in str(e.detail):
                raise
            summary = f'Usergroup "{group.name}" had no access to playground "{row.name}"; nothing changed.'
    note = None
    if _access(row) != "restricted":
        note = f"The playground is {_access(row)}, so usergroup access only matters once access_type is restricted."
    return results.changed(
        summary, playground=await _playground_ref(ctx, row), usergroup=group_ref, note=note
    )


async def _delete_playground(ctx: ToolContext, p: DeletePlaygroundParams):
    row = await refs.load(ctx, "playground", p.playground_uuid)
    name = row.name
    await delete_playground(ctx.request, row.playground_uuid, ctx.user, ctx.db_session)
    return results.changed(
        f'Deleted playground "{name}".', playground=refs.ref("playground", p.playground_uuid, name)
    )


# ─── specs ───────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_playgrounds",
        description=(
            "List the playgrounds you can open (your drafts included), most recently updated "
            "first: name, link, published, access, author. No HTML; use get_playground. Paged."
        ),
        params_model=ListPlaygroundsParams,
        tier=ActionTier.READ,
        rights_bucket="playgrounds",
        access_action=AccessAction.READ,
        execute=_list_playgrounds,
        api_tokens=False,
        title="List playgrounds",
    ),
    ToolSpec(
        name="get_playground",
        description=(
            "One playground: description, published state, access, linked course, author and HTML "
            f"size. With include_html=true also its HTML document (cut at {HTML_RETURN_MAX} chars)."
        ),
        params_model=GetPlaygroundParams,
        tier=ActionTier.READ,
        rights_bucket="playgrounds",
        access_action=AccessAction.READ,
        execute=_get_playground,
        target_param="playground_uuid",
        target_kind="playground",
        api_tokens=False,
        title="Get playground",
    ),
    ToolSpec(
        name="create_playground",
        description=(
            "Create a playground (a self-contained HTML page), optionally linked to a course or "
            "copied from another playground. It starts as an unpublished draft open to signed-in "
            "users once published."
        ),
        params_model=CreatePlaygroundParams,
        tier=ActionTier.CREATE,
        rights_bucket="playgrounds",
        access_action=AccessAction.CREATE,
        execute=_create_playground,
        target_kind="playground",
        api_tokens=False,
        summarize=lambda p: (
            f"Copy playground {p.copy_from_playground_uuid}"
            if p.copy_from_playground_uuid
            else f'Create playground "{p.name}"'
        ),
        title="Create playground",
    ),
    ToolSpec(
        name="update_playground",
        description=(
            'Change a playground: name, description, HTML (replaces it), course link ("none" '
            "unlinks), published state or access_type. Send only what changes. Publishing and "
            "access changes need approval."
        ),
        params_model=UpdatePlaygroundParams,
        tier=ActionTier.EDIT,
        rights_bucket="playgrounds",
        access_action=AccessAction.UPDATE,
        execute=_update_playground,
        target_param="playground_uuid",
        target_kind="playground",
        api_tokens=False,
        approval_if=lambda p: p.published is not None or p.access_type is not None,
        idempotent=True,
        summarize=lambda p: "Update playground: "
        + ", ".join(p.model_dump(exclude={"playground_uuid"}, exclude_none=True) or ["nothing"]),
        title="Update playground",
    ),
    ToolSpec(
        name="set_playground_access",
        description=(
            "Grant or revoke a usergroup's access to a playground. It only matters for "
            "restricted playgrounds. Needs approval."
        ),
        params_model=SetPlaygroundAccessParams,
        tier=ActionTier.EDIT,
        rights_bucket="playgrounds",
        access_action=AccessAction.UPDATE,
        execute=_set_playground_access,
        target_param="playground_uuid",
        target_kind="playground",
        api_tokens=False,
        approval=True,
        idempotent=True,
        summarize=lambda p: (
            f"{'Grant' if p.grant else 'Revoke'} usergroup {p.usergroup_uuid} access to playground"
        ),
        title="Set playground access",
    ),
    ToolSpec(
        name="delete_playground",
        description="Permanently delete a playground and its usergroup access.",
        params_model=DeletePlaygroundParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="playgrounds",
        access_action=AccessAction.DELETE,
        execute=_delete_playground,
        target_param="playground_uuid",
        target_kind="playground",
        api_tokens=False,
        summarize=lambda p: f"Delete playground {p.playground_uuid}",
        title="Delete playground",
    ),
]
