"""Learner notifications: inbox rows, Expo push devices, push preferences

Adds ``notification`` (one row per thing that happened to a user, collapsed by
``group_key`` while unread and made idempotent by a unique
(user_id, dedupe_key)), ``push_device`` (Expo push tokens, unique per token)
and ``notification_preference`` (optional per-user push switches by category).

Revision ID: p8r2k5v1n6t3
Revises: y3k8m1q6w2e7
Create Date: 2026-11-11 23:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'p8r2k5v1n6t3'
down_revision: Union[str, None] = 'y3k8m1q6w2e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if 'notification' not in tables:
        op.create_table(
            'notification',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('notification_uuid', sa.String(), nullable=False, server_default=''),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=True),
            sa.Column('type', sa.String(), nullable=False),
            sa.Column('category', sa.String(), nullable=False, server_default='courses'),
            sa.Column('title', sa.String(), nullable=False, server_default=''),
            sa.Column('body', sa.Text(), nullable=False, server_default=''),
            sa.Column('data', sa.JSON(), nullable=True),
            sa.Column('image', sa.String(), nullable=True),
            sa.Column('group_key', sa.String(), nullable=True),
            sa.Column('dedupe_key', sa.String(), nullable=True),
            sa.Column('count', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('read_at', sa.String(), nullable=True),
            sa.Column('creation_date', sa.String(), nullable=False, server_default=''),
            sa.Column('update_date', sa.String(), nullable=False, server_default=''),
            sa.UniqueConstraint('user_id', 'dedupe_key', name='uq_notification_user_dedupe'),
        )
        op.create_index('ix_notification_notification_uuid', 'notification', ['notification_uuid'])
        op.create_index('ix_notification_read_at', 'notification', ['read_at'])
        op.create_index('ix_notification_user_org_id', 'notification', ['user_id', 'org_id', 'id'])
        op.create_index('ix_notification_user_group', 'notification', ['user_id', 'group_key'])

    if 'push_device' not in tables:
        op.create_table(
            'push_device',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=True),
            sa.Column('token', sa.String(), nullable=False),
            sa.Column('platform', sa.String(), nullable=False, server_default=''),
            sa.Column('device_name', sa.String(), nullable=False, server_default=''),
            sa.Column('app_version', sa.String(), nullable=False, server_default=''),
            sa.Column('creation_date', sa.String(), nullable=False, server_default=''),
            sa.Column('last_seen_at', sa.String(), nullable=False, server_default=''),
            sa.UniqueConstraint('token', name='uq_push_device_token'),
        )
        op.create_index('ix_push_device_user_id', 'push_device', ['user_id'])

    if 'notification_preference' not in tables:
        op.create_table(
            'notification_preference',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('push_enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('push_categories', sa.JSON(), nullable=True),
            sa.Column('update_date', sa.String(), nullable=False, server_default=''),
            sa.UniqueConstraint('user_id', name='uq_notification_preference_user'),
        )


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    for name in ('notification_preference', 'push_device', 'notification'):
        if name in tables:
            op.drop_table(name)
