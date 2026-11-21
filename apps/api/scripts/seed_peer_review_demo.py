"""Seed a peer review demo into a local LearnHouse database. Local use only.

    cd apps/api && uv run python scripts/seed_peer_review_demo.py <org_slug> <course_uuid>

Creates, inside the first chapter of the course:

- an assignment activity "Peer review demo: persuasive op-ed" with one
  SHORT_ANSWER writing task, published, peer review ON (3 reviews each,
  double-blind, self-review, practice round, helpfulness, revision plan,
  suggest-grade mode);
- a 4-criterion rubric and 2 instructor-scored practice samples;
- 5 learners (password from ``PEER_DEMO_PASSWORD``) with written, submitted op-eds;
- reviews that put every state on screen: practice done by most learners, a
  self-review, submitted peer reviews (one rated helpful, one flagged), an
  open assigned review, and a learner with nothing reviewed yet.

Learner logins: peer.demo1@example.test … peer.demo5@example.test. Run again
to add another copy (uuids are fresh each time; emails get a suffix if taken).
"""

import asyncio
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402
from sqlmodel import select  # noqa: E402
from sqlmodel.ext.asyncio.session import AsyncSession  # noqa: E402

from config.config import get_learnhouse_config  # noqa: E402
from src.core.migrations import load_models  # noqa: E402

load_models()

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum  # noqa: E402
from src.db.courses.assignments import (  # noqa: E402
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity  # noqa: E402
from src.db.courses.course_chapters import CourseChapter  # noqa: E402
from src.db.courses.courses import Course  # noqa: E402
from src.db.courses.peer_reviews import (  # noqa: E402
    AssignmentPeerReflection,
    AssignmentPeerReview,
    AssignmentPeerReviewSettings,
)
from src.db.organizations import Organization  # noqa: E402
from src.db.roles import Role  # noqa: E402
from src.db.user_organizations import UserOrganization  # noqa: E402
from src.db.users import User  # noqa: E402
from src.security.security import security_hash_password  # noqa: E402

# Learner password for the local demo; never printed.
PASSWORD = os.environ.get("PEER_DEMO_PASSWORD", "")

RUBRIC = [
    {"id": "thesis", "title": "Clear position", "description": "The reader knows what you argue and why it matters.", "levels": [
        {"id": "thesis_0", "points": 0, "label": "Missing", "description": "No clear position."},
        {"id": "thesis_1", "points": 1, "label": "Vague", "description": "A position, but hedged or buried."},
        {"id": "thesis_2", "points": 2, "label": "Clear", "description": "Stated early and plainly."},
        {"id": "thesis_3", "points": 3, "label": "Sharp", "description": "Clear, specific and framed for the reader."},
    ]},
    {"id": "evidence", "title": "Evidence", "description": "Claims are backed by facts, examples or sources.", "levels": [
        {"id": "evidence_0", "points": 0, "label": "None", "description": "Opinion only."},
        {"id": "evidence_1", "points": 1, "label": "Thin", "description": "One example, loosely tied in."},
        {"id": "evidence_2", "points": 2, "label": "Solid", "description": "Several relevant examples."},
        {"id": "evidence_3", "points": 3, "label": "Compelling", "description": "Specific, varied, well chosen."},
    ]},
    {"id": "counter", "title": "Counterargument", "description": "Takes the other side seriously.", "levels": [
        {"id": "counter_0", "points": 0, "label": "Ignored", "description": "No other view mentioned."},
        {"id": "counter_1", "points": 1, "label": "Named", "description": "Mentioned, not answered."},
        {"id": "counter_2", "points": 2, "label": "Answered", "description": "Stated fairly and rebutted."},
    ]},
    {"id": "style", "title": "Style and structure", "description": "Easy to follow, with a strong opening and close.", "levels": [
        {"id": "style_0", "points": 0, "label": "Hard to follow", "description": "No clear order."},
        {"id": "style_1", "points": 1, "label": "Readable", "description": "Ordered, a few rough patches."},
        {"id": "style_2", "points": 2, "label": "Polished", "description": "Flows well, strong hook and ending."},
    ]},
]

SAMPLES = [
    {
        "id": "sample_school_start",
        "title": "Practice 1: Later school start times",
        "content": (
            "Schools should start at 9:30. Teenagers' body clocks shift later during puberty, and the American "
            "Academy of Pediatrics recommends no earlier than 8:30. When Seattle moved its start time, students "
            "slept 34 minutes more and grades rose. Some parents worry about work schedules, but staggered bus "
            "routes and before-school clubs solve most of that. Rested students learn more; let them sleep."
        ),
        "scores": {"thesis": "thesis_3", "evidence": "evidence_2", "counter": "counter_2", "style": "style_1"},
        "explanation": (
            "The position is stated in the first sentence and stays in focus. Two concrete pieces of evidence, "
            "though the Seattle claim needs a source to reach 'Compelling'. The parents' concern is stated fairly "
            "and answered. The ending is abrupt, so style is 'Readable'."
        ),
    },
    {
        "id": "sample_phones",
        "title": "Practice 2: Phones in class",
        "content": (
            "Phones are bad and everyone knows it. They are distracting and annoying. Teachers hate them. "
            "Students should not have them. In conclusion phones should be banned because they are bad."
        ),
        "scores": {"thesis": "thesis_1", "evidence": "evidence_0", "counter": "counter_0", "style": "style_0"},
        "explanation": (
            "There is a position, but 'bad' is never made specific. No evidence beyond assertion, no other view, "
            "and the conclusion repeats the opening. A good model of what to push a classmate past."
        ),
    },
]

LEARNERS = [
    ("Maya", "Okafor",
     "Our town should turn Main Street into a car-free zone on weekends. When Pontevedra in Spain closed its "
     "center to cars, retail footfall rose and traffic deaths fell to zero over a decade. Our own street fair "
     "last June brought the busiest Saturday the bakery had all year. Shop owners fear losing drivers, but the "
     "two parking lots behind the library sit half empty on weekends and are a four-minute walk away. A pilot "
     "of six weekends would let us measure sales instead of guessing. Give the street back to people."),
    ("Leo", "Fischer",
     "Homework in primary school should be optional. Studies summarized by Harris Cooper find almost no link "
     "between homework and achievement before age eleven, while family time and sleep clearly matter. Some "
     "argue homework builds discipline; reading for twenty minutes a night builds it too, with far less "
     "conflict at the kitchen table. Make the worksheets optional and keep the reading."),
    ("Aisha", "Rahman",
     "Every school canteen should serve a free plant-based lunch option. It is cheaper per portion, it suits "
     "students with religious or allergy needs, and it cuts the canteen's carbon footprint. A lot of people say "
     "kids won't eat it. Honestly I think they will if it tastes good. Our school should try it next term."),
    ("Tomás", "Silva",
     "Video games should count as a sport at school. Esports teams need practice, teamwork and strategy just "
     "like football. Many universities now give esports scholarships. It would also bring in students who "
     "don't play other sports. Games are fun and schools should accept that."),
    ("Hana", "Kobayashi",
     "Libraries should stay open until midnight during exam season. Many students share small apartments with "
     "no quiet place to work, and a cafe is not free. When our university extended hours last spring, the late "
     "shift was full every night. Staffing costs money, but volunteers and student workers could cover it, and "
     "the cost is small next to failing grades. Keep the lights on when students need them most."),
]

GOOD = {
    "strength": "Your opening states the position right away, and the local example makes it feel real and specific.",
    "suggestion": "Add a source for the main statistic and answer the strongest objection in one more paragraph.",
    "question": "What would convince someone who disagrees with you completely?",
}
SHORT = {
    "strength": "The topic is interesting and the paragraph is easy to read from start to finish.",
    "suggestion": "Back up the main claim with at least one concrete example or number so it persuades.",
    "question": "",
}
LAZY = {
    "strength": "It is good. I liked it a lot and I think it is pretty good overall to be honest.",
    "suggestion": "Maybe make it better somehow. I don't really know what to change in this one.",
    "question": "",
}


def ts(days_ago: float = 0, hours_ago: float = 0) -> str:
    return str(datetime.now() - timedelta(days=days_ago, hours=hours_ago))


async def unique_email(db: AsyncSession, email: str) -> str:
    candidate, n = email, 1
    while (await db.execute(select(User).where(User.email == candidate))).scalars().first():
        n += 1
        local, domain = email.split("@")
        candidate = f"{local}+{n}@{domain}"
    return candidate


async def seed(org_slug: str, course_uuid: str) -> None:
    url = get_learnhouse_config().database_config.sql_connection_string
    engine = create_async_engine(url)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as db:
        org = (await db.execute(select(Organization).where(Organization.slug == org_slug))).scalars().first()
        if org is None:
            raise SystemExit(f"No organization with slug {org_slug!r}")
        course = (await db.execute(
            select(Course).where(Course.course_uuid == course_uuid, Course.org_id == org.id)
        )).scalars().first()
        if course is None:
            raise SystemExit(f"No course {course_uuid!r} in {org_slug!r}")
        link = (await db.execute(
            select(CourseChapter).where(CourseChapter.course_id == course.id).order_by(CourseChapter.order)
        )).scalars().first()
        if link is None:
            raise SystemExit("The course needs at least one chapter")
        role = (await db.execute(select(Role).where(Role.role_uuid == "role_global_user"))).scalars().first()
        if role is None:
            raise SystemExit("Missing the built-in user role (role_global_user)")

        now = ts()
        activity = Activity(
            name="Peer review demo: persuasive op-ed",
            activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY,
            content={}, published=True, org_id=org.id, course_id=course.id,
            activity_uuid=f"activity_{uuid4()}", creation_date=now, update_date=now,
        )
        db.add(activity)
        await db.flush()
        last = (await db.execute(
            select(ChapterActivity).where(ChapterActivity.chapter_id == link.chapter_id)
            .order_by(ChapterActivity.order.desc())  # type: ignore[union-attr]
        )).scalars().first()
        db.add(ChapterActivity(
            chapter_id=link.chapter_id, activity_id=activity.id, course_id=course.id, org_id=org.id,
            order=(last.order + 1) if last else 1, creation_date=now, update_date=now,
        ))
        assignment = Assignment(
            title="Persuasive op-ed",
            description="Write a 150-250 word op-ed arguing for one change in your school or town.",
            due_date=(datetime.now() + timedelta(days=7)).date().isoformat(),
            published=True, grading_type=GradingTypeEnum.PERCENTAGE,
            org_id=org.id, course_id=course.id, chapter_id=link.chapter_id, activity_id=activity.id,
            assignment_uuid=f"assignment_{uuid4()}", creation_date=now, update_date=now,
        )
        db.add(assignment)
        await db.flush()
        task = AssignmentTask(
            title="Your op-ed", description="Pick one change and argue for it.",
            hint="Open with your position, give evidence, answer one objection.",
            assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
            contents={"prompt": "Write your op-ed (150-250 words).", "correct_answers": [], "match_mode": "manual"},
            max_grade_value=100, order=0,
            assignment_id=assignment.id, org_id=org.id, course_id=course.id, chapter_id=link.chapter_id,
            activity_id=activity.id, assignment_task_uuid=f"assignmenttask_{uuid4()}",
            creation_date=now, update_date=now,
        )
        db.add(task)
        db.add(AssignmentPeerReviewSettings(
            assignment_id=assignment.id, org_id=org.id, enabled=True, reviews_required=3,
            require_reviews_to_see_feedback=True,
            review_due_date=(datetime.now() + timedelta(days=10)).date().isoformat(),
            anonymity="double_blind", self_review_enabled=True, calibration_enabled=True,
            helpfulness_enabled=True, revision_plan_enabled=True, prompts=None, rubric=RUBRIC,
            score_mode="suggest_grade", min_reviews_for_score=2, calibration_samples=SAMPLES,
            creation_date=now, update_date=now,
        ))
        await db.flush()

        users = []
        password = security_hash_password(PASSWORD)
        for i, (first, last_name, essay) in enumerate(LEARNERS, start=1):
            email = await unique_email(db, f"peer.demo{i}@example.test")
            user = User(
                username=f"peerdemo{i}_{uuid4().hex[:6]}", first_name=first, last_name=last_name,
                email=email, password=password, user_uuid=f"user_{uuid4()}",
                email_verified=True, creation_date=now, update_date=now,
            )
            db.add(user)
            await db.flush()
            db.add(UserOrganization(user_id=user.id, org_id=org.id, role_id=role.id, creation_date=now, update_date=now))
            submitted = ts(days_ago=6 - i)
            db.add(AssignmentUserSubmission(
                user_id=user.id, assignment_id=assignment.id, grade=0,
                submission_status=AssignmentUserSubmissionStatus.SUBMITTED, attempt_number=1,
                assignmentusersubmission_uuid=f"assignmentusersubmission_{uuid4()}",
                creation_date=submitted, update_date=submitted,
            ))
            db.add(AssignmentTaskSubmission(
                assignment_task_submission_uuid=f"assignmenttasksubmission_{uuid4()}",
                task_submission={"answer": essay}, grade=0, task_submission_grade_feedback="",
                assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER, user_id=user.id,
                activity_id=activity.id, course_id=course.id, chapter_id=link.chapter_id,
                assignment_task_id=task.id, creation_date=submitted, update_date=submitted,
            ))
            users.append((user, email))
        await db.flush()

        def review(reviewer, reviewee, *, kind="peer", status="submitted", scores=None, comments=None,
                   sample=None, hours_ago=20.0, **extra):
            at = ts(hours_ago=hours_ago)
            db.add(AssignmentPeerReview(
                review_uuid=f"peerreview_{uuid4()}", assignment_id=assignment.id, org_id=org.id,
                reviewer_user_id=reviewer.id, reviewee_user_id=reviewee.id if reviewee else None,
                kind=kind, calibration_sample_id=sample, attempt_number=1, status=status,
                scores=scores or {}, comments=comments or {}, criterion_comments={},
                assigned_at=at, submitted_at=at if status == "submitted" else None,
                creation_date=at, update_date=at, **extra,
            ))

        u = [user for user, _ in users]
        strong = {"thesis": "thesis_3", "evidence": "evidence_3", "counter": "counter_2", "style": "style_2"}
        mid = {"thesis": "thesis_2", "evidence": "evidence_2", "counter": "counter_1", "style": "style_1"}
        weak = {"thesis": "thesis_1", "evidence": "evidence_1", "counter": "counter_0", "style": "style_1"}

        # Practice round: learners 1-4 did both samples (learner 4 off by a lot), learner 5 none.
        for learner, off in ((u[0], False), (u[1], False), (u[2], False), (u[3], True)):
            for sample in SAMPLES:
                scores = dict(sample["scores"])
                if off:
                    scores = {"thesis": "thesis_3", "evidence": "evidence_3", "counter": "counter_2", "style": "style_2"}
                review(learner, None, kind="calibration", sample=sample["id"], scores=scores, hours_ago=30)

        # Self-reviews: learners 1 and 2.
        review(u[0], u[0], kind="self", scores=strong, comments={"strength": "Concrete local evidence."}, hours_ago=28)
        review(u[1], u[1], kind="self", scores=mid, hours_ago=27)

        # Learner 1 (Maya) did 3 reviews, so her feedback is unlocked; she got 3.
        review(u[0], u[1], scores=mid, comments=GOOD, hours_ago=26)
        review(u[0], u[2], scores=weak, comments=GOOD, hours_ago=25)
        review(u[0], u[3], scores=weak, comments=SHORT, hours_ago=24)
        review(u[1], u[0], scores=strong, comments=GOOD, hours_ago=22, helpfulness=5, helpfulness_note="Very specific, thanks!")
        review(u[2], u[0], scores=mid, comments=SHORT, hours_ago=21, helpfulness=3)
        review(u[3], u[0], scores=strong, comments=LAZY, hours_ago=20, flagged=True,
               flag_reason="This review doesn't say anything about my essay.")
        # Learner 2 (Leo) did 2 reviews and has one open; locked until the third.
        review(u[1], u[2], scores=mid, comments=GOOD, hours_ago=19)
        review(u[1], u[4], status="assigned", hours_ago=2)
        review(u[2], u[1], scores=strong, comments=GOOD, hours_ago=18)
        # Learner 3 (Aisha) did 1 review. Learner 5 (Hana) has done nothing yet.
        await db.flush()
        db.add(AssignmentPeerReflection(
            assignment_id=assignment.id, org_id=org.id, user_id=u[0].id,
            plan="Add a source for the Pontevedra numbers and a paragraph answering the shop owners.",
            creation_date=now, update_date=now,
        ))
        await db.commit()

    await engine.dispose()
    print(f"Assignment: {assignment.assignment_uuid}  (activity {activity.activity_uuid})")
    print("Learner password: the value of PEER_DEMO_PASSWORD")
    for (user, email), state in zip(users, (
        "feedback unlocked: 3 reviews received (one flagged), revision plan written",
        "2 of 3 reviews done, one open; feedback locked",
        "1 review done",
        "practice scores far from the instructor's (calibration deviation)",
        "nothing done yet: start with the practice round",
    )):
        print(f"  {email}: {user.first_name} {user.last_name}, {state}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    if len(PASSWORD) < 8:
        raise SystemExit("Set PEER_DEMO_PASSWORD (8+ characters) for the demo learners.")
    os.environ.setdefault("LEARNHOUSE_ENV", "dev")
    asyncio.run(seed(sys.argv[1], sys.argv[2]))
