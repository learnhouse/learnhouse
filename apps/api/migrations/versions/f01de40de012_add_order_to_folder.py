"""Add order column to folder (manual library ordering)

Adds an integer `order` column to the `folder` table backing admin drag-and-drop
ordering of sibling folders in the library. Only consulted when the org's
folders.sort_mode == "manual"; the other sort modes order by name/creation_date
and ignore it. Idempotent so re-running on partially-migrated DBs is safe.

The `folder` table itself is created in f7a8b9c0d1e2 (folders + media). This
revision chains onto the current single head (b7c8d9e0f1a2) so it does not
create a second Alembic head.

Revision ID: f01de40de012
Revises: b7c8d9e0f1a2
Create Date: 2026-06-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'f01de40de012'
down_revision: Union[str, None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'folder' not in set(inspector.get_table_names()):
        return
    columns = {c['name'] for c in inspector.get_columns('folder')}
    if 'order' not in columns:
        op.add_column(
            'folder',
            sa.Column('order', sa.Integer(), nullable=False, server_default='0'),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'folder' not in set(inspector.get_table_names()):
        return
    columns = {c['name'] for c in inspector.get_columns('folder')}
    if 'order' in columns:
        op.drop_column('folder', 'order')
