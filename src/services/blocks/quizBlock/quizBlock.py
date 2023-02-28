from typing import List, Literal
from uuid import uuid4
from fastapi import Request
from pydantic import BaseModel
from src.services.blocks.blocks import Block
from src.services.users import PublicUser


class option(BaseModel):
    option_id: str
    option_type: Literal["text", "image"]
    option_data: str


class answer(BaseModel):
    question_id: str
    option_id: str


class question(BaseModel):
    question_id: str
    question_value:str
    options: List[option]


class quizBlock(BaseModel):
    questions: List[question]
    answers: List[answer]


async def create_quiz_block(request: Request, quizBlock: quizBlock, lecture_id: str, user: PublicUser):
    blocks = request.app.db["blocks"]
    block_id = str(f"block_{uuid4()}")

    # create block
    block = Block(block_id=block_id, lecture_id=lecture_id,
                  block_type="quizBlock", block_data=quizBlock)

    # insert block
    blocks.insert_one(block.dict())

    return block


async def get_quiz_block_options(request: Request, block_id: str, user: PublicUser):
    blocks = request.app.db["blocks"]
    # find block but get only the options
    block = blocks.find_one({"block_id": block_id, }, {
                            "_id": 0, "block_data.answers": 0})

    return block

async def get_quiz_block_answers(request: Request, block_id: str, user: PublicUser):
    blocks = request.app.db["blocks"]
    
    # find block but get only the answers
    block = blocks.find_one({"block_id": block_id, }, {
                            "_id": 0, "block_data.questions": 0})

    return block
