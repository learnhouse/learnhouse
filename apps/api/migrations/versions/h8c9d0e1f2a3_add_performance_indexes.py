"""Add performance indexes for foreign key columns

Revision ID: h8c9d0e1f2a3
Revises: g7b8c9d0e1f2
Create Date: 2026-02-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'h8c9d0e1f2a3'
down_revision: Union[str, None] = 'g7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # resource_authors: resource_uuid and user_id are used in JOINs and WHERE clauses
    op.create_index('ix_resourceauthor_resource_uuid', 'resourceauthor', ['resource_uuid'])
    op.create_index('ix_resourceauthor_user_id', 'resourceauthor', ['user_id'])

    # user_organizations: user_id and org_id are used in JOINs and WHERE clauses
    op.create_index('ix_userorganization_user_id', 'userorganization', ['user_id'])
    op.create_index('ix_userorganization_org_id', 'userorganization', ['org_id'])

    # courses: course_uuid lookups and org_id filtering
    op.create_index('ix_course_course_uuid', 'course', ['course_uuid'])
    op.create_index('ix_course_org_id', 'course', ['org_id'])

    # activities: activity_uuid lookups and course_id filtering
    op.create_index('ix_activity_activity_uuid', 'activity', ['activity_uuid'])
    op.create_index('ix_activity_course_id', 'activity', ['course_id'])

    # trail_runs: trail_id, course_id, user_id used in WHERE clauses
    op.create_index('ix_trailrun_trail_id', 'trailrun', ['trail_id'])
    op.create_index('ix_trailrun_course_id', 'trailrun', ['course_id'])
    op.create_index('ix_trailrun_user_id', 'trailrun', ['user_id'])

    # trail_steps: trailrun_id, course_id, user_id used in WHERE clauses
    op.create_index('ix_trailstep_trailrun_id', 'trailstep', ['trailrun_id'])
    op.create_index('ix_trailstep_course_id', 'trailstep', ['course_id'])
    op.create_index('ix_trailstep_user_id', 'trailstep', ['user_id'])

    # trails: org_id and user_id used in WHERE clauses
    op.create_index('ix_trail_org_id', 'trail', ['org_id'])
    op.create_index('ix_trail_user_id', 'trail', ['user_id'])

    # chapter_activities: chapter_id and course_id used in JOINs and WHERE clauses
    op.create_index('ix_chapteractivity_chapter_id', 'chapteractivity', ['chapter_id'])
    op.create_index('ix_chapteractivity_course_id', 'chapteractivity', ['course_id'])

    # course_chapters: course_id and chapter_id used in JOINs and WHERE clauses
    op.create_index('ix_coursechapter_course_id', 'coursechapter', ['course_id'])
    op.create_index('ix_coursechapter_chapter_id', 'coursechapter', ['chapter_id'])

    # user: email (763K auth lookups/period) and user_uuid (63K lookups/period)
    op.create_index('ix_user_email', 'user', ['email'])
    op.create_index('ix_user_user_uuid', 'user', ['user_uuid'])

    # role: org_id used in RBAC join (514K calls/period)
    op.create_index('ix_role_org_id', 'role', ['org_id'])

    # resource_authors: composite index for (resource_uuid, user_id) RBAC lookups (504K calls/period)
    op.create_index('ix_resourceauthor_resource_uuid_user_id', 'resourceauthor', ['resource_uuid', 'user_id'])


def downgrade() -> None:
    op.drop_index('ix_resourceauthor_resource_uuid_user_id', 'resourceauthor')
    op.drop_index('ix_role_org_id', 'role')
    op.drop_index('ix_user_user_uuid', 'user')
    op.drop_index('ix_user_email', 'user')
    op.drop_index('ix_coursechapter_chapter_id', 'coursechapter')
    op.drop_index('ix_coursechapter_course_id', 'coursechapter')
    op.drop_index('ix_chapteractivity_course_id', 'chapteractivity')
    op.drop_index('ix_chapteractivity_chapter_id', 'chapteractivity')
    op.drop_index('ix_trail_user_id', 'trail')
    op.drop_index('ix_trail_org_id', 'trail')
    op.drop_index('ix_trailstep_user_id', 'trailstep')
    op.drop_index('ix_trailstep_course_id', 'trailstep')
    op.drop_index('ix_trailstep_trailrun_id', 'trailstep')
    op.drop_index('ix_trailrun_user_id', 'trailrun')
    op.drop_index('ix_trailrun_course_id', 'trailrun')
    op.drop_index('ix_trailrun_trail_id', 'trailrun')
    op.drop_index('ix_activity_course_id', 'activity')
    op.drop_index('ix_activity_activity_uuid', 'activity')
    op.drop_index('ix_course_org_id', 'course')
    op.drop_index('ix_course_course_uuid', 'course')
    op.drop_index('ix_userorganization_org_id', 'userorganization')
    op.drop_index('ix_userorganization_user_id', 'userorganization')
    op.drop_index('ix_resourceauthor_user_id', 'resourceauthor')
    op.drop_index('ix_resourceauthor_resource_uuid', 'resourceauthor')
