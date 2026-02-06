"""Add signup_method to user table

Revision ID: i9d0e1f2a3b4
Revises: h8c9d0e1f2a3
Create Date: 2026-02-07 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 'i9d0e1f2a3b4'
down_revision: Union[str, None] = 'h8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user', sa.Column('signup_method', sa.String(), nullable=True))

    # Backfill: users with Google profile pictures are Google OAuth users
    op.execute("""
        UPDATE "user"
        SET signup_method = 'google'
        WHERE signup_method IS NULL
          AND avatar_image LIKE '%lh3.googleusercontent.com%'
    """)

    # Backfill: remaining users are email signups
    op.execute("""
        UPDATE "user"
        SET signup_method = 'email'
        WHERE signup_method IS NULL
    """)


def downgrade() -> None:
    op.drop_column('user', 'signup_method')
