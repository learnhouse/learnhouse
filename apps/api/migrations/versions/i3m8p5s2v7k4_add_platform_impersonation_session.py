"""Platform support sessions (impersonation)

Creates ``platform_impersonation_session``: one row per session a platform
superadmin opened to act as a member of an organization (who, as whom, which
org, mode, reason, expiry, how it ended). The table belongs to the EE platform
console; it is created on every install so the schema stays one tree.

Revision ID: i3m8p5s2v7k4
Revises: n7c4t1f9r2a6
Create Date: 2026-11-13 23:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'i3m8p5s2v7k4'
down_revision: Union[str, None] = 'n7c4t1f9r2a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = 'platform_impersonation_session'


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if TABLE in set(insp.get_table_names()):
        return
    op.create_table(
        TABLE,
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('session_uuid', sa.String(64), nullable=False),
        sa.Column('impersonator_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('impersonator_label', sa.String(255), nullable=False),
        sa.Column('target_kind', sa.String(8), nullable=False),
        sa.Column('target_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('target_label', sa.String(255), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=True),
        sa.Column('role_id', sa.Integer(), nullable=True),
        sa.Column('role_label', sa.String(120), nullable=True),
        sa.Column('mode', sa.String(16), nullable=False),
        sa.Column('allow_messaging', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('org_visible', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('notify_admins', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('reason', sa.String(500), nullable=False),
        sa.Column('ticket', sa.String(120), nullable=True),
        sa.Column('token_hash', sa.String(64), nullable=False),
        sa.Column('return_url', sa.String(500), nullable=True),
        sa.Column('ip', sa.String(64), nullable=True),
        sa.Column('user_agent', sa.String(300), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('end_reason', sa.String(24), nullable=True),
        sa.Column('ended_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
    )
    op.create_index('ix_platform_impersonation_session_session_uuid', TABLE, ['session_uuid'], unique=True)
    op.create_index('ix_platform_impersonation_active', TABLE, ['ended_at', 'expires_at'])
    op.create_index('ix_platform_impersonation_impersonator', TABLE, ['impersonator_user_id', 'created_at'])
    op.create_index('ix_platform_impersonation_org', TABLE, ['org_id', 'created_at'])


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if TABLE not in set(insp.get_table_names()):
        return
    op.drop_table(TABLE)
