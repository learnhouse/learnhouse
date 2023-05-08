
from typing import Any, Literal
from pydantic import BaseModel


class Block(BaseModel):
    block_id: str
    activity_id: str
    org_id: str
    block_type: Literal["quizBlock", "videoBlock", "pdfBlock", "imageBlock"]
    block_data: Any
