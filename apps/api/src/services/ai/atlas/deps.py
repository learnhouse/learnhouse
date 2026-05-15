"""Atlas dependency-injection container.

A single ``AtlasDeps`` value flows from the FastAPI router into the
pipeline, into every tool body (via pydantic-ai's ``RunContext.deps``).
This replaces the contextvar-based plumbing in the old MCP client and
gives tools direct, typed access to the DB session, the authenticated
caller, the per-chat session id, and the long-lived stores.

Why a dataclass over passing args:
  - pydantic-ai's ``Agent[Deps, Result]`` expects a single dependency
    object per run; this is it.
  - Service-layer functions all take ``(request, db, current_user, ...)``
    — packing those once means tool bodies stay one-liners.
  - The pending/snapshot stores live for the lifetime of one HTTP
    request (re-instantiated per turn), keeping their Redis connections
    scoped.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional, Union

from fastapi import Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.auth import resolve_acting_user_id

if TYPE_CHECKING:
    from src.services.ai.atlas.pending import PendingStore
    from src.services.ai.atlas.snapshots import SnapshotCache


@dataclass
class AtlasDeps:
    """All the context one Atlas turn needs.

    Built by the router's ``/chat`` endpoint and threaded through the
    pipeline. Read-only from the tools' perspective — anything they
    persist must go through ``pending_store`` or ``snapshot_cache``.
    """

    db: AsyncSession
    request: Request
    current_user: Union[PublicUser, AnonymousUser, APITokenUser]
    org_id: int
    aichat_uuid: str
    session_token: str
    pending_store: "PendingStore"
    snapshot_cache: "SnapshotCache"
    extra: dict = field(default_factory=dict)

    @property
    def acting_user_id(self) -> int:
        """The *real* user id behind the authenticated principal.

        Atlas typically runs under an APITokenUser (id=0); writes need
        the creator's real id. See ``security.auth.resolve_acting_user_id``.
        """
        return resolve_acting_user_id(self.current_user)

    @property
    def org_id_safe(self) -> int:
        return int(self.org_id)
