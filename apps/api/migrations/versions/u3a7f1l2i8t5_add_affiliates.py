"""Affiliates for payments

New tables: ``affiliate_program`` (one per org), ``affiliate`` (members who
promote the org), ``affiliate_click`` (``?ref=`` visits, IP hashed),
``affiliate_payout`` and ``affiliate_commission`` (the ledger, amounts in
minor units, unique per org/kind/payment so webhook retries never double-pay).

Revision ID: u3a7f1l2i8t5
Revises: u1h2r3t4r5n6
Create Date: 2026-11-10 20:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'u3a7f1l2i8t5'
down_revision: Union[str, None] = 'u1h2r3t4r5n6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    # The commissions reference payments tables, which exist only on
    # deployments with payments.
    if 'paymentsenrollment' not in tables or 'paymentsoffer' not in tables:
        return

    if 'affiliate_program' not in tables:
        op.create_table(
            'affiliate_program',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False, unique=True),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('join_mode', sa.String(16), nullable=False, server_default='approval'),
            sa.Column('commission_type', sa.String(16), nullable=False, server_default='percent'),
            sa.Column('commission_value', sa.Float(), nullable=False, server_default='20'),
            sa.Column('recurring_mode', sa.String(16), nullable=False, server_default='first'),
            sa.Column('recurring_months', sa.Integer(), nullable=False, server_default='12'),
            sa.Column('cookie_days', sa.Integer(), nullable=False, server_default='30'),
            sa.Column('holding_days', sa.Integer(), nullable=False, server_default='30'),
            sa.Column('min_payout', sa.Float(), nullable=False, server_default='50'),
            sa.Column('max_commission_per_order', sa.Float(), nullable=True),
            sa.Column('terms', sa.Text(), nullable=False, server_default=''),
            sa.Column('all_offers', sa.Boolean(), nullable=False, server_default='true'),
            sa.Column('eligible_offer_ids', sa.JSON(), nullable=False, server_default='[]'),
            sa.Column('offer_overrides', sa.JSON(), nullable=False, server_default='{}'),
            sa.Column('creation_date', sa.DateTime(), nullable=False),
            sa.Column('update_date', sa.DateTime(), nullable=False),
        )

    if 'affiliate' not in tables:
        op.create_table(
            'affiliate',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('affiliate_uuid', sa.String(), nullable=False),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.BigInteger(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('status', sa.String(16), nullable=False, server_default='pending'),
            sa.Column('code', sa.String(32), nullable=False),
            sa.Column('commission_type', sa.String(16), nullable=True),
            sa.Column('commission_value', sa.Float(), nullable=True),
            sa.Column('promotion_code_id', sa.String(), nullable=True),
            sa.Column('promotion_code', sa.String(40), nullable=True),
            sa.Column('coupon_percent_off', sa.Float(), nullable=True),
            sa.Column('payout_method', sa.String(16), nullable=True),
            sa.Column('payout_details_encrypted', sa.Text(), nullable=True),
            sa.Column('payout_details_hint', sa.String(64), nullable=True),
            sa.Column('stripe_account_id', sa.String(), nullable=True),
            sa.Column('application_note', sa.Text(), nullable=False, server_default=''),
            sa.Column('notes', sa.Text(), nullable=False, server_default=''),
            sa.Column('terms_accepted_at', sa.DateTime(), nullable=True),
            sa.Column('invited_by', sa.BigInteger(), nullable=True),
            sa.Column('approved_at', sa.DateTime(), nullable=True),
            sa.Column('last_ip_hash', sa.String(64), nullable=True),
            sa.Column('creation_date', sa.DateTime(), nullable=False),
            sa.Column('update_date', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('org_id', 'user_id', name='uq_affiliate_org_user'),
            sa.UniqueConstraint('org_id', 'code', name='uq_affiliate_org_code'),
        )
        op.create_index('ix_affiliate_affiliate_uuid', 'affiliate', ['affiliate_uuid'], unique=True)
        op.create_index('ix_affiliate_org_id', 'affiliate', ['org_id'])
        op.create_index('ix_affiliate_promotion_code_id', 'affiliate', ['promotion_code_id'])

    if 'affiliate_click' not in tables:
        op.create_table(
            'affiliate_click',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('click_uuid', sa.String(), nullable=False),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('affiliate_id', sa.BigInteger(), sa.ForeignKey('affiliate.id', ondelete='CASCADE'), nullable=False),
            sa.Column('offer_id', sa.BigInteger(), nullable=True),
            sa.Column('landing_path', sa.String(255), nullable=False, server_default=''),
            sa.Column('referrer_host', sa.String(255), nullable=False, server_default=''),
            sa.Column('ip_hash', sa.String(64), nullable=False, server_default=''),
            sa.Column('created_at', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_affiliate_click_click_uuid', 'affiliate_click', ['click_uuid'], unique=True)
        op.create_index('ix_affiliate_click_ip_hash', 'affiliate_click', ['ip_hash'])
        op.create_index('ix_affiliate_click_aff_created', 'affiliate_click', ['affiliate_id', 'created_at'])
        op.create_index('ix_affiliate_click_org_created', 'affiliate_click', ['org_id', 'created_at'])

    if 'affiliate_payout' not in tables:
        op.create_table(
            'affiliate_payout',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('payout_uuid', sa.String(), nullable=False),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('affiliate_id', sa.BigInteger(), sa.ForeignKey('affiliate.id', ondelete='CASCADE'), nullable=False),
            sa.Column('currency', sa.String(3), nullable=False),
            sa.Column('amount_minor', sa.BigInteger(), nullable=False),
            sa.Column('commission_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('status', sa.String(16), nullable=False, server_default='pending'),
            sa.Column('method', sa.String(16), nullable=False, server_default='manual'),
            sa.Column('reference', sa.String(255), nullable=False, server_default=''),
            sa.Column('provider_transfer_id', sa.String(), nullable=True),
            sa.Column('note', sa.Text(), nullable=False, server_default=''),
            sa.Column('created_by', sa.BigInteger(), nullable=True),
            sa.Column('paid_by', sa.BigInteger(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('paid_at', sa.DateTime(), nullable=True),
            sa.Column('cancelled_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_affiliate_payout_payout_uuid', 'affiliate_payout', ['payout_uuid'], unique=True)
        op.create_index('ix_affiliate_payout_affiliate_id', 'affiliate_payout', ['affiliate_id'])
        op.create_index('ix_affiliate_payout_org_status', 'affiliate_payout', ['org_id', 'status'])

    if 'affiliate_commission' not in tables:
        op.create_table(
            'affiliate_commission',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('commission_uuid', sa.String(), nullable=False),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('affiliate_id', sa.BigInteger(), sa.ForeignKey('affiliate.id', ondelete='CASCADE'), nullable=False),
            sa.Column('enrollment_id', sa.BigInteger(), sa.ForeignKey('paymentsenrollment.id', ondelete='SET NULL'), nullable=True),
            sa.Column('offer_id', sa.BigInteger(), sa.ForeignKey('paymentsoffer.id', ondelete='SET NULL'), nullable=True),
            sa.Column('buyer_user_id', sa.BigInteger(), nullable=True),
            sa.Column('kind', sa.String(16), nullable=False, server_default='sale'),
            sa.Column('payment_ref', sa.String(255), nullable=False),
            sa.Column('payment_intent_ref', sa.String(255), nullable=True),
            sa.Column('subscription_ref', sa.String(255), nullable=True),
            sa.Column('attribution', sa.String(16), nullable=False, server_default='link'),
            sa.Column('click_id', sa.BigInteger(), nullable=True),
            sa.Column('currency', sa.String(3), nullable=False),
            sa.Column('sale_amount_minor', sa.BigInteger(), nullable=False),
            sa.Column('amount_minor', sa.BigInteger(), nullable=False),
            sa.Column('refunded_minor', sa.BigInteger(), nullable=False, server_default='0'),
            sa.Column('rate_type', sa.String(16), nullable=False, server_default='percent'),
            sa.Column('rate_value', sa.Float(), nullable=False, server_default='0'),
            sa.Column('status', sa.String(16), nullable=False, server_default='pending'),
            sa.Column('flags', sa.JSON(), nullable=False, server_default='[]'),
            sa.Column('card_fingerprint_hash', sa.String(64), nullable=True),
            sa.Column('source_commission_id', sa.BigInteger(), nullable=True),
            sa.Column('payout_id', sa.BigInteger(), sa.ForeignKey('affiliate_payout.id', ondelete='SET NULL'), nullable=True),
            sa.Column('available_at', sa.DateTime(), nullable=False),
            sa.Column('reversed_reason', sa.String(255), nullable=False, server_default=''),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('approved_at', sa.DateTime(), nullable=True),
            sa.Column('paid_at', sa.DateTime(), nullable=True),
            sa.Column('reversed_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('org_id', 'kind', 'payment_ref', name='uq_affiliate_commission_payment'),
        )
        op.create_index('ix_affiliate_commission_commission_uuid', 'affiliate_commission', ['commission_uuid'], unique=True)
        op.create_index('ix_affiliate_commission_payment_intent_ref', 'affiliate_commission', ['payment_intent_ref'])
        op.create_index('ix_affiliate_commission_subscription_ref', 'affiliate_commission', ['subscription_ref'])
        op.create_index('ix_affiliate_commission_payout_id', 'affiliate_commission', ['payout_id'])
        op.create_index('ix_affiliate_commission_aff_status', 'affiliate_commission', ['affiliate_id', 'status'])
        op.create_index('ix_affiliate_commission_org_status', 'affiliate_commission', ['org_id', 'status'])


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    for table in ('affiliate_commission', 'affiliate_payout', 'affiliate_click', 'affiliate', 'affiliate_program'):
        if table in tables:
            op.drop_table(table)
