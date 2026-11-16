"""Landing page builder: pages, versions and form submissions

Adds ``landing_page`` (draft + published document per org page),
``landing_page_version`` (history: publishes, restores, Atlas edits,
variants) and ``landing_form_submission`` (contact forms on published pages).
The legacy landing in the org config is untouched.

Revision ID: x2l7n4d9p3g6
Revises: l1v3c0ll4b01
Create Date: 2026-11-11 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'x2l7n4d9p3g6'
down_revision: Union[str, None] = 'l1v3c0ll4b01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if 'landing_page' not in tables:
        op.create_table(
            'landing_page',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('page_uuid', sa.String(100), nullable=False),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('slug', sa.String(64), nullable=False, server_default=''),
            sa.Column('title', sa.String(120), nullable=False, server_default=''),
            sa.Column('draft', sa.JSON(), nullable=False),
            sa.Column('draft_revision', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('draft_updated_at', sa.String(), nullable=False, server_default=''),
            sa.Column('draft_updated_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('published', sa.JSON(), nullable=True),
            sa.Column('published_version', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('published_at', sa.String(), nullable=True),
            sa.Column('published_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('preview_token', sa.String(64), nullable=False, server_default=''),
            sa.Column('review', sa.JSON(), nullable=True),
            sa.Column('creation_date', sa.String(), nullable=False, server_default=''),
            sa.Column('update_date', sa.String(), nullable=False, server_default=''),
            sa.UniqueConstraint('org_id', 'slug', name='uq_landing_page_org_slug'),
        )
        op.create_index('ix_landing_page_page_uuid', 'landing_page', ['page_uuid'])
    if 'landing_page_version' not in tables:
        op.create_table(
            'landing_page_version',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('version_uuid', sa.String(100), nullable=False),
            sa.Column('page_id', sa.Integer(), sa.ForeignKey('landing_page.id', ondelete='CASCADE'), nullable=False),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('kind', sa.String(20), nullable=False),
            sa.Column('label', sa.String(120), nullable=False, server_default=''),
            sa.Column('number', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('doc', sa.JSON(), nullable=False),
            sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('creation_date', sa.String(), nullable=False, server_default=''),
        )
        op.create_index('ix_landing_page_version_page_id', 'landing_page_version', ['page_id'])
    if 'landing_form_submission' not in tables:
        op.create_table(
            'landing_form_submission',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('submission_uuid', sa.String(100), nullable=False),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('page_id', sa.Integer(), sa.ForeignKey('landing_page.id', ondelete='CASCADE'), nullable=True),
            sa.Column('form_id', sa.String(40), nullable=False, server_default=''),
            sa.Column('data', sa.JSON(), nullable=False),
            sa.Column('creation_date', sa.String(), nullable=False, server_default=''),
        )
        op.create_index('ix_landing_form_submission_org_id', 'landing_form_submission', ['org_id'])


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    for name in ('landing_form_submission', 'landing_page_version', 'landing_page'):
        if name in tables:
            op.drop_table(name)
