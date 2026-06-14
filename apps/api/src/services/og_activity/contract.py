from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ContractType(str, Enum):
    SCORM = "scorm"
    ASSIGNMENT = "assignment"
    DOCUMENT = "document"
    DYNAMIC_PAGE = "dynamic_page"
    AUDIO = "audio"


class ContractSource(BaseModel):
    origin: Literal["manual", "kb", "agent"]
    kb_id: Optional[str] = None
    kb_sha: Optional[str] = None
    skill_used: Optional[str] = None
    generated_at: Optional[str] = None


class ActivityContract(BaseModel):
    contract_version: str = "1.0"
    type: ContractType
    title: str
    summary: Optional[str] = None
    source: ContractSource
    payload: dict = Field(default_factory=dict)


def build_provenance(source: ContractSource) -> dict:
    """Map contract provenance to the snake_case extra_metadata convention."""
    provenance: dict = {"source": source.origin}
    if source.kb_id is not None:
        provenance["kb_id"] = source.kb_id
    if source.kb_sha is not None:
        provenance["kb_sha"] = source.kb_sha
    if source.skill_used is not None:
        provenance["skill_used"] = source.skill_used
    if source.generated_at is not None:
        provenance["generated_at"] = source.generated_at
    return provenance
