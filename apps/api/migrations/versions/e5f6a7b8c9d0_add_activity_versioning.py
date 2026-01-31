"""Add activity versioning

Revision ID: e5f6a7b8c9d0
Revises: c4d5e6f7a8b9
Create Date: 2025-01-31 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add versioning fields to activity table
    op.add_column('activity', sa.Column('current_version', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('activity', sa.Column('last_modified_by_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_activity_last_modified_by',
        'activity',
        'user',
        ['last_modified_by_id'],
        ['id'],
        ondelete='SET NULL'
    )

    # Create activity_version table
    op.create_table(
        'activityversion',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('activity_id', sa.Integer(), sa.ForeignKey('activity.id', ondelete='CASCADE'), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('version_number', sa.Integer(), nullable=False),
        sa.Column('content', sa.JSON(), nullable=False),
        sa.Column('created_by_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    # Add index for faster lookups
    op.create_index('ix_activityversion_activity_id', 'activityversion', ['activity_id'])
    op.create_index('ix_activityversion_version_number', 'activityversion', ['activity_id', 'version_number'])


def downgrade() -> None:
    # Drop activity_version table
    op.drop_index('ix_activityversion_version_number')
    op.drop_index('ix_activityversion_activity_id')
    op.drop_table('activityversion')

    # Remove versioning fields from activity table
    op.drop_constraint('fk_activity_last_modified_by', 'activity', type_='foreignkey')
    op.drop_column('activity', 'last_modified_by_id')
    op.drop_column('activity', 'current_version')
