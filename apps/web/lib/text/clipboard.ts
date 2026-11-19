// Copy to the clipboard, also when the text is still being fetched. Safari
// only lets a page write during the click itself, so a writeText after a
// network call fails there: the write starts right away with a promise of the
// text (ClipboardItem), and browsers without that wait for the text and use
// writeText. Resolves true only once the text is on the clipboard; never
// rejects. Unit-tested in tests/invite-join-flow.test.mjs.

type ClipboardLike = {
  write?: (_items: any[]) => Promise<void>
  writeText: (_text: string) => Promise<void>
}

export async function copyTextFrom(
  text: string | Promise<string>,
  clipboard: ClipboardLike | undefined = typeof navigator !== 'undefined' ? navigator.clipboard : undefined,
  ItemCtor: any = (globalThis as any).ClipboardItem,
): Promise<boolean> {
  if (!clipboard) return false
  if (typeof text !== 'string' && ItemCtor && typeof clipboard.write === 'function') {
    try {
      // Called before any await, so it still counts as part of the click.
      const blob = Promise.resolve(text).then((value) => new Blob([value], { type: 'text/plain' }))
      blob.catch(() => {}) // a failed fetch is reported by the caller
      await clipboard.write([new ItemCtor({ 'text/plain': blob })])
      return true
    } catch {
      // Older engines refuse a promised item: plain text below.
    }
  }
  try {
    await clipboard.writeText(await text)
    return true
  } catch {
    return false
  }
}
