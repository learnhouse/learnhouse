"""Landing page builder: sections saved to reuse across pages

Adds ``landing_saved_section``: one row per section an admin saved from the
page builder, scoped to the organization, so any of its pages can insert it.

Revision ID: z4s8v2k6n1p3
Revises: e2d9f4a7b1c6
Create Date: 2026-11-13 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'z4s8v2k6n1p3'
down_revision: Union[str, None] = 'e2d9f4a7b1c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if 'landing_saved_section' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        'landing_saved_section',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('section_uuid', sa.String(100), nullable=False),
        sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(80), nullable=False, server_default=''),
        sa.Column('node', sa.JSON(), nullable=False),
        sa.Column('symbols', sa.JSON(), nullable=False),
        sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
        sa.Column('creation_date', sa.String(), nullable=False, server_default=''),
        sa.Column('update_date', sa.String(), nullable=False, server_default=''),
    )
    op.create_index('ix_landing_saved_section_org_id', 'landing_saved_section', ['org_id'])


def downgrade() -> None:
    if 'landing_saved_section' in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table('landing_saved_section')
