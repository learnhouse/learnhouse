"""CRM integrations (HubSpot, Salesforce)

Adds the EE CRM tables: ``crm_connection`` (an org's OAuth grant to one CRM
account, tokens encrypted, settings), ``crm_oauth_app`` (an org's own OAuth
app), ``crm_oauth_state`` (single-use OAuth state + PKCE verifier),
``crm_record_link`` (which CRM record a member, company or order became),
``crm_sync_run`` (sync history), ``crm_sync_job`` (the sync queue),
``crm_inbound_rule`` (CRM list/property → LearnHouse actions) and
``crm_inbound_event`` (idempotent provider deliveries). Foreign keys to the
organization cascade; the admin who connected, consented or registered an
app is set to NULL when their account goes.

Revision ID: c7r4m2s9h1k3
Revises: q2n7l4e8r1t5
Create Date: 2026-11-11 23:59:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7r4m2s9h1k3'
down_revision: Union[str, None] = 'q2n7l4e8r1t5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ts(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _org() -> sa.Column:
    return sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False)


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if 'crm_connection' not in tables:
        op.create_table(
            'crm_connection',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('connection_uuid', sa.String(64), nullable=False, unique=True),
            _org(),
            sa.Column('provider', sa.String(32), nullable=False),
            sa.Column('status', sa.String(16), nullable=False, server_default='connected'),
            sa.Column('paused', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('account_id', sa.String(64), nullable=False, server_default=''),
            sa.Column('account_name', sa.String(200), nullable=False, server_default=''),
            sa.Column('account_email', sa.String(254), nullable=True),
            sa.Column('instance_url', sa.String(300), nullable=True),
            sa.Column('environment', sa.String(16), nullable=False, server_default='production'),
            sa.Column('access_token_enc', sa.Text(), nullable=True),
            sa.Column('refresh_token_enc', sa.Text(), nullable=True),
            _ts('expires_at'),
            sa.Column('scopes', sa.Text(), nullable=True),
            sa.Column('client_source', sa.String(16), nullable=False, server_default='platform'),
            sa.Column('connected_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            _ts('consent_at'),
            sa.Column('consent_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('settings', sa.JSON(), nullable=False),
            sa.Column('inbound_secret_enc', sa.Text(), nullable=True),
            sa.Column('health', sa.JSON(), nullable=False),
            sa.Column('poll_state', sa.JSON(), nullable=False),
            _ts('last_sync_at'),
            sa.Column('last_error', sa.Text(), nullable=True),
            _ts('last_error_at'),
            _ts('alerted_at'),
            _ts('creation_date', False),
            _ts('update_date', False),
            sa.UniqueConstraint('org_id', 'provider', name='uq_crm_connection_org_provider'),
        )
        op.create_index('ix_crm_connection_account', 'crm_connection', ['provider', 'account_id'])

    if 'crm_oauth_app' not in tables:
        op.create_table(
            'crm_oauth_app',
            sa.Column('id', sa.Integer(), primary_key=True),
            _org(),
            sa.Column('provider', sa.String(32), nullable=False),
            sa.Column('client_id', sa.String(500), nullable=False),
            sa.Column('client_secret_enc', sa.Text(), nullable=False),
            sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            _ts('creation_date', False),
            _ts('update_date', False),
            sa.UniqueConstraint('org_id', 'provider', name='uq_crm_oauth_app_org_provider'),
        )

    if 'crm_oauth_state' not in tables:
        op.create_table(
            'crm_oauth_state',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('state', sa.String(96), nullable=False, unique=True),
            _org(),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('provider', sa.String(32), nullable=False),
            sa.Column('environment', sa.String(16), nullable=False, server_default='production'),
            sa.Column('client_source', sa.String(16), nullable=False, server_default='platform'),
            sa.Column('code_verifier_enc', sa.Text(), nullable=True),
            sa.Column('browser_nonce_hash', sa.String(64), nullable=False, server_default=''),
            sa.Column('return_to', sa.String(500), nullable=False, server_default=''),
            _ts('expires_at', False),
            _ts('used_at'),
        )

    if 'crm_record_link' not in tables:
        op.create_table(
            'crm_record_link',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('connection_id', sa.Integer(), sa.ForeignKey('crm_connection.id', ondelete='CASCADE'), nullable=False),
            _org(),
            sa.Column('object_type', sa.String(16), nullable=False),
            sa.Column('local_key', sa.String(100), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=True),
            sa.Column('label', sa.String(254), nullable=False, server_default=''),
            sa.Column('remote_id', sa.String(64), nullable=True),
            sa.Column('status', sa.String(12), nullable=False, server_default='pending'),
            sa.Column('duplicate_ids', sa.JSON(), nullable=False),
            sa.Column('payload_hash', sa.String(64), nullable=True),
            sa.Column('last_error', sa.Text(), nullable=True),
            _ts('last_synced_at'),
            _ts('update_date', False),
            sa.UniqueConstraint('connection_id', 'object_type', 'local_key', name='uq_crm_record_link'),
        )
        op.create_index('ix_crm_record_link_remote', 'crm_record_link', ['connection_id', 'object_type', 'remote_id'])
        op.create_index('ix_crm_record_link_status', 'crm_record_link', ['connection_id', 'status'])

    if 'crm_sync_run' not in tables:
        op.create_table(
            'crm_sync_run',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('run_uuid', sa.String(64), nullable=False, unique=True),
            sa.Column('connection_id', sa.Integer(), sa.ForeignKey('crm_connection.id', ondelete='CASCADE'), nullable=False),
            _org(),
            sa.Column('kind', sa.String(16), nullable=False),
            sa.Column('status', sa.String(12), nullable=False, server_default='running'),
            sa.Column('started_by', sa.Integer(), nullable=True),
            sa.Column('counts', sa.JSON(), nullable=False),
            sa.Column('summary', sa.Text(), nullable=False, server_default=''),
            _ts('started_at', False),
            _ts('finished_at'),
        )
        op.create_index('ix_crm_sync_run_connection', 'crm_sync_run', ['connection_id', 'started_at'])

    if 'crm_sync_job' not in tables:
        op.create_table(
            'crm_sync_job',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('connection_id', sa.Integer(), sa.ForeignKey('crm_connection.id', ondelete='CASCADE'), nullable=False),
            _org(),
            sa.Column('run_id', sa.Integer(), sa.ForeignKey('crm_sync_run.id', ondelete='SET NULL'), nullable=True),
            sa.Column('kind', sa.String(24), nullable=False),
            sa.Column('local_key', sa.String(100), nullable=False, server_default=''),
            sa.Column('user_id', sa.Integer(), nullable=True),
            sa.Column('payload', sa.JSON(), nullable=False),
            sa.Column('dedupe_key', sa.String(160), nullable=True),
            sa.Column('status', sa.String(12), nullable=False, server_default='pending'),
            sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
            _ts('next_attempt_at', False),
            sa.Column('last_error', sa.Text(), nullable=True),
            _ts('created_at', False),
            _ts('updated_at', False),
            _ts('finished_at'),
        )
        op.create_index('ix_crm_sync_job_due', 'crm_sync_job', ['status', 'next_attempt_at'])
        op.create_index('ix_crm_sync_job_connection', 'crm_sync_job', ['connection_id', 'status'])
        op.create_index('ix_crm_sync_job_dedupe', 'crm_sync_job', ['connection_id', 'dedupe_key'])

    if 'crm_inbound_rule' not in tables:
        op.create_table(
            'crm_inbound_rule',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('rule_uuid', sa.String(64), nullable=False, unique=True),
            sa.Column('connection_id', sa.Integer(), sa.ForeignKey('crm_connection.id', ondelete='CASCADE'), nullable=False),
            _org(),
            sa.Column('name', sa.String(120), nullable=False, server_default=''),
            sa.Column('trigger', sa.String(16), nullable=False),
            sa.Column('list_id', sa.String(100), nullable=True),
            sa.Column('list_name', sa.String(200), nullable=True),
            sa.Column('property_name', sa.String(100), nullable=True),
            sa.Column('property_value', sa.String(200), nullable=True),
            sa.Column('member_action', sa.String(12), nullable=False, server_default='invite'),
            sa.Column('usergroup_id', sa.Integer(), sa.ForeignKey('usergroup.id', ondelete='CASCADE'), nullable=True),
            sa.Column('remove_on_exit', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('course_uuid', sa.String(100), nullable=True),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('members', sa.JSON(), nullable=False),
            sa.Column('stats', sa.JSON(), nullable=False),
            _ts('last_run_at'),
            _ts('created_at', False),
            _ts('updated_at', False),
        )
        op.create_index('ix_crm_inbound_rule_connection', 'crm_inbound_rule', ['connection_id'])

    if 'crm_inbound_event' not in tables:
        op.create_table(
            'crm_inbound_event',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('connection_id', sa.Integer(), sa.ForeignKey('crm_connection.id', ondelete='CASCADE'), nullable=False),
            _org(),
            sa.Column('event_key', sa.String(200), nullable=False),
            sa.Column('kind', sa.String(60), nullable=False, server_default=''),
            sa.Column('status', sa.String(12), nullable=False, server_default='processed'),
            sa.Column('detail', sa.JSON(), nullable=False),
            _ts('received_at', False),
            sa.UniqueConstraint('connection_id', 'event_key', name='uq_crm_inbound_event'),
        )


def downgrade() -> None:
    for table in (
        'crm_inbound_event', 'crm_inbound_rule', 'crm_sync_job', 'crm_sync_run',
        'crm_record_link', 'crm_oauth_state', 'crm_oauth_app', 'crm_connection',
    ):
        op.execute(f'DROP TABLE IF EXISTS {table}')
