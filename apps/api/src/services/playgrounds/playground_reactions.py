from typing import List, Union
from uuid import uuid4
from datetime import datetime
from sqlmodel import Session, select
from fastapi import HTTPException, Request

from src.db.users import PublicUser, AnonymousUser, User
from src.db.playgrounds import Playground
from src.db.playground_reactions import (
    PlaygroundReaction,
    PlaygroundReactionSummary,
    ReactionUser,
)
from src.services.playgrounds.playgrounds import _check_read_access


async def get_playground_reactions(
    request: Request,
    playground_uuid: str,
    current_user: Union[PublicUser, AnonymousUser],
    db_session: Session,
) -> List[PlaygroundReactionSummary]:
    playground = db_session.exec(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    ).first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    _check_read_access(playground, current_user, db_session)

    reactions = db_session.exec(
        select(PlaygroundReaction).where(
            PlaygroundReaction.playground_id == playground.id
        )
    ).all()

    emoji_groups: dict = {}
    for reaction in reactions:
        emoji_groups.setdefault(reaction.emoji, []).append(reaction)

    summaries = []
    for emoji, emoji_reactions in emoji_groups.items():
        user_ids = [r.user_id for r in emoji_reactions]
        users = db_session.exec(select(User).where(User.id.in_(user_ids))).all()  # type: ignore
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
        has_reacted = (
            current_user.id in user_ids
            if not isinstance(current_user, AnonymousUser)
            else False
        )
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
    db_session: Session,
) -> dict:
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")

    playground = db_session.exec(
        select(Playground).where(Playground.playground_uuid == playground_uuid)
    ).first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    _check_read_access(playground, current_user, db_session)

    existing = db_session.exec(
        select(PlaygroundReaction).where(
            PlaygroundReaction.playground_id == playground.id,
            PlaygroundReaction.user_id == current_user.id,
            PlaygroundReaction.emoji == emoji,
        )
    ).first()

    if existing:
        db_session.delete(existing)
        db_session.commit()
        return {"action": "removed", "emoji": emoji}

    reaction = PlaygroundReaction(
        playground_id=playground.id,
        user_id=current_user.id,
        emoji=emoji,
        reaction_uuid=f"reaction_{uuid4()}",
        creation_date=str(datetime.utcnow()),
    )
    db_session.add(reaction)
    db_session.commit()
    return {"action": "added", "emoji": emoji}
