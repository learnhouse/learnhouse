"""Private learner notes on activities

Adds ``learner_note``: one person's note on one activity (sanitized TipTap
JSON plus its plain text for search) with an optional anchor (heading id,
block id or video second). Every foreign key cascades, so notes leave with
their author, organization, course or activity.

Revision ID: q2n7l4e8r1t5
Revises: u6g4r8p2m5k1
Create Date: 2026-11-11 23:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'q2n7l4e8r1t5'
down_revision: Union[str, None] = 'u6g4r8p2m5k1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if 'learner_note' in tables:
        return
    op.create_table(
        'learner_note',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('note_uuid', sa.String(), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
        sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=False),
        sa.Column('activity_id', sa.Integer(), sa.ForeignKey('activity.id', ondelete='CASCADE'), nullable=False),
        sa.Column('content', sa.JSON(), nullable=False),
        sa.Column('plain_text', sa.Text(), nullable=False, server_default=''),
        sa.Column('anchor_kind', sa.String(16), nullable=True),
        sa.Column('anchor_ref', sa.String(200), nullable=True),
        sa.Column('anchor_label', sa.String(200), nullable=True),
        sa.Column('anchor_seconds', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.String(), nullable=False),
        sa.Column('updated_at', sa.String(), nullable=False),
    )
    op.create_index('ix_learner_note_note_uuid', 'learner_note', ['note_uuid'], unique=True)
    op.create_index('ix_learner_note_org_id', 'learner_note', ['org_id'])
    op.create_index('ix_learner_note_course_id', 'learner_note', ['course_id'])
    op.create_index('ix_learner_note_activity_id', 'learner_note', ['activity_id'])
    op.create_index('ix_learner_note_user_activity', 'learner_note', ['user_id', 'activity_id'])
    op.create_index('ix_learner_note_user_org_course', 'learner_note', ['user_id', 'org_id', 'course_id'])


def downgrade() -> None:
    op.drop_table('learner_note')
