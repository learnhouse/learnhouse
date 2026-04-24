# LearnHouse MCP Server

A multi-tenant [MCP](https://modelcontextprotocol.io) server that exposes LearnHouse as tools to any MCP-compatible AI client — Claude Desktop, Cursor, Zed, custom agents, and more.

> **Status:** v0.2 — covers courses, chapters, activities, assignments (including tasks, submissions, and grading), collections, podcasts, episodes, certifications, search, and instance info. File-upload endpoints (thumbnails, video/PDF activities, podcast audio, assignment reference/submission files) are not yet supported; use the LearnHouse UI for those.

## How it works

This is a single HTTP service that can serve any number of LearnHouse organizations at the same time. It carries no credentials of its own: each MCP client connects with its own LearnHouse API token, and the server forwards that token (and only that token) to the LearnHouse API on every call.

```
┌──────────────────┐  Streamable HTTP   ┌──────────────────┐     HTTPS     ┌──────────────────┐
│  MCP client      │  Bearer lh_...     │ learnhouse-mcp   │   Bearer...   │ LearnHouse API   │
│  (Claude, etc.)  │  ────────────────► │ (this server)    │ ────────────► │ /api/v1/*        │
└──────────────────┘                    └──────────────────┘               └──────────────────┘
```

### Org isolation

The LearnHouse API enforces a hard org boundary on every API-token request: `_verify_api_token_org_boundary` in `apps/api/src/security/auth.py` rejects any request whose path resolves to a different organization than the token belongs to. The MCP server never brokers that check — it simply hands the caller's token to the API and relays the response. A token for org A cannot reach org B's resources through this server, period.

### Per-request auth

The MCP server's middleware does three things on every HTTP request:

1. Requires `Authorization: Bearer lh_...`. Anything else gets a `401`.
2. Calls `GET /api/v1/auth/me` to resolve the token's `org_id` and `org_slug`. The mapping is cached in memory for `LEARNHOUSE_MCP_TOKEN_CACHE_TTL` seconds (default 300), so revoked tokens stop working within ~5 minutes without any signal from the API.
3. Stores the resolved identity in a contextvar that the shared HTTP client reads for the duration of that request. The connection pool is shared across tenants; the identity is not.

User session tokens (JWTs) are rejected — they have no org scope, so they aren't safe for multi-tenant tool calls.

## Configuration

The server reads these environment variables (a `.env` file is also supported):

| Variable                          | Required | Default                 | Description                                                                 |
| --------------------------------- | -------- | ----------------------- | --------------------------------------------------------------------------- |
| `LEARNHOUSE_API_URL`              | no       | `http://localhost:1337` | Base URL of the LearnHouse instance the server proxies to.                  |
| `LEARNHOUSE_MCP_HOST`             | no       | `0.0.0.0`               | Bind host.                                                                  |
| `LEARNHOUSE_MCP_PORT`             | no       | `8765`                  | Bind port.                                                                  |
| `LEARNHOUSE_MCP_MOUNT_PATH`       | no       | `/mcp`                  | Path where the Streamable HTTP endpoint is exposed.                         |
| `LEARNHOUSE_MCP_TOKEN_CACHE_TTL`  | no       | `300`                   | Seconds to cache the token → org mapping. Lower = faster revocation propagation. |
| `LEARNHOUSE_MCP_TOKEN_CACHE_MAX`  | no       | `10000`                 | Max tokens kept resolved in memory.                                         |
| `LEARNHOUSE_MCP_LOG_LEVEL`        | no       | `INFO`                  | Python log level. `DEBUG` prints outgoing HTTP calls.                       |

No LearnHouse credentials live in the server's environment. Clients bring their own token on every connection.

## Run it

### From source

```bash
cd apps/mcp
uv sync
uv run learnhouse-mcp
```

The server listens on `http://0.0.0.0:8765/mcp` by default.

### Docker

```bash
docker build -t learnhouse-mcp apps/mcp
docker run --rm -p 8765:8765 \
  -e LEARNHOUSE_API_URL=https://api.learnhouse.example.com \
  learnhouse-mcp
```

Put it behind your existing TLS terminator (nginx, Caddy, Cloudflare, etc.) on `https://mcp.learnhouse.example.com/mcp`.

### Scaling

The server is stateless apart from the in-memory token cache. You can run it behind any HTTP load balancer — the cache is local to each instance, which just means a token hits `/auth/me` once per instance per TTL. No sticky sessions required.

## Wire it into a client

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on Windows/Linux:

```json
{
  "mcpServers": {
    "learnhouse": {
      "transport": "http",
      "url": "https://mcp.learnhouse.example.com/mcp",
      "headers": {
        "Authorization": "Bearer lh_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Each user pastes their own `lh_` token. The server never sees or stores any of them long-term.

### Cursor / Zed / other MCP clients

Same pattern — point the client at `https://<host>/mcp` and configure an `Authorization: Bearer lh_...` header.

### Dev loop

```bash
cd apps/mcp
uv sync
uv run learnhouse-mcp
```

Then connect the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) to `http://localhost:8765/mcp` with a bearer header to call tools interactively.

## Tools at a glance

| Group           | Tools                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Instance        | `get_instance_info`, `get_plan_limits`                                                         |
| Courses         | `list_courses`, `count_courses`, `search_courses`, `get_course`, `get_course_structure`, `update_course`, `clone_course`, `delete_course`, `list_course_updates`, `create_course_update` |
| Chapters        | `list_chapters`, `get_chapter`, `create_chapter`, `update_chapter`, `delete_chapter`           |
| Activities      | `list_chapter_activities`, `get_activity`, `create_activity`, `create_external_video_activity`, `update_activity`, `delete_activity`, `list_activity_versions`, `restore_activity_version` |
| Assignments     | `list_course_assignments`, `get_assignment`, `get_assignment_by_activity`, `create_assignment`, `update_assignment`, `delete_assignment`, `delete_assignment_by_activity`, `list_assignment_tasks`, `get_assignment_task`, `create_assignment_task`, `update_assignment_task`, `delete_assignment_task`, `list_task_submissions`, `list_user_task_submissions`, `delete_task_submission`, `list_assignment_submissions`, `get_user_assignment_submission`, `delete_user_assignment_submission`, `get_user_assignment_grade`, `grade_user_assignment_submission`, `mark_assignment_done_for_user` |
| Collections     | `list_collections`, `get_collection`, `create_collection`, `update_collection`, `delete_collection` |
| Podcasts        | `list_podcasts`, `get_podcast`, `list_podcast_episodes`, `create_podcast_episode`, `update_podcast_episode`, `delete_podcast_episode` |
| Certifications  | `list_course_certifications`, `get_certification`, `create_certification`, `update_certification`, `delete_certification`, `list_user_certifications` |
| Search          | `search_organization`                                                                          |

Tools with `DESTRUCTIVE` in their description are irreversible (`delete_*`). Good MCP clients surface that to the user before calling them.

## What's deliberately out of scope

- **Org / user / role / API-token management** — those routes reject API-token auth by design. Use the admin UI.
- **File uploads** — video, PDF, audio, and thumbnail endpoints need multipart uploads; not yet wired through MCP.
- **Webhooks, analytics, billing** — gated to interactive users.

## License

AGPL-3.0 — same as the rest of LearnHouse.
