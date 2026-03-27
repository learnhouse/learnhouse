from typing import Optional
from sqlmodel import SQLModel, Field, Column, JSON
from datetime import datetime


class CodeSubmission(SQLModel, table=True):
    __tablename__ = "code_submission"

    id: Optional[int] = Field(default=None, primary_key=True)
    submission_uuid: str = Field(index=True)
    user_id: int = Field(index=True)
    activity_uuid: str = Field(index=True)
    block_id: str = Field(index=True)
    language_id: int
    source_code: str
    results: dict = Field(default={}, sa_column=Column(JSON))
    passed: bool = False
    total_tests: int = 0
    passed_tests: int = 0
    execution_time_ms: Optional[int] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class CodeSubmissionRead(SQLModel):
    id: int
    submission_uuid: str
    language_id: int
    source_code: str
    results: dict
    passed: bool
    total_tests: int
    passed_tests: int
    execution_time_ms: Optional[int]
    created_at: str
