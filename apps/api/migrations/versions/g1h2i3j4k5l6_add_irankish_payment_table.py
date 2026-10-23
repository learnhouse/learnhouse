"""Add irankish_payment table

Revision ID: g1h2i3j4k5l6
Revises: f2a3b4c5d6e7
Create Date: 2026-10-22 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'g1h2i3j4k5l6'
down_revision: Union[str, None] = 'f2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Status values mirror src.db.irankish.IranKishPaymentStatusEnum.
_STATUS_VALUES = ('PENDING', 'PAID', 'COMPLETED', 'FAILED', 'REVERSED')


def upgrade() -> None:
    bind = op.get_bind()

    status_enum = postgresql.ENUM(
        *_STATUS_VALUES, name='irankishpaymentstatusenum', create_type=False
    )
    # Create the enum type up-front (no-op if it already exists).
    status_enum.create(bind, checkfirst=True)

    op.create_table(
        'irankish_payment',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('payment_uuid', sa.String(length=100), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
        sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('request_id', sa.String(length=20), nullable=False),
        sa.Column('token', sa.String(length=48), nullable=True),
        sa.Column('retrieval_reference_number', sa.String(length=12), nullable=True),
        sa.Column('system_trace_audit_number', sa.String(length=6), nullable=True),
        sa.Column('masked_pan', sa.String(length=19), nullable=True),
        sa.Column('response_code', sa.String(length=4), nullable=True),
        sa.Column(
            'status',
            postgresql.ENUM(*_STATUS_VALUES, name='irankishpaymentstatusenum', create_type=False),
            nullable=False,
        ),
        sa.Column('creation_date', sa.String(), nullable=True),
        sa.Column('update_date', sa.String(), nullable=True),
    )
    op.create_index('ix_irankish_payment_uuid', 'irankish_payment', ['payment_uuid'])
    op.create_index('ix_irankish_payment_org_id', 'irankish_payment', ['org_id'])
    op.create_index('ix_irankish_payment_user_id', 'irankish_payment', ['user_id'])
    op.create_index('ix_irankish_payment_course_id', 'irankish_payment', ['course_id'])
    op.create_index('ix_irankish_payment_request_id', 'irankish_payment', ['request_id'])
    op.create_index('ix_irankish_payment_token', 'irankish_payment', ['token'])


def downgrade() -> None:
    op.drop_index('ix_irankish_payment_token', table_name='irankish_payment')
    op.drop_index('ix_irankish_payment_request_id', table_name='irankish_payment')
    op.drop_index('ix_irankish_payment_course_id', table_name='irankish_payment')
    op.drop_index('ix_irankish_payment_user_id', table_name='irankish_payment')
    op.drop_index('ix_irankish_payment_org_id', table_name='irankish_payment')
    op.drop_index('ix_irankish_payment_uuid', table_name='irankish_payment')
    op.drop_table('irankish_payment')

    bind = op.get_bind()
    postgresql.ENUM(*_STATUS_VALUES, name='irankishpaymentstatusenum').drop(bind, checkfirst=True)
