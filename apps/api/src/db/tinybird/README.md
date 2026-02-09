# Tinybird Analytics for LearnHouse

LearnHouse uses [Tinybird](https://www.tinybird.co/) (managed ClickHouse) for analytics event ingestion and querying. This directory contains the datasource schema and reference pipe definitions.

## Architecture

- **Ingestion**: The API sends events to Tinybird via the Events API (`POST /v0/events`)
- **Querying**: The API reads data via the Query API (`POST /v0/sql`) using raw ClickHouse SQL — pipe files in `endpoints/` are reference only and are **not deployed**
- **Config**: Analytics is automatically enabled when the Tinybird env vars are set. No `enabled` flag needed.

## Prerequisites

1. A [Tinybird account](https://www.tinybird.co/)
2. The Tinybird CLI (`tb`): `pip install tinybird-cli` or `uv tool install tinybird`
3. A workspace created in your preferred region (e.g. `europe-west2 (gcp)`)

## Environment Variables

Set these in your `.env` or deployment secrets:

```
LEARNHOUSE_TINYBIRD_API_URL=https://api.europe-west2.gcp.tinybird.co
LEARNHOUSE_TINYBIRD_INGEST_TOKEN=p.eyJ...
LEARNHOUSE_TINYBIRD_READ_TOKEN=p.eyJ...
```

- `LEARNHOUSE_TINYBIRD_API_URL` — Your workspace's regional API URL
- `LEARNHOUSE_TINYBIRD_INGEST_TOKEN` — Token with write permissions (Events API)
- `LEARNHOUSE_TINYBIRD_READ_TOKEN` — Token with read permissions (Query API / SQL)

When both tokens are set, analytics is enabled automatically. When they are missing, the API skips tracking and the frontend shows a "not configured" message.

### Finding Your API URL

Your API URL depends on the region of your workspace. Check the Tinybird dashboard or use:

```bash
tb workspace current
```

### Creating Tokens

In the Tinybird dashboard under **Tokens**, create two tokens:

1. **Ingest token**: Scope it to `DATASOURCES:CREATE` and `DATASOURCES:APPEND` on the `events` datasource
2. **Read token**: Scope it to `PIPES:READ` or use a token with SQL query access

## Initial Setup

### 1. Login to Tinybird CLI

```bash
tb login
```

Follow the prompts to authenticate. This creates a `.tinyb` file (gitignored).

### 2. Deploy the Datasource

From this directory (`apps/api/src/db/tinybird/`):

```bash
# Deploy only the datasource (the endpoints/ pipes are reference-only)
# Move or exclude pipe files temporarily if they cause parsing errors
cd datasources/
tb --cloud deploy
```

Or from the tinybird root directory, if pipe files parse cleanly:

```bash
tb --cloud deploy
```

**Important**: If your workspace uses **Forward mode** (the default for new workspaces), all resource creation must go through `tb deploy`. You cannot create datasources via the v0 API directly.

### 3. Verify Deployment

```bash
# List datasources
tb datasource ls

# You should see the 'events' datasource
```

### 4. Test Event Ingestion

```bash
curl -X POST \
  'https://api.europe-west2.gcp.tinybird.co/v0/events?name=events' \
  -H "Authorization: Bearer $LEARNHOUSE_TINYBIRD_INGEST_TOKEN" \
  -d '{"event_name":"test","timestamp":"2025-01-01 00:00:00","org_id":1,"user_id":1,"session_id":"test","properties":"{}","source":"test","ip":"127.0.0.1"}'
```

### 5. Test Query API

```bash
curl -X POST \
  'https://api.europe-west2.gcp.tinybird.co/v0/sql' \
  -H "Authorization: Bearer $LEARNHOUSE_TINYBIRD_READ_TOKEN" \
  -d "SELECT count() FROM events FORMAT JSON"
```

## Directory Structure

```
tinybird/
  datasources/
    events.datasource    # Datasource schema — deployed to Tinybird
  endpoints/
    *.pipe               # Reference pipe definitions (NOT deployed)
  README.md              # This file
```

### Why Pipes Are Not Deployed

LearnHouse uses the Tinybird **Query API** (`POST /v0/sql`) to run ClickHouse SQL directly, rather than deploying pipe endpoints. This approach:

- Avoids Forward mode deployment complexity for pipes
- Keeps all query logic in the Python codebase (`src/services/analytics/queries.py`)
- Makes it easy to add/modify queries without redeploying Tinybird resources

The pipe files in `endpoints/` serve as documentation of the available queries and their expected schemas.

## Datasource Schema

The `events` datasource is a single unified table:

| Column | Type | Description |
|--------|------|-------------|
| `event_name` | String | Event identifier (e.g. `page_view`, `course_enrolled`) |
| `timestamp` | DateTime | UTC timestamp |
| `org_id` | Int64 | Organization ID |
| `user_id` | Int64 | User ID (0 for anonymous) |
| `session_id` | String | Browser session ID |
| `properties` | String | JSON-encoded event properties |
| `source` | String | `api` or `frontend` |
| `ip` | String | Client IP address |

- Partitioned by month (`toYYYYMM(timestamp)`)
- Sorted by `(org_id, event_name, timestamp)`
- 12-month TTL

## Deleting Everything / Starting Fresh

### Delete the Datasource

To remove the `events` datasource and all its data:

```bash
# Option 1: Deploy an empty project (removes all resources)
# Create a temp empty directory and deploy from it
mkdir /tmp/tb-empty && cd /tmp/tb-empty
tb --cloud deploy

# Then promote the deployment to live
tb deployment ls
tb deployment set-live <deployment-id>

# Clean up
rm -rf /tmp/tb-empty
```

```bash
# Option 2: Delete via API (only works in Classic mode, NOT Forward mode)
curl -X DELETE \
  'https://api.europe-west2.gcp.tinybird.co/v0/datasources/events' \
  -H "Authorization: Bearer $LEARNHOUSE_TINYBIRD_INGEST_TOKEN"
```

### Delete Deployment History

```bash
# List all deployments
tb deployment ls

# Delete a specific deployment (cannot delete the live one)
tb deployment delete <deployment-id>
```

### Re-deploy from Scratch

After deleting, follow the [Initial Setup](#initial-setup) steps again.

## Troubleshooting

### "Adding or modifying data sources can only be done via deployments"
Your workspace is in **Forward mode**. Use `tb --cloud deploy` instead of the v0 API.

### "Resource 'events' not found"
The datasource hasn't been deployed yet. Follow the [Initial Setup](#initial-setup) steps.

### "Datasource events not found" on event ingestion
Same as above — the Events API cannot auto-create datasources in Forward mode.

### Dashboard shows "Analytics not configured"
The `LEARNHOUSE_TINYBIRD_INGEST_TOKEN` and/or `LEARNHOUSE_TINYBIRD_READ_TOKEN` env vars are not set. Set both to enable analytics.

### Dashboard queries return empty data
If the `events` table exists but has no data, queries will return empty results. Send some test events or use the app to generate real events.
