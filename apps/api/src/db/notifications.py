"""Per-user notifications, the devices they are pushed to, and push preferences.

``notification`` is the learner's inbox: one row per thing that happened to
them (a message, a grade, a chapter opening, a session going live). Rows are
written by the events themselves (see ``src/services/notifications``) and read
by the web bell and the mobile app.

Two keys keep the feed tidy:

- ``group_key`` collapses repeats while unread. A second message in the same
  conversation updates the unread row (count, body, time) instead of adding
  another one.
- ``dedupe_key`` makes scheduled jobs idempotent: (user_id, dedupe_key) is
  unique, so a reminder written twice by two API pods lands once.

``push_device`` holds Expo push tokens. A token belongs to one user at a time:
registering it again from another account moves it.

``notification_preference`` is one optional row per user. No row means the
defaults (every category in-app and pushed, no digest).

``org_notification_setting`` routes admin events (submissions to grade, join
requests, sync errors…) to roles; no row means each type's default roles.
"""

from dataclasses import dataclass
from typing import Optional

from sqlalchemy import JSON, BigInteger, Column, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


# Categories group the types for preferences and filtering. Mobile and web
# show one toggle per category. The first four are the original mobile set;
# the rest were added for the web notification center. Admin categories hold
# things that need an admin's or teacher's attention (the dashboard bell).
PERSONAL_CATEGORIES = (
    "messages", "assignments", "courses", "live",
    "community", "groups", "billing", "boards",
)
ADMIN_CATEGORIES = ("teaching", "people", "integrations", "newsletter", "plan", "automation")
NOTIFICATION_CATEGORIES = PERSONAL_CATEGORIES + ADMIN_CATEGORIES

AUDIENCES = ("personal", "admin")
PRIORITIES = ("normal", "important")


@dataclass(frozen=True)
class TypeMeta:
    category: str
    audience: str = "personal"
    priority: str = "normal"
    # Who gets an admin notification when the org has not chosen: any of
    # "admins" (role 1), "maintainers" (role 2), "course_authors" (the
    # creators, maintainers and contributors of the course it is about).
    default_roles: tuple[str, ...] = ()


ADMIN_ROLE_GROUPS = ("admins", "maintainers", "course_authors")

NOTIFICATION_TYPE_META: dict[str, TypeMeta] = {
    # messages
    "message": TypeMeta("messages"),
    # assignments, deadlines, required training
    "assignment_graded": TypeMeta("assignments"),
    "assignment_due": TypeMeta("assignments", priority="important"),
    "training_assigned": TypeMeta("assignments"),
    "training_due": TypeMeta("assignments", priority="important"),
    "training_overdue": TypeMeta("assignments", priority="important"),
    # courses, paths, certificates, purchases that open a course
    "chapter_unlocked": TypeMeta("courses"),
    "course_update": TypeMeta("courses"),
    "chapter_added": TypeMeta("courses"),
    "certificate": TypeMeta("courses"),
    "path_assigned": TypeMeta("courses"),
    "path_completed": TypeMeta("courses"),
    "play_shared": TypeMeta("courses"),
    # live sessions
    "live_session": TypeMeta("live", priority="important"),
    "live_recording": TypeMeta("live"),
    # communities, comments, mentions, notes
    "discussion_reply": TypeMeta("community"),
    "discussion_mention": TypeMeta("community"),
    "editor_comment": TypeMeta("community"),
    "editor_mention": TypeMeta("community"),
    "note_shared": TypeMeta("community"),
    # user groups
    "group_joined": TypeMeta("groups"),
    "group_left": TypeMeta("groups"),
    "group_announcement": TypeMeta("groups"),
    "group_access_expiring": TypeMeta("groups", priority="important"),
    # purchases, subscriptions, seats
    "purchase_confirmed": TypeMeta("billing"),
    "subscription_renewed": TypeMeta("billing"),
    "payment_failed": TypeMeta("billing", priority="important"),
    "seat_assigned": TypeMeta("billing"),
    # boards
    "board_invited": TypeMeta("boards"),
    "board_mention": TypeMeta("boards"),
    "board_feedback": TypeMeta("boards"),
    "board_hand_raise": TypeMeta("boards"),
    "board_breakout": TypeMeta("boards"),
    # ---- admin / teacher (dashboard) ----
    "submission_to_grade": TypeMeta("teaching", "admin", default_roles=("course_authors",)),
    "training_overdue_report": TypeMeta("teaching", "admin", default_roles=("admins",)),
    "member_joined": TypeMeta("people", "admin", default_roles=("admins",)),
    "signup_pending": TypeMeta("people", "admin", "important", default_roles=("admins",)),
    "join_request": TypeMeta("people", "admin", "important", default_roles=("admins",)),
    "seat_limit_reached": TypeMeta("people", "admin", "important", default_roles=("admins",)),
    "integration_alert": TypeMeta("integrations", "admin", "important", default_roles=("admins",)),
    "crm_sync_errors": TypeMeta("integrations", "admin", "important", default_roles=("admins",)),
    "newsletter_sent": TypeMeta("newsletter", "admin", default_roles=("admins",)),
    "newsletter_paused": TypeMeta("newsletter", "admin", "important", default_roles=("admins",)),
    "newsletter_bounces": TypeMeta("newsletter", "admin", "important", default_roles=("admins",)),
    "plan_limit_near": TypeMeta("plan", "admin", "important", default_roles=("admins",)),
    "poc_ending": TypeMeta("plan", "admin", "important", default_roles=("admins",)),
    "ai_credits_low": TypeMeta("plan", "admin", "important", default_roles=("admins",)),
    "org_payment_failed": TypeMeta("plan", "admin", "important", default_roles=("admins",)),
    "agent_run_finished": TypeMeta("automation", "admin"),
    "agent_run_failed": TypeMeta("automation", "admin", "important"),
}

# Where each type opens (web routes, relative to the org's site). Emitters put
# the concrete path in ``data["path"]``; this is the contract the tests and the
# docs check against. Every type must have one.
NOTIFICATION_LINKS: dict[str, str] = {
    "message": "/messages?c={conversation}",
    "assignment_graded": "/course/{course}/activity/{activity}",
    "assignment_due": "/course/{course}/activity/{activity}",
    "training_assigned": "/course/{course} | /path/{path}",
    "training_due": "/course/{course} | /path/{path}",
    "training_overdue": "/course/{course} | /path/{path}",
    "chapter_unlocked": "/course/{course}",
    "course_update": "/course/{course}",
    "chapter_added": "/course/{course}",
    "certificate": "/certificates/{certificate}/verify",
    "path_assigned": "/path/{path}",
    "path_completed": "/path/{path}",
    "play_shared": "/play/{play}",
    "live_session": "/live/{session}",
    "live_recording": "/live/{session}",
    "discussion_reply": "/community/{community}/discussion/{discussion}",
    "discussion_mention": "/community/{community}/discussion/{discussion}",
    "editor_comment": "/course/{course}/activity/{activity}/edit?thread={thread}",
    "editor_mention": "/course/{course}/activity/{activity}/edit?thread={thread}",
    "note_shared": "/course/{course}/activity/{activity}",
    "group_joined": "/groups/{group}",
    "group_left": "/groups/{group}",
    "group_announcement": "/groups/{group}",
    "group_access_expiring": "/groups/{group}",
    "purchase_confirmed": "/account/purchases",
    "subscription_renewed": "/account/purchases",
    "payment_failed": "/account/purchases",
    "seat_assigned": "/course/{course} | /",
    "board_invited": "/board/{board}",
    "board_mention": "/board/{board}",
    "board_feedback": "/board/{board}",
    "board_hand_raise": "/board/{board}",
    "board_breakout": "/board/{board}",
    "submission_to_grade": "/dash/assignments/{assignment}?subpage=submissions",
    "training_overdue_report": "/dash/training",
    "member_joined": "/dash/users/settings/users",
    "signup_pending": "/dash/users/settings/users",
    "join_request": "/dash/users/settings/users",
    "seat_limit_reached": "/dash/customers/{company}",
    "integration_alert": "/dash/org/settings/integrations?provider={provider}",
    "crm_sync_errors": "/dash/org/settings/integrations?provider={provider}",
    "newsletter_sent": "/dash/newsletter/campaigns/{campaign}",
    "newsletter_paused": "/dash/newsletter/campaigns/{campaign}",
    "newsletter_bounces": "/dash/newsletter/campaigns/{campaign}",
    "plan_limit_near": "/dash/org/settings/plan",
    "poc_ending": "/dash/org/settings/plan",
    "ai_credits_low": "/dash/org/settings/plan",
    "org_payment_failed": "/dash/org/settings/plan",
    "agent_run_finished": "/dash/atlas?tab=scheduled&run={run}",
    "agent_run_failed": "/dash/atlas?tab=scheduled&run={run}",
}

# type -> category, kept for callers (and the mobile app) that only need that.
NOTIFICATION_TYPES = {k: v.category for k, v in NOTIFICATION_TYPE_META.items()}


def category_for(type_: str) -> str:
    return NOTIFICATION_TYPES.get(type_, "courses")


def meta_for(type_: str) -> TypeMeta:
    return NOTIFICATION_TYPE_META.get(type_) or TypeMeta(category_for(type_))


def audience_of_category(category: str) -> str:
    return "admin" if category in ADMIN_CATEGORIES else "personal"


class Notification(SQLModel, table=True):
    __tablename__ = "notification"
    __table_args__ = (
        UniqueConstraint("user_id", "dedupe_key", name="uq_notification_user_dedupe"),
        Index("ix_notification_user_org_id", "user_id", "org_id", "id"),
        Index("ix_notification_user_group", "user_id", "group_key"),
        Index("ix_notification_user_audience_id", "user_id", "audience", "id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    notification_uuid: str = Field(default="", index=True)
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    # Null for notifications that belong to no org (none today).
    org_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=True),
    )
    # One of NOTIFICATION_TYPES.
    type: str
    category: str = "courses"
    title: str = ""
    body: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    # What the client needs to open the right screen: entity uuids plus a web
    # ``path`` relative to the org's site.
    data: dict = Field(default_factory=dict, sa_column=Column(JSON))
    # Small avatar/emoji hint for the row (sender avatar, course thumbnail).
    image: Optional[str] = None
    group_key: Optional[str] = None
    dedupe_key: Optional[str] = None
    # How many events this row stands for (collapsed messages).
    count: int = 1
    # "personal" (the learner bell) or "admin" (the dashboard bell).
    audience: str = Field(default="personal", sa_column=Column(String, nullable=False, server_default="personal"))
    # "normal" or "important" (toasts, digests).
    priority: str = Field(default="normal", sa_column=Column(String, nullable=False, server_default="normal"))
    # Who caused it (the replier, the grader); null for system events.
    actor_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
    )
    # Archived rows leave the inbox but stay searchable on the full page.
    archived_at: Optional[str] = None
    # Past this instant the row is hidden (a live session that ended).
    expires_at: Optional[str] = None
    # Set once the row went out in an email digest.
    emailed_at: Optional[str] = None
    # ISO 8601 UTC strings, like the rest of messaging.
    read_at: Optional[str] = Field(default=None, index=True)
    creation_date: str = ""
    update_date: str = ""


class PushDevice(SQLModel, table=True):
    __tablename__ = "push_device"
    __table_args__ = (
        UniqueConstraint("token", name="uq_push_device_token"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    # Set when the app is signed in to one org: only that org's notifications
    # are pushed to the device. Null means every org.
    org_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=True),
    )
    # "ExponentPushToken[...]"
    token: str
    # "ios" | "android"
    platform: str = ""
    device_name: str = ""
    app_version: str = ""
    creation_date: str = ""
    last_seen_at: str = ""


class NotificationPreference(SQLModel, table=True):
    __tablename__ = "notification_preference"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_notification_preference_user"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    # Master switch for push. The inbox always gets the row.
    push_enabled: bool = True
    # category -> bool; a missing category means on.
    push_categories: dict = Field(default_factory=dict, sa_column=Column(JSON))
    # category -> {"in_app": bool, "email": bool, "push": bool}; missing
    # entries fall back to the defaults in the service. ``push`` mirrors
    # ``push_categories`` so the mobile contract keeps working.
    channels: dict = Field(default_factory=dict, sa_column=Column(JSON))
    # "off" | "daily" | "weekly": email of unread important items.
    email_digest: str = Field(default="off", sa_column=Column(String, nullable=False, server_default="off"))
    last_digest_at: Optional[str] = None
    update_date: str = ""


class OrgNotificationSetting(SQLModel, table=True):
    """Which roles hear about each admin event in an org. One optional row
    per org; a missing type uses ``TypeMeta.default_roles``."""

    __tablename__ = "org_notification_setting"
    __table_args__ = (
        UniqueConstraint("org_id", name="uq_org_notification_setting_org"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    # type -> list of ADMIN_ROLE_GROUPS (empty list: nobody)
    admin_routing: dict = Field(default_factory=dict, sa_column=Column(JSON))
    update_date: str = ""
