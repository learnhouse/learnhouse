from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from src.services.courses.peer_coursework import (
    submit_submission,
    get_submissions,
    assign_reviewer,
    get_reviews_for_reviewer,
    submit_review,
    get_feedback_for_student,
)

router = APIRouter(prefix="/courses/peer-coursework", tags=["peer-coursework"])


class SubmitSubmissionPayload(BaseModel):
    activity_id: str
    course_id: str
    student_id: str
    content: str


class AssignReviewerPayload(BaseModel):
    submission_id: str
    reviewer_id: str


class SubmitReviewPayload(BaseModel):
    submission_id: str
    reviewer_id: str
    feedback: str


@router.post("/submissions")
def create_submission(payload: SubmitSubmissionPayload):
    try:
        return submit_submission(
            activity_id=payload.activity_id,
            course_id=payload.course_id,
            student_id=payload.student_id,
            content=payload.content,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/submissions")
def list_submissions(course_id: str = Query(...)):
    return get_submissions(course_id)


@router.post("/assign")
def create_assignment(payload: AssignReviewerPayload):
    try:
        return assign_reviewer(
            submission_id=payload.submission_id,
            reviewer_id=payload.reviewer_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/reviews")
def list_reviews(reviewer_id: str = Query(...)):
    return get_reviews_for_reviewer(reviewer_id)


@router.post("/review-submit")
def create_review(payload: SubmitReviewPayload):
    try:
        return submit_review(
            submission_id=payload.submission_id,
            reviewer_id=payload.reviewer_id,
            feedback=payload.feedback,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/feedback")
def list_feedback(student_id: str = Query(...)):
    return get_feedback_for_student(student_id)