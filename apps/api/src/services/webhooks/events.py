"""
Registry of events that webhook endpoints can subscribe to.

Keys must match the analytics event constants in
``src.services.analytics.events`` so the same event name is used everywhere.
"""

WEBHOOK_EVENTS: dict[str, str] = {
    "course_completed": "Triggered when a user completes all activities in a course",
    "course_enrolled": "Triggered when a user enrolls in a course",
    "activity_completed": "Triggered when a user completes an activity",
    "assignment_submitted": "Triggered when a user submits an assignment",
    "user_signed_up": "Triggered when a new user signs up for the organization",
    "certificate_claimed": "Triggered when a user receives a certificate",
    "discussion_posted": "Triggered when a user posts in a discussion",
}
