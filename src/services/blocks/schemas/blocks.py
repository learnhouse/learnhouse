
from typing import Any, List, Literal
from uuid import uuid4
from fastapi import Request
from pydantic import BaseModel


class Block(BaseModel):
    block_id: str
    lecture_id: str
    org_id: str
    block_type: Literal["quizBlock", "videoBlock", "pdfBlock"]
    block_data: Any
