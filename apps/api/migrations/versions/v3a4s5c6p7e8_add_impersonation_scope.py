"""Impersonation sessions: who opened them

Adds ``platform_impersonation_session.scope``: ``platform`` for sessions
platform staff open from the console (every existing row), ``org`` for an org
admin viewing one of their own learners, read-only.

Revision ID: v3a4s5c6p7e8
Revises: v2p1a2n3s4g5
Create Date: 2026-11-16 15:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'v3a4s5c6p7e8'
down_revision: Union[str, None] = 'v2p1a2n3s4g5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = 'platform_impersonation_session'


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE):
        return
    if 'scope' not in {c['name'] for c in inspector.get_columns(TABLE)}:
        op.add_column(TABLE, sa.Column('scope', sa.String(16), nullable=False, server_default='platform'))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table(TABLE) and 'scope' in {c['name'] for c in inspector.get_columns(TABLE)}:
        op.drop_column(TABLE, 'scope')
