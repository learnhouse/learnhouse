"""Add step-by-step Plays: playground kind/content and play completions

Playgrounds (shown to users as "Plays") gain a structured kind next to the
original AI-generated HTML one:

- ``playground.kind``: 'html' (existing rows) or 'steps'.
- ``playground.content``: the versioned steps + badge definition (JSON).
- ``playcompletion``: one row per learner per play with the best score and
  the badge snapshot it earned (plus the days it was played, from which
  the learner's daily streak is derived).

Revision ID: f5a8c1d2e3b4
Revises: f5a8b3d0c2e4
Create Date: 2026-11-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f5a8c1d2e3b4'
down_revision: Union[str, None] = 'f5a8b3d0c2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # Plays are an Enterprise feature whose models live in the EE package. A
    # community install has no playground table: nothing to change here, and
    # EE creates the whole set at startup if it is added later.
    if 'playground' not in tables:
        return

    # A database built by create_all from the new models already has these.
    columns = {c["name"] for c in inspector.get_columns("playground")}
    if "kind" not in columns:
        op.add_column(
            'playground',
            sa.Column('kind', sa.String(length=16), nullable=False, server_default='html'),
        )
    if "content" not in columns:
        op.add_column('playground', sa.Column('content', sa.JSON(), nullable=True))

    if 'playcompletion' not in tables:
        op.create_table(
            'playcompletion',
            sa.Column('id', sa.Integer(), primary_key=True),
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
                nullable=False,
            ),
            sa.Column(
                'org_id',
                sa.Integer(),
                sa.ForeignKey('organization.id', ondelete='CASCADE'),
                nullable=False,
            ),
            sa.Column('best_score', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('last_score', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('attempts', sa.Integer(), nullable=False, server_default='1'),
            sa.Column('badge_awarded', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('badge', sa.JSON(), nullable=True),
            sa.Column('badge_awarded_at', sa.String(), nullable=True),
            sa.Column('completed_at', sa.String(), nullable=False, server_default=''),
            sa.Column('update_date', sa.String(), nullable=False, server_default=''),
            # Distinct days the play was finished on, for the daily streak.
            sa.Column('play_days', sa.JSON(), nullable=True),
            # One row per learner per play: replays update it, so a badge is
            # awarded at most once.
            sa.UniqueConstraint('playground_id', 'user_id', name='uq_playcompletion_playground_user'),
        )
        op.create_index('ix_playcompletion_playground_id', 'playcompletion', ['playground_id'])
        # Profile badge grid: a user's badges within one org.
        op.create_index('ix_playcompletion_user_org', 'playcompletion', ['user_id', 'org_id'])
    elif 'play_days' not in {c["name"] for c in inspector.get_columns('playcompletion')}:
        op.add_column('playcompletion', sa.Column('play_days', sa.JSON(), nullable=True))


def downgrade() -> None:
    if 'playcompletion' not in sa.inspect(op.get_bind()).get_table_names():
        return  # community install: the EE tables were never created
    op.drop_index('ix_playcompletion_user_org', table_name='playcompletion')
    op.drop_index('ix_playcompletion_playground_id', table_name='playcompletion')
    op.drop_table('playcompletion')
    op.drop_column('playground', 'content')
    op.drop_column('playground', 'kind')
