"""User groups v2: smart rules, nesting, managers, join codes, schedules,
access windows, history and announcements

Adds columns to ``usergroup`` (kind, rules, parent_id, color, settings,
last_synced_at), ``usergroupuser`` (sources, expires_at, added_by_id) and
``usergroupresource`` (starts_at, expires_at), and creates
``usergroup_manager``, ``usergroup_join_code``, ``usergroup_schedule``,
``usergroup_event`` and ``usergroup_announcement``. Every existing group stays
a manual group with the same members and links.

Revision ID: u6g4r8p2m5k1
Revises: p8r2k5v1n6t3
Create Date: 2026-11-11 23:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'u6g4r8p2m5k1'
down_revision: Union[str, None] = 'p8r2k5v1n6t3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    tz = sa.DateTime(timezone=True)

    have = _columns('usergroup')
    if 'kind' not in have:
        op.add_column('usergroup', sa.Column('kind', sa.String(16), nullable=False, server_default='manual'))
    if 'rules' not in have:
        op.add_column('usergroup', sa.Column('rules', sa.JSON(), nullable=True))
    if 'parent_id' not in have:
        op.add_column('usergroup', sa.Column(
            'parent_id', sa.Integer(), sa.ForeignKey('usergroup.id', ondelete='SET NULL'), nullable=True))
        op.create_index('ix_usergroup_parent_id', 'usergroup', ['parent_id'])
    if 'color' not in have:
        op.add_column('usergroup', sa.Column('color', sa.String(16), nullable=True))
    if 'settings' not in have:
        op.add_column('usergroup', sa.Column('settings', sa.JSON(), nullable=True))
    if 'last_synced_at' not in have:
        op.add_column('usergroup', sa.Column('last_synced_at', tz, nullable=True))

    have = _columns('usergroupuser')
    if 'sources' not in have:
        op.add_column('usergroupuser', sa.Column('sources', sa.JSON(), nullable=True))
    if 'expires_at' not in have:
        op.add_column('usergroupuser', sa.Column('expires_at', tz, nullable=True))
    if 'added_by_id' not in have:
        op.add_column('usergroupuser', sa.Column('added_by_id', sa.Integer(), nullable=True))
    indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes('usergroupuser')}
    if 'ix_usergroupuser_group_user' not in indexes:
        op.create_index('ix_usergroupuser_group_user', 'usergroupuser', ['usergroup_id', 'user_id'])

    have = _columns('usergroupresource')
    if 'starts_at' not in have:
        op.add_column('usergroupresource', sa.Column('starts_at', tz, nullable=True))
    if 'expires_at' not in have:
        op.add_column('usergroupresource', sa.Column('expires_at', tz, nullable=True))

    def group_fk():
        return sa.Column('usergroup_id', sa.Integer(), sa.ForeignKey('usergroup.id', ondelete='CASCADE'), nullable=False)

    def org_fk():
        return sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False)

    def user_fk():
        return sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False)

    if 'usergroup_manager' not in tables:
        op.create_table(
            'usergroup_manager',
            sa.Column('id', sa.Integer(), primary_key=True),
            group_fk(), user_fk(), org_fk(),
            sa.Column('can_manage_members', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('can_view_progress', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('can_post', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('digest', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('created_by_id', sa.Integer(), nullable=True),
            sa.Column('created_at', tz, nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint('usergroup_id', 'user_id', name='uq_usergroup_manager'),
        )
        for col in ('usergroup_id', 'user_id', 'org_id'):
            op.create_index(f'ix_usergroup_manager_{col}', 'usergroup_manager', [col])

    if 'usergroup_join_code' not in tables:
        op.create_table(
            'usergroup_join_code',
            sa.Column('id', sa.Integer(), primary_key=True),
            group_fk(), org_fk(),
            sa.Column('code', sa.String(32), nullable=False),
            sa.Column('label', sa.String(120), nullable=False, server_default=''),
            sa.Column('max_uses', sa.Integer(), nullable=True),
            sa.Column('uses', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('expires_at', tz, nullable=True),
            sa.Column('membership_days', sa.Integer(), nullable=True),
            sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('created_by_id', sa.Integer(), nullable=True),
            sa.Column('created_at', tz, nullable=False, server_default=sa.func.now()),
        )
        op.create_index('ix_usergroup_join_code_code', 'usergroup_join_code', ['code'], unique=True)
        op.create_index('ix_usergroup_join_code_usergroup_id', 'usergroup_join_code', ['usergroup_id'])
        op.create_index('ix_usergroup_join_code_org_id', 'usergroup_join_code', ['org_id'])

    if 'usergroup_schedule' not in tables:
        op.create_table(
            'usergroup_schedule',
            sa.Column('id', sa.Integer(), primary_key=True),
            group_fk(), org_fk(), user_fk(),
            sa.Column('starts_at', tz, nullable=False),
            sa.Column('ends_at', tz, nullable=True),
            sa.Column('status', sa.String(16), nullable=False, server_default='pending'),
            sa.Column('created_by_id', sa.Integer(), nullable=True),
            sa.Column('created_at', tz, nullable=False, server_default=sa.func.now()),
        )
        op.create_index('ix_usergroup_schedule_due', 'usergroup_schedule', ['status', 'starts_at'])
        for col in ('usergroup_id', 'user_id', 'org_id'):
            op.create_index(f'ix_usergroup_schedule_{col}', 'usergroup_schedule', [col])

    if 'usergroup_event' not in tables:
        op.create_table(
            'usergroup_event',
            sa.Column('id', sa.Integer(), primary_key=True),
            group_fk(), org_fk(),
            sa.Column('action', sa.String(48), nullable=False),
            sa.Column('actor_id', sa.Integer(), nullable=True),
            sa.Column('via', sa.String(24), nullable=False, server_default=''),
            sa.Column('details', sa.JSON(), nullable=True),
            sa.Column('created_at', tz, nullable=False, server_default=sa.func.now()),
        )
        op.create_index('ix_usergroup_event_group_id', 'usergroup_event', ['usergroup_id', 'id'])
        op.create_index('ix_usergroup_event_org_id', 'usergroup_event', ['org_id'])

    if 'usergroup_announcement' not in tables:
        op.create_table(
            'usergroup_announcement',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('announcement_uuid', sa.String(64), nullable=False),
            group_fk(), org_fk(),
            sa.Column('author_id', sa.Integer(), nullable=True),
            sa.Column('title', sa.String(200), nullable=False),
            sa.Column('body', sa.Text(), nullable=False, server_default=''),
            sa.Column('pinned', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('emailed', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('created_at', tz, nullable=False, server_default=sa.func.now()),
        )
        op.create_index('ix_usergroup_announcement_announcement_uuid', 'usergroup_announcement', ['announcement_uuid'])
        op.create_index('ix_usergroup_announcement_usergroup_id', 'usergroup_announcement', ['usergroup_id'])
        op.create_index('ix_usergroup_announcement_org_id', 'usergroup_announcement', ['org_id'])


def downgrade() -> None:
    for table in ('usergroup_announcement', 'usergroup_event', 'usergroup_schedule', 'usergroup_join_code', 'usergroup_manager'):
        op.drop_table(table)
    op.drop_column('usergroupresource', 'expires_at')
    op.drop_column('usergroupresource', 'starts_at')
    op.drop_index('ix_usergroupuser_group_user', table_name='usergroupuser')
    op.drop_column('usergroupuser', 'added_by_id')
    op.drop_column('usergroupuser', 'expires_at')
    op.drop_column('usergroupuser', 'sources')
    op.drop_index('ix_usergroup_parent_id', table_name='usergroup')
    for col in ('last_synced_at', 'settings', 'color', 'parent_id', 'rules', 'kind'):
        op.drop_column('usergroup', col)
