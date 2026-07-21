"""Add resource activity subtype

Revision ID: r5s6t7u8v9w0
Revises: f01de40de012
Create Date: 2026-07-07 00:00:00.000000

Adds SUBTYPE_DYNAMIC_RESOURCE to activitysubtypeenum so a course activity can
embed an existing Library resource (board / podcast / community / playground /
course) under the existing TYPE_DYNAMIC type.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401
from alembic_postgresql_enum import TableReference  # type: ignore

# revision identifiers, used by Alembic.
revision: str = 'r5s6t7u8v9w0'
down_revision: Union[str, None] = 'f01de40de012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.sync_enum_values(
        'public',
        'activitysubtypeenum',
        ['SUBTYPE_DYNAMIC_PAGE', 'SUBTYPE_DYNAMIC_MARKDOWN', 'SUBTYPE_DYNAMIC_EMBED', 'SUBTYPE_DYNAMIC_RESOURCE', 'SUBTYPE_VIDEO_YOUTUBE', 'SUBTYPE_VIDEO_HOSTED', 'SUBTYPE_DOCUMENT_PDF', 'SUBTYPE_DOCUMENT_DOC', 'SUBTYPE_ASSIGNMENT_ANY', 'SUBTYPE_CUSTOM', 'SUBTYPE_SCORM_12', 'SUBTYPE_SCORM_2004'],
        [TableReference(table_schema='public', table_name='activity', column_name='activity_sub_type')],
        enum_values_to_rename=[]
    )


def downgrade() -> None:
    op.sync_enum_values(
        'public',
        'activitysubtypeenum',
        ['SUBTYPE_DYNAMIC_PAGE', 'SUBTYPE_DYNAMIC_MARKDOWN', 'SUBTYPE_DYNAMIC_EMBED', 'SUBTYPE_VIDEO_YOUTUBE', 'SUBTYPE_VIDEO_HOSTED', 'SUBTYPE_DOCUMENT_PDF', 'SUBTYPE_DOCUMENT_DOC', 'SUBTYPE_ASSIGNMENT_ANY', 'SUBTYPE_CUSTOM', 'SUBTYPE_SCORM_12', 'SUBTYPE_SCORM_2004'],
        [TableReference(table_schema='public', table_name='activity', column_name='activity_sub_type')],
        enum_values_to_rename=[]
    )
