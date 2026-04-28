"""Add is_archived flag to course

Adds a non-nullable boolean ``is_archived`` column to ``course`` that
defaults to false. When true, the course rejects new enrollments and is
hidden from default course listings (visible to admins via the
``include_archived=true`` query parameter).

Existing courses are migrated to ``is_archived=false`` via the server
default, so the change is backwards-compatible.

Revision ID: a6b7c8d9e0f1
Revises: z5a6b7c8d9e0
Create Date: 2026-04-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'a6b7c8d9e0f1'
down_revision: Union[str, None] = 'z5a6b7c8d9e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'course' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('course')}
    if 'is_archived' in existing_columns:
        return

    op.add_column(
        'course',
        sa.Column(
            'is_archived',
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'course' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('course')}
    if 'is_archived' in existing_columns:
        op.drop_column('course', 'is_archived')
