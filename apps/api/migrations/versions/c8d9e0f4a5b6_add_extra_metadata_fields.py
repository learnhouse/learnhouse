"""Add extra_metadata JSONB columns to course, chapter, activity, user

Adds a nullable ``extra_metadata`` JSONB column to ``course``, ``chapter``,
``activity``, and ``user`` so headless / external integrations can attach
arbitrary key-value data (Stripe-style metadata) to these resources without
schema changes. JSONB is used for index/operator support on Postgres.

The column is named ``extra_metadata`` rather than ``metadata`` because
``metadata`` is a reserved attribute on SQLAlchemy's declarative base.

Revision ID: c8d9e0f4a5b6
Revises: b7c8d9e0f3a4
Create Date: 2026-05-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401
from sqlalchemy.dialects import postgresql


revision: str = 'c8d9e0f4a5b6'
down_revision: Union[str, None] = 'b7c8d9e0f3a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLES = ('course', 'chapter', 'activity', 'user')


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    for table in TABLES:
        if table not in existing_tables:
            continue
        existing_columns = {col['name'] for col in inspector.get_columns(table)}
        if 'extra_metadata' in existing_columns:
            continue
        op.add_column(
            table,
            sa.Column(
                'extra_metadata',
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=True,
            ),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    for table in TABLES:
        if table not in existing_tables:
            continue
        existing_columns = {col['name'] for col in inspector.get_columns(table)}
        if 'extra_metadata' in existing_columns:
            op.drop_column(table, 'extra_metadata')
