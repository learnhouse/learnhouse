"""Add billing_interval to paymentsoffer

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-10-17 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'e8f9a0b1c2d3'
down_revision: Union[str, None] = 'd7e8f9a0b1c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(inspector, table: str, column: str) -> bool:
    return any(col["name"] == column for col in inspector.get_columns(table))


def upgrade() -> None:
    # The payments tables only exist on deployments with payments enabled.
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table('paymentsoffer'):
        return
    if _has_column(inspector, 'paymentsoffer', 'billing_interval'):
        return
    op.add_column(
        'paymentsoffer',
        sa.Column('billing_interval', sa.String(), nullable=False, server_default='month'),
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table('paymentsoffer'):
        return
    if _has_column(inspector, 'paymentsoffer', 'billing_interval'):
        op.drop_column('paymentsoffer', 'billing_interval')
