from typing import Optional

from sqlalchemy import JSON, Column, ForeignKey, Integer
from sqlmodel import Field, SQLModel


class DemoStateEnum:
    PROVISIONING = "PROVISIONING"
    READY = "READY"
    REFRESHING = "REFRESHING"
    FAILED = "FAILED"


# The row id is pinned so concurrent writers contend on one row rather than
# racing to insert a second "singleton".
DEMO_STATE_ID = 1


class DemoState(SQLModel, table=True):
    """Singleton row describing the shared demo organization.

    Exactly one row, id=1. Holds the two pieces of state the scheduler needs
    that are not derivable from the data itself:

    * `bundle_version` — when the checked-in bundle changes, a refresh is not
      enough and the org is re-provisioned from scratch.
    * `content_epoch` — the anchor all backdated timestamps are computed from.
      It is rolled forward once a day, *not* on every refresh. If dates were
      recomputed from `now` each tick, every seeded row would change hourly and
      the whole point of refreshing in place would be lost.
    """

    __tablename__ = "demo_state"

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer,
            # SET NULL rather than CASCADE: if the org is torn down we still
            # want the state row (and its last_error) to survive for the next
            # provision to read.
            ForeignKey("organization.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    state: str = Field(default=DemoStateEnum.PROVISIONING, nullable=False)
    bundle_version: str = ""
    content_epoch: str = ""
    last_refresh_at: str = ""
    last_provision_at: str = ""
    last_step: str = ""
    last_error: Optional[str] = None
    stats: dict = Field(default_factory=dict, sa_column=Column(JSON))
    creation_date: str = ""
    update_date: str = ""
