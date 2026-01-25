"""Add SCORM activity types

Revision ID: f8a3c2d1e5b7
Revises: 9e031a0358d1
Create Date: 2026-01-25 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa # noqa: F401
import sqlmodel # noqa: F401
from alembic_postgresql_enum import TableReference # type: ignore

# revision identifiers, used by Alembic.
revision: str = 'f8a3c2d1e5b7'
down_revision: Union[str, None] = '9e031a0358d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add TYPE_SCORM to activitytypeenum
    op.sync_enum_values(
        'public',
        'activitytypeenum',
        ['TYPE_VIDEO', 'TYPE_DOCUMENT', 'TYPE_DYNAMIC', 'TYPE_ASSIGNMENT', 'TYPE_CUSTOM', 'TYPE_SCORM'],
        [TableReference(table_schema='public', table_name='activity', column_name='activity_type')],
        enum_values_to_rename=[]
    )

    # Add SCORM subtypes to activitysubtypeenum
    op.sync_enum_values(
        'public',
        'activitysubtypeenum',
        ['SUBTYPE_DYNAMIC_PAGE', 'SUBTYPE_VIDEO_YOUTUBE', 'SUBTYPE_VIDEO_HOSTED', 'SUBTYPE_DOCUMENT_PDF', 'SUBTYPE_DOCUMENT_DOC', 'SUBTYPE_ASSIGNMENT_ANY', 'SUBTYPE_CUSTOM', 'SUBTYPE_SCORM_12', 'SUBTYPE_SCORM_2004'],
        [TableReference(table_schema='public', table_name='activity', column_name='activity_sub_type')],
        enum_values_to_rename=[]
    )


def downgrade() -> None:
    # Remove SCORM types (revert to previous enum values)
    op.sync_enum_values(
        'public',
        'activitytypeenum',
        ['TYPE_VIDEO', 'TYPE_DOCUMENT', 'TYPE_DYNAMIC', 'TYPE_ASSIGNMENT', 'TYPE_CUSTOM'],
        [TableReference(table_schema='public', table_name='activity', column_name='activity_type')],
        enum_values_to_rename=[]
    )

    op.sync_enum_values(
        'public',
        'activitysubtypeenum',
        ['SUBTYPE_DYNAMIC_PAGE', 'SUBTYPE_VIDEO_YOUTUBE', 'SUBTYPE_VIDEO_HOSTED', 'SUBTYPE_DOCUMENT_PDF', 'SUBTYPE_DOCUMENT_DOC', 'SUBTYPE_ASSIGNMENT_ANY', 'SUBTYPE_CUSTOM'],
        [TableReference(table_schema='public', table_name='activity', column_name='activity_sub_type')],
        enum_values_to_rename=[]
    )
