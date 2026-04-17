"""Add show_correct_answers flag to assignment

Adds a nullable boolean ``show_correct_answers`` column to ``assignment``
that defaults to false. When true, the student's graded task view reveals
the correct answers (quiz right options, expected short / number answer,
form blanks). Default false keeps existing assignments opaque — teachers
must explicitly opt in.

Revision ID: z5a6b7c8d9e0
Revises: l3m4n5o6p7q8
Create Date: 2026-04-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'z5a6b7c8d9e0'
down_revision: Union[str, None] = 'l3m4n5o6p7q8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'assignment' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('assignment')}
    if 'show_correct_answers' in existing_columns:
        return

    op.add_column(
        'assignment',
        sa.Column(
            'show_correct_answers',
            sa.Boolean(),
            nullable=True,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'assignment' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('assignment')}
    if 'show_correct_answers' in existing_columns:
        op.drop_column('assignment', 'show_correct_answers')
