from typing import Optional

from pydantic import BaseModel, model_validator

from src.db.courses.activities import ActivityTypeEnum, ActivitySubTypeEnum
from src.services.og_activity.contract import ContractType
from src.services.og_activity.registry import ActivityTypeModule
from src.services.og_activity.spec import LearnHouseActivitySpec


class DynamicPagePayload(BaseModel):
    """A dynamic page is either raw markdown (OKF-style knowledge body) or
    structured TipTap blocks — exactly one must be set (setting both is
    rejected). An empty payload defaults to an empty blocks page (backward
    compatible with P1)."""

    blocks: Optional[list] = None
    markdown: Optional[str] = None

    @model_validator(mode="after")
    def _not_both(self):
        if self.markdown is not None and self.blocks is not None:
            raise ValueError("dynamic_page payload accepts either 'markdown' or 'blocks', not both")
        return self


class DynamicPageModule(ActivityTypeModule):
    contract_type = ContractType.DYNAMIC_PAGE
    payload_model = DynamicPagePayload

    def to_learnhouse(self, payload: DynamicPagePayload) -> LearnHouseActivitySpec:
        if payload.markdown is not None:
            return LearnHouseActivitySpec(
                activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
                activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_MARKDOWN,
                content={"markdown": payload.markdown},
            )
        return LearnHouseActivitySpec(
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content={"type": "doc", "content": payload.blocks or []},
        )

    def from_learnhouse(self, activity) -> dict:
        content = activity.content or {}
        if "markdown" in content:
            return {"markdown": content["markdown"]}
        return {"blocks": content.get("content", [])}
