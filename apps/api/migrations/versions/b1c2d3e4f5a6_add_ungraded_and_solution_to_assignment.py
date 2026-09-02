"""Add formative (ungraded) mode and the model answer to assignment

Adds four nullable columns to ``assignment``:

- ``ungraded``        : formative mode. No grade is ever computed or shown; a
                        submission stays SUBMITTED instead of becoming GRADED.
- ``solution``        : free-text model answer (the "corrigé").
- ``solution_file``   : on-disk name of an uploaded corrigé document.
- ``solution_reveal`` : NEVER / ON_SUBMISSION / AFTER_GRADING — when the two
                        fields above become readable by a learner.

All default to the pre-existing behavior (no formative mode, no corrigé, never
revealed), so existing assignments are unchanged.

``solution_reveal`` is a native enum to match how ``create_all`` builds the same
column (``gradingtypeenum`` next to it is one too). Creating it as plain text
here would leave migrated databases with a different column type from freshly
created ones.

Revision ID: b1c2d3e4f5a6
Revises: a2b3c4d5e6f7
Create Date: 2026-09-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SOLUTION_REVEAL_ENUM = sa.Enum(
    'NEVER', 'ON_SUBMISSION', 'AFTER_GRADING', name='solutionrevealenum'
)

# (column name, factory). Kept as data so upgrade/downgrade stay in sync.
_NEW_COLUMNS = (
    (
        'ungraded',
        lambda: sa.Column('ungraded', sa.Boolean(), nullable=True, server_default=sa.false()),
    ),
    ('solution', lambda: sa.Column('solution', sa.String(), nullable=True)),
    ('solution_file', lambda: sa.Column('solution_file', sa.String(), nullable=True)),
    (
        'solution_reveal',
        lambda: sa.Column(
            'solution_reveal',
            SOLUTION_REVEAL_ENUM,
            nullable=True,
            server_default='NEVER',
        ),
    ),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'assignment' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('assignment')}
    if 'solution_reveal' not in existing_columns:
        # No-op on SQLite, where sa.Enum is rendered as VARCHAR + CHECK.
        SOLUTION_REVEAL_ENUM.create(bind, checkfirst=True)
    for name, make_column in _NEW_COLUMNS:
        if name not in existing_columns:
            op.add_column('assignment', make_column())


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'assignment' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('assignment')}
    dropped_reveal = False
    for name, _ in reversed(_NEW_COLUMNS):
        if name in existing_columns:
            op.drop_column('assignment', name)
            dropped_reveal = dropped_reveal or name == 'solution_reveal'
    if dropped_reveal:
        SOLUTION_REVEAL_ENUM.drop(bind, checkfirst=True)
