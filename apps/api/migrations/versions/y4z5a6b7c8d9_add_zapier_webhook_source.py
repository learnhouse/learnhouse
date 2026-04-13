"""Add source, zap_name, zap_id to webhook_endpoint for Zapier integration

Revision ID: y4z5a6b7c8d9
Revises: x3y4z5a6b7c8
Create Date: 2026-04-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 'y4z5a6b7c8d9'
down_revision: Union[str, None] = 'x3y4z5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'webhook_endpoint' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('webhook_endpoint')}

    if 'source' not in existing_columns:
        op.add_column(
            'webhook_endpoint',
            sa.Column(
                'source',
                sa.String(length=20),
                nullable=False,
                server_default='manual',
            ),
        )

    if 'zap_name' not in existing_columns:
        op.add_column(
            'webhook_endpoint',
            sa.Column('zap_name', sa.String(length=200), nullable=True),
        )

    if 'zap_id' not in existing_columns:
        op.add_column(
            'webhook_endpoint',
            sa.Column('zap_id', sa.String(length=100), nullable=True),
        )

    existing_indexes = {ix['name'] for ix in inspector.get_indexes('webhook_endpoint')}
    if 'ix_webhook_endpoint_source' not in existing_indexes:
        op.create_index(
            'ix_webhook_endpoint_source',
            'webhook_endpoint',
            ['org_id', 'source'],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'webhook_endpoint' not in inspector.get_table_names():
        return

    existing_indexes = {ix['name'] for ix in inspector.get_indexes('webhook_endpoint')}
    if 'ix_webhook_endpoint_source' in existing_indexes:
        op.drop_index('ix_webhook_endpoint_source', table_name='webhook_endpoint')

    existing_columns = {col['name'] for col in inspector.get_columns('webhook_endpoint')}
    for col in ('zap_id', 'zap_name', 'source'):
        if col in existing_columns:
            op.drop_column('webhook_endpoint', col)
