/**
 * The organization theme: the learner-facing look, read from the org config
 * and turned into CSS custom properties + data attributes on one root element
 * (`.lh-theme`, the org layout). `styles/theme.css` consumes them through
 * opt-in marker classes (`lh-t-btn`, `lh-t-card`, `lh-t-progress`…), so a
 * default theme leaves every page exactly as it looked before themes existed,
 * and the dashboard (which has no theme root) stays neutral.
 *
 * Pure module: no React, no path aliases, so server code (OG images, emails
 * previews) and the unit tests can import it as is.
 *
 * Storage: brand color and body font stay at `customization.general.color` /
 * `.font` (older readers use them); the rest is `customization.theme`
 * (v1: `general.*`, `general.theme`). The API validates the same rules as
 * `sanitize*` below, these re-check on read so a hand-edited blob can never
 * reach a style attribute.
 */
import { DEFAULT_FONT } from '../fonts'

export type AccentMode = 'neutral' | 'brand' | 'custom'
export type HeaderStyle = 'brand' | 'white' | 'dark' | 'glass'
export type RadiusStyle = 'none' | 'sharp' | 'soft' | 'round'
export type ButtonStyle = 'solid' | 'soft' | 'outline'
export type CardStyle = 'shadow' | 'border' | 'flat'
export type Density = 'comfortable' | 'compact'
export type BackgroundStyle = 'tint' | 'plain' | 'pattern' | 'grid' | 'gradient'
export type ThemePresetKey =
  | 'classic' | 'ocean' | 'forest' | 'midnight' | 'sunset' | 'orchid' | 'slate' | 'sand'
  | 'atelier' | 'harbor' | 'grove' | 'noir' | 'ember' | 'linen' | 'citrus' | 'glacier'
export type NeutralTone = 'neutral' | 'warm' | 'cool'
export type TypeScale = 'compact' | 'default' | 'large'
export type HeadingWeight = '' | '500' | '600' | '700' | '800'
export type ButtonShape = 'auto' | 'square' | 'rounded' | 'pill'
export type Elevation = 'flat' | 'default' | 'lifted'
export type LinkStyle = 'accent' | 'underline' | 'subtle'
export type HeaderLayout = 'standard' | 'centered' | 'minimal'
export type FooterStyle = 'simple' | 'centered' | 'bar'
export type ImageStyle = 'default' | 'rounded' | 'framed' | 'muted'
export type PublicScheme = 'visitor' | 'light'

export interface ThemeOptions {
  preset: '' | 'custom' | ThemePresetKey
  accent_mode: AccentMode
  accent_color: string
  header_style: HeaderStyle
  radius: RadiusStyle
  heading_font: string
  button_style: ButtonStyle
  card_style: CardStyle
  density: Density
  background: BackgroundStyle
  // Theme studio options (each default is the look above).
  secondary_color: string
  neutral: NeutralTone
  type_scale: TypeScale
  heading_weight: HeadingWeight
  button_shape: ButtonShape
  elevation: Elevation
  link_style: LinkStyle
  header_layout: HeaderLayout
  footer_style: FooterStyle
  image_style: ImageStyle
  /** 'visitor' follows the visitor's dark mode; 'light' always shows the light look. */
  public_scheme: PublicScheme
  /** Accent in dark mode ('' lifts the light accent automatically). */
  dark_accent: string
}

/** Everything the Branding page saves in one request. */
export interface OrgThemeState {
  color: string
  font: string
  theme: ThemeOptions
}

export const DEFAULT_THEME_OPTIONS: ThemeOptions = {
  preset: '',
  accent_mode: 'neutral',
  accent_color: '',
  header_style: 'brand',
  radius: 'soft',
  heading_font: '',
  button_style: 'solid',
  card_style: 'shadow',
  density: 'comfortable',
  background: 'tint',
  secondary_color: '',
  neutral: 'neutral',
  type_scale: 'default',
  heading_weight: '',
  button_shape: 'auto',
  elevation: 'default',
  link_style: 'accent',
  header_layout: 'standard',
  footer_style: 'simple',
  image_style: 'default',
  public_scheme: 'visitor',
  dark_accent: '',
}

export const DEFAULT_THEME_STATE: OrgThemeState = { color: '', font: '', theme: DEFAULT_THEME_OPTIONS }

/** The platform's neutral accent (DashKit primary button, neutral-900). */
export const NEUTRAL_ACCENT = '#171717'
const DARK_HEADER = '#111111'

const ENUMS = {
  accent_mode: ['neutral', 'brand', 'custom'],
  header_style: ['brand', 'white', 'dark', 'glass'],
  radius: ['soft', 'none', 'sharp', 'round'],
  button_style: ['solid', 'soft', 'outline'],
  card_style: ['shadow', 'border', 'flat'],
  density: ['comfortable', 'compact'],
  background: ['tint', 'plain', 'pattern', 'grid', 'gradient'],
  preset: ['', 'custom', 'classic', 'ocean', 'forest', 'midnight', 'sunset', 'orchid', 'slate', 'sand', 'atelier', 'harbor', 'grove', 'noir', 'ember', 'linen', 'citrus', 'glacier'],
  neutral: ['neutral', 'warm', 'cool'],
  type_scale: ['default', 'compact', 'large'],
  heading_weight: ['', '500', '600', '700', '800'],
  button_shape: ['auto', 'square', 'rounded', 'pill'],
  elevation: ['default', 'flat', 'lifted'],
  link_style: ['accent', 'underline', 'subtle'],
  header_layout: ['standard', 'centered', 'minimal'],
  footer_style: ['simple', 'centered', 'bar'],
  image_style: ['default', 'rounded', 'framed', 'muted'],
  public_scheme: ['visitor', 'light'],
} as const

/* ------------------------------------------------------------------------ */
/* Sanitizers                                                                */
/* ------------------------------------------------------------------------ */

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i
const FONT_RE = /^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/

/** `#rrggbb` lowercase, or '' for anything that is not a hex color. */
export function sanitizeHex(value: unknown): string {
  if (typeof value !== 'string') return ''
  const match = HEX_RE.exec(value.trim())
  if (!match) return ''
  let digits = match[1].toLowerCase()
  if (digits.length === 3) digits = digits.split('').map((c) => c + c).join('')
  return `#${digits}`
}

/** A Google Fonts family name (letters, digits, single spaces), or ''. */
export function sanitizeFont(value: unknown): string {
  if (typeof value !== 'string') return ''
  const name = value.trim().split(/\s+/).join(' ')
  return name.length <= 64 && FONT_RE.test(name) ? name : ''
}

function pick<K extends keyof typeof ENUMS>(key: K, value: unknown): (typeof ENUMS)[K][number] {
  const allowed = ENUMS[key] as readonly string[]
  return (typeof value === 'string' && allowed.includes(value) ? value : DEFAULT_THEME_OPTIONS[key as keyof ThemeOptions]) as (typeof ENUMS)[K][number]
}

/** Coerce any blob into valid theme options (unknown keys dropped). */
export function normalizeThemeOptions(raw: unknown): ThemeOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    preset: pick('preset', r.preset),
    accent_mode: pick('accent_mode', r.accent_mode),
    accent_color: sanitizeHex(r.accent_color),
    header_style: pick('header_style', r.header_style),
    radius: pick('radius', r.radius),
    heading_font: sanitizeFont(r.heading_font),
    button_style: pick('button_style', r.button_style),
    card_style: pick('card_style', r.card_style),
    density: pick('density', r.density),
    background: pick('background', r.background),
    secondary_color: sanitizeHex(r.secondary_color),
    neutral: pick('neutral', r.neutral),
    type_scale: pick('type_scale', r.type_scale),
    heading_weight: pick('heading_weight', r.heading_weight),
    button_shape: pick('button_shape', r.button_shape),
    elevation: pick('elevation', r.elevation),
    link_style: pick('link_style', r.link_style),
    header_layout: pick('header_layout', r.header_layout),
    footer_style: pick('footer_style', r.footer_style),
    image_style: pick('image_style', r.image_style),
    public_scheme: pick('public_scheme', r.public_scheme),
    dark_accent: sanitizeHex(r.dark_accent),
  }
}

/** The theme of an org as returned by the API (`useOrg()`), v2 then v1. */
export function readOrgTheme(org: any): OrgThemeState {
  const config = org?.config?.config || {}
  const general = config?.customization?.general || config?.general || {}
  const theme = config?.customization?.theme || config?.general?.theme
  return {
    color: sanitizeHex(general.color),
    font: sanitizeFont(general.font),
    theme: normalizeThemeOptions(theme),
  }
}

/** The request body for `PUT /orgs/{id}/config/theme`. */
export function serializeThemeState(state: OrgThemeState): OrgThemeState {
  return { color: sanitizeHex(state.color), font: sanitizeFont(state.font), theme: normalizeThemeOptions(state.theme) }
}

export function themeStatesEqual(a: OrgThemeState, b: OrgThemeState): boolean {
  return JSON.stringify(serializeThemeState(a)) === JSON.stringify(serializeThemeState(b))
}

/* ------------------------------------------------------------------------ */
/* Color math (sRGB, WCAG 2.1)                                               */
/* ------------------------------------------------------------------------ */

type RGB = [number, number, number]

function toRgb(hex: string): RGB | null {
  const clean = sanitizeHex(hex)
  if (!clean) return null
  return [1, 3, 5].map((i) => parseInt(clean.slice(i, i + 2), 16)) as RGB
}

function toHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`
}

export function relativeLuminance(hex: string): number {
  const rgb = toRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** `a` mixed toward `b` by `amount` (0 = a, 1 = b). */
export function mixHex(a: string, b: string, amount: number): string {
  const ra = toRgb(a)
  const rb = toRgb(b)
  if (!ra || !rb) return sanitizeHex(a)
  return toHex(ra.map((c, i) => c + (rb[i] - c) * amount) as RGB)
}

export function hexToRgba(hex: string, alpha: number): string {
  const rgb = toRgb(hex)
  if (!rgb) return 'transparent'
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

/** White or near-black, whichever reads better on `bg`. */
export function readableTextOn(bg: string): '#ffffff' | '#111111' {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111111') ? '#ffffff' : '#111111'
}

/** `color` darkened (or lightened on a dark bg) until it reaches `min` contrast on `bg`. */
export function ensureContrast(color: string, bg = '#ffffff', min = 4.5): string {
  let out = sanitizeHex(color) || NEUTRAL_ACCENT
  const toward = relativeLuminance(bg) > 0.5 ? '#000000' : '#ffffff'
  for (let i = 0; i < 20 && contrastRatio(out, bg) < min; i++) out = mixHex(out, toward, 0.1)
  return out
}

export type ContrastLevel = 'AAA' | 'AA' | 'AA-large' | 'fail'

/** WCAG grade of `fg` text on `bg`, for the settings page warning. */
export function contrastLevel(fg: string, bg: string): { ratio: number; level: ContrastLevel } {
  const ratio = contrastRatio(fg, bg)
  const level: ContrastLevel = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA-large' : 'fail'
  return { ratio: Math.round(ratio * 100) / 100, level }
}

export interface AccentTokens {
  accent: string
  hover: string
  active: string
  contrast: string
  soft: string
  softHover: string
  ink: string
  ring: string
  /** True when the accent is light enough that text on it turns dark. */
  light: boolean
}

/** Hover/active shades, contrast-checked text, soft tint, readable ink, ring. */
export function deriveAccentTokens(hex: string): AccentTokens {
  const accent = sanitizeHex(hex) || NEUTRAL_ACCENT
  const contrast = readableTextOn(accent)
  // Very dark accents get lighter on hover (darker would be invisible).
  const veryDark = relativeLuminance(accent) < 0.03
  return {
    accent,
    hover: veryDark ? mixHex(accent, '#ffffff', 0.12) : mixHex(accent, '#000000', 0.12),
    active: veryDark ? mixHex(accent, '#ffffff', 0.2) : mixHex(accent, '#000000', 0.22),
    contrast,
    soft: mixHex(accent, '#ffffff', 0.88),
    softHover: mixHex(accent, '#ffffff', 0.8),
    ink: ensureContrast(accent, '#ffffff', 4.5),
    ring: hexToRgba(accent, 0.35),
    light: contrast !== '#ffffff',
  }
}

/* ------------------------------------------------------------------------ */
/* Resolution                                                                */
/* ------------------------------------------------------------------------ */

/** The accent buttons and progress use, or null for the neutral default. */
export function resolveAccent(state: OrgThemeState): string | null {
  const { accent_mode, accent_color } = state.theme
  if (accent_mode === 'custom') return sanitizeHex(accent_color) || null
  if (accent_mode === 'brand') return sanitizeHex(state.color) || null
  return null
}

/**
 * The header background: a hex color, or '' for the default white bar.
 * `brand` without a brand color is the default white bar (the pre-theme look).
 */
export function resolveHeader(state: OrgThemeState): { color: string; glass: boolean } {
  switch (state.theme.header_style) {
    case 'white':
      return { color: '', glass: false }
    case 'dark':
      return { color: DARK_HEADER, glass: false }
    case 'glass':
      return { color: '', glass: true }
    default:
      return { color: sanitizeHex(state.color), glass: false }
  }
}

/** A font-family stack for a family name ('' or the platform default → next/font face). */
export function fontStack(name: string): string {
  const font = sanitizeFont(name)
  if (!font || font === DEFAULT_FONT) return "var(--font-default), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  return `'${font}', var(--font-default), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
}

/** The heading font when it differs from the body font, else ''. */
export function effectiveHeadingFont(state: OrgThemeState): string {
  const heading = sanitizeFont(state.theme.heading_font)
  return heading && heading !== sanitizeFont(state.font) ? heading : ''
}

/**
 * One Google Fonts stylesheet for the org's body + heading families, or null
 * when neither needs loading (the default face ships with the app via
 * next/font). One request for the pair keeps first load to a single CSS file.
 */
export function themeFontsHref(state: OrgThemeState): string | null {
  const families: string[] = []
  const body = sanitizeFont(state.font)
  if (body && body !== DEFAULT_FONT) families.push(`family=${body.replace(/ /g, '+')}:wght@400;500;600;700`)
  const heading = effectiveHeadingFont(state)
  if (heading && heading !== DEFAULT_FONT) families.push(`family=${heading.replace(/ /g, '+')}:wght@500;600;700`)
  if (!families.length) return null
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`
}

const RADIUS: Record<Exclude<RadiusStyle, 'soft'>, { card: string; btn: string }> = {
  none: { card: '0px', btn: '0px' },
  sharp: { card: '6px', btn: '6px' },
  round: { card: '24px', btn: '9999px' },
}
const BUTTON_SHAPE: Record<Exclude<ButtonShape, 'auto'>, string> = { square: '4px', rounded: '12px', pill: '9999px' }
/** Page tone behind content for the warm / cool neutrals. */
export const NEUTRAL_PAGE: Record<Exclude<NeutralTone, 'neutral'>, { page: string; hairline: string; muted: string }> = {
  warm: { page: '#faf7f2', hairline: 'rgb(68 44 20 / 0.10)', muted: '#6f655a' },
  cool: { page: '#f5f8fb', hairline: 'rgb(20 44 72 / 0.10)', muted: '#5d6b7a' },
}

export interface ThemeRootProps {
  style: Record<string, string>
  attrs: Record<string, string>
}

/**
 * CSS variables and data attributes for the theme root. Only non-default
 * choices emit an attribute, and the marker classes in theme.css only react
 * to attributes, so the default theme changes nothing on the page.
 */
export function themeRootProps(state: OrgThemeState): ThemeRootProps {
  const s = serializeThemeState(state)
  const t = s.theme
  const style: Record<string, string> = {}
  const attrs: Record<string, string> = {}

  const accent = resolveAccent(s)
  const tokens = deriveAccentTokens(accent || NEUTRAL_ACCENT)
  style['--lh-accent'] = tokens.accent
  style['--lh-accent-hover'] = tokens.hover
  style['--lh-accent-active'] = tokens.active
  style['--lh-accent-contrast'] = tokens.contrast
  style['--lh-accent-soft'] = tokens.soft
  style['--lh-accent-soft-hover'] = tokens.softHover
  style['--lh-accent-ink'] = tokens.ink
  style['--lh-ring'] = tokens.ring
  if (accent) attrs['data-lh-accent'] = tokens.light ? 'light' : 'dark'

  if (s.color) {
    style['--lh-brand'] = s.color
    style['--lh-brand-contrast'] = readableTextOn(s.color)
  }

  if (s.theme.secondary_color) {
    style['--lh-secondary'] = s.theme.secondary_color
    style['--lh-secondary-contrast'] = readableTextOn(s.theme.secondary_color)
  }
  if (t.dark_accent) {
    attrs['data-lh-dark-accent'] = ''
    style['--lh-dark-accent'] = t.dark_accent
    style['--lh-dark-accent-contrast'] = readableTextOn(t.dark_accent)
  }
  if (t.button_style !== 'solid') attrs['data-lh-btn'] = t.button_style
  if (t.card_style !== 'shadow') attrs['data-lh-card'] = t.card_style
  if (t.density !== 'comfortable') attrs['data-lh-density'] = t.density
  if (t.radius !== 'soft') {
    attrs['data-lh-radius'] = t.radius
    style['--lh-radius-card'] = RADIUS[t.radius].card
    style['--lh-radius-btn'] = RADIUS[t.radius].btn
  }
  if (t.button_shape !== 'auto') {
    attrs['data-lh-btn-shape'] = t.button_shape
    style['--lh-radius-btn'] = BUTTON_SHAPE[t.button_shape]
  }
  if (t.elevation !== 'default') attrs['data-lh-elevation'] = t.elevation
  if (t.link_style !== 'accent') attrs['data-lh-link'] = t.link_style
  if (t.type_scale !== 'default') attrs['data-lh-type'] = t.type_scale
  if (t.heading_weight) {
    attrs['data-lh-heading-weight'] = ''
    style['--lh-heading-weight'] = t.heading_weight
  }
  if (t.header_layout !== 'standard') attrs['data-lh-header'] = t.header_layout
  if (t.footer_style !== 'simple') attrs['data-lh-footer'] = t.footer_style
  if (t.image_style !== 'default') attrs['data-lh-img'] = t.image_style
  if (t.neutral !== 'neutral') {
    attrs['data-lh-neutral'] = t.neutral
    style['--lh-hairline'] = NEUTRAL_PAGE[t.neutral].hairline
    style['--lh-muted'] = NEUTRAL_PAGE[t.neutral].muted
  }

  if (s.font) style.fontFamily = fontStack(s.font)
  style['--lh-font-body'] = fontStack(s.font)
  const heading = effectiveHeadingFont(s)
  if (heading) {
    attrs['data-lh-heading'] = ''
    style['--lh-font-heading'] = fontStack(heading)
  }

  // Background: "tint" is the pre-theme look (brand at 5%, nothing without one).
  // A warm or cool neutral gives the page its tone where there is no tint.
  const tone = t.neutral !== 'neutral' ? NEUTRAL_PAGE[t.neutral].page : ''
  const layers: string[] = []
  if (t.background === 'tint' && s.color) style.backgroundColor = hexToRgba(s.color, 0.05)
  if (t.background === 'plain' && tone) style.backgroundColor = tone
  if (t.background === 'tint' && !s.color && tone) style.backgroundColor = tone
  if (t.background === 'pattern') {
    const dot = hexToRgba(s.color || NEUTRAL_ACCENT, 0.09)
    style.backgroundColor = s.color ? hexToRgba(s.color, 0.03) : tone || 'transparent'
    layers.push(`radial-gradient(${dot} 1px, transparent 1.2px)`)
    style.backgroundSize = '18px 18px'
    attrs['data-lh-bg'] = 'pattern'
  }
  if (t.background === 'grid') {
    const line = hexToRgba(s.color || NEUTRAL_ACCENT, 0.06)
    style.backgroundColor = tone || 'transparent'
    layers.push(`linear-gradient(${line} 1px, transparent 1px)`, `linear-gradient(90deg, ${line} 1px, transparent 1px)`)
    style.backgroundSize = '28px 28px'
    attrs['data-lh-bg'] = 'grid'
  }
  if (t.background === 'gradient') {
    const a = s.color || NEUTRAL_ACCENT
    const b = s.theme.secondary_color || mixHex(a, '#ffffff', 0.4)
    style.backgroundColor = tone || 'transparent'
    layers.push(`radial-gradient(90% 60% at 15% 0%, ${hexToRgba(a, 0.12)}, transparent 70%)`, `radial-gradient(80% 50% at 90% 10%, ${hexToRgba(b, 0.1)}, transparent 70%)`)
    style.backgroundSize = 'auto'
    style.backgroundRepeat = 'no-repeat'
    attrs['data-lh-bg'] = 'gradient'
  }

  // Forced light: the org's public pages keep their light look in the
  // visitor's dark mode (dark.css gives [data-lh-user-content] the light
  // palette back), on a solid light base so the dark canvas never shows.
  if (t.public_scheme === 'light') {
    attrs['data-lh-scheme'] = 'light'
    attrs['data-lh-user-content'] = ''
    const top = style.backgroundColor && style.backgroundColor !== 'transparent' ? style.backgroundColor : ''
    if (top && top.startsWith('rgba')) layers.push(`linear-gradient(${top}, ${top})`)
    style.backgroundColor = top && !top.startsWith('rgba') ? top : '#ffffff'
  }
  if (layers.length) style.backgroundImage = layers.join(', ')

  return { style, attrs }
}

/* ------------------------------------------------------------------------ */
/* Presets                                                                   */
/* ------------------------------------------------------------------------ */

export interface ThemePreset {
  key: ThemePresetKey
  color: string
  font: string
  theme: Omit<ThemeOptions, 'preset'>
}

const base = DEFAULT_THEME_OPTIONS

export const THEME_PRESETS: ThemePreset[] = [
  { key: 'classic', color: '', font: '', theme: { ...base } },
  {
    key: 'ocean',
    color: '#0369a1',
    font: 'Plus Jakarta Sans',
    theme: { ...base, accent_mode: 'brand', heading_font: '', card_style: 'shadow' },
  },
  {
    key: 'forest',
    color: '#166534',
    font: 'Nunito',
    theme: { ...base, accent_mode: 'custom', accent_color: '#15803d', header_style: 'white', radius: 'round', heading_font: 'Lexend', button_style: 'soft', card_style: 'border', background: 'plain' },
  },
  {
    key: 'midnight',
    color: '#111827',
    font: 'Inter',
    theme: { ...base, accent_mode: 'custom', accent_color: '#6366f1', header_style: 'dark', heading_font: 'Space Grotesk', card_style: 'border', background: 'plain' },
  },
  {
    key: 'sunset',
    color: '#c2410c',
    font: 'DM Sans',
    theme: { ...base, accent_mode: 'brand', radius: 'round', heading_font: 'Outfit' },
  },
  {
    key: 'orchid',
    color: '#7c3aed',
    font: 'Manrope',
    theme: { ...base, accent_mode: 'brand', header_style: 'glass', radius: 'round', heading_font: 'Sora', button_style: 'soft', background: 'pattern' },
  },
  {
    key: 'slate',
    color: '#334155',
    font: 'IBM Plex Sans',
    theme: { ...base, accent_mode: 'brand', header_style: 'white', radius: 'sharp', card_style: 'border', density: 'compact', background: 'plain' },
  },
  {
    key: 'sand',
    color: '#a16207',
    font: 'Work Sans',
    theme: { ...base, accent_mode: 'brand', header_style: 'white', heading_font: 'Fraunces', button_style: 'outline', card_style: 'flat' },
  },
  // Fuller looks from the theme studio: palette, type, shape and layout.
  {
    key: 'atelier',
    color: '#1f4d3a',
    font: 'Inter',
    theme: { ...base, accent_mode: 'custom', accent_color: '#1f4d3a', header_style: 'white', radius: 'sharp', heading_font: 'Fraunces', card_style: 'border', background: 'plain', secondary_color: '#c08a3e', neutral: 'warm', type_scale: 'large', heading_weight: '500', elevation: 'flat', link_style: 'underline', footer_style: 'centered', image_style: 'framed' },
  },
  {
    key: 'harbor',
    color: '#0f2a4a',
    font: 'IBM Plex Sans',
    theme: { ...base, accent_mode: 'custom', accent_color: '#2f8cff', header_style: 'brand', heading_font: '', card_style: 'border', background: 'plain', secondary_color: '#2f8cff', neutral: 'cool', heading_weight: '600', button_shape: 'rounded', header_layout: 'centered', footer_style: 'bar' },
  },
  {
    key: 'grove',
    color: '#2f5d50',
    font: 'Work Sans',
    theme: { ...base, accent_mode: 'brand', header_style: 'white', radius: 'round', heading_font: 'Lora', button_style: 'soft', card_style: 'flat', background: 'gradient', secondary_color: '#d08c34', neutral: 'warm', image_style: 'rounded' },
  },
  {
    key: 'noir',
    color: '#0a0a0a',
    font: 'Inter',
    theme: { ...base, accent_mode: 'custom', accent_color: '#ff5b1f', header_style: 'dark', radius: 'none', heading_font: 'Instrument Serif', card_style: 'border', background: 'plain', type_scale: 'large', heading_weight: '500', button_shape: 'square', elevation: 'flat', header_layout: 'minimal', footer_style: 'bar', image_style: 'muted', dark_accent: '#ff7a45' },
  },
  {
    key: 'ember',
    color: '#c4532d',
    font: 'DM Sans',
    theme: { ...base, accent_mode: 'brand', header_style: 'white', radius: 'round', heading_font: 'DM Serif Display', button_style: 'solid', card_style: 'shadow', background: 'tint', secondary_color: '#e8a87c', neutral: 'warm', heading_weight: '500', button_shape: 'pill', elevation: 'lifted', image_style: 'rounded' },
  },
  {
    key: 'linen',
    color: '#8c1c2b',
    font: 'Source Sans 3',
    theme: { ...base, accent_mode: 'brand', header_style: 'white', radius: 'none', heading_font: 'Libre Baskerville', card_style: 'border', background: 'plain', secondary_color: '#b98a2f', neutral: 'warm', elevation: 'flat', link_style: 'underline', header_layout: 'centered', footer_style: 'centered' },
  },
  {
    key: 'citrus',
    color: '#2747d1',
    font: 'Figtree',
    theme: { ...base, accent_mode: 'custom', accent_color: '#ff6a3d', header_style: 'glass', radius: 'round', heading_font: 'Bricolage Grotesque', button_style: 'solid', card_style: 'shadow', background: 'pattern', secondary_color: '#ffc93c', heading_weight: '800', button_shape: 'pill', elevation: 'lifted' },
  },
  {
    key: 'glacier',
    color: '#0e7c7b',
    font: 'Plus Jakarta Sans',
    theme: { ...base, accent_mode: 'brand', header_style: 'glass', radius: 'soft', heading_font: '', button_style: 'solid', card_style: 'border', background: 'grid', secondary_color: '#3bb7a5', neutral: 'cool', heading_weight: '700', link_style: 'subtle', image_style: 'rounded' },
  },
]

export function applyPreset(key: ThemePresetKey): OrgThemeState {
  const preset = THEME_PRESETS.find((p) => p.key === key) || THEME_PRESETS[0]
  return { color: preset.color, font: preset.font, theme: { ...preset.theme, preset: preset.key } }
}

/** Font pairings: heading + body, all multi-weight Google families. */
export interface FontPairing {
  key: string
  heading: string
  body: string
}

export const FONT_PAIRINGS: FontPairing[] = [
  { key: 'default', heading: '', body: '' },
  { key: 'modern', heading: 'Inter', body: 'Inter' },
  { key: 'technical', heading: 'Space Grotesk', body: 'IBM Plex Sans' },
  { key: 'friendly', heading: 'Lexend', body: 'Nunito' },
  { key: 'geometric', heading: 'Outfit', body: 'DM Sans' },
  { key: 'editorial', heading: 'Playfair Display', body: 'Source Sans 3' },
  { key: 'elegant', heading: 'Fraunces', body: 'Manrope' },
  { key: 'bookish', heading: 'Lora', body: 'Open Sans' },
  { key: 'bold', heading: 'Bricolage Grotesque', body: 'Plus Jakarta Sans' },
  { key: 'classic_serif', heading: 'Libre Baskerville', body: 'Source Sans 3' },
  { key: 'warm_serif', heading: 'DM Serif Display', body: 'DM Sans' },
  { key: 'gallery', heading: 'Instrument Serif', body: 'Inter' },
  { key: 'display', heading: 'Syne', body: 'Archivo' },
  { key: 'humanist', heading: 'Sora', body: 'Manrope' },
  { key: 'scholarly', heading: 'EB Garamond', body: 'Libre Franklin' },
  { key: 'rounded', heading: 'Quicksand', body: 'Nunito' },
]

/** The pairing a state matches, or null when the fonts were picked by hand. */
export function matchFontPairing(state: OrgThemeState): FontPairing | null {
  const body = sanitizeFont(state.font)
  const heading = sanitizeFont(state.theme.heading_font) || body
  return (
    FONT_PAIRINGS.find((p) => p.body === body && (p.heading || p.body) === heading) || null
  )
}

/** Curated accent swatches for the color pickers. */
export const PALETTE = ['#111827', '#1d4ed8', '#0369a1', '#0f766e', '#15803d', '#a16207', '#c2410c', '#be123c', '#7c3aed', '#db2777']

/**
 * Server-safe color summary for things drawn outside the page (OG images,
 * share cards): the brand color and the accent, each with readable text.
 * Falls back to the neutral palette so callers never get an empty color.
 */
export function orgThemeColors(org: any): {
  brand: string
  brandText: string
  accent: string
  accentText: string
  headingFont: string
  bodyFont: string
} {
  const state = readOrgTheme(org)
  const brand = state.color || NEUTRAL_ACCENT
  const accent = resolveAccent(state) || brand
  return {
    brand,
    brandText: readableTextOn(brand),
    accent,
    accentText: readableTextOn(accent),
    headingFont: effectiveHeadingFont(state) || state.font || DEFAULT_FONT,
    bodyFont: state.font || DEFAULT_FONT,
  }
}
