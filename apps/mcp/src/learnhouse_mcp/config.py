import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    api_url: str
    host: str
    port: int
    mount_path: str
    token_cache_ttl: float
    token_cache_max: int
    log_level: str


def load_settings() -> Settings:
    load_dotenv()

    api_url = os.environ.get("LEARNHOUSE_API_URL", "http://localhost:1337").rstrip("/")

    host = os.environ.get("LEARNHOUSE_MCP_HOST", "0.0.0.0").strip() or "0.0.0.0"
    port_raw = os.environ.get("LEARNHOUSE_MCP_PORT", "8765").strip() or "8765"
    try:
        port = int(port_raw)
    except ValueError as exc:
        raise RuntimeError(f"LEARNHOUSE_MCP_PORT must be an integer, got {port_raw!r}") from exc

    mount_path = os.environ.get("LEARNHOUSE_MCP_MOUNT_PATH", "/mcp").strip() or "/mcp"
    if not mount_path.startswith("/"):
        mount_path = "/" + mount_path

    ttl_raw = os.environ.get("LEARNHOUSE_MCP_TOKEN_CACHE_TTL", "300").strip() or "300"
    try:
        token_cache_ttl = float(ttl_raw)
    except ValueError as exc:
        raise RuntimeError(
            f"LEARNHOUSE_MCP_TOKEN_CACHE_TTL must be a number of seconds, got {ttl_raw!r}"
        ) from exc

    max_raw = os.environ.get("LEARNHOUSE_MCP_TOKEN_CACHE_MAX", "10000").strip() or "10000"
    try:
        token_cache_max = int(max_raw)
    except ValueError as exc:
        raise RuntimeError(
            f"LEARNHOUSE_MCP_TOKEN_CACHE_MAX must be an integer, got {max_raw!r}"
        ) from exc

    log_level = os.environ.get("LEARNHOUSE_MCP_LOG_LEVEL", "INFO").upper()

    return Settings(
        api_url=api_url,
        host=host,
        port=port,
        mount_path=mount_path,
        token_cache_ttl=token_cache_ttl,
        token_cache_max=token_cache_max,
        log_level=log_level,
    )
