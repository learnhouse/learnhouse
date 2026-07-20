"""Add unique constraint on certificateuser (user_id, certification_id)

A user may hold at most one certificate per certification. Without a DB-level
constraint, two concurrent course-completion checks (the assignment submit path
and a parallel grade) could each pass the "already exists?" SELECT and both
INSERT, creating duplicate certificate rows.

This migration first de-duplicates any existing rows (keeping the lowest id per
(user_id, certification_id)) and then adds the unique constraint. Both steps are
idempotent/guarded so a partially-applied or already-patched database is safe.

Revision ID: f1a2b3c4d5e6
Revises: e7f8a9b0c1d2
Create Date: 2026-07-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = 'e7f8a9b0c1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONSTRAINT_NAME = 'uq_certificateuser_user_certification'
TABLE = 'certificateuser'


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if TABLE not in inspector.get_table_names():
        return

    existing = {uc['name'] for uc in inspector.get_unique_constraints(TABLE)}
    if CONSTRAINT_NAME in existing:
        return

    # De-duplicate before adding the constraint: keep the earliest (lowest id)
    # certificate per (user_id, certification_id), delete the rest.
    op.execute(
        sa.text(
            f"""
            DELETE FROM {TABLE} a
            USING {TABLE} b
            WHERE a.user_id = b.user_id
              AND a.certification_id = b.certification_id
              AND a.id > b.id
            """
        )
    )

    op.create_unique_constraint(
        CONSTRAINT_NAME, TABLE, ['user_id', 'certification_id']
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if TABLE not in inspector.get_table_names():
        return

    existing = {uc['name'] for uc in inspector.get_unique_constraints(TABLE)}
    if CONSTRAINT_NAME in existing:
        op.drop_constraint(CONSTRAINT_NAME, TABLE, type_='unique')
