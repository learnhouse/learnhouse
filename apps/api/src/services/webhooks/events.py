"""
Registry of events that webhook endpoints can subscribe to.

Each event defines:
- ``category``      – UI grouping label.
- ``description``   – Human-readable explanation shown in the UI.
- ``data_schema``   – **The** definition of the ``data`` field sent in the
  webhook payload.  Keys are field names; values are either a type hint
  string (``"string"``, ``"integer"``, ``"boolean"``, ``"list[string]"``,
  ``"list[integer]"`` …) or a nested dict for object fields.

``data_schema`` is the single source of truth:
  1. The ``/webhooks/events`` endpoint returns it so the UI shows the real
     payload structure without any hardcoded copy.
  2. ``validate_event_data()`` checks dispatched payloads against it at
     runtime so drift is caught immediately.
"""

import logging

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Event registry
# ---------------------------------------------------------------------------

WEBHOOK_EVENTS: dict[str, dict] = {
    # ── System ───────────────────────────────────────────────────────
    "ping": {
        "category": "System",
        "description": "Test event sent to verify endpoint connectivity",
        "data_schema": {
            "message": "string",
        },
    },
    # ── Learning progress ────────────────────────────────────────────
    "course_completed": {
        "category": "Learning Progress",
        "description": "Triggered when a user completes all activities in a course",
        "data_schema": {
            "user": {"user_uuid": "string", "email": "string", "username": "string"},
            "course": {"course_uuid": "string", "name": "string"},
        },
    },
    "course_enrolled": {
        "category": "Learning Progress",
        "description": "Triggered when a user enrolls in a course",
        "data_schema": {
            "user": {"user_uuid": "string", "email": "string", "username": "string"},
            "course": {"course_uuid": "string", "name": "string"},
        },
    },
    "activity_completed": {
        "category": "Learning Progress",
        "description": "Triggered when a user completes an activity",
        "data_schema": {
            "user": {"user_uuid": "string", "email": "string", "username": "string"},
            "activity": {"activity_uuid": "string", "activity_type": "string"},
            "course": {"course_uuid": "string", "name": "string"},
        },
    },
    "assignment_submitted": {
        "category": "Learning Progress",
        "description": "Triggered when a user submits an assignment",
        "data_schema": {
            "user": {"user_uuid": "string", "email": "string", "username": "string"},
            "assignment": {"assignment_uuid": "string"},
            "course": {"course_uuid": "string", "name": "string"},
        },
    },
    "assignment_graded": {
        "category": "Learning Progress",
        "description": "Triggered when an instructor grades an assignment submission",
        "data_schema": {
            "user_id": "integer",
            "assignment_uuid": "string",
            "course_uuid": "string",
            "grade": "integer",
        },
    },
    "certificate_claimed": {
        "category": "Learning Progress",
        "description": "Triggered when a user receives a certificate",
        "data_schema": {
            "user": {"user_uuid": "string", "email": "string", "username": "string"},
            "course": {"course_uuid": "string", "name": "string"},
            "certificate": {"user_certification_uuid": "string"},
        },
    },
    # ── User & access ────────────────────────────────────────────────
    "user_signed_up": {
        "category": "User & Access",
        "description": "Triggered when a new user signs up for the organization",
        "data_schema": {
            "user": {
                "user_uuid": "string",
                "email": "string",
                "username": "string",
                "first_name": "string",
                "last_name": "string",
            },
            "signup_method": "string",
        },
    },
    "user_email_verified": {
        "category": "User & Access",
        "description": "Triggered when a user verifies their email address",
        "data_schema": {
            "user_uuid": "string",
            "email": "string",
        },
    },
    "user_role_changed": {
        "category": "User & Access",
        "description": "Triggered when a user's role is changed in the organization",
        "data_schema": {
            "user_id": "integer",
            "org_id": "integer",
            "new_role_uuid": "string",
        },
    },
    "user_invited_to_org": {
        "category": "User & Access",
        "description": "Triggered when users are invited to the organization",
        "data_schema": {
            "org_id": "integer",
            "emails": "list[string]",
            "invite_code_uuid": "string",
            "invited_by": "string",
        },
    },
    "user_removed_from_org": {
        "category": "User & Access",
        "description": "Triggered when a user is removed from the organization",
        "data_schema": {
            "user_id": "integer",
            "org_id": "integer",
        },
    },
    # ── Course lifecycle ─────────────────────────────────────────────
    "course_created": {
        "category": "Course Lifecycle",
        "description": "Triggered when a new course is created",
        "data_schema": {
            "course_uuid": "string",
            "name": "string",
            "org_id": "integer",
        },
    },
    "course_published": {
        "category": "Course Lifecycle",
        "description": "Triggered when a course is published or unpublished",
        "data_schema": {
            "course_uuid": "string",
            "name": "string",
            "published": "boolean",
        },
    },
    "course_deleted": {
        "category": "Course Lifecycle",
        "description": "Triggered when a course is deleted",
        "data_schema": {
            "course_uuid": "string",
            "name": "string",
        },
    },
    "course_update_published": {
        "category": "Course Lifecycle",
        "description": "Triggered when an announcement is posted to a course",
        "data_schema": {
            "courseupdate_uuid": "string",
            "course_uuid": "string",
        },
    },
    # ── Content management ───────────────────────────────────────────
    "activity_version_created": {
        "category": "Content Management",
        "description": "Triggered when an activity version snapshot is created",
        "data_schema": {
            "activity_id": "integer",
            "version_number": "integer",
            "created_by_id": "integer",
        },
    },
    "activity_version_restored": {
        "category": "Content Management",
        "description": "Triggered when an activity is restored to a previous version",
        "data_schema": {
            "activity_uuid": "string",
            "restored_version_number": "integer",
            "new_version_number": "integer",
        },
    },
    "course_contributor_added": {
        "category": "Content Management",
        "description": "Triggered when contributors are added to a course",
        "data_schema": {
            "course_uuid": "string",
            "contributors": "list[object]",
        },
    },
    "course_contributor_removed": {
        "category": "Content Management",
        "description": "Triggered when contributors are removed from a course",
        "data_schema": {
            "course_uuid": "string",
            "contributors": "list[object]",
        },
    },
    "collection_created": {
        "category": "Content Management",
        "description": "Triggered when a new course collection is created",
        "data_schema": {
            "collection_uuid": "string",
            "name": "string",
        },
    },
    "podcast_episode_created": {
        "category": "Content Management",
        "description": "Triggered when a new podcast episode is added",
        "data_schema": {
            "episode_uuid": "string",
            "podcast_uuid": "string",
            "title": "string",
            "episode_number": "integer",
        },
    },
    # ── Collaboration ────────────────────────────────────────────────
    "board_created": {
        "category": "Collaboration",
        "description": "Triggered when a new whiteboard is created",
        "data_schema": {
            "board_uuid": "string",
            "name": "string",
            "created_by": "integer",
        },
    },
    "board_member_added": {
        "category": "Collaboration",
        "description": "Triggered when a member is added to a whiteboard",
        "data_schema": {
            "board_uuid": "string",
            "user_id": "integer",
            "role": "string",
        },
    },
    "playground_created": {
        "category": "Collaboration",
        "description": "Triggered when a new playground is created",
        "data_schema": {
            "playground_uuid": "string",
            "name": "string",
            "created_by": "integer",
        },
    },
    # ── Community ────────────────────────────────────────────────────
    "discussion_posted": {
        "category": "Community",
        "description": "Triggered when a user creates a discussion",
        "data_schema": {
            "user": {"user_uuid": "string", "email": "string", "username": "string"},
            "discussion": {"discussion_uuid": "string", "title": "string"},
            "community": {"community_uuid": "string"},
        },
    },
    "comment_created": {
        "category": "Community",
        "description": "Triggered when a user posts a comment on a discussion",
        "data_schema": {
            "user": {"user_uuid": "string", "email": "string", "username": "string"},
            "comment": {"comment_uuid": "string"},
            "discussion": {"discussion_uuid": "string", "title": "string"},
            "community": {"community_uuid": "string"},
        },
    },
    "discussion_pinned": {
        "category": "Community",
        "description": "Triggered when a discussion is pinned or unpinned",
        "data_schema": {
            "discussion_uuid": "string",
            "title": "string",
            "is_pinned": "boolean",
            "community_uuid": "string",
        },
    },
    "discussion_locked": {
        "category": "Community",
        "description": "Triggered when a discussion is locked or unlocked",
        "data_schema": {
            "discussion_uuid": "string",
            "title": "string",
            "is_locked": "boolean",
            "community_uuid": "string",
        },
    },
    "discussion_vote_cast": {
        "category": "Community",
        "description": "Triggered when a user upvotes a discussion",
        "data_schema": {
            "discussion_uuid": "string",
            "user_id": "integer",
            "upvote_count": "integer",
        },
    },
    # ── Groups ───────────────────────────────────────────────────────
    "usergroup_created": {
        "category": "Groups",
        "description": "Triggered when a new user group is created",
        "data_schema": {
            "usergroup_uuid": "string",
            "name": "string",
        },
    },
    "usergroup_deleted": {
        "category": "Groups",
        "description": "Triggered when a user group is deleted",
        "data_schema": {
            "usergroup_uuid": "string",
            "name": "string",
        },
    },
    "usergroup_users_added": {
        "category": "Groups",
        "description": "Triggered when users are added to a user group",
        "data_schema": {
            "usergroup_id": "integer",
            "usergroup_uuid": "string",
            "user_ids": "list[integer]",
        },
    },
    "usergroup_resources_added": {
        "category": "Groups",
        "description": "Triggered when resources are assigned to a user group",
        "data_schema": {
            "usergroup_id": "integer",
            "usergroup_uuid": "string",
            "resource_uuids": "list[string]",
        },
    },
    # ── Subscriptions ────────────────────────────────────────────────
    "pack_activated": {
        "category": "Subscriptions",
        "description": "Triggered when a subscription pack is activated",
        "data_schema": {
            "pack_id": "string",
            "pack_type": "string",
            "quantity": "integer",
            "platform_subscription_id": "string",
        },
    },
    "pack_deactivated": {
        "category": "Subscriptions",
        "description": "Triggered when a subscription pack is cancelled",
        "data_schema": {
            "pack_id": "string",
            "pack_type": "string",
            "platform_subscription_id": "string",
        },
    },
    # ── Org administration ───────────────────────────────────────────
    "org_signup_method_changed": {
        "category": "Organization",
        "description": "Triggered when the organization signup method is changed",
        "data_schema": {
            "signup_mechanism": "string",
        },
    },
    "org_ai_config_changed": {
        "category": "Organization",
        "description": "Triggered when the organization AI configuration is updated",
        "data_schema": {
            "ai_enabled": "boolean",
            "copilot_enabled": "boolean",
        },
    },
    "org_payments_config_changed": {
        "category": "Organization",
        "description": "Triggered when the organization payments configuration is updated",
        "data_schema": {
            "payments_enabled": "boolean",
        },
    },
}


# ---------------------------------------------------------------------------
# Runtime validation
# ---------------------------------------------------------------------------


def _schema_keys(schema: dict) -> set[str]:
    """Return the set of top-level keys expected by a schema dict."""
    return set(schema.keys())


def validate_event_data(event_name: str, data: dict) -> None:
    """
    Check that *data* matches the ``data_schema`` registered for *event_name*.

    Logs a warning on mismatch — never raises, so webhook delivery is not
    blocked by a schema drift bug.
    """
    event = WEBHOOK_EVENTS.get(event_name)
    if event is None:
        logger.warning("Webhook event %r is not registered in WEBHOOK_EVENTS", event_name)
        return

    schema = event.get("data_schema")
    if schema is None:
        return

    expected = _schema_keys(schema)
    actual = set(data.keys())

    missing = expected - actual
    extra = actual - expected

    if missing:
        logger.warning(
            "Webhook %r payload is missing keys defined in data_schema: %s",
            event_name,
            sorted(missing),
        )
    if extra:
        logger.warning(
            "Webhook %r payload has keys not defined in data_schema: %s",
            event_name,
            sorted(extra),
        )
