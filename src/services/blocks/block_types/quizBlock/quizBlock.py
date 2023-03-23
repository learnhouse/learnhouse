from typing import List, Literal
from uuid import uuid4
from fastapi import Request
from pydantic import BaseModel
from src.services.blocks.schemas.blocks import Block
from src.services.users.users import PublicUser


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


async def create_quiz_block(request: Request, quizBlock: quizBlock, activity_id: str, user: PublicUser):
    blocks = request.app.db["blocks"]
    activities = request.app.db["activities"]

    # Get org_id from activity
    activity = await activities.find_one({"activity_id": activity_id}, {"_id": 0, "org_id": 1})
    org_id = activity["org_id"]

    block_id = str(f"block_{uuid4()}")

    # create block
    block = Block(block_id=block_id, activity_id=activity_id,
                  block_type="quizBlock", block_data=quizBlock, org_id=org_id)

    # insert block
    await blocks.insert_one(block.dict())

    return block


async def get_quiz_block_options(request: Request, block_id: str, user: PublicUser):
    blocks = request.app.db["blocks"]
    # find block but get only the options
    block = await blocks.find_one({"block_id": block_id, }, {
                            "_id": 0, "block_data.answers": 0})

    return block

async def get_quiz_block_answers(request: Request, block_id: str, user: PublicUser):
    blocks = request.app.db["blocks"]
    
    # find block but get only the answers
    block = await blocks.find_one({"block_id": block_id, }, {
                            "_id": 0, "block_data.questions": 0})

    return block
