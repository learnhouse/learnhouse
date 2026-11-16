"""Add member profiles, SCIM provisioning and required training

Adds ``org_member_profile`` (manager, department, title... per org member),
the SCIM tables (``scim_config``, ``scim_token``, ``scim_resource``,
``scim_event``) and the required training tables (``training_rule``,
``training_assignment``, ``training_cycle``, ``training_notification``).

Revision ID: u1h2r3t4r5n6
Revises: t7c2i18n4l9v
Create Date: 2026-11-10 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'u1h2r3t4r5n6'
down_revision: Union[str, None] = 't7c2i18n4l9v'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ts(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    if 'org_member_profile' not in tables:
        op.create_table(
            'org_member_profile',
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('manager_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('department', sa.String(length=200), nullable=True),
            sa.Column('title', sa.String(length=200), nullable=True),
            sa.Column('employee_id', sa.String(length=100), nullable=True),
            sa.Column('cost_center', sa.String(length=100), nullable=True),
            sa.Column('location', sa.String(length=200), nullable=True),
            sa.Column('employment_status', sa.String(length=16), nullable=False),
            sa.Column('source', sa.String(length=16), nullable=False),
            sa.Column('external_id', sa.String(length=255), nullable=True),
            sa.Column('attributes', sa.JSON(), nullable=True),
            sa.Column('digest_opt_out', sa.Boolean(), nullable=False, server_default=sa.false()),
            _ts('updated_at', nullable=False),
        )
        op.create_index('ix_org_member_profile_manager', 'org_member_profile', ['org_id', 'manager_user_id'])
        op.create_index('ix_org_member_profile_department', 'org_member_profile', ['org_id', 'department'])
        op.create_index('ix_org_member_profile_external', 'org_member_profile', ['org_id', 'external_id'])

    if 'scim_config' not in tables:
        op.create_table(
            'scim_config',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('default_role_id', sa.Integer(), sa.ForeignKey('role.id', ondelete='SET NULL'), nullable=True),
            sa.Column('deprovision_mode', sa.String(length=16), nullable=False),
            sa.Column('sync_groups', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('group_role_rules', sa.JSON(), nullable=True),
            sa.Column('link_existing_accounts', sa.Boolean(), nullable=False, server_default=sa.true()),
            _ts('last_sync_at'),
            _ts('created_at', nullable=False),
            _ts('updated_at', nullable=False),
            sa.UniqueConstraint('org_id', name='uq_scim_config_org'),
        )

    if 'scim_token' not in tables:
        op.create_table(
            'scim_token',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('token_uuid', sa.String(length=64), nullable=False, unique=True),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('name', sa.String(length=100), nullable=False),
            sa.Column('token_prefix', sa.String(length=16), nullable=False),
            sa.Column('token_hash', sa.String(length=255), nullable=False),
            sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            _ts('created_at', nullable=False),
            _ts('last_used_at'),
            _ts('revoked_at'),
        )
        op.create_index('ix_scim_token_prefix', 'scim_token', ['token_prefix'])
        op.create_index('ix_scim_token_org', 'scim_token', ['org_id'])

    if 'scim_resource' not in tables:
        op.create_table(
            'scim_resource',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('resource_type', sa.String(length=16), nullable=False),
            sa.Column('scim_id', sa.String(length=64), nullable=False),
            sa.Column('local_id', sa.Integer(), nullable=False),
            sa.Column('external_id', sa.String(length=255), nullable=True),
            sa.Column('user_name', sa.String(length=320), nullable=True),
            sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('role_id', sa.Integer(), nullable=True),
            sa.Column('data', sa.JSON(), nullable=True),
            sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
            _ts('created_at', nullable=False),
            _ts('updated_at', nullable=False),
            sa.UniqueConstraint('org_id', 'resource_type', 'scim_id', name='uq_scim_resource_scim_id'),
            sa.UniqueConstraint('org_id', 'resource_type', 'local_id', name='uq_scim_resource_local'),
        )
        op.create_index('ix_scim_resource_external', 'scim_resource', ['org_id', 'resource_type', 'external_id'])

    if 'scim_event' not in tables:
        op.create_table(
            'scim_event',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            _ts('created_at', nullable=False),
            sa.Column('method', sa.String(length=8), nullable=False),
            sa.Column('path', sa.String(length=255), nullable=False),
            sa.Column('status_code', sa.Integer(), nullable=False),
            sa.Column('action', sa.String(length=64), nullable=False),
            sa.Column('resource_type', sa.String(length=16), nullable=True),
            sa.Column('scim_id', sa.String(length=64), nullable=True),
            sa.Column('summary', sa.String(length=500), nullable=True),
            sa.Column('error', sa.Text(), nullable=True),
            sa.Column('is_test', sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.create_index('ix_scim_event_org_created', 'scim_event', ['org_id', 'created_at'])

    if 'training_rule' not in tables:
        op.create_table(
            'training_rule',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('rule_uuid', sa.String(length=64), nullable=False, unique=True),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('name', sa.String(length=200), nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('target_type', sa.String(length=16), nullable=False),
            sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=True),
            sa.Column('path_id', sa.Integer(), sa.ForeignKey('path.id', ondelete='CASCADE'), nullable=True),
            sa.Column('audience', sa.JSON(), nullable=False),
            sa.Column('due_mode', sa.String(length=20), nullable=False),
            _ts('due_date'),
            sa.Column('due_days', sa.Integer(), nullable=True),
            sa.Column('recurrence_months', sa.Integer(), nullable=True),
            sa.Column('grace_days', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('require_certificate', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('reminders', sa.JSON(), nullable=True),
            sa.Column('escalation', sa.JSON(), nullable=True),
            sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            _ts('created_at', nullable=False),
            _ts('updated_at', nullable=False),
        )
        op.create_index('ix_training_rule_org', 'training_rule', ['org_id'])

    if 'training_assignment' not in tables:
        op.create_table(
            'training_assignment',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('assignment_uuid', sa.String(length=64), nullable=False, unique=True),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('rule_id', sa.Integer(), sa.ForeignKey('training_rule.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('cycle', sa.Integer(), nullable=False, server_default='1'),
            _ts('assigned_at', nullable=False),
            _ts('due_at'),
            _ts('started_at'),
            _ts('completed_at'),
            sa.Column('status', sa.String(length=16), nullable=False),
            sa.Column('certificate_uuid', sa.String(length=120), nullable=True),
            _ts('exempted_at'),
            sa.Column('exemption_reason', sa.String(length=500), nullable=True),
            sa.Column('exempted_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('inactive', sa.Boolean(), nullable=False, server_default=sa.false()),
            _ts('updated_at', nullable=False),
            sa.UniqueConstraint('rule_id', 'user_id', name='uq_training_assignment_rule_user'),
        )
        op.create_index('ix_training_assignment_org_user', 'training_assignment', ['org_id', 'user_id'])
        op.create_index('ix_training_assignment_org_status', 'training_assignment', ['org_id', 'status'])

    if 'training_cycle' not in tables:
        op.create_table(
            'training_cycle',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('assignment_id', sa.Integer(), sa.ForeignKey('training_assignment.id', ondelete='CASCADE'), nullable=False),
            sa.Column('cycle', sa.Integer(), nullable=False),
            _ts('assigned_at', nullable=False),
            _ts('due_at'),
            _ts('completed_at'),
            sa.Column('status', sa.String(length=16), nullable=False),
            sa.Column('certificate_uuid', sa.String(length=120), nullable=True),
            _ts('closed_at', nullable=False),
        )
        op.create_index('ix_training_cycle_assignment', 'training_cycle', ['assignment_id'])

    if 'training_notification' not in tables:
        op.create_table(
            'training_notification',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('assignment_id', sa.Integer(), sa.ForeignKey('training_assignment.id', ondelete='CASCADE'), nullable=True),
            sa.Column('kind', sa.String(length=24), nullable=False),
            sa.Column('dedupe_key', sa.String(length=200), nullable=False),
            sa.Column('status', sa.String(length=16), nullable=False),
            _ts('sent_at', nullable=False),
            sa.Column('details', sa.JSON(), nullable=True),
            sa.UniqueConstraint('dedupe_key', name='uq_training_notification_dedupe'),
        )
        op.create_index('ix_training_notification_org_sent', 'training_notification', ['org_id', 'sent_at'])


def downgrade() -> None:
    for table in (
        'training_notification', 'training_cycle', 'training_assignment', 'training_rule',
        'scim_event', 'scim_resource', 'scim_token', 'scim_config', 'org_member_profile',
    ):
        op.execute(sa.text(f'DROP TABLE IF EXISTS {table}'))
