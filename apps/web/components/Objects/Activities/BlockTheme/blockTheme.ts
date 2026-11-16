/*
 Block themes: lesson blocks adapt to the background they are rendered on.

 Three modes, picked from the host's effective background colour:
   light   the original block look (no change at all)
   dark    a neutral dark host: soft charcoal surfaces lifted off the host
   tinted  a coloured host: translucent-white surfaces mixed toward its hue,
           light or dark ink depending on the host (the "tone")

 Dark and tinted share one recipe: every surface, hairline and ink step is the
 host colour mixed with white (dark tone) or a deep ink of the host's hue
 (light tone), then checked against WCAG AA and pushed until it passes. The
 result is a set of CSS custom properties (--lhb-*) that BlockThemeScope puts
 on the scope element; styles/block-theme.css maps Tailwind's neutral palette
 and the block tokens onto them, so every block's existing classes follow.

 Pure functions, no DOM except the two helpers at the bottom; unit tested in
 tests/block-theme.test.mjs.
*/

export type BlockThemeRequest = 'auto' | 'light' | 'dark'
export type BlockThemeMode = 'light' | 'dark' | 'tinted'
export type BlockThemeTone = 'light' | 'dark'

export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

export interface ResolvedBlockTheme {
  mode: BlockThemeMode
  /** Ink direction for dark and tinted modes; null in light mode. */
  tone: BlockThemeTone | null
  /** Opaque host colour the theme was derived from (hex). */
  host: string
  /** --lhb-* custom properties for the scope element (empty in light mode). */
  vars: Record<string, string>
  /** 'low' when white ink reaches less than 7.5:1 on the host (mid-tone colours). */
  headroom: 'low' | null
  /**
   True when an explicit request doesn't match the host (dark asked on a light
   page, light asked on a dark one): the scope then paints its own background
   so prose and blocks stay readable.
  */
  painted: boolean
}

export const BLOCK_THEME_REQUESTS: readonly BlockThemeRequest[] = ['auto', 'light', 'dark']

export function normalizeRequest(value: unknown): BlockThemeRequest {
  return typeof value === 'string' && (BLOCK_THEME_REQUESTS as readonly string[]).includes(value.trim().toLowerCase())
    ? (value.trim().toLowerCase() as BlockThemeRequest)
    : 'auto'
}

// ─── Parsing ────────────────────────────────────────────────────────────────

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))

/** Parses the colour syntaxes getComputedStyle returns (hex, rgb/rgba, oklch, color(srgb …)). */
export function parseColor(input: string | null | undefined): RGBA | null {
  if (!input) return null
  const s = input.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (s.startsWith('#')) {
    let h = s.slice(1)
    if (![3, 4, 6, 8].includes(h.length) || /[^0-9a-f]/.test(h)) return null
    if (h.length <= 4) h = h.split('').map((c) => c + c).join('')
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
  }
  const fn = s.match(/^([a-z]+)\((.*)\)$/)
  if (!fn) return null
  const [, name, body] = fn
  const parts = body.replace(/,/g, ' ').replace(/\//g, ' / ').split(/\s+/).filter(Boolean)
  const slash = parts.indexOf('/')
  const main = slash === -1 ? parts : parts.slice(0, slash)
  const alphaRaw = slash === -1 ? (name === 'rgba' || name === 'hsla' ? parts[3] : undefined) : parts[slash + 1]
  const num = (v: string | undefined, scale = 1) => {
    if (v === undefined || v === 'none') return 0
    return v.endsWith('%') ? (parseFloat(v) / 100) * scale : parseFloat(v)
  }
  const alpha = alphaRaw === undefined ? 1 : clamp(num(alphaRaw, 1))
  if (name === 'rgb' || name === 'rgba') {
    const [r, g, b] = main.slice(0, 3).map((v) => clamp(num(v, 255), 0, 255))
    if ([r, g, b].some((v) => Number.isNaN(v))) return null
    return { r, g, b, a: alpha }
  }
  if (name === 'color' && main[0] === 'srgb') {
    const [r, g, b] = main.slice(1, 4).map((v) => clamp(num(v, 1)) * 255)
    return { r, g, b, a: alpha }
  }
  if (name === 'oklch') {
    const L = main[0]?.endsWith('%') ? parseFloat(main[0]) / 100 : num(main[0])
    const C = main[1]?.endsWith('%') ? (parseFloat(main[1]) / 100) * 0.4 : num(main[1])
    const H = num(main[2])
    return { ...oklchToRgb(L, C, H), a: alpha }
  }
  if (name === 'oklab') {
    const L = main[0]?.endsWith('%') ? parseFloat(main[0]) / 100 : num(main[0])
    return { ...oklabToRgb(L, num(main[1]), num(main[2])), a: alpha }
  }
  if (name === 'hsl' || name === 'hsla') {
    const h = num(main[0]), sat = clamp(num(main[1], 1)), l = clamp(num(main[2], 1))
    const k = (n: number) => (n + h / 30) % 12
    const f = (n: number) => l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
    return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a: alpha }
  }
  return null
}

// ─── Colour maths ───────────────────────────────────────────────────────────

const toLinear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
const fromLinear = (v: number) => 255 * clamp(v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

export function relativeLuminance(c: RGBA): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b)
}

export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function oklabToRgb(L: number, a: number, b: number) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3)
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  }
}

function oklchToRgb(L: number, C: number, H: number) {
  const h = (H * Math.PI) / 180
  return oklabToRgb(L, C * Math.cos(h), C * Math.sin(h))
}

/** OKLCH of an sRGB colour: L 0–1, C ~0–0.4, H degrees. */
export function toOklch(c: RGBA): { l: number; c: number; h: number } {
  const r = toLinear(c.r), g = toLinear(c.g), b = toLinear(c.b)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.sqrt(A * A + B * B)
  let H = (Math.atan2(B, A) * 180) / Math.PI
  if (H < 0) H += 360
  return { l: L, c: C, h: H }
}

/** `top` painted over `bottom` (alpha compositing in sRGB, like the browser). */
export function composite(top: RGBA, bottom: RGBA): RGBA {
  const a = top.a + bottom.a * (1 - top.a)
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const ch = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a
  return { r: ch(top.r, bottom.r), g: ch(top.g, bottom.g), b: ch(top.b, bottom.b), a }
}

/** `a` mixed toward `b` by t (0 = a, 1 = b). */
export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  const k = clamp(t)
  return { r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k, a: 1 }
}

export function toHex(c: RGBA): string {
  const h = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

const rgba = (c: RGBA, a: number) => `rgb(${Math.round(c.r)} ${Math.round(c.g)} ${Math.round(c.b)} / ${a})`

const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 }
const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 }
/** Base for an explicit dark request on a host that isn't dark (zinc-900-ish, like the app). */
const DEFAULT_DARK_BASE: RGBA = { r: 24, g: 24, b: 27, a: 1 }

// ─── Mode selection ─────────────────────────────────────────────────────────

/** Below this OKLCH chroma a host counts as neutral (white, greys, charcoal). */
export const TINT_MIN_CHROMA = 0.045

/** Picks light / dark / tinted for an opaque host colour. */
export function classifyHost(host: RGBA): { mode: BlockThemeMode; tone: BlockThemeTone | null } {
  const { l, c } = toOklch(host)
  // Which ink reads better on the host decides the tone.
  const darkInk = contrastRatio(host, BLACK) >= contrastRatio(host, WHITE)
  if (c < TINT_MIN_CHROMA || (l > 0.97 && c < 0.06)) {
    return darkInk ? { mode: 'light', tone: null } : { mode: 'dark', tone: 'dark' }
  }
  return { mode: 'tinted', tone: darkInk ? 'light' : 'dark' }
}

// ─── Ramp ───────────────────────────────────────────────────────────────────

/*
 Neutral steps, as how far each one sits from the card surface toward the ink.
 Dark-tone values follow the admin soft-dark remap (components/Admin/Shell/
 adminDark.css): 50–200 faint fills and hairlines, 400 meta, 500–700 body,
 900 titles.
*/
const STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const
const DARK_STEPS = [0.03, 0.055, 0.1, 0.24, 0.46, 0.62, 0.67, 0.77, 0.86, 0.92, 0.965]
const LIGHT_STEPS = [0.035, 0.06, 0.115, 0.2, 0.4, 0.55, 0.64, 0.74, 0.84, 0.91, 0.95]

/** Raises `t` until `mix(base, ink, t)` reaches `min` contrast against `against`. */
function ensureContrast(base: RGBA, ink: RGBA, t: number, against: RGBA, min: number): number {
  let k = t
  for (let i = 0; i < 40 && k < 1 && contrastRatio(mix(base, ink, k), against) < min; i++) k = Math.min(1, k + 0.025)
  return k
}

/**
 Every --lhb-* value for a dark or tinted scope. `host` must be opaque.
 Exported for the tests and for hosts that want the numbers (e.g. the mobile
 WebView picking a status bar colour).
*/
export function buildThemeVars(host: RGBA, tone: BlockThemeTone): Record<string, string> {
  const hostLch = toOklch(host)
  let surface: RGBA
  let ink: RGBA
  let steps: number[]
  if (tone === 'dark') {
    // Cards lift off the host by a few percent of white: enough to separate on
    // near-black, never a grey slab on charcoal.
    let lift = hostLch.l < 0.2 ? 0.06 : 0.045
    surface = mix(host, WHITE, lift)
    while (contrastRatio(surface, host) < 1.12 && lift < 0.2) surface = mix(host, WHITE, (lift += 0.01))
    // A whisper of the host hue in the ink keeps tinted hosts cohesive.
    // (pure white when the host is mid-tone and every bit of contrast counts).
    ink = contrastRatio(host, WHITE) < 7.5 ? WHITE : mix(WHITE, host, hostLch.c > TINT_MIN_CHROMA ? 0.06 : 0.02)
    // Mid-tone hosts (violet, teal…) can't carry AA text on a lighter card:
    // sink the card into a darker wash of the host instead.
    if (contrastRatio(ink, surface) < 8) {
      let sink = 0.15
      surface = mix(host, BLACK, sink)
      while (contrastRatio(ink, surface) < 8 && sink < 0.7) surface = mix(host, BLACK, (sink += 0.05))
    }
    steps = DARK_STEPS
  } else {
    // A lighter white adapted to the host: 72% white over the host colour.
    surface = mix(host, WHITE, 0.72)
    // Deep ink of the host's own hue (L 0.24), chroma capped so text stays calm.
    const deep = oklchToRgb(0.24, Math.min(hostLch.c, 0.06), hostLch.h)
    ink = { ...deep, a: 1 }
    steps = LIGHT_STEPS
  }

  const ramp: Record<string, RGBA> = {}
  let raised: RGBA = surface
  let raised2: RGBA = surface
  let worst: RGBA = surface
  const layout = () => {
    STEPS.forEach((s, i) => (ramp[s] = mix(surface, ink, steps[i])))
    // Cards inside grey panels sit one step up from the surface.
    raised = tone === 'dark' ? mix(surface, ink, 0.05) : mix(surface, WHITE, 0.55)
    raised2 = tone === 'dark' ? mix(surface, ink, 0.085) : mix(raised, ink, 0.035)
    // Text must read on every fill it is drawn over (surface, raised cards,
    // the -50/-100 chips): check against whichever is closest to the ink.
    // Prose sits straight on the host, so the host counts as a fill too.
    const fills = [host, surface, raised, raised2, ramp['50'], ramp['100']]
    worst = fills.reduce((a, b) => (contrastRatio(b, ink) < contrastRatio(a, ink) ? b : a))
  }
  layout()
  // A hue-tinted ink that can't reach 7:1 on the lightest fill gives way to white.
  if (tone === 'dark' && ink !== WHITE && contrastRatio(ink, worst) < 7.2) {
    ink = WHITE
    layout()
  }
  // AA: 900 (titles, body) ≥ 7, 400–700 (secondary, meta) ≥ 4.5 on the worst fill.
  const fix = (s: string, min: number) => {
    const t = ensureContrast(surface, ink, steps[STEPS.indexOf(s as (typeof STEPS)[number])], worst, min)
    ramp[s] = mix(surface, ink, t)
  }
  ;['400', '500', '600', '700'].forEach((s) => fix(s, 4.5))
  ;['800', '900', '950'].forEach((s) => fix(s, 7))

  const v: Record<string, string> = {}
  v['--lhb-host'] = toHex(host)
  v['--lhb-n0'] = toHex(surface)
  STEPS.forEach((s) => (v[`--lhb-n${s}`] = toHex(ramp[s])))

  v['--lhb-surface'] = toHex(surface)
  v['--lhb-surface-2'] = toHex(ramp['50'])
  v['--lhb-surface-3'] = toHex(ramp['100'])
  v['--lhb-raised'] = toHex(raised)
  v['--lhb-raised-2'] = toHex(raised2)
  v['--lhb-border'] = tone === 'dark' ? rgba(ink, 0.09) : rgba(ink, 0.1)
  v['--lhb-border-strong'] = tone === 'dark' ? rgba(ink, 0.16) : rgba(ink, 0.18)
  v['--lhb-text'] = toHex(ramp['900'])
  v['--lhb-text-2'] = toHex(ramp['700'])
  v['--lhb-muted'] = toHex(ramp['500'])
  v['--lhb-faint'] = toHex(ramp['400'])
  v['--lhb-hover'] = rgba(ink, tone === 'dark' ? 0.06 : 0.05)
  v['--lhb-active'] = rgba(ink, tone === 'dark' ? 0.1 : 0.08)
  v['--lhb-ring'] = rgba(ink, tone === 'dark' ? 0.28 : 0.3)
  v['--lhb-code-bg'] = toHex(tone === 'dark' ? mix(host, BLACK, 0.35) : mix(ink, host, 0.08))
  v['--lhb-shadow'] =
    tone === 'dark'
      ? `0 0 0 1px ${rgba(ink, 0.08)}, 0 1px 0 0 ${rgba(ink, 0.05)} inset, 0 8px 24px -12px rgb(0 0 0 / 0.6)`
      : `0 0 0 1px ${rgba(ink, 0.08)}, 0 6px 18px -10px ${rgba(ink, 0.3)}`
  return v
}

/** Mode, tone and variables for a host colour and an explicit request. */
export function resolveBlockTheme(host: RGBA | null, request: BlockThemeRequest = 'auto'): ResolvedBlockTheme {
  const opaque = host && host.a > 0 ? composite(host, WHITE) : WHITE
  const headroom = (base: RGBA, tone: BlockThemeTone): 'low' | null =>
    tone === 'dark' && contrastRatio(base, WHITE) < 7.5 ? 'low' : null
  const hostTone = classifyHost(opaque).tone
  if (request === 'light') {
    const painted = hostTone === 'dark'
    return { mode: 'light', tone: null, host: painted ? '#ffffff' : toHex(opaque), vars: {}, headroom: null, painted }
  }
  if (request === 'dark') {
    const painted = hostTone !== 'dark'
    const base = painted ? DEFAULT_DARK_BASE : opaque
    const isTinted = toOklch(base).c >= TINT_MIN_CHROMA
    return { mode: isTinted ? 'tinted' : 'dark', tone: 'dark', host: toHex(base), vars: buildThemeVars(base, 'dark'), headroom: headroom(base, 'dark'), painted }
  }
  const { mode, tone } = classifyHost(opaque)
  if (mode === 'light' || !tone) return { mode: 'light', tone: null, host: toHex(opaque), vars: {}, headroom: null, painted: false }
  return { mode, tone, host: toHex(opaque), vars: buildThemeVars(opaque, tone), headroom: headroom(opaque, tone), painted: false }
}

// ─── DOM helpers ────────────────────────────────────────────────────────────

/** A colour string → RGBA, using a canvas for syntaxes parseColor doesn't know (lab(), color-mix results…). */
function parseCssColor(value: string): RGBA | null {
  const parsed = parseColor(value)
  if (parsed) return parsed
  if (typeof document === 'undefined') return null
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#000'
    ctx.fillStyle = value
    return parseColor(String(ctx.fillStyle))
  } catch {
    return null
  }
}

/**
 The colour actually behind `el`: walks up the ancestors compositing every
 translucent background until an opaque one is found. Falls back to the
 page canvas (dark when the root asks for a dark colour scheme).
 Returns the element whose background ended the walk too, so callers can
 observe it.
*/
export function effectiveBackground(el: Element | null): { color: RGBA; source: Element | null } {
  let acc: RGBA = { r: 0, g: 0, b: 0, a: 0 }
  let node: Element | null = el
  while (node) {
    const cs = getComputedStyle(node)
    const bg = parseCssColor(cs.backgroundColor)
    if (bg && bg.a > 0) {
      acc = acc.a === 0 ? bg : composite(acc, bg)
      if (acc.a >= 0.98) return { color: { ...acc, a: 1 }, source: node }
    }
    node = node.parentElement
  }
  const root = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).colorScheme : ''
  const canvas = /\bdark\b/.test(root || '') && !/\blight\b/.test(root || '') ? { r: 18, g: 18, b: 18, a: 1 } : WHITE
  return { color: acc.a === 0 ? canvas : composite(acc, canvas), source: null }
}

/** Text colour the host gives `el`, if it reads well (AA) on `bg`; else null. */
export function readableHostInk(el: Element | null, bg: RGBA): RGBA | null {
  if (!el) return null
  const ink = parseCssColor(getComputedStyle(el).color)
  if (!ink) return null
  return contrastRatio(composite(ink, bg), bg) >= 4.5 ? ink : null
}

// ─── Embedded documents (magic blocks) ─────────────────────────────────────

export interface DocumentTheme {
  /** 'light' | 'dark' as far as a document cares (tinted dark → dark). */
  scheme: 'light' | 'dark'
  mode: BlockThemeMode
  vars: Record<string, string>
}

const LIGHT_DOCUMENT_VARS: Record<string, string> = {
  '--lh-surface': '#ffffff',
  '--lh-surface-2': '#fafafa',
  '--lh-text': '#171717',
  '--lh-muted': '#737373',
  '--lh-border': 'rgba(0, 0, 0, 0.08)',
  '--lh-accent': '#2563eb',
}

/** The theme a scope element carries, in the --lh-* names documents read. */
export function documentThemeFrom(scope: Element | null): DocumentTheme {
  const mode = (scope?.getAttribute('data-lh-bt') as BlockThemeMode | null) ?? 'light'
  const tone = scope?.getAttribute('data-lh-bt-tone')
  if (!scope || !tone) return { scheme: 'light', mode: 'light', vars: { ...LIGHT_DOCUMENT_VARS } }
  const cs = getComputedStyle(scope)
  const read = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return {
    scheme: tone === 'dark' ? 'dark' : 'light',
    mode,
    vars: {
      '--lh-surface': read('--lhb-surface', '#ffffff'),
      '--lh-surface-2': read('--lhb-surface-2', '#fafafa'),
      '--lh-text': read('--lhb-text', '#171717'),
      '--lh-muted': read('--lhb-muted', '#737373'),
      '--lh-border': read('--lhb-border-strong', 'rgba(0, 0, 0, 0.08)'),
      '--lh-accent': read('--lhb-accent', '#2563eb'),
    },
  }
}

/**
 Hands the block theme to an HTML document rendered in a sandboxed frame
 (magic blocks). Adds `data-lh-theme="light|dark"` (and data-lh-mode) on
 <html> and --lh-* custom properties on :root. Nothing else changes, so a
 document that ignores them renders exactly as before, on its white frame.

 A generated document opts in like this:
   body { background: var(--lh-surface, #fff); color: var(--lh-text, #111); }
   html[data-lh-theme="dark"] .card { … }
*/
export function injectDocumentTheme(html: string, theme: DocumentTheme): string {
  const decls = Object.entries(theme.vars).map(([k, v]) => `${k}:${v.replace(/[<>;{}]/g, '')}`).join(';')
  const style = `<style data-lh-theme>:root{${decls};color-scheme:${theme.scheme}}</style>`
  const attrs = ` data-lh-theme="${theme.scheme}" data-lh-mode="${theme.mode}"`
  let out: string
  if (/<html[\s>]/i.test(html)) out = html.replace(/<html(?=[\s>])/i, `<html${attrs}`)
  else {
    const doctype = html.match(/^\s*<!doctype[^>]*>/i)?.[0] ?? ''
    out = `${doctype}<html${attrs}>${html.slice(doctype.length)}</html>`
  }
  out = /<head[\s>]/i.test(out) ? out.replace(/<head(\s[^>]*)?>/i, (m) => `${m}${style}`) : out.replace(/<html[^>]*>/i, (m) => `${m}<head>${style}</head>`)
  return out
}
