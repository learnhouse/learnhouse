/**
 * The fonts a page can use (mirror of FONTS in apps/api/src/services/landing/schema.py).
 * Google Fonts are loaded only when a page uses them; the "System" faces are
 * the visitor's own fonts and download nothing.
 */
export type FontGroup = 'system' | 'sans' | 'serif' | 'mono'

export const SYSTEM_STACKS: Record<string, string> = {
  'System Sans': 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  'System Serif': 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  'System Mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
}

const SERIF = ['DM Serif Display', 'Playfair Display', 'Fraunces', 'Lora', 'Merriweather', 'Instrument Serif', 'Libre Baskerville', 'EB Garamond', 'Crimson Pro', 'Source Serif 4', 'IBM Plex Serif']
const MONO = ['Space Mono', 'JetBrains Mono', 'IBM Plex Mono']
const SANS = [
  'Inter', 'DM Sans', 'Plus Jakarta Sans', 'Manrope', 'Outfit', 'Sora', 'Space Grotesk', 'Poppins', 'Nunito', 'Quicksand', 'Lexend',
  'Work Sans', 'Rubik', 'Montserrat', 'Raleway', 'Lato', 'Open Sans', 'Roboto', 'Figtree', 'Onest', 'Urbanist', 'Albert Sans',
  'Instrument Sans', 'Bricolage Grotesque', 'Archivo', 'Syne', 'Barlow', 'Cabin', 'Exo 2', 'Fira Sans', 'IBM Plex Sans', 'Josefin Sans',
  'Karla', 'Libre Franklin', 'Mulish', 'Noto Sans', 'Overpass', 'PT Sans', 'Red Hat Display', 'Source Sans 3', 'Titillium Web',
  'Wix Madefor Text',
]

export const FONT_GROUPS: { group: FontGroup; fonts: string[] }[] = [
  { group: 'system', fonts: Object.keys(SYSTEM_STACKS) },
  { group: 'sans', fonts: SANS },
  { group: 'serif', fonts: SERIF },
  { group: 'mono', fonts: MONO },
]

export const ALL_FONTS: string[] = FONT_GROUPS.flatMap((g) => g.fonts)

/** Heading + body pairs that work well together (also used by the style presets). */
export const FONT_PAIRINGS: { heading: string; body: string }[] = [
  { heading: 'Fraunces', body: 'Nunito' },
  { heading: 'Playfair Display', body: 'Lora' },
  { heading: 'Space Grotesk', body: 'Inter' },
  { heading: 'Sora', body: 'Inter' },
  { heading: 'Instrument Serif', body: 'Instrument Sans' },
  { heading: 'Bricolage Grotesque', body: 'DM Sans' },
  { heading: 'DM Serif Display', body: 'DM Sans' },
  { heading: 'Syne', body: 'Manrope' },
  { heading: 'EB Garamond', body: 'Source Sans 3' },
  { heading: 'System Sans', body: 'System Sans' },
]

const FONT_RE = /^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/

export function isSystemFont(name: string): boolean {
  return name in SYSTEM_STACKS
}

export function fontGroup(name: string): FontGroup {
  if (isSystemFont(name)) return 'system'
  if (SERIF.includes(name) || /Serif/.test(name)) return 'serif'
  if (MONO.includes(name) || /Mono/.test(name)) return 'mono'
  return 'sans'
}

/** CSS font-family for a font name; "brand" (or empty) reads `fallbackVar`. */
export function fontStack(name: string, fallbackVar: string): string {
  if (name === 'brand' || !name) return `var(${fallbackVar}, inherit)`
  if (SYSTEM_STACKS[name]) return SYSTEM_STACKS[name]
  if (!FONT_RE.test(name)) return 'inherit'
  const group = fontGroup(name)
  const fallback = group === 'serif' ? 'Georgia, serif' : group === 'mono' ? 'ui-monospace, monospace' : 'system-ui, sans-serif'
  return `"${name}", ${fallback}`
}

/**
 * One Google Fonts stylesheet for these fonts (system faces and unknown names
 * skipped), or null when there is nothing to download. `text` limits the
 * download to those characters (font previews in the picker).
 */
export function googleFontsUrl(names: Iterable<string>, opts: { text?: string; weights?: string } = {}): string | null {
  const list = Array.from(new Set(Array.from(names).filter((n) => n && n !== 'brand' && !isSystemFont(n) && FONT_RE.test(n)))).sort()
  if (!list.length) return null
  const weights = opts.weights ?? '400;500;600;700;800'
  const fam = list.map((n) => `family=${encodeURIComponent(n).replace(/%20/g, '+')}${weights && !opts.text ? `:wght@${weights}` : ''}`).join('&')
  const text = opts.text ? `&text=${encodeURIComponent(opts.text)}` : ''
  return `https://fonts.googleapis.com/css2?${fam}${text}&display=swap`
}
