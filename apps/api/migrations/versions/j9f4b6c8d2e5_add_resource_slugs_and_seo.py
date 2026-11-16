"""Add human-readable slugs and SEO settings to resources

- ``slug`` on course, path, podcast, community and folder, unique per org
  (partial index, NULLs allowed), backfilled from each row's name. Older rows
  get the plain slug, later duplicates ``-2``, ``-3``...
- ``seo`` JSONB on path, community and folder (course and podcast have it).
- ``resource_slug_redirect``: previous slugs, which redirect permanently to the
  resource's current slug.

Revision ID: j9f4b6c8d2e5
Revises: i8e3a5b7c2d4
Create Date: 2026-11-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "j9f4b6c8d2e5"
down_revision: Union[str, None] = "i8e3a5b7c2d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SLUG_TABLES = {
    "course": "course_uuid",
    "path": "path_uuid",
    "podcast": "podcast_uuid",
    "community": "community_uuid",
    "folder": "folder_uuid",
}
SEO_TABLES = ("path", "community", "folder")


def _backfill(table: str, uuid_column: str) -> None:
    from src.services.seo.slugify import base_slug, first_free

    conn = op.get_bind()
    rows = conn.execute(
        sa.text(f'SELECT id, org_id, name, {uuid_column} FROM "{table}" WHERE slug IS NULL ORDER BY id')
    ).fetchall()
    taken: dict[int, set[str]] = {}
    for org_id, slug in conn.execute(sa.text(f'SELECT org_id, slug FROM "{table}" WHERE slug IS NOT NULL')):
        taken.setdefault(org_id, set()).add(slug)
    for row_id, org_id, name, resource_uuid in rows:
        used = taken.setdefault(org_id, set())
        slug = first_free(base_slug(name, resource_uuid or ""), used)
        used.add(slug)
        conn.execute(sa.text(f'UPDATE "{table}" SET slug = :slug WHERE id = :id'), {"slug": slug, "id": row_id})


def upgrade() -> None:
    for table, uuid_column in SLUG_TABLES.items():
        op.add_column(table, sa.Column("slug", sa.String(length=100), nullable=True))
        _backfill(table, uuid_column)
        op.create_index(
            f"uq_{table}_org_slug",
            table,
            ["org_id", "slug"],
            unique=True,
            postgresql_where=sa.text("slug IS NOT NULL"),
        )
    for table in SEO_TABLES:
        op.add_column(table, sa.Column("seo", postgresql.JSONB(astext_type=sa.Text()), nullable=True))

    op.create_table(
        "resource_slug_redirect",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.BigInteger(), sa.ForeignKey("organization.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resource_type", sa.String(length=32), nullable=False),
        sa.Column("resource_uuid", sa.String(length=100), nullable=False),
        sa.Column("slug", sa.String(length=100), nullable=False),
        sa.Column("creation_date", sa.String(), nullable=False, server_default=""),
        sa.UniqueConstraint("org_id", "resource_type", "slug", name="uq_slug_redirect_org_type_slug"),
    )
    op.create_index("ix_slug_redirect_resource_uuid", "resource_slug_redirect", ["resource_uuid"])


def downgrade() -> None:
    op.drop_index("ix_slug_redirect_resource_uuid", table_name="resource_slug_redirect")
    op.drop_table("resource_slug_redirect")
    for table in SEO_TABLES:
        op.drop_column(table, "seo")
    for table in SLUG_TABLES:
        op.drop_index(f"uq_{table}_org_slug", table_name=table)
        op.drop_column(table, "slug")
