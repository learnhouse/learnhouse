"""Organization invitations and invite codes in Postgres

Adds ``org_invitation`` (one row per emailed invitation: the role, user groups
and courses to apply on joining, a personal message, who sent it, its status,
a SHA-256 of the link token and its expiry) and ``org_invite_code`` (shareable
join codes with a default role, groups, courses, a use cap, a use count and an
expiry). Both used to live in Redis; the Redis records are still honoured
until they expire.

Revision ID: w4i5n6v7t8s9
Revises: v3a4s5c6p7e8
Create Date: 2026-11-16 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'w4i5n6v7t8s9'
down_revision: Union[str, None] = 'v3a4s5c6p7e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if not inspector.has_table('org_invitation'):
        op.create_table(
            'org_invitation',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('invitation_uuid', sa.String(64), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('email', sa.String(320), nullable=False),
            sa.Column('role_id', sa.Integer(), sa.ForeignKey('role.id', ondelete='SET NULL'), nullable=True),
            sa.Column('usergroup_ids', sa.JSON(), nullable=False),
            sa.Column('course_uuids', sa.JSON(), nullable=False),
            sa.Column('message', sa.Text(), nullable=True),
            sa.Column('invited_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('status', sa.String(16), nullable=False, server_default='pending'),
            sa.Column('token_hash', sa.String(64), nullable=True),
            sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('accepted_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('email_sent', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('send_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('last_sent_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index('ix_org_invitation_invitation_uuid', 'org_invitation', ['invitation_uuid'], unique=True)
        op.create_index('ix_org_invitation_org_status', 'org_invitation', ['org_id', 'status'])
        op.create_index('ix_org_invitation_email_status', 'org_invitation', ['email', 'status'])
        op.create_unique_constraint('uq_org_invitation_token_hash', 'org_invitation', ['token_hash'])

    if not inspector.has_table('org_invite_code'):
        op.create_table(
            'org_invite_code',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('code_uuid', sa.String(64), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('code', sa.String(32), nullable=False),
            sa.Column('role_id', sa.Integer(), sa.ForeignKey('role.id', ondelete='SET NULL'), nullable=True),
            sa.Column('usergroup_ids', sa.JSON(), nullable=False),
            sa.Column('course_uuids', sa.JSON(), nullable=False),
            sa.Column('max_uses', sa.Integer(), nullable=True),
            sa.Column('uses', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index('ix_org_invite_code_code_uuid', 'org_invite_code', ['code_uuid'], unique=True)
        op.create_index('ix_org_invite_code_org_code', 'org_invite_code', ['org_id', 'code'], unique=True)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table('org_invite_code'):
        op.drop_table('org_invite_code')
    if inspector.has_table('org_invitation'):
        op.drop_table('org_invitation')
