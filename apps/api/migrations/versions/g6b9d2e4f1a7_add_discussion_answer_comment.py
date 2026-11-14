"""Add an accepted answer to community discussions

Adds a nullable ``answer_comment_id`` column to ``discussion`` pointing at the
reply the thread author (or a moderator) marked as the answer. No foreign
key: discussion and discussioncomment would reference each other, so the
comment service clears the mark when that reply is deleted. Existing threads
have no answer.

Revision ID: g6b9d2e4f1a7
Revises: f5a8c1d2e3b4
Create Date: 2026-11-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'g6b9d2e4f1a7'
down_revision: Union[str, None] = 'f5a8c1d2e3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'discussion' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('discussion')}
    if 'answer_comment_id' in existing_columns:
        return

    op.add_column(
        'discussion',
        sa.Column('answer_comment_id', sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'discussion' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('discussion')}
    if 'answer_comment_id' in existing_columns:
        op.drop_column('discussion', 'answer_comment_id')
