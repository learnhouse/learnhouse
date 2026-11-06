"""Add analytics tables (events, daily summaries, per-org settings)

Analytics moves from Tinybird into the main Postgres database:

- ``analytics_event``: the raw event stream, with the dimensions dashboards
  group on promoted to columns and the rest in a JSONB ``properties``.
- ``analytics_daily_actor`` / ``analytics_hourly_count``: summaries rebuilt
  every few minutes so long-window charts don't scan the raw stream.
- ``analytics_settings``: per-org retention and privacy settings.

Revision ID: f5a8b3d0c2e4
Revises: e4f7a2c9b1d3
Create Date: 2026-11-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f5a8b3d0c2e4'
down_revision: Union[str, None] = 'e4f7a2c9b1d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())

    if 'analytics_event' not in tables:
        op.create_table(
            'analytics_event',
            sa.Column('id', sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column('ts', sa.DateTime(timezone=True), nullable=False),
            sa.Column('org_id', sa.Integer(), nullable=False),
            sa.Column('event_name', sa.String(64), nullable=False),
            sa.Column('source', sa.String(16), nullable=False, server_default='api'),
            sa.Column('user_id', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('actor_key', sa.String(80), nullable=False, server_default=''),
            sa.Column('session_id', sa.String(64), nullable=False, server_default=''),
            sa.Column('course_uuid', sa.String(100), nullable=True),
            sa.Column('activity_uuid', sa.String(100), nullable=True),
            sa.Column('path', sa.String(512), nullable=True),
            sa.Column('country', sa.String(2), nullable=True),
            sa.Column('device', sa.String(16), nullable=True),
            sa.Column('referrer_domain', sa.String(255), nullable=True),
            sa.Column('seconds_spent', sa.REAL(), nullable=True),
            sa.Column('properties', postgresql.JSONB(), nullable=False, server_default='{}'),
        )
        op.create_index('ix_analytics_event_org_name_ts', 'analytics_event', ['org_id', 'event_name', 'ts'])
        op.create_index('ix_analytics_event_org_ts', 'analytics_event', ['org_id', 'ts'])
        op.create_index(
            'ix_analytics_event_org_course_ts', 'analytics_event', ['org_id', 'course_uuid', 'ts'],
            postgresql_where=sa.text('course_uuid IS NOT NULL'),
        )
        op.create_index('ix_analytics_event_ts_brin', 'analytics_event', ['ts'], postgresql_using='brin')

    if 'analytics_daily_actor' not in tables:
        op.create_table(
            'analytics_daily_actor',
            sa.Column('org_id', sa.Integer(), primary_key=True),
            sa.Column('day', sa.Date(), primary_key=True),
            sa.Column('actor_key', sa.String(80), primary_key=True),
            sa.Column('user_id', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('events', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('page_views', sa.Integer(), nullable=False, server_default='0'),
        )

    if 'analytics_hourly_count' not in tables:
        op.create_table(
            'analytics_hourly_count',
            sa.Column('org_id', sa.Integer(), primary_key=True),
            sa.Column('day', sa.Date(), primary_key=True),
            sa.Column('hour', sa.SmallInteger(), primary_key=True),
            sa.Column('event_name', sa.String(64), primary_key=True),
            sa.Column('n', sa.Integer(), nullable=False, server_default='0'),
        )

    if 'analytics_settings' not in tables:
        op.create_table(
            'analytics_settings',
            sa.Column(
                'org_id', sa.Integer(),
                sa.ForeignKey('organization.id', ondelete='CASCADE'), primary_key=True,
            ),
            sa.Column('retention_days', sa.Integer(), nullable=False, server_default='365'),
            sa.Column('track_anonymous', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('collect_location', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('exclude_staff', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    for name in ('analytics_settings', 'analytics_hourly_count', 'analytics_daily_actor', 'analytics_event'):
        if name in tables:
            op.drop_table(name)
