from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass
class TokenEntry:
    org_id: int
    org_slug: str
    user_uuid: str
    token_name: str
    expires_at: float


class TokenCache:
    """In-memory cache of API token → resolved org info.

    Short TTL so revoked tokens stop working within a minute or two without needing
    a signal from the LearnHouse API. One process-wide instance; safe under asyncio
    because Python dict ops are atomic under the GIL and we only ever swap whole
    entries, never mutate in place.
    """

    def __init__(self, ttl_seconds: float = 300.0, max_size: int = 10_000):
        self._ttl = ttl_seconds
        self._max = max_size
        self._store: dict[str, TokenEntry] = {}

    def get(self, token: str) -> TokenEntry | None:
        entry = self._store.get(token)
        if entry is None:
            return None
        if entry.expires_at < time.monotonic():
            self._store.pop(token, None)
            return None
        return entry

    def set(
        self,
        token: str,
        *,
        org_id: int,
        org_slug: str,
        user_uuid: str,
        token_name: str,
    ) -> TokenEntry:
        if len(self._store) >= self._max:
            self._evict()
        entry = TokenEntry(
            org_id=org_id,
            org_slug=org_slug,
            user_uuid=user_uuid,
            token_name=token_name,
            expires_at=time.monotonic() + self._ttl,
        )
        self._store[token] = entry
        return entry

    def invalidate(self, token: str) -> None:
        self._store.pop(token, None)

    def _evict(self) -> None:
        now = time.monotonic()
        for k, v in list(self._store.items()):
            if v.expires_at < now:
                self._store.pop(k, None)
        while len(self._store) >= self._max:
            self._store.pop(next(iter(self._store)))
