"""Add user_calendar_event table

Creates a new ``user_calendar_event`` table backing the per-user personal
calendar feature. Columns mirror the SQLModel definition in
``src/db/calendar_events.py``.

Revision ID: b7c8d9e0f1g2
Revises: z5a6b7c8d9e0
Create Date: 2026-04-28

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'b7c8d9e0f1g2'
down_revision: Union[str, None] = 'z5a6b7c8d9e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'user_calendar_event' in inspector.get_table_names():
        return

    op.create_table(
        'user_calendar_event',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('event_uuid', sa.String(), nullable=False, server_default=''),
        sa.Column(
            'user_id',
            sa.Integer(),
            sa.ForeignKey('user.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('start_date', sa.String(), nullable=False),
        sa.Column('end_date', sa.String(), nullable=True),
        sa.Column(
            'event_type',
            sa.String(length=32),
            nullable=False,
            server_default='other',
        ),
        sa.Column('color', sa.String(length=16), nullable=True),
        sa.Column('creation_date', sa.String(), nullable=False, server_default=''),
        sa.Column('update_date', sa.String(), nullable=False, server_default=''),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_user_calendar_event_event_uuid',
        'user_calendar_event', ['event_uuid'], unique=False,
    )
    op.create_index(
        'ix_user_calendar_event_user_id',
        'user_calendar_event', ['user_id'], unique=False,
    )
    op.create_index(
        'ix_user_calendar_event_user_start',
        'user_calendar_event', ['user_id', 'start_date'], unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'user_calendar_event' not in inspector.get_table_names():
        return

    op.drop_index('ix_user_calendar_event_user_start', table_name='user_calendar_event')
    op.drop_index('ix_user_calendar_event_user_id', table_name='user_calendar_event')
    op.drop_index('ix_user_calendar_event_event_uuid', table_name='user_calendar_event')
    op.drop_table('user_calendar_event')
