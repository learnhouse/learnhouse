'use client'
/**
 * The template gallery: large live previews of every designed template,
 * rendered with the organization's own courses and name, with filters by kind
 * of school and by light / dark. Opening one shows it full size (desktop or
 * phone, template palette or the org's brand) with "Use this template".
 *
 * Shared by the Website area and the builder's template picker. Previews
 * mount only when they scroll into view, so the gallery stays light.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Desktop, DeviceMobile, MagnifyingGlass, Moon, Sun, X } from '@phosphor-icons/react'
import { Button } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getTemplatePreview, landingQueryKeys, type LandingTemplate, type TemplatePalette } from '@services/landing/landing'
import { asDoc, type LandingDoc } from '../model/types'
import LandingRenderer from '../render/LandingRenderer'
import { filterTemplates, galleryTemplates } from './filter'

const PREVIEW_WIDTH = 1280

export { filterTemplates, galleryTemplates } from './filter'

function useInView<T extends Element>(rootMargin = '200px'): [React.RefObject<T | null>, boolean] {
  const ref = React.useRef<T>(null)
  const [seen, setSeen] = React.useState(false)
  React.useEffect(() => {
    if (seen || !ref.current) return
    if (typeof IntersectionObserver === 'undefined') {
      const timer = setTimeout(() => setSeen(true), 0)
      return () => clearTimeout(timer)
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true)
        io.disconnect()
      }
    }, { rootMargin })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [seen, rootMargin])
  return [ref, seen]
}

/** A page document drawn at desktop width and scaled into its box. */
export function ScaledPage({ doc, org, orgslug, width = PREVIEW_WIDTH, scale, scheme, className = '', interactive = false }: {
  doc: LandingDoc | null
  org: any
  orgslug: string
  width?: number
  scale: number
  scheme?: 'light' | 'dark'
  className?: string
  interactive?: boolean
}) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {doc ? (
        <div
          className={`absolute start-0 top-0 origin-top-left rtl:origin-top-right ${interactive ? '' : 'pointer-events-none select-none'}`}
          style={{ width, transform: `scale(${scale})` }}
          aria-hidden={!interactive}
        >
          <LandingRenderer doc={doc} mode="thumbnail" orgslug={orgslug} org={org} scheme={scheme} />
        </div>
      ) : (
        <div className="absolute inset-0 animate-pulse bg-neutral-100" />
      )}
    </div>
  )
}

function useTemplateDoc(orgId: number | undefined, id: string | undefined, token: string | undefined, palette: TemplatePalette, enabled = true) {
  return useQuery({
    queryKey: landingQueryKeys.templatePreview(orgId, id, palette),
    queryFn: () => getTemplatePreview(orgId!, id!, token, palette),
    enabled: enabled && !!orgId && !!id && !!token,
    staleTime: 5 * 60_000,
    select: (d) => asDoc(d.doc),
  })
}

function Swatches({ colors }: { colors?: string[] }) {
  if (!colors?.length) return null
  return (
    <span className="flex -space-x-1 rtl:space-x-reverse" aria-hidden>
      {colors.map((c, i) => (
        <span key={i} className="h-4 w-4 rounded-full ring-2 ring-white" style={{ backgroundColor: c }} />
      ))}
    </span>
  )
}

function TemplateCard({ tpl, org, orgslug, token, onOpen }: { tpl: LandingTemplate; org: any; orgslug: string; token?: string; onOpen: () => void }) {
  const { t } = useTranslation()
  const [ref, seen] = useInView<HTMLDivElement>()
  const box = React.useRef<HTMLDivElement>(null)
  const [w, setW] = React.useState(360)
  React.useLayoutEffect(() => {
    if (!box.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  const { data: doc } = useTemplateDoc(org?.id, tpl.id, token, 'template', seen)
  const name = t(`landingBuilder.templates.${tpl.id}.name`, { defaultValue: tpl.name })
  return (
    <div ref={ref} className="group flex flex-col gap-3" data-testid={`gallery-template-${tpl.id}`}>
      <button
        type="button"
        onClick={onOpen}
        className="relative block overflow-hidden rounded-2xl bg-white text-start nice-shadow transition-transform duration-200 ease-lh-out hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        aria-label={t('landingBuilder.gallery.open', { name })}
      >
        <div ref={box} className="w-full" data-lh-user-content="">
          <ScaledPage doc={seen ? doc ?? null : null} org={org} orgslug={orgslug} scale={w / PREVIEW_WIDTH} className="aspect-[16/11] w-full" />
        </div>
        <span className="pointer-events-none absolute inset-x-3 bottom-3 flex translate-y-1 items-center justify-center gap-1.5 rounded-xl bg-neutral-900/90 py-2 text-[13px] font-semibold text-white opacity-0 backdrop-blur transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
          {t('landingBuilder.gallery.preview')} <ArrowRight size={13} weight="bold" className="rtl:rotate-180" />
        </span>
      </button>
      <div className="flex items-start justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-neutral-900">{name}</span>
            {tpl.category && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">{t(`landingBuilder.gallery.categories.${tpl.category}`, { defaultValue: tpl.category })}</span>}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-neutral-500">{t(`landingBuilder.templates.${tpl.id}.description`, { defaultValue: tpl.description })}</p>
        </div>
        <Swatches colors={tpl.palette} />
      </div>
    </div>
  )
}

export interface TemplateGalleryProps {
  templates: LandingTemplate[]
  org: any
  orgslug: string
  token?: string
  /** Use a template: the page decides where it goes (home, a new page). */
  onUse: (_id: string, _palette: TemplatePalette) => void | Promise<void>
  /** Label of the main action in the preview ("Use on the home page"...). */
  useLabel?: string
  busy?: boolean
  compact?: boolean
}

export default function TemplateGallery({ templates, org, orgslug, token, onUse, useLabel, busy, compact }: TemplateGalleryProps) {
  const { t } = useTranslation()
  const list = React.useMemo(() => galleryTemplates(templates), [templates])
  const categories = React.useMemo(() => Array.from(new Set(list.map((x) => x.category).filter(Boolean) as string[])), [list])
  const [category, setCategory] = React.useState('all')
  const [scheme, setScheme] = React.useState('all')
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState<string | null>(null)
  const shown = filterTemplates(list, { category, scheme, query }, (x) => t(`landingBuilder.templates.${x.id}.name`, { defaultValue: x.name }))
  const chip = (on: boolean) =>
    `inline-flex h-8 flex-none items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors ${on ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600 ring-1 ring-inset ring-neutral-200 hover:text-neutral-900'}`
  return (
    <div className="flex flex-col gap-5" data-testid="template-gallery">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" role="radiogroup" aria-label={t('landingBuilder.gallery.filter_kind')}>
          {['all', ...categories].map((c) => (
            <button key={c} type="button" role="radio" aria-checked={category === c} onClick={() => setCategory(c)} className={chip(category === c)} data-testid={`gallery-cat-${c}`}>
              {c === 'all' ? t('landingBuilder.gallery.all') : t(`landingBuilder.gallery.categories.${c}`, { defaultValue: c })}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-full bg-white p-0.5 ring-1 ring-inset ring-neutral-200" role="radiogroup" aria-label={t('landingBuilder.gallery.filter_scheme')}>
            {(['all', 'light', 'dark'] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={scheme === s} onClick={() => setScheme(s)} className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium ${scheme === s ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:text-neutral-900'}`}>
                {s === 'light' ? <Sun size={12} /> : s === 'dark' ? <Moon size={12} /> : null}
                {t(`landingBuilder.gallery.scheme_${s}`)}
              </button>
            ))}
          </div>
          <label className="relative block w-full lg:w-56">
            <MagnifyingGlass size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('landingBuilder.gallery.search')} aria-label={t('landingBuilder.gallery.search')} className="h-8 w-full rounded-full bg-white ps-8 pe-3 text-[13px] text-neutral-900 ring-1 ring-inset ring-neutral-200 outline-none placeholder:text-neutral-400 focus:ring-neutral-400" />
          </label>
        </div>
      </div>
      {shown.length ? (
        <div className={`grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 ${compact ? 'xl:grid-cols-3' : 'xl:grid-cols-3 2xl:grid-cols-4'}`}>
          {shown.map((tpl) => <TemplateCard key={tpl.id} tpl={tpl} org={org} orgslug={orgslug} token={token} onOpen={() => setOpen(tpl.id)} />)}
        </div>
      ) : (
        <p className="rounded-2xl bg-white px-4 py-10 text-center text-[13px] text-neutral-500 nice-shadow">{t('landingBuilder.gallery.no_match')}</p>
      )}
      {open && (
        <TemplatePreview
          tpl={list.find((x) => x.id === open)!}
          org={org}
          orgslug={orgslug}
          token={token}
          busy={busy}
          useLabel={useLabel}
          onClose={() => setOpen(null)}
          onUse={async (palette) => {
            await onUse(open, palette)
            setOpen(null)
          }}
          onStep={(dir) => {
            const i = shown.findIndex((x) => x.id === open)
            const next = shown[(i + dir + shown.length) % shown.length]
            if (next) setOpen(next.id)
          }}
        />
      )}
    </div>
  )
}

/** Full-size preview of one template, with device, palette and dark toggles. */
export function TemplatePreview({ tpl, org, orgslug, token, onClose, onUse, onStep, useLabel, busy }: {
  tpl: LandingTemplate
  org: any
  orgslug: string
  token?: string
  onClose: () => void
  onUse: (_palette: TemplatePalette) => void | Promise<void>
  onStep?: (_dir: 1 | -1) => void
  useLabel?: string
  busy?: boolean
}) {
  const { t } = useTranslation()
  const [device, setDevice] = React.useState<'desktop' | 'mobile'>('desktop')
  const [palette, setPalette] = React.useState<TemplatePalette>('template')
  const [working, setWorking] = React.useState(false)
  const { data: doc } = useTemplateDoc(org?.id, tpl?.id, token, palette)
  const frame = React.useRef<HTMLDivElement>(null)
  const [w, setW] = React.useState(1000)
  React.useLayoutEffect(() => {
    if (!frame.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(frame.current)
    return () => ro.disconnect()
  }, [device])
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (onStep && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !(e.target as HTMLElement)?.closest?.('input,textarea')) onStep(e.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onStep])
  if (!tpl) return null
  const name = t(`landingBuilder.templates.${tpl.id}.name`, { defaultValue: tpl.name })
  const pageWidth = device === 'mobile' ? 390 : PREVIEW_WIDTH
  const scale = Math.min(1, w / pageWidth)
  const use = async () => {
    setWorking(true)
    try {
      await onUse(palette)
    } finally {
      setWorking(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={name} data-testid="template-preview">
      <div className="flex flex-none flex-wrap items-center gap-2 bg-white px-3 py-2 sm:px-4">
        <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100" aria-label={t('landingBuilder.actions.close')}><X size={16} /></button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-neutral-900">{name}</div>
          <div className="hidden truncate text-[12px] text-neutral-500 sm:block">{t(`landingBuilder.templates.${tpl.id}.description`, { defaultValue: tpl.description })}</div>
        </div>
        <div className="flex items-center rounded-lg bg-neutral-100 p-0.5" role="radiogroup" aria-label={t('landingBuilder.gallery.palette')}>
          {(['template', 'org'] as const).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={palette === p} onClick={() => setPalette(p)} data-testid={`palette-${p}`} className={`h-7 rounded-md px-2.5 text-[12px] font-medium ${palette === p ? 'bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-neutral-500 hover:text-neutral-800'}`}>
              {t(`landingBuilder.gallery.palette_${p}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center rounded-lg bg-neutral-100 p-0.5" role="radiogroup" aria-label={t('landingBuilder.breakpoints.label')}>
          {([['desktop', Desktop], ['mobile', DeviceMobile]] as const).map(([d, Icon]) => (
            <button key={d} type="button" role="radio" aria-checked={device === d} onClick={() => setDevice(d)} aria-label={t(`landingBuilder.breakpoints.${d}`)} className={`inline-flex h-7 w-8 items-center justify-center rounded-md ${device === d ? 'bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-neutral-500'}`}>
              <Icon size={15} />
            </button>
          ))}
        </div>
        <Button variant="primary" size="sm" onClick={use} disabled={working || busy} data-testid="use-template">
          {useLabel || t('landingBuilder.gallery.use')} <ArrowRight size={13} className="rtl:rotate-180" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={frame} className={`mx-auto ${device === 'mobile' ? 'max-w-[390px]' : 'max-w-[1280px]'}`} data-lh-user-content="">
          <div className={`overflow-hidden bg-white shadow-2xl ${device === 'mobile' ? 'rounded-[28px] ring-8 ring-neutral-900' : 'rounded-xl'}`} style={{ height: doc ? undefined : 600 }}>
            {doc ? (
              // zoom (not transform) so the scaled page keeps its real height.
              <div style={{ width: pageWidth, zoom: scale } as React.CSSProperties}>
                <LandingRenderer doc={doc} mode="thumbnail" orgslug={orgslug} org={org} />
              </div>
            ) : (
              <div className="h-full animate-pulse bg-neutral-100" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
