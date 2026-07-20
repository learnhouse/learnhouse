"""Add pass_threshold_percentage to assignment

Adds a nullable float ``pass_threshold_percentage`` column (0-100) to
``assignment``. When set it overrides the grading-type default passing line
(50 for NUMERIC/PERCENTAGE/PASS_FAIL, 60 for ALPHABET/GPA_SCALE). Left NULL by
default so every existing assignment keeps its legacy behavior exactly.

Revision ID: e7f8a9b0c1d2
Revises: b2c3d4e5f8a9
Create Date: 2026-07-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'e7f8a9b0c1d2'
down_revision: Union[str, None] = 'b2c3d4e5f8a9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'assignment' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('assignment')}
    if 'pass_threshold_percentage' in existing_columns:
        return

    op.add_column(
        'assignment',
        sa.Column(
            'pass_threshold_percentage',
            sa.Float(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'assignment' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('assignment')}
    if 'pass_threshold_percentage' in existing_columns:
        op.drop_column('assignment', 'pass_threshold_percentage')
