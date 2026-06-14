from abc import ABC, abstractmethod
from typing import ClassVar

from pydantic import BaseModel

from src.db.courses.activities import Activity, ActivityRead
from src.services.og_activity.contract import ContractType
from src.services.og_activity.spec import LearnHouseActivitySpec


class ActivityTypeModule(ABC):
    """One contract type: how to validate its payload and map it to/from LearnHouse."""
    contract_type: ClassVar[ContractType]
    payload_model: ClassVar[type[BaseModel]]

    def validate(self, payload: dict) -> BaseModel:
        return self.payload_model.model_validate(payload)

    @abstractmethod
    def to_learnhouse(self, payload: BaseModel) -> LearnHouseActivitySpec:
        ...

    @abstractmethod
    def from_learnhouse(self, activity: "Activity | ActivityRead") -> dict:
        ...


_REGISTRY: dict[ContractType, ActivityTypeModule] = {}


def register(module: ActivityTypeModule) -> None:
    _REGISTRY[module.contract_type] = module


def get_module(contract_type: ContractType) -> ActivityTypeModule:
    return _REGISTRY[contract_type]
