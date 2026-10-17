from sqlalchemy import BigInteger, Column, Index
from sqlmodel import Field, SQLModel


class UsedLinkToken(SQLModel, table=True):
    """One row per sign-in link that has been redeemed.

    The primary key on ``jti`` is the single-use guarantee: the first redemption
    inserts the row, any replay hits the constraint. It lives in Postgres rather
    than Redis so a cache outage, eviction or flush cannot make an old link
    usable again. Rows are pruned once ``expires_at`` (the link's own JWT
    ``exp``, unix seconds) is well past, since the JWT is dead by then anyway.
    """

    __tablename__ = "used_link_token"
    __table_args__ = (
        Index("ix_used_link_token_expires_at", "expires_at"),
        {"extend_existing": True},
    )

    jti: str = Field(primary_key=True, max_length=128)
    purpose: str = Field(max_length=32)
    expires_at: int = Field(sa_column=Column(BigInteger, nullable=False))
