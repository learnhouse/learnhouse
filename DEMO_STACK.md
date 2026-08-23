# Running the demo stack locally

Everything below runs on this machine. Nothing is deployed anywhere.

## URLs

| | |
|---|---|
| Sign in | http://lvh.me:3010/login |
| The demo organization | http://demo.lvh.me:3010/dash |
| Org picker (has the "Explore a live demo" card) | http://lvh.me:3010/home |
| Onboarding (also has the card) | http://lvh.me:3010/new |
| API | http://lvh.me:1348/api/v1 |

Credentials: `admin@school.dev`. The password is generated on the API's
first run and printed to its console; it is also in `.demo-secrets` at the repo
root, which is gitignored.

`lvh.me` and every subdomain of it resolve to 127.0.0.1, so no hosts-file
editing is needed.

**The demo refreshes every 10 minutes**, which is also the shipped default.
Drop `LEARNHOUSE_DEMO_REFRESH_MINUTES` lower in `run_demo_api.sh` if you want to
watch a refresh land without waiting.

## Start it

```bash
# 1. Postgres + Redis
docker compose -f .learnhouse/docker-compose.dev.yml up -d

# 2. API (exports its own env; see the file for why)
cd apps/api && bash run_demo_api.sh

# 3. Collaboration server — REQUIRED for boards
#    Without it every board sits on "connecting" forever, which reads as a
#    broken feature rather than a service nobody started.
cd apps/collab && bash run_demo_collab.sh

# 4. Web
cd apps/web && bun run next build && bun run next start -p 3010
```

The demo builds itself on API startup and refreshes every 10 minutes after that.

## Why multi tenancy

The demo is a **second** organization. In single tenancy every path resolves to
the one default org, so the demo is unreachable — clicking into it lands you on
the default org's dashboard. `run_demo_api.sh` therefore sets
`LEARNHOUSE_TENANCY=multi` with `LEARNHOUSE_DOMAIN=lvh.me:3010`, which is how
`demo.<domain>` would work in production too.

Multi tenancy is gated on "EE available OR SaaS mode". The script uses
`LEARNHOUSE_SAAS=true` because the EE checkout this worktree symlinks to expects
a module this branch does not have; the demo needs nothing from EE.

## Watching it work

```bash
cd apps/api

uv run python cli.py demo-status     # state, epoch, registered row counts
uv run python cli.py demo-sync       # force a refresh now
uv run python cli.py demo-teardown   # remove it entirely
```

Break it on purpose and watch the next tick put it back — rename a course,
unpublish a chapter, delete a course, change a grade. By the next tick it is
all restored, and anything you *created* is removed as drift. `demo-sync` forces
it immediately rather than waiting.

Run `demo-sync` twice in a row: the second run reports "nothing to do". That is
the design working — a settled demo costs one UPDATE to its own bookkeeping row
and nothing else.

## What is in it

Riverbend Academy, on the **pro** plan so every feature is visible:

- 6 courses in 3 sections, 18 chapters, 54 activities, 6 assignments
- 40 students with progress, submissions, grades and certificates
- A community with 5 discussions, comments and votes
- 3 boards with members, 2 working interactive playgrounds

- 3 podcasts, 10 episodes with real audio
- A store: 5 offers (a subscription, two single courses, a bundle, one
  pay-what-you-want) and 18 enrolments

**Analytics will look sparse.** It is enabled because it is part of pro, but
every chart reads from Tinybird, which the demo does not write to. There is no
Postgres fallback, so this is a known limitation rather than something seeding
can fix.

**The store needs the Enterprise Edition.** Payments models live in the private
`ee/` tree and their tables are not in the migrations, so the seeding step skips
itself cleanly on a community install. It also needs the EE routers to mount —
if `apps/api/ee` points at an EE branch that expects main-repo code this branch
does not have, `/payments/*` returns 404 and the store page renders empty even
though the offers are in the database.

On a self-hosted **OSS** install, `sso`, `audit_logs`, `payments`,
`analytics_advanced` and `scorm` stay hidden however the demo is configured —
`resolve_feature` refuses them by deployment mode, which the demo neither can
nor should override.

## Things to know

- `apps/api/.env` deliberately holds credentials only. `config.py` calls
  `load_dotenv()` while parsing, so anything in it also reaches the test
  process — tenancy and demo flags there made four unrelated tests fail on this
  machine and nowhere else.
- Redis caches `/instance/info` for 600s. After changing tenancy, run
  `docker exec learnhouse-redis-dev redis-cli FLUSHALL`.
- The admin account must be marked email-verified directly in the database;
  SaaS mode requires verification and there is no mail provider configured here:
  `UPDATE "user" SET email_verified = true WHERE email = 'admin@school.dev';`
