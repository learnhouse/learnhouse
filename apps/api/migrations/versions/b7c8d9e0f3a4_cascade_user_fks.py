"""Add ON DELETE CASCADE to user foreign keys

Adds ``ON DELETE CASCADE`` to three foreign keys that reference ``user.id``
but had no ondelete behavior: ``userorganization.user_id``,
``apitoken.created_by_user_id``, and ``webhook_endpoint.created_by_user_id``.

Without cascade, deleting a user directly in the DB (e.g. via the admin UI
or raw SQL) fails with a FK constraint violation once any of these rows
exist. The app-level ``delete_user_by_id`` previously worked around this by
manually deleting userorganization rows, but that path doesn't cover the
other two tables and doesn't apply to non-app deletions.

Revision ID: b7c8d9e0f3a4
Revises: a6b7c8d9e0f2
Create Date: 2026-04-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


revision: str = 'b7c8d9e0f3a4'
down_revision: Union[str, None] = 'a6b7c8d9e0f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (table, column, default constraint name)
FK_TARGETS = [
    ("userorganization", "user_id", "userorganization_user_id_fkey"),
    ("apitoken", "created_by_user_id", "apitoken_created_by_user_id_fkey"),
    ("webhook_endpoint", "created_by_user_id", "webhook_endpoint_created_by_user_id_fkey"),
]


def _find_user_fk(inspector, table, column):
    for fk in inspector.get_foreign_keys(table):
        cols = fk.get("constrained_columns") or []
        if column in cols and fk.get("referred_table") == "user":
            return fk
    return None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    for table, column, default_name in FK_TARGETS:
        if table not in existing_tables:
            continue

        fk = _find_user_fk(inspector, table, column)
        if fk is None:
            continue

        options = fk.get("options") or {}
        if (options.get("ondelete") or "").upper() == "CASCADE":
            continue

        fk_name = fk.get("name") or default_name

        op.drop_constraint(fk_name, table, type_="foreignkey")
        op.create_foreign_key(
            fk_name,
            table,
            "user",
            [column],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    for table, column, default_name in FK_TARGETS:
        if table not in existing_tables:
            continue

        fk = _find_user_fk(inspector, table, column)
        if fk is None:
            continue

        options = fk.get("options") or {}
        if not (options.get("ondelete") or ""):
            continue

        fk_name = fk.get("name") or default_name

        op.drop_constraint(fk_name, table, type_="foreignkey")
        op.create_foreign_key(
            fk_name,
            table,
            "user",
            [column],
            ["id"],
        )
