from typing import Optional

from sqlalchemy import BigInteger, Column, ForeignKey
from sqlmodel import Field, SQLModel


class MediaShareToken(SQLModel, table=True):
    """A random, opaque, revocable token for a copyable media share link.

    Each "Copy link" mints a NEW row, so the link is unique every time and is not
    derivable from the media_uuid. The token is NOT an access bypass — the resolve
    endpoint still enforces the requesting user's access to the media.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    token: str = Field(default="", index=True)
    media_uuid: str = Field(default="", index=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), index=True
        )
    )
    created_by_user_id: Optional[int] = None
    revoked: bool = False
    creation_date: str = ""
    update_date: str = ""
