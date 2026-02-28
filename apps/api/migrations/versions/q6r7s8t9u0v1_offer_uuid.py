"""Drop legacy payments tables

Revision ID: q6r7s8t9u0v1
Revises: 0314ec7791e1, m3b4c5d6e7f8
Create Date: 2026-02-28 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op

revision: str = 'q6r7s8t9u0v1'
down_revision: Union[str, tuple] = ('0314ec7791e1', 'm3b4c5d6e7f8')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop legacy tables (child before parent to respect FK constraints)
    op.drop_table('paymentscourse')
    op.drop_table('paymentsuser')
    op.drop_table('paymentsproduct')


def downgrade() -> None:
    pass
