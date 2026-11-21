"""Peer review on assignments

Adds three new tables (no existing table changes):

- ``assignment_peer_review_settings``: one row per assignment (opt-in toggle,
  rubric, prompts, practice samples, optional steps).
- ``assignment_peer_review``: one row per review (peer, self or calibration),
  with partial unique indexes so a reviewer reviews a given attempt once, has
  one self review and one answer per practice sample.
- ``assignment_peer_reflection``: one revision plan per learner and assignment.

The tables are new and empty, so the partial unique indexes are built inline.

Revision ID: p1r2v3w4a5s6
Revises: d8i2c3o4p5y6
Create Date: 2026-11-21 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'p1r2v3w4a5s6'
down_revision: Union[str, None] = 'd8i2c3o4p5y6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    if not inspector.has_table('assignment_peer_review_settings'):
        op.create_table(
            'assignment_peer_review_settings',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('assignment_id', sa.Integer(), sa.ForeignKey('assignment.id', ondelete='CASCADE'), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('enabled', sa.Boolean(), nullable=False),
            sa.Column('reviews_required', sa.Integer(), nullable=False),
            sa.Column('require_reviews_to_see_feedback', sa.Boolean(), nullable=False),
            sa.Column('review_due_date', sa.String(), nullable=True),
            sa.Column('anonymity', sa.String(32), nullable=False),
            sa.Column('self_review_enabled', sa.Boolean(), nullable=False),
            sa.Column('calibration_enabled', sa.Boolean(), nullable=False),
            sa.Column('helpfulness_enabled', sa.Boolean(), nullable=False),
            sa.Column('revision_plan_enabled', sa.Boolean(), nullable=False),
            sa.Column('prompts', sa.JSON(), nullable=True),
            sa.Column('rubric', sa.JSON(), nullable=False),
            sa.Column('score_mode', sa.String(32), nullable=False),
            sa.Column('min_reviews_for_score', sa.Integer(), nullable=False),
            sa.Column('calibration_samples', sa.JSON(), nullable=False),
            sa.Column('creation_date', sa.String(), nullable=False),
            sa.Column('update_date', sa.String(), nullable=False),
            sa.UniqueConstraint('assignment_id', name='uq_assignment_peer_review_settings_assignment'),
        )
        op.create_index(
            'ix_assignment_peer_review_settings_org_id', 'assignment_peer_review_settings', ['org_id']
        )

    if not inspector.has_table('assignment_peer_review'):
        op.create_table(
            'assignment_peer_review',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('review_uuid', sa.String(64), nullable=False),
            sa.Column('assignment_id', sa.Integer(), sa.ForeignKey('assignment.id', ondelete='CASCADE'), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('reviewer_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('reviewee_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=True),
            sa.Column('kind', sa.String(16), nullable=False),
            sa.Column('calibration_sample_id', sa.String(64), nullable=True),
            sa.Column('attempt_number', sa.Integer(), nullable=False),
            sa.Column('status', sa.String(16), nullable=False),
            sa.Column('scores', sa.JSON(), nullable=False),
            sa.Column('comments', sa.JSON(), nullable=False),
            sa.Column('criterion_comments', sa.JSON(), nullable=False),
            sa.Column('helpfulness', sa.Integer(), nullable=True),
            sa.Column('helpfulness_note', sa.Text(), nullable=True),
            sa.Column('flagged', sa.Boolean(), nullable=False),
            sa.Column('flag_reason', sa.Text(), nullable=True),
            sa.Column('discarded_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('discard_reason', sa.Text(), nullable=True),
            sa.Column('assigned_at', sa.String(), nullable=True),
            sa.Column('submitted_at', sa.String(), nullable=True),
            sa.Column('creation_date', sa.String(), nullable=False),
            sa.Column('update_date', sa.String(), nullable=False),
        )
        op.create_index(
            'ix_assignment_peer_review_review_uuid', 'assignment_peer_review', ['review_uuid'], unique=True
        )
        op.create_index(
            'uq_assignment_peer_review_peer', 'assignment_peer_review',
            ['assignment_id', 'reviewer_user_id', 'reviewee_user_id', 'attempt_number'],
            unique=True, postgresql_where=sa.text("kind = 'peer'"),
        )
        op.create_index(
            'uq_assignment_peer_review_self', 'assignment_peer_review',
            ['assignment_id', 'reviewer_user_id'],
            unique=True, postgresql_where=sa.text("kind = 'self'"),
        )
        op.create_index(
            'uq_assignment_peer_review_calibration', 'assignment_peer_review',
            ['assignment_id', 'reviewer_user_id', 'calibration_sample_id'],
            unique=True, postgresql_where=sa.text("kind = 'calibration'"),
        )
        op.create_index(
            'ix_assignment_peer_review_reviewee', 'assignment_peer_review', ['assignment_id', 'reviewee_user_id']
        )
        op.create_index(
            'ix_assignment_peer_review_reviewer', 'assignment_peer_review', ['assignment_id', 'reviewer_user_id']
        )

    if not inspector.has_table('assignment_peer_reflection'):
        op.create_table(
            'assignment_peer_reflection',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('assignment_id', sa.Integer(), sa.ForeignKey('assignment.id', ondelete='CASCADE'), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('plan', sa.Text(), nullable=False),
            sa.Column('creation_date', sa.String(), nullable=False),
            sa.Column('update_date', sa.String(), nullable=False),
            sa.UniqueConstraint('assignment_id', 'user_id', name='uq_assignment_peer_reflection_assignment_user'),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table('assignment_peer_reflection'):
        op.drop_table('assignment_peer_reflection')
    if inspector.has_table('assignment_peer_review'):
        op.drop_table('assignment_peer_review')
    if inspector.has_table('assignment_peer_review_settings'):
        op.drop_table('assignment_peer_review_settings')
