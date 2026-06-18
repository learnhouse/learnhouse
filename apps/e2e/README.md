# LearnHouse E2E — assignments acceptance suite

Browser-driven, human-like end-to-end tests for the **assignments** feature. The
suite boots a real LearnHouse **self-host via the LearnHouse CLI** (`setup --ci`,
pulling the published image), then drives the UI with Playwright exactly like a
teacher and a student would: build an assignment with tasks, submit answers,
auto-grade, and grade as a teacher.

These tests validate the **shipped self-host product**. For fast, deterministic
coverage of the grading logic itself, see the backend unit tests in
`apps/api/src/tests/services/test_assignment_grading.py`.

## What it covers

Every major assignment surface, driven through the UI and verified against the
REST API (`helpers/verify.ts` / `helpers/api.ts`):

| Spec | Feature |
| --- | --- |
| `01-lifecycle` | Student completes an all-task-types assignment; auto-graded; visible to teacher |
| `02-quiz` / `03-short-answer` / `04-number` / `05-form` | Each auto-gradable task type: answer → save → submit → auto-grade 100 |
| `06-manual-grading` | Teacher grades a submission via the dashboard (Full / feedback / Finalize & Complete) |
| `07-reject` | Teacher rejects a submission (it is removed) |
| `08-submissions-dashboard` | Stats, status filters (All/Late/Submitted/Graded), search |
| `09-retry` | Student retries a graded submission; it resets to a fresh attempt |
| `10-analytics` | Analytics subpage KPIs + charts render for graded submissions |
| `11-show-correct-answers` | Accepted answer revealed to the student after grading |
| `12-editor` | Edit modal (grading type), publish/unpublish toggle, add a task |
| `13-file-submission` | Student uploads a file; teacher grades it manually |
| `14-grading-edge` | Partial quiz credit (50) and a number outside tolerance (0) |
| `15-show-answers-off` | Reveal setting OFF ⇒ accepted answer is NOT shown (negative) |
| `16-assignments-list` | Assignments list page: search + Published/Drafts filters + Editor/Submissions links |
| `17-author-tasks` | Author task content via the editor (general + short-answer content), delete a task |
| `18-submissions-sort` | Sorting submissions by Grade reorders rows |
| `19-per-task-override` | Per-task grade override in the grading modal: custom numeric, Half, Zero |
| `20-editor-toggles` | Edit-modal toggles (auto-grading, anti-paste, retries) persist |
| `21-grading-display` | Student grade display per type: PASS_FAIL→Pass, ALPHABET→A, GPA→4.0 |
| `22-student-aux` | Hint reveal, reference-document link, due date, attempt counter |
| `23-anti-copy-paste` | Anti-copy-paste deterrent blocks pasting into a form blank |

Specs `16`–`23` reuse a shared admin/student session via `test.use({ storageState })`
(see `helpers/sharedAuth.ts` + `global-setup.ts`), so they add no extra logins.

Backed by an extensive, fast, deterministic backend edge-case suite under
`apps/api/src/tests/services/` (≈470 tests):
`test_assignment_grading.py`, `test_short_answer_matching_edge.py`,
`test_number_answer_edge.py`, `test_quiz_grading_edge.py`,
`test_form_grading_edge.py`, `test_grade_computation_edge.py`,
`test_server_verify_dispatch_edge.py`, `test_code_grading_edge.py`,
`test_retry_attempt_caps_edge.py`, `test_due_date_edge.py`,
`test_permissions_edge.py`, and `test_assignment_manual_grading.py`. These cover
unicode/whitespace/regex short-answer matching, number tolerance/scientific
notation/NaN/inf, quiz & form partial credit and malformed payloads,
grade/letter/GPA boundary math, server-verify dispatch, CODE grading modes
(Judge0 mocked), retry attempt caps & status transitions, due-date parsing, and
access-control / API-token guards.

## Reliability notes

- Read-backs use the cached **admin** token (`getUserSubmission`/`getUserGrade`)
  rather than a per-spec student API login, and `api.login` caches per email +
  retries once on 429 — this keeps a full run to ~20 logins.
- The API rate-limits logins to **30 / 5 min / IP**. A single suite run is
  comfortably under that; `uiLogin` also retries on rate-limit. Avoid running the
  full suite **more than once within the same 5-minute window from one IP**
  (e.g. rapid local re-runs), or logins will be throttled. CI runs once per
  fresh instance, so this is a non-issue there.

## Bugs found & fixed during this work

1. **Manual grades discarded for auto-gradable task types** (backend). On the
   teacher's manual grading path, server-side re-verification re-derived the
   grade from the student's answer and overwrote the teacher's explicit
   per-task grade — so a teacher could never award credit the matcher would mark
   wrong. Fixed in `apps/api/.../assignments.py` by gating re-verification on
   the auto-grade path only. Covered by `test_assignment_manual_grading.py` and
   `06-manual-grading`.
2. **Save button hidden on retries** (frontend). The student "Save your
   progress" control was gated on the *existence* of a submission row, which a
   retry keeps in place (PENDING) — so on a retry the control disappeared and
   students could not save new answers (re-scoring 0). Fixed in
   `apps/web/.../AssignmentBoxUI.tsx` by gating on submission *status*.

> The `06-manual-grading` grade assertion requires bug #1's fix to be present in
> the running instance. It passes against `learnhouse dev` (local source) or any
> image built from this branch; it will pass against `:latest` once this change
> ships.

## Running locally

Requires Docker running, plus Node 20+ / bun.

```bash
cd apps/e2e
bun install                 # or: npm install
bunx playwright install chromium
bun run test                # boots a self-host, runs the suite, tears it down
```

The boot pulls `ghcr.io/learnhouse/app:latest` the first time — allow a few
minutes. The suite serves on `http://localhost:8080` by default.

### Run against an already-running instance (fast iteration)

Skip the boot/teardown and point the suite at an instance you started yourself
(e.g. `learnhouse setup`, `learnhouse dev`, or a previous run kept with
`E2E_KEEP=1`):

```bash
E2E_BASE_URL=http://localhost:8080 bun run test
```

### Watch it drive the UI like a person

```bash
bun run test:headed
# or the interactive runner:
bun run test:ui
```

### Debugging a failed run

```bash
E2E_KEEP=1 bun run test       # leave the instance up after the run
bun run report                # open the HTML report (traces, screenshots, video)
```

## Configuration (env)

| Var | Default | Purpose |
| --- | --- | --- |
| `E2E_BASE_URL` | — | Use an existing instance; skips boot + teardown. |
| `E2E_PORT` | `8080` | HTTP port for the self-host. |
| `E2E_DOMAIN` | `localhost` | Domain passed to the CLI. |
| `E2E_ORG_SLUG` | `default` | Bootstrapped org slug. |
| `E2E_ADMIN_EMAIL` | `admin@school.dev` | Bootstrapped admin/teacher. |
| `E2E_ADMIN_PASSWORD` | `E2eTestAdmin!234` | Admin password. |
| `E2E_INSTALL_NAME` | `e2e` | CLI install name (dir under `~/.learnhouse`). |
| `E2E_CLI` | `npx --yes learnhouse@latest` | CLI used to boot (override for a local build). |
| `E2E_SKIP_BOOT` | — | `1` to skip booting (assumes instance already up). |
| `E2E_KEEP` | — | `1` to keep the instance running after the suite. |

## Layout

```
global-setup.ts      # boot self-host via CLI + wait for health/org
global-teardown.ts   # docker compose down -v on the generated compose file
helpers/
  instance.ts        # env-driven config + student factory
  auth.ts            # UI login / signup / logout
  seed.ts            # UI course → chapter → assignment + task builders
  verify.ts          # REST API read-back assertions
tests/
  01-lifecycle.spec.ts   # full human flow, all four task types
  02-quiz.spec.ts
  03-short-answer.spec.ts
  04-number.spec.ts
  05-form.spec.ts
```
