"""Drop the legacy collection / collectioncourse tables

Collections are fully replaced by the folders model (see f7a8b9c0d1e2). This
migration removes the legacy tables for good. It is intentionally a separate,
dedicated revision so the destructive drop is reviewed and deployed on its own,
independently of the additive folders/media work.

This also reconciles environments where f7a8b9c0d1e2 was stamped from an earlier
build whose upgrade() never actually executed the drop (Alembic keys off the
revision id, not file contents) — those DBs still have the collection tables and
this revision is what removes them.

Revision ID: d4e5f6a7b8c9
Revises: f7a8b9c0d1e2
Create Date: 2026-06-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'f7a8b9c0d1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # Child table first (FK collectioncourse.collection_id -> collection.id).
    if 'collectioncourse' in tables:
        op.drop_table('collectioncourse')
    if 'collection' in tables:
        op.drop_table('collection')


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # Recreate the legacy tables (minimal shape) so the drop is reversible.
    if 'collection' not in tables:
        op.create_table(
            'collection',
            sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
            sa.Column('org_id', sa.BigInteger(), nullable=False),
            sa.Column('collection_uuid', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
            sa.Column('public', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('description', sqlmodel.sql.sqltypes.AutoString(), nullable=True, server_default=''),
            sa.Column('creation_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('update_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
        )
    if 'collectioncourse' not in tables:
        op.create_table(
            'collectioncourse',
            sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
            sa.Column('collection_id', sa.Integer(), nullable=False),
            sa.Column('course_id', sa.Integer(), nullable=False),
            sa.Column('org_id', sa.Integer(), nullable=False),
            sa.Column('creation_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.Column('update_date', sqlmodel.sql.sqltypes.AutoString(), nullable=False, server_default=''),
            sa.ForeignKeyConstraint(['collection_id'], ['collection.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['course_id'], ['course.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
        )
