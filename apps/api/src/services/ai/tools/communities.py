"""Community tools — communities, discussions, comments, moderation.

Every tool wraps an existing service function in-process, passing
`ctx.request` / `ctx.user` / `ctx.db_session` so the services' own RBAC
checks stay authoritative. Params models are curated subsets of the
service schemas — enough for an agent, nothing internal.
"""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field

from src.db.communities.communities import CommunityCreate, CommunityUpdate
from src.db.communities.discussions import DiscussionUpdate
from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.communities.comments import create_comment
from src.services.communities.communities import (
    create_community,
    delete_community,
    get_communities_by_org,
    get_community,
    link_community_to_course,
    unlink_community_from_course,
    update_community,
)
from src.services.communities.discussions import (
    DiscussionSortBy,
    create_discussion,
    delete_discussion,
    get_discussions_by_community,
    lock_discussion,
    pin_discussion,
    update_discussion,
)

DiscussionLabel = Literal["general", "question", "idea", "announcement", "showcase"]


def _compact_community(community) -> dict:
    data = jsonable(community)
    keep = (
        "community_uuid",
        "name",
        "description",
        "public",
        "course_id",
        "update_date",
    )
    out = {k: data.get(k) for k in keep if k in data}
    desc = out.get("description")
    if isinstance(desc, str) and len(desc) > 280:
        out["description"] = desc[:280] + "…"
    return out


def _compact_discussion(discussion) -> dict:
    data = jsonable(discussion)
    keep = (
        "discussion_uuid",
        "title",
        "content",
        "label",
        "emoji",
        "upvote_count",
        "is_pinned",
        "is_locked",
        "creation_date",
    )
    out = {k: data.get(k) for k in keep if k in data}
    content = out.get("content")
    if isinstance(content, str) and len(content) > 280:
        out["content"] = content[:280] + "…"
    author = data.get("author")
    if isinstance(author, dict):
        out["author"] = author.get("username")
    return out


# ─── params ────────────────────────────────────────────────────────────────


class ListCommunitiesParams(BaseModel):
    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=50)


class GetCommunityParams(BaseModel):
    community_uuid: str


class CreateCommunityParams(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str = ""
    public: bool = True


class UpdateCommunityParams(BaseModel):
    community_uuid: str
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    public: bool | None = None
    moderation_words: list[str] | None = Field(
        None, description="Blocked words for content moderation (replaces the list)"
    )


class DeleteCommunityParams(BaseModel):
    community_uuid: str
    confirm: bool | None = None


class LinkCommunityCourseParams(BaseModel):
    community_uuid: str
    operation: Literal["link", "unlink"]
    course_uuid: str | None = Field(
        None, description="Required for 'link'; ignored for 'unlink'"
    )


class ListDiscussionsParams(BaseModel):
    community_uuid: str
    sort_by: Literal["recent", "upvotes", "hot"] = "recent"
    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=50)
    label: DiscussionLabel | None = Field(None, description="Filter by label")


class CreateDiscussionParams(BaseModel):
    community_uuid: str
    title: str = Field(..., min_length=1, max_length=300)
    content: str = Field(..., min_length=1)
    label: DiscussionLabel = "general"
    emoji: str | None = None


class ModerateDiscussionParams(BaseModel):
    discussion_uuid: str
    operation: Literal["pin", "unpin", "lock", "unlock", "edit"]
    title: str | None = Field(None, description="New title (operation='edit' only)")
    content: str | None = Field(None, description="New body (operation='edit' only)")
    label: DiscussionLabel | None = Field(
        None, description="New label (operation='edit' only)"
    )
    emoji: str | None = Field(
        None, description="New emoji, '' to clear (operation='edit' only)"
    )


class CreateCommentParams(BaseModel):
    discussion_uuid: str
    content: str = Field(..., min_length=1)


class DeleteDiscussionParams(BaseModel):
    discussion_uuid: str
    confirm: bool | None = None


# ─── executors ─────────────────────────────────────────────────────────────


async def _list_communities(ctx: ToolContext, p: ListCommunitiesParams):
    communities = await get_communities_by_org(
        ctx.request,
        ctx.org.id,
        ctx.user,
        ctx.db_session,
        page=p.page,
        limit=p.limit,
    )
    return [_compact_community(c) for c in communities]


async def _get_community(ctx: ToolContext, p: GetCommunityParams):
    community = await get_community(
        ctx.request, p.community_uuid, ctx.user, ctx.db_session
    )
    discussions = await get_discussions_by_community(
        ctx.request,
        p.community_uuid,
        ctx.user,
        ctx.db_session,
        sort_by=DiscussionSortBy.RECENT,
        page=1,
        limit=5,
    )
    return {
        "community": jsonable(community),
        "recent_discussions": [_compact_discussion(d) for d in discussions],
    }


async def _create_community(ctx: ToolContext, p: CreateCommunityParams):
    community = await create_community(
        ctx.request,
        ctx.org.id,
        CommunityCreate(
            name=p.name,
            description=p.description,
            public=p.public,
            org_id=ctx.org.id,
        ),
        ctx.user,
        ctx.db_session,
    )
    return jsonable(community)


async def _update_community(ctx: ToolContext, p: UpdateCommunityParams):
    patch = p.model_dump(exclude={"community_uuid"}, exclude_none=True)
    community = await update_community(
        ctx.request,
        p.community_uuid,
        CommunityUpdate(**patch),
        ctx.user,
        ctx.db_session,
    )
    return jsonable(community)


async def _delete_community(ctx: ToolContext, p: DeleteCommunityParams):
    return jsonable(
        await delete_community(ctx.request, p.community_uuid, ctx.user, ctx.db_session)
    )


async def _link_community_course(ctx: ToolContext, p: LinkCommunityCourseParams):
    if p.operation == "link":
        if not p.course_uuid:
            raise HTTPException(
                status_code=400, detail="course_uuid is required to link"
            )
        community = await link_community_to_course(
            ctx.request, p.community_uuid, p.course_uuid, ctx.user, ctx.db_session
        )
    else:
        community = await unlink_community_from_course(
            ctx.request, p.community_uuid, ctx.user, ctx.db_session
        )
    return _compact_community(community)


async def _list_discussions(ctx: ToolContext, p: ListDiscussionsParams):
    discussions = await get_discussions_by_community(
        ctx.request,
        p.community_uuid,
        ctx.user,
        ctx.db_session,
        sort_by=DiscussionSortBy(p.sort_by),
        page=p.page,
        limit=p.limit,
        label=p.label,
    )
    return [_compact_discussion(d) for d in discussions]


async def _create_discussion(ctx: ToolContext, p: CreateDiscussionParams):
    discussion = await create_discussion(
        ctx.request,
        p.community_uuid,
        p.title,
        p.content,
        p.label,
        ctx.user,
        ctx.db_session,
        emoji=p.emoji,
    )
    return _compact_discussion(discussion)


async def _moderate_discussion(ctx: ToolContext, p: ModerateDiscussionParams):
    if p.operation in ("pin", "unpin"):
        discussion = await pin_discussion(
            ctx.request,
            p.discussion_uuid,
            p.operation == "pin",
            ctx.user,
            ctx.db_session,
        )
    elif p.operation in ("lock", "unlock"):
        discussion = await lock_discussion(
            ctx.request,
            p.discussion_uuid,
            p.operation == "lock",
            ctx.user,
            ctx.db_session,
        )
    else:  # edit
        patch = p.model_dump(
            include={"title", "content", "label", "emoji"}, exclude_none=True
        )
        if not patch:
            raise HTTPException(
                status_code=400,
                detail="operation='edit' needs at least one of title/content/label/emoji",
            )
        discussion = await update_discussion(
            ctx.request,
            p.discussion_uuid,
            DiscussionUpdate(**patch),
            ctx.user,
            ctx.db_session,
        )
    return _compact_discussion(discussion)


async def _create_comment(ctx: ToolContext, p: CreateCommentParams):
    comment = await create_comment(
        ctx.request, p.discussion_uuid, p.content, ctx.user, ctx.db_session
    )
    data = jsonable(comment)
    keep = ("comment_uuid", "content", "creation_date")
    out = {k: data.get(k) for k in keep if k in data}
    author = data.get("author")
    if isinstance(author, dict):
        out["author"] = author.get("username")
    return out


async def _delete_discussion(ctx: ToolContext, p: DeleteDiscussionParams):
    return jsonable(
        await delete_discussion(
            ctx.request, p.discussion_uuid, ctx.user, ctx.db_session
        )
    )


# ─── specs ─────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_communities",
        description=(
            "List the organization's communities (paginated). Use this FIRST "
            "to resolve a community mentioned by name before acting on it."
        ),
        params_model=ListCommunitiesParams,
        tier=ActionTier.READ,
        rights_bucket="communities",
        access_action=AccessAction.READ,
        execute=_list_communities,
    ),
    ToolSpec(
        name="get_community",
        description=(
            "Get one community's full details by uuid, plus its 5 most "
            "recent discussions."
        ),
        params_model=GetCommunityParams,
        tier=ActionTier.READ,
        rights_bucket="communities",
        access_action=AccessAction.READ,
        execute=_get_community,
        target_param="community_uuid",
        target_kind="community",
    ),
    ToolSpec(
        name="create_community",
        description="Create a new community in the organization.",
        params_model=CreateCommunityParams,
        tier=ActionTier.CREATE,
        rights_bucket="communities",
        access_action=AccessAction.CREATE,
        execute=_create_community,
        target_kind="community",
        summarize=lambda p: f'Create community "{p.name}"',
    ),
    ToolSpec(
        name="update_community",
        description=(
            "Update community fields (name, description, visibility, "
            "moderation word list). Only send fields to change."
        ),
        params_model=UpdateCommunityParams,
        tier=ActionTier.EDIT,
        rights_bucket="communities",
        access_action=AccessAction.UPDATE,
        execute=_update_community,
        target_param="community_uuid",
        target_kind="community",
        summarize=lambda p: "Update community fields: "
        + ", ".join(
            p.model_dump(exclude={"community_uuid"}, exclude_none=True) or ["-"]
        ),
    ),
    ToolSpec(
        name="delete_community",
        description=(
            "Permanently delete a community and all its discussions. "
            "Irreversible."
        ),
        params_model=DeleteCommunityParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="communities",
        access_action=AccessAction.DELETE,
        execute=_delete_community,
        target_param="community_uuid",
        target_kind="community",
    ),
    ToolSpec(
        name="link_community_course",
        description=(
            "Link a community to a course (operation='link', needs "
            "course_uuid) or unlink it (operation='unlink'). A course can "
            "have at most one linked community."
        ),
        params_model=LinkCommunityCourseParams,
        tier=ActionTier.EDIT,
        rights_bucket="communities",
        access_action=AccessAction.UPDATE,
        execute=_link_community_course,
        target_param="community_uuid",
        target_kind="community",
        summarize=lambda p: (
            f"Link community to course {p.course_uuid}"
            if p.operation == "link"
            else "Unlink community from its course"
        ),
    ),
    ToolSpec(
        name="list_discussions",
        description=(
            "List a community's discussions (paginated; sort by recent/"
            "upvotes/hot, optional label filter). Pinned threads come first."
        ),
        params_model=ListDiscussionsParams,
        tier=ActionTier.READ,
        rights_bucket="discussions",
        access_action=AccessAction.READ,
        execute=_list_discussions,
        target_param="community_uuid",
        target_kind="community",
    ),
    ToolSpec(
        name="create_discussion",
        description=(
            "Post a new discussion thread in a community (title, body, "
            "label: general/question/idea/announcement/showcase)."
        ),
        params_model=CreateDiscussionParams,
        tier=ActionTier.CREATE,
        rights_bucket="discussions",
        access_action=AccessAction.CREATE,
        execute=_create_discussion,
        target_param="community_uuid",
        target_kind="community",
        summarize=lambda p: f'Post discussion "{p.title}"',
    ),
    ToolSpec(
        name="moderate_discussion",
        description=(
            "Moderate a discussion: operation='pin'/'unpin'/'lock'/'unlock' "
            "(moderators only), or 'edit' to change title/content/label/"
            "emoji (author or moderator; authors limited to 2 edits)."
        ),
        params_model=ModerateDiscussionParams,
        tier=ActionTier.EDIT,
        rights_bucket="discussions",
        access_action=AccessAction.UPDATE,
        execute=_moderate_discussion,
        target_param="discussion_uuid",
        target_kind="discussion",
        summarize=lambda p: f"{p.operation.capitalize()} discussion",
    ),
    ToolSpec(
        name="create_comment",
        description=(
            "Post a comment on a discussion. Fails if the discussion is "
            "locked."
        ),
        params_model=CreateCommentParams,
        tier=ActionTier.CREATE,
        rights_bucket="discussions",
        access_action=AccessAction.CREATE,
        execute=_create_comment,
        target_param="discussion_uuid",
        target_kind="discussion",
    ),
    ToolSpec(
        name="delete_discussion",
        description=(
            "Permanently delete a discussion and its comments (author or "
            "moderator). Irreversible."
        ),
        params_model=DeleteDiscussionParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="discussions",
        access_action=AccessAction.DELETE,
        execute=_delete_discussion,
        target_param="discussion_uuid",
        target_kind="discussion",
    ),
]
