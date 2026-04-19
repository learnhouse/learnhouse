# Handoff — what's done and what's stuck

Short version for picking up from Claude Code on the VPS.

## Status

- Branch: `claude/rtl-stripe-integration-uGQRo`
- Repo: `/opt/lms` on the VPS (cloned from `https://github.com/Teiger212/coins`)
- VPS: Hostinger KVM 2, `187.127.133.68`, Docker Manager + Traefik preinstalled
- Domain: `lms.lanternroute.com` → A-record to VPS IP, TLS via Let's Encrypt

## Done

- **Phase 1** (commit `ed038ce`) — RTL + Hebrew foundations in `apps/web/`:
  Tailwind 4.2.2, dynamic `<html lang dir>` from cookie/Accept-Language,
  `apps/web/lib/serverLocale.ts`, `apps/web/locales/he.json` seeded, Rubik
  font as default, `apps/web/scripts/codemod-rtl.mjs` applied, hardcoded
  `en-US` Intl formatters replaced by `apps/web/lib/format.ts`.
- **Phase 2** (commit `15ae813`) — Hebrew polish on learner surfaces:
  priority namespaces translated in `he.json` (common, banner, auth,
  validation, courses, activities, embed, assignments, certificate,
  payments, account, user, time). Admin namespaces deliberately English.
  `.lang-he` typography polish in `apps/web/styles/globals.css`.
  `rtl:-scale-x-100` on 14 directional nav icons. SSO callback tips use
  `t()` with three new locale keys.
- **Deploy infra** (commits `0fedb92`, `7650683`, `d95149c`, `67de8dc`,
  `a3abac5`, `68e2ea7`, `3df0b91`) — `docker-compose.yml` +
  `.env.example` at the repo root. pgvector postgres sidecar (required
  for `course_embedding`). Redis 7 with `--requirepass`. Traefik labels
  mirroring chatwoot's pattern on the same VPS.
- **Live verification**: `https://lms.lanternroute.com` responds
  HTTP/2 200, cert valid, all three PM2 processes online
  (web on :8000, api on :9000, collab on :4000 behind an internal
  nginx on :80).

## Resolved (single-tenant OSS mode is live)

The earlier blocker — LH reporting `mode:"ee"` + `multi_org_enabled:true`
and the secondary `top_domain:"https"` parse bug — are both fixed.

Verified live:
```
$ curl -sS https://lms.lanternroute.com/api/v1/instance/info
{"mode":"oss","multi_org_enabled":false,"default_org_slug":"default",
 "frontend_domain":"lms.lanternroute.com","top_domain":"lms.lanternroute.com"}
```

Fix path (commits, oldest → newest):
- `68e2ea79 feat(deploy): force OSS mode (single-tenant) via LEARNHOUSE_PUBLIC build arg`
- `3df0b91c fix(deploy): also set LEARNHOUSE_DISABLE_EE=1 runtime flag`
- `8c307cf8 fix(web): resolve default org for /login in single-tenant mode`
- `dae1fd81 feat(api): idempotent first-boot bootstrap from env`
- `5df42a1e fix(admin): OSS-mode bypass + raise magic-link TTL ceiling to 7 days`

Bootstrap (`apps/api/src/services/setup/setup.py`) seeded the default org
+ admin user on first boot from `LEARNHOUSE_INITIAL_ADMIN_EMAIL/PASSWORD`.

For the current setup state (feature flags, signup mode, what's still
pending operator content/asset decisions), see `docs/LH-SETUP-PLAYBOOK.md`.

## Admin credentials (change on first login)

- Email: `admin@lanternroute.com`
- Password: `cQgBKMx9WbzEKCDpCgeQ` (was pasted into the earlier session
  — rotate as soon as you can log in)

## What's NOT done (Phases 3–5 from docs/PLAN.md)

- **Phase 3**: Wix storefront (marketing + buy button → Grow URL)
- **Phase 4**: Grow by Meshulam checkout configuration
- **Phase 5**: Node.js/TS bridge service at `services/bridge/` (Grow
  webhook → LH enrollment + Resend magic-link email)

See `docs/PLAN.md` for the full plan.
