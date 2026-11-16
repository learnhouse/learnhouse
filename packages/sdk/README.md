# @learnhouse/sdk

Typed client for the [LearnHouse](https://learnhouse.app) API. No runtime
dependencies: it only uses `fetch`, `AbortController`, `Headers` and
`FormData`, so it runs in browsers, Node 18+, Bun, Deno, edge workers and
React Native.

The types are generated from the API's OpenAPI schema, and the package version
matches the LearnHouse release it was generated from.

```sh
npm install @learnhouse/sdk
```

## Browser (cookie session)

When your page shares the LearnHouse session cookie, send it along and the API
treats the request as the signed-in user.

```ts
import { createClient } from '@learnhouse/sdk'

const lh = createClient({ baseUrl: 'https://api.your-school.com', credentials: 'include' })

const org = await lh.orgs.get('your-school')
const courses = await lh.courses.list('your-school', { limit: 12 })
const course = await lh.courses.getMeta(courses[0].course_uuid!) // chapters + activities

const thumb = lh.media.getCourseThumbnailMediaDirectory(
  org.org_uuid!,
  course.course_uuid!,
  course.thumbnail_image!,
)
```

## Node / server (API token)

Create an API token in your org's settings (it starts with `lh_`). It acts on
that one org.

```ts
import { createClient, LearnHouseError } from '@learnhouse/sdk'

const lh = createClient({ baseUrl: process.env.LEARNHOUSE_URL!, token: process.env.LEARNHOUSE_TOKEN! })

try {
  const activity = await lh.activities.get('activity_...')
  console.log(activity.name, activity.content)
} catch (err) {
  if (err instanceof LearnHouseError) console.error(err.status, err.code, err.detail)
  else throw err
}

// Anything the resources don't cover, fully typed from the schema:
const meta = await lh.GET('/api/v1/courses/{course_uuid}/meta', {
  params: { path: { course_uuid: 'course_...' }, query: { slim: true } },
})
```

## React Native

There are no cookies to lean on, so keep the tokens yourself (for example in
`expo-secure-store`) and hand the client a `getToken` function. It is called
before every request.

```ts
import * as SecureStore from 'expo-secure-store'
import { createClient } from '@learnhouse/sdk'

const lh = createClient({
  baseUrl: 'https://api.your-school.com',
  getToken: () => SecureStore.getItemAsync('lh_access'),
})

const res = await lh.auth.login({ email, password })
if (!res.mfa_required) {
  await SecureStore.setItemAsync('lh_access', res.tokens.access_token)
  await SecureStore.setItemAsync('lh_refresh', res.tokens.refresh_token)
}

// Access tokens last 8 hours. Refresh tokens are single-use: store the new one.
const tokens = await lh.auth.refresh({ refreshToken: await SecureStore.getItemAsync('lh_refresh') ?? undefined })
```

The package's `react-native` field points at the ESM build. It avoids
`URL`/`URLSearchParams` (only partly implemented in React Native) and
`DOMException` (missing on Hermes).

## Client options

| Option | Default | |
| --- | --- | --- |
| `baseUrl` | required | API origin, without `/api/v1` |
| `token` | | Static bearer token: an `lh_` API token or a user access token |
| `getToken` | | `() => string \| null \| Promise<...>`, called per request |
| `credentials` | unset | Passed to `fetch`; use `'include'` for browser cookie sessions |
| `mediaUrl` | `baseUrl` | Origin serving `content/...` files, if different |
| `headers` | | Sent with every request |
| `timeoutMs` | `30000` | Per attempt, including the response body. `0` disables |
| `retry` | `2` | GET/HEAD on network errors, timeouts and 5xx, and any method on 429, with backoff. `false` disables |
| `fetch` | global `fetch` | Custom implementation |
| `onRequest` / `onResponse` | | Hooks; `onRequest` may edit `ctx.init.headers` |

Every call also takes `signal`, `headers`, `timeoutMs` and `retry`.

## Rate limits

A `429` or `503` with a `Retry-After` header (seconds or an HTTP date) is retried
after exactly that delay, as long as it fits in the retry policy's `maxDelayMs`
(default 5000). A longer wait is not retried early: the error is thrown with
`err.retryAfterMs` set so you can schedule the next try.

## Pagination

```ts
for await (const course of lh.courses.listAll('your-school')) {
  console.log(course.name)
}

for await (const page of lh.search.orgPages('your-school', 'payouts')) {
  console.log(page.courses.length)
}
```

Both stop after the first short page and never request past the end. For any
other page/limit endpoint, `paginate(({ page, pageSize, signal }) => ..., { pageSize })`
does the same.

## Rendering an activity

`activities.resolve` loads an activity by id (with or without the `activity_`
prefix) or by name inside a course, the way `@learnhouse/react` does. Fetch on
your server and pass the result to the component, so the browser needs no CORS
setup and never sees your token:

```tsx
const activity = await lh.activities.resolve({ courseId: 'course_...', activityName: 'How payouts work' })
return <LearnHouseActivity activity={activity} courseId="course_..." baseUrl={LEARNHOUSE_URL} />
```

## Webhooks

```ts
import { parseWebhook } from '@learnhouse/sdk'

const { event, deliveryId, data } = await parseWebhook({
  payload: await req.text(), // the raw body, not req.json()
  headers: req.headers,
  secret: process.env.LEARNHOUSE_WEBHOOK_SECRET!,
})
```

It checks the `X-Webhook-Signature` HMAC with Web Crypto and throws a
`LearnHouseError` (`INVALID_SIGNATURE`, status 401, or `INVALID_PAYLOAD`, status
400) when it fails. `verifyWebhookSignature({ payload, signature, secret })`
returns a boolean instead. The signature carries no timestamp of its own, so
store each `deliveryId` and ignore repeats; retries reuse it.

## Agent API

`client.agent` talks to the Agent API (`/api/v1/agent`), the public side of
Atlas and the learner copilot: build your own chat UI with conversations,
streamed turns (text, views, citations, approvals, tool calls) and resumable
streams. These routes are part of LearnHouse EE, so they are not in the
generated OSS schema; their types are written by hand in `src/agent/types.ts`
and exported from the package root (`Agent`, `Conversation`, `Message`, `View`,
`AgentEvent`, ...).

```ts
const lh = createClient({ baseUrl, token }) // org API token (server), member JWT or embed session

const conversation = await lh.agent.createConversation({ agent: 'copilot', context: { course_uuid: 'course_...' } })

// Streamed: an AsyncIterable of typed events, parsed from SSE over fetch.
const stream = lh.agent.streamMessage(conversation.id, 'What should I study next?')
for await (const event of stream) {
  if (event.type === 'text.delta') process.stdout.write(event.delta)
  if (event.type === 'view') render(event.view)
  if (event.type === 'approval.required') ask(event.approval)
}

// Or fold a whole turn into a Message (same shape as listMessages()):
const message = await lh.agent.streamMessage(conversation.id, 'Summarize chapter 2').finalMessage()
const same = await lh.agent.sendMessage(conversation.id, 'Summarize chapter 2') // stream: false
```

- Dropped connections are resumed automatically from the last event id
  (`reconnect`, default 3 attempts; `onReconnect` reports them). Pick a turn up
  later with `lh.agent.resume(id, { lastEventId: stream.lastEventId })`; every
  event also carries its SSE `id`.
- Approvals: `lh.agent.approve(approvalId, { confirmationPhrase })` and
  `lh.agent.deny(approvalId, { reason })` stream the continuation (same
  `message_id`), or pass `stream: false` to get the finished Message. While
  other approvals or tool results of the step are still due, the answer is
  short: a stream of `approval.resolved` + `message.done` (`requires_action`,
  empty text, a `note`), or `{ waiting_on, events }` with `stream: false`
  (`isAgentWaiting(result)`).
- Member sessions (a user JWT) must name the org: `orgId` on `listAgents`,
  `getAgent`, `listTools`, `listConversations`, and `org_id` in
  `createConversation`. API tokens and embed sessions carry their org.
- View components arrive in the wire shape of `GET /views/schema` (table rows
  are flat `{ <column key>: value, _link? }` objects; links are `{ kind, uuid }`
  or a relative `path`).
- Client tools: answer `tool.call` events with `client: true` through
  `lh.agent.submitToolResults(id, [{ call_id, output }])`.
- Also: `listAgents`, `getAgent`, `listTools`, `getViewsSchema`,
  `renderTemplate`, `listConversations`, `getConversation`,
  `deleteConversation`, `listMessages`, `cancel`.
- `collectMessage(events, seed?)` and `AgentMessageBuilder` fold events into a
  Message yourself; `SSEParser` / `readSSE` are the SSE parser underneath.
- Errors are `LearnHouseError`s with the API's `code` (`agent_not_available`,
  `out_of_credits`, `rate_limited` with `retryAfterMs`, ...). A stream that ends
  before `message.done` and can't be resumed throws `STREAM_INTERRUPTED`.
  `error` events inside a turn are events, not exceptions.

## Development

```sh
bun install
bun run generate        # regenerate openapi.json + src/generated/schema.ts from apps/api
bun run generate:check  # fail if the committed output is stale (CI)
bun run sync-version    # copy apps/web's version into package.json + src/version.ts
bun run build
bun run test            # unit tests + an integration test that runs if an API answers on :1338
bun run typecheck
```

`generate` imports the FastAPI app and dumps `app.openapi()`; no server or
database is needed. It finds Python through `$LEARNHOUSE_API_PYTHON`, then
`apps/api/.venv`, then `uv`. Internal, dev, demo, admin and EE-only routes are
left out.

## License

<!-- TODO: license is pending a decision with the maintainer. package.json says MIT as a placeholder. -->
MIT (placeholder, pending confirmation).
