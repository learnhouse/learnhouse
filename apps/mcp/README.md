# learnhouse-mcp

Atlas MCP server. Exposes a curated tool surface (read/propose-write/propose-delete + a course-structure macro) over MCP Streamable HTTP.

The LearnHouse API connects to this server as its agent toolset via `pydantic-ai`'s `MCPServerStreamableHTTP`. External MCP clients (Claude Desktop, Cursor, etc.) can also connect with a `lh_*` API token.

## Run

```bash
uv sync
uv run python -m learnhouse_mcp
```

Defaults:
- bind: `127.0.0.1`
- port: `8765`
- endpoint: `/mcp`
- `LH_API_URL`: `http://127.0.0.1:1337`

## Architecture

- Pure proxy. No DB, no Redis. Every tool calls the LearnHouse REST API as the calling user.
- Authentication propagates via `Authorization: Bearer lh_*` on each MCP request. The token is captured into a `ContextVar` by an ASGI middleware and read by `LHClient` per call.
- `propose_*` tools never mutate; they return a `PreviewEnvelope` that the API persists as a pending edit. The actual mutation happens server-side on `/pending/{id}/apply`.
