# Optional reading sections

This prototype adds optional reading disclosures to LearnHouse's ordinary TipTap editor and student reader. It uses the official `@tiptap/extension-details` package, pinned to the same `3.31.1` version as the resolved LearnHouse TipTap packages.

## Content contract

An optional section is standard TipTap JSON with one `details` node, a short `detailsSummary`, and a `detailsContent` containing ordinary supported block nodes:

```json
{
  "type": "details",
  "attrs": { "open": false },
  "content": [
    {
      "type": "detailsSummary",
      "content": [
        { "type": "text", "text": "Exemple supplémentaire" }
      ]
    },
    {
      "type": "detailsContent",
      "content": [
        {
          "type": "paragraph",
          "content": [
            { "type": "text", "text": "Texte de l’exemple…" }
          ]
        }
      ]
    }
  ]
}
```

Schema constraints:

- `details` has exactly one `detailsSummary` followed by exactly one `detailsContent`.
- `detailsSummary` contains text only. Keep it brief and name the material inside.
- `detailsContent` contains one or more regular block nodes supported by the course editor and reader, such as paragraphs, lists, tables, or headings.
- `attrs.open` is a Boolean. Omit it or set it to `false` for the collapsed default; set it to `true` only when the section should initially be open.
- Definitions, objectives, key explanations, and required conclusions stay outside `details` so students see them without an extra action.
- Preserve all source-language text exactly. The authoring action adds a wrapper and does not rewrite the selected text.

The editor's “Optional reading section” slash command wraps the selected block(s) and inserts an empty summary when there is no selection. Authors enter a concise disclosure label and add optional material in `detailsContent`. The existing course activity JSON envelope remains unchanged: store this node inside the activity's current TipTap `doc` JSON and continue using the same activity save path.

## Compatibility and ZIP-generation recommendation

The inspected source is the official LearnHouse `1.3.6` release commit `01c645862451a1d48529fd88e0398176883b15bd`; the deployed image's source digest was not independently verified. That source resolves the TipTap packages at `3.31.1`, matching the added official Details extension.

The prototype does not alter the course ZIP format or the course-factory repository. Do not emit `details` nodes in production ZIPs until the updated LearnHouse build is deployed and an import/export round-trip is confirmed against that exact build. For a future generator integration, emit the JSON object above only for explicitly optional examples, deeper explanations, or supplementary materials; keep all required content top-level. A ZIP validator should reject missing summaries, missing content, and non-Boolean `open` values before packaging.

## Accessibility and reading behavior

- The official Details node view uses a native `<button type="button">`; the LearnHouse wrapper handles Enter and Space explicitly inside the contenteditable and retains focus after toggling.
- The button's accessible name comes from the summary, and `aria-expanded` follows the open state. The Details content uses the HTML `hidden` attribute while collapsed.
- A student table-of-contents link opens each collapsed Details ancestor, outermost first, before the browser follows the heading fragment.
- Focus indicators remain visible, reduced-motion preferences disable the caret transition, tables remain inside the mobile content column, and the reader table of contents stacks above lesson content on mobile.
- This is an implementation review, not a WCAG conformance claim. Screen-reader testing with a supported desktop and mobile assistive-technology matrix remains a release check.

## Validation record

- Automated TipTap schema tests verify node shape, keyboard activation/focus retention, `open` persistence, and save/reopen JSON round-tripping.
- The editor and student reader both register the same Details nodes.
- The LearnHouse 1.3.6 dependency tree and a production Webpack build are used for compatibility validation.
- A clean Chromium browser completed keyboard traversal, Enter/Space toggles, ToC navigation into a collapsed section, editor insertion, browser-local save/reopen, and mobile reading at 390px.
- Captures live in `screenshots/`; they show the actual production reader/editor components mounted in a clearly labeled local component harness with synthetic French lesson content.
- No real course activity, account, or API course record was used. Screen-reader testing remains unverified.
