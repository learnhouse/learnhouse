from datetime import datetime
from uuid import uuid4
from fastapi import HTTPException, Request, UploadFile
from sqlmodel import Session, select

from src.db.courses.activities import Activity
from src.db.courses.assignments import (
    Assignment,
    AssignmentCreate,
    AssignmentRead,
    AssignmentTask,
    AssignmentTaskCreate,
    AssignmentTaskRead,
    AssignmentTaskSubmission,
    AssignmentTaskSubmissionCreate,
    AssignmentTaskSubmissionRead,
    AssignmentTaskSubmissionUpdate,
    AssignmentTaskUpdate,
    AssignmentUpdate,
    AssignmentUserSubmission,
    AssignmentUserSubmissionCreate,
    AssignmentUserSubmissionRead,
    AssignmentUserSubmissionStatus,
)
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.users import AnonymousUser, PublicUser, User, APITokenUser
from src.security.features_utils.usage import (
    check_limits_with_usage,
    decrease_feature_usage,
    increase_feature_usage,
)
from src.security.rbac import (
    authorization_verify_based_on_roles,
    check_resource_access,
    AccessAction,
)
from src.services.courses.activities.uploads.sub_file import upload_submission_file
from src.services.courses.activities.uploads.tasks_ref_files import (
    upload_reference_file,
)
from src.services.trail.trail import check_trail_presence
from src.services.courses.certifications import check_course_completion_and_create_certificate
from src.services.analytics.analytics import track
from src.services.analytics import events as analytics_events
from src.services.webhooks.dispatch import dispatch_webhooks


def _block_api_tokens(current_user: PublicUser | AnonymousUser | APITokenUser) -> None:
    """
    Block API tokens from accessing assignments.

    SECURITY: Assignments contain sensitive user submission data and grades.
    API tokens are not allowed to access this data - only user authentication is permitted.
    """
    if isinstance(current_user, APITokenUser):
        raise HTTPException(
            status_code=403,
            detail="API tokens cannot access assignments. Only user authentication is allowed.",
        )


## > Assignments CRUD


async def create_assignment(
    request: Request,
    assignment_object: AssignmentCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if org exists
    statement = select(Course).where(Course.id == assignment_object.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.CREATE)

    # Usage check
    check_limits_with_usage("assignments", course.org_id, db_session)

    # Create Assignment
    assignment = Assignment(**assignment_object.model_dump())

    assignment.assignment_uuid = str(f"assignment_{uuid4()}")
    assignment.creation_date = str(datetime.now())
    assignment.update_date = str(datetime.now())
    assignment.org_id = course.org_id

    # Insert Assignment in DB
    db_session.add(assignment)
    db_session.commit()
    db_session.refresh(assignment)

    # Feature usage
    increase_feature_usage("assignments", course.org_id, db_session)

    # return assignment read
    return AssignmentRead.model_validate(assignment)


async def read_assignment(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # return assignment read
    return AssignmentRead.model_validate(assignment)


async def read_assignment_from_activity_uuid(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if activity exists
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.activity_id == activity.id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # return assignment read
    return AssignmentRead.model_validate(assignment)


async def update_assignment(
    request: Request,
    assignment_uuid: str,
    assignment_object: AssignmentUpdate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Update only the fields that were passed in
    for var, value in vars(assignment_object).items():
        if value is not None:
            setattr(assignment, var, value)
    assignment.update_date = str(datetime.now())

    # Insert Assignment in DB
    db_session.add(assignment)
    db_session.commit()
    db_session.refresh(assignment)

    # return assignment read
    return AssignmentRead.model_validate(assignment)


async def delete_assignment(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

    # Feature usage
    decrease_feature_usage("assignments", course.org_id, db_session)

    # Delete Assignment
    db_session.delete(assignment)
    db_session.commit()

    return {"message": "Assignment deleted"}


async def delete_assignment_from_activity_uuid(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if activity exists
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)

    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.activity_id == activity.id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

     # Feature usage
    decrease_feature_usage("assignments", course.org_id, db_session)

    # Delete Assignment
    db_session.delete(assignment)

    db_session.commit()

    return {"message": "Assignment deleted"}


## > Assignments Tasks CRUD


async def create_assignment_task(
    request: Request,
    assignment_uuid: str,
    assignment_task_object: AssignmentTaskCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.CREATE)

    # Create Assignment Task
    assignment_task = AssignmentTask(**assignment_task_object.model_dump())

    assignment_task.assignment_task_uuid = str(f"assignmenttask_{uuid4()}")
    assignment_task.creation_date = str(datetime.now())
    assignment_task.update_date = str(datetime.now())
    assignment_task.org_id = course.org_id
    assignment_task.chapter_id = assignment.chapter_id
    assignment_task.activity_id = assignment.activity_id
    assignment_task.assignment_id = assignment.id  # type: ignore
    assignment_task.course_id = assignment.course_id

    # Insert Assignment Task in DB
    db_session.add(assignment_task)
    db_session.commit()
    db_session.refresh(assignment_task)

    # return assignment task read
    return AssignmentTaskRead.model_validate(assignment_task)


async def read_assignment_tasks(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Find assignment
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Find assignments tasks for an assignment
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_id == assignment.id
    )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # return assignment tasks read
    return [
        AssignmentTaskRead.model_validate(assignment_task)
        for assignment_task in db_session.exec(statement).all()
    ]


async def read_assignment_task(
    request: Request,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Find assignment
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignmenttask = db_session.exec(statement).first()

    if not assignmenttask:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignmenttask.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # return assignment task read
    return AssignmentTaskRead.model_validate(assignmenttask)


async def put_assignment_task_reference_file(
    request: Request,
    db_session: Session,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    reference_file: UploadFile | None = None,
):
    _block_api_tokens(current_user)
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check for activity
    statement = select(Activity).where(Activity.id == assignment.activity_id)
    activity = db_session.exec(statement).first()

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Get org uuid
    org_statement = select(Organization).where(Organization.id == course.org_id)
    org = db_session.exec(org_statement).first()

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Upload reference file
    if reference_file and reference_file.filename and activity and org:
        name_in_disk = await upload_reference_file(
            reference_file,
            activity.activity_uuid,
            org.org_uuid,
            course.course_uuid,
            assignment.assignment_uuid,
            assignment_task_uuid,
        )
        # Update reference file
        assignment_task.reference_file = name_in_disk

    assignment_task.update_date = str(datetime.now())

    # Insert Assignment Task in DB
    db_session.add(assignment_task)
    db_session.commit()
    db_session.refresh(assignment_task)

    # return assignment task read
    return AssignmentTaskRead.model_validate(assignment_task)


async def put_assignment_task_submission_file(
    request: Request,
    db_session: Session,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    sub_file: UploadFile | None = None,
):
    _block_api_tokens(current_user)
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check for activity
    statement = select(Activity).where(Activity.id == assignment.activity_id)
    activity = db_session.exec(statement).first()

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Get org uuid
    org_statement = select(Organization).where(Organization.id == course.org_id)
    org = db_session.exec(org_statement).first()

    # RBAC check - only need read permission to submit files
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Check if user is enrolled in the course
    if not await authorization_verify_based_on_roles(request, current_user.id, "read", course.course_uuid, db_session):
        raise HTTPException(
            status_code=403,
            detail="You must be enrolled in this course to submit files"
        )

    # Upload submission file
    if sub_file and sub_file.filename and activity and org:
        name_in_disk = await upload_submission_file(
            sub_file,
            activity.activity_uuid,
            org.org_uuid,
            course.course_uuid,
            assignment.assignment_uuid,
            assignment_task_uuid,
        )

        return {"file_uuid": name_in_disk}


async def update_assignment_task(
    request: Request,
    assignment_task_uuid: str,
    assignment_task_object: AssignmentTaskUpdate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Update only the fields that were passed in
    for var, value in vars(assignment_task_object).items():
        if value is not None:
            setattr(assignment_task, var, value)
    assignment_task.update_date = str(datetime.now())

    # Insert Assignment Task in DB
    db_session.add(assignment_task)
    db_session.commit()
    db_session.refresh(assignment_task)

    # return assignment task read
    return AssignmentTaskRead.model_validate(assignment_task)


async def delete_assignment_task(
    request: Request,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

    # Delete Assignment Task
    db_session.delete(assignment_task)
    db_session.commit()

    return {"message": "Assignment Task deleted"}


## > Assignments Tasks Submissions CRUD


async def handle_assignment_task_submission(
    request: Request,
    assignment_task_uuid: str,
    assignment_task_submission_object: AssignmentTaskSubmissionUpdate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    assignment_task_submission_uuid = assignment_task_submission_object.assignment_task_submission_uuid
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # SECURITY: Check if user has instructor/admin permissions for grading
    is_instructor = await authorization_verify_based_on_roles(request, current_user.id, "update", course.course_uuid, db_session)

    # For regular users, ensure they can only submit their own work
    if not is_instructor:
        # Check if user is enrolled in the course
        if not await authorization_verify_based_on_roles(request, current_user.id, "read", course.course_uuid, db_session):
            raise HTTPException(
                status_code=403,
                detail="You must be enrolled in this course to submit assignments"
            )
        
        # SECURITY: Regular users cannot update grades - only check if actual values are being set
        if (assignment_task_submission_object.grade is not None and assignment_task_submission_object.grade != 0) or \
           (assignment_task_submission_object.task_submission_grade_feedback is not None and assignment_task_submission_object.task_submission_grade_feedback != ""):
            raise HTTPException(
                status_code=403,
                detail="You do not have permission to update grades"
            )

        # Only need read permission for submissions
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)
    else:
        # SECURITY: Instructors/admins need update permission to grade
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Try to find existing submission by user_id and assignment_task_id first (for save progress functionality)
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_id == assignment_task.id,
        AssignmentTaskSubmission.user_id == current_user.id,
    )
    assignment_task_submission = db_session.exec(statement).first()
    
    # If no submission found by user+task, try to find by UUID if provided (for specific submission updates)
    if not assignment_task_submission and assignment_task_submission_uuid:
        statement = select(AssignmentTaskSubmission).where(
            AssignmentTaskSubmission.assignment_task_submission_uuid == assignment_task_submission_uuid
        )
        assignment_task_submission = db_session.exec(statement).first()

    # If submission exists, update it
    if assignment_task_submission:
        # SECURITY: For regular users, ensure they can only update their own submissions
        if not is_instructor and assignment_task_submission.user_id != current_user.id:
            raise HTTPException(
                status_code=403,
                detail="You can only update your own submissions"
            )

        # Update only the fields that were passed in
        for var, value in vars(assignment_task_submission_object).items():
            if value is not None:
                setattr(assignment_task_submission, var, value)
        assignment_task_submission.update_date = str(datetime.now())

        # Insert Assignment Task Submission in DB
        db_session.add(assignment_task_submission)
        db_session.commit()
        db_session.refresh(assignment_task_submission)

    else:
        # Create new Task submission
        current_time = str(datetime.now())

        # Assuming model_dump() returns a dictionary
        model_data = assignment_task_submission_object.model_dump()

        assignment_task_submission = AssignmentTaskSubmission(
            assignment_task_submission_uuid=assignment_task_submission_uuid or f"assignmenttasksubmission_{uuid4()}",
            task_submission=model_data["task_submission"],
            grade=0,  # Always start with 0 for new submissions
            task_submission_grade_feedback="",  # Start with empty feedback
            assignment_task_id=int(assignment_task.id),  # type: ignore
            assignment_type=assignment_task.assignment_type,
            activity_id=assignment.activity_id,
            course_id=assignment.course_id,
            chapter_id=assignment.chapter_id,
            user_id=current_user.id,
            creation_date=current_time,
            update_date=current_time,
        )

        # Insert Assignment Task Submission in DB
        db_session.add(assignment_task_submission)
        db_session.commit()
        db_session.refresh(assignment_task_submission)

    # return assignment task submission read
    return AssignmentTaskSubmissionRead.model_validate(assignment_task_submission)


async def read_user_assignment_task_submissions(
    request: Request,
    assignment_task_uuid: str,
    user_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment task submission exists
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_id == assignment_task.id,
        AssignmentTaskSubmission.user_id == user_id,
    )
    assignment_task_submission = db_session.exec(statement).first()

    if not assignment_task_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task Submission not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # return assignment task submission read
    return AssignmentTaskSubmissionRead.model_validate(assignment_task_submission)


async def read_user_assignment_task_submissions_me(
    request: Request,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_task_uuid == assignment_task_uuid
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment task submission exists
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_id == assignment_task.id,
        AssignmentTaskSubmission.user_id == current_user.id,
    )
    assignment_task_submission = db_session.exec(statement).first()

    if not assignment_task_submission:
        # Return None instead of raising an error for cases where no submission exists yet
        return None

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # return assignment task submission read
    return AssignmentTaskSubmissionRead.model_validate(assignment_task_submission)


async def read_assignment_task_submissions(
    request: Request,
    assignment_task_submission_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment task submission exists
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_submission_uuid
        == assignment_task_submission_uuid,
    )
    assignment_task_submission = db_session.exec(statement).first()

    if not assignment_task_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task Submission not found",
        )

    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.id == assignment_task_submission.assignment_task_id
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # return assignment task submission read
    return AssignmentTaskSubmissionRead.model_validate(assignment_task_submission)


async def update_assignment_task_submission(
    request: Request,
    assignment_task_submission_uuid: str,
    assignment_task_submission_object: AssignmentTaskSubmissionCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment task submission exists
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_submission_uuid
        == assignment_task_submission_uuid
    )
    assignment_task_submission = db_session.exec(statement).first()

    if not assignment_task_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task Submission not found",
        )

    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.id == assignment_task_submission.assignment_task_id
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Update only the fields that were passed in
    for var, value in vars(assignment_task_submission_object).items():
        if value is not None:
            setattr(assignment_task_submission, var, value)
    assignment_task_submission.update_date = str(datetime.now())

    # Insert Assignment Task Submission in DB
    db_session.add(assignment_task_submission)
    db_session.commit()
    db_session.refresh(assignment_task_submission)

    # return assignment task submission read
    return AssignmentTaskSubmissionRead.model_validate(assignment_task_submission)


async def delete_assignment_task_submission(
    request: Request,
    assignment_task_submission_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment task submission exists
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_submission_uuid
        == assignment_task_submission_uuid
    )
    assignment_task_submission = db_session.exec(statement).first()

    if not assignment_task_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task Submission not found",
        )

    # Check if assignment task exists
    statement = select(AssignmentTask).where(
        AssignmentTask.id == assignment_task_submission.assignment_task_id
    )
    assignment_task = db_session.exec(statement).first()

    if not assignment_task:
        raise HTTPException(
            status_code=404,
            detail="Assignment Task not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(Assignment.id == assignment_task.assignment_id)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

    # Delete Assignment Task Submission
    db_session.delete(assignment_task_submission)
    db_session.commit()

    return {"message": "Assignment Task Submission deleted"}


## > Assignments Submissions CRUD


async def create_assignment_submission(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if the submission has already been made
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.assignment_id == assignment.id,
        AssignmentUserSubmission.user_id == current_user.id,
    )

    assignment_user_submission = db_session.exec(statement).first()

    if assignment_user_submission:
        raise HTTPException(
            status_code=400,
            detail="Assignment User Submission already exists",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Check if User already submitted the assignment
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.assignment_id == assignment.id,
        AssignmentUserSubmission.user_id == current_user.id,
    )
    assignment_user_submission = db_session.exec(statement).first()

    if assignment_user_submission:
        raise HTTPException(
            status_code=400,
            detail="Assignment User Submission already exists",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Create Assignment User Submission
    assignment_user_submission = AssignmentUserSubmission(
        user_id=current_user.id,
        assignment_id=assignment.id,  # type: ignore
        grade=0,
        assignmentusersubmission_uuid=str(f"assignmentusersubmission_{uuid4()}"),
        submission_status=AssignmentUserSubmissionStatus.SUBMITTED,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    # Insert Assignment User Submission in DB
    db_session.add(assignment_user_submission)
    db_session.commit()

    # Track assignment submission
    await track(
        event_name=analytics_events.ASSIGNMENT_SUBMITTED,
        org_id=course.org_id,
        user_id=current_user.id,
        properties={
            "assignment_uuid": assignment_uuid,
            "course_uuid": course.course_uuid,
        },
    )
    await dispatch_webhooks(
        event_name=analytics_events.ASSIGNMENT_SUBMITTED,
        org_id=course.org_id,
        data={
            "user": {"user_uuid": current_user.user_uuid, "email": current_user.email, "username": current_user.username},
            "assignment": {"assignment_uuid": assignment_uuid},
            "course": {"course_uuid": course.course_uuid, "name": course.name},
        },
    )

    # User
    statement = select(User).where(User.id == current_user.id)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    # Activity
    statement = select(Activity).where(Activity.id == assignment.activity_id)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # Add TrailStep
    trail = await check_trail_presence(
        org_id=course.org_id,
        user_id=user.id,  # type: ignore
        request=request,
        user=user,  # type: ignore
        db_session=db_session,
    )

    statement = select(TrailRun).where(
        TrailRun.trail_id == trail.id,
        TrailRun.course_id == course.id,
        TrailRun.user_id == user.id,
    )
    trailrun = db_session.exec(statement).first()

    if not trailrun:
        trailrun = TrailRun(
            trail_id=trail.id if trail.id is not None else 0,
            course_id=course.id if course.id is not None else 0,
            org_id=course.org_id,
            user_id=user.id,  # type: ignore
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trailrun)
        db_session.commit()
        db_session.refresh(trailrun)

    statement = select(TrailStep).where(
        TrailStep.trailrun_id == trailrun.id,
        TrailStep.activity_id == activity.id,
        TrailStep.user_id == user.id,
    )
    trailstep = db_session.exec(statement).first()

    if not trailstep:
        trailstep = TrailStep(
            trailrun_id=trailrun.id if trailrun.id is not None else 0,
            activity_id=activity.id if activity.id is not None else 0,
            course_id=course.id if course.id is not None else 0,
            trail_id=trail.id if trail.id is not None else 0,
            org_id=course.org_id,
            complete=True,
            teacher_verified=False,
            grade="",
            user_id=user.id, # type: ignore
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trailstep)
        db_session.commit()
        db_session.refresh(trailstep)

    # Check if all activities in the course are completed and create certificate if so
    if course and course.id and user and user.id:
        await check_course_completion_and_create_certificate(
            request, user.id, course.id, db_session
        )

    # return assignment user submission read
    return AssignmentUserSubmissionRead.model_validate(assignment_user_submission)


async def read_assignment_submissions(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Find assignment
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Check if user has instructor/admin privileges on this course
    is_instructor = await authorization_verify_based_on_roles(
        request, current_user.id, "update", course.course_uuid, db_session
    )

    # Non-instructors can only see their own submissions
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.assignment_id == assignment.id
    )
    if not is_instructor:
        statement = statement.where(
            AssignmentUserSubmission.user_id == current_user.id
        )

    # return assignment tasks read
    return [
        AssignmentUserSubmissionRead.model_validate(assignment_user_submission)
        for assignment_user_submission in db_session.exec(statement).all()
    ]


async def read_user_assignment_submissions(
    request: Request,
    assignment_uuid: str,
    user_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Find assignment
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Find assignments tasks for an assignment
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.assignment_id == assignment.id,
        AssignmentUserSubmission.user_id == user_id,
    )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # return assignment tasks read
    return [
        AssignmentUserSubmissionRead.model_validate(assignment_user_submission)
        for assignment_user_submission in db_session.exec(statement).all()
    ]


async def read_user_assignment_submissions_me(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    return await read_user_assignment_submissions(
        request,
        assignment_uuid,
        current_user.id,
        current_user,
        db_session,
    )


async def update_assignment_submission(
    request: Request,
    user_id: str,
    assignment_user_submission_object: AssignmentUserSubmissionCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment user submission exists
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.user_id == user_id
    )
    assignment_user_submission = db_session.exec(statement).first()

    if not assignment_user_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment User Submission not found",
        )

    # Check if assignment exists
    statement = select(Assignment).where(
        Assignment.id == assignment_user_submission.assignment_id
    )
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Check if user is an instructor/admin (has UPDATE permission)
    is_instructor = await authorization_verify_based_on_roles(
        request, current_user.id, "update", course.course_uuid, db_session
    )

    if is_instructor:
        # Instructors/admins can update any submission (e.g., for grading)
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)
    else:
        # Regular users need READ access and can only update their own submissions
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)
        if str(assignment_user_submission.user_id) != str(current_user.id):
            raise HTTPException(
                status_code=403,
                detail="You can only update your own submissions",
            )

    # Update only the fields that were passed in
    for var, value in vars(assignment_user_submission_object).items():
        if value is not None:
            setattr(assignment_user_submission, var, value)
    assignment_user_submission.update_date = str(datetime.now())

    # Insert Assignment User Submission in DB
    db_session.add(assignment_user_submission)
    db_session.commit()
    db_session.refresh(assignment_user_submission)

    # return assignment user submission read
    return AssignmentUserSubmissionRead.model_validate(assignment_user_submission)


async def delete_assignment_submission(
    request: Request,
    user_id: str,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if assignment user submission exists
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.user_id == user_id,
        AssignmentUserSubmission.assignment_id == assignment.id,
    )
    assignment_user_submission = db_session.exec(statement).first()

    if not assignment_user_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment User Submission not found",
        )

    # Check if course exists
    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

    # Delete Assignment User Submission
    db_session.delete(assignment_user_submission)
    db_session.commit()

    return {"message": "Assignment User Submission deleted"}


## > Assignments Submissions Grading
async def grade_assignment_submission(
    request: Request,
    user_id: str,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # SECURITY: This function should only be accessible by course owners or instructors
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # SECURITY: Require course ownership or instructor role for grading
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Check if assignment user submission exists
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.user_id == user_id,
        AssignmentUserSubmission.assignment_id == assignment.id,
    )
    assignment_user_submission = db_session.exec(statement).first()

    if not assignment_user_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment User Submission not found",
        )

    # Get all the task submissions for the user
    task_subs = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.user_id == user_id,
        AssignmentTaskSubmission.activity_id == assignment.activity_id,
    )
    task_submissions = db_session.exec(task_subs).all()

    # Calculate the grade
    grade = 0
    for task_submission in task_submissions:
        grade += task_submission.grade

    # Update the assignment user submission
    assignment_user_submission.grade = grade

    # Insert Assignment User Submission in DB
    db_session.add(assignment_user_submission)
    db_session.commit()
    db_session.refresh(assignment_user_submission)

    # Change the status of the submission
    assignment_user_submission.submission_status = AssignmentUserSubmissionStatus.GRADED

    # Insert Assignment User Submission in DB
    db_session.add(assignment_user_submission)
    db_session.commit()
    db_session.refresh(assignment_user_submission)

    # return OK
    return {
        "message": "Assignment User Submission graded with the grade of " + str(grade)
    }


async def get_grade_assignment_submission(
    request: Request,
    user_id: str,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Check if assignment exists
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if assignment user submission exists
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.user_id == user_id,
        AssignmentUserSubmission.assignment_id == assignment.id,
    )
    assignment_user_submission = db_session.exec(statement).first()

    if not assignment_user_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment User Submission not found",
        )

    # Get the max grade value from the sum of every assignmenttask
    statement = select(AssignmentTask).where(
        AssignmentTask.assignment_id == assignment.id
    )
    assignment_tasks = db_session.exec(statement).all()
    max_grade = 0

    for task in assignment_tasks:
        max_grade += task.max_grade_value

    # Now get the grade from the user submission
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.user_id == user_id,
        AssignmentUserSubmission.assignment_id == assignment.id,
    )
    assignment_user_submission = db_session.exec(statement).first()

    if not assignment_user_submission:
        raise HTTPException(
            status_code=404,
            detail="Assignment User Submission not found",
        )

    # return the grade
    return {
        "grade": int(assignment_user_submission.grade),
        "max_grade": max_grade,
        "grading_type": assignment.grading_type,
    }


async def mark_activity_as_done_for_user(
    request: Request,
    user_id: str,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # SECURITY: This function should only be accessible by course owners or instructors
    # Get Assignment
    statement = select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    assignment = db_session.exec(statement).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="Assignment not found",
        )

    # Check if activity exists
    statement = select(Activity).where(Activity.id == assignment.activity_id)
    activity = db_session.exec(statement).first()

    statement = select(Course).where(Course.id == assignment.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # SECURITY: Require course ownership or instructor role for marking activities as done
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # Check if user exists
    statement = select(User).where(User.id == user_id)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    # Check if user is enrolled in the course
    trailsteps = select(TrailStep).where(
        TrailStep.activity_id == activity.id,
        TrailStep.user_id == user_id,
    )
    trailstep = db_session.exec(trailsteps).first()

    if not trailstep:
        raise HTTPException(
            status_code=404,
            detail="User not enrolled in the course",
        )

    # Mark activity as done
    trailstep.complete = True
    trailstep.update_date = str(datetime.now())

    # Insert TrailStep in DB
    db_session.add(trailstep)
    db_session.commit()
    db_session.refresh(trailstep)

    # Check if all activities in the course are completed and create certificate if so
    if course and course.id:
        await check_course_completion_and_create_certificate(
            request, int(user_id), course.id, db_session
        )

    # return OK
    return {"message": "Activity marked as done for user"}


async def get_assignments_from_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
):
    _block_api_tokens(current_user)
    # Find course
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Get Assignments
    statement = select(Assignment).where(Assignment.course_id == course.id)
    assignments = db_session.exec(statement).all()

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # return assignments read
    return [AssignmentRead.model_validate(assignment) for assignment in assignments]
