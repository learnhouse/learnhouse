"""Add messaging and agents

Direct messages, group chats, course broadcast channels, reactions, presence
preferences, reminders and the custom agents that replace the copilot.

Revision ID: 8d1f2c3b4a5e
Revises: 74cc74ce41c7
Create Date: 2026-11-02 18:00:00.000000

The models are also created by ``SQLModel.metadata.create_all`` on fresh
installs, so every step is guarded.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = '8d1f2c3b4a5e'
down_revision: Union[str, None] = '74cc74ce41c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_str = sqlmodel.sql.sqltypes.AutoString


def _has(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
    if not _has('agent'):
        op.create_table(
            'agent',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('agent_uuid', _str(), nullable=False, server_default=''),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('owner_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=True),
            sa.Column('name', _str(), nullable=False),
            sa.Column('description', _str(), nullable=False, server_default=''),
            sa.Column('emoji', _str(), nullable=False, server_default=''),
            sa.Column('color', _str(), nullable=False, server_default='#6366f1'),
            sa.Column('secondary_color', _str(), nullable=False, server_default='#a855f7'),
            sa.Column('instructions', sa.Text(), nullable=False, server_default=''),
            sa.Column('tone', _str(), nullable=False, server_default='friendly'),
            sa.Column('knowledge_mode', _str(), nullable=False, server_default='course_only'),
            sa.Column('course_uuids', sa.JSON(), nullable=True),
            sa.Column('greeting', _str(), nullable=False, server_default=''),
            sa.Column('starters', sa.JSON(), nullable=True),
            sa.Column('visibility', _str(), nullable=False, server_default='private'),
            sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('creation_date', _str(), nullable=False, server_default=''),
            sa.Column('update_date', _str(), nullable=False, server_default=''),
        )
        op.create_index('ix_agent_agent_uuid', 'agent', ['agent_uuid'])
        op.create_index('ix_agent_org_id', 'agent', ['org_id'])
        op.create_index('ix_agent_owner_user_id', 'agent', ['owner_user_id'])

    if not _has('conversation'):
        op.create_table(
            'conversation',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('conversation_uuid', _str(), nullable=False, server_default=''),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('kind', _str(), nullable=False, server_default='dm'),
            sa.Column('title', _str(), nullable=False, server_default=''),
            sa.Column('emoji', _str(), nullable=False, server_default=''),
            sa.Column('dm_key', _str(), nullable=True),
            sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=True),
            sa.Column('agent_id', sa.Integer(), sa.ForeignKey('agent.id', ondelete='CASCADE'), nullable=True),
            sa.Column('created_by', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('last_message_at', _str(), nullable=False, server_default=''),
            sa.Column('creation_date', _str(), nullable=False, server_default=''),
            sa.Column('update_date', _str(), nullable=False, server_default=''),
        )
        op.create_index('ix_conversation_conversation_uuid', 'conversation', ['conversation_uuid'])
        op.create_index('ix_conversation_org_id', 'conversation', ['org_id'])
        op.create_index('ix_conversation_org_kind', 'conversation', ['org_id', 'kind'])
        op.create_index('ix_conversation_dm_key', 'conversation', ['dm_key'])
        op.create_index('ix_conversation_course_id', 'conversation', ['course_id'])
        op.create_index('ix_conversation_agent_id', 'conversation', ['agent_id'])

    if not _has('conversationmember'):
        op.create_table(
            'conversationmember',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('conversation_id', sa.Integer(), sa.ForeignKey('conversation.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('role', _str(), nullable=False, server_default='member'),
            sa.Column('last_read_message_id', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('last_emailed_message_id', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('muted', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('pinned', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('archived', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('joined_at', _str(), nullable=False, server_default=''),
            sa.UniqueConstraint('conversation_id', 'user_id', name='uq_conversationmember_conv_user'),
        )
        op.create_index('ix_conversationmember_conversation_id', 'conversationmember', ['conversation_id'])
        op.create_index('ix_conversationmember_user_id', 'conversationmember', ['user_id'])

    if not _has('message'):
        op.create_table(
            'message',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('message_uuid', _str(), nullable=False, server_default=''),
            sa.Column('conversation_id', sa.Integer(), sa.ForeignKey('conversation.id', ondelete='CASCADE'), nullable=False),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('sender_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('sender_agent_id', sa.Integer(), sa.ForeignKey('agent.id', ondelete='SET NULL'), nullable=True),
            sa.Column('kind', _str(), nullable=False, server_default='text'),
            sa.Column('content', sa.Text(), nullable=False, server_default=''),
            sa.Column('attachment', sa.JSON(), nullable=True),
            sa.Column('reply_to_id', sa.Integer(), sa.ForeignKey('message.id', ondelete='SET NULL'), nullable=True),
            sa.Column('status', _str(), nullable=False, server_default='complete'),
            sa.Column('edited_at', _str(), nullable=True),
            sa.Column('deleted_at', _str(), nullable=True),
            sa.Column('creation_date', _str(), nullable=False, server_default=''),
        )
        op.create_index('ix_message_message_uuid', 'message', ['message_uuid'])
        op.create_index('ix_message_org_id', 'message', ['org_id'])
        op.create_index('ix_message_sender_user_id', 'message', ['sender_user_id'])
        op.create_index('ix_message_conversation_id_id', 'message', ['conversation_id', 'id'])

    if not _has('messagereaction'):
        op.create_table(
            'messagereaction',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('message_id', sa.Integer(), sa.ForeignKey('message.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('emoji', _str(), nullable=False),
            sa.Column('creation_date', _str(), nullable=False, server_default=''),
            sa.UniqueConstraint('message_id', 'user_id', 'emoji', name='uq_messagereaction_msg_user_emoji'),
        )
        op.create_index('ix_messagereaction_message_id', 'messagereaction', ['message_id'])

    if not _has('messagingprofile'):
        op.create_table(
            'messagingprofile',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('availability', _str(), nullable=False, server_default='auto'),
            sa.Column('status_emoji', _str(), nullable=False, server_default=''),
            sa.Column('status_text', _str(), nullable=False, server_default=''),
            sa.Column('status_expires_at', _str(), nullable=True),
            sa.Column('last_seen_at', _str(), nullable=True),
            sa.Column('allow_dms', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('email_mode', _str(), nullable=False, server_default='direct'),
            sa.Column('email_delay_minutes', sa.Integer(), nullable=False, server_default='60'),
            sa.Column('email_broadcasts', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('desktop_notifications', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('sounds', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('read_receipts', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('typing_indicators', sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column('update_date', _str(), nullable=False, server_default=''),
            sa.UniqueConstraint('user_id', name='uq_messagingprofile_user'),
        )

    if not _has('messagereminder'):
        op.create_table(
            'messagereminder',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('reminder_uuid', _str(), nullable=False, server_default=''),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False),
            sa.Column('conversation_id', sa.Integer(), sa.ForeignKey('conversation.id', ondelete='CASCADE'), nullable=False),
            sa.Column('agent_id', sa.Integer(), sa.ForeignKey('agent.id', ondelete='SET NULL'), nullable=True),
            sa.Column('text', sa.Text(), nullable=False),
            sa.Column('due_at', _str(), nullable=False),
            sa.Column('source_message_id', sa.Integer(), sa.ForeignKey('message.id', ondelete='SET NULL'), nullable=True),
            sa.Column('sent_at', _str(), nullable=True),
            sa.Column('cancelled_at', _str(), nullable=True),
            sa.Column('creation_date', _str(), nullable=False, server_default=''),
        )
        op.create_index('ix_messagereminder_reminder_uuid', 'messagereminder', ['reminder_uuid'])
        op.create_index('ix_messagereminder_org_id', 'messagereminder', ['org_id'])
        op.create_index('ix_messagereminder_user_id', 'messagereminder', ['user_id'])
        op.create_index('ix_messagereminder_due', 'messagereminder', ['sent_at', 'cancelled_at', 'due_at'])


def downgrade() -> None:
    for table in ('messagereminder', 'messagingprofile', 'messagereaction', 'message', 'conversationmember', 'conversation', 'agent'):
        if _has(table):
            op.drop_table(table)
