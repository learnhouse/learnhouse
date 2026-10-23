"""Add zarinpal_payment table

Revision ID: h2i3j4k5l6m7
Revises: g1h2i3j4k5l6
Create Date: 2026-10-22 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'h2i3j4k5l6m7'
down_revision: Union[str, None] = 'g1h2i3j4k5l6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Status values mirror src.db.zarinpal.ZarinPalPaymentStatusEnum.
_STATUS_VALUES = ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED')


def upgrade() -> None:
    bind = op.get_bind()

    status_enum = postgresql.ENUM(
        *_STATUS_VALUES, name='zarinpalpaymentstatusenum', create_type=False
    )
    # Create the enum type up-front (no-op if it already exists).
    status_enum.create(bind, checkfirst=True)

    op.create_table(
        'zarinpal_payment',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('payment_uuid', sa.String(length=100), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
        sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('authority', sa.String(length=64), nullable=True),
        sa.Column('ref_id', sa.String(length=32), nullable=True),
        sa.Column('card_pan', sa.String(length=20), nullable=True),
        sa.Column('code', sa.Integer(), nullable=True),
        sa.Column(
            'status',
            postgresql.ENUM(*_STATUS_VALUES, name='zarinpalpaymentstatusenum', create_type=False),
            nullable=False,
        ),
        sa.Column('creation_date', sa.String(), nullable=True),
        sa.Column('update_date', sa.String(), nullable=True),
    )
    op.create_index('ix_zarinpal_payment_uuid', 'zarinpal_payment', ['payment_uuid'])
    op.create_index('ix_zarinpal_payment_org_id', 'zarinpal_payment', ['org_id'])
    op.create_index('ix_zarinpal_payment_user_id', 'zarinpal_payment', ['user_id'])
    op.create_index('ix_zarinpal_payment_course_id', 'zarinpal_payment', ['course_id'])
    op.create_index('ix_zarinpal_payment_authority', 'zarinpal_payment', ['authority'])


def downgrade() -> None:
    op.drop_index('ix_zarinpal_payment_authority', table_name='zarinpal_payment')
    op.drop_index('ix_zarinpal_payment_course_id', table_name='zarinpal_payment')
    op.drop_index('ix_zarinpal_payment_user_id', table_name='zarinpal_payment')
    op.drop_index('ix_zarinpal_payment_org_id', table_name='zarinpal_payment')
    op.drop_index('ix_zarinpal_payment_uuid', table_name='zarinpal_payment')
    op.drop_table('zarinpal_payment')

    bind = op.get_bind()
    postgresql.ENUM(*_STATUS_VALUES, name='zarinpalpaymentstatusenum').drop(bind, checkfirst=True)
