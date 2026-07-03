"""Add manually_graded flag to assignmenttasksubmission

Adds a boolean ``manually_graded`` column to ``assignmenttasksubmission``
that defaults to false. When true, the aggregate grading pass skips
server-side re-verification for that task so a teacher's deliberate
override is not overwritten by the auto-grader.

Revision ID: a1b2c3d4e5f7
Revises: 7f2b9d1c3e4a
Create Date: 2026-05-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, None] = '7f2b9d1c3e4a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'assignmenttasksubmission' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('assignmenttasksubmission')}
    if 'manually_graded' in existing_columns:
        return

    op.add_column(
        'assignmenttasksubmission',
        sa.Column(
            'manually_graded',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'assignmenttasksubmission' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('assignmenttasksubmission')}
    if 'manually_graded' in existing_columns:
        op.drop_column('assignmenttasksubmission', 'manually_graded')
