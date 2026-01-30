"""Add course SEO field

Revision ID: b3c4d5e6f7a8
Revises: f8a3c2d1e5b7
Create Date: 2025-01-28 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, None] = 'f8a3c2d1e5b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add SEO JSONB column to course table (JSONB supports equality operators for DISTINCT)
    op.add_column('course', sa.Column('seo', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('course', 'seo')
