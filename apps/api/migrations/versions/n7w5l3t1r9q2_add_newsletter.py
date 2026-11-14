"""Newsletter: lists, subscribers, segments, campaigns, sends, templates,
automations, suppressions and per-org sending profiles (EE feature, Standard plan)

Every table is new and owned by the EE newsletter feature. Hard bounces and
complaints land in ``newsletter_suppression`` (``org_id`` NULL = platform-wide).

Revision ID: n7w5l3t1r9q2
Revises: x2l7n4d9p3g6
Create Date: 2026-11-11 20:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'n7w5l3t1r9q2'
down_revision: Union[str, None] = 'x2l7n4d9p3g6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ['newsletter', 'newsletter_subscriber', 'newsletter_segment', 'newsletter_automation', 'newsletter_campaign', 'newsletter_send', 'newsletter_click', 'newsletter_template', 'newsletter_automation_run', 'newsletter_suppression', 'newsletter_sending_profile']


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if 'newsletter' in inspector.get_table_names():
        return
    op.create_table(
        'newsletter',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('newsletter_uuid', sa.String(64), nullable=False, unique=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('slug', sa.String(80), nullable=False),
        sa.Column('description', sa.Text(), nullable=False, server_default=''),
        sa.Column('thumbnail_image', sa.String(500), nullable=False, server_default=''),
        sa.Column('sender_name', sa.String(64), nullable=False, server_default=''),
        sa.Column('reply_to', sa.String(254), nullable=False, server_default=''),
        sa.Column('sender_avatar', sa.String(300), nullable=True),
        sa.Column('sender_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('sender_title', sa.String(80), nullable=False, server_default=''),
        sa.Column('color', sa.String(9), nullable=True),
        sa.Column('access', sa.String(8), nullable=False, server_default='free'),
        sa.Column('public_signup', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('archive_public', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('bundle_course_uuids', sa.JSON(), nullable=False),
        sa.Column('archived', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('org_id', 'slug', name='uq_newsletter_org_slug'),
    )
    op.create_index('ix_newsletter_org', 'newsletter', ['org_id'])
    op.create_table(
        'newsletter_subscriber',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('subscriber_uuid', sa.String(64), nullable=False, unique=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('newsletter_id', sa.Integer(), sa.ForeignKey('newsletter.id', ondelete='CASCADE'), nullable=False),
        sa.Column('email', sa.String(254), nullable=False),
        sa.Column('name', sa.String(200), nullable=False, server_default=''),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('status', sa.String(16), nullable=False, server_default='pending'),
        sa.Column('source', sa.String(16), nullable=False, server_default='signup'),
        sa.Column('language', sa.String(12), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=False),
        sa.Column('custom_fields', sa.JSON(), nullable=False),
        sa.Column('consent', sa.JSON(), nullable=False),
        sa.Column('confirm_sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('unsubscribed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status_reason', sa.String(40), nullable=True),
        sa.Column('last_sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_engaged_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('unengaged_sends', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('sends', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('opens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('clicks', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('newsletter_id', 'email', name='uq_newsletter_subscriber_email'),
    )
    op.create_index('ix_newsletter_subscriber_org_email', 'newsletter_subscriber', ['org_id', 'email'])
    op.create_index('ix_newsletter_subscriber_user', 'newsletter_subscriber', ['user_id'])
    op.create_index('ix_newsletter_subscriber_list_status', 'newsletter_subscriber', ['newsletter_id', 'status'])
    op.create_table(
        'newsletter_segment',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('segment_uuid', sa.String(64), nullable=False, unique=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('newsletter_id', sa.Integer(), sa.ForeignKey('newsletter.id', ondelete='CASCADE'), nullable=True),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('rules', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_newsletter_segment_org', 'newsletter_segment', ['org_id'])
    op.create_table(
        'newsletter_automation',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('automation_uuid', sa.String(64), nullable=False, unique=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('newsletter_id', sa.Integer(), sa.ForeignKey('newsletter.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('trigger', sa.String(20), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('config', sa.JSON(), nullable=False),
        sa.Column('steps', sa.JSON(), nullable=False),
        sa.Column('cursor', sa.JSON(), nullable=False),
        sa.Column('sent', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_run_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_newsletter_automation_org', 'newsletter_automation', ['org_id'])
    op.create_table(
        'newsletter_campaign',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('campaign_uuid', sa.String(64), nullable=False, unique=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('newsletter_id', sa.Integer(), sa.ForeignKey('newsletter.id', ondelete='CASCADE'), nullable=True),
        sa.Column('automation_id', sa.Integer(), sa.ForeignKey('newsletter_automation.id', ondelete='SET NULL'), nullable=True),
        sa.Column('kind', sa.String(12), nullable=False, server_default='campaign'),
        sa.Column('name', sa.String(200), nullable=False, server_default=''),
        sa.Column('subject', sa.String(300), nullable=False, server_default=''),
        sa.Column('subject_b', sa.String(300), nullable=False, server_default=''),
        sa.Column('preheader', sa.String(300), nullable=False, server_default=''),
        sa.Column('doc', sa.JSON(), nullable=False),
        sa.Column('audience', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(12), nullable=False, server_default='draft'),
        sa.Column('status_reason', sa.String(200), nullable=True),
        sa.Column('reason_data', sa.JSON(), nullable=True),
        sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('timezone', sa.String(60), nullable=False, server_default='UTC'),
        sa.Column('ab', sa.JSON(), nullable=False),
        sa.Column('paid_only', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('show_in_archive', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('recipients', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_newsletter_campaign_org_status', 'newsletter_campaign', ['org_id', 'status'])
    op.create_index('ix_newsletter_campaign_list', 'newsletter_campaign', ['newsletter_id'])
    op.create_table(
        'newsletter_send',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('send_uuid', sa.String(64), nullable=False, unique=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('campaign_id', sa.Integer(), sa.ForeignKey('newsletter_campaign.id', ondelete='CASCADE'), nullable=False),
        sa.Column('subscriber_id', sa.Integer(), sa.ForeignKey('newsletter_subscriber.id', ondelete='SET NULL'), nullable=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('email', sa.String(254), nullable=False),
        sa.Column('name', sa.String(200), nullable=False, server_default=''),
        sa.Column('variant', sa.String(1), nullable=False, server_default=''),
        sa.Column('status', sa.String(12), nullable=False, server_default='queued'),
        sa.Column('skip_reason', sa.String(40), nullable=True),
        sa.Column('idempotency_key', sa.String(200), nullable=False),
        sa.Column('provider', sa.String(20), nullable=True),
        sa.Column('provider_message_id', sa.String(200), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error', sa.String(500), nullable=True),
        sa.Column('queued_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('opened_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('open_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('clicked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('click_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('unsubscribed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('bounced_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('complained_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('idempotency_key', name='uq_newsletter_send_key'),
    )
    op.create_index('ix_newsletter_send_subscriber', 'newsletter_send', ['subscriber_id'])
    op.create_index('ix_newsletter_send_org_sent', 'newsletter_send', ['org_id', 'sent_at'])
    op.create_index('ix_newsletter_send_provider_id', 'newsletter_send', ['provider_message_id'])
    op.create_index('ix_newsletter_send_queue', 'newsletter_send', ['status', 'next_attempt_at'])
    op.create_index('ix_newsletter_send_campaign_status', 'newsletter_send', ['campaign_id', 'status'])
    op.create_table(
        'newsletter_click',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('campaign_id', sa.Integer(), sa.ForeignKey('newsletter_campaign.id', ondelete='CASCADE'), nullable=False),
        sa.Column('send_id', sa.Integer(), sa.ForeignKey('newsletter_send.id', ondelete='CASCADE'), nullable=False),
        sa.Column('url', sa.String(2000), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_newsletter_click_campaign', 'newsletter_click', ['campaign_id'])
    op.create_table(
        'newsletter_template',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('template_uuid', sa.String(64), nullable=False, unique=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('description', sa.String(300), nullable=False, server_default=''),
        sa.Column('subject', sa.String(300), nullable=False, server_default=''),
        sa.Column('preheader', sa.String(300), nullable=False, server_default=''),
        sa.Column('doc', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_newsletter_template_org', 'newsletter_template', ['org_id'])
    op.create_table(
        'newsletter_automation_run',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('automation_id', sa.Integer(), sa.ForeignKey('newsletter_automation.id', ondelete='CASCADE'), nullable=False),
        sa.Column('subscriber_id', sa.Integer(), sa.ForeignKey('newsletter_subscriber.id', ondelete='CASCADE'), nullable=False),
        sa.Column('step_index', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('run_key', sa.String(200), nullable=False),
        sa.Column('context', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(12), nullable=False, server_default='pending'),
        sa.Column('due_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('done_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('run_key', name='uq_newsletter_automation_run_key'),
    )
    op.create_index('ix_newsletter_automation_run_due', 'newsletter_automation_run', ['status', 'due_at'])
    op.create_table(
        'newsletter_suppression',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=True),
        sa.Column('email', sa.String(254), nullable=False),
        sa.Column('reason', sa.String(20), nullable=False),
        sa.Column('source', sa.String(60), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('org_id', 'email', name='uq_newsletter_suppression_org_email'),
    )
    op.create_index('ix_newsletter_suppression_email', 'newsletter_suppression', ['email'])
    op.create_table(
        'newsletter_sending_profile',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('status', sa.String(12), nullable=False, server_default='active'),
        sa.Column('paused_reason', sa.String(300), nullable=True),
        sa.Column('paused_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('paused_data', sa.JSON(), nullable=True),
        sa.Column('verified', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('postal_address', sa.Text(), nullable=False, server_default=''),
        sa.Column('default_sender_name', sa.String(64), nullable=False, server_default=''),
        sa.Column('default_reply_to', sa.String(254), nullable=False, server_default=''),
        sa.Column('default_sender_avatar', sa.String(300), nullable=True),
        sa.Column('sunset_enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('sunset_after_sends', sa.Integer(), nullable=False, server_default='10'),
        sa.Column('warmup_started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('domain', sa.String(253), nullable=True),
        sa.Column('domain_status', sa.String(10), nullable=False, server_default='none'),
        sa.Column('domain_data', sa.JSON(), nullable=False),
        sa.Column('provider', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for name in reversed(TABLES):
        if name in existing:
            op.drop_table(name)
