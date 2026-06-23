"""Secure media: storage_key column + mediasharetoken table

Adds `media.storage_key` (randomized, server-only storage path for uploads) and a
`mediasharetoken` table backing random, unique, revocable copy links. Both are
idempotent so re-running on partially-migrated DBs is safe.

Revision ID: 5e3a9c7f1b2d
Revises: d4e5f6a7b8c9
Create Date: 2026-06-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = '5e3a9c7f1b2d'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # media.storage_key (idempotent)
    if 'media' in tables:
        cols = {c['name'] for c in inspector.get_columns('media')}
        if 'storage_key' not in cols:
            op.add_column(
                'media',
                sa.Column(
                    'storage_key',
                    sqlmodel.sql.sqltypes.AutoString(),
                    nullable=True,
                    server_default='',
                ),
            )

    # mediasharetoken table (idempotent)
    if 'mediasharetoken' not in tables:
        op.create_table(
            'mediasharetoken',
            sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
            sa.Column('token', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('media_uuid', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('org_id', sa.BigInteger(), nullable=False),
            sa.Column('created_by_user_id', sa.Integer(), nullable=True),
            sa.Column('revoked', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('creation_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('update_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
        )
        op.create_index('ix_mediasharetoken_token', 'mediasharetoken', ['token'])
        op.create_index('ix_mediasharetoken_media_uuid', 'mediasharetoken', ['media_uuid'])
        op.create_index('ix_mediasharetoken_org_id', 'mediasharetoken', ['org_id'])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'mediasharetoken' in tables:
        op.drop_table('mediasharetoken')
    if 'media' in tables:
        cols = {c['name'] for c in inspector.get_columns('media')}
        if 'storage_key' in cols:
            op.drop_column('media', 'storage_key')
