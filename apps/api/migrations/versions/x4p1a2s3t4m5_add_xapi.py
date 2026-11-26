"""Add xAPI: LRS connections, built-in LRS store, delivery queue

Revision ID: x4p1a2s3t4m5
Revises: e9v1d2p3s4t5
Create Date: 2026-11-25 00:00:00.000000

xAPI is an Enterprise feature. Its models live in the enterprise overlay and
are also created by ``SQLModel.metadata.create_all`` at startup, so every
step is guarded. xAPI and cmi5 packages reuse the SCORM tables; they only
need two more values on ``scormversionenum``.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'x4p1a2s3t4m5'
down_revision: Union[str, None] = 'e9v1d2p3s4t5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = (
    'xapi_launch',
    'xapi_registration',
    'xapi_delivery',
    'xapi_document',
    'xapi_attachment',
    'xapi_statement_link',
    'xapi_statement',
    'xapi_credential',
    'xapi_connection',
    'xapi_settings',
)


def _has(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def _ts(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _fk(name: str, table: str, ondelete: str = 'CASCADE', nullable: bool = False) -> sa.Column:
    return sa.Column(name, sa.Integer(), sa.ForeignKey(f'{table}.id', ondelete=ondelete), nullable=nullable)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        # Same as the play / live session enum values: fine inside the
        # migration transaction on Postgres 12+ while nothing uses them yet.
        exists = bind.execute(sa.text("SELECT 1 FROM pg_type WHERE typname = 'scormversionenum'")).first()
        if exists:
            op.execute("ALTER TYPE scormversionenum ADD VALUE IF NOT EXISTS 'XAPI'")
            op.execute("ALTER TYPE scormversionenum ADD VALUE IF NOT EXISTS 'CMI5'")

    if not _has('xapi_settings'):
        op.create_table(
            'xapi_settings',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False, unique=True),
            sa.Column('platform_events', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('event_types', sa.JSON(), nullable=True),
            sa.Column('actor_format', sa.String(16), nullable=False),
            sa.Column('lrs_enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('retention_days', sa.Integer(), nullable=False, server_default='0'),
            _ts('created_at', False),
            _ts('updated_at', False),
        )

    if not _has('xapi_connection'):
        op.create_table(
            'xapi_connection',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('connection_uuid', sa.String(64), nullable=False, unique=True),
            _fk('org_id', 'organization'),
            sa.Column('name', sa.String(120), nullable=False),
            sa.Column('provider', sa.String(32), nullable=False),
            sa.Column('endpoint', sa.String(500), nullable=False),
            sa.Column('auth_type', sa.String(16), nullable=False),
            sa.Column('username', sa.String(300), nullable=False),
            sa.Column('secret_enc', sa.Text(), nullable=True),
            sa.Column('xapi_version', sa.String(8), nullable=False),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('sources', sa.JSON(), nullable=False),
            sa.Column('event_types', sa.JSON(), nullable=True),
            _ts('last_success_at'),
            sa.Column('last_error', sa.Text(), nullable=True),
            _ts('last_error_at'),
            sa.Column('sent_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('failed_count', sa.Integer(), nullable=False, server_default='0'),
            _fk('created_by', 'user', 'SET NULL', True),
            _ts('created_at', False),
            _ts('updated_at', False),
        )
        op.create_index('ix_xapi_connection_org', 'xapi_connection', ['org_id'])

    if not _has('xapi_credential'):
        op.create_table(
            'xapi_credential',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('credential_uuid', sa.String(64), nullable=False, unique=True),
            _fk('org_id', 'organization'),
            sa.Column('name', sa.String(120), nullable=False),
            sa.Column('key', sa.String(64), nullable=False, unique=True),
            sa.Column('secret_hash', sa.String(64), nullable=False),
            sa.Column('scopes', sa.JSON(), nullable=False),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            _ts('last_used_at'),
            _fk('created_by', 'user', 'SET NULL', True),
            _ts('created_at', False),
        )
        op.create_index('ix_xapi_credential_org', 'xapi_credential', ['org_id'])

    if not _has('xapi_statement'):
        op.create_table(
            'xapi_statement',
            sa.Column('id', sa.Integer(), primary_key=True),
            _fk('org_id', 'organization'),
            sa.Column('statement_id', sa.String(36), nullable=False),
            sa.Column('source', sa.String(16), nullable=False),
            _fk('credential_id', 'xapi_credential', 'SET NULL', True),
            _fk('user_id', 'user', 'CASCADE', True),
            _fk('activity_id', 'activity', 'SET NULL', True),
            sa.Column('actor_key', sa.String(400), nullable=False),
            sa.Column('verb_id', sa.String(500), nullable=False),
            sa.Column('object_iri', sa.String(500), nullable=True),
            sa.Column('object_type', sa.String(16), nullable=False),
            sa.Column('registration', sa.String(36), nullable=True),
            sa.Column('voids', sa.String(36), nullable=True),
            sa.Column('voided', sa.Boolean(), nullable=False, server_default=sa.false()),
            _ts('timestamp', False),
            _ts('stored', False),
            sa.Column('statement', sa.JSON(), nullable=False),
            sa.Column('attachment_hashes', sa.JSON(), nullable=False),
            sa.UniqueConstraint('org_id', 'statement_id', name='uq_xapi_statement_org_id'),
        )
        op.create_index('ix_xapi_statement_org_stored', 'xapi_statement', ['org_id', 'stored'])
        op.create_index('ix_xapi_statement_org_verb', 'xapi_statement', ['org_id', 'verb_id'])
        op.create_index('ix_xapi_statement_org_actor', 'xapi_statement', ['org_id', 'actor_key'])
        op.create_index('ix_xapi_statement_org_object', 'xapi_statement', ['org_id', 'object_iri'])
        op.create_index('ix_xapi_statement_org_registration', 'xapi_statement', ['org_id', 'registration'])
        op.create_index('ix_xapi_statement_org_user', 'xapi_statement', ['org_id', 'user_id'])
        op.create_index('ix_xapi_statement_user', 'xapi_statement', ['user_id'])
        op.create_index('ix_xapi_statement_activity', 'xapi_statement', ['activity_id'])
        op.create_index('ix_xapi_statement_credential', 'xapi_statement', ['credential_id'])

    if not _has('xapi_statement_link'):
        op.create_table(
            'xapi_statement_link',
            sa.Column('id', sa.Integer(), primary_key=True),
            _fk('org_id', 'organization'),
            _fk('statement_pk', 'xapi_statement'),
            sa.Column('kind', sa.String(8), nullable=False),
            sa.Column('key', sa.String(500), nullable=False),
        )
        op.create_index('ix_xapi_statement_link_lookup', 'xapi_statement_link', ['org_id', 'kind', 'key'])
        op.create_index('ix_xapi_statement_link_statement', 'xapi_statement_link', ['statement_pk'])

    if not _has('xapi_attachment'):
        op.create_table(
            'xapi_attachment',
            sa.Column('id', sa.Integer(), primary_key=True),
            _fk('org_id', 'organization'),
            sa.Column('sha2', sa.String(128), nullable=False),
            sa.Column('content_type', sa.String(200), nullable=False),
            sa.Column('length', sa.Integer(), nullable=False),
            sa.Column('content', sa.LargeBinary(), nullable=False),
            _ts('created_at', False),
            sa.UniqueConstraint('org_id', 'sha2', name='uq_xapi_attachment_org_sha2'),
        )

    if not _has('xapi_document'):
        op.create_table(
            'xapi_document',
            sa.Column('id', sa.Integer(), primary_key=True),
            _fk('org_id', 'organization'),
            sa.Column('kind', sa.String(20), nullable=False),
            sa.Column('doc_key', sa.String(64), nullable=False),
            sa.Column('activity_iri', sa.String(500), nullable=False),
            sa.Column('agent_key', sa.String(400), nullable=False),
            sa.Column('registration', sa.String(36), nullable=False),
            sa.Column('document_id', sa.String(500), nullable=False),
            sa.Column('content', sa.LargeBinary(), nullable=False),
            sa.Column('content_type', sa.String(200), nullable=False),
            sa.Column('etag', sa.String(64), nullable=False),
            _ts('updated', False),
            sa.UniqueConstraint('org_id', 'doc_key', name='uq_xapi_document_key'),
        )
        op.create_index('ix_xapi_document_lookup', 'xapi_document', ['org_id', 'kind', 'activity_iri'])

    if not _has('xapi_delivery'):
        op.create_table(
            'xapi_delivery',
            sa.Column('id', sa.Integer(), primary_key=True),
            _fk('org_id', 'organization'),
            _fk('connection_id', 'xapi_connection'),
            sa.Column('statement_id', sa.String(36), nullable=False),
            sa.Column('statement', sa.JSON(), nullable=False),
            sa.Column('status', sa.String(16), nullable=False),
            sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
            _ts('next_attempt_at', False),
            sa.Column('last_error', sa.Text(), nullable=True),
            _ts('created_at', False),
            _ts('sent_at'),
            sa.UniqueConstraint('connection_id', 'statement_id', name='uq_xapi_delivery_connection_statement'),
        )
        op.create_index('ix_xapi_delivery_due', 'xapi_delivery', ['status', 'next_attempt_at'])
        op.create_index('ix_xapi_delivery_connection', 'xapi_delivery', ['connection_id', 'status'])

    if not _has('xapi_registration'):
        op.create_table(
            'xapi_registration',
            sa.Column('id', sa.Integer(), primary_key=True),
            _fk('org_id', 'organization'),
            _fk('user_id', 'user'),
            _fk('activity_id', 'activity'),
            sa.Column('registration', sa.String(36), nullable=False),
            sa.Column('completed', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('passed', sa.Boolean(), nullable=True),
            sa.Column('score_scaled', sa.Float(), nullable=True),
            sa.Column('satisfied', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('waived', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('launch_count', sa.Integer(), nullable=False, server_default='0'),
            _ts('created_at', False),
            _ts('updated_at', False),
            sa.UniqueConstraint('user_id', 'activity_id', name='uq_xapi_registration_user_activity'),
        )
        op.create_index('ix_xapi_registration_registration', 'xapi_registration', ['registration'])
        op.create_index('ix_xapi_registration_activity', 'xapi_registration', ['activity_id'])

    if not _has('xapi_launch'):
        op.create_table(
            'xapi_launch',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('launch_uuid', sa.String(64), nullable=False, unique=True),
            sa.Column('fetch_hash', sa.String(64), nullable=True, unique=True),
            _fk('org_id', 'organization'),
            _fk('user_id', 'user'),
            _fk('activity_id', 'activity'),
            sa.Column('registration', sa.String(36), nullable=False),
            sa.Column('kind', sa.String(8), nullable=False),
            sa.Column('session_id', sa.String(36), nullable=False),
            sa.Column('launch_mode', sa.String(8), nullable=False, server_default='Normal'),
            sa.Column('fetched', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('initialized', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('terminated', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('prefs_read', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('used_verbs', sa.JSON(), nullable=False, server_default='[]'),
            _ts('created_at', False),
            _ts('expires_at', False),
        )
        op.create_index('ix_xapi_launch_registration', 'xapi_launch', ['registration'])
        op.create_index('ix_xapi_launch_user', 'xapi_launch', ['user_id'])
        op.create_index('ix_xapi_launch_activity', 'xapi_launch', ['activity_id'])


def downgrade() -> None:
    # The scormversionenum values stay: Postgres cannot drop one enum value.
    for table in TABLES:
        if _has(table):
            op.drop_table(table)
