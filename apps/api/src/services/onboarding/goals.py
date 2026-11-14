"""What an admin can say they are building, and what that changes.

A goal never hides anything. It orders the setup checklist, picks the website
template and starter course offered at signup, and decides which plan the
picker recommends: the cheapest plan in plans.py that has every feature the
goal leans on, so the recommendation can't drift from the real gates.
"""

from typing import Optional

from src.security.features_utils.plans import FEATURE_PLAN_REQUIREMENTS, PLAN_HIERARCHY

# Setup steps. ``kind`` "data" completes from the org's own rows (a course, a
# lesson, a logo...); "click" completes when the admin does it (there is no row
# to look at). ``feature`` is the plan feature the step needs, so a step that
# the plan doesn't include shows the plan that unlocks it instead of a page
# that refuses. ``minutes`` is the honest time it takes.
STEPS: dict[str, dict] = {
    "create_course": {"kind": "data", "feature": None, "minutes": 2},
    "add_content": {"kind": "data", "feature": None, "minutes": 5},
    "publish_course": {"kind": "data", "feature": None, "minutes": 1},
    "brand_school": {"kind": "data", "feature": None, "minutes": 2},
    # Publish the homepage: done when it is live; clicking also counts (orgs
    # from before the website builder).
    "share_grow": {"kind": "click", "feature": None, "minutes": 2},
    "invite_learners": {"kind": "data", "feature": None, "minutes": 2},
    "build_community": {"kind": "data", "feature": "communities", "minutes": 2},
    "create_group": {"kind": "data", "feature": "usergroups", "minutes": 2},
    "setup_payments": {"kind": "click", "feature": "payments", "minutes": 5},
}

DEFAULT_STEPS = ["create_course", "add_content", "brand_school", "publish_course", "share_grow", "invite_learners"]

# ``template`` is a website template id from services/landing/templates.
GOALS: dict[str, dict] = {
    "sell": {
        "template": "coach",
        "features": ["payments", "analytics"],
        "steps": ["create_course", "add_content", "brand_school", "setup_payments", "publish_course", "share_grow"],
    },
    "team": {
        "template": "corporate",
        "features": ["usergroups", "analytics", "required_training"],
        "steps": ["create_course", "add_content", "publish_course", "create_group", "invite_learners", "brand_school"],
    },
    "school": {
        "template": "university",
        "features": ["usergroups", "communities", "certifications"],
        "steps": ["create_course", "add_content", "publish_course", "create_group", "invite_learners", "build_community"],
    },
    "customers": {
        "template": "partner",
        "features": ["analytics", "seo"],
        "steps": ["create_course", "add_content", "brand_school", "publish_course", "share_grow", "invite_learners"],
    },
    "community": {
        "template": "membership",
        "features": ["communities", "podcasts"],
        "steps": ["create_course", "add_content", "build_community", "publish_course", "invite_learners", "brand_school"],
    },
}

GOAL_IDS = tuple(GOALS)

# Template used when no goal was picked.
DEFAULT_TEMPLATE = "academy"


def is_goal(value: Optional[str]) -> bool:
    return value in GOALS


def steps_for(goal: Optional[str]) -> list[str]:
    return list(GOALS[goal]["steps"]) if goal in GOALS else list(DEFAULT_STEPS)


def template_for(goal: Optional[str]) -> str:
    return GOALS[goal]["template"] if goal in GOALS else DEFAULT_TEMPLATE


def recommended_plan(goal: Optional[str]) -> str:
    """The cheapest plan with every feature the goal needs ("standard" without a goal)."""
    features = GOALS[goal]["features"] if goal in GOALS else ["analytics"]
    rank = max(PLAN_HIERARCHY.index(FEATURE_PLAN_REQUIREMENTS[f]) for f in features)
    return PLAN_HIERARCHY[rank]
