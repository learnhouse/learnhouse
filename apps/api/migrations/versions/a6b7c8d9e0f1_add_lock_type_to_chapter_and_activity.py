"""Add lock_type to chapter and activity

Adds a ``lock_type`` column (native PG enum) to ``chapter`` and ``activity``
that defaults to ``PUBLIC``. Values mirror the Playground access tiers:
``PUBLIC`` (anyone), ``AUTHENTICATED`` (signed-in only), ``RESTRICTED``
(usergroup membership required — reuses the existing ``usergroupresource``
table keyed by chapter_uuid/activity_uuid).

Revision ID: a6b7c8d9e0f1
Revises: z5a6b7c8d9e0
Create Date: 2026-04-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


revision: str = 'a6b7c8d9e0f1'
down_revision: Union[str, None] = 'z5a6b7c8d9e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(inspector, table: str, column: str) -> bool:
    return column in {col['name'] for col in inspector.get_columns(table)}


def _column_type(inspector, table: str, column: str) -> str | None:
    for col in inspector.get_columns(table):
        if col['name'] == column:
            return str(col['type']).lower()
    return None


def _ensure_enum(bind, name: str) -> None:
    # Idempotent create of the PG enum used by the ORM. SQLModel would otherwise
    # auto-create this on first connect, but doing it here keeps the schema in
    # sync with the migration and lets us ALTER COLUMN TYPE to it explicitly.
    bind.exec_driver_sql(
        f"""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '{name}') THEN
                CREATE TYPE {name} AS ENUM ('PUBLIC', 'AUTHENTICATED', 'RESTRICTED');
            END IF;
        END $$;
        """
    )


def _install_lock_column(bind, table: str, enum_name: str) -> None:
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if table not in tables:
        return

    _ensure_enum(bind, enum_name)

    if not _has_column(inspector, table, 'lock_type'):
        bind.exec_driver_sql(
            f"ALTER TABLE {table} ADD COLUMN lock_type {enum_name} NOT NULL DEFAULT 'PUBLIC'"
        )
        return

    # Column exists. If it's already the enum type, we're done.
    current = _column_type(inspector, table, 'lock_type')
    if current and enum_name in current:
        return

    # Existing column is VARCHAR (from an earlier partial run) — coerce any
    # lowercase values to the enum's uppercase labels, then swap the type.
    bind.exec_driver_sql(f"UPDATE {table} SET lock_type = UPPER(lock_type)")
    bind.exec_driver_sql(f"ALTER TABLE {table} ALTER COLUMN lock_type DROP DEFAULT")
    bind.exec_driver_sql(
        f"ALTER TABLE {table} ALTER COLUMN lock_type TYPE {enum_name} USING lock_type::{enum_name}"
    )
    bind.exec_driver_sql(
        f"ALTER TABLE {table} ALTER COLUMN lock_type SET DEFAULT 'PUBLIC'"
    )
    bind.exec_driver_sql(f"ALTER TABLE {table} ALTER COLUMN lock_type SET NOT NULL")


def upgrade() -> None:
    bind = op.get_bind()
    _install_lock_column(bind, 'chapter', 'locktype')
    _install_lock_column(bind, 'activity', 'activitylocktype')


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'activity' in tables and _has_column(inspector, 'activity', 'lock_type'):
        op.drop_column('activity', 'lock_type')

    if 'chapter' in tables and _has_column(inspector, 'chapter', 'lock_type'):
        op.drop_column('chapter', 'lock_type')

    bind.exec_driver_sql("DROP TYPE IF EXISTS locktype")
    bind.exec_driver_sql("DROP TYPE IF EXISTS activitylocktype")
