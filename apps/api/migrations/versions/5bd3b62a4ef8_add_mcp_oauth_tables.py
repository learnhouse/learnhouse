"""Add the MCP OAuth tables

Clients, per-member grants, single-use authorization codes and hashed
access/refresh tokens for the OAuth 2.1 authorization server in front of /mcp.

Revision ID: 5bd3b62a4ef8
Revises: e8f9a0b1c2d3
Create Date: 2026-10-18 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '5bd3b62a4ef8'
down_revision: Union[str, None] = 'e8f9a0b1c2d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # create_all may already have built these on a fresh database.
    inspector = sa.inspect(op.get_bind())

    if not inspector.has_table('mcp_oauth_client'):
        op.create_table(
            'mcp_oauth_client',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('client_id', sa.String(255), nullable=False, unique=True),
            sa.Column('client_secret_hash', sa.String(64), nullable=True),
            sa.Column('client_name', sa.String(200), nullable=False, server_default=''),
            sa.Column('client_uri', sa.String(500), nullable=True),
            sa.Column('logo_uri', sa.String(500), nullable=True),
            sa.Column('redirect_uris', sa.JSON(), nullable=False),
            sa.Column(
                'token_endpoint_auth_method', sa.String(40), nullable=False,
                server_default='none',
            ),
            sa.Column('created_at', sa.BigInteger(), nullable=False),
        )

    if not inspector.has_table('mcp_oauth_grant'):
        op.create_table(
            'mcp_oauth_grant',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('grant_uuid', sa.String(64), nullable=False, unique=True),
            sa.Column(
                'client_id', sa.String(255),
                sa.ForeignKey('mcp_oauth_client.client_id', ondelete='CASCADE'),
                nullable=False,
            ),
            sa.Column(
                'user_id', sa.Integer(),
                sa.ForeignKey('user.id', ondelete='CASCADE'), nullable=False,
            ),
            sa.Column(
                'org_id', sa.Integer(),
                sa.ForeignKey('organization.id', ondelete='CASCADE'), nullable=False,
            ),
            sa.Column('scope', sa.String(200), nullable=False, server_default=''),
            sa.Column('auth_method', sa.String(40), nullable=True),
            sa.Column('created_at', sa.BigInteger(), nullable=False),
            sa.Column('last_used_at', sa.BigInteger(), nullable=True),
            sa.Column('revoked_at', sa.BigInteger(), nullable=True),
        )
        op.create_index(
            'ix_mcp_oauth_grant_user_org', 'mcp_oauth_grant', ['user_id', 'org_id']
        )
        op.create_index('ix_mcp_oauth_grant_org_id', 'mcp_oauth_grant', ['org_id'])

    if not inspector.has_table('mcp_oauth_code'):
        op.create_table(
            'mcp_oauth_code',
            sa.Column('code_hash', sa.String(64), primary_key=True),
            sa.Column(
                'grant_id', sa.Integer(),
                sa.ForeignKey('mcp_oauth_grant.id', ondelete='CASCADE'), nullable=False,
            ),
            sa.Column('redirect_uri', sa.String(2000), nullable=False),
            sa.Column('code_challenge', sa.String(128), nullable=False),
            sa.Column('resource', sa.String(2000), nullable=True),
            sa.Column('scope', sa.String(200), nullable=False, server_default=''),
            sa.Column('expires_at', sa.BigInteger(), nullable=False),
        )
        op.create_index('ix_mcp_oauth_code_expires_at', 'mcp_oauth_code', ['expires_at'])

    if not inspector.has_table('mcp_oauth_token'):
        op.create_table(
            'mcp_oauth_token',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
            sa.Column('kind', sa.String(10), nullable=False),
            sa.Column(
                'grant_id', sa.Integer(),
                sa.ForeignKey('mcp_oauth_grant.id', ondelete='CASCADE'), nullable=False,
            ),
            sa.Column('scope', sa.String(200), nullable=False, server_default=''),
            sa.Column('resource', sa.String(2000), nullable=True),
            sa.Column('created_at', sa.BigInteger(), nullable=False),
            sa.Column('expires_at', sa.BigInteger(), nullable=False),
            sa.Column('revoked_at', sa.BigInteger(), nullable=True),
        )
        op.create_index('ix_mcp_oauth_token_grant_id', 'mcp_oauth_token', ['grant_id'])
        op.create_index('ix_mcp_oauth_token_expires_at', 'mcp_oauth_token', ['expires_at'])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table in ('mcp_oauth_token', 'mcp_oauth_code', 'mcp_oauth_grant', 'mcp_oauth_client'):
        if inspector.has_table(table):
            op.drop_table(table)
