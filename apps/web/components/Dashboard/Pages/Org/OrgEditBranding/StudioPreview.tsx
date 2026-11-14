'use client'
/**
 * The theme studio's live preview: a learner home drawn with the real theme
 * machinery (themeRootProps + the lh-t-* markers of styles/theme.css), at
 * desktop or phone width, in the light look or as a visitor in dark mode sees
 * it. Colors here are set explicitly per scheme rather than through the app's
 * dark palette, so both looks can be shown side by side whatever the admin's
 * own dashboard scheme is.
 */
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Play, UserCircle } from '@phosphor-icons/react'
import {
  NEUTRAL_ACCENT, NEUTRAL_PAGE, OrgThemeState, deriveAccentTokens, hexToRgba, mixHex, readableTextOn, resolveAccent, resolveHeader,
  themeFontsHref, themeRootProps,
} from '@/lib/theme/orgTheme'

function usePreviewFonts(href: string | null) {
  useEffect(() => {
    if (!href) return
    const id = 'lh-theme-studio-fonts'
    let link = document.getElementById(id) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    if (link.href !== href) link.href = href
  }, [href])
}

interface Palette {
  page: string
  card: string
  text: string
  muted: string
  hairline: string
  thumb: [string, string]
}

/** The colors a visitor sees, light or dark (mirrors styles/dark.css). */
export function previewPalette(state: OrgThemeState, scheme: 'light' | 'dark'): Palette {
  const t = state.theme
  const forcedLight = t.public_scheme === 'light'
  if (scheme === 'dark' && !forcedLight) {
    return { page: '#0b0b0c', card: '#141416', text: '#ededef', muted: '#a1a1aa', hairline: 'rgb(255 255 255 / 0.08)', thumb: ['#26262b', '#1b1b1f'] }
  }
  const tone = t.neutral !== 'neutral' ? NEUTRAL_PAGE[t.neutral] : null
  return {
    page: '#ffffff',
    card: '#ffffff',
    text: '#171717',
    muted: tone?.muted || '#6b7280',
    hairline: tone?.hairline || 'rgb(0 0 0 / 0.08)',
    thumb: ['#eef0f3', '#f7f7f8'],
  }
}

export default function StudioPreview({
  state,
  orgName,
  logoUrl,
  device = 'desktop',
  scheme = 'light',
}: {
  state: OrgThemeState
  orgName?: string
  logoUrl?: string | null
  device?: 'desktop' | 'mobile'
  scheme?: 'light' | 'dark'
}) {
  const { t } = useTranslation()
  usePreviewFonts(themeFontsHref(state))
  const P = 'dashboard.organization.branding.studio.preview'
  const { style, attrs } = themeRootProps(state)
  const pal = previewPalette(state, scheme)
  const dark = scheme === 'dark' && state.theme.public_scheme !== 'light'
  const header = resolveHeader(state)
  const lightAccent = resolveAccent(state) || NEUTRAL_ACCENT
  const accent = dark ? state.theme.dark_accent || (resolveAccent(state) ? mixHex(lightAccent, '#ffffff', 0.25) : '#ededef') : lightAccent
  const tokens = deriveAccentTokens(accent)
  const secondary = state.theme.secondary_color || mixHex(accent, '#ffffff', 0.45)
  const headerBg = dark ? (header.color ? mixHex(header.color, '#000000', 0.35) : '#121214') : header.color || (header.glass ? 'rgba(255,255,255,0.7)' : '#ffffff')
  const headerText = header.color || dark ? readableTextOn(dark ? '#121214' : header.color) : '#171717'
  const layout = state.theme.header_layout
  const mobile = device === 'mobile'
  const darkVars: Record<string, string> = dark
    ? {
        '--lh-accent': accent,
        '--lh-accent-hover': mixHex(accent, '#ffffff', 0.1),
        '--lh-accent-contrast': readableTextOn(accent),
        '--lh-accent-soft': hexToRgba(accent, 0.18),
        '--lh-accent-soft-hover': hexToRgba(accent, 0.26),
        '--lh-accent-ink': mixHex(accent, '#ffffff', 0.3),
      }
    : {}
  // The page background: the theme's own, over the scheme's base color.
  const rootStyle: React.CSSProperties = {
    ...(style as React.CSSProperties),
    ...darkVars,
    color: pal.text,
    backgroundColor: dark ? pal.page : (style.backgroundColor as string) || pal.page,
    ...(dark ? { backgroundImage: 'none' } : {}),
  }
  const courses = [
    { title: t(`${P}.course_a`), meta: t(`${P}.lessons`, { count: 12 }), pct: 64 },
    { title: t(`${P}.course_b`), meta: t(`${P}.lessons`, { count: 8 }), pct: 20 },
  ]
  const cardStyle: React.CSSProperties = { backgroundColor: pal.card, color: pal.text }
  // Without an accent, dark mode's primary button is light with dark ink (styles/dark.css).
  const btnStyle: React.CSSProperties | undefined = dark && !attrs['data-lh-accent'] ? { backgroundColor: '#ededef', color: '#111113' } : undefined
  return (
    <div className="overflow-hidden" style={{ backgroundColor: pal.page }} aria-hidden data-testid={`studio-preview-${scheme}`}>
      <div className="lh-theme lh-org-font-root" {...attrs} style={rootStyle}>
        {/* header */}
        <div className="flex h-10 items-center gap-3 px-3" style={{ backgroundColor: headerBg, color: headerText, boxShadow: `0 1px 0 ${pal.hairline}`, backdropFilter: header.glass ? 'blur(8px)' : undefined }}>
          <div className={`flex min-w-0 items-center gap-3 ${layout === 'centered' ? 'mx-auto' : ''}`}>
            {logoUrl ? <img src={logoUrl} alt="" className="h-5 w-auto max-w-[80px] object-contain" /> : <span className="truncate text-[12px] font-bold">{orgName || 'Acme Academy'}</span>}
            {!mobile && (
              <span className="flex items-center gap-2.5 text-[10px] font-semibold opacity-80">
                <span>{t(`${P}.nav_courses`)}</span>
                <span>{t(`${P}.nav_paths`)}</span>
              </span>
            )}
          </div>
          <UserCircle size={17} weight="duotone" className={layout === 'centered' ? '' : 'ms-auto'} />
        </div>

        <div className="flex flex-col gap-3 p-3">
          {/* hero */}
          <div className="lh-t-radius flex flex-col gap-2 rounded-2xl p-4" style={{ background: `linear-gradient(135deg, ${hexToRgba(accent, dark ? 0.22 : 0.12)}, ${hexToRgba(secondary, dark ? 0.14 : 0.1)})` }}>
            <h1 className={`${mobile ? 'text-[15px]' : 'text-[18px]'} font-bold leading-tight tracking-tight`}>{t(`${P}.hero`)}</h1>
            <p className="text-[10.5px] leading-relaxed" style={{ color: pal.muted }}>{t(`${P}.hero_text`)}</p>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <span className="lh-t-btn inline-flex h-7 items-center gap-1 rounded-lg bg-neutral-900 px-2.5 text-[10px] font-semibold text-white" style={btnStyle}><Play size={9} weight="fill" /> {t(`${P}.continue`)}</span>
              <span className="lh-t-link text-[10px] font-semibold" style={{ color: tokens.ink }}>{t(`${P}.browse`)}</span>
            </div>
          </div>

          {/* course cards */}
          <div className={`lh-t-grid grid gap-2.5 ${mobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {courses.map((c, i) => (
              <div key={c.title} className="lh-t-card overflow-hidden rounded-2xl nice-shadow" style={{ ...cardStyle, boxShadow: dark ? `0 0 0 1px ${pal.hairline}` : undefined }}>
                <div className="lh-t-thumb relative aspect-video overflow-hidden" style={{ background: i === 0 ? `linear-gradient(135deg, ${accent}, ${secondary})` : `linear-gradient(135deg, ${pal.thumb[0]}, ${pal.thumb[1]})` }}>
                  <img alt="" src={`data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 90'><circle cx='${48 + i * 40}' cy='48' r='22' fill='white' fill-opacity='.35'/><rect x='${82 - i * 30}' y='30' width='50' height='34' rx='6' fill='white' fill-opacity='.25'/></svg>`)}`} className="h-full w-full object-cover" />
                </div>
                <div className="lh-t-card-body flex flex-col gap-1 p-2.5">
                  <span className="text-[9px] font-medium" style={{ color: pal.muted }}><BookOpen size={8} className="me-1 inline" />{c.meta}</span>
                  <p className="lh-t-heading truncate text-[11px] font-semibold">{c.title}</p>
                  <div className="h-1 overflow-hidden rounded-full" style={{ backgroundColor: dark ? 'rgba(255,255,255,0.08)' : '#f1f1f2' }}>
                    <div className="lh-t-progress h-full rounded-full bg-neutral-900" style={{ width: `${c.pct}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
