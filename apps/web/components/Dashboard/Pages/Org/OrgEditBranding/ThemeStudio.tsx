'use client'
/**
 * Branding → Theme: a short list of essentials (preset, brand color, font,
 * corners, dark mode) beside a small live preview of a learner page. Every
 * other theme option is still here, behind one collapsed "More options"
 * section, so values set there (or by the superadmin editor, Atlas or the
 * API) keep applying. Saving happens from the branding page's save bar.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { ArrowCounterClockwise, CaretDown, Check, Desktop, DeviceMobile, Moon, Sun, Warning } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import {
  DEFAULT_THEME_STATE, FONT_PAIRINGS, NEUTRAL_ACCENT, applyPreset, contrastRatio, deriveAccentTokens, fontStack, matchFontPairing,
  readableTextOn, resolveAccent, resolveHeader, sanitizeHex, themeStatesEqual,
  type OrgThemeState, type ThemeOptions, type ThemePresetKey,
} from '@/lib/theme/orgTheme'
import { extractLogoPalette, usableBrandColor } from '@/lib/theme/logoPalette'
import FontSelector from './FontSelector'
import StudioPreview from './StudioPreview'

type Patch = { color?: string; font?: string; theme?: Partial<ThemeOptions> }

export interface ThemeStudioProps {
  value: OrgThemeState
  onChange: (_next: Patch) => void
  onReplace: (_next: OrgThemeState) => void
  orgName?: string
  logoUrl?: string | null
  disabled?: boolean
}

const S = 'dashboard.organization.branding.studio'
const TH = 'dashboard.organization.branding.theming'

/** The presets offered up front (the rest stay valid if already saved). */
export const FEATURED_PRESETS: ThemePresetKey[] = ['classic', 'ocean', 'forest', 'midnight', 'atelier', 'ember', 'noir', 'glacier']
/** The font pairings in the Font menu. */
export const FEATURED_PAIRINGS = ['default', 'modern', 'technical', 'friendly', 'editorial', 'elegant', 'warm_serif', 'humanist']

/* ── small controls ─────────────────────────────────────────────────────── */

function Segmented<T extends string>({ label, value, options, onChange, testid, disabled }: {
  label: string
  value: T
  options: { key: T; label: string }[]
  onChange: (_v: T) => void
  testid?: string
  disabled?: boolean
}) {
  return (
    <div className="inline-flex flex-wrap rounded-lg bg-neutral-100 p-0.5" role="radiogroup" aria-label={label} data-testid={testid}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          disabled={disabled}
          onClick={() => onChange(o.key)}
          data-value={o.key}
          className={cn(
            'h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors',
            value === o.key ? 'bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.05)]' : 'text-neutral-500 hover:text-neutral-800'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** One labelled line: the label on the start side, the control on the end side. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <span className="text-[13px] font-medium text-neutral-800">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  )
}

/** Swatch + hex field ('' = none when `allowEmpty`). */
function ColorInput({ value, onChange, label, allowEmpty, disabled, placeholder }: {
  value: string
  onChange: (_hex: string) => void
  label: string
  allowEmpty?: boolean
  disabled?: boolean
  placeholder?: string
}) {
  const [text, setText] = React.useState(value)
  const [seen, setSeen] = React.useState(value)
  if (seen !== value) {
    setSeen(value)
    setText(value)
  }
  const commit = (raw: string) => {
    setText(raw)
    if (!raw.trim()) {
      if (allowEmpty) onChange('')
      return
    }
    const hex = sanitizeHex(raw)
    if (hex) onChange(hex)
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <label className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-md ring-1 ring-inset ring-black/10" style={{ background: value || 'repeating-linear-gradient(45deg,#f4f4f5,#f4f4f5 4px,#e4e4e7 4px,#e4e4e7 8px)' }}>
        <input type="color" aria-label={label} value={value || '#ffffff'} disabled={disabled} onChange={(e) => commit(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </label>
      <input
        value={text}
        disabled={disabled}
        onChange={(e) => commit(e.target.value)}
        placeholder={placeholder || '#1d4ed8'}
        aria-label={label}
        dir="ltr"
        className={cn('h-7 w-[88px] rounded-md bg-white px-2 font-mono text-[12px] text-neutral-800 ring-1 ring-inset outline-none focus:ring-neutral-400', text.trim() && !sanitizeHex(text) ? 'ring-rose-300' : 'ring-neutral-200')}
      />
    </span>
  )
}

/** The first thing visitors would struggle to read, if anything. */
export function firstContrastProblem(state: OrgThemeState): string | null {
  const accent = resolveAccent(state) || NEUTRAL_ACCENT
  const tokens = deriveAccentTokens(accent)
  if (contrastRatio(tokens.contrast, tokens.accent) < 4.5) return 'button'
  if (contrastRatio(accent, '#ffffff') < 3) return 'link'
  const header = resolveHeader(state)
  if (header.color && contrastRatio(readableTextOn(header.color), header.color) < 4.5) return 'header'
  return null
}

function PresetChip({ presetKey, active, onPick, disabled }: { presetKey: ThemePresetKey; active: boolean; onPick: () => void; disabled?: boolean }) {
  const { t } = useTranslation()
  const s = applyPreset(presetKey)
  const accent = resolveAccent(s) || NEUTRAL_ACCENT
  const colors = Array.from(new Set([s.color || '#e5e5e5', accent, s.theme.secondary_color].filter(Boolean)))
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-pressed={active}
      data-testid={`studio-preset-${presetKey}`}
      className={cn('flex min-w-0 items-center gap-2 rounded-xl bg-white px-2.5 py-2 text-start transition-colors', active ? 'ring-2 ring-neutral-900' : 'ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300')}
    >
      <span className="flex shrink-0 -space-x-1 rtl:space-x-reverse" aria-hidden>
        {colors.slice(0, 3).map((c, i) => <span key={i} className="h-4 w-4 rounded-full ring-2 ring-white" style={{ backgroundColor: c }} />)}
      </span>
      <span className="min-w-0 truncate text-[12px] font-medium text-neutral-800">{t(`${TH}.presets.${presetKey}`)}</span>
      {active && <Check size={11} weight="bold" className="ms-auto shrink-0 text-neutral-900" />}
    </button>
  )
}

/** Draws the logo and pulls its colors (same-origin or CORS-enabled images). */
async function paletteFromImage(url: string) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('load'))
    img.src = url
  })
  const w = Math.min(160, img.naturalWidth || 160)
  const h = Math.max(1, Math.round(((img.naturalHeight || 160) / (img.naturalWidth || 160)) * w))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(img, 0, 0, w, h)
  return extractLogoPalette(ctx.getImageData(0, 0, w, h).data)
}

/** One stylesheet for the faces the Font menu names (this page only). */
function useStudioFonts() {
  React.useEffect(() => {
    const names = new Set<string>()
    for (const p of FONT_PAIRINGS) if (FEATURED_PAIRINGS.includes(p.key)) [p.heading, p.body].forEach((f) => f && names.add(f))
    if (!names.size || document.getElementById('lh-studio-fonts')) return
    const link = document.createElement('link')
    link.id = 'lh-studio-fonts'
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?${Array.from(names).map((n) => `family=${n.replace(/ /g, '+')}:wght@400;600`).join('&')}&display=swap`
    document.head.appendChild(link)
  }, [])
}

/* ── studio ─────────────────────────────────────────────────────────────── */

export default function ThemeStudio({ value, onChange, onReplace, orgName, logoUrl, disabled }: ThemeStudioProps) {
  const { t } = useTranslation()
  useStudioFonts()
  const th = value.theme
  const [device, setDevice] = React.useState<'desktop' | 'mobile'>('desktop')
  const [scheme, setScheme] = React.useState<'light' | 'dark'>('light')
  const [more, setMore] = React.useState(false)
  const [importing, setImporting] = React.useState(false)
  const pairing = matchFontPairing(value)
  const problem = firstContrastProblem(value)
  const isDefault = themeStatesEqual(value, DEFAULT_THEME_STATE)
  const seg = <K extends keyof ThemeOptions>(key: K, keys: ThemeOptions[K][], prefix: string) => ({
    value: th[key] as ThemeOptions[K] & string,
    options: keys.map((k) => ({ key: k as ThemeOptions[K] & string, label: t(`${prefix}.${k || 'auto'}`) })),
    onChange: (v: string) => onChange({ theme: { [key]: v } as Partial<ThemeOptions> }),
  })
  const pairings = FONT_PAIRINGS.filter((p) => FEATURED_PAIRINGS.includes(p.key))
  const fontValue = pairing && FEATURED_PAIRINGS.includes(pairing.key) ? pairing.key : 'custom'

  const importFromLogo = async () => {
    if (!logoUrl) return
    setImporting(true)
    try {
      const pal = await paletteFromImage(logoUrl)
      if (!pal.primary) {
        toast(t(`${S}.logo.none`))
        return
      }
      onChange({ color: usableBrandColor(pal.primary), theme: { accent_mode: 'brand', secondary_color: pal.secondary || '' } })
      toast.success(t(`${S}.logo.applied`))
    } catch {
      toast.error(t(`${S}.logo.failed`))
    } finally {
      setImporting(false)
    }
  }

  const group = (title: string, children: React.ReactNode) => (
    <div className="flex flex-col pt-6 first:pt-0">
      <p className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{title}</p>
      <div className="divide-y divide-neutral-100">{children}</div>
    </div>
  )

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]" data-testid="theme-studio">
      <div className="flex min-w-0 flex-col gap-4">
        {/* Presets */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-neutral-900">{t(`${S}.presets.title`)}</span>
            <button type="button" onClick={() => onReplace(DEFAULT_THEME_STATE)} disabled={disabled || isDefault} className="inline-flex items-center gap-1 text-[12px] font-medium text-neutral-500 hover:text-neutral-900 disabled:opacity-40" data-testid="studio-reset">
              <ArrowCounterClockwise size={12} /> {t(`${S}.reset`)}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FEATURED_PRESETS.map((k) => <PresetChip key={k} presetKey={k} active={th.preset === k} disabled={disabled} onPick={() => onReplace(applyPreset(k))} />)}
          </div>
        </div>

        {/* Essentials */}
        <div className="rounded-2xl bg-white p-5 nice-shadow">
          <div className="divide-y divide-neutral-100">
            <Row label={t(`${S}.colors.brand`)}>
              {logoUrl && (
                <button type="button" onClick={importFromLogo} disabled={importing || disabled} className="text-[12px] font-medium text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline disabled:opacity-50" data-testid="studio-import-logo">
                  {t(`${S}.logo.import`)}
                </button>
              )}
              <ColorInput value={value.color} onChange={(color) => onChange({ color })} label={t(`${S}.colors.brand`)} allowEmpty disabled={disabled} />
            </Row>
            <Row label={t(`${S}.type.font`)}>
              <select
                value={fontValue}
                disabled={disabled}
                onChange={(e) => {
                  const p = FONT_PAIRINGS.find((x) => x.key === e.target.value)
                  if (p) onChange({ font: p.body, theme: { heading_font: p.heading === p.body ? '' : p.heading } })
                }}
                aria-label={t(`${S}.type.font`)}
                data-testid="studio-font"
                className="h-8 max-w-[240px] rounded-lg bg-white px-2 text-[13px] text-neutral-800 ring-1 ring-inset ring-neutral-200 outline-none focus:ring-neutral-400"
                style={{ fontFamily: fontStack(value.theme.heading_font || value.font) }}
              >
                {pairings.map((p) => (
                  <option key={p.key} value={p.key}>{p.heading ? (p.heading === p.body ? p.heading : `${p.heading} + ${p.body}`) : t(`${S}.type.default_font`)}</option>
                ))}
                {fontValue === 'custom' && <option value="custom">{t(`${S}.type.custom`)}</option>}
              </select>
            </Row>
            <Row label={t(`${S}.shape.radius`)}>
              <Segmented label={t(`${S}.shape.radius`)} testid="studio-radius" disabled={disabled} {...seg('radius', ['sharp', 'soft', 'round'], `${S}.radius`)} />
            </Row>
            <Row label={t(`${S}.dark.title`)}>
              <Segmented label={t(`${S}.dark.title`)} testid="studio-public-scheme" disabled={disabled} {...seg('public_scheme', ['visitor', 'light'], `${S}.scheme`)} />
            </Row>
          </div>
          {problem && (
            <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-800" data-testid="studio-contrast">
              <Warning size={13} weight="fill" className="shrink-0" /> {t(`${S}.contrast.warning`, { what: t(`${S}.contrast.${problem}`) })}
            </p>
          )}
        </div>

        {/* More options */}
        <div className="rounded-2xl bg-white nice-shadow">
          <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more} className="flex w-full items-center justify-between px-5 py-3.5 text-[13px] font-semibold text-neutral-900" data-testid="studio-more">
            {t(`${S}.more`)}
            <CaretDown size={14} className={cn('text-neutral-400 transition-transform', more && 'rotate-180')} />
          </button>
          {more && (
            <div className="border-t border-neutral-100 px-5 pb-5 pt-4" data-testid="studio-more-panel">
              {group(t(`${S}.colors.title`), (
                <>
                  <Row label={t(`${S}.colors.secondary`)}><ColorInput value={th.secondary_color} onChange={(secondary_color) => onChange({ theme: { secondary_color } })} label={t(`${S}.colors.secondary`)} allowEmpty disabled={disabled} /></Row>
                  <Row label={t(`${S}.colors.accent`)}><Segmented label={t(`${S}.colors.accent`)} testid="studio-accent" disabled={disabled} {...seg('accent_mode', ['neutral', 'brand', 'custom'], `${TH}.accent`)} /></Row>
                  {th.accent_mode === 'custom' && (
                    <Row label={t(`${TH}.accent.color`)}><ColorInput value={th.accent_color} onChange={(accent_color) => onChange({ theme: { accent_color } })} label={t(`${TH}.accent.color`)} disabled={disabled} /></Row>
                  )}
                  <Row label={t(`${S}.colors.neutral`)}><Segmented label={t(`${S}.colors.neutral`)} testid="studio-neutral" disabled={disabled} {...seg('neutral', ['neutral', 'warm', 'cool'], `${S}.neutral`)} /></Row>
                  {th.public_scheme === 'visitor' && (
                    <Row label={t(`${S}.dark.accent`)}><ColorInput value={th.dark_accent} onChange={(dark_accent) => onChange({ theme: { dark_accent } })} label={t(`${S}.dark.accent`)} allowEmpty placeholder={t(`${S}.dark.accent_auto`)} disabled={disabled} /></Row>
                  )}
                </>
              ))}
              {group(t(`${S}.type.title`), (
                <>
                  <Row label={t(`${S}.type.heading`)}><div className="w-[220px]"><FontSelector value={th.heading_font} onChange={(heading_font) => onChange({ theme: { heading_font } })} emptyLabel={t(`${S}.type.same_as_body`)} hideSample ariaLabel={t(`${S}.type.heading`)} /></div></Row>
                  <Row label={t(`${S}.type.body`)}><div className="w-[220px]"><FontSelector value={value.font} onChange={(font) => onChange({ font })} hideSample ariaLabel={t(`${S}.type.body`)} /></div></Row>
                  <Row label={t(`${S}.type.scale`)}><Segmented label={t(`${S}.type.scale`)} testid="studio-type-scale" disabled={disabled} {...seg('type_scale', ['compact', 'default', 'large'], `${S}.scale`)} /></Row>
                  <Row label={t(`${S}.type.weight`)}><Segmented label={t(`${S}.type.weight`)} testid="studio-heading-weight" disabled={disabled} {...seg('heading_weight', ['', '500', '600', '700', '800'], `${S}.weight`)} /></Row>
                </>
              ))}
              {group(t(`${S}.shape.title`), (
                <>
                  <Row label={t(`${S}.shape.button_shape`)}><Segmented label={t(`${S}.shape.button_shape`)} testid="studio-button-shape" disabled={disabled} {...seg('button_shape', ['auto', 'square', 'rounded', 'pill'], `${S}.button_shape`)} /></Row>
                  <Row label={t(`${S}.shape.buttons`)}><Segmented label={t(`${S}.shape.buttons`)} testid="studio-buttons" disabled={disabled} {...seg('button_style', ['solid', 'soft', 'outline'], `${TH}.buttons`)} /></Row>
                  <Row label={t(`${S}.shape.cards`)}><Segmented label={t(`${S}.shape.cards`)} testid="studio-cards" disabled={disabled} {...seg('card_style', ['shadow', 'border', 'flat'], `${TH}.cards`)} /></Row>
                  <Row label={t(`${S}.shape.elevation`)}><Segmented label={t(`${S}.shape.elevation`)} testid="studio-elevation" disabled={disabled} {...seg('elevation', ['flat', 'default', 'lifted'], `${S}.elevation`)} /></Row>
                  <Row label={t(`${S}.shape.density`)}><Segmented label={t(`${S}.shape.density`)} testid="studio-density" disabled={disabled} {...seg('density', ['comfortable', 'compact'], `${TH}.density`)} /></Row>
                </>
              ))}
              {group(t(`${S}.layout.title`), (
                <>
                  <Row label={t(`${S}.layout.header_style`)}><Segmented label={t(`${S}.layout.header_style`)} testid="studio-header-style" disabled={disabled} {...seg('header_style', ['brand', 'white', 'dark', 'glass'], `${TH}.header`)} /></Row>
                  <Row label={t(`${S}.layout.header_layout`)}><Segmented label={t(`${S}.layout.header_layout`)} testid="studio-header-layout" disabled={disabled} {...seg('header_layout', ['standard', 'centered', 'minimal'], `${S}.header_layout`)} /></Row>
                  <Row label={t(`${S}.layout.background`)}><Segmented label={t(`${S}.layout.background`)} testid="studio-background" disabled={disabled} {...seg('background', ['tint', 'plain', 'pattern', 'grid', 'gradient'], `${S}.background`)} /></Row>
                  <Row label={t(`${S}.layout.footer`)}><Segmented label={t(`${S}.layout.footer`)} testid="studio-footer" disabled={disabled} {...seg('footer_style', ['simple', 'centered', 'bar'], `${S}.footer`)} /></Row>
                  <Row label={t(`${S}.layout.images`)}><Segmented label={t(`${S}.layout.images`)} testid="studio-images" disabled={disabled} {...seg('image_style', ['default', 'rounded', 'framed', 'muted'], `${S}.images`)} /></Row>
                  <Row label={t(`${S}.layout.links`)}><Segmented label={t(`${S}.layout.links`)} testid="studio-links" disabled={disabled} {...seg('link_style', ['accent', 'underline', 'subtle'], `${S}.links`)} /></Row>
                </>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Preview */}
      <aside className="min-w-0 lg:sticky lg:top-4">
        <div className="overflow-hidden rounded-2xl bg-white nice-shadow">
          <div className="flex items-center gap-1 border-b border-neutral-100 px-3 py-2">
            <span className="me-auto text-[12px] font-semibold text-neutral-700">{t(`${S}.preview.title`)}</span>
            {([['desktop', Desktop], ['mobile', DeviceMobile]] as const).map(([d, Icon]) => (
              <button key={d} type="button" onClick={() => setDevice(d)} aria-pressed={device === d} aria-label={t(`${S}.preview.${d}`)} data-testid={`studio-device-${d}`} className={cn('inline-flex h-7 w-7 items-center justify-center rounded-md', device === d ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-400 hover:text-neutral-700')}>
                <Icon size={14} />
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-neutral-200" aria-hidden />
            {([['light', Sun], ['dark', Moon]] as const).map(([d, Icon]) => (
              <button key={d} type="button" onClick={() => setScheme(d)} aria-pressed={scheme === d} aria-label={t(`${S}.preview.${d}`)} data-testid={`studio-scheme-${d}`} className={cn('inline-flex h-7 w-7 items-center justify-center rounded-md', scheme === d ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-400 hover:text-neutral-700')}>
                <Icon size={14} />
              </button>
            ))}
          </div>
          <div className={cn('bg-neutral-50 p-3', device === 'mobile' && 'flex justify-center')} data-lh-user-content="">
            <div className={cn('overflow-hidden ring-1 ring-black/10', device === 'mobile' ? 'w-[220px] rounded-[20px] ring-[5px] ring-neutral-900' : 'w-full rounded-lg')}>
              <StudioPreview state={value} orgName={orgName} logoUrl={logoUrl} device={device} scheme={scheme} />
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
