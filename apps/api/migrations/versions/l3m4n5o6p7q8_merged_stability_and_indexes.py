"""Merged: stability fixes, soft delete, password_changed_at, all missing indexes

Revision ID: l3m4n5o6p7q8
Revises: y4z5a6b7c8d9
Create Date: 2026-04-16

Merges z5a6b7c8d9e0, j1k2l3m4n5o6, and k2l3m4n5o6p7 into a single
idempotent migration. All CREATE INDEX statements use IF NOT EXISTS and
all ADD COLUMN statements use IF NOT EXISTS so the migration is safe to
run against a DB that already has some of the objects.
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'l3m4n5o6p7q8'
down_revision: Union[str, None] = 'y4z5a6b7c8d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Columns ──────────────────────────────────────────────────────────────

    # user.password_changed_at (M-1)
    op.execute('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP')
    op.execute('UPDATE "user" SET password_changed_at = creation_date::timestamp WHERE password_changed_at IS NULL')

    # soft-delete columns (M-15)

    # ── Constraints ───────────────────────────────────────────────────────────

    # M-7: unique (chapter_id, activity_id) on chapteractivity
    # Dedupe first: legacy data may contain accidental duplicate rows from a
    # double-write bug (the higher-id row had `order` set to the activity_id).
    # Keep the lowest-id row per (chapter_id, activity_id) pair.
    op.execute("""
        DELETE FROM chapteractivity a
        USING chapteractivity b
        WHERE a.chapter_id = b.chapter_id
          AND a.activity_id = b.activity_id
          AND a.id > b.id
    """)
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'uq_chapteractivity_chapter_activity'
            ) THEN
                ALTER TABLE chapteractivity
                    ADD CONSTRAINT uq_chapteractivity_chapter_activity
                    UNIQUE (chapter_id, activity_id);
            END IF;
        END $$
    """)

    # ── Indexes ───────────────────────────────────────────────────────────────

    # chapter
    op.execute('CREATE INDEX IF NOT EXISTS ix_chapter_course_id   ON chapter (course_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_chapter_org_id      ON chapter (org_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_chapter_chapter_uuid ON chapter (chapter_uuid)')

    # activityversion
    op.execute('CREATE INDEX IF NOT EXISTS ix_activityversion_activity_id ON activityversion (activity_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_activityversion_org_id      ON activityversion (org_id)')

    # block
    op.execute('CREATE INDEX IF NOT EXISTS ix_block_org_id      ON block (org_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_block_course_id   ON block (course_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_block_activity_id ON block (activity_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_block_chapter_id  ON block (chapter_id)')

    # certifications / certificateuser
    op.execute('CREATE INDEX IF NOT EXISTS ix_certifications_course_id               ON certifications  (course_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_certificateuser_user_id                ON certificateuser (user_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_certificateuser_certification_id       ON certificateuser (certification_id)')
    op.execute('CREATE UNIQUE INDEX IF NOT EXISTS ix_certificateuser_user_certification_uuid ON certificateuser (user_certification_uuid)')

    # activity
    op.execute('CREATE INDEX IF NOT EXISTS ix_activity_last_modified_by_id ON activity (last_modified_by_id)')

    # coursechapter
    op.execute('CREATE INDEX IF NOT EXISTS ix_coursechapter_org_id ON coursechapter (org_id)')

    # course

    # usergroupresource
    op.execute('CREATE INDEX IF NOT EXISTS ix_ugr_resource_uuid ON usergroupresource (resource_uuid)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_ugr_usergroup_id  ON usergroupresource (usergroup_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_ugr_org_id        ON usergroupresource (org_id)')

    # usergroupuser
    op.execute('CREATE INDEX IF NOT EXISTS ix_ugu_user_id     ON usergroupuser (user_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_ugu_usergroup_id ON usergroupuser (usergroup_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_ugu_org_id      ON usergroupuser (org_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_ugu_user_org    ON usergroupuser (user_id, org_id)')

    # discussion
    op.execute('CREATE INDEX IF NOT EXISTS ix_discussion_community_id ON discussion (community_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_discussion_author_id    ON discussion (author_id)')

    # discussioncomment
    op.execute('CREATE INDEX IF NOT EXISTS ix_discussioncomment_discussion_id ON discussioncomment (discussion_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_discussioncomment_author_id     ON discussioncomment (author_id)')

    # discussionvote
    op.execute('CREATE INDEX IF NOT EXISTS ix_discussionvote_discussion_id ON discussionvote (discussion_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_discussionvote_user_id       ON discussionvote (user_id)')

    # discussioncommentvote
    op.execute('CREATE INDEX IF NOT EXISTS ix_discussioncommentvote_comment_id ON discussioncommentvote (comment_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_discussioncommentvote_user_id    ON discussioncommentvote (user_id)')


def downgrade() -> None:
    op.execute('DROP INDEX IF EXISTS ix_discussioncommentvote_user_id')
    op.execute('DROP INDEX IF EXISTS ix_discussioncommentvote_comment_id')
    op.execute('DROP INDEX IF EXISTS ix_discussionvote_user_id')
    op.execute('DROP INDEX IF EXISTS ix_discussionvote_discussion_id')
    op.execute('DROP INDEX IF EXISTS ix_discussioncomment_author_id')
    op.execute('DROP INDEX IF EXISTS ix_discussioncomment_discussion_id')
    op.execute('DROP INDEX IF EXISTS ix_discussion_author_id')
    op.execute('DROP INDEX IF EXISTS ix_discussion_community_id')
    op.execute('DROP INDEX IF EXISTS ix_ugu_user_org')
    op.execute('DROP INDEX IF EXISTS ix_ugu_org_id')
    op.execute('DROP INDEX IF EXISTS ix_ugu_usergroup_id')
    op.execute('DROP INDEX IF EXISTS ix_ugu_user_id')
    op.execute('DROP INDEX IF EXISTS ix_ugr_org_id')
    op.execute('DROP INDEX IF EXISTS ix_ugr_usergroup_id')
    op.execute('DROP INDEX IF EXISTS ix_ugr_resource_uuid')
    op.execute('DROP INDEX IF EXISTS ix_coursechapter_org_id')
    op.execute('DROP INDEX IF EXISTS ix_activity_last_modified_by_id')
    op.execute('DROP INDEX IF EXISTS ix_certificateuser_user_certification_uuid')
    op.execute('DROP INDEX IF EXISTS ix_certificateuser_certification_id')
    op.execute('DROP INDEX IF EXISTS ix_certificateuser_user_id')
    op.execute('DROP INDEX IF EXISTS ix_certifications_course_id')
    op.execute('DROP INDEX IF EXISTS ix_block_chapter_id')
    op.execute('DROP INDEX IF EXISTS ix_block_activity_id')
    op.execute('DROP INDEX IF EXISTS ix_block_course_id')
    op.execute('DROP INDEX IF EXISTS ix_block_org_id')
    op.execute('DROP INDEX IF EXISTS ix_activityversion_org_id')
    op.execute('DROP INDEX IF EXISTS ix_activityversion_activity_id')
    op.execute('DROP INDEX IF EXISTS ix_chapter_chapter_uuid')
    op.execute('DROP INDEX IF EXISTS ix_chapter_org_id')
    op.execute('DROP INDEX IF EXISTS ix_chapter_course_id')

    op.execute('ALTER TABLE chapteractivity DROP CONSTRAINT IF EXISTS uq_chapteractivity_chapter_activity')

    op.execute('ALTER TABLE "user"   DROP COLUMN IF EXISTS password_changed_at')
