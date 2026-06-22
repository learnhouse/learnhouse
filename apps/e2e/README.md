# LearnHouse E2E — UI acceptance tests

Browser-driven, human-like end-to-end tests for LearnHouse. The suite boots a
real **self-host via the LearnHouse CLI** (`setup --ci`, pulling the published
image) and drives the UI with Playwright like a real user. It validates the
**shipped self-host product**.

It is organized as a **modular, multi-feature** harness: shared infrastructure
lives in `core/`, and each product area is a self-contained module under
`features/<area>/`. Assignments is the first module; adding more (courses,
communities, …) is a copy-the-pattern affair (see below).

## Architecture

```
apps/e2e/
  core/                      # generic, feature-agnostic infrastructure
    instance.ts              # env-driven config (base URL, admin creds, makeStudent)
    client.ts                # generic REST client: req, login, getOrg, createStudent
    auth.ts                  # uiLogin / uiLogout (drives the real login form)
    fixtures.ts              # the `test` export (suppresses first-run onboarding)
    sharedAuth.ts            # storageState paths + the reusable shared student
  features/
    assignments/             # one feature module
      api.ts                 # assignment seeding/grading API (builds on core/client)
      verify.ts              # API read-backs for assertions
      scenario.ts            # one-call scenario setup (course→assignment→student)
      pages/                 # page objects
        student.ts           # AssignmentPage (student activity view)
        teacher.ts           # TeacherSubmissionsPage / AssignmentEditorPage / GradingModal
      fixtures/              # static test assets (e.g. an upload sample)
      tests/                 # *.spec.ts for this feature
  global-setup.ts            # boot self-host + create shared admin/student sessions
  global-teardown.ts         # docker compose down -v on the generated compose file
  playwright.config.ts       # testDir: './features' (auto-discovers every module)
```

**Import rules:** specs and feature code import shared things from `core/` and
feature-local things relatively. Specs never reach into another feature.

## Adding a new feature module

1. `mkdir -p features/<area>/{pages,tests,fixtures}`.
2. Add `features/<area>/api.ts` for that feature's API seeding — `import { req, login, getOrg, createStudent } from '../../core/client'` and build feature calls on top.
3. Add page objects under `features/<area>/pages/` (import `BASE_URL` from `../../../core/instance`).
4. Optionally add a `scenario.ts` for one-call setup.
5. Write specs in `features/<area>/tests/*.spec.ts`:
   - `import { test, expect } from '../../../core/fixtures'` (onboarding-suppressed).
   - Reuse the shared sessions: `import { ADMIN_STATE, STUDENT_STATE } from '../../../core/sharedAuth'` then `test.use({ storageState: ADMIN_STATE })` (teacher) or `STUDENT_STATE` (student). This keeps the suite under the login rate limit.
6. That's it — `playwright.config.ts` (`testDir: './features'`) discovers the new specs automatically.

## Running locally

Requires Docker running, plus Node 20+ / bun.

```bash
cd apps/e2e
bun install
bunx playwright install chromium
bun run test                              # boots a self-host, runs all features, tears it down
E2E_BASE_URL=http://localhost:8080 bun run test   # reuse a running instance (fast iteration)
bun run test:headed                       # watch it drive the UI
bun run report                            # open the HTML report after a run
```

Run a single module or spec:

```bash
bunx playwright test features/assignments         # one feature
bunx playwright test 06-manual-grading            # one spec by name
```

### Configuration (env)

| Var | Default | Purpose |
| --- | --- | --- |
| `E2E_BASE_URL` | — | Use an existing instance; skips boot + teardown. |
| `E2E_PORT` | `8080` | HTTP port for the self-host. |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | `admin@school.dev` / `E2eTestAdmin!234` | Bootstrapped admin. |
| `E2E_ORG_SLUG` | `default` | Bootstrapped org slug. |
| `E2E_CLI` | `npx --yes learnhouse@latest` | CLI used to boot (override for a local build). |
| `E2E_SKIP_BOOT` | — | `1` to skip booting (assumes instance already up). |
| `E2E_KEEP` | — | `1` to keep the instance running after the suite. |

### Reliability notes

- `core/auth.ts` saves shared admin + student browser sessions in `global-setup`;
  specs reuse them via `test.use({ storageState })`, and `core/client.login`
  caches tokens per email + retries on 429. A full run does only a handful of
  logins (the API rate-limits logins to **30 / 5 min / IP**).

## Feature coverage — assignments (32 tests)

Driven through the UI, verified against the REST API (`features/assignments/verify.ts`):

| Spec | What it proves |
| --- | --- |
| `01-lifecycle` | Student completes an all-task-types assignment; auto-graded; visible to teacher |
| `02-quiz` / `03-short-answer` / `04-number` / `05-form` | Each auto-gradable task type: answer → save → submit → auto-grade 100 |
| `06-manual-grading` | Teacher grades a submission (Full / feedback / Finalize & Complete) |
| `07-reject` | Teacher rejects a submission (it is removed) |
| `08-submissions-dashboard` | Stats, status filters, search |
| `09-retry` | Student retries a graded submission; it resets to a fresh attempt |
| `10-analytics` | Analytics KPIs + charts render for graded submissions |
| `11-show-correct-answers` / `15-show-answers-off` | Reveal setting on/off behaves correctly |
| `12-editor` | Edit modal (grading type), publish toggle, add a task |
| `13-file-submission` | Student uploads a file; teacher grades it manually |
| `14-grading-edge` | Partial quiz credit (50) and a number outside tolerance (0) |
| `16-assignments-list` | List page: search + Published/Drafts filters + Editor/Submissions links |
| `17-author-tasks` | Author task content via the editor; delete a task |
| `18-submissions-sort` | Sorting submissions by Grade reorders rows |
| `19-per-task-override` | Per-task grade override: custom numeric, Half, Zero |
| `20-editor-toggles` | Auto-grading / anti-paste / retries toggles persist |
| `21-grading-display` | Student grade display per type: PASS_FAIL→Pass, ALPHABET→A, GPA→4.0 |
| `22-student-aux` | Hint reveal, reference-document link, due date, attempt counter |
| `23-anti-copy-paste` | Anti-copy-paste deterrent blocks pasting into a form blank |

Complemented by ~580 fast backend edge-case tests under
`apps/api/src/tests/services/` (grading math, matching modes, tolerance,
server-verify dispatch, CODE grading, retry caps, due dates, permissions).

### Bugs found & fixed

1. **Manual grades discarded for auto-gradable task types** (backend): server-side
   re-verification overwrote a teacher's explicit per-task grade on finalize.
   Fixed in `apps/api/.../assignments.py` (gate re-verification to the auto-grade
   path). Covered by `test_assignment_manual_grading.py` + `06-manual-grading`.
2. **Save button hidden on retries** (frontend): the student "Save your progress"
   control was gated on submission-row existence (a retry keeps the row), so
   students couldn't save new answers. Fixed in `apps/web/.../AssignmentBoxUI.tsx`
   (gate on submission status).

> The two fixes are not in the published `:latest` image yet, so the
> manual-grading grade assertion requires this branch's code in the running
> instance (it passes against `learnhouse dev` / a branch-built image).
> CODE task type is covered by backend tests only (Judge0 isn't available on a
> self-host).
