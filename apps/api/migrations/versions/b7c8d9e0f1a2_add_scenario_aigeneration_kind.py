"""add SCENARIO to aigenerationkind

Lets AI-generated interactive scenarios be recorded in the durable
AIGeneration history alongside images, quizzes, and assignments.

Revision ID: b7c8d9e0f1a2
Revises: f9e8d7c6b5a4
Create Date: 2026-07-03

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, None] = 'f9e8d7c6b5a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block; commit the
    # migration's implicit transaction first (mirrors the CUSTOM-type migration).
    # Guarded so it is a no-op if the aigeneration table/enum doesn't exist yet.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'aigeneration' not in inspector.get_table_names():
        return
    op.execute("COMMIT")
    op.execute("ALTER TYPE aigenerationkind ADD VALUE IF NOT EXISTS 'SCENARIO'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values directly.
    pass
