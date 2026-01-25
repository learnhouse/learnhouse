"""
SCORM Package and Runtime Data Models
Supports both SCORM 1.2 and SCORM 2004 standards
"""

from typing import Optional
from sqlalchemy import JSON, Column, ForeignKey, Integer, Text
from sqlmodel import Field, SQLModel
from enum import Enum


class ScormVersionEnum(str, Enum):
    SCORM_12 = "SCORM_12"
    SCORM_2004 = "SCORM_2004"


class CompletionStatusEnum(str, Enum):
    NOT_ATTEMPTED = "not_attempted"
    INCOMPLETE = "incomplete"
    COMPLETED = "completed"
    PASSED = "passed"
    FAILED = "failed"


class SuccessStatusEnum(str, Enum):
    PASSED = "passed"
    FAILED = "failed"
    UNKNOWN = "unknown"


# SCORM Package Model - stores metadata about uploaded SCORM packages
class ScormPackageBase(SQLModel):
    scorm_version: ScormVersionEnum
    manifest_data: dict = Field(default_factory=dict, sa_column=Column(JSON))
    entry_point: str  # Launch file path (e.g., "index.html" or "content/start.html")
    title: str
    identifier: str  # SCO identifier from manifest


class ScormPackage(ScormPackageBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    activity_id: int = Field(
        sa_column=Column(Integer, ForeignKey("activity.id", ondelete="CASCADE"))
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"))
    )
    package_uuid: str = ""
    creation_date: str = ""
    update_date: str = ""


class ScormPackageCreate(ScormPackageBase):
    activity_id: int
    org_id: int
    course_id: int


class ScormPackageRead(ScormPackageBase):
    id: int
    activity_id: int
    org_id: int
    course_id: int
    package_uuid: str
    creation_date: str
    update_date: str


# SCORM Runtime Data Model - stores user-specific CMI data
class ScormRuntimeDataBase(SQLModel):
    # Core completion data
    completion_status: CompletionStatusEnum = CompletionStatusEnum.NOT_ATTEMPTED
    success_status: SuccessStatusEnum = SuccessStatusEnum.UNKNOWN  # SCORM 2004

    # Score data
    score_raw: Optional[float] = None
    score_min: Optional[float] = None
    score_max: Optional[float] = None
    score_scaled: Optional[float] = None  # SCORM 2004 (-1 to 1)

    # Time tracking (ISO 8601 duration format)
    total_time: str = "PT0S"  # Total accumulated time
    session_time: str = "PT0S"  # Current session time

    # Bookmark and suspend data
    location: Optional[str] = None  # lesson_location in SCORM 1.2
    suspend_data: Optional[str] = Field(default=None, sa_column=Column(Text))

    # Full CMI data for flexibility (stores all SCORM data model elements)
    cmi_data: dict = Field(default_factory=dict, sa_column=Column(JSON))


class ScormRuntimeData(ScormRuntimeDataBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"))
    )
    activity_id: int = Field(
        sa_column=Column(Integer, ForeignKey("activity.id", ondelete="CASCADE"))
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    runtime_uuid: str = ""
    creation_date: str = ""
    update_date: str = ""


class ScormRuntimeDataCreate(ScormRuntimeDataBase):
    user_id: int
    activity_id: int
    org_id: int


class ScormRuntimeDataUpdate(SQLModel):
    completion_status: Optional[CompletionStatusEnum] = None
    success_status: Optional[SuccessStatusEnum] = None
    score_raw: Optional[float] = None
    score_min: Optional[float] = None
    score_max: Optional[float] = None
    score_scaled: Optional[float] = None
    total_time: Optional[str] = None
    session_time: Optional[str] = None
    location: Optional[str] = None
    suspend_data: Optional[str] = None
    cmi_data: Optional[dict] = None


class ScormRuntimeDataRead(ScormRuntimeDataBase):
    id: int
    user_id: int
    activity_id: int
    org_id: int
    runtime_uuid: str
    creation_date: str
    update_date: str


# Response models for API endpoints
class ScormScoInfo(SQLModel):
    """Information about a single SCO extracted from manifest"""
    identifier: str
    title: str
    launch_path: str
    prerequisites: Optional[str] = None
    max_time_allowed: Optional[str] = None
    time_limit_action: Optional[str] = None


class ScormAnalysisResponse(SQLModel):
    """Response from SCORM package analysis"""
    temp_package_id: str
    scorm_version: ScormVersionEnum
    package_title: str
    scos: list[ScormScoInfo]


class ScormScoAssignment(SQLModel):
    """Assignment of a SCO to a chapter"""
    sco_identifier: str
    chapter_id: int
    activity_name: str


class ScormImportRequest(SQLModel):
    """Request to import SCORM package with chapter assignments"""
    temp_package_id: str
    sco_assignments: list[ScormScoAssignment]


class ScormCourseImportScoAssignment(SQLModel):
    """Assignment of a SCO for course import (with chapter name instead of ID)"""
    sco_identifier: str
    activity_name: str
    chapter_name: str


class ScormCourseImportRequest(SQLModel):
    """Request to import SCORM package as a new course"""
    org_id: int
    temp_package_id: str
    course_name: str
    course_description: Optional[str] = ""
    sco_assignments: list[ScormCourseImportScoAssignment]


class ScormCourseImportResponse(SQLModel):
    """Response from importing SCORM as a new course"""
    course_uuid: str
    course_name: str
    activities_created: int
