"""Add missing performance indexes

Adds indexes that were absent from payment tables, collection tables, and
key query paths used in completion checks, discussion sorting, and audit logs.

Revision ID: a1b2c3d4e5f6
Revises: z5a6b7c8d9e0
Create Date: 2026-05-15

"""
from typing import Sequence, Union

from alembic import op
import sqlmodel  # noqa: F401

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "z5a6b7c8d9e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Payment tables — org_id / FK columns have no indexes at all
    op.create_index("ix_paymentsconfig_org_id", "paymentsconfig", ["org_id"], unique=False)
    op.create_index("ix_paymentsproduct_org_id", "paymentsproduct", ["org_id"], unique=False)
    op.create_index("ix_paymentsproduct_payments_config_id", "paymentsproduct", ["payments_config_id"], unique=False)
    op.create_index(
        "ix_paymentscourse_course_org_product",
        "paymentscourse",
        ["course_id", "org_id", "payment_product_id"],
        unique=False,
    )
    op.create_index(
        "ix_paymentsuser_user_org_product",
        "paymentsuser",
        ["user_id", "org_id", "payment_product_id"],
        unique=False,
    )

    # Collection tables
    op.create_index("ix_collection_org_id", "collection", ["org_id"], unique=False)
    op.create_index("ix_collection_collection_uuid", "collection", ["collection_uuid"], unique=False)
    op.create_index("ix_collectioncourse_collection_id", "collectioncourse", ["collection_id"], unique=False)
    op.create_index("ix_collectioncourse_course_id", "collectioncourse", ["course_id"], unique=False)

    # Completion checks — used by is_course_fully_completed and check_course_completion
    op.create_index(
        "ix_trailstep_course_user_complete",
        "trailstep",
        ["course_id", "user_id", "complete"],
        unique=False,
    )

    # Discussion hot/sorted listing
    op.create_index(
        "ix_discussion_community_pinned_date",
        "discussion",
        ["community_id", "is_pinned", "creation_date"],
        unique=False,
    )

    # Audit log org scoping
    op.create_index("ix_auditlog_org_id", "auditlog", ["org_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_auditlog_org_id", table_name="auditlog")
    op.drop_index("ix_discussion_community_pinned_date", table_name="discussion")
    op.drop_index("ix_trailstep_course_user_complete", table_name="trailstep")
    op.drop_index("ix_collectioncourse_course_id", table_name="collectioncourse")
    op.drop_index("ix_collectioncourse_collection_id", table_name="collectioncourse")
    op.drop_index("ix_collection_collection_uuid", table_name="collection")
    op.drop_index("ix_collection_org_id", table_name="collection")
    op.drop_index("ix_paymentsuser_user_org_product", table_name="paymentsuser")
    op.drop_index("ix_paymentscourse_course_org_product", table_name="paymentscourse")
    op.drop_index("ix_paymentsproduct_payments_config_id", table_name="paymentsproduct")
    op.drop_index("ix_paymentsproduct_org_id", table_name="paymentsproduct")
    op.drop_index("ix_paymentsconfig_org_id", table_name="paymentsconfig")
