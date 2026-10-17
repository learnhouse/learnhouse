from typing import List
from pydantic import BaseModel, Field

from src.services.ai.schemas.limits import AI_MESSAGE_MAX_CHARS


class StartActivityAIChatSession(BaseModel):
    activity_uuid: str
    message: str = Field(max_length=AI_MESSAGE_MAX_CHARS)

class ActivityAIChatSessionResponse(BaseModel):
    aichat_uuid: str
    activity_uuid: str
    message: str


class SendActivityAIChatMessage(BaseModel):
    aichat_uuid: str
    activity_uuid: str
    message: str = Field(max_length=AI_MESSAGE_MAX_CHARS)


# Streaming response types
class StreamChunkResponse(BaseModel):
    """Single chunk of streaming response"""
    type: str = "chunk"
    content: str


class StreamDoneResponse(BaseModel):
    """Final response when streaming is complete"""
    type: str = "done"
    aichat_uuid: str
    activity_uuid: str
    follow_up_suggestions: List[str] = []


class StreamErrorResponse(BaseModel):
    """Error response during streaming"""
    type: str = "error"
    message: str


class ActivityAIChatSessionStreamResponse(BaseModel):
    """Response schema for streaming activity chat sessions"""
    aichat_uuid: str
    activity_uuid: str
    message: str
    follow_up_suggestions: List[str] = []
