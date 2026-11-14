/**
 * Ids for the headings of a lesson, shared by the heading renderer (which
 * writes them on the <h1>–<h6>) and the "On this page" outline (which links to
 * them), so both always agree.
 *
 * - Letters and digits of every script are kept ("Введение", "مقدمة"), so a
 *   non-Latin heading gets a readable id instead of a random one.
 * - Two headings with the same text get `-2`, `-3`… in document order.
 * - A heading with no usable text gets its position (`heading-3`): stable
 *   across renders, unlike the random ids it used to get.
 */

export interface HeadingEntry {
  /** Position of the heading node in the ProseMirror document. */
  pos: number
  level: number
  text: string
  id: string
}

export function slugifyHeading(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

interface DocLike {
  descendants: (_cb: (_node: any, _pos: number) => boolean | void) => void
}

export function computeHeadingIds(doc: DocLike): HeadingEntry[] {
  const out: HeadingEntry[] = []
  const used = new Map<string, number>()
  let index = 0
  doc.descendants((node, pos) => {
    if (node?.type?.name !== 'heading') return true
    index += 1
    const text = (node.textContent || '').trim()
    const slug = slugifyHeading(text)
    const base = slug ? `heading-${slug}` : `heading-${index}`
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    let id = seen === 0 ? base : `${base}-${seen + 1}`
    // "Intro", "Intro", "Intro 2" → heading-intro, heading-intro-2, and the
    // third must not reuse heading-intro-2.
    while (seen > 0 && used.has(id)) id = `${id}-x`
    if (id !== base) used.set(id, 1)
    out.push({ pos, level: Number(node.attrs?.level) || 1, text, id })
    // Headings hold text only: no need to walk inside.
    return false
  })
  return out
}
