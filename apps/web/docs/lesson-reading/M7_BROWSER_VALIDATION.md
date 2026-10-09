# M7 browser validation

Validation was performed against the LearnHouse 1.3.6 source tree at baseline `69c6468574a0031219cad83d295dcbc14d192d36`. The browser ran a production build in an isolated local stack; no VPS, account, publication setting, or real course was changed.

## Preview recovery

- The old local `/auth/login` failure correlated with a Next proxy log entry: `Error: socket hang up`, code `ECONNRESET`. This is an upstream socket reset, not an exception thrown by the login route. Restarting the local app restored normal responses without changing application code for that symptom.
- The ordinary app shell, `/login`, and the local validation route returned HTTP 200 from the rebuilt server. A clean Chromium browser loaded `http://localhost:3010/m7-validation` successfully.
- Plain HTTP GETs to `http://lvh.me:3010/` and `/login` also returned 200, and Chromium loaded the login page there. The separate API preflight for `Origin: http://lvh.me:3010` returned HTTP 400 `Disallowed CORS origin`; the same preflight for `http://localhost:3010` returned 200 with that allowed origin.
- Brave initially returned `ERR_BLOCKED_BY_CLIENT` for the loopback preview. After the local app restart, Brave loaded `http://lvh.me:3010/` and `/m7-validation`; the student reader, ordinary editor, collapsed-section ToC navigation, and Space-key disclosure toggle all worked there. No Brave protection was disabled.
- The hostname workaround is limited to browser delivery: the API CORS preflight for `Origin: http://lvh.me:3010` still returns HTTP 400 `Disallowed CORS origin`. The browser harness saves through `localStorage`, so no API-backed editor persistence was verified on this hostname.
- `next dev --turbopack` could not stay up because Watchpack repeatedly reported `EMFILE: too many open files, watch`, including with the descriptor limit raised. The preview therefore used the repository's successful production standalone build and the existing local runtime configuration.
- There is no local course activity record to open through LearnHouse's normal course route. The temporary, uncommitted `/m7-validation` harness mounted the unchanged production `DynamicCanva` student reader and ordinary `Editor` with synthetic French content. Its banner identifies the harness. Save/reopen used only browser `localStorage`; it did not call the course save API.

## Browser results

- Essential explanation, learning objectives, a nested list, and a three-row table remain visible with the two optional sections collapsed.
- Clicking the ToC link for “Exemple : le trajet du carbone” changed the fragment and opened its collapsed ancestor before navigation. The same behavior worked with keyboard Enter and at 390px mobile width.
- At 390×844, the reader ToC is visible above the lesson, the page has no horizontal overflow (`documentElement.scrollWidth === 390`), and the table remains within the reading column.
- In the ordinary editor, the “Optional reading section” slash command inserted a native `details` node. A summary and body were typed, saved through the editor's save control, reopened from browser-local storage, and rendered in the reader with the same text and open state.
- Keyboard Tab reaches the ToC links and disclosure buttons. Enter and Space each toggle the focused disclosure and keep focus on that button. The ToC link for a heading inside a collapsed section opens it and moves to its fragment.
- The harness produced expected missing-course/activity request noise on editor remounts because its synthetic course identifiers do not exist in the local API. This is not a normal course-route or API persistence validation.

## Accessibility and limits

- Disclosures render as native buttons with a summary-derived accessible name, `aria-expanded`, hidden collapsed content, and a visible focus indicator. The LearnHouse wrapper handles Enter and Space within the contenteditable and restores focus after the upstream node view focuses the editor.
- When an author changes the summary in the editor, the toggle's accessible name updates. This behavior is covered by a TipTap transaction test.
- Screen-reader behavior was not tested with VoiceOver, NVDA, or TalkBack. Safari/iOS and a real authenticated course activity were not tested. The browser-local save path proves editor JSON save/reopen through the component harness only; it does not prove API persistence or ZIP import/export compatibility.
- This is implementation evidence, not a WCAG conformance claim.

## Screenshots

- [Collapsed reader: essential lesson, ToC, nested objectives, and table](screenshots/m7-reader-collapsed.png)
- [ToC navigation with the example expanded](screenshots/m7-reader-toc-expanded.png)
- [Ordinary editor after local save and reopen](screenshots/m7-editor-details-saved.png)
- [Mobile reader with the ToC visible](screenshots/m7-reader-mobile.png)
- [Mobile ToC navigation to the expanded example](screenshots/m7-reader-mobile-toc-expanded.png)

These are genuine browser captures of the production LearnHouse components in the labeled local harness, not screenshots of a standalone mockup.

## Checks

- `bun test ./tests/lesson-details.test.mjs`: **6 passed, 0 failed, 30 expectations**.
- Focused ESLint command covering the Details extension/test, editor, reader, and ToC: **0 errors, 48 warnings**. The warning set matched the existing component warnings, primarily React hook/ref diagnostics in `Editor.tsx` and effect diagnostics in `TableOfContents.tsx`.
- `bun run build --webpack`: **passed**. The cold build compiled successfully, completed TypeScript, generated all 33 static pages, and collected standalone traces.

## Course-factory recommendation

The editor and reader use the official `@tiptap/extension-details` JSON schema documented in [OPTIONAL_READING_CONTRACT.md](OPTIONAL_READING_CONTRACT.md). This is ready for a generator-side sandbox fixture, but **not for emitting production course ZIPs yet**. First validate import/export round-tripping and student rendering against the exact deployed LearnHouse build that will consume the ZIP. Keep essential teaching content outside `details`; use the node only for explicitly optional examples, deeper explanations, and supplementary material.
