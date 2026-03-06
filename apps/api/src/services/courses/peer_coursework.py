from typing import Dict, List
from uuid import uuid4
from datetime import datetime

store = {
    "submissions": [],
    "reviews": [],
}

def submit_submission(activity_id: str, course_id: str, student_id: str, content: str):
    existing = next(
        (
            s for s in store["submissions"]
            if s["activity_id"] == activity_id and s["student_id"] == student_id
        ),
        None
    )

    if existing:
        raise ValueError("You have already submitted for this activity.")

    if not content.strip():
        raise ValueError("Submission content is required.")

    submission = {
        "id": str(uuid4()),
        "activity_id": activity_id,
        "course_id": course_id,
        "student_id": student_id,
        "content": content,
        "created_at": datetime.utcnow().isoformat(),
    }

    store["submissions"].append(submission)
    return submission

def get_submissions(course_id: str):
    return [s for s in store["submissions"] if s["course_id"] == course_id]

def assign_reviewer(submission_id: str, reviewer_id: str):
    submission = next((s for s in store["submissions"] if s["id"] == submission_id), None)

    if not submission:
        raise ValueError("Submission not found.")

    if submission["student_id"] == reviewer_id:
        raise ValueError("A student cannot review their own submission.")

    existing = next(
        (
            r for r in store["reviews"]
            if r["submission_id"] == submission_id and r["reviewer_id"] == reviewer_id
        ),
        None
    )

    if existing:
        raise ValueError("This reviewer is already assigned.")

    review = {
        "id": str(uuid4()),
        "submission_id": submission_id,
        "reviewer_id": reviewer_id,
        "feedback": None,
        "created_at": datetime.utcnow().isoformat(),
    }

    store["reviews"].append(review)
    return review

def get_reviews_for_reviewer(reviewer_id: str):
    result = []

    for review in store["reviews"]:
        if review["reviewer_id"] != reviewer_id:
            continue

        submission = next(
            (s for s in store["submissions"] if s["id"] == review["submission_id"]),
            None
        )

        result.append({
            "review_id": review["id"],
            "submission_id": review["submission_id"],
            "feedback": review["feedback"],
            "submission": submission,
        })

    return result

def submit_review(submission_id: str, reviewer_id: str, feedback: str):
    review = next(
        (
            r for r in store["reviews"]
            if r["submission_id"] == submission_id and r["reviewer_id"] == reviewer_id
        ),
        None
    )

    if not review:
        raise ValueError("Review assignment not found.")

    if not feedback.strip():
        raise ValueError("Feedback is required.")

    review["feedback"] = feedback
    return review

def get_feedback_for_student(student_id: str):
    student_submissions = [s for s in store["submissions"] if s["student_id"] == student_id]

    result = []
    for submission in student_submissions:
        reviews = [
            {
                "review_id": r["id"],
                "reviewer_id": r["reviewer_id"],
                "feedback": r["feedback"],
                "created_at": r["created_at"],
            }
            for r in store["reviews"]
            if r["submission_id"] == submission["id"]
        ]

        result.append({
            "submission": submission,
            "reviews": reviews,
        })

    return result