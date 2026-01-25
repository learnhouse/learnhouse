from sqlmodel import SQLModel, Field, Column, BigInteger, ForeignKey
from typing import Optional
from datetime import datetime

class PaymentsCourseBase(SQLModel):
    course_id: int = Field(sa_column=Column(BigInteger, ForeignKey("course.id", ondelete="CASCADE")))

class PaymentsCourse(PaymentsCourseBase, table=True):
    __table_args__ = {'extend_existing': True}
    id: Optional[int] = Field(default=None, primary_key=True)
    payment_product_id: int = Field(sa_column=Column(BigInteger, ForeignKey("paymentsproduct.id", ondelete="CASCADE")))
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    creation_date: datetime = Field(default_factory=datetime.now)
    update_date: datetime = Field(default_factory=datetime.now)
