import pytest
from pydantic import BaseModel

from src.db.courses.activities import ActivityTypeEnum, ActivitySubTypeEnum
from src.services.og_activity.contract import ContractType
from src.services.og_activity.spec import LearnHouseActivitySpec
from src.services.og_activity.registry import (
    ActivityTypeModule,
    ActivityTypeRegistry,
    UnsupportedContractTypeError,
    register,
    get_module,
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


def test_registry_register_and_get():
    registry = ActivityTypeRegistry()
    module = _DummyModule()
    registry.register(module)
    assert registry.get(ContractType.DYNAMIC_PAGE) is module


def test_registry_get_unknown_raises_unsupported_type():
    registry = ActivityTypeRegistry()
    with pytest.raises(UnsupportedContractTypeError) as exc_info:
        registry.get(ContractType.SCORM)
    assert exc_info.value.contract_type is ContractType.SCORM
    # Still a KeyError subclass for callers that catch broadly.
    assert isinstance(exc_info.value, KeyError)


def test_snapshot_restore_round_trips():
    registry = ActivityTypeRegistry()
    snapshot = registry.snapshot()
    registry.register(_DummyModule())
    assert ContractType.DYNAMIC_PAGE in registry
    registry.restore(snapshot)
    assert ContractType.DYNAMIC_PAGE not in registry


def test_module_level_helpers_delegate_to_default_registry():
    # The autouse _isolate_registry fixture restores the default registry,
    # so registering here can't leak into other tests.
    module = _DummyModule()
    register(module)
    assert get_module(ContractType.DYNAMIC_PAGE) is module
