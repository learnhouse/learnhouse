"""Impersonation sessions: store the absolute cap

Adds ``platform_impersonation_session.max_expires_at``: the latest moment a
session may last to, fixed when it starts (platform staff: 12 h by default;
an org admin's "view as": 8 h). Stored so a later configuration change can't
stretch open sessions and every API pod agrees on the cap. Existing rows are
given their start plus the default cap of their kind.

Revision ID: x5c6a7p8s9t0
Revises: w4i5n6v7t8s9
Create Date: 2026-11-18 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'x5c6a7p8s9t0'
down_revision: Union[str, None] = 'w4i5n6v7t8s9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = 'platform_impersonation_session'
COLUMN = 'max_expires_at'


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table(TABLE):
        return
    if COLUMN not in {c['name'] for c in inspector.get_columns(TABLE)}:
        op.add_column(TABLE, sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True))
    if bind.dialect.name == 'postgresql':
        op.execute(
            f"UPDATE {TABLE} SET {COLUMN} = created_at + "
            "CASE WHEN scope = 'org' THEN interval '8 hours' ELSE interval '12 hours' END "
            f"WHERE {COLUMN} IS NULL"
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(TABLE) and COLUMN in {c['name'] for c in inspector.get_columns(TABLE)}:
        op.drop_column(TABLE, COLUMN)
