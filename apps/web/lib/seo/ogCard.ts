/** Pure helpers for the generated Open Graph cards (unit tested). */

export const OG_SIZE = { width: 1200, height: 630 }

/** `#rrggbb` brand color, or the default when unset/invalid. */
export function brandColor(value?: string | null, fallback = '#111827'): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

/** Black or white text, whichever reads better on `hex`. */
export function readableOn(hex: string): '#ffffff' | '#111827' {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.45 ? '#111827' : '#ffffff'
}

/** Clamp a string to `max` characters on a word boundary, with an ellipsis. */
export function clampText(text: string | null | undefined, max: number): string {
  const plain = String(text || '').replace(/\s+/g, ' ').trim()
  if (plain.length <= max) return plain
  const cut = plain.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`
}

/** Title font size that keeps long titles within three lines. */
export function titleFontSize(title: string): number {
  const n = title.length
  if (n <= 28) return 72
  if (n <= 48) return 60
  if (n <= 72) return 52
  return 44
}

/** Catalog pages that get a generated card (`/og/page/{key}`), with their title. */
export const PAGE_CARDS: Record<string, string> = {
  home: 'Home',
  courses: 'Courses',
  paths: 'Learning paths',
  podcasts: 'Podcasts',
  communities: 'Communities',
  library: 'Library',
  live: 'Live sessions',
  boards: 'Boards',
}
