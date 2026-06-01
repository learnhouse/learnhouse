from pydantic import BaseModel, Field
from typing import Optional, List


class MagicBlockContext(BaseModel):
    course_title: str
    course_description: str
    activity_name: str
    activity_content_summary: str


class StartMagicBlockSession(BaseModel):
    activity_uuid: str
    block_uuid: str
    prompt: str
    context: MagicBlockContext
    style_reference: Optional[str] = None  # HTML of another block to match the design language of


class SendMagicBlockMessage(BaseModel):
    session_uuid: str
    activity_uuid: str
    block_uuid: str
    message: str
    current_html: Optional[str] = None  # The current HTML content to iterate on
    style_reference: Optional[str] = None  # HTML of another block to match the design language of


class MagicBlockMessage(BaseModel):
    role: str  # "user" or "model"
    content: str


class MagicBlockRevision(BaseModel):
    revision_uuid: str
    prompt: str
    html: str
    created_at: float  # unix timestamp


class MagicBlockSessionResponse(BaseModel):
    session_uuid: str
    iteration_count: int
    max_iterations: int
    html_content: Optional[str]
    message_history: List[MagicBlockMessage]
    revisions: List[MagicBlockRevision] = Field(default_factory=list)


class MagicBlockSessionData(BaseModel):
    session_uuid: str
    block_uuid: str
    activity_uuid: str
    iteration_count: int
    max_iterations: int
    message_history: List[MagicBlockMessage]
    current_html: Optional[str]
    context: MagicBlockContext
    revisions: List[MagicBlockRevision] = Field(default_factory=list)
