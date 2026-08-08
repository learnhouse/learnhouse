"""
The per-org fact row that nudge predicates run against.

Kept separate from the queries that build it so the whole catalog can be
unit-tested by constructing snapshots by hand, with no database at all.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from src.services.security.account_age import parse_creation_date

# An org that has done something very recently is not dormant, whatever the
# calendar says about its anchors — chasing it would be noise.
ACTIVE_WINDOW_DAYS = 3

# Past this, every ordinary track's `day_max` has long since excluded the org.
# These are the ones a reactivation sequence exists for.
COLD_AFTER_DAYS = 90


@dataclass(frozen=True)
class AdminRow:
    """One org admin eligible to receive mail."""

    user_id: int
    user_uuid: str
    email: str
    first_name: Optional[str]
    username: Optional[str]
    email_verified: bool
    last_login_at: Optional[datetime]

    @property
    def display_name(self) -> str:
        """What to greet them by, preferring the most human option available."""
        return (self.first_name or "").strip() or (self.username or "").strip() or "there"


@dataclass(frozen=True)
class OrgSnapshot:
    """Everything a nudge predicate is allowed to look at, for one org.

    Timestamps are tz-aware UTC. The ones sourced from naive string columns
    (course/activity/org dates) are parsed through ``parse_creation_date`` and
    are accurate to roughly a day — every catalog window is at least two days
    wide so that fuzziness can never flip eligibility.
    """

    org_id: int
    org_slug: str
    org_name: str
    plan: str
    lang: str
    org_active_flag: bool = True
    logo_image: Optional[str] = None
    org_uuid: Optional[str] = None

    created_at: Optional[datetime] = None
    org_updated_at: Optional[datetime] = None

    member_count: int = 0            # non-admin members
    admin_count: int = 0
    first_member_joined_at: Optional[datetime] = None
    last_member_joined_at: Optional[datetime] = None

    course_count: int = 0
    published_course_count: int = 0
    public_course_count: int = 0
    last_course_created_at: Optional[datetime] = None
    last_course_updated_at: Optional[datetime] = None
    first_published_at: Optional[datetime] = None
    newest_course_uuid: Optional[str] = None
    newest_course_name: Optional[str] = None
    oldest_draft_course_uuid: Optional[str] = None
    oldest_draft_course_name: Optional[str] = None

    chapter_count: int = 0
    last_chapter_created_at: Optional[datetime] = None

    activity_count: int = 0
    published_activity_count: int = 0
    last_activity_created_at: Optional[datetime] = None

    assignment_count: int = 0
    assignment_submission_count: int = 0
    last_assignment_created_at: Optional[datetime] = None

    trailrun_count: int = 0
    learner_count: int = 0
    in_progress_trailrun_count: int = 0
    completed_trailrun_count: int = 0
    first_trailrun_at: Optional[datetime] = None
    last_trailrun_updated_at: Optional[datetime] = None
    first_completed_trailrun_at: Optional[datetime] = None

    ai_credits_used: int = 0

    last_admin_login_at: Optional[datetime] = None
    last_activity_day: Optional[datetime] = None

    # When this org first received any nudge. The reactivation ladder measures
    # from here rather than from last activity: an org quiet for two years has
    # a last-touch number that never moves, so nothing anchored on it can form
    # a sequence.
    first_nudged_at: Optional[datetime] = None

    admins: tuple[AdminRow, ...] = field(default_factory=tuple)

    # Injected so a run can be replayed "as of" a past date, and so tests are
    # not at the mercy of the wall clock.
    now: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # -- derived ----------------------------------------------------------

    def age_days(self, moment: Optional[datetime]) -> Optional[float]:
        """Days between ``moment`` and this snapshot's clock, or None."""
        if moment is None:
            return None
        return (self.now - moment).total_seconds() / 86400.0

    @property
    def org_age_days(self) -> Optional[float]:
        return self.age_days(self.created_at)

    @property
    def content_exists(self) -> bool:
        return self.course_count > 0 or self.activity_count > 0

    @property
    def last_engagement(self) -> Optional[datetime]:
        """When someone last *did* something here, or None if nobody ever has.

        Deliberately excludes the org's own creation and update timestamps.
        Creating an account is not engagement: counting it would mark every
        brand-new org as active for its first few days, which is exactly the
        window the activation emails exist to cover — they would never fire.

        ``user_activity_day`` would be the ideal signal, but it is SaaS-gated
        and only recently populated, and ``user.last_login_at`` is null for the
        large majority of admins. So this is the newest of everything else we
        hold, and it is legitimately None for an org where nothing happened.
        """
        candidates = [
            self.last_activity_day,
            self.last_admin_login_at,
            self.last_course_updated_at,
            self.last_course_created_at,
            self.last_activity_created_at,
            self.last_chapter_created_at,
            self.last_trailrun_updated_at,
            self.last_member_joined_at,
        ]
        known = [c for c in candidates if c is not None]
        return max(known) if known else None

    @property
    def last_touch(self) -> Optional[datetime]:
        """Newest signal of any kind, falling back to the org's own dates.

        Always defined for a real org, which is what the dormancy track needs
        to anchor against — including for organizations that predate any of
        this instrumentation.
        """
        fallbacks = [t for t in (self.org_updated_at, self.created_at) if t is not None]
        candidates = [t for t in (self.last_engagement, *fallbacks) if t is not None]
        return max(candidates) if candidates else None

    @property
    def days_since_touch(self) -> Optional[float]:
        return self.age_days(self.last_touch)

    @property
    def days_since_first_nudge(self) -> Optional[float]:
        return self.age_days(self.first_nudged_at)

    @property
    def is_cold(self) -> bool:
        """Quiet long enough that no ordinary track can reach them."""
        days = self.days_since_touch
        return days is not None and days >= COLD_AFTER_DAYS

    @property
    def org_active(self) -> bool:
        """True when someone has engaged with the org inside the active window.

        An org that came back on its own does not get chased.
        """
        days = self.age_days(self.last_engagement)
        return days is not None and days < ACTIVE_WINDOW_DAYS

    @property
    def mailable_admins(self) -> tuple[AdminRow, ...]:
        """Admins we are permitted to email at all.

        Unverified addresses are excluded everywhere: sending to unconfirmed
        recipients is the fastest way to lose a sending domain's reputation,
        and it takes the transactional mail down with it.
        """
        return tuple(
            a for a in self.admins if a.email_verified and a.email and "@" in a.email
        )


def parse_ts(raw) -> Optional[datetime]:
    """Coerce any stored timestamp shape into tz-aware UTC, or None.

    The schema mixes real ``DateTime(timezone=True)`` columns with naive
    ``str(datetime.now())`` strings, and aggregates over the latter come back
    as strings. Both land here.
    """
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    return parse_creation_date(str(raw))
