from typing import Optional

from fastapi import APIRouter, Depends, Request, UploadFile, HTTPException
from pydantic import BaseModel
from src.db.courses.assignments import (
    AssignmentCreate,
    AssignmentRead,
    AssignmentTaskCreate,
    AssignmentTaskSubmissionUpdate,
    AssignmentTaskUpdate,
    AssignmentUpdate,
    AssignmentUserSubmissionCreate,
)
from src.db.users import PublicUser
from src.core.events.database import get_db_session
from src.security.auth import get_current_user
from src.services.courses.activities.assignments import (
    create_assignment,
    create_assignment_submission,
    create_assignment_task,
    delete_assignment,
    delete_assignment_from_activity_uuid,
    delete_assignment_submission,
    delete_assignment_task,
    delete_assignment_task_submission,
    get_assignments_from_course,
    get_grade_assignment_submission,
    grade_assignment_submission,
    handle_assignment_task_submission,
    mark_activity_as_done_for_user,
    put_assignment_task_reference_file,
    put_assignment_task_submission_file,
    read_assignment,
    read_assignment_from_activity_uuid,
    read_assignment_submissions,
    read_assignment_task,
    read_assignment_task_submissions,
    read_assignment_tasks,
    read_user_assignment_submissions,
    read_user_assignment_submissions_me,
    read_user_assignment_task_submissions,
    read_user_assignment_task_submissions_me,
    read_user_assignment_task_submissions_me_batch,
    update_assignment,
    update_assignment_submission,
    update_assignment_task,
)


class GradeSubmissionBody(BaseModel):
    """Optional body for the final-grade endpoint. Lets the instructor leave
    an overall feedback note at the same time they finalize the grade."""

    overall_feedback: Optional[str] = None


router = APIRouter()

## ASSIGNMENTS ##


@router.post(
    "/",
    response_model=AssignmentRead,
    summary="Create assignment",
    description="Create a new assignment attached to an activity. The authenticated user must have permission to edit the parent course.",
    responses={
        200: {"description": "Assignment created and returned.", "model": AssignmentRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to create assignments in this course"},
        404: {"description": "Parent activity or course not found"},
    },
)
async def api_create_assignments(
    request: Request,
    assignment_object: AssignmentCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> AssignmentRead:
    """
    Create new activity
    """
    return await create_assignment(request, assignment_object, current_user, db_session)


@router.get(
    "/{assignment_uuid}",
    response_model=AssignmentRead,
    summary="Get assignment",
    description="Read an assignment by its UUID.",
    responses={
        200: {"description": "Assignment returned.", "model": AssignmentRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this assignment"},
        404: {"description": "Assignment not found"},
    },
)
async def api_read_assignment(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> AssignmentRead:
    """
    Read an assignment
    """
    return await read_assignment(request, assignment_uuid, current_user, db_session)


@router.get(
    "/activity/{activity_uuid}",
    response_model=AssignmentRead,
    summary="Get assignment by activity",
    description="Read the assignment attached to a given activity UUID.",
    responses={
        200: {"description": "Assignment returned.", "model": AssignmentRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this assignment"},
        404: {"description": "Activity or assignment not found"},
    },
)
async def api_read_assignment_from_activity(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> AssignmentRead:
    """
    Read an assignment
    """
    return await read_assignment_from_activity_uuid(
        request, activity_uuid, current_user, db_session
    )


@router.put(
    "/{assignment_uuid}",
    response_model=AssignmentRead,
    summary="Update assignment",
    description="Update an assignment by its UUID. The authenticated user must have permission to edit the parent course.",
    responses={
        200: {"description": "Assignment updated and returned.", "model": AssignmentRead},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to update this assignment"},
        404: {"description": "Assignment not found"},
    },
)
async def api_update_assignment(
    request: Request,
    assignment_uuid: str,
    assignment_object: AssignmentUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
) -> AssignmentRead:
    """
    Update an assignment
    """
    return await update_assignment(
        request, assignment_uuid, assignment_object, current_user, db_session
    )


@router.delete(
    "/{assignment_uuid}",
    summary="Delete assignment",
    description="Delete an assignment by its UUID. The authenticated user must have permission to edit the parent course.",
    responses={
        200: {"description": "Assignment deleted."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to delete this assignment"},
        404: {"description": "Assignment not found"},
    },
)
async def api_delete_assignment(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Delete an assignment
    """
    return await delete_assignment(request, assignment_uuid, current_user, db_session)


@router.delete(
    "/activity/{activity_uuid}",
    summary="Delete assignment by activity",
    description="Delete the assignment attached to the given activity UUID.",
    responses={
        200: {"description": "Assignment deleted."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to delete this assignment"},
        404: {"description": "Activity or assignment not found"},
    },
)
async def api_delete_assignment_from_activity(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Delete an assignment
    """
    return await delete_assignment_from_activity_uuid(
        request, activity_uuid, current_user, db_session
    )


## ASSIGNMENTS Tasks ##


@router.post(
    "/{assignment_uuid}/tasks",
    summary="Create assignment task",
    description="Create a new task under an assignment. The authenticated user must have permission to edit the parent course.",
    responses={
        200: {"description": "Assignment task created."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to edit this assignment"},
        404: {"description": "Assignment not found"},
    },
)
async def api_create_assignment_tasks(
    request: Request,
    assignment_uuid: str,
    assignment_task_object: AssignmentTaskCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Create new tasks for an assignment
    """
    return await create_assignment_task(
        request, assignment_uuid, assignment_task_object, current_user, db_session
    )


@router.get(
    "/{assignment_uuid}/tasks",
    summary="List assignment tasks",
    description="Read all tasks for the given assignment.",
    responses={
        200: {"description": "List of assignment tasks."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this assignment"},
        404: {"description": "Assignment not found"},
    },
)
async def api_read_assignment_tasks(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Read tasks for an assignment
    """
    return await read_assignment_tasks(
        request, assignment_uuid, current_user, db_session
    )


@router.get(
    "/task/{assignment_task_uuid}",
    summary="Get assignment task",
    description="Read a single assignment task by its UUID.",
    responses={
        200: {"description": "Assignment task returned."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this task"},
        404: {"description": "Assignment task not found"},
    },
)
async def api_read_assignment_task(
    request: Request,
    assignment_task_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Read task for an assignment
    """
    return await read_assignment_task(
        request, assignment_task_uuid, current_user, db_session
    )


@router.put(
    "/{assignment_uuid}/tasks/{assignment_task_uuid}",
    summary="Update assignment task",
    description="Update an assignment task by its UUID. The authenticated user must have permission to edit the parent course.",
    responses={
        200: {"description": "Assignment task updated."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to edit this task"},
        404: {"description": "Assignment task not found"},
    },
)
async def api_update_assignment_tasks(
    request: Request,
    assignment_task_uuid: str,
    assignment_task_object: AssignmentTaskUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Update tasks for an assignment
    """
    return await update_assignment_task(
        request, assignment_task_uuid, assignment_task_object, current_user, db_session
    )


@router.post(
    "/{assignment_uuid}/tasks/{assignment_task_uuid}/ref_file",
    summary="Upload task reference file",
    description="Upload or replace the reference file for an assignment task. Instructors use this to attach a canonical solution or prompt attachment.",
    responses={
        200: {"description": "Reference file stored."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to edit this task"},
        404: {"description": "Assignment task not found"},
    },
)
async def api_put_assignment_task_ref_file(
    request: Request,
    assignment_task_uuid: str,
    reference_file: UploadFile | None = None,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Update tasks for an assignment
    """
    return await put_assignment_task_reference_file(
        request, db_session, assignment_task_uuid, current_user, reference_file
    )


@router.post(
    "/{assignment_uuid}/tasks/{assignment_task_uuid}/sub_file",
    summary="Upload task submission file",
    description="Upload or replace the submission file for an assignment task on behalf of the current user.",
    responses={
        200: {"description": "Submission file stored."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to submit to this task"},
        404: {"description": "Assignment task not found"},
    },
)
async def api_put_assignment_task_sub_file(
    request: Request,
    assignment_task_uuid: str,
    sub_file: UploadFile | None = None,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Update tasks for an assignment
    """
    return await put_assignment_task_submission_file(
        request, db_session, assignment_task_uuid, current_user, sub_file
    )


@router.delete(
    "/{assignment_uuid}/tasks/{assignment_task_uuid}",
    summary="Delete assignment task",
    description="Delete an assignment task by its UUID. The authenticated user must have permission to edit the parent course.",
    responses={
        200: {"description": "Assignment task deleted."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to delete this task"},
        404: {"description": "Assignment task not found"},
    },
)
async def api_delete_assignment_tasks(
    request: Request,
    assignment_task_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Delete tasks for an assignment
    """
    return await delete_assignment_task(
        request, assignment_task_uuid, current_user, db_session
    )


## ASSIGNMENTS Tasks Submissions ##


@router.put(
    "/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions",
    summary="Upsert assignment task submission",
    description="Create or update the current user's submission for an assignment task.",
    responses={
        200: {"description": "Task submission stored."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to submit to this task"},
        404: {"description": "Assignment task not found"},
    },
)
async def api_handle_assignment_task_submissions(
    request: Request,
    assignment_task_submission_object: AssignmentTaskSubmissionUpdate,
    assignment_task_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Create new task submissions for an assignment
    """
    return await handle_assignment_task_submission(
        request,
        assignment_task_uuid,
        assignment_task_submission_object,
        current_user,
        db_session,
    )


@router.get(
    "/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions/user/{user_id}",
    summary="List task submissions for user",
    description="Read the task submissions made by a specific user for the given assignment task.",
    responses={
        200: {"description": "List of task submissions for the user."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view these submissions"},
        404: {"description": "Assignment task or user not found"},
    },
)
async def api_read_user_assignment_task_submissions(
    request: Request,
    assignment_task_uuid: str,
    user_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Read task submissions for an assignment from a user
    """
    return await read_user_assignment_task_submissions(
        request, assignment_task_uuid, user_id, current_user, db_session
    )


@router.get(
    "/{assignment_uuid}/tasks/submissions/me",
    summary="Batch read current user's task submissions",
    description="Read all current-user task submissions for an assignment in one round trip. Returns a map keyed by assignment_task_uuid (value is null if no submission). Registered before the per-task variant so the literal submissions path segment isn't shadowed.",
    responses={
        200: {"description": "Map of task_uuid -> submission (or null)."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this assignment"},
        404: {"description": "Assignment not found"},
    },
)
async def api_read_user_assignment_task_submissions_me_batch(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Read all current-user task submissions for an assignment in one round trip.
    Returns a map keyed by assignment_task_uuid (value is null if no submission).
    Registered before the per-task variant so the literal `submissions` path
    segment isn't shadowed by `{assignment_task_uuid}`.
    """
    return await read_user_assignment_task_submissions_me_batch(
        request, assignment_uuid, current_user, db_session
    )


@router.get(
    "/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions/me",
    summary="Get current user's task submission",
    description="Read the current user's submission for a specific assignment task. Returns 404 if the user has no submission yet.",
    responses={
        200: {"description": "Current user's task submission."},
        401: {"description": "Authentication required"},
        404: {"description": "Assignment Task Submission not found"},
    },
)
async def api_read_user_assignment_task_submissions_me(
    request: Request,
    assignment_task_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Read task submissions for an assignment from a user
    """
    result = await read_user_assignment_task_submissions_me(
        request, assignment_task_uuid, current_user, db_session
    )
    if result is None:
        # Return 404 if no submission exists (maintains current frontend behavior)
        raise HTTPException(
            status_code=404,
            detail="Assignment Task Submission not found",
        )
    return result


@router.get(
    "/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions",
    summary="List task submissions",
    description="Read all submissions for a given assignment task (instructor view).",
    responses={
        200: {"description": "List of task submissions."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view these submissions"},
        404: {"description": "Assignment task not found"},
    },
)
async def api_read_assignment_task_submissions(
    request: Request,
    assignment_task_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Read task submissions for an assignment from a user
    """
    return await read_assignment_task_submissions(
        request, assignment_task_uuid, current_user, db_session
    )


@router.delete(
    "/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions/{assignment_task_submission_uuid}",
    summary="Delete task submission",
    description="Delete a specific task submission by its UUID.",
    responses={
        200: {"description": "Task submission deleted."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to delete this submission"},
        404: {"description": "Task submission not found"},
    },
)
async def api_delete_assignment_task_submissions(
    request: Request,
    assignment_task_submission_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Delete task submissions for an assignment from a user
    """
    return await delete_assignment_task_submission(
        request, assignment_task_submission_uuid, current_user, db_session
    )


## ASSIGNMENTS Submissions ##


@router.post(
    "/{assignment_uuid}/submissions",
    summary="Create assignment submission",
    description="Create a new assignment-level submission for the current user on the given assignment.",
    responses={
        200: {"description": "Assignment submission created."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to submit to this assignment"},
        404: {"description": "Assignment not found"},
    },
)
async def api_create_assignment_submissions(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Create new submissions for an assignment
    """
    return await create_assignment_submission(
        request, assignment_uuid, current_user, db_session
    )


@router.get(
    "/{assignment_uuid}/submissions",
    summary="List assignment submissions",
    description="Read all assignment-level submissions for the given assignment (instructor view).",
    responses={
        200: {"description": "List of assignment submissions."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view these submissions"},
        404: {"description": "Assignment not found"},
    },
)
async def api_read_assignment_submissions(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Read submissions for an assignment
    """
    return await read_assignment_submissions(
        request, assignment_uuid, current_user, db_session
    )


@router.get(
    "/{assignment_uuid}/submissions/me",
    summary="Get current user's assignment submission",
    description="Read the current user's assignment-level submission for the given assignment.",
    responses={
        200: {"description": "Current user's assignment submission."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this assignment"},
        404: {"description": "Assignment or submission not found"},
    },
)
async def api_read_user_assignment_submission_me(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Read submissions for an assignment from the current user
    """
    return await read_user_assignment_submissions_me(
        request, assignment_uuid, current_user, db_session
    )


@router.get(
    "/{assignment_uuid}/submissions/{user_id}",
    summary="Get assignment submission for user",
    description="Read the assignment-level submission for a specific user on the given assignment (instructor view).",
    responses={
        200: {"description": "Assignment submission for the user."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this submission"},
        404: {"description": "Assignment, user, or submission not found"},
    },
)
async def api_read_user_assignment_submissions(
    request: Request,
    assignment_uuid: str,
    user_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Read submissions for an assignment from a user
    """
    return await read_user_assignment_submissions(
        request, assignment_uuid, user_id, current_user, db_session
    )


@router.put(
    "/{assignment_uuid}/submissions/{user_id}",
    summary="Update assignment submission for user",
    description="Update a user's assignment-level submission on the given assignment.",
    responses={
        200: {"description": "Assignment submission updated."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to update this submission"},
        404: {"description": "Assignment, user, or submission not found"},
    },
)
async def api_update_user_assignment_submissions(
    request: Request,
    assignment_uuid: str,
    user_id: str,
    assignment_submission: AssignmentUserSubmissionCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Update submissions for an assignment from a user
    """
    return await update_assignment_submission(
        request, user_id, assignment_uuid, assignment_submission, current_user, db_session
    )


@router.delete(
    "/{assignment_uuid}/submissions/{user_id}",
    summary="Delete assignment submission for user",
    description="Delete a user's assignment-level submission on the given assignment.",
    responses={
        200: {"description": "Assignment submission deleted."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to delete this submission"},
        404: {"description": "Assignment, user, or submission not found"},
    },
)
async def api_delete_user_assignment_submissions(
    request: Request,
    assignment_uuid: str,
    user_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Delete submissions for an assignment from a user
    """
    return await delete_assignment_submission(
        request, user_id, assignment_uuid, current_user, db_session
    )


@router.get(
    "/{assignment_uuid}/submissions/{user_id}/grade",
    summary="Get assignment submission grade",
    description="Read the computed grade for a user's assignment submission.",
    responses={
        200: {"description": "Grade information for the submission."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this grade"},
        404: {"description": "Assignment, user, or submission not found"},
    },
)
async def api_get_submission_grade(
    request: Request,
    assignment_uuid: str,
    user_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Grade submissions for an assignment from a user
    """

    return await get_grade_assignment_submission(
        request, user_id, assignment_uuid, current_user, db_session
    )


@router.post(
    "/{assignment_uuid}/submissions/{user_id}/grade",
    summary="Finalize assignment submission grade",
    description="Compute and store the final grade for an assignment submission. Accepts an optional overall_feedback note that will be stored alongside the grade.",
    responses={
        200: {"description": "Final grade stored."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to grade this submission"},
        404: {"description": "Assignment, user, or submission not found"},
    },
)
async def api_final_grade_submission(
    request: Request,
    assignment_uuid: str,
    user_id: str,
    body: Optional[GradeSubmissionBody] = None,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Compute and store the final grade for an assignment submission. Accepts
    an optional overall_feedback note that will be stored alongside the grade.
    """

    return await grade_assignment_submission(
        request,
        user_id,
        assignment_uuid,
        current_user,
        db_session,
        overall_feedback=body.overall_feedback if body else None,
    )


@router.post(
    "/{assignment_uuid}/submissions/{user_id}/done",
    summary="Mark assignment as done for user",
    description="Mark the underlying activity as completed for a user once their assignment submission is accepted.",
    responses={
        200: {"description": "Activity marked as done for the user."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to mark this submission as done"},
        404: {"description": "Assignment, user, or submission not found"},
    },
)
async def api_submission_mark_as_done(
    request: Request,
    assignment_uuid: str,
    user_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Grade submissions for an assignment from a user
    """

    return await mark_activity_as_done_for_user(
        request, user_id, assignment_uuid, current_user, db_session
    )


@router.get(
    "/course/{course_uuid}",
    summary="List course assignments",
    description="Get all assignments attached to activities within the given course.",
    responses={
        200: {"description": "List of assignments for the course."},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission to view this course"},
        404: {"description": "Course not found"},
    },
)
async def api_get_assignments(
    request: Request,
    course_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Get assignments for a course
    """
    return await get_assignments_from_course(
        request, course_uuid, current_user, db_session
    )
