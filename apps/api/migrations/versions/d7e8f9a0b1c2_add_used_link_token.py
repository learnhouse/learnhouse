"""Add used_link_token for single-use sign-in links

Records every redeemed sign-in link (admin-issued and emailed) by its ``jti``.
The primary key is what makes a link single-use, so the guarantee survives a
Redis outage or flush. Idempotent so it is safe on a schema built by
``create_all``.

Revision ID: d7e8f9a0b1c2
Revises: b6e199d023f8
Create Date: 2026-10-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'd7e8f9a0b1c2'
down_revision: Union[str, None] = 'b6e199d023f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if 'used_link_token' not in inspector.get_table_names():
        op.create_table(
            'used_link_token',
            sa.Column('jti', sa.String(length=128), primary_key=True),
            sa.Column('purpose', sa.String(length=32), nullable=False),
            # Unix seconds; 64-bit so it cannot overflow in 2038.
            sa.Column('expires_at', sa.BigInteger(), nullable=False),
        )
        inspector = sa.inspect(op.get_bind())

    indexes = {ix['name'] for ix in inspector.get_indexes('used_link_token')}
    if 'ix_used_link_token_expires_at' not in indexes:
        op.create_index('ix_used_link_token_expires_at', 'used_link_token', ['expires_at'])


def downgrade() -> None:
    op.drop_index('ix_used_link_token_expires_at', table_name='used_link_token')
    op.drop_table('used_link_token')
