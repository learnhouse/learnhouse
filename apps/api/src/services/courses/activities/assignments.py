####################################################
# CRUD
####################################################

from datetime import datetime
from typing import Literal
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
from src.db.users import AnonymousUser, PublicUser, User
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship_and_usergroups,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_anon,
)
from src.services.courses.activities.uploads.sub_file import upload_submission_file
from src.services.courses.activities.uploads.tasks_ref_files import (
    upload_reference_file,
)
from src.services.trail.trail import check_trail_presence

## > Assignments CRUD


async def create_assignment(
    request: Request,
    assignment_object: AssignmentCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    # Check if org exists
    statement = select(Course).where(Course.id == assignment_object.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "create", db_session)

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

    # return assignment read
    return AssignmentRead.model_validate(assignment)


async def read_assignment(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # return assignment read
    return AssignmentRead.model_validate(assignment)


async def read_assignment_from_activity_uuid(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # return assignment read
    return AssignmentRead.model_validate(assignment)


async def update_assignment(
    request: Request,
    assignment_uuid: str,
    assignment_object: AssignmentUpdate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "update", db_session)

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
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "delete", db_session)

    # Delete Assignment
    db_session.delete(assignment)
    db_session.commit()

    return {"message": "Assignment deleted"}


async def delete_assignment_from_activity_uuid(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "delete", db_session)

    # Delete Assignment
    db_session.delete(assignment)

    db_session.commit()

    return {"message": "Assignment deleted"}


## > Assignments Tasks CRUD


async def create_assignment_task(
    request: Request,
    assignment_uuid: str,
    assignment_task_object: AssignmentTaskCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "create", db_session)

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
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # return assignment tasks read
    return [
        AssignmentTaskRead.model_validate(assignment_task)
        for assignment_task in db_session.exec(statement).all()
    ]


async def read_assignment_task(
    request: Request,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # return assignment task read
    return AssignmentTaskRead.model_validate(assignmenttask)


async def put_assignment_task_reference_file(
    request: Request,
    db_session: Session,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser,
    reference_file: UploadFile | None = None,
):
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
    await rbac_check(request, course.course_uuid, current_user, "update", db_session)

    # Upload reference file
    if reference_file and reference_file.filename and activity and org:
        name_in_disk = (
            f"{assignment_task_uuid}{uuid4()}.{reference_file.filename.split('.')[-1]}"
        )
        await upload_reference_file(
            reference_file,
            name_in_disk,
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
    current_user: PublicUser | AnonymousUser,
    sub_file: UploadFile | None = None,
):
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
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # Upload reference file
    if sub_file and sub_file.filename and activity and org:
        name_in_disk = f"{assignment_task_uuid}_sub_{current_user.email}_{uuid4()}.{sub_file.filename.split('.')[-1]}"
        await upload_submission_file(
            sub_file,
            name_in_disk,
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
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "update", db_session)

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
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "delete", db_session)

    # Delete Assignment Task
    db_session.delete(assignment_task)
    db_session.commit()

    return {"message": "Assignment Task deleted"}


## > Assignments Tasks Submissions CRUD


async def handle_assignment_task_submission(
    request: Request,
    assignment_task_uuid: str,
    assignment_task_submission_object: AssignmentTaskSubmissionUpdate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    # TODO: Improve terrible implementation of this function
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

    # Check if user already submitted the assignment
    statement = select(AssignmentTaskSubmission).where(
        AssignmentTaskSubmission.assignment_task_id == assignment_task.id,
        AssignmentTaskSubmission.user_id == current_user.id,
    )
    assignment_task_submission = db_session.exec(statement).first()

    # Update Task submission if it exists
    if assignment_task_submission:
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

    else:
        # Create new Task submission
        current_time = str(datetime.now())

        # Assuming model_dump() returns a dictionary
        model_data = assignment_task_submission_object.model_dump()

        assignment_task_submission = AssignmentTaskSubmission(
            assignment_task_submission_uuid=f"assignmenttasksubmission_{uuid4()}",
            task_submission=model_data["task_submission"],
            grade=model_data["grade"],
            task_submission_grade_feedback=model_data["task_submission_grade_feedback"],
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

        # return assignment task submission read
        return AssignmentTaskSubmissionRead.model_validate(assignment_task_submission)


async def read_user_assignment_task_submissions(
    request: Request,
    assignment_task_uuid: str,
    user_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):

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
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # return assignment task submission read
    return AssignmentTaskSubmissionRead.model_validate(assignment_task_submission)


async def read_user_assignment_task_submissions_me(
    request: Request,
    assignment_task_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    return await read_user_assignment_task_submissions(
        request,
        assignment_task_uuid,
        current_user.id,
        current_user,
        db_session,
    )


async def read_assignment_task_submissions(
    request: Request,
    assignment_task_submission_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # return assignment task submission read
    return AssignmentTaskSubmissionRead.model_validate(assignment_task_submission)


async def update_assignment_task_submission(
    request: Request,
    assignment_task_submission_uuid: str,
    assignment_task_submission_object: AssignmentTaskSubmissionCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "update", db_session)

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
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "delete", db_session)

    # Delete Assignment Task Submission
    db_session.delete(assignment_task_submission)
    db_session.commit()

    return {"message": "Assignment Task Submission deleted"}


## > Assignments Submissions CRUD


async def create_assignment_submission(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "create", db_session)

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
        user_id=user.id,
        request=request,
        user=user,
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
            user_id=user.id,
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
            user_id=user.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(trailstep)
        db_session.commit()
        db_session.refresh(trailstep)

    # return assignment user submission read
    return AssignmentUserSubmissionRead.model_validate(assignment_user_submission)


async def read_assignment_submissions(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
        AssignmentUserSubmission.assignment_id == assignment.id
    )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # return assignment tasks read
    return [
        AssignmentUserSubmissionRead.model_validate(assignment_user_submission)
        for assignment_user_submission in db_session.exec(statement).all()
    ]


async def read_user_assignment_submissions(
    request: Request,
    assignment_uuid: str,
    user_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # return assignment tasks read
    return [
        AssignmentUserSubmissionRead.model_validate(assignment_user_submission)
        for assignment_user_submission in db_session.exec(statement).all()
    ]


async def read_user_assignment_submissions_me(
    request: Request,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "update", db_session)

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
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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
    await rbac_check(request, course.course_uuid, current_user, "delete", db_session)

    # Delete Assignment User Submission
    db_session.delete(assignment_user_submission)
    db_session.commit()

    return {"message": "Assignment User Submission deleted"}


## > Assignments Submissions Grading
async def grade_assignment_submission(
    request: Request,
    user_id: str,
    assignment_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):

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
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):

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
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
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

    # return OK
    return {"message": "Activity marked as done for user"}

async def get_assignments_from_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    # Find course
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Get Activities
    statement = select(Activity).where(Activity.course_id == course.id)
    activities = db_session.exec(statement).all()

    # Get Assignments
    assignments = []
    for activity in activities:
        statement = select(Assignment).where(Assignment.activity_id == activity.id)
        assignment = db_session.exec(statement).first()
        if assignment:
            assignments.append(assignment)

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # return assignments read
    return [AssignmentRead.model_validate(assignment) for assignment in assignments]


## 🔒 RBAC Utils ##


async def rbac_check(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
):

    if action == "read":
        if current_user.id == 0:  # Anonymous user
            res = await authorization_verify_if_element_is_public(
                request, course_uuid, action, db_session
            )
            return res
        else:
            res = (
                await authorization_verify_based_on_roles_and_authorship_and_usergroups(
                    request, current_user.id, action, course_uuid, db_session
                )
            )
            return res
    else:
        await authorization_verify_if_user_is_anon(current_user.id)

        await authorization_verify_based_on_roles_and_authorship_and_usergroups(
            request,
            current_user.id,
            action,
            course_uuid,
            db_session,
        )


## 🔒 RBAC Utils ##
