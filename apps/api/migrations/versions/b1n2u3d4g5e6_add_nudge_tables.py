"""Add nudge_send ledger and email_preference tables

nudge_send is the send ledger for lifecycle email; its unique dedupe_key is
what makes a re-run (including a backfill across every existing org) safe.
email_preference holds per-user opt-out state for non-transactional mail.

Revision ID: b1n2u3d4g5e6
Revises: t6u7v8w9x0y1
Create Date: 2026-07-28 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 'b1n2u3d4g5e6'
down_revision: Union[str, Sequence[str], None] = 't6u7v8w9x0y1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'nudge_send',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('nudge_id', sa.String(length=64), nullable=False),
        sa.Column('dedupe_key', sa.String(length=160), nullable=False),
        sa.Column(
            'org_id', sa.BigInteger(),
            sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column(
            'user_id', sa.Integer(),
            sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('status', sa.String(length=16), nullable=False, server_default='claimed'),
        sa.Column('lang', sa.String(length=8), nullable=False, server_default='en'),
        sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error', sa.String(length=255), nullable=True),
        sa.Column('meta', sa.JSON(), nullable=True),
        sa.Column('provider_id', sa.String(length=64), nullable=True),
        sa.Column(
            'delivery_checked', sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.UniqueConstraint('dedupe_key', name='uq_nudge_send_dedupe'),
    )
    op.create_index('ix_nudge_send_user_sent', 'nudge_send', ['user_id', 'sent_at'])
    op.create_index('ix_nudge_send_org_nudge', 'nudge_send', ['org_id', 'nudge_id'])
    op.create_index('ix_nudge_send_nudge_sent', 'nudge_send', ['nudge_id', 'sent_at'])
    op.create_index(
        'ix_nudge_send_unchecked', 'nudge_send', ['delivery_checked', 'sent_at']
    )

    op.create_table(
        'email_preference',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'user_id', sa.Integer(),
            sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column(
            'lifecycle_opt_out', sa.Boolean(), nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            'product_updates_opt_out', sa.Boolean(), nullable=False,
            server_default=sa.false(),
        ),
        sa.Column('unsubscribed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('source', sa.String(length=32), nullable=True),
        sa.Column(
            'suppressed', sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column('suppressed_reason', sa.String(length=32), nullable=True),
        sa.UniqueConstraint('user_id', name='uq_email_preference_user'),
    )
    op.create_index('ix_email_preference_user_id', 'email_preference', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_email_preference_user_id', table_name='email_preference')
    op.drop_table('email_preference')
    op.drop_index('ix_nudge_send_unchecked', table_name='nudge_send')
    op.drop_index('ix_nudge_send_nudge_sent', table_name='nudge_send')
    op.drop_index('ix_nudge_send_org_nudge', table_name='nudge_send')
    op.drop_index('ix_nudge_send_user_sent', table_name='nudge_send')
    op.drop_table('nudge_send')
