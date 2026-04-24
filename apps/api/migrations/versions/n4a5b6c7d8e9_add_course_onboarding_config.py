"""Add course onboarding_config field

Revision ID: n4a5b6c7d8e9
Revises: b7c8d9e0f3a4
Create Date: 2026-04-24 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'n4a5b6c7d8e9'
down_revision: Union[str, None] = 'b7c8d9e0f3a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('course', sa.Column('onboarding_config', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('course', 'onboarding_config')
