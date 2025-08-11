from fastapi import APIRouter, Depends, Request, UploadFile, HTTPException
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
    update_assignment,
    update_assignment_submission,
    update_assignment_task,
)

router = APIRouter()

## ASSIGNMENTS ##


@router.post("/")
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


@router.get("/{assignment_uuid}")
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


@router.get("/activity/{activity_uuid}")
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


@router.put("/{assignment_uuid}")
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


@router.delete("/{assignment_uuid}")
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


@router.delete("/activity/{activity_uuid}")
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


@router.post("/{assignment_uuid}/tasks")
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


@router.get("/{assignment_uuid}/tasks")
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


@router.get("/task/{assignment_task_uuid}")
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


@router.put("/{assignment_uuid}/tasks/{assignment_task_uuid}")
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


@router.post("/{assignment_uuid}/tasks/{assignment_task_uuid}/ref_file")
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


@router.post("/{assignment_uuid}/tasks/{assignment_task_uuid}/sub_file")
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


@router.delete("/{assignment_uuid}/tasks/{assignment_task_uuid}")
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


@router.put("/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions")
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
    "/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions/user/{user_id}"
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


@router.get("/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions/me")
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


@router.get("/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions")
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
    "/{assignment_uuid}/tasks/{assignment_task_uuid}/submissions/{assignment_task_submission_uuid}"
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


@router.post("/{assignment_uuid}/submissions")
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


@router.get("/{assignment_uuid}/submissions")
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


@router.get("/{assignment_uuid}/submissions/me")
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


@router.get("/{assignment_uuid}/submissions/{user_id}")
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


@router.put("/{assignment_uuid}/submissions/{user_id}")
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
        request, user_id, assignment_submission, current_user, db_session
    )


@router.delete("/{assignment_uuid}/submissions/{user_id}")
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


@router.get("/{assignment_uuid}/submissions/{user_id}/grade")
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


@router.post("/{assignment_uuid}/submissions/{user_id}/grade")
async def api_final_grade_submission(
    request: Request,
    assignment_uuid: str,
    user_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session=Depends(get_db_session),
):
    """
    Grade submissions for an assignment from a user
    """

    return await grade_assignment_submission(
        request, user_id, assignment_uuid, current_user, db_session
    )


@router.post("/{assignment_uuid}/submissions/{user_id}/done")
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


@router.get("/course/{course_uuid}")
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
