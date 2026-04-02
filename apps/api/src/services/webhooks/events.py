"""
Registry of events that webhook endpoints can subscribe to.

Keys must match the analytics event constants in
``src.services.analytics.events`` so the same event name is used everywhere.
"""

WEBHOOK_EVENTS: dict[str, str] = {
    # Learning progress
    "course_completed": "Triggered when a user completes all activities in a course",
    "course_enrolled": "Triggered when a user enrolls in a course",
    "activity_completed": "Triggered when a user completes an activity",
    "assignment_submitted": "Triggered when a user submits an assignment",
    "assignment_graded": "Triggered when an instructor grades an assignment submission",
    "certificate_claimed": "Triggered when a user receives a certificate",
    # User & access
    "user_signed_up": "Triggered when a new user signs up for the organization",
    "user_email_verified": "Triggered when a user verifies their email address",
    "user_role_changed": "Triggered when a user's role is changed in the organization",
    "user_invited_to_org": "Triggered when users are invited to the organization",
    "user_removed_from_org": "Triggered when a user is removed from the organization",
    # Course lifecycle
    "course_created": "Triggered when a new course is created",
    "course_published": "Triggered when a course is published or unpublished",
    "course_deleted": "Triggered when a course is deleted",
    "course_update_published": "Triggered when an announcement is posted to a course",
    # Content management
    "activity_version_created": "Triggered when an activity version snapshot is created",
    "activity_version_restored": "Triggered when an activity is restored to a previous version",
    "course_contributor_added": "Triggered when contributors are added to a course",
    "course_contributor_removed": "Triggered when contributors are removed from a course",
    "collection_created": "Triggered when a new course collection is created",
    "podcast_episode_created": "Triggered when a new podcast episode is added",
    # Collaboration
    "board_created": "Triggered when a new whiteboard is created",
    "board_member_added": "Triggered when a member is added to a whiteboard",
    "playground_created": "Triggered when a new playground is created",
    # Community
    "discussion_posted": "Triggered when a user creates a discussion",
    "comment_created": "Triggered when a user posts a comment on a discussion",
    "discussion_pinned": "Triggered when a discussion is pinned or unpinned",
    "discussion_locked": "Triggered when a discussion is locked or unlocked",
    "discussion_vote_cast": "Triggered when a user upvotes a discussion",
    # Groups
    "usergroup_created": "Triggered when a new user group is created",
    "usergroup_deleted": "Triggered when a user group is deleted",
    "usergroup_users_added": "Triggered when users are added to a user group",
    "usergroup_resources_added": "Triggered when resources are assigned to a user group",
    # Subscriptions
    "pack_activated": "Triggered when a subscription pack is activated",
    "pack_deactivated": "Triggered when a subscription pack is cancelled",
    # Org administration
    "org_signup_method_changed": "Triggered when the organization signup method is changed",
    "org_ai_config_changed": "Triggered when the organization AI configuration is updated",
    "org_payments_config_changed": "Triggered when the organization payments configuration is updated",
}
