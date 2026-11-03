"""Add indexes for hot read paths that only existed on the models

The models declare these indexes, so a database built by ``create_all`` has
them, but no migration ever created them. Databases that grew through
migrations can therefore be missing them, and the lookups they serve run on
every lesson read:

- ``chapteractivity.activity_id``: finding a lesson's chapter (lock and drip
  checks, completion, content files). The unique ``(chapter_id, activity_id)``
  index leads with ``chapter_id`` and doesn't help.
- ``organizationconfig.org_id``: the org config read on almost every request.
- ``userorganization (user_id, org_id)``: membership, role and admin checks.
- ``trail (user_id, org_id)``: the learner's trail on every progress read.

An index is only created when no existing index already starts with the same
columns, whatever its name, so databases that were indexed by hand don't get
a duplicate.

Revision ID: e4f7a2c9b1d3
Revises: a1l2v3s4e5s6
Create Date: 2026-11-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e4f7a2c9b1d3'
down_revision: Union[str, None] = 'a1l2v3s4e5s6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (index name as declared on the model, table, columns)
HOT_PATH_INDEXES = (
    ("ix_chapteractivity_activity_id", "chapteractivity", ["activity_id"]),
    ("ix_organizationconfig_org_id", "organizationconfig", ["org_id"]),
    ("ix_userorg_user_org", "userorganization", ["user_id", "org_id"]),
    ("ix_trail_user_org", "trail", ["user_id", "org_id"]),
)


def _covered(inspector, table: str, columns: list[str]) -> bool:
    """True if some index (or unique constraint) on ``table`` leads with ``columns``."""
    existing = [ix["column_names"] for ix in inspector.get_indexes(table)]
    existing += [uq["column_names"] for uq in inspector.get_unique_constraints(table)]
    pk = inspector.get_pk_constraint(table).get("constrained_columns") or []
    if pk:
        existing.append(pk)
    return any(list(cols[: len(columns)]) == columns for cols in existing)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    for name, table, columns in HOT_PATH_INDEXES:
        if table not in tables or _covered(inspector, table, columns):
            continue
        op.create_index(name, table, columns)


def downgrade() -> None:
    # Left in place on purpose: a database built by create_all has the same
    # indexes under the same names, and dropping them there would remove
    # indexes this migration never created.
    pass
