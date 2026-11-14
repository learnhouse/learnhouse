"""Notification center: audience, priority, actor, archive, expiry, digests, org routing

Adds to ``notification``: ``audience`` (personal / admin), ``priority``
(normal / important), ``actor_id``, ``archived_at``, ``expires_at`` and
``emailed_at``, plus a (user_id, audience, id) index for the two bells. Adds
to ``notification_preference``: per category × channel switches
(``channels``), ``email_digest`` and ``last_digest_at``. Creates
``org_notification_setting`` (which roles hear about each admin event).

Revision ID: n7c4t1f9r2a6
Revises: z4s8v2k6n1p3
Create Date: 2026-11-13 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'n7c4t1f9r2a6'
down_revision: Union[str, None] = 'z4s8v2k6n1p3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    return {c['name'] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    tables = set(insp.get_table_names())

    if 'notification' in tables:
        cols = _columns('notification')
        if 'audience' not in cols:
            op.add_column('notification', sa.Column('audience', sa.String(), nullable=False, server_default='personal'))
        if 'priority' not in cols:
            op.add_column('notification', sa.Column('priority', sa.String(), nullable=False, server_default='normal'))
        if 'actor_id' not in cols:
            op.add_column('notification', sa.Column(
                'actor_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True))
        for name in ('archived_at', 'expires_at', 'emailed_at'):
            if name not in cols:
                op.add_column('notification', sa.Column(name, sa.String(), nullable=True))
        indexes = {i['name'] for i in insp.get_indexes('notification')}
        if 'ix_notification_user_audience_id' not in indexes:
            op.create_index('ix_notification_user_audience_id', 'notification', ['user_id', 'audience', 'id'])
        # Rows written before this revision: the CRM alert was the one admin type.
        op.execute("UPDATE notification SET audience = 'admin', category = 'integrations', priority = 'important' "
                   "WHERE type = 'integration_alert'")
        op.execute("UPDATE notification SET category = 'groups' WHERE type LIKE 'group\\_%' ESCAPE '\\'")

    if 'notification_preference' in tables:
        cols = _columns('notification_preference')
        if 'channels' not in cols:
            op.add_column('notification_preference', sa.Column('channels', sa.JSON(), nullable=True))
        if 'email_digest' not in cols:
            op.add_column('notification_preference', sa.Column('email_digest', sa.String(), nullable=False, server_default='off'))
        if 'last_digest_at' not in cols:
            op.add_column('notification_preference', sa.Column('last_digest_at', sa.String(), nullable=True))

    if 'org_notification_setting' not in tables:
        op.create_table(
            'org_notification_setting',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('admin_routing', sa.JSON(), nullable=True),
            sa.Column('update_date', sa.String(), nullable=False, server_default=''),
            sa.UniqueConstraint('org_id', name='uq_org_notification_setting_org'),
        )


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    tables = set(insp.get_table_names())
    if 'org_notification_setting' in tables:
        op.drop_table('org_notification_setting')
    if 'notification_preference' in tables:
        cols = _columns('notification_preference')
        for name in ('last_digest_at', 'email_digest', 'channels'):
            if name in cols:
                op.drop_column('notification_preference', name)
    if 'notification' in tables:
        indexes = {i['name'] for i in insp.get_indexes('notification')}
        if 'ix_notification_user_audience_id' in indexes:
            op.drop_index('ix_notification_user_audience_id', table_name='notification')
        cols = _columns('notification')
        for name in ('emailed_at', 'expires_at', 'archived_at', 'actor_id', 'priority', 'audience'):
            if name in cols:
                op.drop_column('notification', name)
