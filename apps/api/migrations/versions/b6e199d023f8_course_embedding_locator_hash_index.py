"""Course embedding locator, content hash and vector index

Adds ``locator`` (where in the source a chunk comes from: a PDF page, a video
timestamp) and ``content_hash`` (lets the indexer skip unchanged content) to
``course_embedding``, an HNSW index for cosine search and a composite index for
per-activity replacement. Idempotent because the table was historically created
by ``create_all`` rather than a migration.

Revision ID: b6e199d023f8
Revises: c2d3e4f5a6b7
Create Date: 2026-10-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'b6e199d023f8'
down_revision: Union[str, None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'course_embedding' not in inspector.get_table_names():
        return

    existing_columns = {col['name'] for col in inspector.get_columns('course_embedding')}
    if 'locator' not in existing_columns:
        op.add_column('course_embedding', sa.Column('locator', JSONB(), nullable=True))
    if 'content_hash' not in existing_columns:
        op.add_column('course_embedding', sa.Column('content_hash', sa.String(), nullable=True))

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_course_embedding_course_activity "
        "ON course_embedding (course_id, activity_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_course_embedding_embedding_hnsw "
        "ON course_embedding USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_course_embedding_embedding_hnsw")
    op.execute("DROP INDEX IF EXISTS ix_course_embedding_course_activity")
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if 'course_embedding' not in inspector.get_table_names():
        return
    existing_columns = {col['name'] for col in inspector.get_columns('course_embedding')}
    if 'content_hash' in existing_columns:
        op.drop_column('course_embedding', 'content_hash')
    if 'locator' in existing_columns:
        op.drop_column('course_embedding', 'locator')
