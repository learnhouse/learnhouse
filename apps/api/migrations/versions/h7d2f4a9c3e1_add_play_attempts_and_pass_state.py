"""Add play attempts and pass state

Plays gain conditions (availability, pass rules, time limits, question pools):

- ``playattempt``: one row per run of a play by a signed-in learner, with the
  server-chosen step order, timing, first-try results, the step reached
  (drop-off) and the server-side AI evaluations of AI-graded steps.
- ``playcompletion`` gains ``passed``, ``badge_tier`` and
  ``best_passed_score``. Existing rows were completions under the old
  "finishing is passing" rule, so they are marked passed.

Revision ID: h7d2f4a9c3e1
Revises: g6b9d2e4f1a7
Create Date: 2026-11-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'h7d2f4a9c3e1'
down_revision: Union[str, None] = 'g6b9d2e4f1a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # Plays are an Enterprise feature (models in the EE package): a community
    # install has none of these tables, and EE creates them at startup.
    if 'playcompletion' not in tables:
        return

    # A database built by create_all from the new models already has these.
    columns = {c["name"] for c in inspector.get_columns("playcompletion")}
    if "passed" not in columns:
        op.add_column(
            'playcompletion',
            sa.Column('passed', sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.execute(sa.text("UPDATE playcompletion SET passed = true"))
    if "badge_tier" not in columns:
        op.add_column('playcompletion', sa.Column('badge_tier', sa.String(length=16), nullable=True))
    if "best_passed_score" not in columns:
        op.add_column('playcompletion', sa.Column('best_passed_score', sa.Integer(), nullable=True))
        op.execute(sa.text("UPDATE playcompletion SET best_passed_score = best_score WHERE passed"))

    if 'playattempt' not in tables:
        op.create_table(
            'playattempt',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('attempt_uuid', sa.String(length=64), nullable=False, unique=True),
            sa.Column(
                'playground_id',
                sa.Integer(),
                sa.ForeignKey('playground.id', ondelete='CASCADE'),
                nullable=False,
            ),
            sa.Column(
                'user_id',
                sa.Integer(),
                sa.ForeignKey('user.id', ondelete='CASCADE'),
                nullable=True,
            ),
            sa.Column(
                'org_id',
                sa.Integer(),
                sa.ForeignKey('organization.id', ondelete='CASCADE'),
                nullable=False,
            ),
            sa.Column('step_ids', sa.JSON(), nullable=False),
            sa.Column('started_at', sa.String(), nullable=False, server_default=''),
            sa.Column('finished_at', sa.String(), nullable=True),
            sa.Column('status', sa.String(length=16), nullable=False, server_default='in_progress'),
            sa.Column('score', sa.Integer(), nullable=True),
            sa.Column('mistakes', sa.Integer(), nullable=True),
            sa.Column('elapsed_ms', sa.Integer(), nullable=True),
            sa.Column('results', sa.JSON(), nullable=True),
            sa.Column('reached_step_id', sa.String(length=64), nullable=True),
            sa.Column('ai_results', sa.JSON(), nullable=True),
        )
        op.create_index('ix_playattempt_playground_user', 'playattempt', ['playground_id', 'user_id'])
        op.create_index('ix_playattempt_user_org', 'playattempt', ['user_id', 'org_id'])


def downgrade() -> None:
    if 'playattempt' not in sa.inspect(op.get_bind()).get_table_names():
        return  # community install: the EE tables were never created
    op.drop_index('ix_playattempt_user_org', table_name='playattempt')
    op.drop_index('ix_playattempt_playground_user', table_name='playattempt')
    op.drop_table('playattempt')
    op.drop_column('playcompletion', 'best_passed_score')
    op.drop_column('playcompletion', 'badge_tier')
    op.drop_column('playcompletion', 'passed')
