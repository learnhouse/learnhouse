"""Add editorvariable table

Revision ID: 8d2b6f4c1e75
Revises: 5c1f8e2a9b30
Create Date: 2026-10-31 13:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '8d2b6f4c1e75'
down_revision: Union[str, None] = '5c1f8e2a9b30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # create_all may already have made it on a fresh install.
    if sa.inspect(op.get_bind()).has_table('editorvariable'):
        return
    op.create_table(
        'editorvariable',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('key', sa.String(), nullable=False),
        sa.Column('label', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=False, server_default=''),
        sa.Column('default_value', sa.String(), nullable=False, server_default=''),
        sa.Column('variants', sa.JSON(), nullable=True),
        sa.Column('variable_uuid', sa.String(), nullable=False, server_default=''),
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
        sa.UniqueConstraint('org_id', 'key', name='uq_editorvariable_org_key'),
    )
    op.create_index('ix_editorvariable_variable_uuid', 'editorvariable', ['variable_uuid'])
    op.create_index('ix_editorvariable_org_id', 'editorvariable', ['org_id'])


def downgrade() -> None:
    if not sa.inspect(op.get_bind()).has_table('editorvariable'):
        return
    op.drop_index('ix_editorvariable_org_id', table_name='editorvariable')
    op.drop_index('ix_editorvariable_variable_uuid', table_name='editorvariable')
    op.drop_table('editorvariable')
