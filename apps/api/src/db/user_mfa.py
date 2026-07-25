from typing import Optional
from sqlalchemy import Column, ForeignKey, Index, Integer
from sqlmodel import Field, SQLModel


class UserMFA(SQLModel, table=True):
    """TOTP enrollment for a single user.

    A row exists from the moment enrollment *starts*, but the factor is only
    live once ``confirmed_at`` is set — i.e. once the user has proven the
    authenticator app actually works by submitting a valid code. Unconfirmed
    rows are meaningless and are overwritten if enrollment is restarted.
    """

    __table_args__ = (
        Index("ix_user_mfa_user", "user_id", unique=True),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
        )
    )
    # Fernet-encrypted TOTP shared secret. See services/auth/mfa.py — this is
    # never stored, returned or logged in plaintext after enrollment setup.
    secret_encrypted: str = ""
    confirmed_at: Optional[str] = None
    # Highest TOTP timestep already accepted for this user. A code is rejected
    # if its timestep is <= this value, so an observed code cannot be replayed
    # within its own 30s validity window (or the +/-1 step drift allowance).
    last_used_timestep: Optional[int] = None
    creation_date: str = ""
    update_date: str = ""


class UserMFABackupCode(SQLModel, table=True):
    """Single-use recovery codes, issued in a batch at confirmation time.

    Codes are stored as SHA-256(pepper || code) rather than Argon2. That is a
    deliberate deviation from password storage: these are 100+ bits of
    server-generated entropy, so there is nothing to brute-force, and a fast
    keyed digest lets verification be a single indexed lookup instead of N
    Argon2 verifies (which at 8-10 codes per user would add ~half a second to
    every recovery attempt). Same reasoning as the API-token hashing path.
    """

    __table_args__ = (
        Index("ix_user_mfa_backup_user", "user_id"),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    code_hash: str = Field(index=True)
    used_at: Optional[str] = None
    creation_date: str = ""
