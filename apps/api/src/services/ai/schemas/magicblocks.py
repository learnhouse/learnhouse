from pydantic import BaseModel
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


class SendMagicBlockMessage(BaseModel):
    session_uuid: str
    activity_uuid: str
    block_uuid: str
    message: str
    current_html: Optional[str] = None  # The current HTML content to iterate on


class MagicBlockMessage(BaseModel):
    role: str  # "user" or "model"
    content: str


class MagicBlockSessionResponse(BaseModel):
    session_uuid: str
    iteration_count: int
    max_iterations: int
    html_content: Optional[str]
    message_history: List[MagicBlockMessage]


class MagicBlockSessionData(BaseModel):
    session_uuid: str
    block_uuid: str
    activity_uuid: str
    iteration_count: int
    max_iterations: int
    message_history: List[MagicBlockMessage]
    current_html: Optional[str]
    context: MagicBlockContext
