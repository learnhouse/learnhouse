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


class UnsupportedContractTypeError(KeyError):
    """Raised when no activity type module is registered for a contract type.

    Subclasses KeyError so callers that broadly catch KeyError still work, but
    carries the offending type and a readable message instead of a bare key.
    """

    def __init__(self, contract_type: ContractType):
        self.contract_type = contract_type
        super().__init__(f"No activity type module registered for contract type {contract_type!r}")


class ActivityTypeRegistry:
    """A registry of activity type modules.

    A registry instance can be constructed and populated independently, which
    keeps tests isolated from the process-wide ``default_registry``. The
    module-level ``register``/``get_module`` helpers delegate to that default
    instance for the application's built-in types.
    """

    def __init__(self) -> None:
        self._modules: dict[ContractType, ActivityTypeModule] = {}

    def register(self, module: ActivityTypeModule) -> None:
        self._modules[module.contract_type] = module

    def get(self, contract_type: ContractType) -> ActivityTypeModule:
        try:
            return self._modules[contract_type]
        except KeyError:
            raise UnsupportedContractTypeError(contract_type) from None

    def snapshot(self) -> dict[ContractType, ActivityTypeModule]:
        """Return a shallow copy of the current registrations (for save/restore)."""
        return dict(self._modules)

    def restore(self, snapshot: dict[ContractType, ActivityTypeModule]) -> None:
        """Replace registrations with a previously taken snapshot."""
        self._modules = dict(snapshot)

    def clear(self) -> None:
        self._modules.clear()

    def __contains__(self, contract_type: ContractType) -> bool:
        return contract_type in self._modules


# Process-wide registry that holds the application's built-in types.
default_registry = ActivityTypeRegistry()


def register(module: ActivityTypeModule) -> None:
    default_registry.register(module)


def get_module(contract_type: ContractType) -> ActivityTypeModule:
    return default_registry.get(contract_type)
