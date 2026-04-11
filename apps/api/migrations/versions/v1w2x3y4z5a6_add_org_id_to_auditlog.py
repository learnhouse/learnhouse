"""Add org_id to auditlog

Revision ID: v1w2x3y4z5a6
Revises: u0v1w2x3y4z5
Create Date: 2026-04-11 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 'v1w2x3y4z5a6'
down_revision: Union[str, None] = 'u0v1w2x3y4z5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Only attempt to modify the table if it exists — the auditlog table is
    # created lazily via SQLModel.metadata.create_all() on app startup, so a
    # fresh DB will already have the column and should skip this migration.
    if 'auditlog' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('auditlog')}
    if 'org_id' not in existing_columns:
        op.add_column(
            'auditlog',
            sa.Column('org_id', sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            'auditlog_org_id_fkey',
            'auditlog',
            'organization',
            ['org_id'],
            ['id'],
            ondelete='SET NULL',
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'auditlog' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('auditlog')}
    if 'org_id' in existing_columns:
        try:
            op.drop_constraint('auditlog_org_id_fkey', 'auditlog', type_='foreignkey')
        except Exception:
            pass
        op.drop_column('auditlog', 'org_id')
