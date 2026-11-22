"""Video providers: per-organization settings

Adds ``org_video_provider_settings``: one row per organization and external
video provider, holding that provider's settings as JSON (whether it is on,
viewer watermarks, licence checks). Used by the Enterprise Edition's native
video players; community installs never write to it.

A new, empty table: creating it and its unique index scans nothing. The
foreign key briefly locks ``organization`` (SHARE ROW EXCLUSIVE), so a short
lock_timeout makes a busy database fail the step fast instead of queueing
writes behind it.

Revision ID: e9v1d2p3s4t5
Revises: e9c0n1t2r3b4
Create Date: 2026-11-22 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e9v1d2p3s4t5'
down_revision: Union[str, None] = 'e9c0n1t2r3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = 'org_video_provider_settings'


def upgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table(TABLE):
        return
    if bind.dialect.name == 'postgresql':
        op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table(
        TABLE,
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('provider', sa.String(32), nullable=False),
        sa.Column('settings', sa.JSON(), nullable=False),
        sa.Column('creation_date', sa.String(), nullable=False, server_default=''),
        sa.Column('update_date', sa.String(), nullable=False, server_default=''),
        sa.UniqueConstraint('org_id', 'provider', name='uq_org_video_provider_settings_org_provider'),
    )


def downgrade() -> None:
    if sa.inspect(op.get_bind()).has_table(TABLE):
        op.drop_table(TABLE)
