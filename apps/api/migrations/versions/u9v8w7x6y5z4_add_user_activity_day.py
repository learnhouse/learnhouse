"""Add user_activity_day table (active-user tracking) and merge open heads

Creates the durable per-(org, user, UTC day) activity table that backs
active-user billing. Also merges the two open migration heads
(a2b3c4d5e6f7, r5s6t7u8v9w0) so `alembic upgrade head` resolves to a single
head again.

Revision ID: u9v8w7x6y5z4
Revises: a2b3c4d5e6f7, r5s6t7u8v9w0
Create Date: 2026-07-23 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 'u9v8w7x6y5z4'
down_revision: Union[str, Sequence[str], None] = ('a2b3c4d5e6f7', 'r5s6t7u8v9w0')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_activity_day',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'org_id', sa.BigInteger(),
            sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column(
            'user_id', sa.Integer(),
            sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False,
        ),
        sa.Column('activity_date', sa.Date(), nullable=False),
        sa.Column(
            'first_seen_at', sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.UniqueConstraint(
            'org_id', 'user_id', 'activity_date',
            name='uq_user_activity_org_user_date',
        ),
    )
    op.create_index(
        'ix_user_activity_org_date', 'user_activity_day', ['org_id', 'activity_date']
    )
    op.create_index(
        'ix_user_activity_org_user_date', 'user_activity_day',
        ['org_id', 'user_id', 'activity_date'],
    )


def downgrade() -> None:
    op.drop_index('ix_user_activity_org_user_date', table_name='user_activity_day')
    op.drop_index('ix_user_activity_org_date', table_name='user_activity_day')
    op.drop_table('user_activity_day')
