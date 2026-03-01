"""Add mode column to paymentsconfig

Revision ID: r7s8t9u0v1w2
Revises: q6r7s8t9u0v1
Create Date: 2026-03-01 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'r7s8t9u0v1w2'
down_revision: Union[str, None] = 'q6r7s8t9u0v1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    paymentsmodenum = postgresql.ENUM('standard', 'express', name='paymentsmodenum', create_type=True)
    paymentsmodenum.create(op.get_bind(), checkfirst=True)

    op.add_column('paymentsconfig',
        sa.Column('mode', sa.Enum('standard', 'express', name='paymentsmodenum'), nullable=False, server_default='standard')
    )


def downgrade() -> None:
    op.drop_column('paymentsconfig', 'mode')
    op.execute("DROP TYPE IF EXISTS paymentsmodenum")
