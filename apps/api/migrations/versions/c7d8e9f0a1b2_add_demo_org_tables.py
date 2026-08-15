"""Add demo organization support: is_demo flag, entity registry, state row

The shared demo organization is refreshed in place on a schedule rather than
dropped and rebuilt, which needs three things in the schema:

* ``organization.is_demo`` — indexed, because it is a filter on org-wide scans
  (active-user billing overage, nudge eligibility, explore, the free-org cap),
  not a per-row lookup.
* ``demo_entity`` — the registry of every row the bundle owns, keyed by the
  stable ``(kind, bundle_key)`` identity the manifest declares. Rows in the
  demo org with no entry here were created by a visitor and are deleted as
  drift on the next refresh.
* ``demo_state`` — a singleton row holding ``bundle_version`` (a change forces
  a re-provision) and ``content_epoch`` (the anchor for backdated timestamps,
  rolled once a day so hourly refreshes are no-ops).

Both new tables cascade from ``organization``, so tearing the demo org down
takes the registry with it and cannot strand rows that claim to own content
that no longer exists.

Revision ID: c7d8e9f0a1b2
Revises: b1n2u3d4g5e6
Create Date: 2026-08-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, None] = 'b1n2u3d4g5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'organization' in tables:
        existing_columns = {col['name'] for col in inspector.get_columns('organization')}
        if 'is_demo' not in existing_columns:
            op.add_column(
                'organization',
                sa.Column(
                    'is_demo',
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                ),
            )
        existing_indexes = {ix['name'] for ix in inspector.get_indexes('organization')}
        if 'ix_organization_is_demo' not in existing_indexes:
            op.create_index('ix_organization_is_demo', 'organization', ['is_demo'])

    if 'demo_entity' not in tables:
        op.create_table(
            'demo_entity',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('kind', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('bundle_key', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('entity_id', sa.Integer(), nullable=False),
            sa.Column('entity_uuid', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('org_id', sa.Integer(), nullable=False),
            sa.Column('creation_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('update_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('kind', 'bundle_key', name='uq_demo_entity_kind_key'),
        )
        op.create_index('ix_demo_entity_kind', 'demo_entity', ['kind'])
        op.create_index('ix_demo_entity_uuid', 'demo_entity', ['entity_uuid'])
        op.create_index('ix_demo_entity_org_id', 'demo_entity', ['org_id'])

    if 'demo_state' not in tables:
        op.create_table(
            'demo_state',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('org_id', sa.Integer(), nullable=True),
            sa.Column('state', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('bundle_version', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('content_epoch', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('last_refresh_at', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('last_provision_at', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('last_step', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('last_error', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
            sa.Column('stats', sa.JSON(), nullable=True),
            sa.Column('creation_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('update_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if 'demo_state' in tables:
        op.drop_table('demo_state')

    if 'demo_entity' in tables:
        op.drop_table('demo_entity')

    if 'organization' in tables:
        existing_indexes = {ix['name'] for ix in inspector.get_indexes('organization')}
        if 'ix_organization_is_demo' in existing_indexes:
            op.drop_index('ix_organization_is_demo', table_name='organization')
        existing_columns = {col['name'] for col in inspector.get_columns('organization')}
        if 'is_demo' in existing_columns:
            op.drop_column('organization', 'is_demo')
