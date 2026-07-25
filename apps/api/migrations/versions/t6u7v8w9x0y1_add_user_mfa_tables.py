"""Add TOTP two-factor tables

Revision ID: t6u7v8w9x0y1
Revises: e9f0a1b2c3d4
Create Date: 2026-07-21 12:00:00.000000

Chains onto the current dev head (e9f0a1b2c3d4) so the migration graph stays a
single linear head — `alembic upgrade head` reaches these tables without a merge
revision.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = 't6u7v8w9x0y1'
down_revision: Union[str, None] = 'e9f0a1b2c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'usermfa',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'user_id',
            sa.Integer(),
            sa.ForeignKey('user.id', ondelete='CASCADE'),
            nullable=False,
        ),
        # Fernet ciphertext of the TOTP shared secret — never a plaintext seed.
        sa.Column('secret_encrypted', sa.String(), nullable=False, server_default=''),
        # NULL until the user proves the authenticator works. Only non-NULL rows
        # gate login.
        sa.Column('confirmed_at', sa.String(), nullable=True),
        sa.Column('last_used_timestep', sa.Integer(), nullable=True),
        sa.Column('creation_date', sa.String(), nullable=False, server_default=''),
        sa.Column('update_date', sa.String(), nullable=False, server_default=''),
    )
    # One factor per user; the unique index is what makes "enroll twice" a
    # database error rather than two live secrets.
    op.create_index('ix_user_mfa_user', 'usermfa', ['user_id'], unique=True)

    op.create_table(
        'usermfabackupcode',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'user_id',
            sa.Integer(),
            sa.ForeignKey('user.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('code_hash', sa.String(), nullable=False),
        sa.Column('used_at', sa.String(), nullable=True),
        sa.Column('creation_date', sa.String(), nullable=False, server_default=''),
    )
    op.create_index('ix_user_mfa_backup_user', 'usermfabackupcode', ['user_id'])
    # Verification hashes the submitted code and looks it up directly, so this
    # index is on the hot path of every recovery attempt.
    op.create_index(
        'ix_usermfabackupcode_code_hash', 'usermfabackupcode', ['code_hash']
    )


def downgrade() -> None:
    op.drop_index('ix_usermfabackupcode_code_hash', table_name='usermfabackupcode')
    op.drop_index('ix_user_mfa_backup_user', table_name='usermfabackupcode')
    op.drop_table('usermfabackupcode')

    op.drop_index('ix_user_mfa_user', table_name='usermfa')
    op.drop_table('usermfa')
