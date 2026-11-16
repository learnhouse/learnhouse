"""Platform console §11: guarded org cleanup, org emails and campaigns

New tables: ``platform_deleted_org`` (tombstones), ``platform_email_template``,
``platform_email_campaign``, ``platform_email_send``.
New columns: ``platform_org_profile.deletion_*`` and
``platform_automation.first_live_allowed_after_preview``.

Revision ID: r6k2m9p4t1x7
Revises: q8n4f1c6b3d9
Create Date: 2026-11-09 22:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'r6k2m9p4t1x7'
down_revision: Union[str, None] = 'q8n4f1c6b3d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PROFILE_COLUMNS = (
    ('deletion_scheduled_at', lambda: sa.Column('deletion_scheduled_at', sa.DateTime(timezone=True), nullable=True)),
    ('deletion_requested_at', lambda: sa.Column('deletion_requested_at', sa.DateTime(timezone=True), nullable=True)),
    ('deletion_reason', lambda: sa.Column('deletion_reason', sa.String(300), nullable=True)),
    ('deletion_requested_by', lambda: sa.Column('deletion_requested_by', sa.String(100), nullable=True)),
    ('deletion_previous_lifecycle', lambda: sa.Column('deletion_previous_lifecycle', sa.String(16), nullable=True)),
)


def _tz(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _user_fk(name: str) -> sa.Column:
    return sa.Column(name, sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if 'platform_org_profile' in tables:
        cols = {c['name'] for c in inspector.get_columns('platform_org_profile')}
        for name, make in _PROFILE_COLUMNS:
            if name not in cols:
                op.add_column('platform_org_profile', make())
        if 'deletion_scheduled_at' not in cols:
            op.create_index('ix_platform_org_profile_deletion_scheduled_at', 'platform_org_profile',
                            ['deletion_scheduled_at'])
    if 'platform_automation' in tables:
        cols = {c['name'] for c in inspector.get_columns('platform_automation')}
        if 'first_live_allowed_after_preview' not in cols:
            op.add_column('platform_automation', _tz('first_live_allowed_after_preview'))

    if 'platform_deleted_org' not in tables:
        op.create_table(
            'platform_deleted_org',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(255), nullable=False),
            sa.Column('slug', sa.String(255), nullable=False),
            sa.Column('admin_emails', sa.JSON(), nullable=False),
            sa.Column('member_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('org_created_at', sa.String(64), nullable=True),
            _tz('deleted_at', nullable=False),
            sa.Column('reason', sa.String(300), nullable=True),
            sa.Column('test_org_score', sa.Integer(), nullable=True),
            sa.Column('score_reasons', sa.JSON(), nullable=False),
            sa.Column('requested_by', sa.String(100), nullable=True),
            sa.Column('executed_by', sa.String(100), nullable=True),
        )
        op.create_index('ix_platform_deleted_org_org_id', 'platform_deleted_org', ['org_id'])
        op.create_index('ix_platform_deleted_org_deleted_at', 'platform_deleted_org', ['deleted_at'])

    if 'platform_email_template' not in tables:
        op.create_table(
            'platform_email_template',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('template_uuid', sa.String(64), nullable=False),
            sa.Column('name', sa.String(120), nullable=False),
            sa.Column('subject', sa.String(200), nullable=False),
            sa.Column('body', sa.Text(), nullable=False),
            sa.Column('category', sa.String(16), nullable=False, server_default='product'),
            _user_fk('created_by_user_id'),
            _tz('created_at', nullable=False),
            _tz('updated_at', nullable=False),
        )
        op.create_index('ix_platform_email_template_template_uuid', 'platform_email_template', ['template_uuid'],
                        unique=True)

    if 'platform_email_campaign' not in tables:
        op.create_table(
            'platform_email_campaign',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('campaign_uuid', sa.String(64), nullable=False),
            sa.Column('name', sa.String(120), nullable=False),
            sa.Column('template_id', sa.Integer(),
                      sa.ForeignKey('platform_email_template.id', ondelete='SET NULL'), nullable=True),
            sa.Column('audience', sa.JSON(), nullable=False),
            sa.Column('recipients', sa.String(16), nullable=False, server_default='admins'),
            sa.Column('status', sa.String(16), nullable=False, server_default='draft'),
            _tz('scheduled_at'),
            sa.Column('stats', sa.JSON(), nullable=False),
            sa.Column('throttle_per_second', sa.Integer(), nullable=False, server_default='5'),
            _user_fk('created_by_user_id'),
            _user_fk('approved_by_user_id'),
            _tz('approved_at'),
            _tz('created_at', nullable=False),
            _tz('updated_at', nullable=False),
            _tz('sent_at'),
        )
        op.create_index('ix_platform_email_campaign_campaign_uuid', 'platform_email_campaign', ['campaign_uuid'],
                        unique=True)
        op.create_index('ix_platform_email_campaign_status', 'platform_email_campaign', ['status'])

    if 'platform_email_send' not in tables:
        op.create_table(
            'platform_email_send',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('campaign_id', sa.Integer(),
                      sa.ForeignKey('platform_email_campaign.id', ondelete='CASCADE'), nullable=True),
            sa.Column('template_id', sa.Integer(), nullable=True),
            sa.Column('automation_id', sa.Integer(), nullable=True),
            sa.Column('kind', sa.String(20), nullable=False),
            sa.Column('org_id', sa.Integer(), nullable=True),
            sa.Column('user_id', sa.Integer(), nullable=True),
            sa.Column('email', sa.String(320), nullable=False),
            sa.Column('status', sa.String(24), nullable=False),
            sa.Column('error', sa.String(300), nullable=True),
            sa.Column('subject', sa.String(200), nullable=True),
            _tz('created_at', nullable=False),
            _tz('sent_at'),
            sa.UniqueConstraint('campaign_id', 'email', name='uq_platform_email_send_campaign_email'),
        )
        op.create_index('ix_platform_email_send_campaign_status', 'platform_email_send', ['campaign_id', 'status'])
        op.create_index('ix_platform_email_send_dedupe', 'platform_email_send', ['org_id', 'email', 'created_at'])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for name in ('platform_email_send', 'platform_email_campaign', 'platform_email_template', 'platform_deleted_org'):
        if name in tables:
            op.drop_table(name)
    if 'platform_automation' in tables:
        if 'first_live_allowed_after_preview' in {c['name'] for c in inspector.get_columns('platform_automation')}:
            op.drop_column('platform_automation', 'first_live_allowed_after_preview')
    if 'platform_org_profile' in tables:
        cols = {c['name'] for c in inspector.get_columns('platform_org_profile')}
        if 'deletion_scheduled_at' in cols:
            op.drop_index('ix_platform_org_profile_deletion_scheduled_at', table_name='platform_org_profile')
        for name, _ in _PROFILE_COLUMNS:
            if name in cols:
                op.drop_column('platform_org_profile', name)
