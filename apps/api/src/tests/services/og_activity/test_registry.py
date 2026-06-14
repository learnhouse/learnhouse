import pytest
from pydantic import BaseModel

from src.db.courses.activities import ActivityTypeEnum, ActivitySubTypeEnum
from src.services.og_activity.contract import ContractType
from src.services.og_activity.spec import LearnHouseActivitySpec
from src.services.og_activity.registry import (
    ActivityTypeModule,
    register,
    get_module,
    _REGISTRY,
)


class _DummyPayload(BaseModel):
    text: str


class _DummyModule(ActivityTypeModule):
    contract_type = ContractType.DYNAMIC_PAGE
    payload_model = _DummyPayload

    def to_learnhouse(self, payload: _DummyPayload) -> LearnHouseActivitySpec:
        return LearnHouseActivitySpec(
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content={"text": payload.text},
        )

    def from_learnhouse(self, activity) -> dict:
        return {"text": activity.content.get("text", "")}


def test_register_and_get_module():
    _REGISTRY.clear()
    module = _DummyModule()
    register(module)
    assert get_module(ContractType.DYNAMIC_PAGE) is module


def test_get_unknown_module_raises():
    _REGISTRY.clear()
    with pytest.raises(KeyError):
        get_module(ContractType.SCORM)
