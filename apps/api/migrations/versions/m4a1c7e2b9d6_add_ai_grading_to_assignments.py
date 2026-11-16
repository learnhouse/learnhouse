"""Add AI grading to assignments

Adds three nullable columns to ``assignment``:

- ``ai_grading_mode``              : OFF / SUGGEST / AUTO (native enum, like
                                     ``solution_reveal``). Defaults to SUGGEST:
                                     nothing runs until a teacher asks.
- ``ai_grading_instructions``      : the teacher's rubric for the model.
- ``ai_grading_task_instructions`` : per-task rubric lines, keyed by task uuid.

and the ``assignmentaigrade`` table: one AI grading result (draft or applied)
per learner and assignment.

Revision ID: m4a1c7e2b9d6
Revises: l2c8e5a1f7d3
Create Date: 2026-11-09 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'm4a1c7e2b9d6'
down_revision: Union[str, None] = 'l2c8e5a1f7d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


AI_GRADING_MODE_ENUM = sa.Enum('OFF', 'SUGGEST', 'AUTO', name='aigradingmodeenum')

_NEW_COLUMNS = (
    (
        'ai_grading_mode',
        lambda: sa.Column(
            'ai_grading_mode', AI_GRADING_MODE_ENUM, nullable=True, server_default='SUGGEST'
        ),
    ),
    ('ai_grading_instructions', lambda: sa.Column('ai_grading_instructions', sa.String(), nullable=True)),
    ('ai_grading_task_instructions', lambda: sa.Column('ai_grading_task_instructions', sa.JSON(), nullable=True)),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'assignment' in tables:
        existing = {col['name'] for col in inspector.get_columns('assignment')}
        if 'ai_grading_mode' not in existing:
            AI_GRADING_MODE_ENUM.create(bind, checkfirst=True)
        for name, make_column in _NEW_COLUMNS:
            if name not in existing:
                op.add_column('assignment', make_column())

    if 'assignmentaigrade' not in tables:
        op.create_table(
            'assignmentaigrade',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('assignment_ai_grade_uuid', sa.String(), nullable=False),
            sa.Column('assignment_id', sa.Integer(), sa.ForeignKey('assignment.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('status', sa.String(), nullable=False),
            sa.Column('mode', sa.String(), nullable=False),
            sa.Column('attempt_number', sa.Integer(), nullable=False),
            sa.Column('overall_feedback', sa.Text(), nullable=True),
            sa.Column('tasks', sa.JSON(), nullable=True),
            sa.Column('confidence', sa.String(), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('sources', sa.JSON(), nullable=True),
            sa.Column('credits_charged', sa.Integer(), nullable=False),
            sa.Column('model', sa.String(), nullable=True),
            sa.Column('error', sa.String(), nullable=True),
            sa.Column('triggered_by', sa.Integer(), nullable=True),
            sa.Column('applied_by', sa.Integer(), nullable=True),
            sa.Column('creation_date', sa.String(), nullable=False),
            sa.Column('update_date', sa.String(), nullable=False),
            sa.UniqueConstraint('assignment_id', 'user_id', name='uq_assignmentaigrade_assignment_user'),
        )
        op.create_index(
            'ix_assignmentaigrade_assignment_ai_grade_uuid', 'assignmentaigrade', ['assignment_ai_grade_uuid']
        )
        op.create_index('ix_assignmentaigrade_assignment_id', 'assignmentaigrade', ['assignment_id'])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'assignmentaigrade' in tables:
        op.drop_table('assignmentaigrade')

    if 'assignment' in tables:
        existing = {col['name'] for col in inspector.get_columns('assignment')}
        for name, _ in reversed(_NEW_COLUMNS):
            if name in existing:
                op.drop_column('assignment', name)
        if 'ai_grading_mode' in existing:
            AI_GRADING_MODE_ENUM.drop(bind, checkfirst=True)
