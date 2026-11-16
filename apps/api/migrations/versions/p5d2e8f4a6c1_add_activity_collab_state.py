"""Add collaborative editing state for activities

Adds the ``activitycollabstate`` table (one row per activity edited
collaboratively: the Yjs document, the activity version it matches and the
version-history coalescing bookkeeping) and a nullable ``label`` on
``activityversion`` for versions saved by name.

Revision ID: p5d2e8f4a6c1
Revises: o3c9d1e7a5b2
Create Date: 2026-11-09 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'p5d2e8f4a6c1'
down_revision: Union[str, None] = 'o3c9d1e7a5b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'activitycollabstate' not in tables:
        op.create_table(
            'activitycollabstate',
            sa.Column('activity_id', sa.Integer(), nullable=False),
            sa.Column('org_id', sa.Integer(), nullable=True),
            sa.Column('ydoc_state', sa.LargeBinary(), nullable=True),
            sa.Column('ydoc_version', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('last_snapshot_at', sa.DateTime(), nullable=True),
            sa.Column('last_snapshot_contributors', sa.JSON(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['activity_id'], ['activity.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('activity_id'),
        )
        op.create_index('ix_activitycollabstate_org_id', 'activitycollabstate', ['org_id'])

    if 'activityversion' in tables:
        columns = {c['name'] for c in inspector.get_columns('activityversion')}
        if 'label' not in columns:
            op.add_column('activityversion', sa.Column('label', sa.String(length=120), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'activityversion' in tables:
        columns = {c['name'] for c in inspector.get_columns('activityversion')}
        if 'label' in columns:
            op.drop_column('activityversion', 'label')

    if 'activitycollabstate' in tables:
        op.drop_index('ix_activitycollabstate_org_id', table_name='activitycollabstate')
        op.drop_table('activitycollabstate')
