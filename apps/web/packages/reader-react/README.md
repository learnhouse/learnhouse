# @learnhouse/reader-react

Native React reader for LearnHouse course activities. A drop-in alternative to the iframe embed at `/embed/[orgslug]/course/[courseuuid]/activity/[activityid]`.

## Install

```bash
npm install @learnhouse/reader-react @tanstack/react-query \
  @tiptap/core @tiptap/pm @tiptap/react @tiptap/starter-kit
```

## Usage

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  LearnHouseReaderProvider,
  LearnHouseActivity,
} from '@learnhouse/reader-react'
import '@learnhouse/reader-react/styles.css'

const queryClient = new QueryClient()

export function CourseReader() {
  return (
    <QueryClientProvider client={queryClient}>
      <LearnHouseReaderProvider
        baseApiUrl="https://api.learnhouse.io"
        orgSlug="my-org"
        // accessToken={token} // optional
      >
        <LearnHouseActivity
          activityId="activity_abc"
          courseUuid="course_xyz"
        />
      </LearnHouseReaderProvider>
    </QueryClientProvider>
  )
}
```

## Props

### `LearnHouseReaderProvider`

| Prop           | Type     | Required | Description                                      |
| -------------- | -------- | -------- | ------------------------------------------------ |
| `baseApiUrl`   | string   | yes      | LearnHouse API base URL                          |
| `orgSlug`      | string   | yes      | Organization slug                                |
| `accessToken`  | string   | no       | Bearer token for gated content (anon by default) |
| `showPoweredBy`| boolean  | no       | Show "Powered by LearnHouse" badge (default: true) |

### `LearnHouseActivity`

| Prop          | Type   | Required | Description                            |
| ------------- | ------ | -------- | -------------------------------------- |
| `activityId`  | string | yes      | Activity UUID (with or without prefix) |
| `courseUuid`  | string | yes      | Course UUID (with or without prefix)   |
| `bgcolor`     | string | no       | Hex background color (no `#`)          |
| `textcolor`   | string | no       | Hex text color (no `#`)                |

## Supported activity types

- `TYPE_DYNAMIC` — TipTap rich-text canvas (with all custom block extensions)
- `TYPE_VIDEO` — YouTube + hosted video
- `TYPE_DOCUMENT` — PDF document
- Sub-types: `SUBTYPE_DYNAMIC_MARKDOWN`, `SUBTYPE_DYNAMIC_EMBED`

## Local development

The package source is consumed by `apps/web` directly through a TypeScript path alias (`@learnhouse/reader-react` → `./packages/reader-react/src`). No build step is needed for in-repo development — edits show up live in the Next dev server.

```bash
cd apps/web
bun dev
```

To build the publishable artifacts locally:

```bash
cd apps/web/packages/reader-react
bun install
bun run build           # ESM + CJS + types into dist/
npm pack                # produce a tarball
```

## Releasing

Publishing runs in CI on tags matching `reader-react-<version>`:

```bash
# Bump the version in package.json first, commit, then:
git tag reader-react-0.1.1
git push origin reader-react-0.1.1
```

The `.github/workflows/reader-react-publish.yaml` workflow:

1. Installs deps + typechecks + builds.
2. Verifies `package.json` version matches the tag.
3. Publishes to npm with `--provenance` and `--access public`.
4. Picks the npm dist-tag automatically: pre-releases (`-alpha`, `-beta`, `-rc`, `-next`, `-canary`) go to `next`, everything else to `latest`.

Set the `NPM_TOKEN` repository secret (granular automation token with publish rights on the `@learnhouse` scope) for the workflow to authenticate.

Pull requests touching `apps/web/packages/reader-react/**` run through `.github/workflows/reader-react-ci.yaml`, which typechecks, builds, packs, and uploads the `dist/` as a workflow artifact for inspection.

## License

MIT
