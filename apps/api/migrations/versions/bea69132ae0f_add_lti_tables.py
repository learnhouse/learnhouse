"""Add LTI 1.3 tables

Revision ID: bea69132ae0f
Revises: dae02f36bef2
Create Date: 2026-10-07 12:00:00.000000

The models live in the enterprise overlay and are also created by
``SQLModel.metadata.create_all`` at startup, so every step is guarded.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'bea69132ae0f'
down_revision: Union[str, None] = 'dae02f36bef2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
    if not _has('ltiplatform'):
        op.create_table(
            'ltiplatform',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('platform_uuid', sa.String(), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('name', sa.String(), nullable=False, server_default=''),
            sa.Column('issuer', sa.String(), nullable=False, server_default=''),
            sa.Column('client_id', sa.String(), nullable=False, server_default=''),
            sa.Column('deployment_ids', sa.JSON(), nullable=True),
            sa.Column('auth_login_url', sa.String(), nullable=False, server_default=''),
            sa.Column('auth_token_url', sa.String(), nullable=False, server_default=''),
            sa.Column('auth_token_audience', sa.String(), nullable=True),
            sa.Column('jwks_url', sa.String(), nullable=False, server_default=''),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('registration_method', sa.String(), nullable=False, server_default='manual'),
            sa.Column('product_family', sa.String(), nullable=True),
            sa.Column('default_role_id', sa.Integer(), sa.ForeignKey('role.id', ondelete='SET NULL'), nullable=True),
            sa.Column('instructor_role_id', sa.Integer(), sa.ForeignKey('role.id', ondelete='SET NULL'), nullable=True),
            sa.Column('grade_sync_enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('roster_sync_enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('assignment_columns_enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('revoke_on_drop', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('cohort_groups_enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('pin_deployments', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('pns_url', sa.String(), nullable=True),
            sa.Column('pns_handlers', sa.JSON(), nullable=True),
            sa.Column('pns_last_notice_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index('ix_ltiplatform_platform_uuid', 'ltiplatform', ['platform_uuid'], unique=True)
        op.create_index('ix_ltiplatform_org_id', 'ltiplatform', ['org_id'])

    if not _has('ltitoolkey'):
        op.create_table(
            'ltitoolkey',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('kid', sa.String(), nullable=False),
            sa.Column('private_key_pem', sa.Text(), nullable=False),
            sa.Column('public_jwk', sa.JSON(), nullable=True),
            sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index('ix_ltitoolkey_kid', 'ltitoolkey', ['kid'], unique=True)
        op.create_index('ix_ltitoolkey_org_id', 'ltitoolkey', ['org_id'])

    if not _has('ltiuserlink'):
        op.create_table(
            'ltiuserlink',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('platform_id', sa.Integer(), sa.ForeignKey('ltiplatform.id', ondelete='CASCADE'), nullable=False),
            sa.Column('sub', sa.String(), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('provisioned', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('confirmed', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.UniqueConstraint('platform_id', 'sub', name='uq_ltiuserlink_platform_sub'),
        )
        op.create_index('ix_ltiuserlink_platform_id', 'ltiuserlink', ['platform_id'])
        op.create_index('ix_ltiuserlink_user_id', 'ltiuserlink', ['user_id'])
    else:
        # Tables made by create_all before these columns existed.
        cols = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('ltiuserlink')}
        for name in ('provisioned', 'confirmed'):
            if name not in cols:
                op.add_column('ltiuserlink', sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.false()))

    if not _has('ltiresourcelink'):
        op.create_table(
            'ltiresourcelink',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('platform_id', sa.Integer(), sa.ForeignKey('ltiplatform.id', ondelete='CASCADE'), nullable=False),
            sa.Column('deployment_id', sa.String(), nullable=False),
            sa.Column('resource_link_id', sa.String(), nullable=False),
            sa.Column('title', sa.String(), nullable=False, server_default=''),
            sa.Column('context_id', sa.String(), nullable=True),
            sa.Column('context_title', sa.String(), nullable=True),
            sa.Column('resource_type', sa.String(), nullable=False, server_default='course'),
            sa.Column('resource_uuid', sa.String(), nullable=True),
            sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='SET NULL'), nullable=True),
            sa.Column('activity_id', sa.Integer(), sa.ForeignKey('activity.id', ondelete='SET NULL'), nullable=True),
            sa.Column('ags_lineitem', sa.String(), nullable=True),
            sa.Column('ags_lineitems', sa.String(), nullable=True),
            sa.Column('ags_scopes', sa.JSON(), nullable=True),
            sa.Column('nrps_memberships_url', sa.String(), nullable=True),
            sa.Column('groups_url', sa.String(), nullable=True),
            sa.Column('last_roster_sync_at', sa.DateTime(), nullable=True),
            sa.Column('columns_stale', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint(
                'platform_id', 'deployment_id', 'resource_link_id', name='uq_ltiresourcelink_platform_link'
            ),
        )
        op.create_index('ix_ltiresourcelink_platform_id', 'ltiresourcelink', ['platform_id'])
        op.create_index('ix_ltiresourcelink_course_id', 'ltiresourcelink', ['course_id'])

    if not _has('ltigradesync'):
        op.create_table(
            'ltigradesync',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('resource_link_id', sa.Integer(), sa.ForeignKey('ltiresourcelink.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('sub', sa.String(), nullable=False),
            sa.Column('last_score', sa.Float(), nullable=True),
            sa.Column('status', sa.String(), nullable=False, server_default='pending'),
            sa.Column('error', sa.String(), nullable=True),
            sa.Column('last_synced_at', sa.DateTime(), nullable=True),
            sa.Column('lms_score', sa.Float(), nullable=True),
            sa.Column('lms_checked_at', sa.DateTime(), nullable=True),
            sa.Column('lms_override', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('sent_digests', sa.JSON(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint('resource_link_id', 'user_id', name='uq_ltigradesync_link_user'),
        )
        op.create_index('ix_ltigradesync_resource_link_id', 'ltigradesync', ['resource_link_id'])
        op.create_index('ix_ltigradesync_user_id', 'ltigradesync', ['user_id'])

    if not _has('ltiassignmentcolumn'):
        op.create_table(
            'ltiassignmentcolumn',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('resource_link_id', sa.Integer(), sa.ForeignKey('ltiresourcelink.id', ondelete='CASCADE'), nullable=False),
            sa.Column('assignment_uuid', sa.String(), nullable=False),
            sa.Column('lineitem', sa.String(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint('resource_link_id', 'assignment_uuid', name='uq_ltiassignmentcolumn_link_assignment'),
        )
        op.create_index('ix_ltiassignmentcolumn_resource_link_id', 'ltiassignmentcolumn', ['resource_link_id'])

    if not _has('ltigrant'):
        op.create_table(
            'ltigrant',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('platform_id', sa.Integer(), sa.ForeignKey('ltiplatform.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('kind', sa.String(), nullable=False),
            sa.Column('target', sa.String(), nullable=False),
            sa.Column('context_id', sa.String(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint('platform_id', 'user_id', 'kind', 'target', 'context_id', name='uq_ltigrant'),
        )
        op.create_index('ix_ltigrant_platform_id', 'ltigrant', ['platform_id'])
        op.create_index('ix_ltigrant_user_id', 'ltigrant', ['user_id'])

    if not _has('lticontextcopy'):
        op.create_table(
            'lticontextcopy',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('platform_id', sa.Integer(), sa.ForeignKey('ltiplatform.id', ondelete='CASCADE'), nullable=False),
            sa.Column('context_id', sa.String(), nullable=False),
            sa.Column('origin_context_id', sa.String(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint('platform_id', 'context_id', 'origin_context_id', name='uq_lticontextcopy'),
        )
        op.create_index('ix_lticontextcopy_platform_id', 'lticontextcopy', ['platform_id'])
        op.create_index('ix_lticontextcopy_context_id', 'lticontextcopy', ['context_id'])

    if not _has('ltidynamicregistrationtoken'):
        op.create_table(
            'ltidynamicregistrationtoken',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('token_hash', sa.String(), nullable=False),
            sa.Column('name', sa.String(), nullable=False, server_default=''),
            sa.Column('expires_at', sa.DateTime(), nullable=False),
            sa.Column('used_at', sa.DateTime(), nullable=True),
            sa.Column('platform_id', sa.Integer(), sa.ForeignKey('ltiplatform.id', ondelete='SET NULL'), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index(
            'ix_ltidynamicregistrationtoken_token_hash', 'ltidynamicregistrationtoken', ['token_hash'], unique=True
        )
        op.create_index('ix_ltidynamicregistrationtoken_org_id', 'ltidynamicregistrationtoken', ['org_id'])


def downgrade() -> None:
    for table in (
        'lticontextcopy',
        'ltigrant',
        'ltiassignmentcolumn',
        'ltidynamicregistrationtoken',
        'ltigradesync',
        'ltiresourcelink',
        'ltiuserlink',
        'ltitoolkey',
        'ltiplatform',
    ):
        if _has(table):
            op.drop_table(table)
