"""Board snapshots: saved versions of a board's Yjs document

Adds ``board_snapshot``, one row per saved version of a board. Restoring a
version happens client-side through the live collab doc.

Revision ID: b8s3n7p2k5q1
Revises: w4c7m2p9s3k1
Create Date: 2026-11-11 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8s3n7p2k5q1'
down_revision: Union[str, None] = 'w4c7m2p9s3k1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if 'board_snapshot' in inspector.get_table_names():
        return
    op.create_table(
        'board_snapshot',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('board_id', sa.Integer(), sa.ForeignKey('board.id', ondelete='CASCADE'), nullable=False),
        sa.Column('snapshot_uuid', sa.String(), nullable=False),
        sa.Column('label', sa.String(120), nullable=False, server_default=''),
        sa.Column('ydoc_state', sa.LargeBinary(), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('item_count', sa.Integer(), nullable=True),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('creation_date', sa.String(), nullable=False, server_default=''),
    )
    op.create_index('ix_board_snapshot_board_id', 'board_snapshot', ['board_id'])
    op.create_index('ix_board_snapshot_snapshot_uuid', 'board_snapshot', ['snapshot_uuid'])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if 'board_snapshot' in inspector.get_table_names():
        op.drop_table('board_snapshot')
