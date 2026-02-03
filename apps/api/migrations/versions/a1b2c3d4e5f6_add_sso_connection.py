"""Add SSO connection table

Revision ID: a1b2c3d4e5f6
Revises: f6a7b8c9d0e1
Create Date: 2025-02-01 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create ssoconnection table
    op.create_table(
        'ssoconnection',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('provider', sa.String(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('domains', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('auto_provision_users', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('default_role_id', sa.Integer(), sa.ForeignKey('role.id', ondelete='SET NULL'), nullable=True),
        sa.Column('provider_config', sa.JSON(), nullable=True, server_default='{}'),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    # Add indexes for faster lookups
    op.create_index('ix_ssoconnection_org_id', 'ssoconnection', ['org_id'], unique=True)
    op.create_index('ix_ssoconnection_provider', 'ssoconnection', ['provider'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('ix_ssoconnection_provider')
    op.drop_index('ix_ssoconnection_org_id')

    # Drop ssoconnection table
    op.drop_table('ssoconnection')
