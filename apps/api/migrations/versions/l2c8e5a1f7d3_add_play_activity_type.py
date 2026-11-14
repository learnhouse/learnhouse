"""Add play activity types

Revision ID: l2c8e5a1f7d3
Revises: k1a7c3e9f2b4
Create Date: 2026-11-09 00:00:00.000000

A course activity can be a step-by-step Play (an Enterprise feature). Plays
keep their own tables; the activity only links one by uuid, so the two enum
values it needs are added here, like the live session ones.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'l2c8e5a1f7d3'
down_revision: Union[str, None] = 'k1a7c3e9f2b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Same as a1l2v3s4e5s6: ADD VALUE inside the migration transaction is fine
    # on Postgres 12+ as long as nothing uses the value in it, and IF NOT
    # EXISTS keeps it safe where the startup create_all already added them.
    op.execute("ALTER TYPE activitytypeenum ADD VALUE IF NOT EXISTS 'TYPE_PLAY'")
    op.execute("ALTER TYPE activitysubtypeenum ADD VALUE IF NOT EXISTS 'SUBTYPE_PLAY'")


def downgrade() -> None:
    # Postgres cannot drop a single enum value; the two values stay, unused.
    pass
