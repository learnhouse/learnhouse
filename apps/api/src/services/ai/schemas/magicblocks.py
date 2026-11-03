from pydantic import BaseModel, Field
from typing import Optional, List

from src.services.ai.schemas.limits import (
    AI_CONTEXT_MAX_CHARS,
    AI_LABEL_MAX_CHARS,
    AI_MESSAGE_MAX_CHARS,
)


class MagicBlockContext(BaseModel):
    course_title: str = Field(max_length=AI_LABEL_MAX_CHARS)
    course_description: str = Field(max_length=AI_CONTEXT_MAX_CHARS)
    activity_name: str = Field(max_length=AI_LABEL_MAX_CHARS)
    activity_content_summary: str = Field(max_length=AI_CONTEXT_MAX_CHARS)


class StartMagicBlockSession(BaseModel):
    activity_uuid: str
    block_uuid: str
    prompt: str = Field(max_length=AI_MESSAGE_MAX_CHARS)
    context: MagicBlockContext
    # HTML of another block to match the design language of
    style_reference: Optional[str] = Field(default=None, max_length=100_000)


class SendMagicBlockMessage(BaseModel):
    session_uuid: str
    activity_uuid: str
    block_uuid: str
    message: str = Field(max_length=AI_MESSAGE_MAX_CHARS)
    # The current HTML content to iterate on (model-generated, so larger)
    current_html: Optional[str] = Field(default=None, max_length=100_000)
    # HTML of another block to match the design language of
    style_reference: Optional[str] = Field(default=None, max_length=100_000)


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
    user_id: Optional[int] = None
    revisions: List[MagicBlockRevision] = Field(default_factory=list)
