"""Add activity comment threads (editor comments)

- ``activity_comment_thread``: a thread anchored on activity text by the
  editor's ``comment`` mark (``threadId`` = ``thread_uuid``), open or resolved
- ``activity_comment``: the comments of a thread, soft-deleted

Revision ID: o3c9d1e7a5b2
Revises: n7p2c4a8e1f3
Create Date: 2026-11-09 20:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'o3c9d1e7a5b2'
down_revision: Union[str, None] = 'n7p2c4a8e1f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if 'activity_comment_thread' not in tables:
        op.create_table(
            'activity_comment_thread',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('thread_uuid', sa.String(), nullable=False),
            sa.Column('activity_id', sa.Integer(), sa.ForeignKey('activity.id', ondelete='CASCADE'), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('quote', sa.String(500), nullable=False, server_default=''),
            sa.Column('status', sa.String(16), nullable=False, server_default='open'),
            sa.Column('resolved_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('resolved_at', sa.String(), nullable=True),
            sa.Column('created_at', sa.String(), nullable=False),
            sa.Column('updated_at', sa.String(), nullable=False),
        )
        op.create_index(
            'ix_activity_comment_thread_thread_uuid', 'activity_comment_thread', ['thread_uuid'], unique=True
        )
        op.create_index('ix_activity_comment_thread_org_id', 'activity_comment_thread', ['org_id'])
        op.create_index(
            'ix_activity_comment_thread_activity_status', 'activity_comment_thread', ['activity_id', 'status']
        )

    if 'activity_comment' not in tables:
        op.create_table(
            'activity_comment',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('comment_uuid', sa.String(), nullable=False),
            sa.Column(
                'thread_id', sa.Integer(),
                sa.ForeignKey('activity_comment_thread.id', ondelete='CASCADE'), nullable=False,
            ),
            sa.Column('author_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('body', sa.String(5000), nullable=False, server_default=''),
            sa.Column('mentions', sa.JSON(), nullable=False, server_default='[]'),
            sa.Column('edited_at', sa.String(), nullable=True),
            sa.Column('created_at', sa.String(), nullable=False),
            sa.Column('deleted', sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.create_index('ix_activity_comment_comment_uuid', 'activity_comment', ['comment_uuid'], unique=True)
        op.create_index('ix_activity_comment_thread_id', 'activity_comment', ['thread_id'])


def downgrade() -> None:
    op.drop_table('activity_comment')
    op.drop_table('activity_comment_thread')
