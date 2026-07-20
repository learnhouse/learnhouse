from typing import Optional
from sqlalchemy import JSON, Column, ForeignKey, UniqueConstraint
from sqlmodel import Field, SQLModel

class CertificationBase(SQLModel):
    course_id: int = Field(sa_column= Column("course_id", ForeignKey("course.id", ondelete="CASCADE")))
    config: dict = Field(default_factory=dict, sa_column= Column("config", JSON))

class Certifications(CertificationBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    certification_uuid: str = Field(unique=True)
    course_id: int = Field(sa_column= Column("course_id", ForeignKey("course.id", ondelete="CASCADE")))
    config: dict = Field(default_factory=dict, sa_column= Column("config", JSON))
    creation_date: str = ""
    update_date: str = ""

class CertificationCreate(SQLModel):
    course_id: int
    config: dict = Field(default_factory=dict)

class CertificationUpdate(SQLModel):
    config: Optional[dict] = None

class CertificationRead(SQLModel):
    id: int
    certification_uuid: str
    course_id: int
    config: dict
    creation_date: str
    update_date: str


class CertificateUserBase(SQLModel):
    user_id: int = Field(sa_column= Column("user_id", ForeignKey("user.id", ondelete="CASCADE")))
    certification_id: int = Field(sa_column= Column("certification_id", ForeignKey("certifications.id", ondelete="CASCADE")))
    user_certification_uuid: str

class CertificateUser(CertificateUserBase, table=True):
    # A user can hold at most one certificate per certification. Enforced in the
    # DB so a race between two concurrent completion checks (e.g. the submit path
    # and a parallel grade) can't create duplicate certificate rows.
    __table_args__ = (
        UniqueConstraint(
            "user_id", "certification_id", name="uq_certificateuser_user_certification"
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(sa_column= Column("user_id", ForeignKey("user.id", ondelete="CASCADE")))
    certification_id: int = Field(sa_column= Column("certification_id", ForeignKey("certifications.id", ondelete="CASCADE")))
    user_certification_uuid: str = Field(unique=True, index=True)
    created_at: str = ""
    updated_at: str = ""

class CertificateUserCreate(SQLModel):
    user_id: int
    certification_id: int
    user_certification_uuid: str

class CertificateUserRead(SQLModel):
    id: int
    user_id: int
    certification_id: int
    user_certification_uuid: str
    created_at: str
    updated_at: str

class CertificateUserUpdate(SQLModel):
    user_id: Optional[int] = None
    certification_id: Optional[int] = None
    user_certification_uuid: Optional[str] = None

