"""Add orgapp table for installed third-party apps

Apps are frontend-only static bundles installed per organization. The row
tracks the uploaded manifest, the admin-approved scopes (Rights-shaped JSON),
install status and the storage prefix where the extracted bundle lives.

Revision ID: a7b8c9d0e1f2
Revises: n4o5p6q7r8s9
Create Date: 2026-07-07
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, None] = 'n4o5p6q7r8s9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'orgapp' in inspector.get_table_names():
        return

    op.create_table(
        'orgapp',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('app_uuid', sa.String(length=100), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
        sa.Column('slug', sa.String(length=40), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('description', sa.String(length=500), nullable=True),
        sa.Column('version', sa.String(length=30), nullable=False),
        sa.Column('icon_path', sa.String(length=255), nullable=True),
        sa.Column('entry_point', sa.String(length=255), nullable=False, server_default='index.html'),
        sa.Column('manifest', sa.JSON(), nullable=False),
        sa.Column('approved_scopes', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('storage_prefix', sa.String(length=255), nullable=False, server_default=''),
        sa.Column('creation_date', sa.String(), nullable=True),
        sa.Column('update_date', sa.String(), nullable=True),
        sa.UniqueConstraint('org_id', 'slug', name='uq_orgapp_org_slug'),
    )
    op.create_index('ix_orgapp_app_uuid', 'orgapp', ['app_uuid'])
    op.create_index('ix_orgapp_org_id', 'orgapp', ['org_id'])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'orgapp' not in inspector.get_table_names():
        return

    op.drop_index('ix_orgapp_org_id', table_name='orgapp')
    op.drop_index('ix_orgapp_app_uuid', table_name='orgapp')
    op.drop_table('orgapp')
