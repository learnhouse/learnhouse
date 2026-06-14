from pydantic import BaseModel, Field

from src.db.courses.activities import ActivityTypeEnum, ActivitySubTypeEnum
from src.services.og_activity.contract import ContractType
from src.services.og_activity.registry import ActivityTypeModule
from src.services.og_activity.spec import LearnHouseActivitySpec


class DynamicPagePayload(BaseModel):
    blocks: list = Field(default_factory=list)


class DynamicPageModule(ActivityTypeModule):
    contract_type = ContractType.DYNAMIC_PAGE
    payload_model = DynamicPagePayload

    def to_learnhouse(self, payload: DynamicPagePayload) -> LearnHouseActivitySpec:
        return LearnHouseActivitySpec(
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content={"type": "doc", "content": payload.blocks},
        )

    def from_learnhouse(self, activity) -> dict:
        return {"blocks": (activity.content or {}).get("content", [])}
