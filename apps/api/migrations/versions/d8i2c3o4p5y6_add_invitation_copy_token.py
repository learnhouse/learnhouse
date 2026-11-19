"""Invitations: a separate copied link, one pending invitation per address,
one membership per person and org

- ``org_invitation.copy_token_hash``: the SHA-256 of the personal link an admin
  copies to share by hand. It used to replace ``token_hash``, so copying a link
  broke the one in the invitation email; now both work, and the copied one
  still doesn't count as proof of the inbox.
- ``uq_org_invitation_pending_email``: at most one pending invitation per org
  and address (a partial unique index). Extra pending duplicates are closed
  first; the newest stays.
- ``uq_userorganization_user_org``: one membership per person and org (a
  unique index), so two concurrent joins can't both insert. Duplicate rows are
  removed first; the one with the strongest built-in role (lowest role id)
  stays, then the oldest.

On Postgres, when the app runs the migration, both unique indexes are built
with CREATE UNIQUE INDEX CONCURRENTLY after the migration transaction commits
(writes keep flowing while they build), and the duplicates are removed again
right before each build, in case one slipped in meanwhile. A build that still
fails is logged as an error and the app keeps working without the index.

Revision ID: d8i2c3o4p5y6
Revises: c7h4n5e6l7r8
Create Date: 2026-11-19 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd8i2c3o4p5y6'
down_revision: Union[str, None] = 'c7h4n5e6l7r8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PENDING_INDEX = 'uq_org_invitation_pending_email'
MEMBERSHIP_INDEX = 'uq_userorganization_user_org'
PENDING_WHERE = "status = 'pending'"

# Newest pending invitation per org and address stays.
CLOSE_DUPLICATE_PENDING = (
    "UPDATE org_invitation SET status = 'revoked' "
    "WHERE status = 'pending' AND id NOT IN ("
    "  SELECT MAX(id) FROM org_invitation WHERE status = 'pending' GROUP BY org_id, email"
    ")"
)
# One row per person and org: the strongest built-in role (lowest id), then
# the oldest row, so an Admin membership never gives way to a User one.
DELETE_DUPLICATE_MEMBERSHIPS = (
    "DELETE FROM userorganization WHERE id IN ("
    "  SELECT id FROM ("
    "    SELECT id, ROW_NUMBER() OVER ("
    "      PARTITION BY user_id, org_id ORDER BY COALESCE(role_id, 2147483647), id"
    "    ) AS rn FROM userorganization"
    "  ) ranked WHERE rn > 1"
    ")"
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Set by the app's migration runner (src/core/migrations.py); absent when
    # alembic is run by hand.
    deferred = op.get_context().config.attributes.get("deferred_indexes")
    if bind.dialect.name != "postgresql":
        deferred = None

    if inspector.has_table('org_invitation'):
        if 'copy_token_hash' not in {c['name'] for c in inspector.get_columns('org_invitation')}:
            op.add_column('org_invitation', sa.Column('copy_token_hash', sa.String(64), nullable=True))
        if 'uq_org_invitation_copy_token_hash' not in {c['name'] for c in inspector.get_unique_constraints('org_invitation')}:
            # A column that was just added (all NULL): nothing to scan.
            op.create_unique_constraint('uq_org_invitation_copy_token_hash', 'org_invitation', ['copy_token_hash'])
        if PENDING_INDEX not in {i['name'] for i in inspector.get_indexes('org_invitation')}:
            bind.execute(sa.text(CLOSE_DUPLICATE_PENDING))
            if deferred is not None:
                deferred.append((PENDING_INDEX, 'org_invitation', ['org_id', 'email'], {
                    "unique": True, "where": PENDING_WHERE, "before": [CLOSE_DUPLICATE_PENDING],
                }))
            else:
                op.create_index(
                    PENDING_INDEX, 'org_invitation', ['org_id', 'email'], unique=True,
                    postgresql_where=sa.text(PENDING_WHERE), sqlite_where=sa.text(PENDING_WHERE),
                )

    if inspector.has_table('userorganization'):
        if MEMBERSHIP_INDEX not in {i['name'] for i in inspector.get_indexes('userorganization')}:
            bind.execute(sa.text(DELETE_DUPLICATE_MEMBERSHIPS))
            if deferred is not None:
                deferred.append((MEMBERSHIP_INDEX, 'userorganization', ['user_id', 'org_id'], {
                    "unique": True, "before": [DELETE_DUPLICATE_MEMBERSHIPS],
                }))
            else:
                op.create_index(MEMBERSHIP_INDEX, 'userorganization', ['user_id', 'org_id'], unique=True)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table('userorganization') and MEMBERSHIP_INDEX in {
        i['name'] for i in inspector.get_indexes('userorganization')
    }:
        op.drop_index(MEMBERSHIP_INDEX, table_name='userorganization')
    if not inspector.has_table('org_invitation'):
        return
    if PENDING_INDEX in {i['name'] for i in inspector.get_indexes('org_invitation')}:
        op.drop_index(PENDING_INDEX, table_name='org_invitation')
    if 'uq_org_invitation_copy_token_hash' in {c['name'] for c in inspector.get_unique_constraints('org_invitation')}:
        op.drop_constraint('uq_org_invitation_copy_token_hash', 'org_invitation', type_='unique')
    if 'copy_token_hash' in {c['name'] for c in inspector.get_columns('org_invitation')}:
        op.drop_column('org_invitation', 'copy_token_hash')
