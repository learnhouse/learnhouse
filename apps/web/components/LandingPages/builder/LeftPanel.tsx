'use client'
/** The left panel: the library (sections and elements) and the layers tree. */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { CaretDown, CaretRight, DotsSixVertical, EyeSlash, FilmStrip, Lock, MagnifyingGlass, Trash, UserCircle } from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import type { LandingDoc, LandingNode, LandingTheme } from '../model/types'
import { CONTAINER_TYPES } from '../model/types'
import { reid } from '../model/tree'
import { labelOf } from '../model/diff'
import LandingRenderer from '../render/LandingRenderer'
import { deleteSavedSection, getSavedSections, getTemplateSections, landingQueryKeys, type LandingLibrarySection, type LandingTemplate } from '@services/landing/landing'
import { CATALOG, GROUPS, iconFor, type CatalogEntry } from './catalog'
import { DRAG_MIME, dragState, type DragPayload } from './Canvas'
import { FIELD } from './controls'

interface LeftPanelProps {
  doc: LandingDoc
  sections: LandingLibrarySection[]
  selectedId: string | null
  customCode: boolean
  orgslug: string
  org: any
  onInsert: (node: LandingNode) => void
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  onMove: (id: string, parentId: string | null, index: number) => void
  onInsertSymbol: (symbolId: string) => void
  /** Insert a saved section, with the reusable components it uses. */
  onInsertSaved?: (node: LandingNode, symbols: Record<string, { name: string; node: LandingNode }>) => void
  /** Designed templates, for the "Designed" sections tab. */
  templates?: LandingTemplate[]
}

function startDrag(e: React.DragEvent, payload: DragPayload) {
  dragState.payload = payload
  e.dataTransfer.effectAllowed = payload.kind === 'move' ? 'move' : 'copy'
  try {
    e.dataTransfer.setData(DRAG_MIME, payload.kind)
    e.dataTransfer.setData('text/plain', payload.kind)
  } catch {
    /* Safari may refuse custom types; dragState carries the payload. */
  }
}

/** A tiny live preview of a library section. */
const Thumb = React.memo(function Thumb({ node, orgslug, org, theme, symbols }: { node: LandingNode; orgslug: string; org: any; theme?: LandingTheme; symbols?: LandingDoc['symbols'] }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [visible, setVisible] = React.useState(false)
  const [scale, setScale] = React.useState(0.2)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setVisible(true)
        io.disconnect()
      }
    }, { rootMargin: '200px' })
    io.observe(el)
    // The preview is a 1200px-wide page scaled to the card's width.
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1200 || 0.2))
    ro.observe(el)
    return () => {
      io.disconnect()
      ro.disconnect()
    }
  }, [])
  const doc = React.useMemo(() => ({ schema: 'lh.page' as const, version: 1, theme: theme || { colors: { primary: 'brand', secondary: '#0f172a', accent: '#f59e0b', background: '#ffffff', surface: '#f8fafc', text: '#0f172a', muted: '#64748b', border: '#e2e8f0' }, fonts: { heading: 'brand', body: 'brand' }, radius: 'lg' as const, buttonStyle: 'solid' as const, width: 'normal' as const, density: 'comfortable' as const, headingWeight: '700' as const }, page: {}, symbols: symbols || {}, root: [node] }), [node, theme, symbols])
  return (
    <div ref={ref} className="relative overflow-hidden rounded-lg bg-white ring-1 ring-inset ring-neutral-200" style={{ height: Math.round(460 * scale) }}>
      {visible && (
        <div className="pointer-events-none absolute start-0 top-0 origin-top-left rtl:origin-top-right" style={{ width: 1200, transform: `scale(${scale})` }}>
          <LandingRenderer doc={doc} mode="thumbnail" orgslug={orgslug} org={org} />
        </div>
      )}
    </div>
  )
})

/** Sections of the designed templates, one template at a time. */
function DesignedSections({ props, query }: { props: LeftPanelProps; query: string }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const list = (props.templates || []).filter((x) => !x.legacy && x.category && x.category !== 'simple')
  const [id, setId] = React.useState('')
  const current = id || list[0]?.id || ''
  const { data } = useQuery({ queryKey: landingQueryKeys.templateSections(current), queryFn: () => getTemplateSections(current, token), enabled: !!current && !!token, staleTime: 10 * 60_000 })
  const sections = (data?.sections || []).filter((s) => !query || s.name.toLowerCase().includes(query))
  return (
    <div className="flex flex-col gap-3">
      <select className={FIELD} value={current} onChange={(e) => setId(e.target.value)} aria-label={t('landingBuilder.library.designed_from')} data-testid="designed-template">
        {list.map((x) => <option key={x.id} value={x.id}>{t(`landingBuilder.templates.${x.id}.name`, { defaultValue: x.name })}</option>)}
      </select>
      <p className="text-[12px] text-neutral-500">{t('landingBuilder.library.designed_hint')}</p>
      {!data && <div className="h-28 animate-pulse rounded-xl bg-neutral-100" />}
      {sections.map((s, i) => (
        <div
          key={`${current}-${i}`}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), props.onInsert(reid(s.node)))}
          draggable
          onDragStart={(e) => startDrag(e, { kind: 'new', node: reid(s.node) })}
          onDragEnd={() => (dragState.payload = null)}
          onClick={() => props.onInsert(reid(s.node))}
          className="group flex cursor-pointer flex-col gap-1.5 rounded-xl p-1.5 text-start hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-sky-500"
          data-testid={`designed-section-${i}`}
        >
          <Thumb node={s.node} orgslug={props.orgslug} org={props.org} theme={data?.theme as LandingTheme} />
          <span className="px-0.5 text-[12px] font-medium text-neutral-700">{s.name}</span>
        </div>
      ))}
    </div>
  )
}

/** Sections saved from any page of this organization. */
function SavedSections({ props, query }: { props: LeftPanelProps; query: string }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const orgId = props.org?.id
  const { data, isLoading } = useQuery({ queryKey: landingQueryKeys.saved(orgId), queryFn: () => getSavedSections(orgId, token), enabled: !!orgId && !!token })
  const list = (data || []).filter((s) => !query || s.name.toLowerCase().includes(query))
  if (isLoading) return <div className="h-28 animate-pulse rounded-xl bg-neutral-100" />
  if (!list.length) return <p className="rounded-xl bg-neutral-50 px-3 py-6 text-center text-[12px] leading-relaxed text-neutral-500" data-testid="saved-empty">{t('landingBuilder.library.saved_empty')}</p>
  return (
    <div className="flex flex-col gap-3">
      {list.map((s) => {
        const insert = () => (props.onInsertSaved ? props.onInsertSaved(s.node, s.symbols || {}) : props.onInsert(reid(s.node)))
        return (
          <div key={s.section_uuid} className="group relative flex flex-col gap-1.5 rounded-xl p-1.5 hover:bg-neutral-50" data-testid={`saved-section-${s.name}`}>
            <div role="button" tabIndex={0} onClick={insert} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), insert())} className="cursor-pointer">
              <Thumb node={s.node} orgslug={props.orgslug} org={props.org} theme={props.doc.theme} symbols={s.symbols as LandingDoc['symbols']} />
            </div>
            <div className="flex items-center gap-1 px-0.5">
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-neutral-700">{s.name}</span>
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 opacity-0 hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={t('landingBuilder.library.saved_delete', { name: s.name })}
                onClick={async () => {
                  try {
                    await deleteSavedSection(orgId, s.section_uuid, token)
                    queryClient.invalidateQueries({ queryKey: landingQueryKeys.saved(orgId) })
                  } catch {
                    toast.error(t('landingBuilder.toasts.load_failed'))
                  }
                }}
              >
                <Trash size={12} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Library({ props }: { props: LeftPanelProps }) {
  const { t } = useTranslation()
  const [tab, setTab] = React.useState<'sections' | 'designed' | 'saved' | 'elements'>('sections')
  const [q, setQ] = React.useState('')
  const query = q.trim().toLowerCase()
  const entries = CATALOG.filter((e) => !query || t(`landingBuilder.catalog.${e.key}`).toLowerCase().includes(query))
  const sections = props.sections.filter((s) => !query || t(`landingBuilder.sections.${s.kind}`).toLowerCase().includes(query) || s.kind.includes(query))
  const add = (e: CatalogEntry) => props.onInsert(e.make(t))
  return (
    <div className="flex h-full flex-col">
      <div className="flex-none space-y-2.5 border-b border-neutral-100 p-3">
        <div className="relative">
          <MagnifyingGlass size={14} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input className={`${FIELD} ps-8`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('landingBuilder.library.search')} aria-label={t('landingBuilder.library.search')} />
        </div>
        <div className="flex rounded-lg bg-neutral-100 p-0.5">
          {(['sections', 'designed', 'saved', 'elements'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k} data-testid={`library-tab-${k}`} className={`h-7 min-w-0 flex-1 truncate rounded-md px-1 text-[11.5px] font-medium ${tab === k ? 'bg-white text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.05)]' : 'text-neutral-500 hover:text-neutral-800'}`}>
              {t(`landingBuilder.library.${k}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'designed' ? (
          <DesignedSections props={props} query={query} />
        ) : tab === 'saved' ? (
          <SavedSections props={props} query={query} />
        ) : tab === 'sections' ? (
          <div className="flex flex-col gap-3">
            <p className="text-[12px] text-neutral-500">{t('landingBuilder.library.sections_hint')}</p>
            {sections.map((s, i) => (
              <div
                key={`${s.kind}-${s.variant}-${i}`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), props.onInsert(reid(s.node)))}
                draggable
                onDragStart={(e) => startDrag(e, { kind: 'new', node: reid(s.node) })}
                onDragEnd={() => (dragState.payload = null)}
                onClick={() => props.onInsert(reid(s.node))}
                className="group flex cursor-pointer flex-col gap-1.5 rounded-xl p-1.5 text-start hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-sky-500"
                data-testid={`library-section-${s.kind}${s.variant ? `-${s.variant}` : ''}`}
              >
                <Thumb node={s.node} orgslug={props.orgslug} org={props.org} />
                <span className="px-0.5 text-[12px] font-medium text-neutral-700">
                  {t(`landingBuilder.sections.${s.kind}`)}
                  {s.variant && <span className="text-neutral-400"> · {t(`landingBuilder.variants.${s.variant.replace('-', '_')}`)}</span>}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {GROUPS.map((g) => {
              const list = entries.filter((e) => e.group === g)
              if (!list.length) return null
              return (
                <div key={g}>
                  <div className="mb-2 text-[11px] font-medium text-neutral-400">{t(`landingBuilder.groups.${g}`)}</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {list.map((e) => {
                      const locked = e.plan === 'pro' && !props.customCode
                      return (
                        <button
                          key={e.key}
                          type="button"
                          draggable={!locked}
                          disabled={locked}
                          onDragStart={(ev) => startDrag(ev, { kind: 'new', node: e.make(t) })}
                          onDragEnd={() => (dragState.payload = null)}
                          onClick={() => add(e)}
                          title={locked ? t('landingBuilder.library.pro_only') : t(`landingBuilder.catalog.${e.key}`)}
                          className="relative flex flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 text-center hover:bg-neutral-50 disabled:opacity-50"
                          data-testid={`library-element-${e.key}`}
                        >
                          <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${e.tone}`}><e.icon size={16} weight="duotone" /></span>
                          <span className="text-[11px] leading-tight text-neutral-700">{t(`landingBuilder.catalog.${e.key}`)}</span>
                          {locked && <Lock size={11} className="absolute end-1.5 top-1.5 text-neutral-400" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Layers({ props }: { props: LeftPanelProps }) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const [over, setOver] = React.useState<{ id: string; where: 'before' | 'after' | 'inside' } | null>(null)
  const symbols = Object.entries(props.doc.symbols || {})

  const drop = (target: LandingNode, parentId: string | null, index: number, where: 'before' | 'after' | 'inside') => {
    const payload = dragState.payload
    dragState.payload = null
    setOver(null)
    if (!payload || payload.kind !== 'move' || payload.id === target.id) return
    if (where === 'inside') props.onMove(payload.id, target.id, (target.children || []).length)
    else props.onMove(payload.id, parentId, where === 'before' ? index : index + 1)
  }

  const row = (node: LandingNode, depth: number, parentId: string | null, index: number): React.ReactNode => {
    const kids = node.children || []
    const isOpen = !collapsed.has(node.id)
    const Icon = iconFor(node.type)
    const selected = props.selectedId === node.id
    const flags = node.hidden && (node.hidden.desktop || node.hidden.tablet || node.hidden.mobile)
    return (
      <React.Fragment key={node.id}>
        <div
          className={`group relative flex h-8 items-center gap-1 rounded-md pe-1.5 text-[12px] ${selected ? 'bg-sky-50 text-sky-900' : 'text-neutral-700 hover:bg-neutral-50'}`}
          style={{ paddingInlineStart: 4 + depth * 14 }}
          draggable
          onDragStart={(e) => startDrag(e, { kind: 'move', id: node.id })}
          onDragEnd={() => {
            dragState.payload = null
            setOver(null)
          }}
          onDragOver={(e) => {
            if (dragState.payload?.kind !== 'move') return
            e.preventDefault()
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const y = (e.clientY - r.top) / r.height
            const where = CONTAINER_TYPES.has(node.type) && y > 0.3 && y < 0.7 ? 'inside' : y < 0.5 ? 'before' : 'after'
            setOver({ id: node.id, where })
          }}
          onDragLeave={() => setOver((o) => (o?.id === node.id ? null : o))}
          onDrop={(e) => {
            e.preventDefault()
            drop(node, parentId, index, over?.id === node.id ? over.where : 'after')
          }}
          onMouseEnter={() => props.onHover(node.id)}
          onMouseLeave={() => props.onHover(null)}
          data-testid={`layer-${node.id}`}
        >
          {over?.id === node.id && over.where !== 'inside' && <span className={`absolute inset-x-1 h-0.5 rounded bg-sky-500 ${over.where === 'before' ? 'top-0' : 'bottom-0'}`} />}
          {over?.id === node.id && over.where === 'inside' && <span className="absolute inset-0 rounded-md ring-2 ring-inset ring-sky-400" />}
          <button type="button" className={`inline-flex h-5 w-5 items-center justify-center text-neutral-400 ${kids.length ? '' : 'invisible'}`} onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(node.id)) n.delete(node.id); else n.add(node.id); return n })} aria-label={isOpen ? t('landingBuilder.layers.collapse') : t('landingBuilder.layers.expand')}>
            {isOpen ? <CaretDown size={11} /> : <CaretRight size={11} className="rtl:rotate-180" />}
          </button>
          <button type="button" onClick={() => props.onSelect(node.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-start">
            <Icon size={13} className={node.type === 'symbol' ? 'text-violet-500' : 'text-neutral-400'} />
            <span className="truncate">{node.type === 'symbol' ? props.doc.symbols?.[node.props?.symbolId]?.name || t('landingBuilder.elements.symbol') : node.name || (['section', 'container', 'columns'].includes(node.type) ? t(`landingBuilder.elements.${node.type}`) : labelOf(node) === node.type ? t(`landingBuilder.elements.${node.type}`) : labelOf(node))}</span>
          </button>
          {node.visibility && node.visibility !== 'everyone' && <UserCircle size={12} className="text-neutral-400" />}
          {flags && <EyeSlash size={12} className="text-neutral-400" />}
          <DotsSixVertical size={12} className="text-neutral-300 opacity-0 group-hover:opacity-100" />
        </div>
        {isOpen && kids.map((c, i) => row(c, depth + 1, node.id, i))}
      </React.Fragment>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-2" data-testid="layers-tree">
        {props.doc.root.length === 0 && <p className="p-3 text-[12px] text-neutral-500">{t('landingBuilder.layers.empty')}</p>}
        {props.doc.root.map((n, i) => row(n, 0, null, i))}
      </div>
      {symbols.length > 0 && (
        <div className="flex-none border-t border-neutral-100 p-3">
          <div className="mb-2 text-[11px] font-medium text-neutral-400">{t('landingBuilder.layers.components')}</div>
          <div className="flex flex-col gap-1">
            {symbols.map(([sid, sym]) => (
              <button key={sid} type="button" onClick={() => props.onInsertSymbol(sid)} className="flex h-8 items-center gap-2 rounded-md px-2 text-start text-[12px] text-neutral-700 hover:bg-neutral-50" title={t('landingBuilder.layers.insert_component')}>
                <FilmStrip size={13} className="text-violet-500" />
                <span className="truncate flex-1">{sym.name}</span>
                <span className="text-[11px] text-neutral-400">{t('landingBuilder.layers.insert')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function LeftPanel(props: LeftPanelProps & { tab: 'add' | 'layers' }) {
  return props.tab === 'add' ? <Library props={props} /> : <Layers props={props} />
}
