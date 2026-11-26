# @learnhouse/react

Render LearnHouse activities inside any React app. Pages, quizzes, flipcards, scenarios, code playgrounds, math, video and PDFs all look and behave as they do in LearnHouse.

The package is compiled from the LearnHouse web app's own source at each release. Its version always matches the LearnHouse release it was built from, so `@learnhouse/react@1.4.3` renders exactly what LearnHouse 1.4.3 renders.

```bash
npm install @learnhouse/react
```

## Usage

```tsx
import { LearnHouseActivity } from '@learnhouse/react'
import '@learnhouse/react/styles.css'

export function Lesson() {
  return (
    <LearnHouseActivity
      baseUrl="https://learn.example.com"
      activityId="activity_0b3c…"
      courseId="course_9f2a…"
    />
  )
}
```

There are four ways to say what to render:

```tsx
// By id. Passing courseId as well loads the course in parallel.
<LearnHouseActivity activityId="activity_…" courseId="course_…" />

// By name, inside a course (case-insensitive)
<LearnHouseActivity activityName="How payouts work" courseId="course_…" />

// An activity you fetched yourself, for example on the server with @learnhouse/sdk
<LearnHouseActivity activity={activity} courseId="course_…" />

// A raw document (the JSON LearnHouse stores), with no network calls
<LearnHouseActivity content={doc} orgId="org_…" courseId="course_…" />
```

Wrap several activities in a provider to share one client, one session and the same defaults:

```tsx
import { LearnHouseProvider, LearnHouseActivity } from '@learnhouse/react'

export const Course = () => (
  <LearnHouseProvider
    baseUrl="https://learn.example.com"
    // A learner session your server minted with @learnhouse/sdk's embed.createSession()
    getSession={() => fetch('/api/learnhouse-session', { method: 'POST' }).then((r) => r.json())}
    theme={{ accent: '#7c3aed' }}
    locale="fr"
    onEvent={(e) => analytics.track(e.type, e)}
  >
    <LearnHouseActivity activityId="activity_…" />
  </LearnHouseProvider>
)
```

Never pass an `lh_` API token to the browser: the provider throws if you try. Keep API tokens on your server, together with `@learnhouse/sdk`, and give the browser an embed session (`session` / `getSession`). See [Signed-in learners](https://docs.learnhouse.app/developers/react/learners).

## Progress hooks

Under a provider, `useCourseProgress(orgId, course)` and `useTrail(orgId)` give you the learner's progress as state. They share one copy of the trail with every activity's **Mark as complete** button, so a course header updates the moment a lesson is completed, without another request.

```tsx
import { useCourseProgress } from '@learnhouse/react'

export function CourseHeader({ orgId, courseUuid }: { orgId: number; courseUuid: string }) {
  const { progress, complete } = useCourseProgress(orgId, courseUuid)
  if (!progress) return null
  return (
    <header>
      {progress.completed}/{progress.total} lessons ({progress.percent}%)
      <button onClick={() => complete('activity_…')}>Mark the intro done</button>
    </header>
  )
}
```

It also returns `enroll()`, `leave()`, `uncomplete()`, `isCompleted(activityId)`, `loading`, `error` and `refresh()`. `useLearnHouseClient()` gives you the provider's `@learnhouse/sdk` client for everything else.

## Customization

| Prop | What it does |
|---|---|
| `theme` | `mode` (`light`/`dark`/`auto`), `accent`, `background`, `text`, `mutedText`, `border`, `fontFamily`, `headingFontFamily`, `codeFontFamily`, `fontSize`, `radius`, `contentWidth`, `padding`, and `cssVariables` for anything else |
| `components` | Replace or wrap any block by node name (`blockQuiz`, `callout`, `flipcard`, `heading`, `blockImage`…). Each override gets `Default`, which renders the built-in block. |
| `marks` | Replace any mark (`link`, `bold`, `code`…) |
| `hideBlocks` | Node names to leave out |
| `transformContent` | Rewrite the document before it renders |
| `showTitle`, `header`, `footer` | The activity name, and slots above and below the content (each slot can be a function of the activity) |
| `showPoweredBy` + `siteUrl` | A small link back to the activity on your LearnHouse site |
| `linkTarget`, `onLinkClick` | Choose where links open, or intercept them (return `false` to cancel) |
| `locale`, `messages`, `dir` | UI language (22 bundled), string overrides keyed like LearnHouse's locale files, and text direction |
| `fallback`, `errorFallback` | Loading and error UI. `errorFallback` can be `(error, retry) => …` |
| `className`, `style`, `unstyled` | Hooks into the root element |

```tsx
import { LearnHouseActivity, type BlockOverrideProps } from '@learnhouse/react'

const Callout = ({ Default, ...props }: BlockOverrideProps) => (
  <aside className="my-callout">
    <Default {...props} />
  </aside>
)

export const Lesson = () => (
  <LearnHouseActivity
    activityId="activity_…"
    components={{ callout: Callout }}
    hideBlocks={['blockQuiz']}
    theme={{ mode: 'auto', accent: '#0ea5e9', contentWidth: 720, radius: 8 }}
  />
)
```

In dark mode, text and background follow the theme. Blocks keep the light cards they use in LearnHouse.

## Events

`onEvent` receives `load`, `ready`, `error`, `progress` (a signed-in learner's completion was saved), `session_expired`, `link_click`, `media` (`play`/`pause`/`ended`/`progress` for video and audio), `resize` (useful for sizing an iframe or modal), `visible`, `complete` (the end of the activity scrolled into view, with `trackCompletion`) and `analytics` (the events LearnHouse's own blocks send). There are also `onLoad` and `onError` callbacks.

## Custom element

`@learnhouse/react/element` registers `<learnhouse-activity>`, the same component as a custom element for apps that don't render React (Svelte, Angular, plain HTML; Vue has [`@learnhouse/vue`](https://www.npmjs.com/package/@learnhouse/vue)). It renders in its own light DOM, so the same stylesheet applies.

```html
<script type="module">
  import '@learnhouse/react/element'
  import '@learnhouse/react/styles.css'
</script>

<learnhouse-activity base-url="https://learn.example.com" activity-id="activity_…" course-id="course_…" theme='{"accent":"#7c3aed"}'></learnhouse-activity>
```

Attributes: `activity-id`, `activity-name`, `course-id`, `base-url`, `media-url`, `site-url`, `org-id`, `token`, `locale`, `dir`, `link-target`, `theme`, `messages` and `content` (JSON), `hide-blocks` (comma list or JSON), and the booleans `show-title`, `track-completion`, `show-powered-by`, `unstyled`, `hide-error`. Objects and functions (`activity`, `content`, `client`, `getToken`, `user`, `transformContent`) are set as properties. Events arrive as DOM events: `lh-load`, `lh-ready`, `lh-error`, `lh-complete`, `lh-media`, `lh-resize`, `lh-visible`, `lh-analytics`, `lh-event` (all of them) and the cancelable `lh-link-click`, each with the event in `detail`. `el.reload()` mounts the activity again.

## Agent API

Rebuild the Atlas / copilot chat in your own UI on the Agent API (see the
`client.agent` section of [`@learnhouse/sdk`](https://www.npmjs.com/package/@learnhouse/sdk)).

`useAgentConversation()` keeps one conversation as state. Streamed text appends
live; views, citations and approvals attach to the assistant message; a dropped
stream resumes from the last event id.

```tsx
import { useAgentConversation, AgentView } from '@learnhouse/react'

const chat = useAgentConversation({ baseUrl, token, agent: 'copilot', create: { context: { course_uuid: 'course_…' } } })
// chat.messages, chat.status ('idle' | 'loading' | 'streaming' | 'requires_action' | 'error'), chat.error
// chat.send(text), chat.approve(id, phrase?), chat.deny(id, reason?), chat.cancel()
// chat.submitToolResult(callId, output), chat.pendingApprovals, chat.pendingToolCalls, chat.suggestions
```

It takes a `client`, or `baseUrl` + `token` / `session`, or uses the nearest
`<LearnHouseProvider>`'s client. With a member session (a user JWT) pass
`orgId`: it is sent when the agent profile loads (`chat.agent`) and when the
conversation is created. The conversation is created on the first
`send()` (or pass `conversationId` to open one; a running turn is re-attached).

`<AgentChat />` is a ready-made chat on top of it: message list, composer,
approval cards (with the typed confirmation phrase when `approval.confirmation`
is set), citations, suggestion chips and renderers for the common view
components (kpis, table, chart, cards, timeline, steps, callout, text,
checklist, progress, comparison, code, quiz, choices, glossary). A view with any
other component type shows its `fallback_markdown`, rendered as React elements
(server strings are never injected as HTML).

```tsx
<AgentChat baseUrl={baseUrl} token={token} agent="copilot" siteUrl="https://learn.example.com"
  renderView={(view, fallback) => fallback} theme="auto" />
```

Override any component type with `renderers` (a renderer gets `component`,
`view`, `message`, `send` and `resolveLink`), or wrap whole views and messages
with `renderView` / `renderMessage`. View links (`_link` on table rows, `link`
on progress items, a card's `kind` + `uuid`) open on `siteUrl` (relative paths,
and course pages); pass `resolveLink` to send them into your own routes. `AgentView`, `ApprovalCard`,
`CitationList` and `AgentMarkdown` are exported for custom layouts. Styles are
the `lh-agent-*` classes in `styles.css`, themed with `--lh-agent-*` custom
properties (light and dark). `@learnhouse/react/element` also registers
`<learnhouse-agent-chat>` (attributes `base-url`, `token`, `agent`, `org-id`,
`conversation-id`, `site-url`, `placeholder`, `theme`, `starters`; events
`lh-agent-event`, `lh-agent-conversation`, `lh-agent-error`).

A custom-UI example lives in `demo/agent.tsx`: `bun run demo`, then open
`http://localhost:3538/agent.html?base=http://localhost:1377&token=<jwt>&agent=atlas&org=<org id>`.

## Styles

`@learnhouse/react/styles.css` is LearnHouse's own stylesheet, compiled for the blocks the renderer uses and scoped under `.lh-activity`, so it doesn't leak into your page.

## Notes

- Blocks render without an editor: the document goes through TipTap's static renderer into LearnHouse's block components. A block's code loads only when a document contains that block.
- One LearnHouse instance per page: media URLs come from the most recently mounted provider's `baseUrl`.
- License: MIT. See [LICENSE](./LICENSE).
