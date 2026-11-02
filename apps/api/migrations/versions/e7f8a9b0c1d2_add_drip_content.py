"""Add drip content schedule columns and the unlock email ledger

Adds a nullable JSONB ``drip_settings`` column to ``course`` (whether the
course drips its chapters and what the schedule is anchored on) and a
nullable JSONB ``drip_rule`` column to ``chapter`` (when that chapter is
released). Both default to NULL, which means "no schedule": every existing
course keeps showing all of its chapters.

Also creates ``drip_notification``, one row per (chapter, learner) once the
"chapter is open" email has gone out.

Revision ID: e7f8a9b0c1d2
Revises: 8d2b6f4c1e75
Create Date: 2026-11-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'e7f8a9b0c1d2'
down_revision: Union[str, None] = '8d2b6f4c1e75'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLUMNS = (('course', 'drip_settings'), ('chapter', 'drip_rule'))


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for table, column in _COLUMNS:
        if table not in tables:
            continue
        if column in {col['name'] for col in inspector.get_columns(table)}:
            continue
        op.add_column(table, sa.Column(column, postgresql.JSONB(), nullable=True))

    if 'drip_notification' not in tables:
        op.create_table(
            'drip_notification',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('chapter_id', sa.Integer(), sa.ForeignKey('chapter.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('sent_at', sa.String(), nullable=False, server_default=''),
            sa.UniqueConstraint('chapter_id', 'user_id', name='uq_drip_notification_chapter_user'),
        )
        op.create_index('ix_drip_notification_user_id', 'drip_notification', ['user_id'])
        op.create_index('ix_drip_notification_course_id', 'drip_notification', ['course_id'])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if 'drip_notification' in tables:
        op.drop_table('drip_notification')
    for table, column in _COLUMNS:
        if table in tables and column in {col['name'] for col in inspector.get_columns(table)}:
            op.drop_column(table, column)
