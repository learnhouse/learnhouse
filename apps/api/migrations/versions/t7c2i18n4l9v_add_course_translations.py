"""Add course language versions (multilingual courses)

Adds ``course.default_locale``, the ``course_translation``,
``chapter_translation``, ``activity_translation`` and
``activity_translation_collab`` tables, and ``activity_comment_thread.locale``
(comments stay per language).

Revision ID: t7c2i18n4l9v
Revises: t1a2c3r4e5d6
Create Date: 2026-11-09 22:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 't7c2i18n4l9v'
down_revision: Union[str, None] = 't1a2c3r4e5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(inspector, table: str) -> set[str]:
    return {c['name'] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'default_locale' not in _columns(inspector, 'course'):
        op.add_column('course', sa.Column('default_locale', sa.String(length=20), nullable=True))
    if 'activity_comment_thread' in tables and 'locale' not in _columns(inspector, 'activity_comment_thread'):
        op.add_column('activity_comment_thread', sa.Column('locale', sa.String(length=20), nullable=True))

    if 'course_translation' not in tables:
        op.create_table(
            'course_translation',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('locale', sa.String(length=20), nullable=False),
            sa.Column('status', sa.String(length=16), nullable=False, server_default='draft'),
            sa.Column('translated_by', sa.String(length=16), nullable=True),
            sa.Column('name', sa.String(), nullable=True),
            sa.Column('description', sa.String(), nullable=True),
            sa.Column('about', sa.String(), nullable=True),
            sa.Column('learnings', sa.String(), nullable=True),
            sa.Column('tags', sa.String(), nullable=True),
            sa.Column('seo', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column('slug', sa.String(length=100), nullable=True),
            sa.Column('source_hash', sa.String(length=64), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.Column('updated_by_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.UniqueConstraint('course_id', 'locale', name='uq_course_translation_locale'),
        )
        op.create_index('ix_course_translation_course_id', 'course_translation', ['course_id'])
        op.create_index('ix_course_translation_org_id', 'course_translation', ['org_id'])
        op.create_index('ix_course_translation_org_slug', 'course_translation', ['org_id', 'slug'])

    if 'chapter_translation' not in tables:
        op.create_table(
            'chapter_translation',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('chapter_id', sa.Integer(), sa.ForeignKey('chapter.id', ondelete='CASCADE'), nullable=False),
            sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('locale', sa.String(length=20), nullable=False),
            sa.Column('status', sa.String(length=16), nullable=False, server_default='draft'),
            sa.Column('translated_by', sa.String(length=16), nullable=True),
            sa.Column('name', sa.String(), nullable=True),
            sa.Column('description', sa.String(), nullable=True),
            sa.Column('source_hash', sa.String(length=64), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.UniqueConstraint('chapter_id', 'locale', name='uq_chapter_translation_locale'),
        )
        op.create_index('ix_chapter_translation_chapter_id', 'chapter_translation', ['chapter_id'])
        op.create_index('ix_chapter_translation_course_id', 'chapter_translation', ['course_id'])
        op.create_index('ix_chapter_translation_org_id', 'chapter_translation', ['org_id'])

    if 'activity_translation' not in tables:
        op.create_table(
            'activity_translation',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('activity_id', sa.Integer(), sa.ForeignKey('activity.id', ondelete='CASCADE'), nullable=False),
            sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('locale', sa.String(length=20), nullable=False),
            sa.Column('status', sa.String(length=16), nullable=False, server_default='draft'),
            sa.Column('translated_by', sa.String(length=16), nullable=True),
            sa.Column('name', sa.String(), nullable=True),
            sa.Column('content', sa.JSON(), nullable=True),
            sa.Column('extra', sa.JSON(), nullable=True),
            sa.Column('source_version', sa.Integer(), nullable=True),
            sa.Column('source_hash', sa.String(length=64), nullable=True),
            sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.Column('updated_by_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.UniqueConstraint('activity_id', 'locale', name='uq_activity_translation_locale'),
        )
        op.create_index('ix_activity_translation_activity_id', 'activity_translation', ['activity_id'])
        op.create_index('ix_activity_translation_org_id', 'activity_translation', ['org_id'])
        op.create_index('ix_activity_translation_course_locale', 'activity_translation', ['course_id', 'locale'])

    if 'activity_translation_collab' not in tables:
        op.create_table(
            'activity_translation_collab',
            sa.Column('translation_id', sa.Integer(),
                      sa.ForeignKey('activity_translation.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('ydoc_state', sa.LargeBinary(), nullable=True),
            sa.Column('ydoc_version', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
        )
        op.create_index('ix_activity_translation_collab_org_id', 'activity_translation_collab', ['org_id'])


def downgrade() -> None:
    op.drop_table('activity_translation_collab')
    op.drop_table('activity_translation')
    op.drop_table('chapter_translation')
    op.drop_table('course_translation')
    op.drop_column('activity_comment_thread', 'locale')
    op.drop_column('course', 'default_locale')
