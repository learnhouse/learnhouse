"""Organization invitations and invite codes, stored in Postgres.

An *invitation* is addressed to one email: the admin picks the role, the user
groups and the courses up front, and whichever way the person arrives (the
personal link, the hub's pending list, Google sign-in) they land with all of
it applied. Only a SHA-256 of the link token is kept.

An *invite code* is a shareable join link or code. It can carry a default
role (never one with management rights or dashboard access), groups and
courses, an optional use cap and an expiry, and counts its uses.

Both replace the Redis records used before; those are still honoured until
they expire (see ``src.services.orgs.invitations``).
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlmodel import Field, SQLModel


class InvitationStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    REVOKED = "revoked"
    EXPIRED = "expired"


class OrgInvitation(SQLModel, table=True):
    __tablename__ = "org_invitation"
    __table_args__ = (
        Index("ix_org_invitation_org_status", "org_id", "status"),
        Index("ix_org_invitation_email_status", "email", "status"),
        UniqueConstraint("token_hash", name="uq_org_invitation_token_hash"),
        UniqueConstraint("copy_token_hash", name="uq_org_invitation_copy_token_hash"),
        # At most one pending invitation per address and org.
        Index(
            "uq_org_invitation_pending_email", "org_id", "email", unique=True,
            postgresql_where=text("status = 'pending'"), sqlite_where=text("status = 'pending'"),
        ),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    invitation_uuid: str = Field(sa_column=Column(String(64), nullable=False, unique=True, index=True))
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    # Lower-cased and trimmed: every lookup compares on this form.
    email: str = Field(sa_column=Column(String(320), nullable=False))
    # NULL when the role was deleted after the invitation was sent; joining
    # then falls back to the default User role.
    role_id: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("role.id", ondelete="SET NULL"), nullable=True)
    )
    usergroup_ids: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False, default=list))
    course_uuids: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False, default=list))
    message: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    invited_by_user_id: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    )
    status: str = Field(default=InvitationStatus.PENDING.value, sa_column=Column(String(16), nullable=False))
    # SHA-256 hex of the personal link token; rotated on resend.
    token_hash: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    # How the current token reached the invitee: "email" (sent to the invited
    # address, so following it proves the inbox) or "copied" (handed to the
    # admin to share by hand, which proves nothing about the inbox).
    token_delivery: Optional[str] = Field(default=None, sa_column=Column(String(16), nullable=True))
    # SHA-256 hex of the link an admin copied to share by hand. Kept apart
    # from ``token_hash`` so copying a link never breaks the emailed one; a
    # copied link proves nothing about the inbox. Rotated on each copy.
    copy_token_hash: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    accepted_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    accepted_user_id: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    )
    # Whether the last email went out, how many were sent and when.
    email_sent: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, default=False))
    send_count: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0))
    last_sent_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))


class OrgInviteCode(SQLModel, table=True):
    __tablename__ = "org_invite_code"
    __table_args__ = (
        Index("ix_org_invite_code_org_code", "org_id", "code", unique=True),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    # Same "org_invite_code_<uuid4>" shape as the Redis codes, so links and
    # API clients built on it keep working.
    code_uuid: str = Field(sa_column=Column(String(64), nullable=False, unique=True, index=True))
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    code: str = Field(sa_column=Column(String(32), nullable=False))
    role_id: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("role.id", ondelete="SET NULL"), nullable=True)
    )
    usergroup_ids: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False, default=list))
    course_uuids: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False, default=list))
    max_uses: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    uses: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0))
    expires_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    revoked_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    created_by_user_id: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    )
    created_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
