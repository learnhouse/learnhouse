"""Platform console §9: notifications, follows, tasks, saved views

New tables: ``platform_kv``, ``platform_notification_channel``,
``platform_notification_rule``, ``platform_notification_delivery``,
``platform_notification``, ``platform_notification_preference``,
``platform_org_follow``, ``platform_follow_digest``,
``platform_automation_hit``, ``platform_automation_run_org``,
``platform_task``, ``platform_saved_view``.

New columns: ``platform_automation.trigger / event_types / allow_repeats``
and ``platform_org_profile.signal_state``.

Revision ID: q8n4f1c6b3d9
Revises: p5d2e8f4a6c1
Create Date: 2026-11-09 20:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'q8n4f1c6b3d9'
down_revision: Union[str, None] = 'p5d2e8f4a6c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tz(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _user_fk(name: str, ondelete: str = 'SET NULL', nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.Integer(), sa.ForeignKey('user.id', ondelete=ondelete), nullable=nullable)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if 'platform_automation' in tables:
        cols = {c['name'] for c in inspector.get_columns('platform_automation')}
        if 'trigger' not in cols:
            op.add_column('platform_automation', sa.Column('trigger', sa.String(16), nullable=False, server_default='schedule'))
        if 'event_types' not in cols:
            op.add_column('platform_automation', sa.Column('event_types', sa.JSON(), nullable=False, server_default='[]'))
        if 'allow_repeats' not in cols:
            op.add_column('platform_automation', sa.Column('allow_repeats', sa.Boolean(), nullable=False, server_default=sa.false()))
    if 'platform_org_profile' in tables:
        cols = {c['name'] for c in inspector.get_columns('platform_org_profile')}
        if 'signal_state' not in cols:
            op.add_column('platform_org_profile', sa.Column('signal_state', sa.JSON(), nullable=False, server_default='{}'))

    if 'platform_kv' not in tables:
        op.create_table(
            'platform_kv',
            sa.Column('key', sa.String(128), primary_key=True),
            sa.Column('value', sa.JSON(), nullable=True),
            _tz('updated_at', nullable=False),
        )

    if 'platform_notification_channel' not in tables:
        op.create_table(
            'platform_notification_channel',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('channel_uuid', sa.String(64), nullable=False),
            sa.Column('name', sa.String(120), nullable=False),
            sa.Column('kind', sa.String(16), nullable=False),
            sa.Column('config', sa.JSON(), nullable=False),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            _user_fk('created_by_user_id'),
            _tz('created_at', nullable=False),
            _tz('updated_at', nullable=False),
            _tz('last_delivery_at'),
            sa.Column('last_error', sa.String(500), nullable=True),
            sa.Column('failure_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('disabled_reason', sa.String(200), nullable=True),
        )
        op.create_index('ix_platform_notification_channel_channel_uuid', 'platform_notification_channel',
                        ['channel_uuid'], unique=True)

    if 'platform_notification_rule' not in tables:
        op.create_table(
            'platform_notification_rule',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('rule_uuid', sa.String(64), nullable=False),
            sa.Column('name', sa.String(120), nullable=False),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('channel_id', sa.Integer(),
                      sa.ForeignKey('platform_notification_channel.id', ondelete='SET NULL'), nullable=True),
            sa.Column('event_types', sa.JSON(), nullable=False),
            sa.Column('filters', sa.JSON(), nullable=False),
            sa.Column('mode', sa.String(16), nullable=False, server_default='instant'),
            sa.Column('quiet_hours', sa.JSON(), nullable=True),
            sa.Column('inbox_roles', sa.JSON(), nullable=False),
            _user_fk('created_by_user_id'),
            _tz('created_at', nullable=False),
            _tz('updated_at', nullable=False),
        )
        op.create_index('ix_platform_notification_rule_rule_uuid', 'platform_notification_rule', ['rule_uuid'], unique=True)

    if 'platform_notification_delivery' not in tables:
        op.create_table(
            'platform_notification_delivery',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('rule_id', sa.Integer(),
                      sa.ForeignKey('platform_notification_rule.id', ondelete='SET NULL'), nullable=True),
            sa.Column('channel_id', sa.Integer(),
                      sa.ForeignKey('platform_notification_channel.id', ondelete='CASCADE'), nullable=True),
            sa.Column('recipient_user_id', sa.Integer(), nullable=True),
            sa.Column('event_key', sa.String(64), nullable=False),
            sa.Column('org_id', sa.Integer(), nullable=True),
            sa.Column('status', sa.String(16), nullable=False),
            sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
            _tz('next_attempt_at'),
            sa.Column('error', sa.String(500), nullable=True),
            sa.Column('payload', sa.JSON(), nullable=False),
            sa.Column('payload_hash', sa.String(64), nullable=True),
            _tz('created_at', nullable=False),
            _tz('sent_at'),
        )
        op.create_index('ix_platform_notification_delivery_org_id', 'platform_notification_delivery', ['org_id'])
        op.create_index('ix_platform_notification_delivery_created_at', 'platform_notification_delivery', ['created_at'])
        op.create_index('ix_platform_notification_delivery_due', 'platform_notification_delivery',
                        ['status', 'next_attempt_at'])
        op.create_index('ix_platform_notification_delivery_dedupe', 'platform_notification_delivery',
                        ['payload_hash', 'created_at'])
        op.create_index('ix_platform_notification_delivery_channel_sent', 'platform_notification_delivery',
                        ['channel_id', 'sent_at'])

    if 'platform_notification' not in tables:
        op.create_table(
            'platform_notification',
            sa.Column('id', sa.Integer(), primary_key=True),
            _user_fk('user_id', 'CASCADE', nullable=False),
            sa.Column('event_key', sa.String(64), nullable=False),
            sa.Column('title', sa.String(200), nullable=False),
            sa.Column('body', sa.Text(), nullable=True),
            sa.Column('severity', sa.String(16), nullable=False, server_default='info'),
            sa.Column('link', sa.String(300), nullable=True),
            sa.Column('org_id', sa.Integer(), nullable=True),
            _tz('read_at'),
            _tz('created_at', nullable=False),
        )
        op.create_index('ix_platform_notification_user_created', 'platform_notification', ['user_id', 'created_at'])
        op.create_index('ix_platform_notification_user_read', 'platform_notification', ['user_id', 'read_at'])

    if 'platform_notification_preference' not in tables:
        op.create_table(
            'platform_notification_preference',
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('groups', sa.JSON(), nullable=False),
            sa.Column('daily_digest', sa.Boolean(), nullable=False, server_default=sa.false()),
            _tz('updated_at', nullable=False),
        )

    if 'platform_org_follow' not in tables:
        op.create_table(
            'platform_org_follow',
            sa.Column('id', sa.Integer(), primary_key=True),
            _user_fk('user_id', 'CASCADE', nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('level', sa.String(16), nullable=False, server_default='important'),
            sa.Column('event_types', sa.JSON(), nullable=False),
            sa.Column('deliver_inbox', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('deliver_email', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('channel_id', sa.Integer(),
                      sa.ForeignKey('platform_notification_channel.id', ondelete='SET NULL'), nullable=True),
            _tz('created_at', nullable=False),
            _tz('updated_at', nullable=False),
            sa.UniqueConstraint('user_id', 'org_id', name='uq_platform_org_follow_user_org'),
        )
        op.create_index('ix_platform_org_follow_org', 'platform_org_follow', ['org_id'])

    if 'platform_follow_digest' not in tables:
        op.create_table(
            'platform_follow_digest',
            sa.Column('id', sa.Integer(), primary_key=True),
            _user_fk('user_id', 'CASCADE', nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('counts', sa.JSON(), nullable=False),
            sa.Column('extra', sa.JSON(), nullable=False),
            _tz('first_at', nullable=False),
            _tz('last_at', nullable=False),
            sa.UniqueConstraint('user_id', 'org_id', name='uq_platform_follow_digest_user_org'),
        )
        op.create_index('ix_platform_follow_digest_first_at', 'platform_follow_digest', ['first_at'])

    if 'platform_automation_hit' not in tables:
        op.create_table(
            'platform_automation_hit',
            sa.Column('automation_id', sa.Integer(),
                      sa.ForeignKey('platform_automation.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('org_id', sa.Integer(), primary_key=True),
            _tz('last_at', nullable=False),
        )

    if 'platform_automation_run_org' not in tables:
        op.create_table(
            'platform_automation_run_org',
            sa.Column('run_id', sa.Integer(),
                      sa.ForeignKey('platform_automation_run.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('org_id', sa.Integer(), primary_key=True),
        )
        op.create_index('ix_platform_automation_run_org_org', 'platform_automation_run_org', ['org_id'])

    if 'platform_task' not in tables:
        op.create_table(
            'platform_task',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('task_uuid', sa.String(64), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=True),
            sa.Column('title', sa.String(200), nullable=False),
            sa.Column('notes', sa.Text(), nullable=True),
            _tz('due_at'),
            _user_fk('assignee_user_id'),
            sa.Column('status', sa.String(16), nullable=False, server_default='open'),
            _user_fk('created_by_user_id'),
            sa.Column('created_from', sa.String(100), nullable=False, server_default='manual'),
            _tz('created_at', nullable=False),
            _tz('updated_at', nullable=False),
            _tz('done_at'),
        )
        op.create_index('ix_platform_task_task_uuid', 'platform_task', ['task_uuid'], unique=True)
        op.create_index('ix_platform_task_due_at', 'platform_task', ['due_at'])
        op.create_index('ix_platform_task_assignee_status', 'platform_task', ['assignee_user_id', 'status'])
        op.create_index('ix_platform_task_org', 'platform_task', ['org_id'])

    if 'platform_saved_view' not in tables:
        op.create_table(
            'platform_saved_view',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('view_uuid', sa.String(64), nullable=False),
            sa.Column('page', sa.String(32), nullable=False),
            sa.Column('name', sa.String(120), nullable=False),
            sa.Column('filters', sa.JSON(), nullable=False),
            sa.Column('shared', sa.Boolean(), nullable=False, server_default=sa.false()),
            _user_fk('owner_user_id', 'CASCADE', nullable=False),
            _tz('created_at', nullable=False),
            _tz('updated_at', nullable=False),
        )
        op.create_index('ix_platform_saved_view_view_uuid', 'platform_saved_view', ['view_uuid'], unique=True)
        op.create_index('ix_platform_saved_view_page', 'platform_saved_view', ['page'])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for name in (
        'platform_saved_view',
        'platform_task',
        'platform_automation_run_org',
        'platform_automation_hit',
        'platform_follow_digest',
        'platform_org_follow',
        'platform_notification_preference',
        'platform_notification',
        'platform_notification_delivery',
        'platform_notification_rule',
        'platform_notification_channel',
        'platform_kv',
    ):
        if name in tables:
            op.drop_table(name)
    if 'platform_org_profile' in tables:
        if 'signal_state' in {c['name'] for c in inspector.get_columns('platform_org_profile')}:
            op.drop_column('platform_org_profile', 'signal_state')
    if 'platform_automation' in tables:
        cols = {c['name'] for c in inspector.get_columns('platform_automation')}
        for name in ('allow_repeats', 'event_types', 'trigger'):
            if name in cols:
                op.drop_column('platform_automation', name)
