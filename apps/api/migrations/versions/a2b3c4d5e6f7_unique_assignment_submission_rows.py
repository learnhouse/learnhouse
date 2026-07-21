"""Add unique constraints on assignment submission rows

A learner has exactly one AssignmentUserSubmission per (user, assignment) and one
AssignmentTaskSubmission per (user, task) — retries reset the row in place. Without
DB constraints, two concurrent submit / save-progress requests could each pass the
"does a row already exist?" SELECT and both INSERT, producing duplicate rows that
split grading and double-fire webhooks.

De-duplicates existing rows (keeping the lowest id per key) then adds the
constraints. Both steps are guarded so a partially-applied DB is safe.

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-07-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TARGETS = [
    ('assignmentusersubmission', 'uq_assignmentusersubmission_user_assignment',
     ['user_id', 'assignment_id']),
    ('assignmenttasksubmission', 'uq_assignmenttasksubmission_user_task',
     ['user_id', 'assignment_task_id']),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table, constraint, cols in _TARGETS:
        if table not in inspector.get_table_names():
            continue
        existing = {uc['name'] for uc in inspector.get_unique_constraints(table)}
        if constraint in existing:
            continue
        a, b = cols
        op.execute(
            sa.text(
                f"""
                DELETE FROM {table} x
                USING {table} y
                WHERE x.{a} = y.{a}
                  AND x.{b} = y.{b}
                  AND x.id > y.id
                """
            )
        )
        op.create_unique_constraint(constraint, table, cols)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    for table, constraint, _cols in _TARGETS:
        if table not in inspector.get_table_names():
            continue
        existing = {uc['name'] for uc in inspector.get_unique_constraints(table)}
        if constraint in existing:
            op.drop_constraint(constraint, table, type_='unique')
