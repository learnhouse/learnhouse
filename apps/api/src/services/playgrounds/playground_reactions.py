from typing import List, Union
from uuid import uuid4
from datetime import datetime, timezone
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from fastapi import HTTPException, Request

from src.db.users import PublicUser, AnonymousUser, User
from src.db.playgrounds import Playground
from src.db.playground_reactions import (
    PlaygroundReaction,
    PlaygroundReactionSummary,
    ReactionUser,
)
from src.security.auth import resolve_acting_user_id
from src.services.playgrounds.playgrounds import _check_read_access


async def get_playground_reactions(
    request: Request,
    playground_uuid: str,
    current_user: Union[PublicUser, AnonymousUser],
    db_session: AsyncSession,
) -> List[PlaygroundReactionSummary]:
    playground = (await db_session.execute(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    )).scalars().first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    await _check_read_access(playground, current_user, db_session)

    # Resolve the real user id: an API token's .id is the token id, not a user
    # id, so comparing it against reaction.user_id would yield a wrong
    # has_reacted flag.
    viewer_user_id = (
        None
        if isinstance(current_user, AnonymousUser)
        else resolve_acting_user_id(current_user)
    )

    reactions = (await db_session.execute(
        select(PlaygroundReaction).where(
            PlaygroundReaction.playground_id == playground.id
        )
    )).scalars().all()

    emoji_groups: dict = {}
    for reaction in reactions:
        emoji_groups.setdefault(reaction.emoji, []).append(reaction)

    summaries = []
    for emoji, emoji_reactions in emoji_groups.items():
        user_ids = [r.user_id for r in emoji_reactions]
        users = (await db_session.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()  # type: ignore
        user_list = [
            ReactionUser(
                id=u.id,
                user_uuid=u.user_uuid,
                username=u.username,
                first_name=u.first_name,
                last_name=u.last_name,
                avatar_image=u.avatar_image,
            )
            for u in users
        ]
        has_reacted = viewer_user_id is not None and viewer_user_id in user_ids
        summaries.append(
            PlaygroundReactionSummary(
                emoji=emoji,
                count=len(emoji_reactions),
                users=user_list,
                has_reacted=has_reacted,
            )
        )

    summaries.sort(key=lambda x: x.count, reverse=True)
    return summaries


async def toggle_playground_reaction(
    request: Request,
    playground_uuid: str,
    emoji: str,
    current_user: Union[PublicUser, AnonymousUser],
    db_session: AsyncSession,
) -> dict:
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    playground = (await db_session.execute(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    )).scalars().first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    await _check_read_access(playground, current_user, db_session)

    # An API token's .id is the token id, not a user id; reaction.user_id is a FK
    # to user.id, so we must record/match against the real acting user.
    acting_user_id = resolve_acting_user_id(current_user)

    existing = (await db_session.execute(
        select(PlaygroundReaction).where(
            PlaygroundReaction.playground_id == playground.id,
            PlaygroundReaction.user_id == acting_user_id,
            PlaygroundReaction.emoji == emoji,
        )
    )).scalars().first()

    if existing:
        await db_session.delete(existing)
        await db_session.commit()
        return {"action": "removed", "emoji": emoji}

    reaction = PlaygroundReaction(
        playground_id=playground.id,
        user_id=acting_user_id,
        emoji=emoji,
        reaction_uuid=f"reaction_{uuid4()}",
        creation_date=str(datetime.now(timezone.utc).replace(tzinfo=None)),
    )
    db_session.add(reaction)
    try:
        await db_session.commit()
    except IntegrityError:
        # Concurrent duplicate insert (e.g. rapid double-click) violates the
        # (playground_id, user_id, emoji) unique constraint. Without this guard
        # the request fails with an unhandled 500; treat it as an idempotent
        # "already added" instead.
        await db_session.rollback()
    return {"action": "added", "emoji": emoji}
