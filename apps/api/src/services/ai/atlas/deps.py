"""AtlasDeps — what every turn needs to run.

Constructed once per `/chat` request in the router and threaded through
to the pydantic-ai agent via `RunContext.deps`. Tools and the translator
read from this; nothing mutates it.

`course_snapshot` is pre-fetched eagerly here (one DB hit + Redis-cache)
so the agent's first turn already has rich context to inject in the
prompt without an MCP round-trip.
"""

from dataclasses import dataclass, field
from typing import Any

import redis
from fastapi import Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.users import APITokenUser, PublicUser


@dataclass
class AtlasDeps:
    request: Request
    db: AsyncSession
    current_user: PublicUser | APITokenUser
    org_id: int
    org_slug: str
    aichat_uuid: str
    session_token: str
    page_context: dict[str, Any] | None
    references: list[dict[str, Any]] | None
    course_snapshot: dict[str, Any] | None
    redis_client: redis.Redis | None = None
    extra: dict[str, Any] = field(default_factory=dict)
