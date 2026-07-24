"""Access control for assignment *submission* files.

Submission files live under a course-content path
(``orgs/{org}/courses/{course}/activities/{act}/assignments/{asgn}/tasks/{task}/subs/{file}``)
and would otherwise be served by the generic activity-content grant — which
allows any org member (or anyone at all on a public course) to download them.
That is an IDOR: one learner could read another learner's submitted work.

These helpers detect the submission sub-path and restrict access to the
submission's owner or a course instructor.
"""

from fastapi import HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.assignments import AssignmentTask, AssignmentTaskSubmission
from src.db.courses.courses import Course
from src.db.users import AnonymousUser, APITokenUser

# Keys under which a FILE_SUBMISSION task_submission stores the uploaded
# filename. The web client saves it as ``fileUUID`` (the on-disk name returned
# by the upload endpoint); the others are defensive aliases.
_SUBMISSION_FILE_KEYS = ("fileUUID", "file_uuid", "file_name", "fileName")


def _submission_references_file(task_submission, filename: str) -> bool:
    """True iff the submission's stored filename field EQUALS ``filename``.

    Equality on the specific field (not substring containment on the whole JSON)
    is deliberate: a substring match would let a learner whose submission text
    merely *contains* another learner's filename download that other file.
    """
    if not isinstance(task_submission, dict):
        return False
    return any(task_submission.get(k) == filename for k in _SUBMISSION_FILE_KEYS)


def is_submission_file(parts: list[str]) -> bool:
    """True when the split path points at an assignment submission file."""
    return (
        len(parts) >= 12
        and parts[0] == "orgs"
        and parts[2] == "courses"
        and parts[4] == "activities"
        and parts[6] == "assignments"
        and parts[8] == "tasks"
        and parts[10] == "subs"
    )


async def enforce_submission_file_access(
    parts: list[str],
    current_user,
    db_session: AsyncSession,
    request: Request | None = None,
) -> None:
    """Raise 401/403 unless the caller may read this submission file.

    Allowed: a course instructor (course UPDATE right), or the student who owns a
    submission referencing this exact file. Everyone else — including anonymous
    users and other enrolled learners — is denied. Assumes ``is_submission_file``
    already matched ``parts``.
    """
    course_uuid = parts[3]
    assignment_task_uuid = parts[9]
    filename = parts[-1]

    course = (await db_session.execute(
        select(Course).where(Course.course_uuid == course_uuid)
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=403, detail="Access denied")

    # Submission files are never public — authentication is always required.
    if isinstance(current_user, AnonymousUser) or getattr(current_user, "id", None) is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    # An API token must never reach the identity checks below: its ``.id`` is the
    # token's own primary key, not a user id, so the owner query
    # (``user_id == current_user.id``) and the RBAC subject would both treat it
    # as a same-numbered learner — letting a token read another user's submission
    # file, across orgs. There is no token-integration use case for downloading
    # raw submission files, so deny outright.
    if isinstance(current_user, APITokenUser):
        raise HTTPException(status_code=403, detail="Access denied")

    # Instructors / authors (course UPDATE right) may view any submission.
    if request is not None:
        from src.security.rbac import (
            authorization_verify_based_on_roles,
        )

        try:
            if await authorization_verify_based_on_roles(
                request, current_user.id, "update", course.course_uuid, db_session
            ):
                return
        except Exception:
            # Fall through to the owner check on any RBAC lookup error.
            pass

    # Otherwise the caller must own a submission that references this exact file.
    task = (await db_session.execute(
        select(AssignmentTask).where(
            AssignmentTask.assignment_task_uuid == assignment_task_uuid
        )
    )).scalars().first()
    if task is not None and filename:
        submissions = (await db_session.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.assignment_task_id == task.id,
                AssignmentTaskSubmission.user_id == current_user.id,
            )
        )).scalars().all()
        for sub in submissions:
            if _submission_references_file(sub.task_submission, filename):
                return

    raise HTTPException(status_code=403, detail="Access denied")
