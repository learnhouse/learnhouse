"""Add editortemplate table

Revision ID: 0a7e3c9d1b42
Revises: e8f9a0b1c2d3
Create Date: 2026-10-31 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '0a7e3c9d1b42'
down_revision: Union[str, None] = 'e8f9a0b1c2d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # create_all may already have made it on a fresh install.
    if sa.inspect(op.get_bind()).has_table('editortemplate'):
        return
    op.create_table(
        'editortemplate',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=False, server_default=''),
        sa.Column('kind', sa.String(), nullable=False, server_default='block'),
        sa.Column('content', sa.JSON(), nullable=True),
        sa.Column('template_uuid', sa.String(), nullable=False, server_default=''),
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
    op.create_index('ix_editortemplate_template_uuid', 'editortemplate', ['template_uuid'])
    op.create_index('ix_editortemplate_org_id', 'editortemplate', ['org_id'])


def downgrade() -> None:
    if not sa.inspect(op.get_bind()).has_table('editortemplate'):
        return
    op.drop_index('ix_editortemplate_org_id', table_name='editortemplate')
    op.drop_index('ix_editortemplate_template_uuid', table_name='editortemplate')
    op.drop_table('editortemplate')
