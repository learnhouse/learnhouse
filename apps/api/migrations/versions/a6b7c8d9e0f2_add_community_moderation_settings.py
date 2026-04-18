"""Add moderation_settings JSON field to community

Adds a nullable ``moderation_settings`` JSON column that defaults to an
empty object. Stores community-level moderation rules beyond the blocked
word list: block_links, min_post_length, max_post_length, max_comment_length.

Revision ID: a6b7c8d9e0f2
Revises: a6b7c8d9e0f1
Create Date: 2026-04-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


revision: str = 'a6b7c8d9e0f2'
down_revision: Union[str, None] = 'a6b7c8d9e0f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'community' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('community')}
    if 'moderation_settings' in existing_columns:
        return

    op.add_column(
        'community',
        sa.Column(
            'moderation_settings',
            sa.JSON(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'community' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('community')}
    if 'moderation_settings' in existing_columns:
        op.drop_column('community', 'moderation_settings')
