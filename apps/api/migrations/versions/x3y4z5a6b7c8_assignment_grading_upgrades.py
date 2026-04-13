"""Assignment grading upgrades

Adds everything introduced by the grading refactor in one shot:

1. Two new values in the gradingtypeenum enum: PASS_FAIL, GPA_SCALE
2. assignmentusersubmission.overall_feedback: nullable TEXT column for
   instructor overall notes
3. assignment.auto_grading: nullable BOOL column, defaults to false — when
   true and all tasks are auto-gradable, submissions are graded automatically
4. assignment.anti_copy_paste: nullable BOOL column, defaults to false — when
   true, student-facing task views block paste events
5. Two new values in the assignmenttasktypeenum enum: SHORT_ANSWER,
   NUMBER_ANSWER — auto-gradable text / numeric task types

Revision ID: x3y4z5a6b7c8
Revises: w2x3y4z5a6b7
Create Date: 2026-04-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'x3y4z5a6b7c8'
down_revision: Union[str, None] = 'w2x3y4z5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Enum additions ---------------------------------------------------
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block in
    # Postgres. Alembic wraps every migration in a transaction, so we commit
    # first and rely on IF NOT EXISTS to make every ALTER idempotent — this
    # lets the migration be re-run safely on databases that already have
    # some of these enum values.
    op.execute("COMMIT")
    op.execute("ALTER TYPE gradingtypeenum ADD VALUE IF NOT EXISTS 'PASS_FAIL'")
    op.execute("ALTER TYPE gradingtypeenum ADD VALUE IF NOT EXISTS 'GPA_SCALE'")
    op.execute("ALTER TYPE assignmenttasktypeenum ADD VALUE IF NOT EXISTS 'SHORT_ANSWER'")
    op.execute("ALTER TYPE assignmenttasktypeenum ADD VALUE IF NOT EXISTS 'NUMBER_ANSWER'")

    # --- assignmentusersubmission.overall_feedback ------------------------
    op.add_column(
        'assignmentusersubmission',
        sa.Column('overall_feedback', sa.Text(), nullable=True),
    )

    # --- assignment.auto_grading / anti_copy_paste ------------------------
    op.add_column(
        'assignment',
        sa.Column(
            'auto_grading',
            sa.Boolean(),
            nullable=True,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        'assignment',
        sa.Column(
            'anti_copy_paste',
            sa.Boolean(),
            nullable=True,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    # Drop columns in reverse order. Note: PostgreSQL does not support
    # removing enum values, so PASS_FAIL, GPA_SCALE, SHORT_ANSWER, and
    # NUMBER_ANSWER remain in their respective enums after downgrade.
    op.drop_column('assignment', 'anti_copy_paste')
    op.drop_column('assignment', 'auto_grading')
    op.drop_column('assignmentusersubmission', 'overall_feedback')
