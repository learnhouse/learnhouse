"""Add missing performance indexes

Adds indexes that were absent from payment tables, collection tables, and
key query paths used in completion checks, discussion sorting, and audit logs.

Revision ID: d3e4f5a6b7c8
Revises: z5a6b7c8d9e0
Create Date: 2026-05-15

"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect
import sqlmodel  # noqa: F401

revision: str = "d3e4f5a6b7c8"
down_revision: Union[str, None] = "z5a6b7c8d9e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# IF NOT EXISTS / IF EXISTS so the migration is safe to run against DBs
# where SQLModel.create_all() may have already created some of these indexes.
_UPGRADE_INDEXES = [
    ("ix_paymentsconfig_org_id", "paymentsconfig", "(org_id)"),
    ("ix_paymentsproduct_org_id", "paymentsproduct", "(org_id)"),
    ("ix_paymentsproduct_payments_config_id", "paymentsproduct", "(payments_config_id)"),
    ("ix_paymentscourse_course_org_product", "paymentscourse", "(course_id, org_id, payment_product_id)"),
    ("ix_paymentsuser_user_org_product", "paymentsuser", "(user_id, org_id, payment_product_id)"),
    ("ix_collection_org_id", "collection", "(org_id)"),
    ("ix_collection_collection_uuid", "collection", "(collection_uuid)"),
    ("ix_collectioncourse_collection_id", "collectioncourse", "(collection_id)"),
    ("ix_collectioncourse_course_id", "collectioncourse", "(course_id)"),
    ("ix_trailstep_course_user_complete", "trailstep", "(course_id, user_id, complete)"),
    ("ix_discussion_community_pinned_date", "discussion", "(community_id, is_pinned, creation_date)"),
    ("ix_auditlog_org_id", "auditlog", "(org_id)"),
]


def upgrade() -> None:
    # Skip indexes whose target table is missing — DBs vary by which payment /
    # collection tables have been provisioned.
    existing = set(inspect(op.get_bind()).get_table_names())
    for name, table, cols in _UPGRADE_INDEXES:
        if table in existing:
            op.execute(f'CREATE INDEX IF NOT EXISTS {name} ON {table} {cols}')


def downgrade() -> None:
    for name, _table, _cols in reversed(_UPGRADE_INDEXES):
        op.execute(f'DROP INDEX IF EXISTS {name}')
