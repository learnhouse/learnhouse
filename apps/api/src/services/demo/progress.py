"""Deriving the demo's learners and their progress.

Pure functions with no database access. Everything is a deterministic function
of the student's index, the bundle, and the ``content_epoch`` — which is what
makes an hourly refresh a no-op: recomputing the target state produces exactly
the values already stored, so the reconcile writes nothing.

The epoch is a date string that rolls forward once a day. Anchoring to it,
rather than to ``now``, is the whole trick. If the timeline were recomputed
from the current time on every tick, every backdated timestamp would change
hourly and the refresh would rewrite thousands of rows.
"""

import hashlib
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

from src.services.demo.bundle_loader import Bundle, PersonaSpec
from src.services.demo.flags import DEMO_EMAIL_DOMAIN

# How far back the demo's history stretches. Long enough that the activity
# timeline and the month-to-date figures both have something in them.
HISTORY_DAYS = 45


@dataclass(frozen=True)
class StudentPlan:
    """Everything derived about one fake learner."""

    index: int
    bundle_key: str
    first_name: str
    last_name: str
    email: str
    username: str
    avatar: Optional[str]
    persona: PersonaSpec
    cohort_key: str
    course_keys: list[str]
    completion: dict[str, float]  # course key -> fraction of activities completed
    joined_days_ago: int


# Name parts chosen to be unremarkable and clearly fictional in combination.
# Not drawn from a real directory, and never a recognisable public figure.
_FIRST_NAMES = [
    "Amara", "Benoit", "Carys", "Dmitri", "Elif", "Fabian", "Greta", "Hugo",
    "Ines", "Jonas", "Kaisa", "Lucian", "Marta", "Nadia", "Otto", "Petra",
    "Quentin", "Rosa", "Stefan", "Tomas", "Ursula", "Viktor", "Wren", "Xavi",
    "Yara", "Zofia", "Anton", "Brigid", "Cato", "Dara", "Emil", "Frida",
    "Gideon", "Hana", "Ivo", "Juno", "Kes", "Liv", "Mattias", "Noor",
]
_LAST_NAMES = [
    "Aldridge", "Boateng", "Castellan", "Dunmore", "Eriksen", "Farrow",
    "Girard", "Halloway", "Ibsen", "Jarvis", "Kovac", "Lindqvist", "Moreau",
    "Nowak", "Oyelaran", "Pereira", "Quilty", "Ravenna", "Sandoval", "Thorne",
    "Ulriksen", "Vasquez", "Wexford", "Yilmaz", "Ziegler", "Ashworth",
    "Bramley", "Caradec", "Delacroix", "Eastman", "Fenwick", "Grimaldi",
    "Hartline", "Ingram", "Jourdain", "Kingsley", "Lamotte", "Merrick",
    "Nystrom", "Okonkwo",
]


def epoch_for(today: date) -> str:
    """The content epoch for a given day. Rolls at midnight UTC."""
    return today.isoformat()


def epoch_date(epoch: str) -> date:
    return date.fromisoformat(epoch)


def _seed_for(epoch: str, salt: str = "") -> int:
    """A stable integer seed derived from the epoch.

    Uses sha256 rather than hash(): Python salts str hashing per process, so
    hash() would give a different demo on every restart.
    """
    digest = hashlib.sha256(f"{epoch}|{salt}".encode("utf-8")).hexdigest()
    return int(digest[:16], 16)


def _pick_persona(personas: list[PersonaSpec], rng: random.Random) -> PersonaSpec:
    total = sum(p.weight for p in personas)
    roll = rng.randrange(total)
    running = 0
    for persona in personas:
        running += persona.weight
        if roll < running:
            return persona
    return personas[-1]


def plan_students(bundle: Bundle, epoch: str) -> list[StudentPlan]:
    """Derive every fake learner and what they have done.

    Deterministic for a given (bundle, epoch): same inputs, same forty people
    with the same progress.
    """
    manifest = bundle.manifest
    course_keys = [course.slug for course in bundle.courses]
    cohorts = manifest.cohorts

    # Cohort assignment is by position rather than by random draw so the three
    # cohorts always come out at their declared sizes. A weighted draw would
    # leave them lumpy, and "Team Leads" containing nineteen people reads wrong.
    cohort_for_index: list[str] = []
    for cohort in cohorts:
        cohort_for_index.extend(
            [cohort.slug] * round(cohort.share * manifest.students.count)
        )
    while len(cohort_for_index) < manifest.students.count:
        cohort_for_index.append(cohorts[-1].slug)

    plans: list[StudentPlan] = []
    for index in range(manifest.students.count):
        rng = random.Random(_seed_for(epoch, f"student-{index}"))
        persona = _pick_persona(manifest.personas, rng)

        enrolled_count = rng.randint(persona.min_courses, persona.max_courses)
        enrolled_count = min(enrolled_count, len(course_keys))
        enrolled = rng.sample(course_keys, enrolled_count)
        # Keep catalogue order so a learner's course list reads naturally.
        enrolled.sort(key=course_keys.index)

        completion = {}
        for course_key in enrolled:
            completion[course_key] = rng.uniform(
                persona.min_completion, persona.max_completion
            )

        first = _FIRST_NAMES[index % len(_FIRST_NAMES)]
        last = _LAST_NAMES[(index * 7 + 3) % len(_LAST_NAMES)]

        avatar = None
        if index < manifest.students.with_avatar:
            avatar = f"a{(index % manifest.students.avatar_count) + 1:02d}.webp"

        plans.append(
            StudentPlan(
                index=index,
                bundle_key=f"student-{index:02d}",
                first_name=first,
                last_name=last,
                email=f"demo-{index:02d}@{DEMO_EMAIL_DOMAIN}",
                username=f"demo_{first.lower()}_{last.lower()}",
                avatar=avatar,
                persona=persona,
                cohort_key=cohort_for_index[index],
                course_keys=enrolled,
                completion=completion,
                joined_days_ago=rng.randint(10, HISTORY_DAYS + 90),
            )
        )
    return plans


def completed_activity_count(total_activities: int, fraction: float) -> int:
    """How many activities a learner has finished.

    A prefix of the course, not a random sample: real progress is sequential,
    and it is what makes the drop-off chart read as a curve rather than noise.
    """
    if total_activities <= 0 or fraction <= 0:
        return 0
    from math import ceil

    return min(total_activities, ceil(fraction * total_activities))


def step_timestamp(epoch: str, plan: StudentPlan, course_key: str, position: int) -> str:
    """When a learner completed the activity at `position` in a course.

    Monotonically increasing within a course so a learner's timeline reads in
    order, and spread across the history window so the activity chart is not a
    flat wall.
    """
    rng = random.Random(_seed_for(epoch, f"step-{plan.index}-{course_key}"))
    start_offset = rng.randint(2, HISTORY_DAYS)
    # Later activities are more recent. The spacing is jittered per learner so
    # forty timelines do not line up in lockstep.
    spacing = rng.uniform(0.3, 1.4)
    days_ago = max(0.0, start_offset - position * spacing)

    anchor = datetime.combine(epoch_date(epoch), datetime.min.time())
    when = anchor - timedelta(days=days_ago)
    # Push it into working hours so the activity heatmap is not uniform.
    when = when.replace(
        hour=rng.randint(8, 18), minute=rng.randint(0, 59), second=rng.randint(0, 59)
    )
    return str(when)


def grade_for(plan: StudentPlan, epoch: str, course_key: str, max_grade: int) -> int:
    """A learner's raw grade on one task, within their persona's band."""
    persona = plan.persona
    if persona.assignments != "graded":
        return 0
    rng = random.Random(_seed_for(epoch, f"grade-{plan.index}-{course_key}"))
    percentage = rng.randint(persona.min_grade_pct, persona.max_grade_pct)
    return round(max_grade * percentage / 100)


def submission_template_for(plan: StudentPlan, epoch: str, course_key: str) -> str:
    """Which authored answer this learner gave: correct, partial or incorrect.

    Chosen to match the grade band so the grading UI and the score agree — a
    submission showing three right answers next to a mark of 38% is the kind of
    detail that makes a demo feel fake.
    """
    persona = plan.persona
    if persona.assignments != "graded":
        return "partial"
    midpoint = (persona.min_grade_pct + persona.max_grade_pct) / 2
    if midpoint >= 80:
        return "correct"
    if midpoint >= 60:
        return "partial"
    return "incorrect"


def submission_status_for(plan: StudentPlan, epoch: str, course_key: str) -> str:
    """GRADED, SUBMITTED, LATE or NOT_SUBMITTED for one learner's assignment.

    Most are graded, but a visible queue of ungraded submissions is deliberate:
    the grading inbox is the most compelling screen in the product, and an
    empty one shows a prospect nothing.
    """
    persona = plan.persona
    if persona.assignments == "none":
        return "NOT_SUBMITTED"
    if persona.assignments == "pending":
        return "SUBMITTED"

    rng = random.Random(_seed_for(epoch, f"status-{plan.index}-{course_key}"))
    roll = rng.random()
    if roll < 0.12:
        return "SUBMITTED"
    if roll < 0.18:
        return "LATE"
    return "GRADED"


def activity_days(epoch: str, plan: StudentPlan) -> list[date]:
    """The distinct days this learner was seen.

    Feeds UserActivityDay, which drives the members table's visit counts. Demo
    orgs are excluded from active-user billing, so these rows are safe — that
    exclusion is not optional.
    """
    rng = random.Random(_seed_for(epoch, f"days-{plan.index}"))
    if plan.persona.id == "lurker":
        count = rng.randint(1, 3)
    elif plan.persona.id == "dropped":
        count = rng.randint(2, 6)
    else:
        count = rng.randint(4, 18)

    anchor = epoch_date(epoch)
    days = {anchor - timedelta(days=rng.randint(0, HISTORY_DAYS)) for _ in range(count)}
    return sorted(days)
