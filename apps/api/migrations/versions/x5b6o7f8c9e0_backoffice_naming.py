"""Backoffice naming for the platform staff flag and its API tokens

The platform console is now LearnHouse Backoffice. Renames the old
"superadmin" schema names to match:

- ``user.is_superadmin`` -> ``user.is_backoffice_staff``
- table ``superadmin_apitoken`` -> ``backoffice_apitoken`` with its indexes,
  primary key and id sequence

Postgres carries foreign keys (``platform_token_policy.token_id``) across a
table rename, so nothing else changes. Index, constraint and sequence renames
use IF EXISTS: their names drifted between installs (``a8b9c0d1e2f3`` swapped
the hash index for a prefix index).

Revision ID: x5b6o7f8c9e0
Revises: w4i5n6v7t8s9
Create Date: 2026-11-18 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = "x5b6o7f8c9e0"
down_revision: Union[str, None] = "w4i5n6v7t8s9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_TABLE = "superadmin_apitoken"
_NEW_TABLE = "backoffice_apitoken"
_OLD_COLUMN = "is_superadmin"
_NEW_COLUMN = "is_backoffice_staff"

# (old, new) names of objects that follow the table name.
_INDEXES = [
    ("ix_superadmin_apitoken_token_prefix", "ix_backoffice_apitoken_token_prefix"),
    ("ix_superadmin_apitoken_token_hash", "ix_backoffice_apitoken_token_hash"),
    ("ix_superadmin_apitoken_created_by", "ix_backoffice_apitoken_created_by"),
    ("superadmin_apitoken_pkey", "backoffice_apitoken_pkey"),
]
_SEQUENCES = [("superadmin_apitoken_id_seq", "backoffice_apitoken_id_seq")]
_CONSTRAINTS = [
    ("superadmin_apitoken_created_by_user_id_fkey", "backoffice_apitoken_created_by_user_id_fkey"),
]


def _rename(old_table: str, new_table: str, old_column: str, new_column: str, pairs_forward: bool) -> None:
    op.alter_column("user", old_column, new_column_name=new_column)
    op.rename_table(old_table, new_table)
    for old, new in _INDEXES:
        src, dst = (old, new) if pairs_forward else (new, old)
        op.execute(f'ALTER INDEX IF EXISTS "{src}" RENAME TO "{dst}"')
    for old, new in _SEQUENCES:
        src, dst = (old, new) if pairs_forward else (new, old)
        op.execute(f'ALTER SEQUENCE IF EXISTS "{src}" RENAME TO "{dst}"')
    for old, new in _CONSTRAINTS:
        src, dst = (old, new) if pairs_forward else (new, old)
        op.execute(
            "DO $$ BEGIN "
            f"IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{src}') THEN "
            f'ALTER TABLE "{new_table}" RENAME CONSTRAINT "{src}" TO "{dst}"; '
            "END IF; END $$"
        )


def upgrade() -> None:
    _rename(_OLD_TABLE, _NEW_TABLE, _OLD_COLUMN, _NEW_COLUMN, pairs_forward=True)


def downgrade() -> None:
    _rename(_NEW_TABLE, _OLD_TABLE, _NEW_COLUMN, _OLD_COLUMN, pairs_forward=False)
