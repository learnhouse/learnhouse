"""Add editoraudience table

Revision ID: 5c1f8e2a9b30
Revises: 0a7e3c9d1b42
Create Date: 2026-10-31 12:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '5c1f8e2a9b30'
down_revision: Union[str, None] = '0a7e3c9d1b42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # create_all may already have made it on a fresh install.
    if sa.inspect(op.get_bind()).has_table('editoraudience'):
        return
    op.create_table(
        'editoraudience',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=False, server_default=''),
        sa.Column('rules', sa.JSON(), nullable=True),
        sa.Column('audience_uuid', sa.String(), nullable=False, server_default=''),
        sa.Column(
            'org_id', sa.Integer(),
            sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column(
            'creator_id', sa.Integer(),
            sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True,
        ),
        sa.Column('creation_date', sa.String(), nullable=False, server_default=''),
        sa.Column('update_date', sa.String(), nullable=False, server_default=''),
    )
    op.create_index('ix_editoraudience_audience_uuid', 'editoraudience', ['audience_uuid'])
    op.create_index('ix_editoraudience_org_id', 'editoraudience', ['org_id'])


def downgrade() -> None:
    if not sa.inspect(op.get_bind()).has_table('editoraudience'):
        return
    op.drop_index('ix_editoraudience_org_id', table_name='editoraudience')
    op.drop_index('ix_editoraudience_audience_uuid', table_name='editoraudience')
    op.drop_table('editoraudience')
