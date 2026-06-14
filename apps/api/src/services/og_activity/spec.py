from dataclasses import dataclass
from typing import Optional

from src.db.courses.activities import ActivityTypeEnum, ActivitySubTypeEnum


@dataclass
class LearnHouseActivitySpec:
    """Type-agnostic target shape an OG contract type maps to."""
    activity_type: ActivityTypeEnum
    activity_sub_type: ActivitySubTypeEnum
    content: dict
    details: Optional[dict] = None
