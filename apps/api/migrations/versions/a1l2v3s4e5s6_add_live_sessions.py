"""Add live session activity types

Revision ID: a1l2v3s4e5s6
Revises: f2a3b4c5d6e7
Create Date: 2026-11-01 00:00:00.000000

Live sessions are an Enterprise feature: their tables live in the EE package
and are created at startup with the other EE models. Activities stay in core,
so the two enum values they need are added here.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1l2v3s4e5s6'
down_revision: Union[str, None] = 'f2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Plain statements, no autocommit block: `cli.py migrate` runs every
    # migration inside one transaction, which Postgres 12+ (we ship 16)
    # accepts for ADD VALUE as long as nothing uses the value in it. IF NOT
    # EXISTS keeps it safe where the startup create_all already added them.
    op.execute("ALTER TYPE activitytypeenum ADD VALUE IF NOT EXISTS 'TYPE_LIVE_SESSION'")
    op.execute("ALTER TYPE activitysubtypeenum ADD VALUE IF NOT EXISTS 'SUBTYPE_LIVE_SESSION'")


def downgrade() -> None:
    # Postgres cannot drop a single enum value; the two values stay, unused.
    pass
