"""Add documentation tables and update roles with docspaces permissions

Revision ID: j0e1f2a3b4c5
Revises: i9d0e1f2a3b4
Create Date: 2026-02-07 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa  # noqa: F401
import sqlmodel  # noqa: F401
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = 'j0e1f2a3b4c5'
down_revision: Union[str, None] = 'i9d0e1f2a3b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Default docspaces permissions per role
DOCSPACES_PERMISSIONS = {
    # Admin - full access
    1: {
        "action_create": True,
        "action_read": True,
        "action_read_own": True,
        "action_update": True,
        "action_update_own": True,
        "action_delete": True,
        "action_delete_own": True,
    },
    # Maintainer - full access
    2: {
        "action_create": True,
        "action_read": True,
        "action_read_own": True,
        "action_update": True,
        "action_update_own": True,
        "action_delete": True,
        "action_delete_own": True,
    },
    # Instructor - own only
    3: {
        "action_create": True,
        "action_read": True,
        "action_read_own": True,
        "action_update": False,
        "action_update_own": True,
        "action_delete": False,
        "action_delete_own": True,
    },
    # User - read only
    4: {
        "action_create": False,
        "action_read": True,
        "action_read_own": True,
        "action_update": False,
        "action_update_own": False,
        "action_delete": False,
        "action_delete_own": False,
    },
}


def upgrade() -> None:
    # ── Create DocSpace table ──
    op.create_table(
        'docspace',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('docspace_uuid', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('thumbnail_image', sa.String(), nullable=True, server_default=''),
        sa.Column('public', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('published', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('slug', sa.String(), nullable=False, server_default=''),
        sa.Column('seo', JSONB(), nullable=True),
        sa.Column('nav_config', JSONB(), nullable=True),
        sa.Column('creation_date', sa.String(), nullable=False),
        sa.Column('update_date', sa.String(), nullable=False),
    )
    op.create_index('ix_docspace_org_id', 'docspace', ['org_id'])
    op.create_index('ix_docspace_docspace_uuid', 'docspace', ['docspace_uuid'])

    # ── Create DocSection table ──
    op.create_table(
        'docsection',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('docspace_id', sa.Integer(), sa.ForeignKey('docspace.id', ondelete='CASCADE'), nullable=False),
        sa.Column('docsection_uuid', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('published', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('slug', sa.String(), nullable=False, server_default=''),
        sa.Column('icon', sa.String(), nullable=True),
        sa.Column('order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('creation_date', sa.String(), nullable=False),
        sa.Column('update_date', sa.String(), nullable=False),
    )
    op.create_index('ix_docsection_org_id', 'docsection', ['org_id'])
    op.create_index('ix_docsection_docspace_id', 'docsection', ['docspace_id'])
    op.create_index('ix_docsection_docsection_uuid', 'docsection', ['docsection_uuid'])

    # ── Create DocGroup table ──
    op.create_table(
        'docgroup',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('docspace_id', sa.Integer(), sa.ForeignKey('docspace.id', ondelete='CASCADE'), nullable=False),
        sa.Column('docsection_id', sa.Integer(), sa.ForeignKey('docsection.id', ondelete='CASCADE'), nullable=False),
        sa.Column('docgroup_uuid', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('group_type', sa.String(), nullable=False, server_default='STANDARD'),
        sa.Column('icon', sa.String(), nullable=True),
        sa.Column('api_config', JSONB(), nullable=True),
        sa.Column('order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('creation_date', sa.String(), nullable=False),
        sa.Column('update_date', sa.String(), nullable=False),
    )
    op.create_index('ix_docgroup_org_id', 'docgroup', ['org_id'])
    op.create_index('ix_docgroup_docspace_id', 'docgroup', ['docspace_id'])
    op.create_index('ix_docgroup_docsection_id', 'docgroup', ['docsection_id'])
    op.create_index('ix_docgroup_docgroup_uuid', 'docgroup', ['docgroup_uuid'])

    # ── Create DocPage table ──
    op.create_table(
        'docpage',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('org_id', sa.Integer(), sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False),
        sa.Column('docspace_id', sa.Integer(), sa.ForeignKey('docspace.id', ondelete='CASCADE'), nullable=False),
        sa.Column('docsection_id', sa.Integer(), sa.ForeignKey('docsection.id', ondelete='CASCADE'), nullable=False),
        sa.Column('docgroup_id', sa.Integer(), sa.ForeignKey('docgroup.id', ondelete='CASCADE'), nullable=True),
        sa.Column('parent_page_id', sa.Integer(), sa.ForeignKey('docpage.id', ondelete='CASCADE'), nullable=True),
        sa.Column('docpage_uuid', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('page_type', sa.String(), nullable=False, server_default='MARKDOWN'),
        sa.Column('icon', sa.String(), nullable=True),
        sa.Column('content', JSONB(), nullable=True),
        sa.Column('published', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('slug', sa.String(), nullable=False, server_default=''),
        sa.Column('order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('creation_date', sa.String(), nullable=False),
        sa.Column('update_date', sa.String(), nullable=False),
    )
    op.create_index('ix_docpage_org_id', 'docpage', ['org_id'])
    op.create_index('ix_docpage_docspace_id', 'docpage', ['docspace_id'])
    op.create_index('ix_docpage_docsection_id', 'docpage', ['docsection_id'])
    op.create_index('ix_docpage_docgroup_id', 'docpage', ['docgroup_id'])
    op.create_index('ix_docpage_parent_page_id', 'docpage', ['parent_page_id'])
    op.create_index('ix_docpage_docpage_uuid', 'docpage', ['docpage_uuid'])

    # ── Update existing roles: add docspaces permissions ──
    # Use raw SQL to update the JSON rights column for all existing roles
    conn = op.get_bind()

    # Update global roles (IDs 1-4)
    import json
    for role_id, perms in DOCSPACES_PERMISSIONS.items():
        perms_json = json.dumps(perms)
        conn.execute(
            sa.text(
                "UPDATE role SET rights = jsonb_set(COALESCE(CAST(rights AS jsonb), CAST('{}' AS jsonb)), '{docspaces}', CAST(:perms AS jsonb)) WHERE id = :role_id"
            ),
            {"perms": perms_json, "role_id": role_id},
        )

    # Update all organization-specific roles: give them admin-level docspace perms by default
    admin_perms_json = json.dumps(DOCSPACES_PERMISSIONS[1])
    conn.execute(
        sa.text(
            "UPDATE role SET rights = jsonb_set(COALESCE(CAST(rights AS jsonb), CAST('{}' AS jsonb)), '{docspaces}', CAST(:perms AS jsonb)) WHERE id NOT IN (1, 2, 3, 4) AND rights IS NOT NULL AND CAST(rights AS text) != ''"
        ),
        {"perms": admin_perms_json},
    )


def downgrade() -> None:
    # Remove docspaces from all roles
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE role SET rights = CAST(rights AS jsonb) - 'docspaces' WHERE rights IS NOT NULL AND CAST(rights AS text) != ''"
        )
    )

    # Drop tables in reverse order
    op.drop_index('ix_docpage_docpage_uuid')
    op.drop_index('ix_docpage_parent_page_id')
    op.drop_index('ix_docpage_docgroup_id')
    op.drop_index('ix_docpage_docsection_id')
    op.drop_index('ix_docpage_docspace_id')
    op.drop_index('ix_docpage_org_id')
    op.drop_table('docpage')

    op.drop_index('ix_docgroup_docgroup_uuid')
    op.drop_index('ix_docgroup_docsection_id')
    op.drop_index('ix_docgroup_docspace_id')
    op.drop_index('ix_docgroup_org_id')
    op.drop_table('docgroup')

    op.drop_index('ix_docsection_docsection_uuid')
    op.drop_index('ix_docsection_docspace_id')
    op.drop_index('ix_docsection_org_id')
    op.drop_table('docsection')

    op.drop_index('ix_docspace_docspace_uuid')
    op.drop_index('ix_docspace_org_id')
    op.drop_table('docspace')
