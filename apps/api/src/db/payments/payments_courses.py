from enum import Enum
from sqlmodel import SQLModel, Field, Column, BigInteger, ForeignKey, String, JSON
from typing import Optional
from datetime import datetime

class PaymentCourseBase(SQLModel):
    course_id: int = Field(sa_column=Column(BigInteger, ForeignKey("course.id", ondelete="CASCADE")))
    payment_product_id: int = Field(sa_column=Column(BigInteger, ForeignKey("paymentsproduct.id", ondelete="CASCADE")))
    org_id: int = Field(sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE")))

class PaymentCourse(PaymentCourseBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    creation_date: datetime = Field(default=datetime.now())
    update_date: datetime = Field(default=datetime.now())