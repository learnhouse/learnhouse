from pydantic import BaseModel


class BlockFile(BaseModel):
    file_id: str
    file_format: str
    file_name: str
    file_size: int
    file_type: str
    activity_uuid: str