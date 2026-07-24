"""Add user_audit_event append-only table

A durable, legal-grade record of student learning activity: connections (login /
logout with IP + user-agent), course enrollment/progress, assignment submissions and
grades received, code submissions, certificates earned, and community participation.

This complements the lossy, 365-day-TTL Tinybird analytics stream. Rows are never
updated or deleted; ``created_at`` is a real ``timestamptz``. The table also preserves
history the live tables overwrite (e.g. assignment retries reset the submission row in
place). See ``src/db/user_audit_events.py`` and ``src/services/audit/``.

Guarded (idempotent) so a partially-applied DB is safe.

Descends from ``r5s6t7u8v9w0`` — the revision production is actually on. The other
open head on ``dev`` (``a2b3c4d5e6f7``) is a disconnected legacy lineage that was
never applied to prod and includes destructive ops (e.g. dropping collections
tables); this revision deliberately does NOT merge it in, so applying this table is a
single additive step that can never re-run that branch. Deploy this revision with an
explicit target — ``alembic upgrade b8c9d0e1f2a3`` — not ``upgrade head`` (which fails
on the pre-existing multi-head tree) and never ``upgrade heads`` (which would run the
orphan branch).

Revision ID: b8c9d0e1f2a3
Revises: r5s6t7u8v9w0
Create Date: 2026-07-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, None] = 'r5s6t7u8v9w0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = 'user_audit_event'


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _TABLE in inspector.get_table_names():
        return

    op.create_table(
        _TABLE,
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('org_id', sa.Integer(), nullable=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('event_type', sa.String(length=64), nullable=False),
        sa.Column('ip', sa.String(length=64), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('target_uuid', sa.String(length=128), nullable=True),
        sa.Column('audit_metadata', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_user_audit_event_org_user_created', _TABLE,
        ['org_id', 'user_id', 'created_at'],
    )
    op.create_index(
        'ix_user_audit_event_user_type_created', _TABLE,
        ['user_id', 'event_type', 'created_at'],
    )
    op.create_index(op.f('ix_user_audit_event_user_id'), _TABLE, ['user_id'])
    op.create_index(op.f('ix_user_audit_event_target_uuid'), _TABLE, ['target_uuid'])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if _TABLE not in inspector.get_table_names():
        return

    op.drop_index(op.f('ix_user_audit_event_target_uuid'), table_name=_TABLE)
    op.drop_index(op.f('ix_user_audit_event_user_id'), table_name=_TABLE)
    op.drop_index('ix_user_audit_event_user_type_created', table_name=_TABLE)
    op.drop_index('ix_user_audit_event_org_user_created', table_name=_TABLE)
    op.drop_table(_TABLE)
