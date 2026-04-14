# Analytics event name constants

# Frontend events
PAGE_VIEW = "page_view"
COURSE_VIEW = "course_view"
ACTIVITY_VIEW = "activity_view"
SEARCH_QUERY = "search_query"
TIME_ON_ACTIVITY = "time_on_activity"

# API events
COURSE_ENROLLED = "course_enrolled"
COURSE_COMPLETED = "course_completed"
ACTIVITY_COMPLETED = "activity_completed"
ASSIGNMENT_SUBMITTED = "assignment_submitted"
USER_SIGNED_UP = "user_signed_up"
USER_REMOVED_FROM_ORG = "user_removed_from_org"
CERTIFICATE_CLAIMED = "certificate_claimed"
CERTIFICATE_REVOKED = "certificate_revoked"
DISCUSSION_POSTED = "discussion_posted"

# Allowed frontend event names (whitelist for the proxy endpoint)
ALLOWED_FRONTEND_EVENTS = {
    PAGE_VIEW,
    COURSE_VIEW,
    ACTIVITY_VIEW,
    SEARCH_QUERY,
    TIME_ON_ACTIVITY,
}
