"""Pydantic models for content migration from other LMS platforms."""

from typing import Optional
from pydantic import BaseModel


class UploadedFileInfo(BaseModel):
    """Info about a single uploaded file."""
    file_id: str
    filename: str
    file_type: str
    size: int
    extension: str


class MigrationUploadResponse(BaseModel):
    """Response from bulk file upload."""
    temp_id: str
    files: list[UploadedFileInfo]


class MigrationActivityNode(BaseModel):
    """An activity in the proposed tree structure."""
    name: str
    activity_type: str
    activity_sub_type: str
    file_ids: list[str]


class MigrationChapterNode(BaseModel):
    """A chapter in the proposed tree structure."""
    name: str
    activities: list[MigrationActivityNode]


class MigrationTreeStructure(BaseModel):
    """The full course tree structure (proposed by AI or built manually)."""
    course_name: str
    course_description: Optional[str] = None
    chapters: list[MigrationChapterNode]


class SuggestStructureRequest(BaseModel):
    """Request to AI for structure suggestion."""
    temp_id: str
    course_name: str
    description: Optional[str] = None


class CreateFromMigrationRequest(BaseModel):
    """Request to create a course from the migration tree."""
    temp_id: str
    structure: MigrationTreeStructure


class MigrationCreateResult(BaseModel):
    """Result of creating a course from migration."""
    course_uuid: str
    course_name: str
    chapters_created: int
    activities_created: int
    success: bool
    error: Optional[str] = None
