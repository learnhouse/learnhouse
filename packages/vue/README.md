# @learnhouse/vue

Render LearnHouse activities inside any Vue 3 or Nuxt app. Pages, quizzes, flipcards, scenarios, code playgrounds, math, video and PDFs look and behave as they do in LearnHouse.

There is no second renderer: the component wraps `<learnhouse-activity>`, the custom element of [`@learnhouse/react`](https://www.npmjs.com/package/@learnhouse/react), which mounts LearnHouse's own blocks in a React root. Its version always matches the LearnHouse release it was built from.

```bash
npm install @learnhouse/vue
```

## Usage

```ts
// main.ts
import '@learnhouse/vue/styles.css'
```

```vue
<script setup lang="ts">
import { LearnHouseActivity } from '@learnhouse/vue'
</script>

<template>
  <LearnHouseActivity base-url="https://learn.example.com" activity-id="activity_0b3c…" course-id="course_9f2a…">
    <template #fallback>Loading…</template>
    <template #footer="{ activity }">You finished {{ activity.name }}</template>
  </LearnHouseActivity>
</template>
```

Say what to render with `activity-id`, `activity-name` + `course-id`, `:activity` (an object you fetched) or `:content` (a raw document).

Share an instance, a token and defaults with a provider, and use the SDK client in your own code:

```vue
<LearnHouseProvider base-url="https://learn.example.com" :token="accessToken" :theme="{ accent: '#7c3aed' }" locale="fr" @event="track">
  <RouterView />
</LearnHouseProvider>
```

```ts
import { useActivity, useLearnHouseClient } from '@learnhouse/vue'

const { activity, loading, error, refresh } = useActivity(() => props.id)
const client = useLearnHouseClient()
```

Events: `@load`, `@ready`, `@complete`, `@progress`, `@session-expired`, `@media`, `@resize`, `@error`, `@event` (all of them) and `@link-click` (return `false` to stop the navigation). Slots: `fallback`, `header`, `footer`, `error`.

Never pass an `lh_` API token to the browser. Give the provider an embed session your server minted with `@learnhouse/sdk` (`session` / `get-session`), and keep API tokens on your server.

## Progress

`useCourseProgress(orgId, course)` and `useTrail(orgId)` share one copy of the learner's trail under the provider. Changes made through them, or with an activity's own **Mark as complete** button, reach every one of them.

```ts
import { useCourseProgress } from '@learnhouse/vue'

const { progress, loading, enroll, complete, isCompleted } = useCourseProgress(() => props.orgId, () => props.courseUuid)
// progress.value: { enrolled, completed, total, percent, completedActivityIds } | null
```

`enroll()` needs a full LearnHouse sign-in; with an embed session, enroll learners from your server (`lh.admin.enrollments.enroll`).

## Agent API

`<AgentChat>` wraps `<learnhouse-agent-chat>` from `@learnhouse/react` (the same
React chat, no second renderer) and uses the provider's instance and session
by default:

```vue
<AgentChat agent="copilot" :starters="['What should I study next?']" @event="log" @conversation="save" />
```

Props: `base-url`, `token`, `session`, `client`, `agent`, `org-id` (needed with a member session), `conversation-id`,
`create`, `site-url`, `placeholder`, `theme`, `starters`, `greeting`, `labels`.

For your own UI, `useAgentConversation()` runs on `@learnhouse/sdk` alone (no
React; pass `orgId` with a member session) and returns refs: `messages`, `status`, `error`, `conversation`,
`pendingApprovals`, `pendingToolCalls`, plus `send`, `approve`, `deny`,
`cancel`, `submitToolResults`.

## Nuxt

Add `css: ['@learnhouse/vue/styles.css']` to `nuxt.config.ts`. No `<ClientOnly>` needed: the server renders the `fallback` slot and the renderer loads in the browser.

## Size

React and React DOM come with this package (about 67 KB gzipped) and load lazily, after the component mounts, together with the renderer. The entry bundle grows by about 6 KB gzipped. Blocks load only when an activity contains them.

## Not yet supported

- Block and mark overrides (`components`, `marks` in `@learnhouse/react`). Use `hide-blocks` and `transform-content` instead.
- One LearnHouse instance per page, as with `@learnhouse/react`: media URLs follow the most recently mounted `base-url`.

Docs: https://docs.learnhouse.app/developers/vue

## License

MIT. See [LICENSE](./LICENSE).
