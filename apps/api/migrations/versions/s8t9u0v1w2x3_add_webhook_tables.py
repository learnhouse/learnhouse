"""Add webhook_endpoint and webhook_delivery_log tables

Revision ID: s8t9u0v1w2x3
Revises: r7s8t9u0v1w2
Create Date: 2026-03-27 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 's8t9u0v1w2x3'
down_revision: Union[str, None] = 'r7s8t9u0v1w2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'webhook_endpoint',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('webhook_uuid', sa.String(length=100), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('url', sa.String(length=2048), nullable=False),
        sa.Column('secret_encrypted', sa.Text(), nullable=False),
        sa.Column('description', sa.String(length=500), nullable=True),
        sa.Column('events', sa.JSON(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('user.id'), nullable=False),
        sa.Column('creation_date', sa.String(), nullable=True),
        sa.Column('update_date', sa.String(), nullable=True),
    )
    op.create_index('ix_webhook_endpoint_webhook_uuid', 'webhook_endpoint', ['webhook_uuid'])
    op.create_index('ix_webhook_endpoint_org_id', 'webhook_endpoint', ['org_id'])
    op.create_index('ix_webhook_endpoint_org_active', 'webhook_endpoint', ['org_id', 'is_active'])

    op.create_table(
        'webhook_delivery_log',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('webhook_id', sa.Integer(), sa.ForeignKey('webhook_endpoint.id', ondelete='CASCADE'), nullable=False),
        sa.Column('event_name', sa.String(length=100), nullable=False),
        sa.Column('delivery_uuid', sa.String(length=100), nullable=False),
        sa.Column('request_payload', sa.JSON(), nullable=True),
        sa.Column('response_status', sa.Integer(), nullable=True),
        sa.Column('response_body', sa.String(length=500), nullable=True),
        sa.Column('success', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('attempt', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('error_message', sa.String(length=1000), nullable=True),
        sa.Column('created_at', sa.String(), nullable=True),
    )
    op.create_index('ix_webhook_delivery_log_webhook_id', 'webhook_delivery_log', ['webhook_id'])
    op.create_index('ix_webhook_delivery_log_created_at', 'webhook_delivery_log', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_webhook_delivery_log_created_at', table_name='webhook_delivery_log')
    op.drop_index('ix_webhook_delivery_log_webhook_id', table_name='webhook_delivery_log')
    op.drop_table('webhook_delivery_log')

    op.drop_index('ix_webhook_endpoint_org_active', table_name='webhook_endpoint')
    op.drop_index('ix_webhook_endpoint_org_id', table_name='webhook_endpoint')
    op.drop_index('ix_webhook_endpoint_webhook_uuid', table_name='webhook_endpoint')
    op.drop_table('webhook_endpoint')
