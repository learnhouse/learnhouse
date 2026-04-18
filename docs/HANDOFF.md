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

## Stuck (current blocker)

LH still reports `mode:"ee"` + `multi_org_enabled:true` so the
"Enter Your Organization" gate appears on the bare root domain,
preventing direct login. We need single-tenant (OSS mode).

Two levers exist in the code:

1. **Build arg** `LEARNHOUSE_PUBLIC=true` — the Dockerfile does
   `rm -rf /app/api/ee` when this is set. Already added to
   `docker-compose.yml` under `build.args`. On the last rebuild it
   didn't seem to take effect (probably Docker layer cache).

2. **Runtime env** `LEARNHOUSE_DISABLE_EE=1` — checked first in
   `apps/api/src/core/ee_hooks.py::is_ee_available()`. Returns False
   unconditionally when set, so `get_deployment_mode()` falls through
   to `'oss'`. Added to `docker-compose.yml` under `environment`.

Last observed state on the VPS:
```
$ curl -sS https://lms.lanternroute.com/api/v1/instance/info
{"mode":"ee","multi_org_enabled":true,"default_org_slug":"default",
 "frontend_domain":"https://lms.lanternroute.com","top_domain":"https"}
```

The env var isn't reaching the container — likely because `docker compose up -d` didn't recreate the container after the YAML changed.

**Diagnosis commands to run next:**

```bash
cd /opt/lms
git pull
grep DISABLE_EE docker-compose.yml          # must show: LEARNHOUSE_DISABLE_EE: "1"
docker compose down
docker compose up -d
sleep 10
docker compose exec lms env | grep LEARNHOUSE_DISABLE_EE
# expected: LEARNHOUSE_DISABLE_EE=1
curl -sS https://lms.lanternroute.com/api/v1/instance/info
# expected: "mode":"oss","multi_org_enabled":false
```

If `env | grep` still prints nothing after `down` + `up -d`,
something's stripping the var between compose and the container.
Double-check `.env` doesn't override it with an empty value
(`grep DISABLE_EE .env` should print nothing, or show `=1`).

## Secondary issue (not blocking)

The instance/info response also shows `"top_domain":"https"`, which
means LH is parsing the URL scheme as if it were the domain. Root
cause is in the backend `instance/info` handler's parsing of
`LEARNHOUSE_FRONTEND_DOMAIN`. If cookies scope weirdly after login,
patch the parsing. Not blocking first login.

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
