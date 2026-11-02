"""Payments: checkout types, access grants and sales data

Offers get a checkout type (stripe, external, free, manual) with its options,
no longer need a Stripe config, and can put their buyers in UserGroups.
Chapters and lessons get access rules (free preview). Enrollments get a public uuid, where they
came from and what was paid. Pending grants hold access given to an email that
has no account yet. Resources that offers reached only through a payments
group are linked to the offers directly, since the dashboard now edits an
offer's content in one place.

Revision ID: f2a3b4c5d6e7
Revises: 8d2b6f4c1e75
Create Date: 2026-11-02 00:00:00.000000
"""
from datetime import datetime
from typing import Sequence, Union
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = 'f2a3b4c5d6e7'
down_revision: Union[str, None] = '8d2b6f4c1e75'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(inspector, table: str, column: str) -> bool:
    return any(col["name"] == column for col in inspector.get_columns(table))


def _has_index(inspector, table: str, name: str) -> bool:
    return any(ix["name"] == name for ix in inspector.get_indexes(table))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    # The payments tables only exist on deployments with payments enabled.
    if not inspector.has_table('paymentsoffer'):
        return

    offer_columns = [
        sa.Column('checkout_type', sa.String(), nullable=False, server_default='stripe'),
        sa.Column('external_checkout_url', sa.String(), nullable=True),
        sa.Column('trial_days', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('allow_promotion_codes', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('compare_at_amount', sa.Float(), nullable=True),
    ]
    for column in offer_columns:
        if not _has_column(inspector, 'paymentsoffer', column.name):
            op.add_column('paymentsoffer', column)
    op.alter_column('paymentsoffer', 'payments_config_id', existing_type=sa.BigInteger(), nullable=True)

    if inspector.has_table('paymentsenrollment'):
        if not _has_column(inspector, 'paymentsenrollment', 'enrollment_uuid'):
            op.add_column('paymentsenrollment', sa.Column('enrollment_uuid', sa.String(), nullable=True))
            ids = [row[0] for row in bind.execute(sa.text('SELECT id FROM paymentsenrollment')).fetchall()]
            for enrollment_id in ids:
                bind.execute(
                    sa.text('UPDATE paymentsenrollment SET enrollment_uuid = :u WHERE id = :i'),
                    {"u": f"enrollment_{uuid4()}", "i": enrollment_id},
                )
            op.alter_column('paymentsenrollment', 'enrollment_uuid', existing_type=sa.String(), nullable=False)
        if not _has_index(inspector, 'paymentsenrollment', 'ix_paymentsenrollment_enrollment_uuid'):
            op.create_index(
                'ix_paymentsenrollment_enrollment_uuid', 'paymentsenrollment', ['enrollment_uuid'], unique=True,
            )
        for column in [
            sa.Column('source', sa.String(), nullable=False, server_default='stripe'),
            sa.Column('amount_paid', sa.Float(), nullable=True),
            sa.Column('currency', sa.String(), nullable=True),
        ]:
            if not _has_column(inspector, 'paymentsenrollment', column.name):
                op.add_column('paymentsenrollment', column)

    if not inspector.has_table('paymentspendinggrant'):
        op.create_table(
            'paymentspendinggrant',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('grant_uuid', sa.String(), nullable=False),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE')),
            sa.Column('offer_id', sa.BigInteger(), sa.ForeignKey('paymentsoffer.id', ondelete='CASCADE')),
            sa.Column('email', sa.String(), nullable=False),
            sa.Column('source', sa.String(), nullable=False, server_default='manual'),
            sa.Column('amount_paid', sa.Float(), nullable=True),
            sa.Column('currency', sa.String(), nullable=True),
            sa.Column('provider_specific_data', sa.JSON(), nullable=True),
            sa.Column('creation_date', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_paymentspendinggrant_grant_uuid', 'paymentspendinggrant', ['grant_uuid'], unique=True)
        op.create_index('ix_paymentspendinggrant_org_id', 'paymentspendinggrant', ['org_id'])
        op.create_index('ix_paymentspendinggrant_email', 'paymentspendinggrant', ['email'])

    if not inspector.has_table('paymentsofferusergroup'):
        op.create_table(
            'paymentsofferusergroup',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('offer_id', sa.BigInteger(), sa.ForeignKey('paymentsoffer.id', ondelete='CASCADE')),
            sa.Column('usergroup_id', sa.BigInteger(), sa.ForeignKey('usergroup.id', ondelete='CASCADE')),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE')),
            sa.Column('creation_date', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_paymentsofferusergroup_offer_id', 'paymentsofferusergroup', ['offer_id'])
        op.create_index('ix_paymentsofferusergroup_usergroup_id', 'paymentsofferusergroup', ['usergroup_id'])

    if not inspector.has_table('paymentsaccessrule'):
        op.create_table(
            'paymentsaccessrule',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE')),
            sa.Column('resource_uuid', sa.String(), nullable=False),
            sa.Column('rule', sa.String(), nullable=False),
            sa.Column('creation_date', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_paymentsaccessrule_org_id', 'paymentsaccessrule', ['org_id'])
        op.create_index('ix_paymentsaccessrule_resource_uuid', 'paymentsaccessrule', ['resource_uuid'])

    # Link group-only resources to their offers directly.
    if inspector.has_table('paymentsgroupresource') and inspector.has_table('paymentsofferresource'):
        rows = bind.execute(sa.text(
            'SELECT o.id, o.org_id, gr.resource_uuid FROM paymentsoffer o '
            'JOIN paymentsgroupresource gr ON gr.payments_group_id = o.payments_group_id '
            'WHERE o.payments_group_id IS NOT NULL AND NOT EXISTS ('
            '  SELECT 1 FROM paymentsofferresource r'
            '  WHERE r.offer_id = o.id AND r.resource_uuid = gr.resource_uuid)'
        )).fetchall()
        now = datetime.now()
        for offer_id, org_id, resource_uuid in rows:
            bind.execute(
                sa.text(
                    'INSERT INTO paymentsofferresource (offer_id, resource_uuid, org_id, creation_date, update_date) '
                    'VALUES (:o, :r, :g, :d, :d)'
                ),
                {"o": offer_id, "r": resource_uuid, "g": org_id, "d": now},
            )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table('paymentsoffer'):
        return
    if inspector.has_table('paymentspendinggrant'):
        op.drop_table('paymentspendinggrant')
    if inspector.has_table('paymentsofferusergroup'):
        op.drop_table('paymentsofferusergroup')
    if inspector.has_table('paymentsaccessrule'):
        op.drop_table('paymentsaccessrule')
    if inspector.has_table('paymentsenrollment'):
        if _has_index(inspector, 'paymentsenrollment', 'ix_paymentsenrollment_enrollment_uuid'):
            op.drop_index('ix_paymentsenrollment_enrollment_uuid', table_name='paymentsenrollment')
        for name in ('enrollment_uuid', 'source', 'amount_paid', 'currency'):
            if _has_column(inspector, 'paymentsenrollment', name):
                op.drop_column('paymentsenrollment', name)
    for name in ('checkout_type', 'external_checkout_url', 'trial_days', 'allow_promotion_codes', 'compare_at_amount'):
        if _has_column(inspector, 'paymentsoffer', name):
            op.drop_column('paymentsoffer', name)
