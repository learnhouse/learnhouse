"""Make assignment.due_date nullable

An assignment no longer has to carry a deadline: self-paced courses have no
date that means anything to a learner who enrolled today. The column was
NOT NULL, so leaving the deadline out failed at insert time even though every
deadline check already treats a missing or unparseable value as "no deadline".

Nothing is backfilled — existing rows keep the date they have.

Revision ID: a3b4c5d6e7f8
Revises: c7d8e9f0a1b2
Create Date: 2026-08-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'a3b4c5d6e7f8'
down_revision: Union[str, None] = 'c7d8e9f0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _due_date_column(inspector: sa.Inspector):
    if 'assignment' not in inspector.get_table_names():
        return None
    for column in inspector.get_columns('assignment'):
        if column['name'] == 'due_date':
            return column
    return None


def upgrade() -> None:
    bind = op.get_bind()
    column = _due_date_column(sa.inspect(bind))
    if column is None or column['nullable']:
        return

    # batch_alter_table so this also runs on SQLite, which cannot ALTER a
    # column in place and needs the table rebuilt around the change.
    with op.batch_alter_table('assignment') as batch_op:
        batch_op.alter_column(
            'due_date',
            existing_type=sa.String(),
            nullable=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    column = _due_date_column(sa.inspect(bind))
    if column is None or not column['nullable']:
        return

    # The column goes back to NOT NULL, so the rows that took advantage of it
    # need a value first. An empty string is what the deadline checks already
    # read as "no deadline", so it is the one value that changes no behaviour.
    op.execute(
        sa.text("UPDATE assignment SET due_date = '' WHERE due_date IS NULL")
    )

    with op.batch_alter_table('assignment') as batch_op:
        batch_op.alter_column(
            'due_date',
            existing_type=sa.String(),
            nullable=False,
        )
