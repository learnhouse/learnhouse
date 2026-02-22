from pydantic import BaseModel
from typing import Optional, List


class BoardsPlaygroundContext(BaseModel):
    board_name: str
    board_description: str


class StartBoardsPlaygroundSession(BaseModel):
    board_uuid: str
    block_uuid: str
    prompt: str
    context: BoardsPlaygroundContext


class SendBoardsPlaygroundMessage(BaseModel):
    session_uuid: str
    board_uuid: str
    block_uuid: str
    message: str
    current_html: Optional[str] = None


class BoardsPlaygroundMessage(BaseModel):
    role: str  # "user" or "model"
    content: str


class BoardsPlaygroundSessionResponse(BaseModel):
    session_uuid: str
    iteration_count: int
    max_iterations: int
    html_content: Optional[str]
    message_history: List[BoardsPlaygroundMessage]


class BoardsPlaygroundSessionData(BaseModel):
    session_uuid: str
    block_uuid: str
    board_uuid: str
    iteration_count: int
    max_iterations: int
    message_history: List[BoardsPlaygroundMessage]
    current_html: Optional[str]
    context: BoardsPlaygroundContext
