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
