"""Add podcasts

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2025-01-31 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create podcast table
    op.create_table(
        'podcast',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('podcast_uuid', sa.String(), nullable=False, unique=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('about', sa.String(), nullable=True),
        sa.Column('tags', sa.String(), nullable=True),
        sa.Column('thumbnail_image', sa.String(), nullable=True, server_default=''),
        sa.Column('public', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('published', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('seo', JSONB(), nullable=True),
        sa.Column('creation_date', sa.String(), nullable=False),
        sa.Column('update_date', sa.String(), nullable=False),
    )

    # Create indexes for podcast
    op.create_index('ix_podcast_org_id', 'podcast', ['org_id'])
    op.create_index('ix_podcast_podcast_uuid', 'podcast', ['podcast_uuid'])

    # Create podcastepisode table
    op.create_table(
        'podcastepisode',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('podcast_id', sa.Integer(), sa.ForeignKey('podcast.id', ondelete='CASCADE'), nullable=False),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('episode_uuid', sa.String(), nullable=False, unique=True),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('audio_file', sa.String(), nullable=True, server_default=''),
        sa.Column('duration_seconds', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('episode_number', sa.Integer(), nullable=True, server_default='1'),
        sa.Column('thumbnail_image', sa.String(), nullable=True, server_default=''),
        sa.Column('published', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('creation_date', sa.String(), nullable=False),
        sa.Column('update_date', sa.String(), nullable=False),
    )

    # Create indexes for podcastepisode
    op.create_index('ix_podcastepisode_podcast_id', 'podcastepisode', ['podcast_id'])
    op.create_index('ix_podcastepisode_org_id', 'podcastepisode', ['org_id'])
    op.create_index('ix_podcastepisode_episode_uuid', 'podcastepisode', ['episode_uuid'])
    op.create_index('ix_podcastepisode_order', 'podcastepisode', ['podcast_id', 'order'])


def downgrade() -> None:
    # Drop podcastepisode indexes and table
    op.drop_index('ix_podcastepisode_order')
    op.drop_index('ix_podcastepisode_episode_uuid')
    op.drop_index('ix_podcastepisode_org_id')
    op.drop_index('ix_podcastepisode_podcast_id')
    op.drop_table('podcastepisode')

    # Drop podcast indexes and table
    op.drop_index('ix_podcast_podcast_uuid')
    op.drop_index('ix_podcast_org_id')
    op.drop_table('podcast')
