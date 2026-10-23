"""Add skyroom_live_class table

Revision ID: f2a3b4c5d6e7
Revises: e8f9a0b1c2d3
Create Date: 2026-10-22 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f2a3b4c5d6e7'
down_revision: Union[str, None] = 'e8f9a0b1c2d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'skyroom_live_class',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('liveclass_uuid', sa.String(length=100), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='SET NULL'), nullable=True),
        sa.Column('activity_id', sa.Integer(), sa.ForeignKey('activity.id', ondelete='SET NULL'), nullable=True),
        sa.Column('skyroom_room_id', sa.Integer(), nullable=False),
        sa.Column('room_name', sa.String(length=128), nullable=False),
        sa.Column('title', sa.String(length=128), nullable=False),
        sa.Column('room_url', sa.String(length=2048), nullable=True),
        sa.Column('guest_login', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('op_login_first', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('max_users', sa.Integer(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
        sa.Column('creation_date', sa.String(), nullable=True),
        sa.Column('update_date', sa.String(), nullable=True),
    )
    op.create_index('ix_skyroom_live_class_uuid', 'skyroom_live_class', ['liveclass_uuid'])
    op.create_index('ix_skyroom_live_class_org_id', 'skyroom_live_class', ['org_id'])
    op.create_index('ix_skyroom_live_class_org_room', 'skyroom_live_class', ['org_id', 'skyroom_room_id'])
    op.create_index('ix_skyroom_live_class_course_id', 'skyroom_live_class', ['course_id'])
    op.create_index('ix_skyroom_live_class_activity_id', 'skyroom_live_class', ['activity_id'])


def downgrade() -> None:
    op.drop_index('ix_skyroom_live_class_activity_id', table_name='skyroom_live_class')
    op.drop_index('ix_skyroom_live_class_course_id', table_name='skyroom_live_class')
    op.drop_index('ix_skyroom_live_class_org_room', table_name='skyroom_live_class')
    op.drop_index('ix_skyroom_live_class_org_id', table_name='skyroom_live_class')
    op.drop_index('ix_skyroom_live_class_uuid', table_name='skyroom_live_class')
    op.drop_table('skyroom_live_class')
