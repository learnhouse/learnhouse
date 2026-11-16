"""Live sessions: collaborative room tools

- ``live_session`` gains co-hosts, a room lock, an agenda and ``room_data``
  (the hosts' live controls: agenda position, timer, spotlight, pinned
  message, breakout broadcast).
- ``live_session_attendance`` gains host admission (``admitted``/``denied``),
  the speaking queue (``hand_raised_at``, ``hand_raise_count``) and breakout
  help requests.
- New ``live_session_reaction``, ``live_session_resource`` and
  ``live_session_note`` (shared notes: Yjs state plus a readable copy).

Every step is skipped when the table or column is already there: live session
tables come from the models on installs that started without them.

Revision ID: l1v3c0ll4b01
Revises: b8s3n7p2k5q1
Create Date: 2026-11-11 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'l1v3c0ll4b01'
down_revision: Union[str, None] = 'b8s3n7p2k5q1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tz():
    return sa.DateTime(timezone=True)


NEW_COLUMNS = {
    'live_session': [
        sa.Column('co_host_ids', sa.JSON(), nullable=True),
        sa.Column('room_locked', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('agenda', sa.JSON(), nullable=True),
        sa.Column('room_data', sa.JSON(), nullable=True),
    ],
    'live_session_attendance': [
        sa.Column('admitted', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('denied', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('hand_raised_at', _tz(), nullable=True),
        sa.Column('hand_raise_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('help_requested_at', _tz(), nullable=True),
    ],
}


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    for table, columns in NEW_COLUMNS.items():
        if table not in tables:
            continue
        existing = {c['name'] for c in inspector.get_columns(table)}
        for column in columns:
            if column.name not in existing:
                op.add_column(table, column)

    if 'live_session' not in tables:
        return

    if 'live_session_reaction' not in tables:
        op.create_table(
            'live_session_reaction',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('session_id', sa.Integer(), sa.ForeignKey('live_session.id', ondelete='CASCADE'), nullable=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('emoji', sa.String(), nullable=False),
            sa.Column('created_at', _tz(), nullable=False),
        )
        op.create_index('ix_live_session_reaction_session_id', 'live_session_reaction', ['session_id'])
        op.create_index('ix_live_session_reaction_created_at', 'live_session_reaction', ['created_at'])

    if 'live_session_resource' not in tables:
        op.create_table(
            'live_session_resource',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('resource_uuid', sa.String(), nullable=False, server_default=''),
            sa.Column('session_id', sa.Integer(), sa.ForeignKey('live_session.id', ondelete='CASCADE'), nullable=True),
            sa.Column('kind', sa.String(), nullable=False, server_default='link'),
            sa.Column('title', sa.String(), nullable=False),
            sa.Column('url', sa.String(), nullable=True),
            sa.Column('activity_uuid', sa.String(), nullable=True),
            sa.Column('course_uuid', sa.String(), nullable=True),
            sa.Column('shared_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('created_at', _tz(), nullable=False),
        )
        op.create_index('ix_live_session_resource_session_id', 'live_session_resource', ['session_id'])
        op.create_index('ix_live_session_resource_resource_uuid', 'live_session_resource', ['resource_uuid'])

    if 'live_session_note' not in tables:
        op.create_table(
            'live_session_note',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('session_id', sa.Integer(), sa.ForeignKey('live_session.id', ondelete='CASCADE'), nullable=True),
            sa.Column('ydoc', sa.LargeBinary(), nullable=True),
            sa.Column('html', sa.Text(), nullable=True),
            sa.Column('text', sa.Text(), nullable=True),
            sa.Column('updated_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('updated_at', _tz(), nullable=True),
            sa.UniqueConstraint('session_id', name='uq_live_session_note'),
        )
        op.create_index('ix_live_session_note_session_id', 'live_session_note', ['session_id'])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for table in ('live_session_note', 'live_session_resource', 'live_session_reaction'):
        if table in tables:
            op.drop_table(table)
    for table, columns in NEW_COLUMNS.items():
        if table not in tables:
            continue
        existing = {c['name'] for c in inspector.get_columns(table)}
        for column in columns:
            if column.name in existing:
                op.drop_column(table, column.name)
