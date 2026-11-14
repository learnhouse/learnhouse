"""Add collection options to analytics settings

One JSONB column on ``analytics_settings`` for the per-org collection
options (tracked categories, excluded IPs and email domains, Do Not Track,
bot filtering). An empty object keeps the previous behavior.

Revision ID: i8e3a5b7c2d4
Revises: h7d2f4a9c3e1
Create Date: 2026-11-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'i8e3a5b7c2d4'
down_revision: Union[str, None] = 'h7d2f4a9c3e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    columns = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('analytics_settings')}
    if 'options' not in columns:
        op.add_column(
            'analytics_settings',
            sa.Column('options', postgresql.JSONB(), nullable=False, server_default='{}'),
        )


def downgrade() -> None:
    op.drop_column('analytics_settings', 'options')
