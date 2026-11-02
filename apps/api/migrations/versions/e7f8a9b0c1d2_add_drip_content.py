"""Add drip content schedule columns

Adds a nullable JSONB ``drip_settings`` column to ``course`` (whether the
course drips its chapters and what the schedule is anchored on) and a
nullable JSONB ``drip_rule`` column to ``chapter`` (when that chapter is
released). Both default to NULL, which means "no schedule": every existing
course keeps showing all of its chapters.

Revision ID: e7f8a9b0c1d2
Revises: 8d2b6f4c1e75
Create Date: 2026-11-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'e7f8a9b0c1d2'
down_revision: Union[str, None] = '8d2b6f4c1e75'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS = (('course', 'drip_settings'), ('chapter', 'drip_rule'))


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for table, column in _COLUMNS:
        if table not in tables:
            continue
        if column in {col['name'] for col in inspector.get_columns(table)}:
            continue
        op.add_column(table, sa.Column(column, postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for table, column in _COLUMNS:
        if table in tables and column in {col['name'] for col in inspector.get_columns(table)}:
            op.drop_column(table, column)
