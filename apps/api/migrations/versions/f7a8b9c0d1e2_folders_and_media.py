"""Introduce folders + media, drop collections

Replaces the flat "collections" feature with a filesystem-like "folders" model
(nestable via parent_folder_id, holding any resource by uuid in foldercontent)
plus a new standalone "media" resource. The legacy collection / collectioncourse
tables are dropped.

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-06-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, None] = 'e6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # ── folder ──────────────────────────────────────────────────────────
    if 'folder' not in tables:
        op.create_table(
            'folder',
            sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
            sa.Column('org_id', sa.BigInteger(), nullable=False),
            sa.Column('folder_uuid', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('parent_folder_id', sa.Integer(), nullable=True),
            sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('public', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('description', sqlmodel.sql.sqltypes.AutoString(), nullable=True, server_default=''),
            sa.Column('thumbnail_image', sqlmodel.sql.sqltypes.AutoString(), nullable=True, server_default=''),
            sa.Column('creation_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('update_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['parent_folder_id'], ['folder.id'], ondelete='CASCADE'),
        )
        op.create_index('ix_folder_folder_uuid', 'folder', ['folder_uuid'])
        op.create_index('ix_folder_org_id', 'folder', ['org_id'])
        op.create_index('ix_folder_parent_folder_id', 'folder', ['parent_folder_id'])

    # ── foldercontent ───────────────────────────────────────────────────
    if 'foldercontent' not in tables:
        op.create_table(
            'foldercontent',
            sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
            sa.Column('folder_id', sa.Integer(), nullable=True),
            sa.Column('resource_uuid', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('org_id', sa.Integer(), nullable=False),
            sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('creation_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('update_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.ForeignKeyConstraint(['folder_id'], ['folder.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
            sa.UniqueConstraint('folder_id', 'resource_uuid', name='uq_foldercontent_folder_resource'),
        )
        op.create_index('ix_foldercontent_folder_id', 'foldercontent', ['folder_id'])
        op.create_index('ix_foldercontent_resource_uuid', 'foldercontent', ['resource_uuid'])

    # ── media ───────────────────────────────────────────────────────────
    if 'media' not in tables:
        op.create_table(
            'media',
            sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
            sa.Column('org_id', sa.BigInteger(), nullable=False),
            sa.Column('media_uuid', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('description', sqlmodel.sql.sqltypes.AutoString(), nullable=True, server_default=''),
            sa.Column('media_type', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default='UPLOAD'),
            sa.Column('file_id', sqlmodel.sql.sqltypes.AutoString(), nullable=True, server_default=''),
            sa.Column('file_format', sqlmodel.sql.sqltypes.AutoString(), nullable=True, server_default=''),
            sa.Column('file_size', sa.Integer(), nullable=True),
            sa.Column('file_mime', sqlmodel.sql.sqltypes.AutoString(), nullable=True, server_default=''),
            sa.Column('url', sqlmodel.sql.sqltypes.AutoString(), nullable=True, server_default=''),
            sa.Column('thumbnail_image', sqlmodel.sql.sqltypes.AutoString(), nullable=True, server_default=''),
            sa.Column('public', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('creation_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('update_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
        )
        op.create_index('ix_media_media_uuid', 'media', ['media_uuid'])
        op.create_index('ix_media_org_id', 'media', ['org_id'])

    # ── drop legacy collections ─────────────────────────────────────────
    if 'collectioncourse' in tables:
        op.drop_table('collectioncourse')
    if 'collection' in tables:
        op.drop_table('collection')


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # Recreate legacy collection tables (minimal shape)
    if 'collection' not in tables:
        op.create_table(
            'collection',
            sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
            sa.Column('org_id', sa.BigInteger(), nullable=False),
            sa.Column('collection_uuid', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('public', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('description', sqlmodel.sql.sqltypes.AutoString(), nullable=True, server_default=''),
            sa.Column('creation_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('update_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
        )
    if 'collectioncourse' not in tables:
        op.create_table(
            'collectioncourse',
            sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
            sa.Column('collection_id', sa.Integer(), nullable=False),
            sa.Column('course_id', sa.Integer(), nullable=False),
            sa.Column('org_id', sa.Integer(), nullable=False),
            sa.Column('creation_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('update_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.ForeignKeyConstraint(['collection_id'], ['collection.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['course_id'], ['course.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
        )

    for tbl in ('foldercontent', 'media', 'folder'):
        if tbl in tables:
            op.drop_table(tbl)
