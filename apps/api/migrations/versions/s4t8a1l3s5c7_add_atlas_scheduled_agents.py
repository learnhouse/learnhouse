"""Atlas scheduled agents

New tables: ``atlas_scheduled_agent`` (instructions Atlas runs on a schedule
as their owner) and ``atlas_scheduled_run`` (one row per run).

Revision ID: s4t8a1l3s5c7
Revises: r6k2m9p4t1x7
Create Date: 2026-11-09 23:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 's4t8a1l3s5c7'
down_revision: Union[str, None] = 'r6k2m9p4t1x7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tz(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if 'atlas_scheduled_agent' not in tables:
        op.create_table(
            'atlas_scheduled_agent',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('agent_uuid', sa.String(), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('name', sa.String(120), nullable=False),
            sa.Column('instructions', sa.Text(), nullable=False, server_default=''),
            sa.Column('references', sa.JSON(), nullable=True),
            sa.Column('schedule', sa.JSON(), nullable=True),
            sa.Column('timezone', sa.String(64), nullable=False, server_default='UTC'),
            sa.Column('mode', sa.String(16), nullable=False, server_default='ask_first'),
            sa.Column('allowed_tiers', sa.JSON(), nullable=True),
            sa.Column('allowed_toolsets', sa.JSON(), nullable=True),
            sa.Column('run_budget', sa.Integer(), nullable=False, server_default='10'),
            sa.Column('monthly_budget', sa.Integer(), nullable=False, server_default='200'),
            sa.Column('deliver_in_app', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('deliver_email', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('deliver_chat', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('template', sa.String(40), nullable=True),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('paused_reason', sa.String(300), nullable=True),
            _tz('next_run_at'),
            _tz('last_run_at'),
            sa.Column('last_status', sa.String(20), nullable=True),
            sa.Column('consecutive_failures', sa.Integer(), nullable=False, server_default='0'),
            _tz('created_at', nullable=False),
            _tz('updated_at', nullable=False),
        )
        op.create_index('ix_atlas_scheduled_agent_agent_uuid', 'atlas_scheduled_agent', ['agent_uuid'], unique=True)
        op.create_index('ix_atlas_scheduled_agent_org_id', 'atlas_scheduled_agent', ['org_id'])
        op.create_index('ix_atlas_scheduled_agent_user_id', 'atlas_scheduled_agent', ['user_id'])
        op.create_index('ix_atlas_scheduled_agent_next_run_at', 'atlas_scheduled_agent', ['next_run_at'])

    if 'atlas_scheduled_run' not in tables:
        op.create_table(
            'atlas_scheduled_run',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('run_uuid', sa.String(), nullable=False),
            sa.Column('agent_id', sa.Integer(), sa.ForeignKey('atlas_scheduled_agent.id', ondelete='CASCADE'),
                      nullable=False),
            sa.Column('org_id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            _tz('started_at', nullable=False),
            _tz('finished_at'),
            sa.Column('trigger', sa.String(16), nullable=False, server_default='schedule'),
            sa.Column('status', sa.String(20), nullable=False, server_default='running'),
            sa.Column('credits_used', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('summary', sa.Text(), nullable=False, server_default=''),
            sa.Column('aichat_uuid', sa.String(80), nullable=True),
            sa.Column('pending_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('applied_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('error', sa.String(500), nullable=True),
            sa.Column('seen', sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.create_index('ix_atlas_scheduled_run_run_uuid', 'atlas_scheduled_run', ['run_uuid'], unique=True)
        op.create_index('ix_atlas_scheduled_run_agent_id', 'atlas_scheduled_run', ['agent_id'])
        op.create_index('ix_atlas_scheduled_run_org_id', 'atlas_scheduled_run', ['org_id'])
        op.create_index('ix_atlas_scheduled_run_user_id', 'atlas_scheduled_run', ['user_id'])
        op.create_index('ix_atlas_scheduled_run_started_at', 'atlas_scheduled_run', ['started_at'])
        op.create_index('ix_atlas_scheduled_run_status', 'atlas_scheduled_run', ['status'])


def downgrade() -> None:
    op.drop_table('atlas_scheduled_run')
    op.drop_table('atlas_scheduled_agent')
