"""Play activities (``TYPE_PLAY``): a course activity that runs one
step-by-step Play of the organization, linked by ``content.playground_uuid``.

Plays are an Enterprise feature: the play itself, its access rules and its
player live in EE (``ee.services.playgrounds.course_activity``). Core only
stores the link and checks it when an activity is created or relinked;
without EE no play activity can be made.
"""

from fastapi import HTTPException, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.ee_hooks import get_ee_module
from src.db.courses.activities import ActivitySubTypeEnum, ActivityTypeEnum

PLAY_LINK_KEY = "playground_uuid"


def is_play_type(activity_type) -> bool:
    return getattr(activity_type, "value", activity_type) == ActivityTypeEnum.TYPE_PLAY.value


async def play_activity_content(
    request: Request,
    content: dict | None,
    org_id: int,
    current_user,
    db_session: AsyncSession,
) -> dict:
    """The stored content of a play activity linking ``content.playground_uuid``.

    403 without Enterprise, 400 without a play uuid; EE then checks the play
    is a step play of ``org_id`` the caller can open, with Plays available.
    """
    module = get_ee_module("ee.services.playgrounds.course_activity")
    if module is None:
        raise HTTPException(status_code=403, detail="Play activities need LearnHouse Enterprise")
    uuid = (content or {}).get(PLAY_LINK_KEY)
    if not isinstance(uuid, str) or not uuid.strip():
        raise HTTPException(status_code=400, detail="A play activity needs content.playground_uuid")
    playground = await module.resolve_play_for_course(request, org_id, uuid.strip(), current_user, db_session)
    return {PLAY_LINK_KEY: playground.playground_uuid}


async def play_is_available(activity, db_session: AsyncSession) -> bool:
    """Whether learners can run the play a play activity links: Enterprise is
    there, Plays are available to the org (license, plan, feature on) and the
    play exists in the org. When not, the activity can't hold learners back:
    they mark it complete themselves."""
    module = get_ee_module("ee.services.playgrounds.course_activity")
    if module is None:
        return False
    return await module.play_activity_playable(activity, db_session)


PLAY_SUBTYPE = ActivitySubTypeEnum.SUBTYPE_PLAY
