"""Widen apitoken.token_hash + superadmin_apitoken.token_hash to 255

The hash scheme for API tokens was changed from SHA-256 hex (64 chars)
to argon2id (~97 chars) without a matching schema migration, so inserts
of new tokens fail with::

    StringDataRightTruncationError: value too long for type character varying(64)

This migration widens both columns to ``VARCHAR(255)`` and aligns the
indexes with the new lookup path, which is by ``token_prefix`` rather
than the full hash. The legacy ``ix_*_token_hash`` indexes are no longer
useful (full-hash equality matching only worked for the old SHA-256
scheme) and are dropped if present.

Revision ID: a8b9c0d1e2f3
Revises: z5a6b7c8d9e0
Create Date: 2026-05-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


revision: str = 'a8b9c0d1e2f3'
down_revision: Union[str, None] = 'z5a6b7c8d9e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TARGETS = [
    {
        "table": "apitoken",
        "old_hash_index": "ix_apitoken_token_hash",
        "new_prefix_index": "ix_apitoken_token_prefix",
    },
    {
        "table": "superadmin_apitoken",
        "old_hash_index": "ix_superadmin_apitoken_token_hash",
        "new_prefix_index": "ix_superadmin_apitoken_token_prefix",
    },
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    for t in TARGETS:
        table = t["table"]
        if table not in existing_tables:
            continue

        columns = {c["name"]: c for c in inspector.get_columns(table)}
        if "token_hash" in columns:
            op.alter_column(
                table,
                "token_hash",
                existing_type=sa.String(length=64),
                type_=sa.String(length=255),
                existing_nullable=columns["token_hash"].get("nullable", True),
            )

        existing_indexes = {ix["name"] for ix in inspector.get_indexes(table)}

        if t["old_hash_index"] in existing_indexes:
            op.drop_index(t["old_hash_index"], table_name=table)

        if "token_prefix" in columns and t["new_prefix_index"] not in existing_indexes:
            op.create_index(
                t["new_prefix_index"],
                table,
                ["token_prefix"],
                unique=False,
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    for t in TARGETS:
        table = t["table"]
        if table not in existing_tables:
            continue

        existing_indexes = {ix["name"] for ix in inspector.get_indexes(table)}
        columns = {c["name"]: c for c in inspector.get_columns(table)}

        if t["new_prefix_index"] in existing_indexes:
            op.drop_index(t["new_prefix_index"], table_name=table)

        if "token_hash" in columns and t["old_hash_index"] not in existing_indexes:
            op.create_index(
                t["old_hash_index"],
                table,
                ["token_hash"],
                unique=False,
            )

        if "token_hash" in columns:
            op.alter_column(
                table,
                "token_hash",
                existing_type=sa.String(length=255),
                type_=sa.String(length=64),
                existing_nullable=columns["token_hash"].get("nullable", True),
            )
