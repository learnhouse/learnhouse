from pydantic import BaseModel
from typing import Optional, List


class PlaygroundContext(BaseModel):
    playground_name: str
    playground_description: str
    course_uuid: Optional[str] = None
    course_name: Optional[str] = None


class StartPlaygroundSession(BaseModel):
    playground_uuid: str
    prompt: str
    context: PlaygroundContext


class SendPlaygroundMessage(BaseModel):
    session_uuid: str
    playground_uuid: str
    message: str
    current_html: Optional[str] = None


class PlaygroundMessage(BaseModel):
    role: str  # "user" or "model"
    content: str


class PlaygroundSessionResponse(BaseModel):
    session_uuid: str
    iteration_count: int
    max_iterations: int
    html_content: Optional[str]
    message_history: List[PlaygroundMessage]


class PlaygroundSessionData(BaseModel):
    session_uuid: str
    playground_uuid: str
    iteration_count: int
    max_iterations: int
    message_history: List[PlaygroundMessage]
    current_html: Optional[str]
    context: PlaygroundContext
