# LearnHouse Apps — examples

A LearnHouse **app** is a packaged static UI (HTML/CSS/JS) that an org admin
installs from the dashboard (`Apps → Manage apps`). Apps run inside a
sandboxed iframe and interact with the LearnHouse API through the Apps SDK
bridge — they never hold credentials, cannot read cookies or storage, and
cannot make network requests to anything except their own bundle.

## Anatomy of an app

```
my-app/
├── learnhouse.json   # manifest (required, at the zip root)
├── index.html        # entry point (declared in the manifest)
└── ...               # any static assets: css, js, images, fonts, json
```

`learnhouse.json`:

```json
{
  "manifest_version": 1,
  "id": "my-app",
  "name": "My App",
  "version": "1.0.0",
  "description": "What this app does",
  "entry": "index.html",
  "scopes": ["courses:read"]
}
```

- `id`: 3–40 chars, lowercase letters/digits/hyphens. Identifies the app
  within the org (re-uploading the same id stages an update).
- `scopes`: API permissions the app requests, as `{bucket}:read` or
  `{bucket}:write`. Buckets: `courses`, `activities`, `coursechapters`,
  `folders`, `media`, `certifications`, `usergroups`, `payments`, `search`,
  `assignments`. The admin reviews and approves these at install; at runtime
  the app is additionally capped to the current user's own rights.

Allowed file types: html, css, js/mjs, json, map, png/jpg/gif/webp/svg/ico,
woff/woff2/ttf/otf, txt, md. Anything else rejects the package.

## Using the SDK

Load the SDK (served by the platform, same-origin) and talk to the host:

```html
<script src="/apps-sdk/v1.js"></script>
<script>
  lh.init().then((ctx) => {
    // ctx = { app, org: {id, slug, name}, user: {username}, locale }
    return lh.api.get(`courses/org_slug/${ctx.org.slug}/page/1/limit/10`)
  }).then((res) => {
    // res = { ok, status, data }
  })
</script>
```

API paths are relative to `/api/v1/`. See the backend's `/openapi.json` (or
the dashboard's Developers → API Access page) for the full API reference.

## Packaging & installing

```bash
cd hello-world
zip -r ../hello-world.zip . -x '.*'
```

Then in the dashboard: **Apps → Manage apps → Upload app (.zip)**, review the
requested permissions, and approve. The app appears in the Apps menu.
