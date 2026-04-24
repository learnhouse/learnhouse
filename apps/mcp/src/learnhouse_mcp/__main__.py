from __future__ import annotations

import asyncio
import logging
import sys

from .middleware import LearnHouseAuthMiddleware
from .server import build_server


def main() -> None:
    try:
        mcp, client, settings = build_server()
    except RuntimeError as exc:
        sys.stderr.write(f"learnhouse-mcp: {exc}\n")
        sys.exit(2)

    try:
        import uvicorn
    except ImportError:
        sys.stderr.write(
            "learnhouse-mcp: the 'uvicorn' package is required to serve the MCP over HTTP. "
            "Install it with: pip install 'learnhouse-mcp[server]' or pip install uvicorn\n"
        )
        sys.exit(2)

    http_app = mcp.streamable_http_app()
    app = LearnHouseAuthMiddleware(http_app, client)

    logger = logging.getLogger("learnhouse_mcp")
    logger.info(
        "Starting LearnHouse MCP on http://%s:%d%s (API=%s)",
        settings.host,
        settings.port,
        settings.mount_path,
        settings.api_url,
    )

    try:
        uvicorn.run(
            app,
            host=settings.host,
            port=settings.port,
            log_level=settings.log_level.lower(),
        )
    except KeyboardInterrupt:
        sys.stderr.write("learnhouse-mcp: interrupted\n")
    finally:
        try:
            asyncio.run(client.aclose())
        except RuntimeError:
            pass


if __name__ == "__main__":
    main()
