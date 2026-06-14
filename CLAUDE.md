# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Fork & upstream

This repo is **`arykowski-og/lms`**, OpenGov's (OG) fork of upstream **`learnhouse/learnhouse`** (configured as the `upstream` git remote). It is consumed as a git submodule at **`enablement/lms`** in **`OpenGov/product-docs`** (`/Users/arykowski/Projects/OpenGov/product-docs`), tracking the `dev` branch.

OG-specific work sits on top of upstream LearnHouse — the `og_activity` contract system, PSP integration, and the planned LMS MCP server. The driving specs, plans, and runbooks for that work live in the **parent repo**, not here:

- `enablement/docs/specs/` — design docs (`*-lms-activity-foundation-design.md`, `*-learnhouse-psp-integration-design.md`).
- `enablement/docs/plans/` — phased implementation plans (activity foundation P0–P2, KB ingestion, PSP integration).
- `enablement/docs/runbooks/` — operational runbooks (e.g. KB→LMS content sync).
- `MCP-server-plan.md` + `enablement/MCP.py` — plan and skeleton for the LMS MCP server that backs the dashboard AI assistant (the OSS repo ships the chat UI and SSE protocol in `apps/web/services/ai/atlas.ts` but not the server itself).

When picking up OG feature work, read the relevant spec/plan in the parent repo first.

### Cardinal rule: additive-only, minimal fork divergence

**Keep this fork easily updatable from `upstream`.** Every OG spec is explicit about this discipline, and changes must follow it:

- **OG logic lives in new, isolated files** — never woven into upstream modules. Established OG-owned locations: `apps/api/src/services/og_activity/` (contract + registry + adapter), and per the specs `apps/api/src/routers/psp_auth.py`, `apps/api/src/services/auth/psp_jwks.py`, `apps/api/src/jobs/kb_sync.py`, `apps/api/src/services/ai/rag/kb_context.py`.
- **Touching upstream core is the exception, and must be surgical and additive.** Known/planned core touch-points are deliberately tiny: a couple of `include_router(...)` lines in `src/router.py` to mount new OG routers; an additive Alembic migration for a new audio subtype; removing `'scorm'` from two blocklists to un-gate it (`apps/web/services/plans/plans.ts` `OSS_BLOCKED_FEATURES`, `apps/api/src/core/deployment_mode.py` `EE_ONLY_FEATURES`); and one `postMessage` listener in `apps/web/components/Providers.tsx` for theme injection. Before editing any other upstream file, prefer a new isolated module or a CSS/config seam.
- **Prefer external seams over code edits** — e.g. PSP branding hides LMS chrome via injected CSS (icon/sidebar overrides), not by editing the components.

### PSP integration model (how this LMS embeds in the OpenGov platform)

The fork is embedded in the OpenGov Platform Shell (`psp-web`) **without rewriting LearnHouse**. A separate OG-owned Vite ES-module wrapper (`psp-module`, not in this repo) implements PSP's `MountableApp` interface and renders LearnHouse in an `<iframe>`. Three integration capabilities, all riding existing LearnHouse machinery:

1. **Auth** — server-mediated one-time-code token exchange (no third-party cookies). LearnHouse already ships the *consumer* side (`web/app/auth/token-exchange/`, `AuthContext`); OG adds only the *platform* side (`psp_auth.py` mints LH JWTs, stores them in Redis under a 60s code; the shell JWT is validated against an issuer allowlist supporting both Auth0 and Okta).
2. **Branding** — Capital Design System tokens → LH CSS variables, injected via the `OG_THEME` `postMessage` listener.
3. **Content** — Copilot answers augmented with approved OpenGov KB content (`kb_context.py`), and approved KB launch artifacts mirrored into LH courses by a nightly job (`kb_sync.py`). KB status filtering is always client-side (no server `status` param); idempotency keys on `extra_metadata.kb_id`, with `kb_sha` to skip unchanged.

## Overview

LearnHouse is an open-source learning platform. This is a monorepo of four apps that run together: a FastAPI backend, a Next.js frontend, a Hocuspocus real-time collaboration server, and a Node CLI used for both self-hosting and local development.

| App | Path | Stack | Runtime |
|-----|------|-------|---------|
| API | `apps/api` | FastAPI, SQLModel, Alembic, Pydantic AI | Python 3.14, `uv` |
| Web | `apps/web` | Next.js (App Router), React, TailwindCSS, Tiptap, TanStack Query | `bun` |
| Collab | `apps/collab` | Hocuspocus, Yjs, ioredis | `bun`/`tsx` |
| CLI | `apps/cli` | Commander, tsup | `bun`/Node |
| Docs | `docs` | Nextra (MDX) | `bun` |

## Development environment

The intended way to run everything locally is the CLI, which spins up PostgreSQL + Redis (Docker) and starts API/Web/Collab with hot reload:

```bash
npx learnhouse dev      # from repo root
```

To run apps individually:

```bash
# API (from apps/api) — uses uv, not pip/venv directly
uv sync                                              # install deps
uv run uvicorn app:app --reload --port 9000          # serve
uv run alembic upgrade head                          # apply DB migrations

# Web (from apps/web)
bun install
bun run dev             # next dev --turbopack

# Collab (from apps/collab)
bun install
bun run dev             # tsx watch src/index.ts
```

## Testing & linting

```bash
# API tests (from apps/api) — set TESTING=true to use in-memory SQLite
TESTING=true uv run pytest src/tests/ -v
TESTING=true uv run pytest src/tests/services/og_activity/test_adapter.py -v   # single file
TESTING=true uv run pytest src/tests/services/og_activity/test_adapter.py::test_name   # single test
uv run pytest --cov=src --cov-report=term-missing    # with coverage (CI gate: --cov-fail-under=25)

# API lint
uv run ruff check .     # config in pyproject.toml; E501 and E712 are ignored

# Web lint (from apps/web)
bun run lint            # eslint, non-failing
bun run lint:strict     # eslint, fails on errors (CI gates changed files strictly)

# CLI tests (from apps/cli)
bun run test            # unit; test:e2e for e2e; test:all for both
```

`asyncio_mode = "auto"` is set, so async tests don't need explicit markers. The `ollama` pytest marker gates opt-in live tests that need a local Ollama server.

## Architecture

### API request flow

`app.py` builds the FastAPI app and mounts `src/router.py`, which assembles a single `/api/v1` router from all feature routers under `src/routers/`. Routers are wired with shared dependencies declared at include-time in `router.py` — auth (`get_current_user`), API-token rejection, and plan gating (`require_plan_*`). When changing access control, edit the `include_router(...)` dependencies in `router.py`, not just the route handlers.

Layering convention:
- `src/routers/` — HTTP endpoints, thin; delegate to services.
- `src/services/` — business logic (one package per domain: `courses`, `orgs`, `ai`, `og_activity`, …).
- `src/db/` — SQLModel table models + `*Create`/`*Update`/`*Read` schema variants.
- `config/config.py` — typed config loaded from `config.yaml` + env vars via `get_learnhouse_config()`.

### Deployment modes (OSS / EE / SaaS)

`src/core/deployment_mode.py` is the single source of truth. Three modes — `saas`, `ee`, `oss` — resolved with priority `saas > ee > oss`. **The SaaS check must come first**: SaaS deployments ship with the `ee/` folder present, so `is_ee_available()` is true in SaaS mode too. Enterprise features (`sso`, `audit_logs`, `payments`, `analytics_advanced`, `scorm`) are blocked in OSS, plan-gated in SaaS, and unlimited in EE.

EE code lives in optional `ee/` folders (present in `apps/api` and `apps/web`) loaded dynamically via `src/core/ee_hooks.py` (`importlib`, never hard imports) so the codebase works with the folder absent. `LEARNHOUSE_FORCE_EE=1` skips the license check in dev only.

### Multi-tenancy

Selected by `LEARNHOUSE_TENANCY` (`multi` | `single`). `multi` requires EE/SaaS + a routable `LEARNHOUSE_DOMAIN`; `single` covers both `localhost` dev and single-org VPS self-hosting. See `docs/notes/multi-tenancy.md` for the full inference rules.

### OG Activity contract system (`src/services/og_activity/`)

Active feature area (branch `feat/og-activity-foundation`). Maps external "activity contracts" (e.g. from a KB or agent) onto LearnHouse's native `Activity` model. Pipeline:

1. `contract.py` — `ActivityContract` Pydantic model (`type`, `title`, `source` provenance, `payload`).
2. `registry.py` — `ActivityTypeModule` ABC; one module per `ContractType` validates the payload and maps to/from LearnHouse. Modules live in `types/`. Use a fresh `ActivityTypeRegistry` in tests to stay isolated from the process-wide `default_registry`.
3. `spec.py` — `LearnHouseActivitySpec`, the type-agnostic target shape (activity type/sub-type + content).
4. `adapter.py` — `upsert_activity()` validates, maps, and **idempotently** upserts. Idempotency keys on `source.kb_id` stored in `Activity.extra_metadata`.
5. `store.py` — `ActivityStore` Protocol (persistence port); `ServiceActivityStore` is the default impl backed by the activity service layer. `find_by_kb_id` filters on `extra_metadata->>'kb_id'` in SQL via `.as_string()` (dialect-portable across Postgres JSONB and SQLite JSON) — do not load-and-scan in Python.

### Database & migrations

PostgreSQL (with `pgvector`) in production; tests use in-memory SQLite with JSONB→JSON remapping (see `src/tests/conftest.py`). Schema migrations use **Alembic** (`apps/api/migrations/versions/`, run `alembic upgrade head`). Separately, `scripts/migrate.py` is a one-off **data** migration runner for seeding role permissions and org-config feature flags — not a substitute for Alembic.

### AI

Provider-agnostic via Pydantic AI. `config.AIConfig.provider` selects the SDK (google/openai/anthropic/mistral/bedrock/ollama/…) with a single `api_key`/`base_url`. Three model tiers defined in `src/services/ai/llm/tiers.py` (defaults to Gemini 3 family). AI services/routers are excluded from coverage.

### Web

Next.js App Router (`apps/web/app/`), with per-domain service clients in `apps/web/services/` and EE-only UI in `apps/web/ee/`. The editor and boards use Tiptap + Yjs and connect to the Collab server via `@hocuspocus/provider`.

## Conventions

- `extra_metadata` (snake_case) is the JSONB convention for provenance/extension data on models like `Activity`.
- Routers with zero public endpoints use `require_authenticated_user` (rejects API tokens AND anonymous users); `get_non_api_token_user` still admits `AnonymousUser` and is only for routers with at least one deliberately-public endpoint.
- Sentry is wired in all three runtimes; sampling rates differ by `development_mode`.
- CI runs path-filtered per app (`apps/api/**`, `apps/web/**`) — API uses Python 3.14 + `uv`, Web uses `bun`.
