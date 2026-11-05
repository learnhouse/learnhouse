"""Analytics event catalog.

Every event the platform stores is declared here, with where it may come from
and which properties it keeps. Anything not in the catalog is dropped, and
unknown properties are stripped, so the stream stays clean no matter what a
client sends.

Two kinds of events:

* **Web** events are sent by the browser through ``POST /signals/batch``.
  ``public`` ones (page and content views, searches) are also accepted from
  visitors who aren't signed in; the rest need a signed-in org member.
* **Server** events are recorded by the API itself with ``track()`` at the
  point where the thing actually happened (enrollment committed, quiz graded,
  payment confirmed...). They can't be blocked by browser extensions, so
  anything that matters for a metric belongs on this side.

Naming: ``object_action``, snake_case, past tense, matching the web app's
``services/analytics/events.ts``.
"""

from dataclasses import dataclass, field

# Properties that are stored as real columns on ``analytics_event`` (see
# ``src/db/analytics.py``). Every event may carry them.
COLUMN_PROPERTIES = frozenset(
    {"course_uuid", "activity_uuid", "path", "referrer_domain", "seconds_spent"}
)


@dataclass(frozen=True)
class EventSpec:
    name: str
    # Accepted from the browser beacon.
    web: bool = False
    # Accepted from the browser for visitors who aren't signed in.
    public: bool = False
    # Extra properties kept in the JSONB column, beyond COLUMN_PROPERTIES.
    props: frozenset[str] = field(default_factory=frozenset)


def _spec(name: str, *props: str, web: bool = False, public: bool = False) -> EventSpec:
    return EventSpec(name=name, web=web or public, public=public, props=frozenset(props))


# ---------------------------------------------------------------------------
# Web events
# ---------------------------------------------------------------------------
PAGE_VIEW = "page_view"
COURSE_VIEW = "course_view"
ACTIVITY_VIEW = "activity_view"
SEARCH_QUERY = "search_query"
TIME_ON_ACTIVITY = "time_on_activity"
VIDEO_PROGRESS = "video_progress"
PODCAST_EPISODE_PLAYED = "podcast_episode_played"
COURSE_SHARED = "course_shared"
STORE_OFFER_VIEWED = "store_offer_viewed"
COMMUNITY_VIEWED = "community_viewed"

# ---------------------------------------------------------------------------
# Server events
# ---------------------------------------------------------------------------
COURSE_ENROLLED = "course_enrolled"
COURSE_LEFT = "course_left"
COURSE_COMPLETED = "course_completed"
ACTIVITY_COMPLETED = "activity_completed"
ASSIGNMENT_SUBMITTED = "assignment_submitted"
ASSIGNMENT_GRADED = "assignment_graded"
QUIZ_SUBMITTED = "quiz_submitted"
USER_SIGNED_UP = "user_signed_up"
USER_JOINED_ORG = "user_joined_org"
USER_REMOVED_FROM_ORG = "user_removed_from_org"
USER_LOGGED_IN = "user_logged_in"
CERTIFICATE_CLAIMED = "certificate_claimed"
CERTIFICATE_REVOKED = "certificate_revoked"
DISCUSSION_POSTED = "discussion_posted"
COMMENT_POSTED = "comment_posted"
REACTION_ADDED = "reaction_added"
PAYMENT_SUCCEEDED = "payment_succeeded"
PAYMENT_REFUNDED = "payment_refunded"
LIVE_SESSION_JOINED = "live_session_joined"
PATH_ENROLLED = "path_enrolled"
PATH_COMPLETED = "path_completed"
AI_MESSAGE_SENT = "ai_message_sent"
BOARD_CREATED = "board_created"
PLAYGROUND_CREATED = "playground_created"
CODE_SUBMITTED = "code_submitted"
RESOURCE_DOWNLOADED = "resource_downloaded"
COURSE_PUBLISHED = "course_published"
ACTIVITY_CREATED = "activity_created"

# Lifecycle email. Recorded per delivered nudge so returns can be attributed
# to the specific message that prompted them, rather than to "we sent emails".
NUDGE_SENT = "nudge_sent"

# Messaging: one per message a member posts (direct, group, course channel).
MESSAGE_SENT = "message_sent"


CATALOG: dict[str, EventSpec] = {
    spec.name: spec
    for spec in (
        # Web: public
        _spec(PAGE_VIEW, public=True),
        _spec(COURSE_VIEW, public=True),
        _spec(ACTIVITY_VIEW, "activity_type", public=True),
        _spec(SEARCH_QUERY, "query", "results_count", "surface", public=True),
        _spec(PODCAST_EPISODE_PLAYED, "podcast_uuid", "episode_uuid", public=True),
        _spec(COURSE_SHARED, "channel", public=True),
        _spec(STORE_OFFER_VIEWED, "offer_id", public=True),
        _spec(COMMUNITY_VIEWED, "community_uuid", public=True),
        # Web: members only
        _spec(TIME_ON_ACTIVITY, "activity_type", web=True),
        _spec(VIDEO_PROGRESS, "percent", "activity_type", web=True),
        # Server
        _spec(COURSE_ENROLLED, "source"),
        _spec(COURSE_LEFT),
        _spec(COURSE_COMPLETED),
        _spec(ACTIVITY_COMPLETED, "activity_type"),
        _spec(ASSIGNMENT_SUBMITTED, "assignment_uuid", "attempt"),
        _spec(ASSIGNMENT_GRADED, "assignment_uuid", "grade", "max_grade", "passed"),
        _spec(QUIZ_SUBMITTED, "score", "max_score", "passed"),
        _spec(USER_SIGNED_UP, "signup_method"),
        _spec(USER_JOINED_ORG, "join_method"),
        _spec(USER_REMOVED_FROM_ORG),
        _spec(USER_LOGGED_IN, "login_method"),
        _spec(CERTIFICATE_CLAIMED),
        _spec(CERTIFICATE_REVOKED),
        _spec(DISCUSSION_POSTED, "community_uuid", "discussion_uuid", "label"),
        _spec(COMMENT_POSTED, "community_uuid", "discussion_uuid"),
        _spec(REACTION_ADDED, "community_uuid", "discussion_uuid", "reaction"),
        _spec(PAYMENT_SUCCEEDED, "offer_id", "amount", "currency", "kind"),
        _spec(PAYMENT_REFUNDED, "offer_id", "amount", "currency"),
        _spec(LIVE_SESSION_JOINED, "session_uuid"),
        _spec(PATH_ENROLLED, "path_uuid"),
        _spec(PATH_COMPLETED, "path_uuid"),
        _spec(AI_MESSAGE_SENT, "surface", "model"),
        _spec(BOARD_CREATED, "board_uuid"),
        _spec(PLAYGROUND_CREATED, "playground_uuid"),
        _spec(CODE_SUBMITTED, "language", "passed", "tests_passed", "tests_total"),
        _spec(RESOURCE_DOWNLOADED, "resource_uuid", "resource_type"),
        _spec(COURSE_PUBLISHED, "published"),
        _spec(ACTIVITY_CREATED, "activity_type"),
        _spec(NUDGE_SENT, "nudge_type", "nudge_id"),
        _spec(MESSAGE_SENT, "conversation_uuid", "conversation_kind"),
    )
}

# Kept for callers that predate the catalog.
ALLOWED_FRONTEND_EVENTS = frozenset(name for name, spec in CATALOG.items() if spec.web)
PUBLIC_WEB_EVENTS = frozenset(name for name, spec in CATALOG.items() if spec.public)
# Browsing events dropped for staff when an org sets ``exclude_staff``.
STAFF_EXCLUDABLE_EVENTS = frozenset({PAGE_VIEW, COURSE_VIEW, ACTIVITY_VIEW, TIME_ON_ACTIVITY, VIDEO_PROGRESS})
