'use client'
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Medal, Play } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { getMenuColorClasses } from '@services/utils/ts/colorUtils'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import {
  OrgThemeState,
  NEUTRAL_ACCENT,
  resolveAccent,
  resolveHeader,
  themeFontsHref,
  themeRootProps,
} from '@/lib/theme/orgTheme'

/** Loads the draft's font pair once per change, for the preview only. */
function usePreviewFonts(href: string | null) {
  useEffect(() => {
    if (!href) return
    const id = 'lh-theme-preview-fonts'
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

/**
 * A miniature learner page drawn with the real theme machinery: the same
 * tokens, data attributes and marker classes as the org layout, so what the
 * admin sees here is what styles/theme.css will do on the live pages.
 */
export default function ThemePreview({
  state,
  orgName,
  logoUrl,
}: {
  state: OrgThemeState
  orgName?: string
  logoUrl?: string | null
}) {
  const { t } = useTranslation()
  const { style, attrs } = themeRootProps(state)
  const header = resolveHeader(state)
  const colors = getMenuColorClasses(header.color)
  const accent = resolveAccent(state) || NEUTRAL_ACCENT
  usePreviewFonts(themeFontsHref(state))

  const courses = [
    { title: t('dashboard.organization.branding.theming.preview.course_a', 'Design foundations'), pct: 64 },
    { title: t('dashboard.organization.branding.theming.preview.course_b', 'Writing for the web'), pct: 20 },
  ]

  return (
    <div className="overflow-hidden rounded-xl bg-white ring-1 ring-black/10 shadow-sm" aria-hidden>
      <div className="lh-theme lh-org-font-root text-neutral-900" {...attrs} style={style as React.CSSProperties}>
        {/* Header */}
        <div
          className={cn(
            'flex h-10 items-center justify-between gap-2 px-3',
            !header.color && (header.glass ? 'bg-white/55 border-b border-black/5 backdrop-blur' : 'bg-white nice-shadow')
          )}
          style={header.color ? { backgroundColor: header.color } : undefined}
        >
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-5 w-auto max-w-[84px] rounded-sm object-contain" />
            ) : (
              <span className={cn('truncate text-xs font-bold', colors.text)}>{orgName || 'Acme'}</span>
            )}
            <span className={cn('hidden text-[10px] font-semibold sm:inline', colors.text)}>
              {t('dashboard.organization.branding.theming.preview.courses', 'Courses')}
            </span>
          </div>
          <span className={cn('rounded-md px-2 py-1 text-[10px] font-bold', colors.signUpBtn)}>
            {t('dashboard.organization.branding.theming.preview.sign_up', 'Sign up')}
          </span>
        </div>

        <div className="space-y-3 p-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-bold tracking-tight">{t('dashboard.organization.branding.theming.preview.title', 'Courses')}</h3>
            <span className="lh-t-link text-[10px] font-semibold text-neutral-500">
              {t('dashboard.organization.branding.theming.preview.view_all', 'View all')}
            </span>
          </div>

          {/* Course cards */}
          <div className="lh-t-grid grid grid-cols-2 gap-3">
            {courses.map((c, i) => (
              <div key={c.title} className="lh-t-card overflow-hidden rounded-2xl bg-white nice-shadow">
                <div
                  className="aspect-video"
                  style={{
                    background:
                      i === 0
                        ? `linear-gradient(135deg, ${accent}, ${accent}66)`
                        : `linear-gradient(135deg, #e5e7eb, #f5f5f5)`,
                  }}
                />
                <div className="lh-t-card-body space-y-1.5 p-2.5">
                  <p className="lh-t-heading truncate text-[11px] font-semibold">{c.title}</p>
                  <div className="h-1 overflow-hidden rounded-full bg-neutral-100">
                    <div className="lh-t-progress h-full rounded-full bg-teal-500" style={{ width: `${c.pct}%` }} />
                  </div>
                  <span className="text-[9px] text-neutral-400">{c.pct}%</span>
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={buttonClass('primary', 'sm', 'pointer-events-none')}>
              <Play size={10} weight="fill" />
              {t('dashboard.organization.branding.theming.preview.continue', 'Continue')}
            </span>
            <span className={buttonClass('secondary', 'sm', 'pointer-events-none')}>
              {t('dashboard.organization.branding.theming.preview.details', 'Details')}
            </span>
            <span className="lh-t-chip inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600 ring-1 ring-inset ring-neutral-200">
              {t('dashboard.organization.branding.theming.preview.new', 'New')}
            </span>
          </div>

          {/* Completion + certificate accent */}
          <div className="lh-t-radius flex items-center gap-3 rounded-2xl bg-white p-2.5 nice-shadow">
            <span className="lh-t-tile grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-100">
              <Medal size={16} weight="fill" className="lh-t-accent text-emerald-600" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="lh-t-heading truncate text-[11px] font-semibold">
                {t('dashboard.organization.branding.theming.preview.completed', 'Course completed')}
              </p>
              <p className="text-[9px] text-neutral-500">{t('dashboard.organization.branding.theming.preview.certificate', 'Certificate ready')}</p>
            </div>
            <div className="relative h-8 w-11 shrink-0 bg-white ring-1 ring-black/5" style={{ outline: `1.5px solid ${accent}`, outlineOffset: -4 }}>
              <span className="absolute inset-x-2 top-3 h-px" style={{ backgroundColor: accent }} />
            </div>
            <ArrowRight size={12} className="lh-t-accent shrink-0 text-neutral-400 rtl:rotate-180" />
          </div>
        </div>
      </div>
    </div>
  )
}
