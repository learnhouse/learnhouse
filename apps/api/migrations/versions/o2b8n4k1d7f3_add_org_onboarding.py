"""Organization onboarding state

Creates ``org_onboarding``: one row per organization with the goal the admin
picked at signup, their setup checklist choices (dismissed, skipped,
celebrated steps) and the first time each funnel milestone happened. The
checklist used to live in each browser's localStorage, so it did not follow
the admin across devices and could not be measured.

Revision ID: o2b8n4k1d7f3
Revises: i3m8p5s2v7k4
Create Date: 2026-11-14 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'o2b8n4k1d7f3'
down_revision: Union[str, None] = 'i3m8p5s2v7k4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = 'org_onboarding'


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if TABLE in set(insp.get_table_names()):
        return
    op.create_table(
        TABLE,
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('goal', sa.String(32), nullable=True),
        sa.Column('state', sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column('milestones', sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_org_onboarding_org_id', TABLE, ['org_id'], unique=True)
    op.create_index('ix_org_onboarding_goal', TABLE, ['goal'])


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if TABLE not in set(insp.get_table_names()):
        return
    op.drop_index('ix_org_onboarding_goal', table_name=TABLE)
    op.drop_index('ix_org_onboarding_org_id', table_name=TABLE)
    op.drop_table(TABLE)
