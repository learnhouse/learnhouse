/**
 * The landing page document (mirror of apps/api/src/services/landing/schema.py).
 *
 * A page is a tree: top-level sections hold containers, columns and elements.
 * Styles are responsive overrides (base → tablet → mobile, plus hover) made
 * of allowlisted properties; colors may reference theme tokens ($primary).
 * The API validates every save; the renderer re-checks values before they
 * reach CSS, so a hand-edited document can never inject styles.
 */

export const LANDING_SCHEMA = 'lh.page'
export const LANDING_VERSION = 1

export type Breakpoint = 'base' | 'tablet' | 'mobile'
export type StyleLayer = Breakpoint | 'hover'

export type Length = number | string

export interface Gradient {
  from: string
  to: string
  via?: string
  angle?: number
  /** 'radial' is a soft glow from the top (angle ignored); omitted = linear. */
  type?: 'linear' | 'radial'
}

export interface Style {
  display?: 'block' | 'flex' | 'grid' | 'none'
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  flexWrap?: 'wrap' | 'nowrap'
  justifyContent?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around' | 'space-evenly'
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline'
  gridColumns?: number
  flexGrow?: number
  gap?: Length
  width?: Length
  maxWidth?: Length
  minWidth?: Length
  height?: Length
  minHeight?: Length
  paddingTop?: Length
  paddingRight?: Length
  paddingBottom?: Length
  paddingLeft?: Length
  marginTop?: Length
  marginRight?: Length
  marginBottom?: Length
  marginLeft?: Length
  fontFamily?: string
  fontSize?: Length
  fontWeight?: '300' | '400' | '500' | '600' | '700' | '800' | '900'
  lineHeight?: number
  letterSpacing?: Length
  textAlign?: 'start' | 'center' | 'end' | 'justify'
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  fontStyle?: 'normal' | 'italic'
  textDecoration?: 'none' | 'underline' | 'line-through'
  color?: string
  backgroundColor?: string
  backgroundGradient?: Gradient
  backgroundImage?: string
  backgroundSize?: 'cover' | 'contain' | 'auto'
  backgroundPosition?: 'center' | 'top' | 'bottom' | 'left' | 'right'
  backgroundVideo?: string
  overlayColor?: string
  overlayOpacity?: number
  borderWidth?: Length
  borderStyle?: 'none' | 'solid' | 'dashed' | 'dotted'
  borderColor?: string
  borderRadius?: Length
  boxShadow?: 'none' | 'sm' | 'md' | 'lg' | 'xl'
  opacity?: number
  overflow?: 'visible' | 'hidden'
  aspectRatio?: 'auto' | '16/9' | '4/3' | '3/2' | '1/1' | '2/3' | '3/4' | '9/16' | '21/9'
  objectFit?: 'cover' | 'contain'
  scale?: number
}

export type StyleKey = keyof Style

export interface ResponsiveStyle {
  base?: Style
  tablet?: Style
  mobile?: Style
  hover?: Style
}

export type ElementType =
  | 'section' | 'container' | 'columns'
  | 'heading' | 'text' | 'richtext' | 'image' | 'video' | 'button' | 'icon' | 'divider' | 'spacer' | 'embed' | 'list' | 'html'
  | 'courses' | 'course' | 'paths' | 'communities' | 'podcasts' | 'live_sessions' | 'instructors'
  | 'testimonials' | 'pricing' | 'faq' | 'stats' | 'logos' | 'features' | 'steps' | 'gallery' | 'countdown'
  | 'newsletter' | 'form' | 'navbar' | 'footer' | 'symbol'

export interface LandingNode {
  id: string
  type: ElementType
  name?: string
  props: Record<string, any>
  style?: ResponsiveStyle
  children?: LandingNode[]
  hidden?: { desktop?: boolean; tablet?: boolean; mobile?: boolean }
  visibility?: 'everyone' | 'logged_in' | 'logged_out'
  schedule?: { from?: string; until?: string }
  animation?: { type: 'none' | 'fade' | 'slide-up' | 'slide-in' | 'zoom'; delay?: number; duration?: number }
  anchor?: string
}

export type ThemeColorKey = 'primary' | 'secondary' | 'accent' | 'background' | 'surface' | 'text' | 'muted' | 'border'

export interface LandingTheme {
  colors: Record<ThemeColorKey, string>
  fonts: { heading: string; body: string }
  radius: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full'
  buttonStyle: 'solid' | 'soft' | 'outline' | 'pill'
  width: 'normal' | 'wide' | 'full'
  density: 'compact' | 'comfortable' | 'spacious'
  headingWeight: '500' | '600' | '700' | '800'
  /** Colors used when the visitor browses in dark mode (none: the page keeps its design). */
  dark?: LandingDarkColors
}

export interface LandingDarkColors {
  primary?: string
  background: string
  surface: string
  text: string
  muted: string
  border: string
}

export const DEFAULT_DARK_COLORS: LandingDarkColors = {
  background: '#0c0c0f',
  surface: '#16161b',
  text: '#ededf0',
  muted: '#a1a1aa',
  border: '#2a2a31',
}

export interface LandingSymbol {
  name: string
  node: LandingNode
}

export interface LandingDoc {
  schema: typeof LANDING_SCHEMA
  version: number
  theme: LandingTheme
  page: {
    background?: string
    backgroundGradient?: Gradient
    backgroundImage?: string
    title?: string
    description?: string
    /** Social sharing picture (Open Graph). */
    image?: string
    /** Ask search engines not to index the page. */
    noindex?: boolean
  }
  symbols: Record<string, LandingSymbol>
  root: LandingNode[]
}

export const DEFAULT_THEME: LandingTheme = {
  colors: {
    primary: 'brand',
    secondary: '#0f172a',
    accent: '#f59e0b',
    background: '#ffffff',
    surface: '#f8fafc',
    text: '#0f172a',
    muted: '#64748b',
    border: '#e2e8f0',
  },
  fonts: { heading: 'brand', body: 'brand' },
  radius: 'lg',
  buttonStyle: 'solid',
  width: 'normal',
  density: 'comfortable',
  headingWeight: '700',
}

export function emptyDoc(): LandingDoc {
  return { schema: LANDING_SCHEMA, version: LANDING_VERSION, theme: structuredClone(DEFAULT_THEME), page: {}, symbols: {}, root: [] }
}

/** Element types that hold children. */
export const CONTAINER_TYPES: ReadonlySet<ElementType> = new Set(['section', 'container', 'columns'])

/** Element types whose main text can be edited in place on the canvas. */
export const INLINE_TEXT: Partial<Record<ElementType, string>> = { heading: 'text', text: 'text', button: 'label' }

/** Coerce anything into a renderable document (unknown parts dropped). */
export function asDoc(raw: unknown): LandingDoc {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<LandingDoc>
  const theme = { ...DEFAULT_THEME, ...(d.theme || {}) } as LandingTheme
  theme.colors = { ...DEFAULT_THEME.colors, ...((d.theme && d.theme.colors) || {}) }
  theme.fonts = { ...DEFAULT_THEME.fonts, ...((d.theme && d.theme.fonts) || {}) }
  return {
    schema: LANDING_SCHEMA,
    version: LANDING_VERSION,
    theme,
    page: d.page && typeof d.page === 'object' ? d.page : {},
    symbols: d.symbols && typeof d.symbols === 'object' ? (d.symbols as Record<string, LandingSymbol>) : {},
    root: Array.isArray(d.root) ? (d.root.filter((n) => n && typeof n === 'object' && typeof (n as any).type === 'string') as LandingNode[]) : [],
  }
}
