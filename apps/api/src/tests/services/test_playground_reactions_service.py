from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from src.db.playground_reactions import PlaygroundReaction
from src.db.playgrounds import Playground, PlaygroundAccessType
from src.db.users import AnonymousUser, PublicUser, User
from src.services.playgrounds.playground_reactions import (
    get_playground_reactions,
    toggle_playground_reaction,
)


@pytest.fixture
async def playground(db):
    item = Playground(
        name="Playground",
        description="Desc",
        playground_uuid="playground_1",
        access_type=PlaygroundAccessType.PUBLIC,
        published=True,
        org_id=1,
        created_by=1,
        creation_date="now",
        update_date="now",
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@pytest.fixture
async def reactor(db):
    user = User(
        username="reactor",
        first_name="Re",
        last_name="Actor",
        email="reactor@example.com",
        user_uuid="user_reactor",
        creation_date="now",
        update_date="now",
    )
    other = User(
        username="other",
        first_name="Ot",
        last_name="Her",
        email="other@example.com",
        user_uuid="user_other",
        creation_date="now",
        update_date="now",
    )
    db.add(user)
    db.add(other)
    await db.commit()
    await db.refresh(user)
    await db.refresh(other)
    return user, other


@pytest.mark.asyncio
async def test_get_playground_reactions_groups_users_and_flags_current_user(
    db, playground, reactor
):
    current_user, other_user = reactor
    db.add(
        PlaygroundReaction(
            playground_id=playground.id,
            user_id=current_user.id,
            emoji=":+1:",
            reaction_uuid="reaction_1",
            creation_date="now",
        )
    )
    db.add(
        PlaygroundReaction(
            playground_id=playground.id,
            user_id=other_user.id,
            emoji=":+1:",
            reaction_uuid="reaction_2",
            creation_date="now",
        )
    )
    db.add(
        PlaygroundReaction(
            playground_id=playground.id,
            user_id=other_user.id,
            emoji=":fire:",
            reaction_uuid="reaction_3",
            creation_date="now",
        )
    )
    await db.commit()

    with patch(
        "src.services.playgrounds.playground_reactions._check_read_access"
    ) as check_access:
        summaries = await get_playground_reactions(
            request=None,
            playground_uuid=playground.playground_uuid,
            current_user=PublicUser.model_validate(current_user),
            db_session=db,
        )

    check_access.assert_called_once()
    assert [summary.emoji for summary in summaries] == [":+1:", ":fire:"]
    assert summaries[0].count == 2
    assert summaries[0].has_reacted is True
    assert {user.username for user in summaries[0].users} == {"reactor", "other"}
    assert summaries[1].has_reacted is False


@pytest.mark.asyncio
async def test_get_playground_reactions_handles_missing_playground_and_anonymous(
    db, playground, reactor
):
    _, other_user = reactor
    db.add(
        PlaygroundReaction(
            playground_id=playground.id,
            user_id=other_user.id,
            emoji=":+1:",
            reaction_uuid="reaction_1",
            creation_date="now",
        )
    )
    await db.commit()

    with patch("src.services.playgrounds.playground_reactions._check_read_access"):
        summaries = await get_playground_reactions(
            request=None,
            playground_uuid=playground.playground_uuid,
            current_user=AnonymousUser(),
            db_session=db,
        )

    assert summaries[0].has_reacted is False

    with pytest.raises(HTTPException, match="Playground not found"):
        await get_playground_reactions(
            request=None,
            playground_uuid="missing",
            current_user=AnonymousUser(),
            db_session=db,
        )


@pytest.mark.asyncio
async def test_toggle_playground_reaction_adds_and_removes(db, playground, reactor):
    current_user, _ = reactor

    with patch("src.services.playgrounds.playground_reactions._check_read_access"):
        added = await toggle_playground_reaction(
            request=None,
            playground_uuid=playground.playground_uuid,
            emoji=":+1:",
            current_user=PublicUser.model_validate(current_user),
            db_session=db,
        )
        removed = await toggle_playground_reaction(
            request=None,
            playground_uuid=playground.playground_uuid,
            emoji=":+1:",
            current_user=PublicUser.model_validate(current_user),
            db_session=db,
        )

    assert added == {"action": "added", "emoji": ":+1:"}
    assert removed == {"action": "removed", "emoji": ":+1:"}


@pytest.mark.asyncio
async def test_toggle_playground_reaction_concurrent_duplicate_is_idempotent(
    db, playground, reactor
):
    """Lines 127, 132: a concurrent duplicate insert raises IntegrityError on
    commit; the guard rolls back and still reports the reaction as added
    (idempotent) instead of surfacing a 500."""
    current_user, _ = reactor

    real_commit = db.commit
    real_rollback = db.rollback
    rollback_calls = {"count": 0}

    async def _raising_commit():
        # Simulate the unique-constraint violation from a racing insert.
        raise IntegrityError("INSERT", {}, Exception("duplicate key"))

    async def _tracking_rollback():
        rollback_calls["count"] += 1
        await real_rollback()

    with patch("src.services.playgrounds.playground_reactions._check_read_access"), \
        patch.object(db, "commit", AsyncMock(side_effect=_raising_commit)), \
        patch.object(db, "rollback", AsyncMock(side_effect=_tracking_rollback)):
        result = await toggle_playground_reaction(
            request=None,
            playground_uuid=playground.playground_uuid,
            emoji=":+1:",
            current_user=PublicUser.model_validate(current_user),
            db_session=db,
        )

    assert result == {"action": "added", "emoji": ":+1:"}
    assert rollback_calls["count"] == 1

    # Restore the real session methods for any later teardown.
    db.commit = real_commit
    db.rollback = real_rollback


@pytest.mark.asyncio
async def test_toggle_playground_reaction_rejects_anonymous_and_missing_playground(db):
    with pytest.raises(HTTPException, match="Authentication required"):
        await toggle_playground_reaction(
            request=None,
            playground_uuid="playground_1",
            emoji=":+1:",
            current_user=AnonymousUser(),
            db_session=db,
        )

    with pytest.raises(HTTPException, match="Playground not found"):
        await toggle_playground_reaction(
            request=None,
            playground_uuid="missing",
            emoji=":+1:",
            current_user=PublicUser(
                id=99,
                user_uuid="user_99",
                username="user99",
                first_name="User",
                last_name="NinetyNine",
                email="user99@example.com",
            ),
            db_session=db,
        )
