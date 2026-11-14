"""Demo instances (EE): instance-side state, links, events; console registry

Adds ``demo_instance_state``, ``demo_instance_link``, ``demo_instance_link_use``
and ``demo_instance_event`` (filled only inside a dedicated demo instance) and
``platform_demo`` (demos registered in the platform console).

Revision ID: e2d9f4a7b1c6
Revises: d8k3t6m1w4q9
Create Date: 2026-11-13 20:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e2d9f4a7b1c6'
down_revision: Union[str, None] = 'd8k3t6m1w4q9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ts(name: str, index: bool = False) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=True, index=index)


def _s(name: str, length: int, default: str = '') -> sa.Column:
    return sa.Column(name, sa.String(length), nullable=False, server_default=default)


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if 'demo_instance_state' not in tables:
        op.create_table(
            'demo_instance_state',
            sa.Column('id', sa.Integer(), primary_key=True),
            _s('instance_id', 64),
            _s('status', 20, 'active'),
            _ts('expires_at'),
            _ts('closed_at'),
            sa.Column('closed_reason', sa.String(300), nullable=True),
            _ts('sessions_valid_after'),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='SET NULL'), nullable=True),
            _s('prospect_name', 200),
            _s('prospect_email', 320),
            _s('company', 200),
            _s('owner_name', 200),
            _s('owner_email', 320),
            _s('cta_url', 500),
            sa.Column('extensions', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('settings', sa.JSON(), nullable=False),
            _ts('created_at'),
            _ts('updated_at'),
        )
    if 'demo_instance_link' not in tables:
        op.create_table(
            'demo_instance_link',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('link_uuid', sa.String(64), nullable=False),
            _s('label', 200),
            _s('email', 320),
            _s('name', 200),
            _s('role', 20, 'admin'),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('max_uses', sa.Integer(), nullable=False, server_default='5'),
            sa.Column('use_count', sa.Integer(), nullable=False, server_default='0'),
            _ts('expires_at'),
            _ts('revoked_at'),
            _ts('last_used_at'),
            _ts('created_at'),
        )
        op.create_index('ix_demo_instance_link_link_uuid', 'demo_instance_link', ['link_uuid'], unique=True)
    if 'demo_instance_link_use' not in tables:
        op.create_table(
            'demo_instance_link_use',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('link_id', sa.Integer(), sa.ForeignKey('demo_instance_link.id', ondelete='CASCADE'), nullable=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('at', sa.DateTime(timezone=True), nullable=True),
            _s('outcome', 30),
            _s('ip', 64),
            _s('user_agent', 300),
        )
        op.create_index('ix_demo_instance_link_use_link_id', 'demo_instance_link_use', ['link_id'])
        op.create_index('ix_demo_instance_link_use_at', 'demo_instance_link_use', ['at'])
    if 'demo_instance_event' not in tables:
        op.create_table(
            'demo_instance_event',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            _s('session_key', 64),
            _s('kind', 20),
            _s('area', 40),
            _s('feature', 60),
            _s('action', 80),
            _s('path', 300),
            _s('method', 8),
            sa.Column('status', sa.Integer(), nullable=False, server_default='0'),
            _s('device', 20),
            sa.Column('duration_ms', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('properties', sa.JSON(), nullable=False),
        )
        for col in ('at', 'user_id', 'session_key', 'kind', 'feature'):
            op.create_index(f'ix_demo_instance_event_{col}', 'demo_instance_event', [col])
    if 'platform_demo' not in tables:
        op.create_table(
            'platform_demo',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('demo_uuid', sa.String(64), nullable=False),
            _s('company', 200),
            _s('prospect_name', 200),
            _s('prospect_email', 320),
            _s('slug', 80),
            _s('instance_url', 500),
            sa.Column('control_key_enc', sa.Text(), nullable=False, server_default=''),
            sa.Column('owner_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            _s('status', 20, 'active'),
            _ts('expires_at'),
            sa.Column('notes', sa.Text(), nullable=False, server_default=''),
            sa.Column('last_snapshot', sa.JSON(), nullable=False),
            _ts('last_synced_at'),
            _s('last_error', 500),
            _ts('last_link_at'),
            _ts('created_at'),
            _ts('updated_at'),
        )
        op.create_index('ix_platform_demo_demo_uuid', 'platform_demo', ['demo_uuid'], unique=True)


def downgrade() -> None:
    for table in ('platform_demo', 'demo_instance_event', 'demo_instance_link_use', 'demo_instance_link',
                  'demo_instance_state'):
        op.drop_table(table)
