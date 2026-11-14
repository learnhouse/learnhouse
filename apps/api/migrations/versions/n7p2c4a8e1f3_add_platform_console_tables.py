"""Add platform console tables (superadmin v2)

- ``platform_team_member``     : role of each platform team member (no row = owner)
- ``platform_token_policy``    : role + scopes of superadmin API tokens
- ``platform_audit_event``     : platform audit trail
- ``platform_org_profile``     : lifecycle, POC, tags, account owner, health per org
- ``platform_org_note``        : notes the platform team keeps about an org
- ``platform_automation``      : scheduled rules (conditions + whitelisted actions)
- ``platform_automation_run``  : one run of an automation

and three ``auditlog`` indexes for the cross-org unified audit log:
``created_at``, ``action`` and ``(user_id, created_at)``.

Revision ID: n7p2c4a8e1f3
Revises: m4a1c7e2b9d6
Create Date: 2026-11-09 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'n7p2c4a8e1f3'
down_revision: Union[str, None] = 'm4a1c7e2b9d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tz(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


_AUDITLOG_INDEXES = (
    ('ix_auditlog_created_at', ['created_at']),
    ('ix_auditlog_action', ['action']),
    ('ix_auditlog_user_created', ['user_id', 'created_at']),
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if 'auditlog' in tables:
        existing = {ix['name'] for ix in inspector.get_indexes('auditlog')}
        for name, columns in _AUDITLOG_INDEXES:
            if name not in existing:
                op.create_index(name, 'auditlog', columns)

    if 'platform_team_member' not in tables:
        op.create_table(
            'platform_team_member',
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('role', sa.String(16), nullable=False),
            sa.Column('granted_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('note', sa.String(200), nullable=True),
            _tz('created_at', nullable=False),
            _tz('updated_at', nullable=False),
        )

    if 'platform_token_policy' not in tables:
        op.create_table(
            'platform_token_policy',
            sa.Column(
                'token_id', sa.Integer(),
                sa.ForeignKey('superadmin_apitoken.id', ondelete='CASCADE'), primary_key=True,
            ),
            sa.Column('role', sa.String(16), nullable=False),
            sa.Column('scopes', sa.JSON(), nullable=False),
            _tz('created_at', nullable=False),
        )

    if 'platform_audit_event' not in tables:
        op.create_table(
            'platform_audit_event',
            sa.Column('id', sa.Integer(), primary_key=True),
            _tz('created_at', nullable=False),
            sa.Column('actor_user_id', sa.Integer(), nullable=True),
            sa.Column('actor_kind', sa.String(16), nullable=False),
            sa.Column('actor_label', sa.String(255), nullable=True),
            sa.Column('action', sa.String(64), nullable=False),
            sa.Column('target_type', sa.String(32), nullable=True),
            sa.Column('target_id', sa.String(64), nullable=True),
            sa.Column('org_id', sa.Integer(), nullable=True),
            sa.Column('summary', sa.String(300), nullable=False),
            sa.Column('details', sa.JSON(), nullable=True),
            sa.Column('ip', sa.String(64), nullable=True),
        )
        op.create_index('ix_platform_audit_event_created_at', 'platform_audit_event', ['created_at'])
        op.create_index('ix_platform_audit_event_org_id', 'platform_audit_event', ['org_id'])
        op.create_index('ix_platform_audit_event_action_created', 'platform_audit_event', ['action', 'created_at'])
        op.create_index('ix_platform_audit_event_actor_created', 'platform_audit_event', ['actor_user_id', 'created_at'])

    if 'platform_org_profile' not in tables:
        op.create_table(
            'platform_org_profile',
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('lifecycle', sa.String(16), nullable=False, server_default='active'),
            sa.Column('tags', sa.JSON(), nullable=False),
            sa.Column('account_owner_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            _tz('poc_started_at'),
            _tz('poc_ends_at'),
            sa.Column('poc_plan', sa.String(32), nullable=True),
            sa.Column('poc_previous_plan', sa.String(32), nullable=True),
            sa.Column('poc_goal', sa.String(500), nullable=True),
            sa.Column('poc_contact_name', sa.String(200), nullable=True),
            sa.Column('poc_contact_email', sa.String(320), nullable=True),
            sa.Column('poc_outcome', sa.String(16), nullable=True),
            sa.Column('poc_extensions', sa.Integer(), nullable=False, server_default='0'),
            _tz('closed_at'),
            sa.Column('closed_reason', sa.String(300), nullable=True),
            sa.Column('health_score', sa.Integer(), nullable=True),
            _tz('health_computed_at'),
            _tz('last_activity_at'),
            _tz('updated_at', nullable=False),
        )
        op.create_index('ix_platform_org_profile_lifecycle', 'platform_org_profile', ['lifecycle'])
        op.create_index('ix_platform_org_profile_poc_ends_at', 'platform_org_profile', ['poc_ends_at'])

    if 'platform_org_note' not in tables:
        op.create_table(
            'platform_org_note',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('author_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('author_label', sa.String(255), nullable=True),
            sa.Column('body', sa.Text(), nullable=False),
            sa.Column('pinned', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('kind', sa.String(16), nullable=False, server_default='note'),
            _tz('created_at', nullable=False),
            _tz('updated_at', nullable=False),
        )
        op.create_index('ix_platform_org_note_org_id', 'platform_org_note', ['org_id'])

    if 'platform_automation' not in tables:
        op.create_table(
            'platform_automation',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('automation_uuid', sa.String(64), nullable=False),
            sa.Column('name', sa.String(120), nullable=False),
            sa.Column('description', sa.String(500), nullable=True),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('template', sa.String(64), nullable=False, server_default='custom'),
            sa.Column('schedule', sa.String(16), nullable=False, server_default='daily'),
            sa.Column('conditions', sa.JSON(), nullable=False),
            sa.Column('actions', sa.JSON(), nullable=False),
            sa.Column('dry_run', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('max_actions_per_run', sa.Integer(), nullable=False, server_default='25'),
            sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('enabled_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            _tz('created_at', nullable=False),
            _tz('updated_at', nullable=False),
            _tz('last_run_at'),
            sa.Column('last_run_status', sa.String(16), nullable=True),
        )
        op.create_index(
            'ix_platform_automation_automation_uuid', 'platform_automation', ['automation_uuid'], unique=True,
        )

    if 'platform_automation_run' not in tables:
        op.create_table(
            'platform_automation_run',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column(
                'automation_id', sa.Integer(),
                sa.ForeignKey('platform_automation.id', ondelete='CASCADE'), nullable=False,
            ),
            _tz('started_at', nullable=False),
            _tz('finished_at'),
            sa.Column('trigger', sa.String(16), nullable=False),
            sa.Column('actor_user_id', sa.Integer(), nullable=True),
            sa.Column('status', sa.String(16), nullable=False),
            sa.Column('matched', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('acted', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('dry_run', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('results', sa.JSON(), nullable=False),
            sa.Column('error', sa.Text(), nullable=True),
        )
        op.create_index('ix_platform_automation_run_started_at', 'platform_automation_run', ['started_at'])
        op.create_index(
            'ix_platform_automation_run_auto_started', 'platform_automation_run', ['automation_id', 'started_at'],
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if 'auditlog' in tables:
        existing = {ix['name'] for ix in inspector.get_indexes('auditlog')}
        for name, _ in _AUDITLOG_INDEXES:
            if name in existing:
                op.drop_index(name, table_name='auditlog')
    for name in (
        'platform_automation_run',
        'platform_automation',
        'platform_org_note',
        'platform_org_profile',
        'platform_audit_event',
        'platform_token_policy',
        'platform_team_member',
    ):
        if name in tables:
            op.drop_table(name)
