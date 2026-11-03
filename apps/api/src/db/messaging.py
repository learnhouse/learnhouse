from typing import Optional
from sqlalchemy import JSON, BigInteger, Column, ForeignKey, Index, Integer, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


# ----------------------------------------------------------------------------
# Agents: org-scoped assistants people build themselves. Each one answers from
# the org's indexed course content (optionally narrowed to a few courses) plus,
# when allowed, the model's own knowledge. The org's default agent replaces the
# old copilot when messaging is on.
# ----------------------------------------------------------------------------

class Agent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    agent_uuid: str = Field(default="", index=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    # Null for the org's built-in default agent.
    owner_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=True, index=True),
    )
    name: str
    description: str = ""
    emoji: str = "✨"
    color: str = "#6366f1"
    secondary_color: str = "#a855f7"
    instructions: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    # "friendly" | "concise" | "socratic" | "expert" | "playful"
    tone: str = "friendly"
    # "course_only" keeps answers to the org's content, "general" lets the
    # model add its own knowledge (marked as such).
    knowledge_mode: str = "course_only"
    # Empty means every course the person chatting can read.
    course_uuids: list = Field(default_factory=list, sa_column=Column(JSON))
    greeting: str = ""
    starters: list = Field(default_factory=list, sa_column=Column(JSON))
    # "private" (owner only) | "org" (every member can chat with it)
    visibility: str = "private"
    is_default: bool = False
    creation_date: str = ""
    update_date: str = ""


# ----------------------------------------------------------------------------
# Conversations
# ----------------------------------------------------------------------------

class Conversation(SQLModel, table=True):
    __table_args__ = (
        Index("ix_conversation_org_kind", "org_id", "kind"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_uuid: str = Field(default="", index=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    # "dm" | "group" | "broadcast" | "agent"
    kind: str = "dm"
    title: str = ""
    emoji: str = ""
    # Sorted "lo:hi" user ids, so a pair of people has exactly one DM.
    dm_key: Optional[str] = Field(default=None, index=True)
    # Broadcast channels: the course they announce to (null = whole org).
    course_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=True, index=True),
    )
    # Agent chats: the agent on the other side.
    agent_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("agent.id", ondelete="CASCADE"), nullable=True, index=True),
    )
    created_by: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
    )
    last_message_at: str = ""
    creation_date: str = ""
    update_date: str = ""


class ConversationMember(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("conversation_id", "user_id", name="uq_conversationmember_conv_user"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(
        sa_column=Column(Integer, ForeignKey("conversation.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    # "owner" | "admin" | "member". In broadcast channels only owners and
    # admins post; members read and react.
    role: str = "member"
    last_read_message_id: int = 0
    # Highest message already included in an unread-messages email, so the
    # same message is never mailed twice.
    last_emailed_message_id: int = 0
    muted: bool = False
    pinned: bool = False
    archived: bool = False
    joined_at: str = ""


class Message(SQLModel, table=True):
    __table_args__ = (
        Index("ix_message_conversation_id_id", "conversation_id", "id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    message_uuid: str = Field(default="", index=True)
    conversation_id: int = Field(
        sa_column=Column(Integer, ForeignKey("conversation.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    sender_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True, index=True),
    )
    sender_agent_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("agent.id", ondelete="SET NULL"), nullable=True),
    )
    # "text" | "announcement" | "course_share" | "system"
    kind: str = "text"
    content: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    # Shared course card, agent sources, etc.
    attachment: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    reply_to_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("message.id", ondelete="SET NULL"), nullable=True),
    )
    # "complete" | "streaming" | "error" (agent replies stream in)
    status: str = "complete"
    edited_at: Optional[str] = None
    deleted_at: Optional[str] = None
    creation_date: str = ""


class MessageReaction(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", "emoji", name="uq_messagereaction_msg_user_emoji"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    message_id: int = Field(
        sa_column=Column(Integer, ForeignKey("message.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    emoji: str
    creation_date: str = ""


class MessagingProfile(SQLModel, table=True):
    """Per-user presence preferences: a custom status and how they show up."""

    __table_args__ = (
        UniqueConstraint("user_id", name="uq_messagingprofile_user"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    # "auto" (online while connected) | "away" | "dnd" | "invisible"
    availability: str = "auto"
    status_emoji: str = ""
    status_text: str = ""
    # ISO timestamp; a status set "until" this time clears itself.
    status_expires_at: Optional[str] = None
    last_seen_at: Optional[str] = None
    # Off = only people already in a conversation with you can message you.
    allow_dms: bool = True

    # Notification preferences.
    # "all" | "direct" (DMs, agent chats, replies and mentions) | "off"
    email_mode: str = "direct"
    # How long a message must sit unread before it is emailed.
    email_delay_minutes: int = 60
    email_broadcasts: bool = True
    desktop_notifications: bool = True
    sounds: bool = True
    # Off = others don't see when you've read their messages.
    read_receipts: bool = True
    typing_indicators: bool = True
    update_date: str = ""


class MessageReminder(SQLModel, table=True):
    """Something an agent (or the person) promised to bring back up later.

    Agent reminders are delivered by that agent into the conversation they
    were asked in, so "remind us Friday" in a group reaches the whole group.
    Personal reminders set from a message land in the person's default agent
    chat.
    """

    __table_args__ = (
        Index("ix_messagereminder_due", "sent_at", "cancelled_at", "due_at"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    reminder_uuid: str = Field(default="", index=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    # Who asked for it (and who can cancel it).
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    conversation_id: int = Field(
        sa_column=Column(Integer, ForeignKey("conversation.id", ondelete="CASCADE"), nullable=False)
    )
    agent_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("agent.id", ondelete="SET NULL"), nullable=True),
    )
    text: str = Field(sa_column=Column(Text, nullable=False))
    # ISO 8601 in UTC, so string comparison orders correctly.
    due_at: str
    # The message it was set from (the agent reply, or the message the person
    # asked to be reminded about).
    source_message_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("message.id", ondelete="SET NULL"), nullable=True),
    )
    sent_at: Optional[str] = None
    cancelled_at: Optional[str] = None
    creation_date: str = ""
