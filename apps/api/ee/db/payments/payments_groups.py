from sqlmodel import SQLModel, Field, Column, BigInteger, ForeignKey, String
from typing import Optional
from datetime import datetime


class PaymentsGroup(SQLModel, table=True):
    __table_args__ = {'extend_existing': True}
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    name: str = Field(sa_column=Column(String))
    description: str = Field(default="", sa_column=Column(String))
    creation_date: datetime = Field(default_factory=datetime.now)
    update_date: datetime = Field(default_factory=datetime.now)


class PaymentsGroupResource(SQLModel, table=True):
    __table_args__ = {'extend_existing': True}
    id: Optional[int] = Field(default=None, primary_key=True)
    payments_group_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("paymentsgroup.id", ondelete="CASCADE"))
    )
    resource_uuid: str = Field(sa_column=Column(String))
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    creation_date: datetime = Field(default_factory=datetime.now)
    update_date: datetime = Field(default_factory=datetime.now)


class PaymentsGroupSync(SQLModel, table=True):
    """Links a PaymentsGroup to a UserGroup for automatic sync on enrollment activation."""
    __table_args__ = {'extend_existing': True}
    id: Optional[int] = Field(default=None, primary_key=True)
    payments_group_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("paymentsgroup.id", ondelete="CASCADE"))
    )
    usergroup_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("usergroup.id", ondelete="CASCADE"))
    )


class PaymentsOfferResource(SQLModel, table=True):
    """Direct resource link on an offer (for simple single-course sales, no group needed)."""
    __table_args__ = {'extend_existing': True}
    id: Optional[int] = Field(default=None, primary_key=True)
    offer_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("paymentsoffer.id", ondelete="CASCADE"))
    )
    resource_uuid: str = Field(sa_column=Column(String))
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    creation_date: datetime = Field(default_factory=datetime.now)
    update_date: datetime = Field(default_factory=datetime.now)


class PaymentsGroupRead(SQLModel):
    id: int
    org_id: int
    name: str
    description: str
    creation_date: datetime
    update_date: datetime


class PaymentsGroupCreate(SQLModel):
    name: str
    description: str = ""


class PaymentsGroupUpdate(SQLModel):
    name: str
    description: str = ""
