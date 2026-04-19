# services/bridge

Tiny Hono + Bun + TypeScript service that turns a Grow by Meshulam "paid" webhook into a LearnHouse enrollment + magic-link URL.

This is **scaffolding only** — the LH client, env validation, webhook handler, and HMAC verification are wired up; idempotency, email delivery, and the real Grow payload schema are deliberately deferred (see TODOs in source + the "Blocked on" list below).

## Run locally

```bash
bun install
cp .env.example .env   # fill what you can
bun run dev            # http://localhost:3001
```

Health check:

```bash
curl localhost:3001/health
# {"status":"ok","version":"0.1.0","lh_org":"default"}
```

Bad-signature webhook (proves handler chain runs):

```bash
curl -i -X POST http://localhost:3001/webhooks/grow \
  -H "Content-Type: application/json" \
  -H "X-Grow-Signature: deadbeef" \
  -d '{}'
# HTTP/1.1 401 Unauthorized
```

`bun run typecheck` should report zero errors.

## What's done

- Typed LH admin client: `getUserByEmail`, `provisionUser`, `enrollUser`, `issueMagicLink`. Mirrors `apps/api/src/routers/admin.py:154-178`.
- Hono webhook handler: HMAC verify → zod-parse → LH calls → response with the magic-link URL.
- Env validation via zod (`src/env.ts`). Boot fails loudly if required vars are missing.
- 7-day magic-link TTL by default (LH cap, post-`5df42a1e`).

## Blocked on

| Item | Owner | Why deferred |
|------|-------|-------------|
| `RESEND_API_KEY`, `RESEND_FROM`, He email template | Operator | Needs a verified sending domain first (DNS + SPF/DKIM). Until then the bridge logs the magic-link URL to stdout instead of sending email. |
| `GROW_WEBHOOK_SECRET` + signature header format | Operator + Grow docs | Need a real test webhook to confirm header name and HMAC encoding (current code handles `sha256=hex` and bare hex). |
| Real Grow payload schema in `src/types/grow.ts` | Operator | Provisional zod schema — tighten once a real test transaction lands. |
| Idempotency store (Redis or SQLite) | Decide pre-deploy | PLAN.md "Open items" leaves the choice open. For now, replays re-trigger LH calls; LH endpoints are mostly idempotent (provision returns 400 on duplicate; enroll returns 400 on already-enrolled, treated as success). |
| Deploy target (LH compose sibling vs. Fly.io) | Decide pre-deploy | Both fine; sibling is simpler. |
| `LH_ADMIN_TOKEN` minted at `POST /api/v1/orgs/{org_id}/api-tokens` | Operator | Mint when ready to wire end-to-end; rights set documented in `docs/LH-SETUP-PLAYBOOK.md` Phase 5. |

## Layout

```
services/bridge/
├── package.json          Bun + Hono + zod + TS
├── tsconfig.json         strict, ES2022, Bun resolution
├── .env.example          every var the bridge will need
├── README.md             this file
└── src/
    ├── index.ts          Hono app, /health, /webhooks/* mount
    ├── env.ts            zod env schema + loader
    ├── clients/
    │   └── learnhouse.ts typed LH admin client
    ├── types/
    │   ├── learnhouse.ts mirrors of LH Pydantic models
    │   └── grow.ts       provisional Grow webhook schema
    └── webhooks/
        └── grow.ts       /webhooks/grow handler
```
