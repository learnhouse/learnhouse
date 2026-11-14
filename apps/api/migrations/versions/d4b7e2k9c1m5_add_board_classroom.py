"""Teaching on boards: class controls, attendance and copies

Adds ``board_classroom`` (a board's class controls), ``board_attendance``
(who had a board open, per day) and ``board_copy_set`` / ``board_copy``
(per-student and breakout copies of a board).

Revision ID: d4b7e2k9c1m5
Revises: c7r4m2s9h1k3
Create Date: 2026-11-13 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4b7e2k9c1m5'
down_revision: Union[str, None] = 'c7r4m2s9h1k3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if 'board_classroom' not in tables:
        op.create_table(
            'board_classroom',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('board_id', sa.Integer(), sa.ForeignKey('board.id', ondelete='CASCADE'), nullable=False),
            sa.Column('settings', sa.JSON(), nullable=False),
            sa.Column('update_date', sa.String(), nullable=False, server_default=''),
        )
        op.create_index('ix_board_classroom_board_id', 'board_classroom', ['board_id'], unique=True)
    if 'board_attendance' not in tables:
        op.create_table(
            'board_attendance',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('board_id', sa.Integer(), sa.ForeignKey('board.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('day', sa.String(10), nullable=False, server_default=''),
            sa.Column('first_seen', sa.DateTime(timezone=True), nullable=False),
            sa.Column('last_seen', sa.DateTime(timezone=True), nullable=False),
            sa.Column('seconds', sa.Integer(), nullable=False, server_default='0'),
            sa.UniqueConstraint('board_id', 'user_id', 'day', name='uq_board_attendance_day'),
        )
        op.create_index('ix_board_attendance_board_id', 'board_attendance', ['board_id'])
        op.create_index('ix_board_attendance_user_id', 'board_attendance', ['user_id'])
    if 'board_copy_set' not in tables:
        op.create_table(
            'board_copy_set',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('set_uuid', sa.String(), nullable=False, server_default=''),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('board_id', sa.Integer(), sa.ForeignKey('board.id', ondelete='CASCADE'), nullable=True),
            sa.Column('kind', sa.String(20), nullable=False, server_default='student'),
            sa.Column('title', sa.String(200), nullable=False, server_default=''),
            sa.Column('usergroup_id', sa.Integer(), sa.ForeignKey('usergroup.id', ondelete='SET NULL'), nullable=True),
            sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('creation_date', sa.String(), nullable=False, server_default=''),
            sa.Column('closed_date', sa.String(), nullable=True),
            sa.Column('due_date', sa.String(), nullable=True),
        )
        op.create_index('ix_board_copy_set_set_uuid', 'board_copy_set', ['set_uuid'])
        op.create_index('ix_board_copy_set_org_id', 'board_copy_set', ['org_id'])
        op.create_index('ix_board_copy_set_board_id', 'board_copy_set', ['board_id'])
    if 'board_copy' not in tables:
        op.create_table(
            'board_copy',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('copy_uuid', sa.String(), nullable=False, server_default=''),
            sa.Column('set_id', sa.Integer(), sa.ForeignKey('board_copy_set.id', ondelete='CASCADE'), nullable=False),
            sa.Column('board_id', sa.Integer(), sa.ForeignKey('board.id', ondelete='CASCADE'), nullable=False),
            sa.Column('name', sa.String(200), nullable=False, server_default=''),
            sa.Column('user_ids', sa.JSON(), nullable=False),
            sa.Column('status', sa.String(20), nullable=False, server_default='assigned'),
            sa.Column('feedback', sa.String(4000), nullable=False, server_default=''),
            sa.Column('grade', sa.Integer(), nullable=True),
            sa.Column('submitted_date', sa.String(), nullable=True),
            sa.Column('returned_date', sa.String(), nullable=True),
        )
        op.create_index('ix_board_copy_copy_uuid', 'board_copy', ['copy_uuid'])
        op.create_index('ix_board_copy_set_id', 'board_copy', ['set_id'])
        op.create_index('ix_board_copy_board_id', 'board_copy', ['board_id'])


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    for name in ('board_copy', 'board_copy_set', 'board_attendance', 'board_classroom'):
        if name in tables:
            op.drop_table(name)
