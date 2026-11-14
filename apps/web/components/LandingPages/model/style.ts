/**
 * Node styles → CSS. Pure module (unit tested).
 *
 * Each node gets one class (`.lhp-<id>`). Its responsive overrides become
 * container queries on the page root (`container-name: lhp`), so the builder
 * canvas switches breakpoints by changing its own width, with no iframe.
 * Every value is re-checked against the same rules as the API before it is
 * written, so a corrupted document can never inject CSS.
 */
import type React from 'react'
import type { Breakpoint, LandingDoc, LandingNode, LandingTheme, Style } from './types'
import { fontStack, googleFontsUrl } from './fonts'

export const BREAKPOINTS: Record<Exclude<Breakpoint, 'base'>, number> = { tablet: 1023, mobile: 639 }
export const CANVAS_WIDTHS: Record<Breakpoint, number> = { base: 1280, tablet: 820, mobile: 390 }

const LENGTH_RE = /^-?\d{1,5}(\.\d{1,4})?(px|rem|em|%|vh|vw|svh|ch)$/
const HEX_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const RGB_RE = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d{1,3}))?\s*\)$/
const TOKENS = ['primary', 'secondary', 'accent', 'background', 'surface', 'text', 'muted', 'border', 'on-primary'] as const
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/
const FONT_RE = /^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/

export function cssLength(v: unknown, allowAuto = false): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10000) return `${v}px`
  if (typeof v === 'string') {
    const s = v.trim()
    if (allowAuto && s === 'auto') return 'auto'
    if (LENGTH_RE.test(s)) return s
  }
  return null
}

export function cssColor(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (s === 'transparent' || s === 'currentColor' || HEX_RE.test(s) || RGB_RE.test(s)) return s
  if (s.startsWith('$') && (TOKENS as readonly string[]).includes(s.slice(1))) return `var(--lhp-${s.slice(1)})`
  return null
}

export function cssUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || /[\s"'()\\]/.test(s)) return null
  if ((s.startsWith('/') && !s.startsWith('//')) || /^https?:\/\//i.test(s)) return `url("${s}")`
  return null
}

const SHADOWS: Record<string, string> = {
  none: 'none',
  sm: '0 1px 2px rgba(15,23,42,.06), 0 1px 3px rgba(15,23,42,.08)',
  md: '0 4px 12px -2px rgba(15,23,42,.10), 0 2px 4px -2px rgba(15,23,42,.06)',
  lg: '0 12px 32px -8px rgba(15,23,42,.18), 0 4px 8px -4px rgba(15,23,42,.06)',
  xl: '0 24px 60px -12px rgba(15,23,42,.28)',
}

const ENUMS: Partial<Record<keyof Style, readonly string[]>> = {
  display: ['block', 'flex', 'grid', 'none'],
  flexDirection: ['row', 'column', 'row-reverse', 'column-reverse'],
  flexWrap: ['wrap', 'nowrap'],
  justifyContent: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
  alignItems: ['flex-start', 'center', 'flex-end', 'stretch', 'baseline'],
  fontWeight: ['300', '400', '500', '600', '700', '800', '900'],
  textAlign: ['start', 'center', 'end', 'justify'],
  textTransform: ['none', 'uppercase', 'lowercase', 'capitalize'],
  fontStyle: ['normal', 'italic'],
  textDecoration: ['none', 'underline', 'line-through'],
  backgroundSize: ['cover', 'contain', 'auto'],
  backgroundPosition: ['center', 'top', 'bottom', 'left', 'right'],
  borderStyle: ['none', 'solid', 'dashed', 'dotted'],
  overflow: ['visible', 'hidden'],
  aspectRatio: ['auto', '16/9', '4/3', '3/2', '1/1', '2/3', '3/4', '9/16', '21/9'],
  objectFit: ['cover', 'contain'],
}

// Physical keys are written as logical properties, so pages mirror in RTL.
const LENGTH_PROPS: Partial<Record<keyof Style, string>> = {
  gap: 'gap',
  width: 'width',
  minWidth: 'min-width',
  height: 'height',
  minHeight: 'min-height',
  paddingTop: 'padding-top',
  paddingBottom: 'padding-bottom',
  paddingLeft: 'padding-inline-start',
  paddingRight: 'padding-inline-end',
  fontSize: 'font-size',
  letterSpacing: 'letter-spacing',
  borderWidth: 'border-width',
  borderRadius: 'border-radius',
}
const MARGIN_PROPS: Partial<Record<keyof Style, string>> = {
  marginTop: 'margin-top',
  marginBottom: 'margin-bottom',
  marginLeft: 'margin-inline-start',
  marginRight: 'margin-inline-end',
}
const ENUM_PROPS: Partial<Record<keyof Style, string>> = {
  display: 'display',
  flexDirection: 'flex-direction',
  flexWrap: 'flex-wrap',
  justifyContent: 'justify-content',
  alignItems: 'align-items',
  fontWeight: 'font-weight',
  textAlign: 'text-align',
  textTransform: 'text-transform',
  fontStyle: 'font-style',
  textDecoration: 'text-decoration',
  backgroundSize: 'background-size',
  backgroundPosition: 'background-position',
  borderStyle: 'border-style',
  overflow: 'overflow',
  aspectRatio: 'aspect-ratio',
  objectFit: 'object-fit',
}

export { fontStack } from './fonts'

/** CSS declarations for one style layer (no selector). */
export function declarations(style: Style | undefined): string[] {
  if (!style || typeof style !== 'object') return []
  const out: string[] = []
  for (const [k, raw] of Object.entries(style) as [keyof Style, unknown][]) {
    if (raw === undefined || raw === null) continue
    const lp = LENGTH_PROPS[k]
    if (lp) {
      const v = cssLength(raw)
      if (v) out.push(`${lp}:${v}`)
      continue
    }
    const mp = MARGIN_PROPS[k]
    if (mp) {
      const v = cssLength(raw, true)
      if (v) out.push(`${mp}:${v}`)
      continue
    }
    const ep = ENUM_PROPS[k]
    if (ep) {
      if (typeof raw === 'string' && ENUMS[k]?.includes(raw)) out.push(`${ep}:${raw === '16/9' || raw.includes('/') ? raw.replace('/', ' / ') : raw}`)
      continue
    }
    switch (k) {
      case 'maxWidth': {
        const v = raw === 'content' ? 'var(--lhp-width)' : cssLength(raw)
        if (v) out.push(`max-width:${v}`)
        break
      }
      case 'gridColumns': {
        const n = Number(raw)
        if (Number.isInteger(n) && n >= 1 && n <= 12) out.push(`grid-template-columns:repeat(${n},minmax(0,1fr))`)
        break
      }
      case 'flexGrow': {
        const n = Number(raw)
        if (Number.isInteger(n) && n >= 0 && n <= 12) out.push(`flex-grow:${n}`, 'min-width:0')
        break
      }
      case 'lineHeight': {
        const n = Number(raw)
        if (Number.isFinite(n) && n >= 0.8 && n <= 3) out.push(`line-height:${n}`)
        break
      }
      case 'opacity': {
        const n = Number(raw)
        if (Number.isFinite(n) && n >= 0 && n <= 1) out.push(`opacity:${n}`)
        break
      }
      case 'scale': {
        const n = Number(raw)
        if (Number.isFinite(n) && n >= 0.8 && n <= 1.2) out.push(`transform:scale(${n})`)
        break
      }
      case 'fontFamily': {
        if (raw === 'heading') out.push('font-family:var(--lhp-font-heading)')
        else if (raw === 'body') out.push('font-family:var(--lhp-font-body)')
        else if (typeof raw === 'string' && FONT_RE.test(raw)) out.push(`font-family:${fontStack(raw, '--lhp-font-body')}`)
        break
      }
      case 'color':
      case 'backgroundColor':
      case 'borderColor': {
        const v = cssColor(raw)
        if (v) out.push(`${k === 'color' ? 'color' : k === 'backgroundColor' ? 'background-color' : 'border-color'}:${v}`)
        break
      }
      case 'boxShadow':
        if (typeof raw === 'string' && SHADOWS[raw]) out.push(`box-shadow:${SHADOWS[raw]}`)
        break
      case 'backgroundGradient': {
        const g = raw as Style['backgroundGradient']
        const from = cssColor(g?.from)
        const to = cssColor(g?.to)
        const via = g?.via ? cssColor(g.via) : null
        const angle = Math.max(0, Math.min(360, Number(g?.angle ?? 180) || 0))
        if (from && to) {
          const image = cssUrl(style.backgroundImage)
          const grad = gradientCss(from, to, via, angle, g?.type)
          out.push(`background-image:${image ? `${grad},${image}` : grad}`)
        }
        break
      }
      case 'backgroundImage': {
        if (style.backgroundGradient) break // written with the gradient
        const v = cssUrl(raw)
        if (v) {
          out.push(`background-image:${v}`)
          if (!style.backgroundSize) out.push('background-size:cover')
          if (!style.backgroundPosition) out.push('background-position:center')
        }
        break
      }
      default:
        break
    }
  }
  if (style.borderWidth !== undefined && !style.borderStyle) out.push('border-style:solid')
  return out
}

/** A linear gradient, or a radial glow from the top center for type 'radial'. */
export function gradientCss(from: string, to: string, via: string | null, angle: number, type?: string): string {
  if (type === 'radial') return `radial-gradient(120% 90% at 50% 0%,${from}${via ? `,${via}` : ''},${to} 70%)`
  return `linear-gradient(${angle}deg,${from}${via ? `,${via}` : ''},${to})`
}

function overlayRules(cls: string, style: Style | undefined): string {
  if (!style) return ''
  const color = cssColor(style.overlayColor)
  const opacity = Number(style.overlayOpacity)
  if (!color || !Number.isFinite(opacity) || opacity <= 0) return ''
  return `${cls}{position:relative;isolation:isolate}${cls}::before{content:"";position:absolute;inset:0;background:${color};opacity:${Math.min(95, opacity) / 100};z-index:-1;pointer-events:none;border-radius:inherit}`
}

function block(selector: string, decls: string[]): string {
  return decls.length ? `${selector}{${decls.join(';')}}` : ''
}

export interface CssOptions {
  /** Canvas: hidden elements stay visible (faded) so they can be selected. */
  canvas?: boolean
}

/** All CSS for one node (not its children). */
export function nodeCss(node: LandingNode, opts: CssOptions = {}): string {
  if (!node || !ID_RE.test(node.id || '')) return ''
  const cls = `.lhp-${node.id}`
  const s = node.style || {}
  const parts: string[] = []
  parts.push(block(cls, declarations(s.base)), overlayRules(cls, s.base))
  if (s.hover) {
    const hover = Object.fromEntries(Object.entries(s.hover).filter(([k]) => ['color', 'backgroundColor', 'borderColor', 'boxShadow', 'opacity', 'scale'].includes(k)))
    const decls = declarations(hover as Style)
    if (decls.length) parts.push(`${cls}{transition:color .2s,background-color .2s,border-color .2s,box-shadow .2s,opacity .2s,transform .2s}`, block(`${cls}:hover`, decls))
  }
  const hiddenDecl = opts.canvas ? ['opacity:.35', 'outline:1px dashed rgba(100,116,139,.6)', 'outline-offset:-1px'] : ['display:none !important']
  if (node.hidden?.desktop) parts.push(`@container lhp (min-width: ${BREAKPOINTS.tablet + 1}px){${block(cls, hiddenDecl)}}`)
  for (const bp of ['tablet', 'mobile'] as const) {
    const decls = declarations(s[bp])
    const inner = block(cls, decls) + overlayRules(cls, s[bp])
    const hide = bp === 'tablet' ? node.hidden?.tablet : node.hidden?.mobile
    const min = bp === 'tablet' ? BREAKPOINTS.mobile + 1 : 0
    if (inner) parts.push(`@container lhp (max-width: ${BREAKPOINTS[bp]}px){${inner}}`)
    if (hide) parts.push(`@container lhp (min-width: ${min}px) and (max-width: ${BREAKPOINTS[bp]}px){${block(cls, hiddenDecl)}}`)
  }
  return parts.join('')
}

/** CSS for a whole tree (page or symbol). */
export function treeCss(nodes: LandingNode[], opts: CssOptions = {}, prefix = ''): string {
  let css = ''
  const visit = (n: LandingNode) => {
    css += nodeCss(prefix ? { ...n, id: `${prefix}${n.id}` } : n, opts)
    for (const c of n.children || []) visit(c)
  }
  for (const n of nodes) visit(n)
  return css
}

const RADIUS: Record<LandingTheme['radius'], [string, string]> = {
  none: ['0px', '0px'],
  sm: ['6px', '6px'],
  md: ['10px', '8px'],
  lg: ['16px', '10px'],
  xl: ['24px', '14px'],
  full: ['28px', '999px'],
}
const WIDTHS: Record<LandingTheme['width'], string> = { normal: '1200px', wide: '1440px', full: '100%' }
const DENSITY: Record<LandingTheme['density'], string> = { compact: '0.75', comfortable: '1', spacious: '1.25' }

function hexToRgb(hex: string): [number, number, number] | null {
  if (!HEX_RE.test(hex)) return null
  let d = hex.slice(1)
  if (d.length <= 4) d = d.slice(0, 3).split('').map((c) => c + c).join('')
  d = d.slice(0, 6)
  return [parseInt(d.slice(0, 2), 16), parseInt(d.slice(2, 4), 16), parseInt(d.slice(4, 6), 16)]
}

/** '#ffffff' or '#111111', whichever reads better on `hex`. */
export function readableOn(hex: string): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#ffffff'
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // Whichever of near-black and white contrasts more (WCAG ratio): sky and
  // amber brand colors get dark text, deep ones white.
  const onWhite = 1.05 / (lum + 0.05)
  const onDark = (lum + 0.05) / (0.0056 + 0.05)
  return onDark >= onWhite ? '#111111' : '#ffffff'
}

/**
 * CSS variables for the page root from the theme. "brand" reads the org
 * theme: the brand color for primary, the org's secondary and accent colors
 * (theme studio) for those, so a page can follow the org theme entirely.
 * With `dark` (the visitor uses dark mode and the page defines a dark
 * palette) the surfaces and text switch to it.
 */
export function themeVars(theme: LandingTheme, dark = false): Record<string, string> {
  const c = theme.colors
  const color = (v: string, fallback: string) => (v === 'brand' ? fallback : cssColor(v) || fallback)
  const d = dark && theme.dark ? theme.dark : null
  const primaryRaw = d?.primary || c.primary
  const primary = color(primaryRaw, 'var(--lh-brand, var(--lh-accent, #171717))')
  const onPrimary = primaryRaw === 'brand' ? 'var(--lh-brand-contrast, var(--lh-accent-contrast, #ffffff))' : readableOn(primaryRaw)
  const [radius, radiusBtn] = RADIUS[theme.radius] || RADIUS.lg
  return {
    '--lhp-primary': primary,
    '--lhp-on-primary': onPrimary,
    '--lhp-secondary': color(c.secondary, 'var(--lh-secondary, #0f172a)'),
    '--lhp-accent': color(c.accent, 'var(--lh-accent, #f59e0b)'),
    '--lhp-background': color(d?.background || c.background, '#ffffff'),
    '--lhp-surface': color(d?.surface || c.surface, '#f8fafc'),
    '--lhp-text': color(d?.text || c.text, '#0f172a'),
    '--lhp-muted': color(d?.muted || c.muted, '#64748b'),
    '--lhp-border': color(d?.border || c.border, '#e2e8f0'),
    '--lhp-font-heading': fontStack(theme.fonts?.heading, '--lh-font-heading'),
    '--lhp-font-body': fontStack(theme.fonts?.body, '--lh-font-body'),
    '--lhp-radius': radius,
    '--lhp-radius-btn': theme.buttonStyle === 'pill' ? '999px' : radiusBtn,
    '--lhp-width': WIDTHS[theme.width] || WIDTHS.normal,
    '--lhp-density': DENSITY[theme.density] || '1',
    '--lhp-heading-weight': theme.headingWeight || '700',
  }
}

/** Google Fonts stylesheet for the theme's custom faces (null for brand fonts). */
/** Every font the page uses: the theme's two and any element's own font. */
export function docFonts(doc: Pick<LandingDoc, 'theme' | 'root' | 'symbols'>): string[] {
  const out = new Set<string>([doc.theme.fonts?.heading, doc.theme.fonts?.body].filter(Boolean) as string[])
  const visit = (n: LandingNode) => {
    for (const bp of ['base', 'tablet', 'mobile', 'hover'] as const) {
      const f = (n.style as any)?.[bp]?.fontFamily
      if (typeof f === 'string' && f !== 'heading' && f !== 'body') out.add(f)
    }
    n.children?.forEach(visit)
  }
  doc.root.forEach(visit)
  Object.values(doc.symbols || {}).forEach((s: any) => s?.node && visit(s.node))
  return Array.from(out)
}

/** The stylesheet for the page's fonts (null when it only uses brand or system fonts). */
export function themeFontsUrl(doc: Pick<LandingDoc, 'theme' | 'root' | 'symbols'>): string | null {
  return googleFontsUrl(docFonts(doc))
}

/** All CSS a document needs (nodes and symbols). */
export function docCss(doc: LandingDoc, opts: CssOptions = {}): string {
  let css = treeCss(doc.root, opts)
  for (const [sid, sym] of Object.entries(doc.symbols || {})) {
    if (sym?.node && ID_RE.test(sid)) css += treeCss([sym.node], opts)
  }
  return css
}

/** Grid columns: the chosen count, never more than there are items, so a short row fills the width. */
export function gridCols(columns: unknown, count: number, fallback = 3): number {
  const n = Math.min(6, Math.max(1, Number(columns) || fallback))
  if (count <= 0) return n
  if (count <= n) return count
  // Never leave one card alone on the last row: one column more, else one less.
  if (n > 1 && count % n === 1) {
    if (n < 6 && count % (n + 1) !== 1) return n + 1
    if (n > 2 && count % (n - 1) !== 1) return n - 1
  }
  return n
}

/** The page root's background: color, then an optional gradient and image on top. */
export function pageBackground(page: LandingDoc['page'] | undefined, dark = false): React.CSSProperties {
  // The dark palette replaces the page's own background color and gradient.
  const color = (!dark && page?.background && cssColor(page.background)) || 'var(--lhp-background)'
  const out: React.CSSProperties = { backgroundColor: color }
  const g = dark ? undefined : page?.backgroundGradient
  const from = cssColor(g?.from)
  const to = cssColor(g?.to)
  const layers: string[] = []
  if (from && to) {
    const via = g?.via ? cssColor(g.via) : null
    const angle = Math.max(0, Math.min(360, Number(g?.angle ?? 180) || 0))
    layers.push(gradientCss(from, to, via, angle, g?.type))
  }
  const image = cssUrl(page?.backgroundImage)
  if (image) layers.push(image)
  if (layers.length) {
    out.backgroundImage = layers.join(',')
    if (image) {
      out.backgroundSize = 'cover'
      out.backgroundPosition = 'center'
    }
  }
  return out
}

/**
 * The color scheme a page renders in: light, unless its own background is
 * dark. Never the visitor's OS setting, so native form controls and iframes
 * match the page the member designed.
 */
export function pageScheme(doc: Pick<LandingDoc, 'page' | 'theme'>, dark = false): 'light' | 'dark' {
  if (dark && doc.theme?.dark) return readableOn(doc.theme.dark.background) === '#ffffff' ? 'dark' : 'light'
  const bg = doc.page?.background && /^#[0-9a-f]{3,8}$/i.test(doc.page.background) ? doc.page.background : doc.theme?.colors?.background
  return typeof bg === 'string' && /^#/.test(bg) && readableOn(bg) === '#ffffff' ? 'dark' : 'light'
}
