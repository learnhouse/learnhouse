"""What a visitor leaves behind, and what the next refresh does about it.

Every visitor to the demo is an admin of it, so this is the surface that keeps
one prospect's mess — and one prospect's identity — out of the next prospect's
session. The passes here are the ones the generic uuid sweep cannot reach:
their tables hang off a parent rather than carrying an org_id.
"""

from datetime import date, datetime

import pytest
from sqlalchemy import func, select

from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.services.demo.sync import sync_demo

EPOCH_DAY = date(2026, 8, 9)


@pytest.fixture
def no_uploads(monkeypatch):
    from src.services.demo import sync as sync_module

    async def _fake_upload(**kwargs):
        return sync_module._upload_name(
            uuid=kwargs["uuid"],
            directory=kwargs["directory"],
            name=kwargs["name"],
            version=kwargs.get("version", ""),
        )

    monkeypatch.setattr(sync_module, "_upload", _fake_upload)


@pytest.fixture
async def synced(db, no_uploads):
    await sync_demo(db, today=EPOCH_DAY)


@pytest.fixture
async def demo_org(db, synced):
    return (
        await db.execute(select(Organization).where(Organization.is_demo.is_(True)))
    ).scalars().first()


@pytest.fixture
async def visitor(db, demo_org):
    """A real person who opened the demo, and is therefore an admin of it."""
    now = str(datetime.now())
    user = User(
        id=909,
        username="prospect",
        first_name="Pro",
        last_name="Spect",
        email="prospect@example.com",
        password="hashed",
        user_uuid="user_prospect909",
        signup_method="email",
        creation_date=now,
        update_date=now,
    )
    db.add(user)
    await db.flush()
    db.add(
        UserOrganization(
            user_id=user.id,
            org_id=demo_org.id,
            role_id=ADMIN_ROLE_ID,
            creation_date=now,
            update_date=now,
        )
    )
    await db.commit()
    return user


# ---------------------------------------------------------------------------
# org-scoped tables the bundle never writes to
# ---------------------------------------------------------------------------

async def test_audit_events_and_versions_and_tokens_are_swept(db, demo_org, visitor):
    """The sync creates none of these, so every row is a visitor's.

    Activity versions matter most: the refresh puts activity content back, but
    each intermediate version a visitor saved was kept — carrying their name
    and a one-click restore of the edit that was just undone.
    """
    from src.db.ai.generations import AIGeneration, AIGenerationKind
    from src.db.courses.activity_versions import ActivityVersion
    from src.db.media.media_share_token import MediaShareToken
    from src.db.user_audit_events import UserAuditEvent

    activity_id = (
        await db.execute(select(Course.id).where(Course.org_id == demo_org.id).limit(1))
    ).scalars().first()

    db.add(UserAuditEvent(user_id=visitor.id, org_id=demo_org.id, event_type="login"))
    db.add(
        ActivityVersion(
            activity_id=activity_id,
            org_id=demo_org.id,
            version_number=1,
            content={"tampered": True},
        )
    )
    db.add(
        AIGeneration(
            org_id=demo_org.id,
            user_id=visitor.id,
            kind=AIGenerationKind.IMAGE,
            prompt="a picture of a visitor's dog",
            result={},
            ai_generation_uuid="aigen_visitor",
            creation_date="2026-08-09",
            update_date="2026-08-09",
        )
    )
    db.add(
        MediaShareToken(
            org_id=demo_org.id,
            token="tok_visitor",
            media_uuid="media_visitor",
            creation_date="2026-08-09",
            update_date="2026-08-09",
        )
    )
    await db.commit()

    stats = await sync_demo(db, today=EPOCH_DAY)

    for model in (UserAuditEvent, ActivityVersion, AIGeneration, MediaShareToken):
        left = (
            await db.execute(
                select(func.count()).select_from(model).where(model.org_id == demo_org.id)
            )
        ).scalar_one()
        assert left == 0, f"{model.__name__} rows survived the refresh"

    assert stats.drift_deleted >= 4


async def test_a_custom_role_is_removed_and_its_holders_reassigned(db, demo_org, visitor):
    """role_id has no ON DELETE, so the memberships have to move first.

    Otherwise the DELETE raises and takes the whole sync transaction with it —
    and would keep doing so on every refresh afterwards.
    """
    from src.db.roles import Role, RoleTypeEnum

    role = Role(
        id=501,
        name="Visitor's role",
        org_id=demo_org.id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_visitor_made",
        rights={},
        creation_date="2026-08-09",
        update_date="2026-08-09",
    )
    db.add(role)
    await db.flush()

    membership = (
        await db.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == visitor.id,
                UserOrganization.org_id == demo_org.id,
            )
        )
    ).scalars().first()
    membership.role_id = role.id
    db.add(membership)
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)

    assert (
        await db.execute(select(Role).where(Role.role_uuid == "role_visitor_made"))
    ).scalars().first() is None

    await db.refresh(membership)
    assert membership.role_id == ADMIN_ROLE_ID, "the visitor should keep admin"


async def test_a_role_still_held_outside_the_demo_is_left_alone(
    db, demo_org, visitor, other_org
):
    """Deleting it would abort the sync, and reassigning is not ours to do.

    update_user_role resolves a role by uuid with no org scoping, so a demo
    role can end up held by a membership in someone else's organization. The
    sync must never write outside the demo org, so the row is left and logged.
    """
    from src.db.roles import Role, RoleTypeEnum

    role = Role(
        id=502,
        name="Escaped role",
        org_id=demo_org.id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_escaped",
        rights={},
        creation_date="2026-08-09",
        update_date="2026-08-09",
    )
    db.add(role)
    await db.flush()
    db.add(
        UserOrganization(
            user_id=visitor.id,
            org_id=other_org.id,  # a different, real organization
            role_id=role.id,
            creation_date="2026-08-09",
            update_date="2026-08-09",
        )
    )
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)  # must not raise

    survivor = (
        await db.execute(select(Role).where(Role.role_uuid == "role_escaped"))
    ).scalars().first()
    assert survivor is not None


async def test_library_root_entries_are_swept(db, demo_org):
    """The bundle files every course inside a section, never at the root.

    Left alone, a visitor could pin a copy of a bundle course to the library
    root and it would sit beside the real one for good.
    """
    from src.db.folders.folder_content import FolderContent

    course = (
        await db.execute(select(Course).where(Course.org_id == demo_org.id).limit(1))
    ).scalars().first()

    db.add(
        FolderContent(
            folder_id=None,
            resource_uuid=course.course_uuid,
            org_id=demo_org.id,
            position=0,
            creation_date="2026-08-09",
            update_date="2026-08-09",
        )
    )
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)

    left = (
        await db.execute(
            select(func.count())
            .select_from(FolderContent)
            .where(
                FolderContent.org_id == demo_org.id,
                FolderContent.folder_id.is_(None),
            )
        )
    ).scalar_one()
    assert left == 0


# ---------------------------------------------------------------------------
# votes and reactions
# ---------------------------------------------------------------------------

async def test_votes_and_reactions_are_swept(db, demo_org, visitor):
    """The bundle seeds none of these — upvote counts are a column, not rows.

    They hang off a discussion, a comment or a playground rather than carrying
    an org_id, and their parents are bundle-owned and survive every refresh, so
    nothing else would ever remove them. The reactions API returns the reacting
    user's username, real name and avatar.
    """
    from src.db.communities.discussion_comment_votes import DiscussionCommentVote
    from src.db.communities.discussion_comments import DiscussionComment
    from src.db.communities.discussion_reactions import DiscussionReaction
    from src.db.communities.discussion_votes import DiscussionVote
    from src.db.communities.discussions import Discussion
    from src.db.playground_reactions import PlaygroundReaction
    from src.db.playgrounds import Playground

    discussion = (await db.execute(select(Discussion).limit(1))).scalars().first()
    comment = (await db.execute(select(DiscussionComment).limit(1))).scalars().first()
    playground = (
        await db.execute(select(Playground).where(Playground.org_id == demo_org.id).limit(1))
    ).scalars().first()

    db.add(
        DiscussionVote(
            discussion_id=discussion.id, user_id=visitor.id,
            vote_uuid="vote_v", creation_date="2026-08-09",
        )
    )
    db.add(
        DiscussionReaction(
            discussion_id=discussion.id, user_id=visitor.id, emoji="🔥",
            reaction_uuid="reaction_v", creation_date="2026-08-09",
        )
    )
    db.add(
        DiscussionCommentVote(
            comment_id=comment.id, user_id=visitor.id,
            vote_uuid="cvote_v", creation_date="2026-08-09",
        )
    )
    db.add(
        PlaygroundReaction(
            playground_id=playground.id, user_id=visitor.id, emoji="👏",
            reaction_uuid="preaction_v", creation_date="2026-08-09",
        )
    )
    await db.commit()

    stats = await sync_demo(db, today=EPOCH_DAY)

    for model in (
        DiscussionVote, DiscussionReaction, DiscussionCommentVote, PlaygroundReaction
    ):
        left = (await db.execute(select(func.count()).select_from(model))).scalar_one()
        assert left == 0, f"{model.__name__} survived the refresh"

    assert stats.drift_deleted >= 4


# ---------------------------------------------------------------------------
# a visitor's own learning history
# ---------------------------------------------------------------------------

async def test_a_visitors_submissions_and_certificate_are_removed(db, demo_org, visitor):
    """Otherwise the next prospect reads it, under a real person's name.

    Everyone here is an admin, so a visitor's submissions show up in the
    grading inbox and their certificate in the certificate list.
    """
    from src.db.courses.assignments import (
        Assignment,
        AssignmentUserSubmission,
        AssignmentUserSubmissionStatus,
    )
    from src.db.courses.certifications import CertificateUser, Certifications
    from src.db.user_activity import UserActivityDay

    assignment = (
        await db.execute(select(Assignment).where(Assignment.org_id == demo_org.id).limit(1))
    ).scalars().first()
    certification = (await db.execute(select(Certifications).limit(1))).scalars().first()

    db.add(
        AssignmentUserSubmission(
            assignment_id=assignment.id,
            user_id=visitor.id,
            assignmentusersubmission_uuid="aus_visitor",
            submission_status=AssignmentUserSubmissionStatus.SUBMITTED,
            grade=0,
            creation_date="2026-08-09",
            update_date="2026-08-09",
        )
    )
    db.add(
        CertificateUser(
            user_id=visitor.id,
            certification_id=certification.id,
            user_certification_uuid="ucert_visitor",
            creation_date="2026-08-09",
            update_date="2026-08-09",
        )
    )
    db.add(
        UserActivityDay(
            org_id=demo_org.id,
            user_id=visitor.id,
            activity_date=EPOCH_DAY,
        )
    )
    await db.commit()

    await sync_demo(db, today=EPOCH_DAY)

    for model in (AssignmentUserSubmission, CertificateUser, UserActivityDay):
        left = (
            await db.execute(
                select(func.count()).select_from(model).where(model.user_id == visitor.id)
            )
        ).scalar_one()
        assert left == 0, f"{model.__name__} survived for a visitor"

    # The seeded learners keep theirs — this sweep is not a purge.
    seeded = (
        await db.execute(select(func.count()).select_from(CertificateUser))
    ).scalar_one()
    assert seeded > 0
