"""Add TYPE_LIVE_SESSION to activitytypeenum and subtypes

Revision ID: s8t9u0v1w2x3
Revises: r7s8t9u0v1w2
Create Date: 2026-03-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401


revision: str = 's8t9u0v1w2x3'
down_revision: Union[str, None] = 'r7s8t9u0v1w2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("COMMIT")
    op.execute("ALTER TYPE activitytypeenum ADD VALUE IF NOT EXISTS 'TYPE_LIVE_SESSION'")
    op.execute("ALTER TYPE activitysubtypeenum ADD VALUE IF NOT EXISTS 'SUBTYPE_LIVE_SESSION_EXTERNAL'")
    op.execute("ALTER TYPE activitysubtypeenum ADD VALUE IF NOT EXISTS 'SUBTYPE_LIVE_SESSION_NATIVE'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values directly.
    pass
