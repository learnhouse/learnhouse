"""Backoffice channels: own event routing and webhook-gone tracking

Adds ``platform_notification_rule.channel_managed``: the rule a channel edits
from its own settings (the events it receives), so a channel can be set up in
one place while the Rules tab keeps working for anything more advanced. And
``platform_notification_channel.gone_count``: consecutive "webhook no longer
exists" answers (HTTP 401/403/404 from Discord or Slack); the channel turns
itself off after a few in a row.

Revision ID: c7h4n5e6l7r8
Revises: x5c6a7p8s9t0
Create Date: 2026-11-18 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c7h4n5e6l7r8'
down_revision: Union[str, None] = 'x5c6a7p8s9t0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = (
    ('platform_notification_rule', 'channel_managed', sa.Boolean(), sa.false()),
    ('platform_notification_channel', 'gone_count', sa.Integer(), sa.text('0')),
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table, column, kind, default in COLUMNS:
        if not inspector.has_table(table):
            continue
        if column not in {c['name'] for c in inspector.get_columns(table)}:
            op.add_column(table, sa.Column(column, kind, nullable=False, server_default=default))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table, column, _kind, _default in COLUMNS:
        if inspector.has_table(table) and column in {c['name'] for c in inspector.get_columns(table)}:
            op.drop_column(table, column)
