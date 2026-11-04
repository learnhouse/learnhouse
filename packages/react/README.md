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

<LearnHouseProvider
  baseUrl="https://learn.example.com"
  getToken={() => session.accessToken}   // user token, refreshed on demand
  theme={{ accent: '#7c3aed' }}
  locale="fr"
  onEvent={(e) => analytics.track(e.type, e)}
>
  <LearnHouseActivity activityId="activity_…" />
</LearnHouseProvider>
```

Never pass an `lh_` API token to the browser. In a browser, use a user's access token. Keep API tokens on your server, together with `@learnhouse/sdk`.

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
const Callout = ({ Default, ...props }) => (
  <aside className="my-callout">
    <Default {...props} />
  </aside>
)

<LearnHouseActivity
  activityId="activity_…"
  components={{ callout: Callout }}
  hideBlocks={['blockQuiz']}
  theme={{ mode: 'auto', accent: '#0ea5e9', contentWidth: 720, radius: 8 }}
/>
```

In dark mode, text and background follow the theme. Blocks keep the light cards they use in LearnHouse.

## Events

`onEvent` receives `load`, `ready`, `error`, `link_click`, `media` (`play`/`pause`/`ended`/`progress` for video and audio), `resize` (useful for sizing an iframe or modal), `visible`, `complete` (the end of the activity scrolled into view, with `trackCompletion`) and `analytics` (the events LearnHouse's own blocks send). There are also `onLoad` and `onError` callbacks.

## Styles

`@learnhouse/react/styles.css` is LearnHouse's own stylesheet, compiled for the blocks the renderer uses and scoped under `.lh-activity`, so it doesn't leak into your page.

## Notes

- Blocks render without an editor: the document goes through TipTap's static renderer into LearnHouse's block components. A block's code loads only when a document contains that block.
- One LearnHouse instance per page: media URLs come from the most recently mounted provider's `baseUrl`.
- License: TODO (to be confirmed by the maintainers before the first publish).
