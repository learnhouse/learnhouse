from pydantic import BaseModel


class StartActivityAIChatSession(BaseModel):
    activity_uuid: str
    message: str

class ActivityAIChatSessionResponse(BaseModel):
    aichat_uuid: str
    activity_uuid: str
    message: str


class SendActivityAIChatMessage(BaseModel):
    aichat_uuid: str
    activity_uuid: str
    message: str
