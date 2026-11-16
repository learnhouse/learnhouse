"""AI usage ledger

New table ``ai_usage_event``: one row per metered AI request (feature, member,
credits charged, provider cost, tokens). Feeds the usage page and the platform
console's AI costs view.

Revision ID: t1a2c3r4e5d6
Revises: s4t8a1l3s5c7
Create Date: 2026-11-09 23:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 't1a2c3r4e5d6'
down_revision: Union[str, None] = 's4t8a1l3s5c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if 'ai_usage_event' in tables:
        return
    op.create_table(
        'ai_usage_event',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('feature', sa.String(64), nullable=False),
        sa.Column('status', sa.String(16), nullable=False, server_default='ok'),
        sa.Column('credits', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('cost_micros', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('units', sa.Float(), nullable=False, server_default='1'),
        sa.Column('requests', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('input_tokens', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('output_tokens', sa.BigInteger(), nullable=False, server_default='0'),
        sa.Column('models', sa.JSON(), nullable=True),
        sa.Column('charge_key', sa.String(128), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_ai_usage_event_org_created', 'ai_usage_event', ['org_id', 'created_at'])
    op.create_index('ix_ai_usage_event_feature_created', 'ai_usage_event', ['feature', 'created_at'])
    op.create_index('ix_ai_usage_event_charge_key', 'ai_usage_event', ['charge_key'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_ai_usage_event_charge_key', table_name='ai_usage_event')
    op.drop_index('ix_ai_usage_event_feature_created', table_name='ai_usage_event')
    op.drop_index('ix_ai_usage_event_org_created', table_name='ai_usage_event')
    op.drop_table('ai_usage_event')
