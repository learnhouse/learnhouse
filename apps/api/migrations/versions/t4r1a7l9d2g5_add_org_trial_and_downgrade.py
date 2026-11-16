"""Organization trials and downgrade records

Creates ``org_trial`` (the 14-day trial every new SaaS organization starts
with: plan, end date, how it ended) and ``org_downgrade`` (what a move to the
Free plan changed, such as courses made private, so an upgrade can restore it).
Adds ``company_account.member_limit`` (EE Companies: an optional cap on the
people an academy lets into a company it gives access to directly).

Revision ID: t4r1a7l9d2g5
Revises: o2b8n4k1d7f3
Create Date: 2026-11-15 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 't4r1a7l9d2g5'
down_revision: Union[str, None] = 'o2b8n4k1d7f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if 'org_trial' not in tables:
        op.create_table(
            'org_trial',
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('plan', sa.String(32), nullable=False),
            sa.Column('status', sa.String(16), nullable=False, server_default='active'),
            sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('ends_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('converted_plan', sa.String(32), nullable=True),
            sa.Column('created_by_user_id', sa.Integer(), nullable=True),
        )
        op.create_index('ix_org_trial_status_ends', 'org_trial', ['status', 'ends_at'])
    if 'org_downgrade' not in tables:
        op.create_table(
            'org_downgrade',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('from_plan', sa.String(32), nullable=False),
            sa.Column('to_plan', sa.String(32), nullable=False),
            sa.Column('reason', sa.String(32), nullable=False, server_default='other'),
            sa.Column('changes', sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('restored_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('restored_to_plan', sa.String(32), nullable=True),
        )
        op.create_index('ix_org_downgrade_org_created', 'org_downgrade', ['org_id', 'created_at'])
    if 'company_account' in tables:
        columns = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('company_account')}
        if 'member_limit' not in columns:
            op.add_column('company_account', sa.Column('member_limit', sa.Integer(), nullable=True))


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if 'company_account' in tables:
        columns = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('company_account')}
        if 'member_limit' in columns:
            op.drop_column('company_account', 'member_limit')
    if 'org_downgrade' in tables:
        op.drop_index('ix_org_downgrade_org_created', table_name='org_downgrade')
        op.drop_table('org_downgrade')
    if 'org_trial' in tables:
        op.drop_index('ix_org_trial_status_ends', table_name='org_trial')
        op.drop_table('org_trial')
