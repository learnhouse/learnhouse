import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    lh_api_url: str
    bind_host: str
    bind_port: int
    request_timeout: float

    @classmethod
    def load(cls) -> "Settings":
        # Accept both `LEARNHOUSE_*` (matches the rest of the LH config) and
        # `MCP_*` / `LH_API_URL` short forms so the server is also runnable
        # standalone for external MCP clients.
        lh_api_url = (
            os.environ.get("LEARNHOUSE_API_URL")
            or os.environ.get("LH_API_URL")
            or "http://127.0.0.1:1337"
        ).rstrip("/")
        bind_host = (
            os.environ.get("LEARNHOUSE_MCP_HOST")
            or os.environ.get("MCP_BIND")
            or "127.0.0.1"
        )
        bind_port = int(
            os.environ.get("LEARNHOUSE_MCP_PORT")
            or os.environ.get("MCP_PORT")
            or "8765"
        )
        timeout = float(os.environ.get("MCP_REQUEST_TIMEOUT", "30"))
        return cls(
            lh_api_url=lh_api_url,
            bind_host=bind_host,
            bind_port=bind_port,
            request_timeout=timeout,
        )
