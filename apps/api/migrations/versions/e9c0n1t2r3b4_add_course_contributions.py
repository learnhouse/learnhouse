"""Course contributions: suggested edits, credit, per-course settings, and
learner feedback on comment threads

- ``course_contribution_settings``, ``content_suggestion``,
  ``content_attribution``, ``course_contributor``: new tables (empty, so
  creating them and their indexes takes no lock on existing data).
- ``activity_comment_thread.kind`` / ``feedback_type`` / ``anchor``: new
  columns. ``kind`` is NOT NULL with a constant server default, which
  Postgres 11+ records in the catalog without rewriting the table; the other
  two are nullable. Existing threads read as ``kind = 'comment'``.

Reversible: downgrade drops the columns and the tables.

Revision ID: e9c0n1t2r3b4
Revises: d8i2c3o4p5y6
Create Date: 2026-11-21 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e9c0n1t2r3b4'
down_revision: Union[str, None] = 'd8i2c3o4p5y6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _fk(target: str, ondelete: str) -> sa.ForeignKey:
    return sa.ForeignKey(target, ondelete=ondelete)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if 'course_contribution_settings' not in tables:
        op.create_table(
            'course_contribution_settings',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('course_id', sa.Integer(), _fk('course.id', 'CASCADE'), nullable=False, unique=True),
            sa.Column('org_id', sa.Integer(), _fk('organization.id', 'CASCADE'), nullable=False),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('audience', sa.String(16), nullable=False, server_default='enrolled'),
            sa.Column('allow_suggestions', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('allow_feedback', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('trusted_publish', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('updated_by', sa.Integer(), _fk('user.id', 'SET NULL'), nullable=True),
            sa.Column('created_at', sa.String(), nullable=False, server_default=''),
            sa.Column('updated_at', sa.String(), nullable=False, server_default=''),
        )
        op.create_index('ix_course_contribution_settings_org_id', 'course_contribution_settings', ['org_id'])

    if 'content_suggestion' not in tables:
        op.create_table(
            'content_suggestion',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('suggestion_uuid', sa.String(), nullable=False),
            sa.Column('org_id', sa.Integer(), _fk('organization.id', 'CASCADE'), nullable=False),
            sa.Column('course_id', sa.Integer(), _fk('course.id', 'CASCADE'), nullable=False),
            sa.Column('activity_id', sa.Integer(), _fk('activity.id', 'CASCADE'), nullable=False),
            sa.Column('author_id', sa.Integer(), _fk('user.id', 'SET NULL'), nullable=True),
            sa.Column('status', sa.String(20), nullable=False, server_default='pending'),
            sa.Column('base_version', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('start_index', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('before', sa.JSON(), nullable=False, server_default='[]'),
            sa.Column('after', sa.JSON(), nullable=False, server_default='[]'),
            sa.Column('prev_fp', sa.String(600), nullable=True),
            sa.Column('note', sa.String(1000), nullable=False, server_default=''),
            sa.Column('summary', sa.String(300), nullable=False, server_default=''),
            sa.Column('review_note', sa.String(1000), nullable=False, server_default=''),
            sa.Column('reviewed_by', sa.Integer(), _fk('user.id', 'SET NULL'), nullable=True),
            sa.Column('reviewed_at', sa.String(), nullable=True),
            sa.Column('applied_version', sa.Integer(), nullable=True),
            sa.Column('auto_published', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('created_at', sa.String(), nullable=False, server_default=''),
            sa.Column('updated_at', sa.String(), nullable=False, server_default=''),
        )
        op.create_index('ix_content_suggestion_suggestion_uuid', 'content_suggestion', ['suggestion_uuid'], unique=True)
        op.create_index('ix_content_suggestion_org_id', 'content_suggestion', ['org_id'])
        op.create_index('ix_content_suggestion_author_id', 'content_suggestion', ['author_id'])
        op.create_index('ix_content_suggestion_course_status', 'content_suggestion', ['course_id', 'status'])
        op.create_index('ix_content_suggestion_activity_status', 'content_suggestion', ['activity_id', 'status'])

    if 'content_attribution' not in tables:
        op.create_table(
            'content_attribution',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.Integer(), _fk('organization.id', 'CASCADE'), nullable=False),
            sa.Column('course_id', sa.Integer(), _fk('course.id', 'CASCADE'), nullable=False),
            sa.Column('activity_id', sa.Integer(), _fk('activity.id', 'CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), _fk('user.id', 'CASCADE'), nullable=False),
            sa.Column('suggestion_id', sa.Integer(), _fk('content_suggestion.id', 'SET NULL'), nullable=True),
            sa.Column('block_fp', sa.String(600), nullable=False),
            sa.Column('block_type', sa.String(64), nullable=False, server_default=''),
            sa.Column('block_index', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.String(), nullable=False, server_default=''),
            sa.Column('updated_at', sa.String(), nullable=False, server_default=''),
            sa.UniqueConstraint('activity_id', 'user_id', 'block_fp', name='uq_content_attribution_block_user'),
        )
        op.create_index('ix_content_attribution_course_id', 'content_attribution', ['course_id'])
        op.create_index('ix_content_attribution_activity_id', 'content_attribution', ['activity_id'])
        op.create_index('ix_content_attribution_user_id', 'content_attribution', ['user_id'])

    if 'course_contributor' not in tables:
        op.create_table(
            'course_contributor',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.Integer(), _fk('organization.id', 'CASCADE'), nullable=False),
            sa.Column('course_id', sa.Integer(), _fk('course.id', 'CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), _fk('user.id', 'CASCADE'), nullable=False),
            sa.Column('accepted_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('trusted', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('blocked', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('first_contribution_at', sa.String(), nullable=True),
            sa.Column('last_contribution_at', sa.String(), nullable=True),
            sa.UniqueConstraint('course_id', 'user_id', name='uq_course_contributor_course_user'),
        )
        op.create_index('ix_course_contributor_course_id', 'course_contributor', ['course_id'])
        op.create_index('ix_course_contributor_user_id', 'course_contributor', ['user_id'])

    if 'activity_comment_thread' in tables:
        columns = {c['name'] for c in inspector.get_columns('activity_comment_thread')}
        if 'kind' not in columns:
            op.add_column('activity_comment_thread', sa.Column(
                'kind', sa.String(16), nullable=False, server_default='comment',
            ))
        if 'feedback_type' not in columns:
            op.add_column('activity_comment_thread', sa.Column('feedback_type', sa.String(16), nullable=True))
        if 'anchor' not in columns:
            op.add_column('activity_comment_thread', sa.Column('anchor', sa.JSON(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if 'activity_comment_thread' in tables:
        columns = {c['name'] for c in inspector.get_columns('activity_comment_thread')}
        for name in ('anchor', 'feedback_type', 'kind'):
            if name in columns:
                op.drop_column('activity_comment_thread', name)
    for name in ('course_contributor', 'content_attribution', 'content_suggestion', 'course_contribution_settings'):
        if name in tables:
            op.drop_table(name)
