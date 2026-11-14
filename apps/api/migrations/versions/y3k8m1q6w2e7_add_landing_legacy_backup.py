"""Landing page builder: backup table for the one-time classic landing conversion

Adds ``landing_legacy_backup``: one row per organization recording the
conversion of its classic landing config into a builder home page (status,
the page made, errors, attempts) and keeping the old config so it can be
restored. The conversion itself runs as an idempotent job at API startup
(src/services/landing/migrate_legacy.py), not in this migration.

Revision ID: y3k8m1q6w2e7
Revises: n7w5l3t1r9q2
Create Date: 2026-11-11 22:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'y3k8m1q6w2e7'
down_revision: Union[str, None] = 'n7w5l3t1r9q2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if 'landing_legacy_backup' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        'landing_legacy_backup',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('legacy', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='running'),
        sa.Column('page_uuid', sa.String(100), nullable=False, server_default=''),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('error', sa.String(1000), nullable=False, server_default=''),
        sa.Column('creation_date', sa.String(), nullable=False, server_default=''),
        sa.Column('update_date', sa.String(), nullable=False, server_default=''),
        sa.UniqueConstraint('org_id', name='uq_landing_legacy_backup_org'),
    )


def downgrade() -> None:
    if 'landing_legacy_backup' in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table('landing_legacy_backup')
