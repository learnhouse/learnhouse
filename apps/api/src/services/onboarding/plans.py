"""What the plan picker shows: real plans, their limits and what each adds.

Everything comes from plans.py (the same source the gates use): which plans
exist, their course/member/seat/AI limits, and the features each plan adds
over the one before it. Prices stay with Stripe (the web app overlays them);
this only answers "what do I get", "what is recommended for my goal" and
"where am I now".
"""

from typing import Optional

from src.security.features_utils.plans import AI_CREDIT_LIMITS, PLAN_FEATURE_CONFIGS, PLAN_HIERARCHY
from src.services.onboarding import goals as goal_defs
from src.services.orgs.plan_overview import FEATURE_AREAS, _plan_has

# The plans an organization picks from. Personal tiers are for one person's
# own learning space and stay on the billing page.
PICKER_PLANS = ("free", "standard", "pro", "enterprise")
# Sold through a conversation, not a checkout.
CONTACT_PLANS = frozenset({"enterprise"})


def _limits(plan: str) -> dict:
    features = PLAN_FEATURE_CONFIGS[plan]["features"]
    return {
        "courses": features["courses"]["limit"],
        "members": features["members"]["limit"],
        "admin_seats": features["members"].get("admin_limit", 0),
        "ai_credits": AI_CREDIT_LIMITS.get(plan, 0),
    }


def _features(plan: str) -> set[str]:
    return {key for keys in FEATURE_AREAS.values() for key in keys if _plan_has(plan, key)}


def picker(current_plan: Optional[str], goal: Optional[str]) -> dict:
    shown = [p for p in PLAN_HIERARCHY if p in PICKER_PLANS or p == current_plan]
    recommended = goal_defs.recommended_plan(goal)
    plans = []
    previous: set[str] = set()
    for plan in shown:
        have = _features(plan)
        plans.append({
            "id": plan,
            "limits": _limits(plan),
            # In the order the plan page groups them, so the list reads well.
            "unlocks": [k for keys in FEATURE_AREAS.values() for k in keys if k in have and k not in previous],
            "contact_sales": plan in CONTACT_PLANS,
            "current": plan == current_plan,
            "recommended": plan == recommended and plan != current_plan,
        })
        previous = have
    current_rank = PLAN_HIERARCHY.index(current_plan) if current_plan in PLAN_HIERARCHY else 0
    return {
        "current_plan": current_plan,
        "recommended_plan": recommended,
        "goal": goal,
        "can_continue_free": current_plan in (None, "free"),
        "upgrades": [p["id"] for p in plans if PLAN_HIERARCHY.index(p["id"]) > current_rank],
        "plans": plans,
    }
