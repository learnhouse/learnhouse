"""Company spaces: companies as first-class customers of the academy

Adds the customer profile to ``company_account`` (slug, logo, brand color,
domains with auto-join, lifecycle, account owner, tags, notes, space
settings) and the ``company_member``, ``company_course`` (linked and
exclusive courses), ``company_announcement`` and ``company_event`` tables.

Revision ID: w4c7m2p9s3k1
Revises: v2c5s8e1a4t7
Create Date: 2026-11-10 23:50:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'w4c7m2p9s3k1'
down_revision: Union[str, None] = 'v2c5s8e1a4t7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = (
    ('slug', lambda: sa.Column('slug', sa.String(80), nullable=True)),
    ('logo_image', lambda: sa.Column('logo_image', sa.String(300), nullable=True)),
    ('brand_color', lambda: sa.Column('brand_color', sa.String(9), nullable=True)),
    ('description', lambda: sa.Column('description', sa.Text(), nullable=False, server_default='')),
    ('website', lambda: sa.Column('website', sa.String(300), nullable=True)),
    ('email_domains', lambda: sa.Column('email_domains', sa.JSON(), nullable=False, server_default='[]')),
    ('size', lambda: sa.Column('size', sa.String(16), nullable=True)),
    ('lifecycle', lambda: sa.Column('lifecycle', sa.String(16), nullable=False, server_default='active')),
    ('account_owner_user_id', lambda: sa.Column('account_owner_user_id', sa.Integer(),
                                                sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True)),
    ('tags', lambda: sa.Column('tags', sa.JSON(), nullable=False, server_default='[]')),
    ('notes', lambda: sa.Column('notes', sa.Text(), nullable=False, server_default='')),
    ('auto_join', lambda: sa.Column('auto_join', sa.Boolean(), nullable=False, server_default='false')),
    ('auto_assign', lambda: sa.Column('auto_assign', sa.Boolean(), nullable=False, server_default='false')),
    ('welcome_text', lambda: sa.Column('welcome_text', sa.Text(), nullable=False, server_default='')),
    ('show_directory', lambda: sa.Column('show_directory', sa.Boolean(), nullable=False, server_default='false')),
    ('last_activity_at', lambda: sa.Column('last_activity_at', sa.DateTime(), nullable=True)),
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if 'company_account' not in tables:
        return
    have = {c['name'] for c in inspector.get_columns('company_account')}
    for name, column in _COLUMNS:
        if name not in have:
            op.add_column('company_account', column())
    indexes = {i['name'] for i in inspector.get_indexes('company_account')}
    if 'uq_company_account_org_slug' not in indexes:
        op.create_index('uq_company_account_org_slug', 'company_account', ['org_id', 'slug'], unique=True)

    if 'company_member' not in tables:
        op.create_table(
            'company_member',
            sa.Column('company_id', sa.Integer(), sa.ForeignKey('company_account.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='CASCADE'), primary_key=True),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('source', sa.String(16), nullable=False, server_default='manual'),
            sa.Column('creation_date', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_company_member_user', 'company_member', ['org_id', 'user_id'])

    if 'company_course' not in tables:
        op.create_table(
            'company_course',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('company_id', sa.Integer(), sa.ForeignKey('company_account.id', ondelete='CASCADE'), nullable=False),
            sa.Column('course_id', sa.Integer(), sa.ForeignKey('course.id', ondelete='CASCADE'), nullable=False),
            sa.Column('exclusive', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('featured', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('creation_date', sa.DateTime(), nullable=False),
            sa.UniqueConstraint('company_id', 'course_id', name='uq_company_course'),
        )
        op.create_index('ix_company_course_company_id', 'company_course', ['company_id'])
        op.create_index('ix_company_course_course', 'company_course', ['course_id'])

    if 'company_announcement' not in tables:
        op.create_table(
            'company_announcement',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('announcement_uuid', sa.String(), nullable=False),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('company_id', sa.Integer(), sa.ForeignKey('company_account.id', ondelete='CASCADE'), nullable=False),
            sa.Column('author_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('title', sa.String(200), nullable=False),
            sa.Column('body', sa.Text(), nullable=False, server_default=''),
            sa.Column('pinned', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('creation_date', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_company_announcement_announcement_uuid', 'company_announcement', ['announcement_uuid'], unique=True)
        op.create_index('ix_company_announcement_company_id', 'company_announcement', ['company_id'])

    if 'company_event' not in tables:
        op.create_table(
            'company_event',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('org_id', sa.BigInteger(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
            sa.Column('company_id', sa.Integer(), sa.ForeignKey('company_account.id', ondelete='CASCADE'), nullable=False),
            sa.Column('kind', sa.String(48), nullable=False),
            sa.Column('actor_user_id', sa.Integer(), sa.ForeignKey('user.id', ondelete='SET NULL'), nullable=True),
            sa.Column('details', sa.JSON(), nullable=False, server_default='{}'),
            sa.Column('creation_date', sa.DateTime(), nullable=False),
        )
        op.create_index('ix_company_event_company', 'company_event', ['company_id', 'id'])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for name in ('company_event', 'company_announcement', 'company_course', 'company_member'):
        if name in tables:
            op.drop_table(name)
    if 'company_account' in tables:
        indexes = {i['name'] for i in inspector.get_indexes('company_account')}
        if 'uq_company_account_org_slug' in indexes:
            op.drop_index('uq_company_account_org_slug', table_name='company_account')
        have = {c['name'] for c in inspector.get_columns('company_account')}
        for name, _ in reversed(_COLUMNS):
            if name in have:
                op.drop_column('company_account', name)
