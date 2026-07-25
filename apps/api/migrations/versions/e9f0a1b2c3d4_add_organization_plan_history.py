"""Add organization_plan_history table (plan-at-time for arrears billing)

Active-user overage is billed in arrears — a month behind for monthly
subscriptions, up to a year for annual ones. Without a record of which plan an
org held during the billed month, the overage would be priced against whatever
plan the org happens to be on when the invoice is cut. This append-only table
records each plan change so a past month resolves to the limit that applied then.

Revision ID: e9f0a1b2c3d4
Revises: u9v8w7x6y5z4, b8c9d0e1f2a3
Create Date: 2026-07-25 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 'e9f0a1b2c3d4'
# Chains after this branch's activity table AND dev's user-audit-event migration,
# so the two land in a defined order instead of leaving divergent heads.
down_revision: Union[str, Sequence[str], None] = ('u9v8w7x6y5z4', 'b8c9d0e1f2a3')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'organization_plan_history',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'org_id', sa.BigInteger(),
            sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('plan', sa.String(length=64), nullable=False),
        sa.Column(
            'effective_from', sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text('now()'),
        ),
    )
    op.create_index(
        'ix_org_plan_history_org_from', 'organization_plan_history',
        ['org_id', 'effective_from'],
    )


def downgrade() -> None:
    op.drop_index('ix_org_plan_history_org_from', table_name='organization_plan_history')
    op.drop_table('organization_plan_history')
