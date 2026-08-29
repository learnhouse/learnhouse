export type EditorRange = { from: number; to: number }

/**
 * Clamp a ProseMirror range to a document of `docSize`, or return null when
 * nothing is left of it.
 *
 * A range captured from `editor.state.selection` is a pair of raw integers. It
 * stops being valid the moment a transaction shortens the document — the AI
 * stream inserting and then unsetting marks, an undo, the user deleting the
 * paragraph the range pointed at. Reading such a range back unguarded walks off
 * the end of the fragment: `textBetween` dies on "Cannot read properties of
 * undefined (reading 'nodeSize')" (LEARNHOUSE-WEB-64, the selection-indicator
 * render in AIEditorSidePanel).
 *
 * WHAT THIS IS NOT FOR. It does not stop tiptap's own throws. `setTextSelection`
 * already runs both ends through `minMax(…, TextSelection.atStart(doc).from,
 * TextSelection.atEnd(doc).to)` (@tiptap/core/dist/index.cjs, src/commands/
 * setTextSelection.ts), so an out-of-range integer never reaches ProseMirror
 * through that command in the first place. Anything that clamps here was
 * already going to be clamped there.
 *
 * Clamping is also NOT mapping. A clamped range is a range of the right shape
 * pointing at whatever text now occupies those numbers, which for a read
 * (textBetween, a decoration) is cosmetic but for a write (deleteSelection) is
 * data loss with no error attached. A range that survives a document change and
 * is then written through must be mapped through the intervening transactions
 * first — see the `transaction` subscription around `selectionRangeRef` in
 * AIEditorSidePanel — and clamped only as the last line of defence.
 */
export function clampRange(
  docSize: number,
  range: EditorRange | null | undefined
): EditorRange | null {
  if (!range) return null
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to)) return null
  if (!Number.isFinite(docSize) || docSize < 0) return null

  const from = Math.max(0, Math.min(range.from, docSize))
  const to = Math.max(0, Math.min(range.to, docSize))

  return from < to ? { from, to } : null
}

/** The subset of ProseMirror's Mapping this module needs. */
export type PositionMapping = { map(pos: number, assoc?: number): number }

/**
 * Carry a stored range forward across one transaction, or return null when the
 * text it covered is gone.
 *
 * This is the one to reach for when the range will be WRITTEN through —
 * `deleteSelection`, `insertContentAt`, `setNodeMarkup`. Clamping is not enough
 * there: setTextSelection clamps internally, so a range left stale by an edit
 * that landed while an AI request was in flight throws nothing at all. It just
 * selects and deletes whatever text has moved into those offsets, destroying
 * content with no error and nothing in Sentry. Mapping is what keeps the write
 * aimed at the text the user actually chose.
 *
 * `assoc` is 1 on `from` and -1 on `to` so an insertion at either boundary lands
 * outside the range rather than being swallowed into it — the range only ever
 * shrinks to the original text, never grows to eat a neighbour's edit. A range
 * whose content was itself deleted maps to an empty range and comes back null,
 * which callers must read as "there is nothing left to act on".
 */
export function mapRange(
  mapping: PositionMapping,
  docSize: number,
  range: EditorRange | null | undefined
): EditorRange | null {
  if (!range) return null
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to)) return null

  return clampRange(docSize, {
    from: mapping.map(range.from, 1),
    to: mapping.map(range.to, -1),
  })
}
