"""Add API tokens table

Revision ID: a1b2c3d4e5f6
Revises: f8a3c2d1e5b7
Create Date: 2026-01-25 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa # noqa: F401
import sqlmodel # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f8a3c2d1e5b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create the apitoken table
    op.create_table(
        'apitoken',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('token_uuid', sa.String(length=100), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('description', sa.String(length=500), nullable=True),
        sa.Column('token_prefix', sa.String(length=12), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('org_id', sa.Integer(), nullable=False),
        sa.Column('rights', sa.JSON(), nullable=True),
        sa.Column('created_by_user_id', sa.Integer(), nullable=False),
        sa.Column('creation_date', sa.String(), nullable=False),
        sa.Column('update_date', sa.String(), nullable=False),
        sa.Column('last_used_at', sa.String(), nullable=True),
        sa.Column('expires_at', sa.String(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['user.id'], ondelete='CASCADE'),
    )

    # Create indexes for efficient lookups
    op.create_index('ix_apitoken_token_hash', 'apitoken', ['token_hash'], unique=True)
    op.create_index('ix_apitoken_token_uuid', 'apitoken', ['token_uuid'], unique=True)
    op.create_index('ix_apitoken_org_id', 'apitoken', ['org_id'])
    op.create_index('ix_apitoken_is_active', 'apitoken', ['is_active'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('ix_apitoken_is_active', table_name='apitoken')
    op.drop_index('ix_apitoken_org_id', table_name='apitoken')
    op.drop_index('ix_apitoken_token_uuid', table_name='apitoken')
    op.drop_index('ix_apitoken_token_hash', table_name='apitoken')

    # Drop the table
    op.drop_table('apitoken')
