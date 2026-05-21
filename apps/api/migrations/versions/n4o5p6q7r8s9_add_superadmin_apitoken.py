"""add superadmin_apitoken table

Revision ID: n4o5p6q7r8s9
Revises: c8d9e0f3a4b5
Create Date: 2026-05-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'n4o5p6q7r8s9'
down_revision: Union[str, None] = 'c8d9e0f3a4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'superadmin_apitoken',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column('description', sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
        sa.Column('token_uuid', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=False),
        sa.Column('token_prefix', sqlmodel.sql.sqltypes.AutoString(length=15), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=True),
        sa.Column('created_by_user_id', sa.Integer(), nullable=False),
        sa.Column('creation_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('update_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('last_used_at', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('expires_at', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_superadmin_apitoken_token_hash', 'superadmin_apitoken', ['token_hash'], unique=False)
    op.create_index('ix_superadmin_apitoken_created_by', 'superadmin_apitoken', ['created_by_user_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_superadmin_apitoken_created_by', table_name='superadmin_apitoken')
    op.drop_index('ix_superadmin_apitoken_token_hash', table_name='superadmin_apitoken')
    op.drop_table('superadmin_apitoken')
