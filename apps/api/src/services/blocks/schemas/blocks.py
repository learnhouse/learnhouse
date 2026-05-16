
from typing import Any, Literal
from pydantic import BaseModel


class Block(BaseModel):
    block_id: str
    activity_id: int
    course_id: int
    org_id: int
    block_type: Literal["quizBlock", "videoBlock", "pdfBlock", "imageBlock"]
    block_data: Any
