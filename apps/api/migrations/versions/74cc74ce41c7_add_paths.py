"""Add learning paths

An org-curated, ordered sequence of courses with its own certificate.

Revision ID: 74cc74ce41c7
Revises: f2a3b4c5d6e7
Create Date: 2026-11-02 12:00:00.000000

The models are also created by ``SQLModel.metadata.create_all`` on fresh
installs, so every step is guarded.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = '74cc74ce41c7'
down_revision: Union[str, None] = 'f2a3b4c5d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
    if not _has('path'):
        op.create_table(
            'path',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('path_uuid', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('description', sqlmodel.sql.sqltypes.AutoString(), nullable=True, server_default=''),
            sa.Column('about', sqlmodel.sql.sqltypes.AutoString(), nullable=True, server_default=''),
            sa.Column('thumbnail_image', sqlmodel.sql.sqltypes.AutoString(), nullable=True, server_default=''),
            sa.Column('level', sqlmodel.sql.sqltypes.AutoString(), nullable=True, server_default=''),
            sa.Column('public', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('published', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('sequential', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('electives_required', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('certificate_enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('certificate_config', sa.JSON(), nullable=True),
            sa.Column('creation_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('update_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
        )
        op.create_index('ix_path_org_id', 'path', ['org_id'])
        op.create_index('ix_path_path_uuid', 'path', ['path_uuid'])

    if not _has('pathcourse'):
        op.create_table(
            'pathcourse',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('path_id', sa.Integer(), sa.ForeignKey('path.id', ondelete='CASCADE'), nullable=False),
            sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=False),
            sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('required', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('creation_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.UniqueConstraint('path_id', 'course_id', name='uq_pathcourse_path_course'),
        )
        op.create_index('ix_pathcourse_path_id', 'pathcourse', ['path_id'])
        op.create_index('ix_pathcourse_course_id', 'pathcourse', ['course_id'])

    if not _has('pathenrollment'):
        op.create_table(
            'pathenrollment',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('path_id', sa.Integer(), sa.ForeignKey('path.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('enrolled_at', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('completed_at', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
            sa.UniqueConstraint('path_id', 'user_id', name='uq_pathenrollment_path_user'),
        )
        op.create_index('ix_pathenrollment_path_id', 'pathenrollment', ['path_id'])
        op.create_index('ix_pathenrollment_user_id', 'pathenrollment', ['user_id'])

    if not _has('pathcertificate'):
        op.create_table(
            'pathcertificate',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('path_id', sa.Integer(), sa.ForeignKey('path.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('certificate_uuid', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('created_at', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.UniqueConstraint('path_id', 'user_id', name='uq_pathcertificate_path_user'),
        )
        op.create_index('ix_pathcertificate_path_id', 'pathcertificate', ['path_id'])
        op.create_index('ix_pathcertificate_user_id', 'pathcertificate', ['user_id'])
        op.create_index('ix_pathcertificate_certificate_uuid', 'pathcertificate', ['certificate_uuid'], unique=True)


def downgrade() -> None:
    for table in ('pathcertificate', 'pathenrollment', 'pathcourse', 'path'):
        if _has(table):
            op.drop_table(table)
