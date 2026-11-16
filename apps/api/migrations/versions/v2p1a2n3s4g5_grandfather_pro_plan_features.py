"""Grandfather Pro organizations for the features that moved to Business

The V2 plans move live sessions, company seats and required training from Pro
to the new Business plan. Every organization on Pro when this runs keeps them
for a year: its config gets ``legacy_pro_until`` (read by the feature
resolver). Organizations that already have the stamp keep their date.

Revision ID: v2p1a2n3s4g5
Revises: t4r1a7l9d2g5
Create Date: 2026-11-16 12:00:00.000000
"""
from datetime import datetime, timedelta, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'v2p1a2n3s4g5'
down_revision: Union[str, None] = 't4r1a7l9d2g5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

GRACE_DAYS = 365


def upgrade() -> None:
    bind = op.get_bind()
    if not sa.inspect(bind).has_table('organizationconfig'):
        return
    until = (datetime.now(timezone.utc) + timedelta(days=GRACE_DAYS)).date().isoformat()
    # The plan lives at the top level in v2 configs and under cloud in v1 ones.
    bind.execute(
        sa.text(
            """
            UPDATE organizationconfig
            SET config = (config::jsonb || jsonb_build_object('legacy_pro_until', CAST(:until AS text)))::json
            WHERE config IS NOT NULL
              AND COALESCE(config::jsonb ->> 'plan', config::jsonb -> 'cloud' ->> 'plan') = 'pro'
              AND NOT (config::jsonb ? 'legacy_pro_until')
            """
        ),
        {"until": until},
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not sa.inspect(bind).has_table('organizationconfig'):
        return
    bind.execute(
        sa.text(
            "UPDATE organizationconfig SET config = (config::jsonb - 'legacy_pro_until')::json "
            "WHERE config IS NOT NULL AND config::jsonb ? 'legacy_pro_until'"
        )
    )
