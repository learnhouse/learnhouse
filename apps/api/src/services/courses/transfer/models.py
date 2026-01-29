"""
Pydantic models for course transfer (export/import)
"""

from typing import Optional
from pydantic import BaseModel


class ExportCourseInfo(BaseModel):
    """Information about a course in the export manifest"""
    course_uuid: str
    name: str
    path: str


class ExportManifest(BaseModel):
    """Manifest file for exported package"""
    version: str = "1.0.0"
    format: str = "learnhouse-course-export"
    created_at: str
    courses: list[ExportCourseInfo]


class ImportCourseInfo(BaseModel):
    """Information about a course found in an import package"""
    course_uuid: str
    name: str
    description: Optional[str] = None
    chapters_count: int = 0
    activities_count: int = 0
    has_thumbnail: bool = False


class ImportAnalysisResponse(BaseModel):
    """Response from analyzing an import package"""
    temp_id: str
    version: str
    courses: list[ImportCourseInfo]


class ImportOptions(BaseModel):
    """Options for importing courses"""
    course_uuids: list[str]  # Which courses to import from the package
    name_prefix: Optional[str] = None  # Prefix to add to course names
    set_private: bool = True  # Make imported courses private
    set_unpublished: bool = True  # Make imported courses unpublished


class ImportCourseResult(BaseModel):
    """Result for a single course import"""
    original_uuid: str
    new_uuid: str
    name: str
    success: bool
    error: Optional[str] = None


class ImportResult(BaseModel):
    """Result of importing courses"""
    total_courses: int
    successful: int
    failed: int
    courses: list[ImportCourseResult]
