"""Company seats (B2B seat licensing)

New tables: ``payments_seat_offer`` (per-seat pricing for an offer's content),
``company_account``, ``company_admin``, ``company_seat_pool`` (seats a
company holds per seat offer, with its Stripe subscription), ``company_seat``
(one per invited or assigned person), ``company_seat_order`` (the money
ledger, unique per Stripe session / invoice so webhook retries never count
twice) and ``company_seat_settings`` (grace period, reminders).

Revision ID: v2c5s8e1a4t7
Revises: u3a7f1l2i8t5
Create Date: 2026-11-10 23:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'v2c5s8e1a4t7'
down_revision: Union[str, None] = 'u3a7f1l2i8t5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _org():
    return sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False)


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    # Seats sell a payments offer's content: payments deployments only.
    if 'paymentsoffer' not in tables or 'paymentsenrollment' not in tables:
        return

    if 'payments_seat_offer' not in tables:
        op.create_table(
            'payments_seat_offer',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('seat_offer_uuid', sa.String(), nullable=False),
            _org(),
            sa.Column('offer_id', sa.BigInteger(), sa.ForeignKey('paymentsoffer.id', ondelete='CASCADE'), nullable=False),
            sa.Column('owns_offer', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('name', sa.String(), nullable=False, server_default=''),
            sa.Column('description', sa.Text(), nullable=False, server_default=''),
            sa.Column('billing', sa.String(16), nullable=False, server_default='subscription'),
            sa.Column('billing_interval', sa.String(8), nullable=False, server_default='year'),
            sa.Column('currency', sa.String(8), nullable=False, server_default='USD'),
            sa.Column('tiers', sa.JSON(), nullable=False, server_default='[]'),
            sa.Column('min_seats', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('max_seats', sa.Integer(), nullable=True),
            sa.Column('access_days', sa.Integer(), nullable=True),
            sa.Column('is_public', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('active', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('path_uuid', sa.String(), nullable=True),
            sa.Column('provider_product_id', sa.String(), nullable=False, server_default=''),
            sa.Column('creation_date', sa.DateTime(), nullable=False),
            sa.Column('update_date', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_payments_seat_offer_seat_offer_uuid', 'payments_seat_offer', ['seat_offer_uuid'], unique=True)
        op.create_index('ix_payments_seat_offer_org_id', 'payments_seat_offer', ['org_id'])

    if 'company_account' not in tables:
        op.create_table(
            'company_account',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('company_uuid', sa.String(), nullable=False),
            _org(),
            sa.Column('name', sa.String(200), nullable=False),
            sa.Column('billing_email', sa.String(320), nullable=False, server_default=''),
            sa.Column('billing_name', sa.String(200), nullable=True),
            sa.Column('status', sa.String(16), nullable=False, server_default='active'),
            sa.Column('stripe_customer_id', sa.String(), nullable=True),
            sa.Column('usergroup_id', sa.Integer(), sa.ForeignKey('usergroup.id', ondelete='SET NULL'), nullable=True),
            sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('source', sa.String(16), nullable=False, server_default='stripe'),
            sa.Column('creation_date', sa.DateTime(), nullable=False),
            sa.Column('update_date', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_company_account_company_uuid', 'company_account', ['company_uuid'], unique=True)
        op.create_index('ix_company_account_org_id', 'company_account', ['org_id'])
        op.create_index('ix_company_account_stripe_customer_id', 'company_account', ['stripe_customer_id'])

    if 'company_admin' not in tables:
        op.create_table(
            'company_admin',
            sa.Column('company_id', sa.Integer(), sa.ForeignKey('company_account.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), primary_key=True),
            _org(),
            sa.Column('added_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('creation_date', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_company_admin_org_id', 'company_admin', ['org_id'])

    if 'company_seat_pool' not in tables:
        op.create_table(
            'company_seat_pool',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('pool_uuid', sa.String(), nullable=False),
            _org(),
            sa.Column('company_id', sa.Integer(), sa.ForeignKey('company_account.id', ondelete='CASCADE'), nullable=False),
            sa.Column('seat_offer_id', sa.Integer(), sa.ForeignKey('payments_seat_offer.id', ondelete='CASCADE'), nullable=False),
            sa.Column('billing', sa.String(16), nullable=False, server_default='subscription'),
            sa.Column('quantity', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('billed_quantity', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('pending_quantity', sa.Integer(), nullable=True),
            sa.Column('comped_seats', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('unit_amount', sa.Float(), nullable=False, server_default='0'),
            sa.Column('currency', sa.String(8), nullable=False, server_default='USD'),
            sa.Column('status', sa.String(16), nullable=False, server_default='active'),
            sa.Column('stripe_subscription_id', sa.String(), nullable=True),
            sa.Column('stripe_subscription_item_id', sa.String(), nullable=True),
            sa.Column('current_period_end', sa.DateTime(), nullable=True),
            sa.Column('cancel_at_period_end', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('past_due_since', sa.DateTime(), nullable=True),
            sa.Column('grace_until', sa.DateTime(), nullable=True),
            sa.Column('low_seats_notified', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('renewal_reminded_for', sa.String(40), nullable=True),
            sa.Column('creation_date', sa.DateTime(), nullable=False),
            sa.Column('update_date', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('company_id', 'seat_offer_id', name='uq_company_seat_pool_offer'),
        )
        op.create_index('ix_company_seat_pool_pool_uuid', 'company_seat_pool', ['pool_uuid'], unique=True)
        op.create_index('ix_company_seat_pool_org_id', 'company_seat_pool', ['org_id'])
        op.create_index('ix_company_seat_pool_stripe_subscription_id', 'company_seat_pool', ['stripe_subscription_id'])

    if 'company_seat' not in tables:
        op.create_table(
            'company_seat',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('seat_uuid', sa.String(), nullable=False),
            _org(),
            sa.Column('company_id', sa.Integer(), sa.ForeignKey('company_account.id', ondelete='CASCADE'), nullable=False),
            sa.Column('pool_id', sa.Integer(), sa.ForeignKey('company_seat_pool.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('email', sa.String(320), nullable=False),
            sa.Column('status', sa.String(16), nullable=False, server_default='invited'),
            sa.Column('invite_token', sa.String(64), nullable=True, unique=True),
            sa.Column('enrollment_id', sa.BigInteger(), sa.ForeignKey('paymentsenrollment.id', ondelete='SET NULL'), nullable=True),
            sa.Column('created_enrollment', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('assigned_by_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('invited_at', sa.DateTime(), nullable=True),
            sa.Column('activated_at', sa.DateTime(), nullable=True),
            sa.Column('revoked_at', sa.DateTime(), nullable=True),
            sa.Column('creation_date', sa.DateTime(), nullable=False),
            sa.Column('update_date', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_company_seat_seat_uuid', 'company_seat', ['seat_uuid'], unique=True)
        op.create_index('ix_company_seat_company_id', 'company_seat', ['company_id'])
        op.create_index('ix_company_seat_pool_status', 'company_seat', ['pool_id', 'status'])
        op.create_index('ix_company_seat_org_email', 'company_seat', ['org_id', 'email'])
        op.create_index('ix_company_seat_user', 'company_seat', ['org_id', 'user_id'])

    if 'company_seat_order' not in tables:
        op.create_table(
            'company_seat_order',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('order_uuid', sa.String(), nullable=False),
            _org(),
            sa.Column('company_id', sa.Integer(), sa.ForeignKey('company_account.id', ondelete='SET NULL'), nullable=True),
            sa.Column('pool_id', sa.Integer(), sa.ForeignKey('company_seat_pool.id', ondelete='SET NULL'), nullable=True),
            sa.Column('seat_offer_id', sa.Integer(), sa.ForeignKey('payments_seat_offer.id', ondelete='SET NULL'), nullable=True),
            sa.Column('kind', sa.String(16), nullable=False, server_default='purchase'),
            sa.Column('status', sa.String(16), nullable=False, server_default='pending'),
            sa.Column('quantity', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('unit_amount', sa.Float(), nullable=False, server_default='0'),
            sa.Column('amount_total', sa.Float(), nullable=False, server_default='0'),
            sa.Column('amount_paid', sa.Float(), nullable=True),
            sa.Column('currency', sa.String(8), nullable=False, server_default='USD'),
            sa.Column('company_name', sa.String(200), nullable=False, server_default=''),
            sa.Column('billing_email', sa.String(320), nullable=False, server_default=''),
            sa.Column('buyer_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('stripe_session_id', sa.String(), nullable=True, unique=True),
            sa.Column('stripe_invoice_id', sa.String(), nullable=True, unique=True),
            sa.Column('stripe_payment_intent', sa.String(), nullable=True),
            sa.Column('stripe_subscription_id', sa.String(), nullable=True),
            sa.Column('details', sa.JSON(), nullable=False, server_default='{}'),
            sa.Column('creation_date', sa.DateTime(), nullable=False),
            sa.Column('paid_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_company_seat_order_order_uuid', 'company_seat_order', ['order_uuid'], unique=True)
        op.create_index('ix_company_seat_order_org_id', 'company_seat_order', ['org_id'])
        op.create_index('ix_company_seat_order_company_id', 'company_seat_order', ['company_id'])
        op.create_index('ix_company_seat_order_stripe_payment_intent', 'company_seat_order', ['stripe_payment_intent'])
        op.create_index('ix_company_seat_order_stripe_subscription_id', 'company_seat_order', ['stripe_subscription_id'])

    if 'company_seat_settings' not in tables:
        op.create_table(
            'company_seat_settings',
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('grace_days', sa.Integer(), nullable=False, server_default='7'),
            sa.Column('low_seats_percent', sa.Integer(), nullable=False, server_default='10'),
            sa.Column('renewal_reminder_days', sa.Integer(), nullable=False, server_default='7'),
            sa.Column('update_date', sa.DateTime(), nullable=False),
        )


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    for name in ('company_seat_settings', 'company_seat_order', 'company_seat', 'company_seat_pool',
                 'company_admin', 'company_account', 'payments_seat_offer'):
        if name in tables:
            op.drop_table(name)
