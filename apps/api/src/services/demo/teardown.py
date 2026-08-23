"""Remove the demo organization completely.

Most of what the demo owns is reached by the ``ON DELETE CASCADE`` on the
organization foreign key, which ``test_demo_teardown`` proves table by table.
This module exists for the three things that cascade cannot reach:

* the seeded students, who are ``User`` rows and belong to no organization;
* ``ResourceAuthor``, which references content by a bare uuid string with no
  foreign key at all;
* uploaded files, which are not in the database.

It lives here rather than in ``cli.py`` so it can be tested against a session
instead of only against a live deployment.
"""

import logging

from sqlalchemy import delete, select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.db.demo_state import DEMO_STATE_ID, DemoState
from src.db.organizations import Organization
from src.db.podcasts.podcasts import Podcast
from src.db.resource_authors import ResourceAuthor
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.services.demo import flags

logger = logging.getLogger(__name__)


async def teardown_demo(db_session: AsyncSession) -> list[str]:
    """Delete every demo organization and everything belonging to it.

    Returns one human-readable line per organization removed. Does not commit —
    the caller owns the transaction.
    """
    from src.services.courses.transfer.storage_utils import delete_storage_directory

    orgs = (
        await db_session.execute(
            select(Organization).where(Organization.is_demo.is_(True))
        )
    ).scalars().all()

    removed: list[str] = []

    for org in orgs:
        # Collect the students before deleting the org: their membership rows
        # are what identifies them, and the cascade removes those.
        students = (
            await db_session.execute(
                select(User.id, User.user_uuid)
                .join(UserOrganization, UserOrganization.user_id == User.id)
                .where(
                    UserOrganization.org_id == org.id,
                    User.signup_method == flags.DEMO_SIGNUP_METHOD,
                )
            )
        ).all()
        student_ids = [row[0] for row in students]
        student_uuids = [row[1] for row in students]

        # ResourceAuthor points at content by a bare uuid string with no foreign
        # key, so the org cascade cannot reach it. Rows written for demo
        # students go with those students, but a visitor who authored something
        # here is a real user who survives teardown, and their row would be left
        # pointing at a course that no longer exists.
        authored_uuids = list(
            (
                await db_session.execute(
                    select(Course.course_uuid).where(Course.org_id == org.id)
                )
            ).scalars().all()
        ) + list(
            (
                await db_session.execute(
                    select(Podcast.podcast_uuid).where(Podcast.org_id == org.id)
                )
            ).scalars().all()
        )
        if authored_uuids:
            await db_session.execute(
                delete(ResourceAuthor).where(
                    ResourceAuthor.resource_uuid.in_(authored_uuids)
                )
            )

        await db_session.delete(org)
        await db_session.flush()

        if student_ids:
            await db_session.execute(delete(User).where(User.id.in_(student_ids)))

        # Uploaded files are not in the database: course media and org branding
        # sit under the org, avatars under each student. Without this every
        # teardown leaves the lot behind, and the next provision writes it all
        # again beside the orphans.
        _delete_files(delete_storage_directory, f"content/orgs/{org.org_uuid}")
        for user_uuid in student_uuids:
            _delete_files(delete_storage_directory, f"content/users/{user_uuid}")

        removed.append(
            f"Removed demo org /{org.slug}, {len(student_ids)} students "
            f"and their uploaded files"
        )

    await db_session.execute(delete(DemoState).where(DemoState.id == DEMO_STATE_ID))

    return removed


def _delete_files(delete_storage_directory, path: str) -> None:
    """Storage failures must not abort a teardown that has already deleted rows.

    The database work is committed by the caller; if the bucket is unreachable
    the right outcome is a logged warning and orphaned files, not a half-torn
    org that the next provision then collides with.
    """
    try:
        delete_storage_directory(path)
    except Exception:
        logger.warning("Demo teardown could not remove %s", path, exc_info=True)
