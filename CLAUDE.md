# CLAUDE.md — orientation for Claude Code sessions in this repo

This is a **fork of LearnHouse** (`learnhouse/learnhouse`) deployed as a single-tenant, Hebrew-first LMS for one creator. The upstream README describes the project's full feature set; most of those features are intentionally turned **off** here. Read the docs below before doing discovery.

## What you should read before doing anything

In order of "no, really, read this":

1. `docs/PLAN.md` — the full multi-phase plan (RTL → Hebrew → deploy → Wix/Grow → bridge). Authoritative scope.
2. `docs/HANDOFF.md` — current state of deploy + admin credentials + open blockers. Read this before changing infra.
3. `docs/LH-SETUP-PLAYBOOK.md` — the LH admin / API setup playbook, with the visibility model and the bridge endpoint map. Read this before touching org config or designing the bridge.

If a question is answered in those, use them — don't re-derive.

## Project shape (high level only)

```
apps/api    FastAPI + SQLModel + Postgres+pgvector + Redis. Routers in src/routers/.
apps/web    Next.js (App Router) + Tailwind 4. Hebrew + RTL by default.
apps/collab Hocuspocus / Yjs (only used by Boards, which is feature-flagged off).
apps/cli    LH's npm CLI; not used in our deploy path.
docker/     start.sh + nginx.conf for the single-container PM2 image.
docker-compose.yml + .env at the repo root drive the live deploy.
```

The live instance is at `https://lms.lanternroute.com` (admin email `admin@lanternroute.com`; password lives in `.env` as `LEARNHOUSE_INITIAL_ADMIN_PASSWORD`).

## Hard constraints (don't violate without checking)

- **Single-tenant, OSS mode.** `NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG=false`, `LEARNHOUSE_DISABLE_EE=1`. Do not re-enable EE features (SSO, multi-org, advanced analytics, audit logs, SCORM).
- **Admin UI is English; learner UI is Hebrew.** Translation work happens in `apps/web/locales/he.json` (learner namespaces only — see HANDOFF.md for the list). Don't add HE keys to admin namespaces.
- **No LH paywall.** Commerce lives in Wix + Grow; entitlement is granted by the bridge calling `/api/v1/admin/{org_slug}/enrollments/...`. The `payments` feature flag stays disabled. `signup_mechanism=inviteOnly` — only the bridge creates users.
- **No content drift between the playbook and the live instance.** When you toggle a feature flag or change org config via API, update `docs/LH-SETUP-PLAYBOOK.md` if the change is permanent.

## Branching + commits

- Working branch: `claude/rtl-stripe-integration-uGQRo` (shared with the human operator's earlier sessions). Don't create new branches unless asked.
- Conventional commits: `feat(scope):`, `fix(scope):`, `docs:`, `chore:`. See `git log --oneline -10` for examples.
- Commit when work reaches a meaningful checkpoint; don't batch unrelated changes.

## Running things

The repo is the deployed copy. Don't `docker compose down` without asking — that takes the live instance offline. Read-only API exploration against `https://lms.lanternroute.com/api/v1/...` is fine; mutating calls (PUT/POST/DELETE) are visible to the operator's sister, so confirm before issuing them on production data.

For local FastAPI / Next.js dev (rare in this repo), use `apps/api/README.md` and `apps/web/README.md` upstream instructions — we haven't customized them.

## Things that look like gaps but aren't

- **Trail enrollment endpoints** (`/api/v1/trail/*`) operate on the authenticated user. That's fine — the bridge uses the **admin** enrollment endpoints at `/api/v1/admin/{org_slug}/enrollments/...` instead (token-gated, takes `user_id` + `course_uuid`). See LH-SETUP-PLAYBOOK Phase 5.
- **No course "access mode" toggle.** Visibility is `public × published` (cross-product). Combined with `signup_mechanism=inviteOnly`, paid-only is achieved by the buyer-pool being closed, not a per-course gate.
- **OSS-mode plan badges.** The frontend may render "Pro" badges on plan-gated panels in admin. Backend ignores them in OSS mode (see `apps/api/src/security/features_utils/plans.py:257-280` and the `5df42a1e` admin-API bypass). Don't "fix" these unless they actually 403.
