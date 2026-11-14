<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI design system

New or changed UI follows the LearnHouse V2 design system. Read `design/DESIGN.md` first and import from `@/design` (DashPage, DashPageHeader, Panel, Toolbar, Button, SubTabs, StatusPill, AIButton, tokens, recipes…). Reuse a primitive, then a recipe, then a token; don't hand-roll cards, buttons or AI branding. Tokens live in `design/tokens.ts` (run `bun scripts/design-tokens.mjs` after editing); the dev-only style guide is at `/design-system`.
