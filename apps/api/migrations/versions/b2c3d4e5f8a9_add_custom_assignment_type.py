"""add CUSTOM to assignmenttasktypeenum

Adds a first-class CUSTOM assignment task type for headless/custom assignments:
the task ``contents`` JSON (definition) and ``task_submission`` JSON (answer) are
an arbitrary, caller-owned data object that the server never interprets or
auto-grades — it is graded manually. Lets custom frontends fully own the schema.

Revision ID: b2c3d4e5f8a9
Revises: a1b2c3d4e5f7
Create Date: 2026-06-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f8a9'
down_revision: Union[str, None] = 'a1b2c3d4e5f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block; commit the
    # migration's implicit transaction first (mirrors the CODE-type migration).
    op.execute("COMMIT")
    op.execute("ALTER TYPE assignmenttasktypeenum ADD VALUE IF NOT EXISTS 'CUSTOM'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values directly.
    pass
