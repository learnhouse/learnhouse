"""Add COMMUNITY to docpagetypeenum

Revision ID: k1f2a3b4c5d6
Revises: j0e1f2a3b4c5
Create Date: 2026-02-07 18:10:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'k1f2a3b4c5d6'
down_revision: Union[str, None] = 'j0e1f2a3b4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE docpagetypeenum ADD VALUE IF NOT EXISTS 'COMMUNITY'")


def downgrade() -> None:
    # PostgreSQL does not support removing values from enum types.
    # The value will remain but be unused after downgrade.
    pass
