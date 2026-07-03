"""Merge the secure-media and drop-collections branches

`5e3a9c7f1b2d` (secure media: storage_key + mediasharetoken) and `d4e5f6a7b8c9`
(drop legacy collections) both branch off `f7a8b9c0d1e2`. This is a no-op merge
node so the history has a single head.

Why the split: the secure-media schema is decoupled from the *destructive*
collections drop so production can apply ONLY the secure-media migration
(`alembic upgrade 5e3a9c7f1b2d`) without dropping any collections. `alembic
upgrade head` applies both plus this merge.

Revision ID: 7f2b9d1c3e4a
Revises: 5e3a9c7f1b2d, d4e5f6a7b8c9
Create Date: 2026-06-23

"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = '7f2b9d1c3e4a'
down_revision: Union[str, Sequence[str], None] = ('5e3a9c7f1b2d', 'd4e5f6a7b8c9')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
