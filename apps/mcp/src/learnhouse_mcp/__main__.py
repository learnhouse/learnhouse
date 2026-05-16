"""Entry point: `python -m learnhouse_mcp` boots the Streamable HTTP server."""

import uvicorn

from .config import Settings
from .server import build_server


def main() -> None:
    settings = Settings.load()
    _, app = build_server(settings)
    uvicorn.run(
        app,
        host=settings.bind_host,
        port=settings.bind_port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
