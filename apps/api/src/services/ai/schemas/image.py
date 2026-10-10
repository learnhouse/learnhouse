"""Request/response schemas for AI image generation (nano banana)."""

from typing import Optional

from pydantic import BaseModel, Field

from src.services.ai.schemas.limits import AI_MESSAGE_MAX_CHARS


class GenerateImageRequest(BaseModel):
    org_id: int
    prompt: str = Field(max_length=AI_MESSAGE_MAX_CHARS)
    # Ephemeral refine-session id (Redis). Omitted on the first generation; the
    # response returns a session_uuid to pass back on subsequent refine turns.
    session_uuid: Optional[str] = None
    # For iterative refinement / editing: the file_id of a previously-generated
    # AI image in THIS org. The backend reads its bytes straight from storage
    # (no client fetch → no CORS/credentials issues). Preferred over base64.
    source_file_id: Optional[str] = None
    # Fallback: the source image sent back as a base64 data URL (client-held).
    # ~15MB image as a base64 data URL
    source_image_base64: Optional[str] = Field(default=None, max_length=21_000_000)
    # Optional context the image is generated for (recorded in durable history).
    course_id: Optional[int] = None
    activity_id: Optional[int] = None


class GenerateImageResponse(BaseModel):
    ai_generation_uuid: str
    session_uuid: str
    file_id: str
    media_url: str
    prompt: str


class AIImageHistoryItem(BaseModel):
    ai_generation_uuid: str
    session_uuid: Optional[str] = None
    prompt: str
    file_id: str
    media_url: str
    creation_date: Optional[str] = None
