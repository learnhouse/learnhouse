"""
The nudge catalog: which email fires, for whom, and when.

Each entry is a pure declaration. The runner is generic over them, so adding a
nudge means adding a ``NudgeSpec`` and its copy — never touching the send loop.

Two properties are load-bearing:

``day_max`` — every window has an upper bound. This is what makes a backfill
over years of existing organizations safe: an org created 400 days ago cannot
match a "day 1" activation nudge, so switching the system on does not blast the
entire history with the whole catalog. Only the dormancy track deliberately has
no upper bound on org age, and it is the sparsest track by design.

Windows are at least two days wide. Most of the timestamps behind them are
naive strings written by whichever pod handled the request, so they are
accurate to about a day; a one-day window would flip on clock skew alone.

One interaction worth knowing: a spec with ``suppress_if_active`` cannot fire
inside ``ACTIVE_WINDOW_DAYS`` of the org's last engagement. Where the anchor is
*itself* an engagement signal (a course was created, a lesson was written), the
earliest the nudge can actually send is that window — so those specs declare a
``day_min`` of at least ``ACTIVE_WINDOW_DAYS`` rather than a smaller number
that would never be reached. Activation and dormancy are unaffected: they
anchor on org creation and on inactivity respectively, neither of which is
engagement.
"""

from dataclasses import dataclass
from typing import Callable, Optional

from src.security.features_utils.plans import (
    AI_CREDIT_LIMITS,
    PLAN_HIERARCHY,
    PLAN_LIMITS,
)
from src.services.nudges import links
from src.services.nudges.snapshot import OrgSnapshot

# Tracks, in the order they claim an admin's daily slot when several fire at
# once. Earlier means more urgent.
TRACK_ACTIVATION = "activation"
TRACK_CONTENT = "content"
TRACK_AUDIENCE = "audience"
TRACK_MONETIZATION = "monetization"
TRACK_DORMANCY = "dormancy"
TRACK_MILESTONE = "milestone"
TRACK_REACTIVATION = "reactivation"


@dataclass(frozen=True)
class NudgeSpec:
    """One nudge: when it fires, what it links to, how often it may repeat."""

    id: str
    track: str
    day_min: int
    day_max: int
    # Which snapshot timestamp the window is measured from. ``None`` means the
    # predicate does its own timing (dormancy measures from last_touch).
    anchor: Callable[[OrgSnapshot], Optional[float]]
    predicate: Callable[[OrgSnapshot], bool]
    cta: Callable[[OrgSnapshot, str], str]
    # None = once per org, ever. "quarterly" = at most once per calendar
    # quarter, so a long-dormant org hears from us four times a year at most.
    repeat: Optional[str] = None
    suppress_if_active: bool = True
    priority: int = 50
    # Some nudges are a genuine question rather than a call to action; those
    # render without a button so a reply is the obvious response.
    has_cta: bool = True

    def window_matches(self, snapshot: OrgSnapshot) -> bool:
        age = self.anchor(snapshot)
        if age is None:
            return False
        return self.day_min <= age <= self.day_max

    def matches(self, snapshot: OrgSnapshot) -> bool:
        if self.suppress_if_active and snapshot.org_active:
            return False
        if not self.window_matches(snapshot):
            return False
        return self.predicate(snapshot)


# --------------------------------------------------------------------------
# Plan helpers — read at match time, never hardcoded into copy.
#
# The limits are not monotonic across tiers (free allows 10 members, personal
# allows 1), so any threshold typed as a literal would be wrong for most plans
# and silently wrong for the rest as soon as the config changes.
# --------------------------------------------------------------------------


def plan_limit(plan: str, resource: str) -> int:
    """Limit for a resource on a plan. ``0`` means unlimited."""
    return PLAN_LIMITS.get(plan, PLAN_LIMITS["free"]).get(resource, 0)


def next_plan(plan: str) -> Optional[str]:
    """The tier above this one, or None at the top of the hierarchy."""
    try:
        index = PLAN_HIERARCHY.index(plan)
    except ValueError:
        return PLAN_HIERARCHY[1] if len(PLAN_HIERARCHY) > 1 else None
    if index + 1 >= len(PLAN_HIERARCHY):
        return None
    return PLAN_HIERARCHY[index + 1]


def at_resource_limit(snapshot: OrgSnapshot, resource: str, count: int) -> bool:
    """True when the org has hit a real (non-unlimited) cap on this resource."""
    limit = plan_limit(snapshot.plan, resource)
    if limit <= 0:  # 0 == unlimited; never nudge about a cap that doesn't exist
        return False
    return count >= limit


def near_resource_limit(
    snapshot: OrgSnapshot, resource: str, count: int, ratio: float = 0.8
) -> bool:
    limit = plan_limit(snapshot.plan, resource)
    if limit <= 0:
        return False
    return count >= limit * ratio and count < limit


def ai_credit_limit(plan: str) -> int:
    """Credit allowance for a plan. ``-1`` means unlimited, ``0`` no access."""
    return AI_CREDIT_LIMITS.get(plan, 0)


def ai_credits_nearly_spent(snapshot: OrgSnapshot, ratio: float = 0.8) -> bool:
    """True when the org has burned most of a finite AI allowance.

    Usage comes from Redis and reads as zero when that is unavailable, so this
    fails closed: no cache, no nudge.
    """
    limit = ai_credit_limit(snapshot.plan)
    if limit <= 0:  # -1 unlimited, 0 no access — neither is a warning worth sending
        return False
    return snapshot.ai_credits_used >= limit * ratio


# --------------------------------------------------------------------------
# Anchors
# --------------------------------------------------------------------------


def _anchor_org(s: OrgSnapshot):
    return s.org_age_days


def _anchor_last_course_updated(s: OrgSnapshot):
    return s.age_days(s.last_course_updated_at)


def _anchor_first_published(s: OrgSnapshot):
    return s.age_days(s.first_published_at)


def _anchor_last_course_created(s: OrgSnapshot):
    return s.age_days(s.last_course_created_at)


def _anchor_touch(s: OrgSnapshot):
    return s.days_since_touch


def _anchor_last_chapter_created(s: OrgSnapshot):
    return s.age_days(s.last_chapter_created_at)


def _anchor_last_activity_created(s: OrgSnapshot):
    return s.age_days(s.last_activity_created_at)


def _anchor_last_assignment_created(s: OrgSnapshot):
    return s.age_days(s.last_assignment_created_at)


def _anchor_first_member(s: OrgSnapshot):
    return s.age_days(s.first_member_joined_at)


def _anchor_last_member(s: OrgSnapshot):
    return s.age_days(s.last_member_joined_at)


def _anchor_last_trailrun_updated(s: OrgSnapshot):
    return s.age_days(s.last_trailrun_updated_at)


def _anchor_first_trailrun(s: OrgSnapshot):
    return s.age_days(s.first_trailrun_at)


def _anchor_first_completion(s: OrgSnapshot):
    return s.age_days(s.first_completed_trailrun_at)


def _anchor_first_nudge(s: OrgSnapshot):
    """Days since this org first heard from us.

    The reactivation ladder runs on this clock. An org quiet for two years has
    a last-touch figure that never advances, so a sequence anchored on activity
    would fire its first step forever and its second step never.
    """
    return s.days_since_first_nudge


def _no_second_visit(s: OrgSnapshot) -> bool:
    """True when nobody appears to have come back after signing up.

    ``last_engagement`` already excludes the org's own creation and covers a
    later admin login, so its absence is the whole signal — an explicit
    "logged in within a day of signing up" comparison would be unreachable.

    ``last_login_at`` is null for the large majority of admins, so a missing
    value reads as "no evidence of a return" rather than proof of one. That is
    the honest reading, and the conservative one here: the worst case is
    sending a come-back email to someone who did quietly come back.
    """
    return s.last_engagement is None


def _draft_link(s: OrgSnapshot, base: str) -> str:
    return links.course_editor_url(
        base, s.oldest_draft_course_uuid or s.newest_course_uuid or "", "general"
    )


def _content_link(s: OrgSnapshot, base: str) -> str:
    return links.course_editor_url(
        base, s.newest_course_uuid or s.oldest_draft_course_uuid or "", "content"
    )


# --------------------------------------------------------------------------
# The catalog — thirty nudges across six tracks.
#
# Priorities encode what is worth an admin's single daily slot. Milestones
# outrank everything (they are congratulations, and stale congratulations are
# worthless), then activation, then the audience gap, then content, then
# monetization, and dormancy last.
# --------------------------------------------------------------------------

NUDGE_CATALOG: tuple[NudgeSpec, ...] = (
    # ---------------------------------------------------------------- track 1
    # Most new orgs never create a single course. The first and largest cliff.
    NudgeSpec(
        id="activation.first_course_d1",
        track=TRACK_ACTIVATION,
        day_min=1,
        day_max=2,
        anchor=_anchor_org,
        predicate=lambda s: s.course_count == 0,
        cta=lambda s, base: links.courses_url(base),
        priority=10,
    ),
    # Signed up, looked around once, never came back.
    NudgeSpec(
        id="activation.come_back_d2",
        track=TRACK_ACTIVATION,
        day_min=2,
        day_max=4,
        anchor=_anchor_org,
        predicate=lambda s: s.course_count == 0 and _no_second_visit(s),
        cta=lambda s, base: links.dashboard_url(base),
        priority=11,
    ),
    # The blank page is the obstacle; offer to fill it.
    NudgeSpec(
        id="activation.ai_course_help_d4",
        track=TRACK_ACTIVATION,
        day_min=5,
        day_max=7,
        anchor=_anchor_org,
        predicate=lambda s: s.course_count == 0,
        cta=lambda s, base: links.courses_url(base),
        priority=12,
    ),
    # For people who already have material and don't want to retype it.
    NudgeSpec(
        id="activation.import_existing_d5",
        track=TRACK_ACTIVATION,
        day_min=8,
        day_max=10,
        anchor=_anchor_org,
        predicate=lambda s: s.course_count == 0,
        cta=lambda s, base: links.course_migrate_url(base),
        priority=13,
    ),
    NudgeSpec(
        id="activation.setup_checklist_d7",
        track=TRACK_ACTIVATION,
        day_min=11,
        day_max=13,
        anchor=_anchor_org,
        predicate=lambda s: s.course_count == 0,
        cta=lambda s, base: links.onboarding_url(base),
        priority=14,
    ),
    # A real question with no button. A reply reaches a person.
    NudgeSpec(
        id="activation.whats_blocking_d14",
        track=TRACK_ACTIVATION,
        day_min=14,
        day_max=17,
        anchor=_anchor_org,
        predicate=lambda s: s.course_count == 0,
        cta=lambda s, base: links.dashboard_url(base),
        has_cta=False,
        priority=15,
    ),
    # Says plainly that it is the last one, and it is: every activation nudge
    # is once-per-org-forever, and this is the last window in the track, so
    # once it has fired the ledger keeps the whole track closed. That promise
    # is kept by the dedupe key, not by a separate terminal marker.
    NudgeSpec(
        id="activation.last_call_d30",
        track=TRACK_ACTIVATION,
        day_min=30,
        day_max=35,
        anchor=_anchor_org,
        predicate=lambda s: s.course_count == 0,
        cta=lambda s, base: links.dashboard_url(base),
        priority=16,
    ),
    # ---------------------------------------------------------------- track 2
    NudgeSpec(
        id="content.course_no_chapter_d1",
        track=TRACK_CONTENT,
        day_min=3,
        day_max=6,
        anchor=_anchor_last_course_created,
        predicate=lambda s: s.course_count > 0 and s.chapter_count == 0,
        cta=_content_link,
        priority=30,
    ),
    NudgeSpec(
        id="content.chapter_no_activity_d1",
        track=TRACK_CONTENT,
        day_min=3,
        day_max=6,
        anchor=_anchor_last_chapter_created,
        predicate=lambda s: s.chapter_count > 0 and s.activity_count == 0,
        cta=_content_link,
        priority=31,
    ),
    NudgeSpec(
        id="content.activity_unpublished_d2",
        track=TRACK_CONTENT,
        day_min=3,
        day_max=6,
        anchor=_anchor_last_activity_created,
        predicate=lambda s: s.activity_count > 0 and s.published_activity_count == 0,
        cta=_content_link,
        priority=32,
    ),
    # Courses get built and then sit in draft indefinitely — the most common
    # state for an org that has done real work.
    NudgeSpec(
        id="content.course_draft_d3",
        track=TRACK_CONTENT,
        day_min=3,
        day_max=5,
        anchor=_anchor_last_course_updated,
        predicate=lambda s: s.course_count > 0
        and s.published_course_count == 0
        and s.activity_count > 0,
        cta=_draft_link,
        priority=20,
    ),
    # Same case, a week later, answering the "it isn't ready" objection.
    NudgeSpec(
        id="content.course_draft_d10",
        track=TRACK_CONTENT,
        day_min=10,
        day_max=14,
        anchor=_anchor_last_course_updated,
        predicate=lambda s: s.course_count > 0
        and s.published_course_count == 0
        and s.activity_count > 0,
        cta=_draft_link,
        priority=21,
    ),
    NudgeSpec(
        id="content.thin_course_d5",
        track=TRACK_CONTENT,
        day_min=5,
        day_max=8,
        anchor=_anchor_last_course_created,
        predicate=lambda s: s.course_count > 0 and 0 < s.activity_count < 3,
        cta=_content_link,
        priority=33,
    ),
    NudgeSpec(
        id="content.assignment_no_submissions_d5",
        track=TRACK_CONTENT,
        day_min=5,
        day_max=9,
        anchor=_anchor_last_assignment_created,
        predicate=lambda s: s.assignment_count > 0
        and s.assignment_submission_count == 0
        and s.member_count > 0,
        cta=lambda s, base: links.dashboard_url(base),
        priority=34,
    ),
    # ---------------------------------------------------------------- track 3
    # A published course with nobody to read it — the widest gap in the
    # product. Almost no org ever adds a second person.
    NudgeSpec(
        id="audience.published_no_members_d1",
        track=TRACK_AUDIENCE,
        day_min=3,
        day_max=6,
        anchor=_anchor_first_published,
        predicate=lambda s: s.published_course_count > 0 and s.member_count == 0,
        cta=lambda s, base: links.members_url(base),
        priority=17,
    ),
    NudgeSpec(
        id="audience.published_no_members_d7",
        track=TRACK_AUDIENCE,
        day_min=7,
        day_max=10,
        anchor=_anchor_first_published,
        predicate=lambda s: s.published_course_count > 0 and s.member_count == 0,
        cta=lambda s, base: links.members_url(base),
        priority=18,
    ),
    # People were invited and never opened anything.
    NudgeSpec(
        id="audience.members_no_enrollment_d3",
        track=TRACK_AUDIENCE,
        day_min=3,
        day_max=6,
        anchor=_anchor_first_member,
        predicate=lambda s: s.member_count > 0 and s.trailrun_count == 0,
        cta=lambda s, base: links.members_url(base),
        priority=19,
    ),
    # Public and published, so the link is the whole answer.
    NudgeSpec(
        id="audience.share_public_page_d14",
        track=TRACK_AUDIENCE,
        day_min=14,
        day_max=18,
        anchor=_anchor_first_published,
        predicate=lambda s: s.published_course_count > 0
        and s.public_course_count > 0
        and s.member_count == 0,
        cta=lambda s, base: links.public_course_url(base, s.newest_course_uuid or ""),
        priority=22,
    ),
    # Learners started and stopped. Worth knowing about before writing more.
    NudgeSpec(
        id="audience.stalled_learners_d14",
        track=TRACK_AUDIENCE,
        day_min=14,
        day_max=21,
        anchor=_anchor_last_trailrun_updated,
        predicate=lambda s: s.in_progress_trailrun_count > 0,
        cta=lambda s, base: links.dashboard_url(base),
        priority=23,
    ),
    # ---------------------------------------------------------------- track 4
    # They hit a real ceiling and stopped. Only fires where the cap is finite.
    NudgeSpec(
        id="monetization.course_limit_d1",
        track=TRACK_MONETIZATION,
        day_min=1,
        day_max=3,
        anchor=_anchor_last_course_created,
        predicate=lambda s: at_resource_limit(s, "courses", s.course_count)
        and next_plan(s.plan) is not None,
        cta=lambda s, base: links.org_settings_url(base, "general"),
        suppress_if_active=False,
        priority=40,
    ),
    # Warn before the wall, not after it blocks the work.
    NudgeSpec(
        id="monetization.member_limit_near",
        track=TRACK_MONETIZATION,
        day_min=0,
        day_max=7,
        anchor=_anchor_last_member,
        predicate=lambda s: near_resource_limit(s, "members", s.member_count)
        and next_plan(s.plan) is not None,
        cta=lambda s, base: links.org_settings_url(base, "general"),
        suppress_if_active=False,
        priority=41,
    ),
    NudgeSpec(
        id="monetization.ai_credits_low",
        track=TRACK_MONETIZATION,
        day_min=0,
        day_max=7,
        anchor=_anchor_last_activity_created,
        predicate=lambda s: ai_credits_nearly_spent(s) and next_plan(s.plan) is not None,
        cta=lambda s, base: links.org_settings_url(base, "general"),
        suppress_if_active=False,
        priority=42,
    ),
    # A recap for an org that is actually using the product.
    NudgeSpec(
        id="monetization.upgrade_recap_d21",
        track=TRACK_MONETIZATION,
        day_min=21,
        day_max=25,
        anchor=_anchor_org,
        predicate=lambda s: s.published_course_count > 0
        and next_plan(s.plan) is not None,
        cta=lambda s, base: links.org_settings_url(base, "general"),
        priority=43,
    ),
    # ---------------------------------------------------------------- track 5
    NudgeSpec(
        id="dormancy.no_login_14d",
        track=TRACK_DORMANCY,
        day_min=14,
        day_max=17,
        anchor=_anchor_touch,
        predicate=lambda s: s.content_exists,
        cta=lambda s, base: links.dashboard_url(base),
        priority=60,
    ),
    # The only track that reaches organizations created long before this
    # system existed.
    NudgeSpec(
        id="dormancy.no_login_30d",
        track=TRACK_DORMANCY,
        day_min=30,
        day_max=35,
        anchor=_anchor_touch,
        predicate=lambda s: s.content_exists,
        cta=lambda s, base: links.dashboard_url(base),
        priority=61,
    ),
    # Says it is the last check-in, and means it.
    NudgeSpec(
        id="dormancy.no_login_60d",
        track=TRACK_DORMANCY,
        day_min=60,
        day_max=70,
        anchor=_anchor_touch,
        predicate=lambda s: s.content_exists,
        cta=lambda s, base: links.dashboard_url(base),
        priority=62,
    ),
    # After the sequence ends, at most four times a year, forever.
    NudgeSpec(
        id="dormancy.winback_q",
        track=TRACK_DORMANCY,
        day_min=120,
        day_max=3650,
        anchor=_anchor_touch,
        predicate=lambda s: s.content_exists,
        cta=lambda s, base: links.dashboard_url(base),
        repeat="quarterly",
        priority=63,
    ),
    # ---------------------------------------------------------------- track 7
    # Reactivation: a real sequence for organizations that went cold long ago.
    #
    # These exist because every other track is bounded by `day_max`, so an org
    # quiet for a year qualifies for essentially nothing — the frequency cap was
    # never what limited them, the absence of anything to send was. The ladder
    # is anchored on first contact so it can actually advance, and it opens the
    # door once: after the last step, `dormancy.winback_q` takes over at its
    # quarterly cadence.
    NudgeSpec(
        id="reactivation.opener",
        track=TRACK_REACTIVATION,
        day_min=90,
        day_max=3650,
        anchor=_anchor_touch,
        # No prior contact — this is the step that starts the sequence and
        # stamps the clock the rest of it measures from.
        predicate=lambda s: s.content_exists and s.first_nudged_at is None,
        cta=lambda s, base: links.dashboard_url(base),
        priority=64,
    ),
    NudgeSpec(
        id="reactivation.whats_changed",
        track=TRACK_REACTIVATION,
        day_min=3,
        day_max=6,
        anchor=_anchor_first_nudge,
        predicate=lambda s: s.is_cold and s.content_exists,
        cta=lambda s, base: links.dashboard_url(base),
        priority=65,
    ),
    NudgeSpec(
        id="reactivation.need_a_hand",
        track=TRACK_REACTIVATION,
        day_min=8,
        day_max=12,
        anchor=_anchor_first_nudge,
        predicate=lambda s: s.is_cold and s.content_exists,
        cta=lambda s, base: links.dashboard_url(base),
        has_cta=False,
        priority=66,
    ),
    NudgeSpec(
        id="reactivation.closing",
        track=TRACK_REACTIVATION,
        day_min=16,
        day_max=21,
        anchor=_anchor_first_nudge,
        predicate=lambda s: s.is_cold and s.content_exists,
        cta=lambda s, base: links.dashboard_url(base),
        priority=67,
    ),
    # ---------------------------------------------------------------- track 6
    # Congratulations go out immediately or not at all, so these never
    # suppress on activity — the whole point is that something just happened.
    NudgeSpec(
        id="milestone.first_course_published",
        track=TRACK_MILESTONE,
        day_min=0,
        day_max=2,
        anchor=_anchor_first_published,
        predicate=lambda s: s.published_course_count > 0,
        cta=lambda s, base: links.members_url(base),
        suppress_if_active=False,
        priority=5,
    ),
    NudgeSpec(
        id="milestone.first_learner_enrolled",
        track=TRACK_MILESTONE,
        day_min=0,
        day_max=2,
        anchor=_anchor_first_trailrun,
        predicate=lambda s: s.trailrun_count > 0,
        cta=lambda s, base: links.dashboard_url(base),
        suppress_if_active=False,
        priority=6,
    ),
    NudgeSpec(
        id="milestone.first_completion",
        track=TRACK_MILESTONE,
        day_min=0,
        day_max=2,
        anchor=_anchor_first_completion,
        predicate=lambda s: s.completed_trailrun_count > 0,
        cta=lambda s, base: links.dashboard_url(base),
        suppress_if_active=False,
        priority=7,
    ),
)


CATALOG_BY_ID: dict[str, NudgeSpec] = {spec.id: spec for spec in NUDGE_CATALOG}


def get_spec(nudge_id: str) -> Optional[NudgeSpec]:
    return CATALOG_BY_ID.get(nudge_id)


def matching_specs(snapshot: OrgSnapshot) -> list[NudgeSpec]:
    """Specs that fire for this org, most urgent first.

    Ordering matters because an admin receives at most one nudge per day: the
    highest-value message must claim the slot rather than whichever spec
    happens to be declared first.
    """
    matched = [spec for spec in NUDGE_CATALOG if spec.matches(snapshot)]
    return sorted(matched, key=lambda s: (s.priority, s.id))
