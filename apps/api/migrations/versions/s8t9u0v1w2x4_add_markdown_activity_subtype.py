"""Add markdown activity subtype

Revision ID: s8t9u0v1w2x4
Revises: s8t9u0v1w2x3
Create Date: 2026-04-04 00:00:00.000000

Previously collided with ``s8t9u0v1w2x3_add_webhook_tables.py`` which also
declared ``revision = 's8t9u0v1w2x3'``. Renamed to ``s8t9u0v1w2x4`` and
chained after the webhook migration so the graph is unambiguous.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401
from alembic_postgresql_enum import TableReference  # type: ignore

# revision identifiers, used by Alembic.
revision: str = 's8t9u0v1w2x4'
down_revision: Union[str, None] = 's8t9u0v1w2x3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.sync_enum_values(
        'public',
        'activitysubtypeenum',
        ['SUBTYPE_DYNAMIC_PAGE', 'SUBTYPE_DYNAMIC_MARKDOWN', 'SUBTYPE_VIDEO_YOUTUBE', 'SUBTYPE_VIDEO_HOSTED', 'SUBTYPE_DOCUMENT_PDF', 'SUBTYPE_DOCUMENT_DOC', 'SUBTYPE_ASSIGNMENT_ANY', 'SUBTYPE_CUSTOM', 'SUBTYPE_SCORM_12', 'SUBTYPE_SCORM_2004'],
        [TableReference(table_schema='public', table_name='activity', column_name='activity_sub_type')],
        enum_values_to_rename=[]
    )


def downgrade() -> None:
    op.sync_enum_values(
        'public',
        'activitysubtypeenum',
        ['SUBTYPE_DYNAMIC_PAGE', 'SUBTYPE_VIDEO_YOUTUBE', 'SUBTYPE_VIDEO_HOSTED', 'SUBTYPE_DOCUMENT_PDF', 'SUBTYPE_DOCUMENT_DOC', 'SUBTYPE_ASSIGNMENT_ANY', 'SUBTYPE_CUSTOM', 'SUBTYPE_SCORM_12', 'SUBTYPE_SCORM_2004'],
        [TableReference(table_schema='public', table_name='activity', column_name='activity_sub_type')],
        enum_values_to_rename=[]
    )
