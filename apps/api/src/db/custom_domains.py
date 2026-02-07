from typing import Optional
from pydantic import BaseModel
from sqlalchemy import Column, ForeignKey, String, BigInteger
from sqlmodel import Field, SQLModel


class CustomDomainBase(SQLModel):
    """Base model for Custom Domains"""
    domain: str = Field(max_length=255)
    primary: bool = Field(default=False)


class CustomDomain(CustomDomainBase, table=True):
    """Database model for Custom Domains"""
    __tablename__ = "customdomain"
    __table_args__ = {"extend_existing": True}

    id: Optional[int] = Field(default=None, primary_key=True)
    domain_uuid: str = Field(default="", unique=True, index=True, max_length=100)  # format: domain_{uuid4()}
    domain: str = Field(sa_column=Column(String(255), unique=True, nullable=False))
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    status: str = Field(default="pending", max_length=50)  # pending | verified | active | failed
    verification_token: str = Field(default="", max_length=100)  # Random token for TXT record
    creation_date: str = ""
    update_date: str = ""
    verified_at: Optional[str] = None
    last_check_at: Optional[str] = None
    check_error: Optional[str] = None


class CustomDomainCreate(BaseModel):
    """Model for creating a new Custom Domain"""
    domain: str


class CustomDomainRead(BaseModel):
    """Model for reading a Custom Domain"""
    id: int
    domain_uuid: str
    domain: str
    org_id: int
    status: str
    primary: bool
    verification_token: str
    creation_date: str
    update_date: str
    verified_at: Optional[str] = None
    last_check_at: Optional[str] = None
    check_error: Optional[str] = None


class CustomDomainVerificationInfo(BaseModel):
    """Model containing DNS verification instructions"""
    domain: str
    status: str
    txt_record_host: str
    txt_record_value: str
    cname_record_host: str
    cname_record_value: str
    instructions: str


class CustomDomainResolveResponse(BaseModel):
    """Response model for domain resolution"""
    org_id: int
    org_slug: str
    org_uuid: str
