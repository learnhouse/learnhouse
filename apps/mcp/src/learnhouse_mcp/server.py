from __future__ import annotations

import logging

from mcp.server.fastmcp import FastMCP

from .cache import TokenCache
from .client import LearnHouseClient
from .config import Settings, load_settings

logger = logging.getLogger("learnhouse_mcp")


def build_server(settings: Settings | None = None) -> tuple[FastMCP, LearnHouseClient, Settings]:
    settings = settings or load_settings()
    logging.basicConfig(
        level=settings.log_level, format="%(levelname)s %(name)s: %(message)s"
    )

    mcp = FastMCP(
        "LearnHouse",
        instructions=(
            "You are connected to a LearnHouse organization via an API token. "
            "Use these tools to browse and manage courses, chapters, activities, "
            "collections, podcasts, certifications, and discussions within that "
            "organization. Destructive actions (delete, bulk remove) are "
            "irreversible — confirm with the user before calling them."
        ),
        streamable_http_path=settings.mount_path,
        host=settings.host,
        port=settings.port,
    )

    cache = TokenCache(
        ttl_seconds=settings.token_cache_ttl,
        max_size=settings.token_cache_max,
    )
    client = LearnHouseClient(settings, cache)

    from .tools import (
        activities as activities_tools,
        assignments as assignments_tools,
        certifications as certifications_tools,
        chapters as chapters_tools,
        collections as collections_tools,
        compose as compose_tools,
        courses as courses_tools,
        focus as focus_tools,
        instance as instance_tools,
        magicblocks as magicblocks_tools,
        podcasts as podcasts_tools,
        search as search_tools,
    )

    for module in (
        instance_tools,
        courses_tools,
        chapters_tools,
        activities_tools,
        assignments_tools,
        collections_tools,
        search_tools,
        podcasts_tools,
        certifications_tools,
        magicblocks_tools,
        compose_tools,
        focus_tools,
    ):
        module.register(mcp, client)

    return mcp, client, settings
