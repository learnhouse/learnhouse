"""Schemas for AI interactive-scenario generation (editor `scenarios` block).

The AI emits nodes keyed by a short ``ref`` string, and options link via
``next_ref`` (or null to end). The service resolves refs → stable ids and
produces the exact block shape the ScenariosExtension expects:
``{title, scenarios: [{id, text, imageUrl, options: [{id, text, nextScenarioId}]}], currentScenarioId}``.
Using refs (not real ids) keeps the branching valid regardless of how the model
orders nodes.
"""

from typing import List, Optional

from pydantic import BaseModel, Field


class GenScenarioOption(BaseModel):
    text: str
    # The ref of the scenario this option leads to; null/empty ends the scenario.
    next_ref: Optional[str] = None


class GenScenario(BaseModel):
    # Short stable label the AI uses to link nodes (e.g. "s1", "start", "win").
    ref: str
    text: str
    options: List[GenScenarioOption] = Field(default_factory=list)


class GeneratedScenarioSet(BaseModel):
    title: str = "Interactive Scenario"
    scenarios: List[GenScenario] = Field(default_factory=list)


# --- Request / response ---

class GenerateScenarioRequest(BaseModel):
    org_id: int
    prompt: str
    activity_uuid: Optional[str] = None
    session_uuid: Optional[str] = None
    num_scenarios: int = 5


class GenerateScenarioResponse(BaseModel):
    ai_generation_uuid: str
    session_uuid: str
    # Ready-to-insert `scenarios` block attrs: {title, scenarios, currentScenarioId}.
    scenario: dict


class AIScenarioHistoryItem(BaseModel):
    ai_generation_uuid: str
    session_uuid: Optional[str] = None
    prompt: str
    scenario: dict
    creation_date: Optional[str] = None
