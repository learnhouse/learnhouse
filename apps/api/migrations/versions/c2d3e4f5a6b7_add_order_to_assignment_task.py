"""Add order to assignment_task

Adds a nullable integer ``order`` column to ``assignmenttask`` so instructors
can reorder the tasks of an assignment. Existing rows are backfilled per
assignment in id order, which is the order learners already saw them in.

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-10-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'assignmenttask' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('assignmenttask')}
    if 'order' not in existing_columns:
        op.add_column('assignmenttask', sa.Column('order', sa.Integer(), nullable=True))

    op.execute(
        """
        UPDATE assignmenttask AS t
        SET "order" = ranked.position
        FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY assignment_id ORDER BY id) - 1 AS position
            FROM assignmenttask
        ) AS ranked
        WHERE t.id = ranked.id AND t."order" IS NULL
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'assignmenttask' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('assignmenttask')}
    if 'order' in existing_columns:
        op.drop_column('assignmenttask', 'order')
