"""Add ai_generation durable history table (and merge open heads)

Creates the ``aigeneration`` table that durably records AI-generated artifacts
the user kept (images, editor quizzes, assignment plans). The in-progress
multi-turn refine chat still lives ephemerally in Redis — this table is the
durable, queryable history surfaced in each feature's "History" tab.

The migration tree had multiple open heads when this was authored; this revision
also merges them (like the prior merge migration in this project) so
``alembic upgrade head`` resolves to a single head again.

Revision ID: f9e8d7c6b5a4
Revises: (merges all prior heads — see down_revision tuple)
Create Date: 2026-07-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401


# revision identifiers, used by Alembic.
revision: str = 'f9e8d7c6b5a4'
# Merge every open head at authoring time so the tree collapses to one head.
down_revision: Union[str, Sequence[str], None] = (
    'd4e5f6a7b8c9',
    'm3b4c5d6e7f8',
    '5e3a9c7f1b2d',
    'n4o5p6q7r8s9',
    'd3e4f5a6b7c8',
    'c1d2e3f4a5b6',
    'b2c3d4e5f8a9',
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'aigeneration' in inspector.get_table_names():
        return

    op.create_table(
        'aigeneration',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('ai_generation_uuid', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('kind', sa.Enum('IMAGE', 'QUIZ', 'ASSIGNMENT', name='aigenerationkind'), nullable=False),
        sa.Column('prompt', sa.Text(), nullable=False),
        sa.Column('session_uuid', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('result', sa.JSON(), nullable=False),
        sa.Column('creation_date', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('update_date', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
        sa.Column('org_id', sa.Integer(), nullable=True),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('course_id', sa.Integer(), nullable=True),
        sa.Column('activity_id', sa.Integer(), nullable=True),
        sa.Column('assignment_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['org_id'], ['organization.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['course_id'], ['course.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['activity_id'], ['activity.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['assignment_id'], ['assignment.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_aigeneration_org_id', 'aigeneration', ['org_id'])
    op.create_index('ix_aigeneration_user_id', 'aigeneration', ['user_id'])
    op.create_index('ix_aigeneration_kind', 'aigeneration', ['kind'])
    op.create_index(op.f('ix_aigeneration_ai_generation_uuid'), 'aigeneration', ['ai_generation_uuid'])
    op.create_index(op.f('ix_aigeneration_session_uuid'), 'aigeneration', ['session_uuid'])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if 'aigeneration' not in inspector.get_table_names():
        return

    op.drop_index(op.f('ix_aigeneration_session_uuid'), table_name='aigeneration')
    op.drop_index(op.f('ix_aigeneration_ai_generation_uuid'), table_name='aigeneration')
    op.drop_index('ix_aigeneration_kind', table_name='aigeneration')
    op.drop_index('ix_aigeneration_user_id', table_name='aigeneration')
    op.drop_index('ix_aigeneration_org_id', table_name='aigeneration')
    op.drop_table('aigeneration')
    sa.Enum(name='aigenerationkind').drop(bind, checkfirst=True)
