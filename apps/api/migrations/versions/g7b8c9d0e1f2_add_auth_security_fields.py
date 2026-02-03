"""Add auth security fields

Revision ID: g7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-02-01 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 'g7b8c9d0e1f2'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new auth security columns to user table
    op.add_column('user', sa.Column('email_verified_at', sa.String(), nullable=True))
    op.add_column('user', sa.Column('failed_login_attempts', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('user', sa.Column('locked_until', sa.String(), nullable=True))
    op.add_column('user', sa.Column('last_login_at', sa.String(), nullable=True))
    op.add_column('user', sa.Column('last_login_ip', sa.String(), nullable=True))

    # Grandfather existing users: set email_verified to True and email_verified_at to current timestamp
    # This ensures existing users don't need to verify their email
    op.execute("""
        UPDATE "user"
        SET email_verified = true,
            email_verified_at = NOW()::text
        WHERE email_verified = false
    """)


def downgrade() -> None:
    op.drop_column('user', 'last_login_ip')
    op.drop_column('user', 'last_login_at')
    op.drop_column('user', 'locked_until')
    op.drop_column('user', 'failed_login_attempts')
    op.drop_column('user', 'email_verified_at')
