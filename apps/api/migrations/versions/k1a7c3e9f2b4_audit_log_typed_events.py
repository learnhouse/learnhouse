"""Typed audit log events: actor/target snapshots, outcome, diff, retention

- ``auditlog``: new nullable columns for typed events (category, outcome,
  reason, via, actor and target snapshots, a field-level ``changes`` diff,
  ``details``, ``user_agent``, ``request_id``). ``method``, ``path`` and
  ``status_code`` become nullable: entries that don't come from an HTTP
  request (sign-in failures, Atlas, background jobs) have none. Existing rows
  keep their values and read as untyped "request" entries.
- Indexes for what the log page filters on: org + time, actor, target,
  action, category and the request id that links related entries. Built
  concurrently after the migration commits when the app runs it.
- ``auditlogsetting``: per-org retention.

The ``auditlog`` table is an EE model created by ``create_all``; every step
checks what exists, so a database without it (or already matching the
models) is left alone.

Revision ID: k1a7c3e9f2b4
Revises: j9f4b6c8d2e5
Create Date: 2026-11-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'k1a7c3e9f2b4'
down_revision: Union[str, None] = 'j9f4b6c8d2e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


NEW_COLUMNS = (
    ("category", sa.String(32)),
    ("outcome", sa.String(16)),
    ("reason", sa.String(255)),
    ("via", sa.String(16)),
    ("actor_name", sa.String(255)),
    ("actor_email", sa.String(255)),
    ("actor_role", sa.String(255)),
    ("target_type", sa.String(64)),
    ("target_id", sa.String(255)),
    ("target_name", sa.String(255)),
    ("changes", sa.JSON()),
    ("details", sa.JSON()),
    ("user_agent", sa.Text()),
    ("request_id", sa.String(64)),
)

# (index name as declared on the model, columns)
INDEXES = (
    ("ix_auditlog_org_created", ["org_id", "created_at"]),
    ("ix_auditlog_org_user_created", ["org_id", "user_id", "created_at"]),
    ("ix_auditlog_org_target", ["org_id", "target_type", "target_id"]),
    ("ix_auditlog_org_action", ["org_id", "action"]),
    ("ix_auditlog_org_category_created", ["org_id", "category", "created_at"]),
    ("ix_auditlog_request_id", ["request_id"]),
)


def _covered(inspector, table: str, columns: list[str]) -> bool:
    existing = [ix["column_names"] for ix in inspector.get_indexes(table)]
    return any(list(cols[: len(columns)]) == columns for cols in existing)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "auditlog" in tables:
        columns = {c["name"]: c for c in inspector.get_columns("auditlog")}
        for name, type_ in NEW_COLUMNS:
            if name not in columns:
                op.add_column("auditlog", sa.Column(name, type_, nullable=True))
        for name, type_ in (("method", sa.String()), ("path", sa.String()), ("status_code", sa.Integer())):
            if name in columns and not columns[name].get("nullable", True):
                op.alter_column("auditlog", name, existing_type=type_, nullable=True)

        deferred = op.get_context().config.attributes.get("deferred_indexes")
        if bind.dialect.name != "postgresql":
            deferred = None
        for name, cols in INDEXES:
            if _covered(inspector, "auditlog", cols):
                continue
            if deferred is not None:
                deferred.append((name, "auditlog", cols))
            else:
                op.create_index(name, "auditlog", cols)

    if "auditlogsetting" not in tables and "organization" in tables:
        op.create_table(
            "auditlogsetting",
            sa.Column(
                "org_id", sa.Integer(),
                sa.ForeignKey("organization.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("retention_days", sa.Integer(), nullable=False, server_default="365"),
            sa.Column(
                "updated_by", sa.Integer(),
                sa.ForeignKey("user.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "auditlogsetting" in tables:
        op.drop_table("auditlogsetting")

    if "auditlog" in tables:
        indexes = {ix["name"] for ix in inspector.get_indexes("auditlog")}
        for name, _cols in INDEXES:
            if name in indexes:
                op.drop_index(name, table_name="auditlog")
        columns = {c["name"] for c in inspector.get_columns("auditlog")}
        for name, _type in NEW_COLUMNS:
            if name in columns:
                op.drop_column("auditlog", name)
        # method/path/status_code stay nullable: rows written since may lack them.
