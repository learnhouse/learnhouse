# Notifications

One inbox per person, two bells:

- **Personal** (`audience="personal"`): the learner-side inbox in the site
  header, merged with Messages into one button, and the mobile app. Grades,
  replies, mentions, live sessions, course news.
- **Admin** (`audience="admin"`): the dashboard bell. Things that need an
  admin's or a teacher's attention: submissions to grade, sync errors, plan
  limits. Who receives each admin type is an org setting
  (Dashboard → Notifications → Who's notified): admins, maintainers, and/or the
  course's authors.

| Piece | Where |
| --- | --- |
| Catalog: type → category, audience, priority, default roles; deep link per type | `src/db/notifications.py` (`NOTIFICATION_TYPE_META`, `NOTIFICATION_LINKS`) |
| Write path (prefs, grouping, dedupe, background batches, realtime publish) | `notifications.py` (`notify`) |
| Helpers for features (`emit`, `emit_admin`, routing) | `emit.py` |
| Existing core emitters (messages, grades, due dates, drip, updates, certificates, live) | `events.py` |
| OSS feature emitters | `src/services/feature_notifications.py` |
| EE feature emitters | `ee/services/notification_hooks.py` |
| Realtime (SSE over Redis pub/sub) | `realtime.py`, `GET /notifications/stream` |
| Email digest (daily / weekly, important unread only) | `digest.py` |
| Agent tools (own inbox, routing) | `src/services/ai/tools/notifications.py` |
| Web | `apps/web/components/Notifications/*`, `lib/notifications/*` |

## What every notification carries

- **Who**: `actor_id` (never the recipient themselves; the actor of an action
  is never notified about it). The web shows the actor's current name and
  avatar, so the name always matches the face.
- **What**: `type`; the web renders a translated headline from
  `notifications.copy.<type>` and the row's `data.params` at view time, in the
  viewer's language. `title` / `body` keep English copy for the mobile app and
  pushes (the mobile contract is unchanged).
- **Where / detail**: `data.params` (course › chapter, group, board,
  discussion, grade + feedback excerpt, due and start instants that the web
  formats in the viewer's timezone, counts when collapsed, provider and error
  reason for integrations). `body` holds the detail line (never the actor's
  name again).
- **Link**: `data.path`, the exact page (activity, discussion, board, grader,
  integration settings…). A row click marks it read and opens it. There are no
  inline action buttons by design: the row is the action.
- The inbox is scoped to the org the person is in; a multi-org person sees
  each org's rows in that org.

## Doing it well

- **Grouping**: `group_key` collapses repeats while unread (a conversation,
  replies in one discussion, hands raised on one board) and the headline
  switches to the `_many` copy ("3 new replies in …"). `replace_read` keeps a
  single row even after it was read (one row per learner + assignment for
  submissions; a resubmission brings it back unread).
- **Dedupe**: `dedupe_key` is unique per user, so scheduled jobs and retries
  land once, on any number of API pods.
- **No storms**: over 200 recipients, rows are written in the background in
  batches of 500 and the request returns at once. Bulk membership changes
  dedupe per hour; plan and AI-credit alerts once a day.
- **Permissions**: recipients are the people the feature already shows the
  thing to (enrolled learners, registrants, course authors, members who can
  see the community). Mentions in a restricted community only reach members
  who can see it.
- **Channels**: in-app per category (off writes nothing), push per category
  (plus a master switch for the mobile app), email = the daily or weekly digest
  of unread important rows in the categories with email on. Admin categories
  default to quiet on the phone.
- **Realtime**: one SSE stream per browser (tabs elect a leader with Web
  Locks and share it over a BroadcastChannel), polling every minute as a
  fallback. Important rows toast in the visible tab.

## Coverage by feature

Recipients: L = the learner concerned, T = teachers (course authors, by
routing), A = org admins (by routing), O = the person who owns the thing.

| Area | Event → type → who | Not notified, and why |
| --- | --- | --- |
| Courses / chapters / activities | Course update posted → `course_update` → enrolled L (author excluded) | New chapter: chapters have no publish moment, so it would fire while a course is being built (drip releases cover scheduled chapters) |
| Assignments, grading, resubmissions | Hand-in waiting for a teacher → `submission_to_grade` → T (one row per learner + assignment, a resubmission replaces it); teacher grade → `assignment_graded` → L (grade, pass/fail, feedback excerpt, grader as actor); due in 24 h and not handed in → `assignment_due` → L | Instant auto-grades on submit: the result is already on screen (opt-in per call) |
| Quizzes / exams | Through assignments (graded tasks) | |
| Certificates | Earned → `certificate` → L | |
| Drip content | Timed chapter opens → `chapter_unlocked` → L (email stays opt-in per course) | |
| Learning paths | Path completed → `path_completed` → L | Assigned: learners enrol themselves; no one else adds them |
| Required training (EE) | Assigned → `training_assigned`, two days before due → `training_due`, overdue → `training_overdue` → L; weekly → `training_overdue_report` → A | |
| Library / collections, podcasts | | Nothing is addressed to a person; browsing content needs no inbox |
| Communities | Comment on my discussion → `discussion_reply` → O (collapsed per discussion); @mention in a discussion or comment → `discussion_mention` → mentioned members who can see the community | Votes: low signal, would be noise |
| Editor comments / mentions | New thread → `editor_comment` → course authors; reply → thread participants; @mention → `editor_mention` → mentioned editors | AI editor: run by the person, result shown inline |
| Lesson notes | | Notes are private |
| Messaging | DM, agent chat, broadcast, reply to you, @mention → `message` → recipients (muted conversations skipped; no push while the person is online). In the merged inbox a DM counts once, as an unread conversation | Plain group chatter: shows as unread in Messages only |
| Live sessions + recordings (EE) | 24 h, 15 min, live now → `live_session` → registrants (host excluded; hidden after the session ends; important → toast); recording ready → `live_recording` → registrants and attendees | Calendar: same events, no separate notification |
| Boards (EE) | Added to a board or a student copy → `board_invited`; copy returned / regraded → `board_feedback` → L; hand raised → `board_hand_raise` → hosts (collapsed per board); breakout started → `board_breakout` → group members | Mentions: boards have none |
| Plays (EE) | | No share-with-a-person event |
| User groups | Added / removed (per group setting) → `group_joined` / `group_left`; announcement → `group_announcement` → members; access ends within 3 days → `group_access_expiring` → member | Smart-rule syncs go through the same join path (deduped per hour) |
| Roles, invites, signups, approvals | New member → `member_joined` → A (collapsed per org) | `signup_pending` / `join_request` are in the catalog; the product has no approval queue yet |
| Payments, offers, subscriptions (EE) | Paid checkout → `purchase_confirmed`; renewal → `subscription_renewed`; failed payment → `payment_failed` → buyer | Refunds: not handled by the payments webhook today |
| Company seats (EE) | Seat given → `seat_assigned` → member; pool full → `seat_limit_reached` → A | |
| Affiliates | | Payouts are reviewed in the dashboard; no per-event hook |
| Newsletter (EE) | Campaign sent → `newsletter_sent`; held for review / paused → `newsletter_paused`; bounce threshold → `newsletter_bounces` → A + campaign author | |
| Website / landing publish | | The publisher sees the result; other admins are not interrupted |
| CRM (EE) | Connection broken → `integration_alert` (daily); sync run with errors → `crm_sync_errors` → A | |
| SSO / SCIM, LTI, SCORM | | Machine-driven bulk events (would storm); audit log covers them. SCORM completions feed progress and certificates, which notify |
| Atlas agents (EE) | Scheduled run finished (if the owner chose in-app delivery) → `agent_run_finished`; failed / over budget → `agent_run_failed` → O | Course builder, translations, imports, exports: interactive, progress shown live |
| AI credits | Balance under 10 % → `ai_credits_low` → A (once a day, OSS reservation and EE hourly signal share the key) | |
| Plan & usage, POC | Count limit at 80 % (SaaS) or member limit reached → `plan_limit_near`; trial ending → `poc_ending` → A | |
| API tokens, webhooks | | Webhook deliveries have their own log and retries |
| Security (new device, 2FA changed) | | Sent by email: someone holding the session could clear an inbox row |
| Org deletion, platform billing | `org_payment_failed` is in the catalog | Platform billing is not handled in EE; org deletion is emailed |
| Demo instances | | Not customer facing |

## Tests

- API: `src/tests/services/test_notification_center.py` (catalog: every type
  has a category, matching audience and a deep link; audiences, filters,
  archive, bulk, grouping, `replace_read`, background batches, preferences,
  routing, realtime, digest, routes, agent tools, mobile contract),
  `test_notifications.py`, `test_notification_emitters.py`, EE
  `ee/tests/test_notification_emitters*.py`.
- Web: `tests/notifications-format.test.mjs` (every API type has a label,
  a headline and a link; every category a label and a hint; day groups,
  times, headline and detail rendering; every locale complete).
- End to end: `scratchpad/notif/matrix.cjs` triggers one real event per area
  through the product API and checks the live row, its text, context and link,
  then a row click.
