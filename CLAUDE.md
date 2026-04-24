# CLAUDE.md — LearnHouse Deploy Flow

## Build & deploy pipeline

This repo does **not** host the deploy logic — deploy runs on **Jenkins** in a separate infrastructure repo. This repo only produces images and signals the infra repo when a branch moves.

### Trigger chain

```
push to main | dev | prod | PR event
   │
   ├─► .github/workflows/build-community.yaml
   │     Builds multi-platform Docker image from ./Dockerfile.
   │     Pushes to ghcr.io/learnhouse/app:<branch> and :<branch>-<sha7>.
   │
   └─► .github/workflows/notify-infra.yaml
         Repository-dispatch (event type `source-update`) to the infra repo.
         Payload: { sha, branch, event, pr_number, pr_action, repo }.
         Secret: INFRA_REPO_PAT · Var: INFRA_REPO.
```

The infra repo's Jenkins pipeline consumes the `source-update` dispatch, pulls the matching `ghcr.io/learnhouse/app:<branch>` image, and rolls the target environment.

### Branch → environment mapping

Branches that trigger a build/notify: `main`, `dev`, `prod`.
The actual env-to-branch mapping lives in the infra repo (not visible from here).
When in doubt, **ask which branch the target host listens to** before merging — do not assume.

### What this means for shared-system actions

- Merging a PR to `dev`/`prod` is a deploy. Treat it as a production action and get explicit user confirmation every time.
- Alembic migrations run server-side as part of the Jenkins pipeline (api container startup), so merging is also what runs DB migrations on the target env.
- Never merge without user approval, even in Auto Mode.

## Local repo layout

- `apps/api/` — FastAPI + SQLModel + Alembic.
- `apps/web/` — Next.js App Router (TypeScript).
- `apps/api/migrations/versions/` — Alembic revisions.
- `docker/` — nginx + entrypoint for the combined community image.
- `Dockerfile` — single image building both api and web.

## Stripe Connect paywall (ee/)

The commercial flow is: `PaymentsConfig → PaymentsOffer → PaymentsGroup → PaymentsGroupSync → UserGroup`.
Activation side-effects (usergroup add/remove, welcome email) all flow through
`apps/api/ee/services/payments/payments_enrollments.py::update_enrollment_status`
— webhooks and admin overrides must call this function rather than flipping status directly.

## Course `onboarding_config`

Editable JSONB on `courses` (migration `n4a5b6c7d8e9`) holds landing/welcome/paywall/thanks copy.
Upsert via `docs/courses/agentes-ia-negocio/_build/setup_onboarding.py --confirm-remote`.
Reachable from the public `GET /courses/{uuid}` endpoint, so the frontend can render it without auth.
