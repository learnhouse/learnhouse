"""Add assignment retry support

Adds the columns that back the "Try again" feature on assignments:

1. ``assignment.allow_retries`` (nullable BOOL, default false) — opt-in flag
   that lets a graded student reset their work and try the assignment
   again.
2. ``assignment.max_retries`` (nullable INT, default 0) — upper bound on
   the number of attempts. ``0`` means unlimited; the initial submission
   counts as attempt 1, so ``max_retries=3`` allows three graded attempts
   in total (initial + 2 retries).
3. ``assignmentusersubmission.attempt_number`` (nullable INT, default 1) —
   the attempt counter incremented on every successful retry. We keep a
   single submission row per (user, assignment) and reset it in place
   rather than storing a full submission history.

All columns are nullable with server defaults so backfilling existing
rows is cheap on Postgres (no table rewrite required).

Revision ID: c8d9e0f3a4b5
Revises: c8d9e0f4a5b6
Create Date: 2026-05-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'c8d9e0f3a4b5'
down_revision: Union[str, None] = 'c8d9e0f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'assignment' in inspector.get_table_names():
        existing = {col['name'] for col in inspector.get_columns('assignment')}
        if 'allow_retries' not in existing:
            op.add_column(
                'assignment',
                sa.Column(
                    'allow_retries',
                    sa.Boolean(),
                    nullable=True,
                    server_default=sa.false(),
                ),
            )
        if 'max_retries' not in existing:
            op.add_column(
                'assignment',
                sa.Column(
                    'max_retries',
                    sa.Integer(),
                    nullable=True,
                    server_default=sa.text('0'),
                ),
            )

    if 'assignmentusersubmission' in inspector.get_table_names():
        existing = {col['name'] for col in inspector.get_columns('assignmentusersubmission')}
        if 'attempt_number' not in existing:
            op.add_column(
                'assignmentusersubmission',
                sa.Column(
                    'attempt_number',
                    sa.Integer(),
                    nullable=True,
                    server_default=sa.text('1'),
                ),
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'assignmentusersubmission' in inspector.get_table_names():
        existing = {col['name'] for col in inspector.get_columns('assignmentusersubmission')}
        if 'attempt_number' in existing:
            op.drop_column('assignmentusersubmission', 'attempt_number')

    if 'assignment' in inspector.get_table_names():
        existing = {col['name'] for col in inspector.get_columns('assignment')}
        if 'max_retries' in existing:
            op.drop_column('assignment', 'max_retries')
        if 'allow_retries' in existing:
            op.drop_column('assignment', 'allow_retries')
