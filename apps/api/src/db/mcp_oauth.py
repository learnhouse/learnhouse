"""OAuth 2.1 storage for the MCP server.

LearnHouse is its own authorization server for `/mcp`: an MCP client (Claude,
ChatGPT, Cursor, ...) registers itself, sends the member through a consent
screen, and gets tokens that act as that member inside one organization.

* ``MCPOAuthClient``: a registered client (dynamic registration, RFC 7591).
* ``MCPOAuthGrant``: one member's consent for one client in one org. Revoking
  it kills every token issued under it.
* ``MCPOAuthCode``: a single-use authorization code (PKCE bound).
* ``MCPOAuthToken``: access and refresh tokens, stored as SHA-256 hashes only.

Times are unix seconds.
"""

from typing import Optional

from sqlalchemy import JSON, BigInteger, Column, ForeignKey, Index, Integer, String
from sqlmodel import Field, SQLModel


class MCPOAuthClient(SQLModel, table=True):
    __tablename__ = "mcp_oauth_client"
    __table_args__ = {"extend_existing": True}

    id: Optional[int] = Field(default=None, primary_key=True)
    client_id: str = Field(sa_column=Column(String(255), unique=True, nullable=False))
    client_secret_hash: Optional[str] = Field(default=None, max_length=64)
    client_name: str = Field(default="", max_length=200)
    client_uri: Optional[str] = Field(default=None, max_length=500)
    logo_uri: Optional[str] = Field(default=None, max_length=500)
    redirect_uris: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    token_endpoint_auth_method: str = Field(default="none", max_length=40)
    created_at: int = Field(sa_column=Column(BigInteger, nullable=False))


class MCPOAuthGrant(SQLModel, table=True):
    __tablename__ = "mcp_oauth_grant"
    __table_args__ = (
        Index("ix_mcp_oauth_grant_user_org", "user_id", "org_id"),
        Index("ix_mcp_oauth_grant_org_id", "org_id"),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    grant_uuid: str = Field(sa_column=Column(String(64), unique=True, nullable=False))
    client_id: str = Field(
        sa_column=Column(
            String(255),
            ForeignKey("mcp_oauth_client.client_id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    # Space separated, e.g. "mcp:read mcp:write".
    scope: str = Field(default="", max_length=200)
    # How the member was signed in when they consented (the session `amr`), so
    # the org's sign-in method policy keeps applying to the client.
    auth_method: Optional[str] = Field(default=None, max_length=40)
    created_at: int = Field(sa_column=Column(BigInteger, nullable=False))
    last_used_at: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    revoked_at: Optional[int] = Field(default=None, sa_column=Column(BigInteger))


class MCPOAuthCode(SQLModel, table=True):
    __tablename__ = "mcp_oauth_code"
    __table_args__ = (
        Index("ix_mcp_oauth_code_expires_at", "expires_at"),
        {"extend_existing": True},
    )

    code_hash: str = Field(primary_key=True, max_length=64)
    grant_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("mcp_oauth_grant.id", ondelete="CASCADE"), nullable=False
        )
    )
    redirect_uri: str = Field(sa_column=Column(String(2000), nullable=False))
    code_challenge: str = Field(max_length=128)
    resource: Optional[str] = Field(default=None, max_length=2000)
    scope: str = Field(default="", max_length=200)
    expires_at: int = Field(sa_column=Column(BigInteger, nullable=False))


class MCPOAuthToken(SQLModel, table=True):
    __tablename__ = "mcp_oauth_token"
    __table_args__ = (
        Index("ix_mcp_oauth_token_grant_id", "grant_id"),
        Index("ix_mcp_oauth_token_expires_at", "expires_at"),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    token_hash: str = Field(sa_column=Column(String(64), unique=True, nullable=False))
    # "access" or "refresh"
    kind: str = Field(max_length=10)
    grant_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("mcp_oauth_grant.id", ondelete="CASCADE"), nullable=False
        )
    )
    scope: str = Field(default="", max_length=200)
    resource: Optional[str] = Field(default=None, max_length=2000)
    created_at: int = Field(sa_column=Column(BigInteger, nullable=False))
    expires_at: int = Field(sa_column=Column(BigInteger, nullable=False))
    revoked_at: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
