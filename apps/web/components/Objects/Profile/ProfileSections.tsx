'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Buildings, X } from '@phosphor-icons/react'
import {
  detailHref,
  displayUrl,
  formatProfileDate,
  linkKind,
  safeImageUrl,
  safeUrl,
  visibleDetails,
  type DetailItem,
  type ProfileSection,
} from '@/lib/profile/profile'
import { DetailIcon, LinkKindIcon, SECTION_META } from './profileIcons'
import RichText from './RichText'

/** The section's own title, else the type's name. */
export function useSectionTitle() {
  const { t } = useTranslation()
  return (s: ProfileSection) => s.title?.trim() || t(SECTION_META[s.type].labelKey, { defaultValue: SECTION_META[s.type].label })
}

/** The white card every profile block sits in. */
export function ProfileCard({
  title,
  icon,
  action,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: React.ReactNode
  icon?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={`bg-white rounded-2xl nice-shadow p-5 min-w-0 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="flex items-center gap-2 min-w-0 text-[15px] font-semibold text-neutral-900 leading-tight" dir="auto">
            {icon && <span className="shrink-0 text-neutral-400 [&>svg]:size-[18px]">{icon}</span>}
            <span className="truncate">{title}</span>
          </h2>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

export function DetailsList({ details }: { details: DetailItem[] }) {
  const rows = visibleDetails(details)
  return (
    <ul className="space-y-3">
      {rows.map((d) => {
        const href = detailHref(d)
        return (
          <li key={d.id} className="flex items-start gap-3 min-w-0">
            <span className="mt-0.5 w-8 h-8 shrink-0 rounded-lg bg-neutral-100 text-neutral-500 flex items-center justify-center">
              <DetailIcon name={d.icon} size={16} />
            </span>
            <div className="min-w-0">
              {d.label && <p className="text-[11px] font-medium text-neutral-400 leading-tight" dir="auto">{d.label}</p>}
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  className="lh-t-link block truncate text-sm font-medium text-neutral-800 hover:underline underline-offset-2"
                  dir="auto"
                >
                  {displayUrl(href)}
                </a>
              ) : (
                <p className="text-sm font-medium text-neutral-800 break-words" dir="auto">{d.text}</p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function LinksList({ section }: { section: ProfileSection }) {
  const links = (section.links ?? []).map((l) => ({ ...l, href: safeUrl(l.url) })).filter((l) => l.href) as { title: string; href: string }[]
  return (
    <ul className="space-y-1 -mx-2">
      {links.map((l, i) => {
        const kind = linkKind(l.href)
        return (
          <li key={i}>
            <a
              href={l.href}
              target={kind === 'mail' ? undefined : '_blank'}
              rel="noopener noreferrer nofollow ugc"
              className="group flex items-center gap-3 min-w-0 rounded-xl px-2 py-1.5 hover:bg-neutral-50 transition-colors"
            >
              <span className="w-8 h-8 shrink-0 rounded-lg bg-neutral-100 text-neutral-600 group-hover:text-neutral-900 flex items-center justify-center">
                <LinkKindIcon kind={kind} size={16} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-neutral-800" dir="auto">{l.title || displayUrl(l.href)}</span>
                {l.title && <span className="block truncate text-xs text-neutral-400" dir="ltr">{displayUrl(l.href)}</span>}
              </span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

export function SkillsList({ section }: { section: ProfileSection }) {
  const { t } = useTranslation()
  const skills = (section.skills ?? []).filter((k) => k.name.trim())
  const groups = new Map<string, typeof skills>()
  for (const k of skills) {
    const key = k.category?.trim() || ''
    groups.set(key, [...(groups.get(key) ?? []), k])
  }
  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([category, items]) => (
        <div key={category || '_'}>
          {category && <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2" dir="auto">{category}</p>}
          <ul className="flex flex-wrap gap-1.5">
            {items.map((k, i) => (
              <li
                key={i}
                className="inline-flex items-center gap-1.5 max-w-full rounded-full bg-neutral-100 px-2.5 h-7 text-[13px] font-medium text-neutral-700"
                title={k.level ? t(`user.settings.profile_builder.editors.skills.levels.${k.level}`) : undefined}
              >
                <span className="truncate" dir="auto">{k.name}</span>
                {k.level && (
                  <span className="text-[11px] font-semibold text-neutral-400">
                    {t(`user.settings.profile_builder.editors.skills.levels.${k.level}`)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

type TimelineItem = { heading: string; sub: string; start: string; end?: string; current: boolean; description?: string }

export function Timeline({ items }: { items: TimelineItem[] }) {
  const { t, i18n } = useTranslation()
  return (
    <ol className="relative space-y-5 border-s border-neutral-200 ms-1.5">
      {items.map((it, i) => {
        const start = formatProfileDate(it.start, i18n.language)
        const end = it.current ? t('common.present') : formatProfileDate(it.end, i18n.language)
        const range = [start, end].filter(Boolean).join(' – ')
        return (
          <li key={i} className="relative ps-5">
            <span
              aria-hidden="true"
              className={`absolute -start-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-white ${it.current ? 'bg-lh-accent' : 'bg-neutral-300'}`}
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <h3 className="text-sm font-semibold text-neutral-900 min-w-0 break-words" dir="auto">{it.heading || it.sub}</h3>
              {range && <span className="text-xs font-medium text-neutral-400 tabular-nums whitespace-nowrap">{range}</span>}
            </div>
            {it.heading && it.sub && <p className="text-sm text-neutral-600 break-words" dir="auto">{it.sub}</p>}
            {it.description && <p className="mt-1.5 text-sm text-neutral-500 leading-relaxed whitespace-pre-line break-words" dir="auto">{it.description}</p>}
          </li>
        )
      })}
    </ol>
  )
}

export function ExperienceTimeline({ section }: { section: ProfileSection }) {
  const items = (section.experiences ?? [])
    .filter((e) => e.title.trim() || e.organization.trim())
    .map((e) => ({ heading: e.title, sub: e.organization, start: e.startDate, end: e.endDate, current: e.current, description: e.description }))
  return <Timeline items={items} />
}

export function EducationTimeline({ section }: { section: ProfileSection }) {
  const { t } = useTranslation()
  const items = (section.education ?? [])
    .filter((e) => e.institution.trim() || e.degree.trim())
    .map((e) => ({
      heading: e.institution,
      sub: [e.degree, e.field].filter((x) => x?.trim()).join(e.degree && e.field ? ` ${t('user.profile.in', { defaultValue: 'in' })} ` : ''),
      start: e.startDate,
      end: e.endDate,
      current: e.current,
      description: e.description,
    }))
  return <Timeline items={items} />
}

export function AffiliationList({ section }: { section: ProfileSection }) {
  const items = (section.affiliations ?? []).filter((a) => a.name.trim())
  return (
    <ul className="space-y-3">
      {items.map((a, i) => {
        const logo = safeImageUrl(a.logoUrl)
        return (
          <li key={i} className="flex items-start gap-3 min-w-0">
            <span className="w-10 h-10 shrink-0 rounded-xl bg-white ring-1 ring-neutral-200 overflow-hidden flex items-center justify-center text-neutral-400">
              {logo ? <img src={logo} alt="" className="w-full h-full object-contain p-1" loading="lazy" referrerPolicy="no-referrer" /> : <Buildings size={18} />}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-900 break-words" dir="auto">{a.name}</p>
              {a.description && <p className="text-xs text-neutral-500 leading-relaxed break-words" dir="auto">{a.description}</p>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function Gallery({ section }: { section: ProfileSection }) {
  const { t } = useTranslation()
  const images = (section.images ?? []).map((m) => ({ ...m, src: safeImageUrl(m.url) })).filter((m) => m.src) as { src: string; caption?: string }[]
  const [open, setOpen] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (open === null) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  const current = open !== null ? images[open] : null
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {images.map((m, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setOpen(i)}
            className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20"
            aria-label={m.caption || t('user.profile.open_image', { defaultValue: 'Open image' })}
          >
            <img src={m.src} alt={m.caption || ''} loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
            {m.caption && (
              <span className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-start text-[11px] font-medium text-white truncate opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" dir="auto">
                {m.caption}
              </span>
            )}
          </button>
        ))}
      </div>
      {current && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={current.caption || t('user.profile.open_image', { defaultValue: 'Open image' })}
          className="fixed inset-0 z-modal bg-black/80 flex items-center justify-center p-4"
          onClick={() => setOpen(null)}
        >
          <button
            type="button"
            autoFocus
            onClick={() => setOpen(null)}
            className="absolute top-4 end-4 w-9 h-9 rounded-full bg-white/10 text-white hover:bg-white/20 flex items-center justify-center"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <X size={18} />
          </button>
          <figure className="max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
            <img src={current.src} alt={current.caption || ''} referrerPolicy="no-referrer" className="w-full max-h-[80vh] object-contain rounded-xl" />
            {current.caption && <figcaption className="mt-3 text-center text-sm text-white/90" dir="auto">{current.caption}</figcaption>}
          </figure>
        </div>
      )}
    </>
  )
}

export function TextBlock({ section }: { section: ProfileSection }) {
  return <RichText value={section.content} />
}
