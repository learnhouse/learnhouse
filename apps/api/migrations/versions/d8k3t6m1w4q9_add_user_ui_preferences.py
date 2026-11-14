"""User interface preferences

Adds ``user.ui_preferences`` (JSONB, nullable): per-user interface choices
that follow the account across browsers, starting with the color theme.

Revision ID: d8k3t6m1w4q9
Revises: d4b7e2k9c1m5
Create Date: 2026-11-13 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd8k3t6m1w4q9'
down_revision: Union[str, None] = 'd4b7e2k9c1m5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    columns = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('user')}
    if 'ui_preferences' not in columns:
        op.add_column('user', sa.Column('ui_preferences', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    columns = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('user')}
    if 'ui_preferences' in columns:
        op.drop_column('user', 'ui_preferences')
