'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { createSavedView, deleteSavedView, errorMessage, isNotAvailable, listSavedViews } from '@services/ee/platform/api'
import { BookmarkSimple, CaretLeft, Check, FunnelSimple, MagnifyingGlass, Plus, Trash, X } from '@phosphor-icons/react'
import { Button, INPUT, SearchInput } from '@/design'
import { shouldRetry, useAccessToken, useDebounced } from '@components/Admin/hooks'

// The console's one filter pattern: a search box, "Filter" to add typed
// filters, removable chips for every active one, and saved views. State
// lives in the URL (the parent owns it through useUrlFilters), so a filtered
// list is a shareable link. Facet counts show next to the options.

export interface FilterOption {
  value: string
  label: string
  count?: number
}

interface BaseDef {
  key: string
  label: string
  icon?: React.ReactNode
  hidden?: boolean
}

export type FilterDef =
  | (BaseDef & { kind: 'select'; options: FilterOption[] })
  | (BaseDef & { kind: 'text'; placeholder?: string })
  | (BaseDef & { kind: 'boolean'; trueLabel?: string; falseLabel?: string; counts?: { true?: number; false?: number } })
  | (BaseDef & { kind: 'number'; placeholder?: string; suffix?: string; min?: number; max?: number })
  | (BaseDef & { kind: 'range'; minKey: string; maxKey: string; suffix?: string })
  | (BaseDef & { kind: 'date'; sinceKey: string; untilKey: string })
  | (BaseDef & {
      kind: 'async'
      /** Shown before the member types (e.g. top facets). */
      options?: FilterOption[]
      load: (q: string) => Promise<FilterOption[]>
      /** Label for a value that is in the URL but not in the loaded options. */
      describe?: (value: string) => string
      placeholder?: string
    })

export type FilterValues = Record<string, string | undefined>

export const DATE_PRESETS = ['24h', '7d', '30d', '90d', '365d'] as const

/** `7d`/`24h` presets become an ISO timestamp; dates and ISO strings pass through. */
export function resolveDate(v: string | undefined, endOfDay = false): string | undefined {
  if (!v) return undefined
  const m = /^(\d+)([hd])$/.exec(v)
  if (m) {
    const ms = Number(m[1]) * (m[2] === 'h' ? 3_600_000 : 86_400_000)
    return new Date(Date.now() - ms).toISOString()
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return endOfDay ? `${v}T23:59:59Z` : `${v}T00:00:00Z`
  return v
}

/** Every URL key a set of filter defs writes (for "clear all"). */
export function filterKeys(defs: FilterDef[]): string[] {
  return defs.flatMap((d) => (d.kind === 'range' ? [d.minKey, d.maxKey] : d.kind === 'date' ? [d.sinceKey, d.untilKey] : [d.key]))
}

function isActive(def: FilterDef, v: FilterValues): boolean {
  if (def.kind === 'range') return !!(v[def.minKey] || v[def.maxKey])
  if (def.kind === 'date') return !!(v[def.sinceKey] || v[def.untilKey])
  return !!v[def.key]
}

interface SavedView {
  name: string
  values: FilterValues
}

function readViews(key: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v) => v && typeof v.name === 'string' && v.values) : []
  } catch {
    return []
  }
}

function writeViews(key: string, views: SavedView[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(views))
  } catch {
    // storage blocked: the view lasts for this visit only
  }
}

const POPOVER =
  'w-[min(20rem,calc(100vw-2rem))] rounded-xl bg-white p-2 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.25)] ring-1 ring-neutral-200/80 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 focus:outline-none'

const OPTION_ROW =
  'w-full flex items-center gap-2 rounded-lg px-2.5 h-8 text-start text-[13px] text-neutral-700 hover:bg-neutral-100 focus-visible:bg-neutral-100 focus:outline-none'

export default function FilterBar({
  values,
  onChange,
  defs,
  search,
  end,
  savedViewsKey,
  pageKey = 'page',
  className = '',
  children,
}: {
  values: FilterValues
  onChange: (updates: FilterValues, opts?: { replace?: boolean }) => void
  defs: FilterDef[]
  search?: { key: string; placeholder: string }
  /** Controls after the filter button (sort, view toggles). */
  end?: React.ReactNode
  /** localStorage key; enables saved views. */
  savedViewsKey?: string
  pageKey?: string
  className?: string
  /** Extra row content before the chips (e.g. source tabs). */
  children?: React.ReactNode
}) {
  const { t } = useTranslation()
  const visible = defs.filter((d) => !d.hidden)
  const [draft, setDraft] = React.useState(search ? values[search.key] ?? '' : '')
  const debounced = useDebounced(draft, 300)
  const searchValue = search ? values[search.key] ?? '' : ''

  // A new URL value (back/forward, a saved view) replaces the box's text.
  const lastUrl = React.useRef(searchValue)
  React.useEffect(() => {
    if (searchValue !== lastUrl.current) {
      lastUrl.current = searchValue
      setDraft(searchValue)
    }
  }, [searchValue])
  React.useEffect(() => {
    if (!search) return
    const v = debounced.trim()
    if (v !== (values[search.key] ?? '')) {
      lastUrl.current = v
      onChange({ [search.key]: v || undefined, [pageKey]: undefined }, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const apply = (updates: FilterValues) => onChange({ ...updates, [pageKey]: undefined })
  const active = visible.filter((d) => isActive(d, values))
  const anyActive = active.length > 0 || !!searchValue

  const clearAll = () => {
    const updates: FilterValues = {}
    for (const k of filterKeys(visible)) updates[k] = undefined
    if (search) updates[search.key] = undefined
    setDraft('')
    apply(updates)
  }

  return (
    <div className={`flex flex-col gap-2.5 min-w-0 ${className}`}>
      <div className="flex flex-col xl:flex-row gap-2.5 xl:items-center min-w-0">
        {search && <SearchInput className="xl:max-w-md" value={draft} onChange={setDraft} placeholder={search.placeholder} />}
        <div className="flex flex-wrap items-center gap-2 xl:ms-auto">
          {children}
          {visible.length > 0 && <AddFilter defs={visible} values={values} onApply={apply} />}
          {savedViewsKey && <SavedViews storageKey={savedViewsKey} values={values} keys={[...filterKeys(visible), ...(search ? [search.key] : [])]} onApply={(v) => {
            const updates: FilterValues = {}
            for (const k of filterKeys(visible)) updates[k] = undefined
            if (search) updates[search.key] = undefined
            Object.assign(updates, v)
            if (search) setDraft(v[search.key] ?? '')
            apply(updates)
          }} />}
          {end}
        </div>
      </div>
      {anyActive && (
        <div className="flex flex-wrap items-center gap-1.5">
          {active.map((def) => (
            <Chip key={def.key} def={def} values={values} onApply={apply} />
          ))}
          {searchValue && search && (
            <span className="inline-flex items-center gap-1 h-7 ps-2.5 pe-1 rounded-full bg-white nice-shadow text-xs text-neutral-700">
              <MagnifyingGlass size={12} className="text-neutral-400" />
              <span className="max-w-[14rem] truncate">“{searchValue}”</span>
              <button
                type="button"
                onClick={() => {
                  setDraft('')
                  apply({ [search.key]: undefined })
                }}
                aria-label={t('admin.filters.remove')}
                className="h-5 w-5 inline-flex items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                <X size={11} />
              </button>
            </span>
          )}
          <button type="button" onClick={clearAll} className="h-7 px-2 text-xs font-semibold text-neutral-500 hover:text-neutral-900">
            {t('admin.filters.clear_all')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── add filter ──────────────────────────────────────────────────────────────

function AddFilter({ defs, values, onApply }: { defs: FilterDef[]; values: FilterValues; onApply: (u: FilterValues) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [picked, setPicked] = React.useState<FilterDef | null>(null)
  const activeCount = defs.filter((d) => isActive(d, values)).length
  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setPicked(null)
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-white nice-shadow text-xs font-semibold text-neutral-700 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/10"
        >
          <FunnelSimple size={14} />
          {t('admin.filters.filter')}
          {activeCount > 0 && <span className="h-4 min-w-4 px-1 rounded-full bg-neutral-900 text-white text-[10px] tabular-nums inline-flex items-center justify-center">{activeCount}</span>}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="end" sideOffset={6} collisionPadding={12} className={POPOVER} style={{ zIndex: 'var(--z-popover)' as any }}>
          {picked ? (
            <div>
              <button type="button" onClick={() => setPicked(null)} className="flex items-center gap-1.5 px-1.5 h-7 text-xs font-semibold text-neutral-500 hover:text-neutral-900">
                <CaretLeft size={12} className="rtl:rotate-180" />
                {picked.label}
              </button>
              <Editor
                def={picked}
                values={values}
                onApply={(u) => {
                  onApply(u)
                  setOpen(false)
                  setPicked(null)
                }}
              />
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold text-neutral-400">{t('admin.filters.add')}</p>
              {defs.map((d) => (
                <button key={d.key} type="button" onClick={() => setPicked(d)} className={OPTION_ROW}>
                  <span className="text-neutral-400 shrink-0 [&>svg]:size-[14px]">{d.icon ?? <FunnelSimple size={14} />}</span>
                  <span className="flex-1 truncate">{d.label}</span>
                  {isActive(d, values) && <Check size={13} className="text-neutral-900" />}
                </button>
              ))}
            </div>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

// ─── chips ───────────────────────────────────────────────────────────────────

function useDisplay(def: FilterDef, values: FilterValues): string {
  const { t } = useTranslation()
  const fmtDate = (v?: string) => {
    if (!v) return ''
    if ((DATE_PRESETS as readonly string[]).includes(v)) return t(`admin.filters.presets.${v}`)
    return v
  }
  switch (def.kind) {
    case 'select':
      return def.options.find((o) => o.value === values[def.key])?.label ?? values[def.key] ?? ''
    case 'async':
      return def.options?.find((o) => o.value === values[def.key])?.label ?? def.describe?.(values[def.key] ?? '') ?? values[def.key] ?? ''
    case 'boolean':
      return values[def.key] === 'true' ? def.trueLabel ?? t('admin.filters.yes') : def.falseLabel ?? t('admin.filters.no')
    case 'number':
      return `${values[def.key]}${def.suffix ? ` ${def.suffix}` : ''}`
    case 'range': {
      const min = values[def.minKey]
      const max = values[def.maxKey]
      const s = def.suffix ? ` ${def.suffix}` : ''
      if (min && max) return `${min}–${max}${s}`
      if (min) return `≥ ${min}${s}`
      return `≤ ${max}${s}`
    }
    case 'date': {
      const since = values[def.sinceKey]
      const until = values[def.untilKey]
      if (since && !until && (DATE_PRESETS as readonly string[]).includes(since)) return fmtDate(since)
      if (since && until) return `${fmtDate(since)} → ${fmtDate(until)}`
      if (since) return t('admin.filters.since', { date: fmtDate(since) })
      return t('admin.filters.until', { date: fmtDate(until) })
    }
    default:
      return values[def.key] ?? ''
  }
}

function Chip({ def, values, onApply }: { def: FilterDef; values: FilterValues; onApply: (u: FilterValues) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const display = useDisplay(def, values)
  const clear = () => onApply(Object.fromEntries(filterKeys([def]).map((k) => [k, undefined])))
  return (
    <span className="inline-flex items-center h-7 rounded-full bg-neutral-900 text-white text-xs">
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button type="button" className="inline-flex items-center gap-1 h-7 ps-2.5 pe-1 rounded-s-full focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30">
            <span className="text-white/60">{def.label}:</span>
            <span className="font-semibold max-w-[12rem] truncate">{display}</span>
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content align="start" sideOffset={6} collisionPadding={12} className={POPOVER} style={{ zIndex: 'var(--z-popover)' as any }}>
            <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold text-neutral-400">{def.label}</p>
            <Editor
              def={def}
              values={values}
              onApply={(u) => {
                onApply(u)
                setOpen(false)
              }}
            />
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      <button
        type="button"
        onClick={clear}
        aria-label={t('admin.filters.remove_named', { name: def.label })}
        className="h-7 w-6 inline-flex items-center justify-center rounded-e-full text-white/60 hover:text-white"
      >
        <X size={11} />
      </button>
    </span>
  )
}

// ─── editors ─────────────────────────────────────────────────────────────────

function OptionList({ options, value, onPick }: { options: FilterOption[]; value?: string; onPick: (v: string) => void }) {
  const { t } = useTranslation()
  const [q, setQ] = React.useState('')
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()) || o.value.toLowerCase().includes(q.toLowerCase())) : options
  return (
    <div>
      {options.length > 8 && (
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.filters.find')} className={`${INPUT} mb-1.5 h-8 text-[13px]`} />
      )}
      <div className="max-h-64 overflow-y-auto">
        {shown.length === 0 && <p className="px-2.5 py-3 text-xs text-neutral-400">{t('admin.filters.no_options')}</p>}
        {shown.map((o) => (
          <button key={o.value} type="button" onClick={() => onPick(o.value)} className={OPTION_ROW}>
            <span className="w-3.5 shrink-0">{value === o.value && <Check size={13} />}</span>
            <span className="flex-1 truncate">{o.label}</span>
            {o.count !== undefined && <span className="text-[11px] tabular-nums text-neutral-400">{o.count.toLocaleString()}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function Editor({ def, values, onApply }: { def: FilterDef; values: FilterValues; onApply: (u: FilterValues) => void }) {
  const { t } = useTranslation()
  switch (def.kind) {
    case 'select':
      return <OptionList options={def.options} value={values[def.key]} onPick={(v) => onApply({ [def.key]: v })} />
    case 'boolean':
      return (
        <OptionList
          options={[
            { value: 'true', label: def.trueLabel ?? t('admin.filters.yes'), count: def.counts?.true },
            { value: 'false', label: def.falseLabel ?? t('admin.filters.no'), count: def.counts?.false },
          ]}
          value={values[def.key]}
          onPick={(v) => onApply({ [def.key]: v })}
        />
      )
    case 'async':
      return <AsyncEditor def={def} values={values} onApply={onApply} />
    case 'text':
      return <TextEditor initial={values[def.key] ?? ''} placeholder={def.placeholder} onApply={(v) => onApply({ [def.key]: v || undefined })} />
    case 'number':
      return (
        <TextEditor
          type="number"
          min={def.min}
          max={def.max}
          initial={values[def.key] ?? ''}
          placeholder={def.placeholder}
          onApply={(v) => onApply({ [def.key]: v || undefined })}
        />
      )
    case 'range':
      return <RangeEditor def={def} values={values} onApply={onApply} />
    case 'date':
      return <DateEditor def={def} values={values} onApply={onApply} />
  }
}

function TextEditor({
  initial,
  placeholder,
  onApply,
  type = 'text',
  min,
  max,
}: {
  initial: string
  placeholder?: string
  onApply: (v: string) => void
  type?: 'text' | 'number'
  min?: number
  max?: number
}) {
  const { t } = useTranslation()
  const [v, setV] = React.useState(initial)
  return (
    <form
      className="flex flex-col gap-2 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        onApply(v.trim())
      }}
    >
      <input autoFocus type={type} min={min} max={max} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className={INPUT} />
      <Button type="submit" size="sm" variant="primary" className="self-end">
        {t('admin.filters.apply')}
      </Button>
    </form>
  )
}

function RangeEditor({ def, values, onApply }: { def: Extract<FilterDef, { kind: 'range' }>; values: FilterValues; onApply: (u: FilterValues) => void }) {
  const { t } = useTranslation()
  const [min, setMin] = React.useState(values[def.minKey] ?? '')
  const [max, setMax] = React.useState(values[def.maxKey] ?? '')
  return (
    <form
      className="flex flex-col gap-2 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        // Swap a reversed range rather than send one that matches nothing.
        let lo = min.trim()
        let hi = max.trim()
        if (lo && hi && Number(lo) > Number(hi)) [lo, hi] = [hi, lo]
        onApply({ [def.minKey]: lo || undefined, [def.maxKey]: hi || undefined })
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-semibold text-neutral-500">
          {t('admin.filters.min')}
          <input autoFocus type="number" min={0} value={min} onChange={(e) => setMin(e.target.value.replace('-', ''))} className={`${INPUT} mt-1`} />
        </label>
        <label className="text-[11px] font-semibold text-neutral-500">
          {t('admin.filters.max')}
          <input type="number" min={0} value={max} onChange={(e) => setMax(e.target.value.replace('-', ''))} className={`${INPUT} mt-1`} />
        </label>
      </div>
      <Button type="submit" size="sm" variant="primary" className="self-end">
        {t('admin.filters.apply')}
      </Button>
    </form>
  )
}

function DateEditor({ def, values, onApply }: { def: Extract<FilterDef, { kind: 'date' }>; values: FilterValues; onApply: (u: FilterValues) => void }) {
  const { t } = useTranslation()
  const cur = values[def.sinceKey]
  const isCustom = !!cur && !(DATE_PRESETS as readonly string[]).includes(cur)
  const [from, setFrom] = React.useState(isCustom ? cur!.slice(0, 10) : '')
  const [to, setTo] = React.useState((values[def.untilKey] ?? '').slice(0, 10))
  return (
    <div>
      {DATE_PRESETS.map((p) => (
        <button key={p} type="button" onClick={() => onApply({ [def.sinceKey]: p, [def.untilKey]: undefined })} className={OPTION_ROW}>
          <span className="w-3.5 shrink-0">{cur === p && !values[def.untilKey] && <Check size={13} />}</span>
          <span className="flex-1">{t(`admin.filters.presets.${p}`)}</span>
        </button>
      ))}
      <form
        className="mt-1.5 border-t border-neutral-100 pt-2 px-1 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          onApply({ [def.sinceKey]: from || undefined, [def.untilKey]: to || undefined })
        }}
      >
        <p className="text-[11px] font-semibold text-neutral-400">{t('admin.filters.custom_range')}</p>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" aria-label={t('admin.filters.from')} value={from} onChange={(e) => setFrom(e.target.value)} className={`${INPUT} text-xs px-2`} />
          <input type="date" aria-label={t('admin.filters.to')} value={to} onChange={(e) => setTo(e.target.value)} className={`${INPUT} text-xs px-2`} />
        </div>
        <Button type="submit" size="sm" variant="primary" className="self-end" disabled={!from && !to}>
          {t('admin.filters.apply')}
        </Button>
      </form>
    </div>
  )
}

function AsyncEditor({ def, values, onApply }: { def: Extract<FilterDef, { kind: 'async' }>; values: FilterValues; onApply: (u: FilterValues) => void }) {
  const { t } = useTranslation()
  const [q, setQ] = React.useState('')
  const dq = useDebounced(q.trim(), 250)
  const loaded = useQuery({
    queryKey: ['platform', 'filter-options', def.key, dq],
    queryFn: () => def.load(dq),
    enabled: dq.length >= 1,
    staleTime: 30_000,
    retry: false,
  })
  const options = dq ? loaded.data ?? [] : def.options ?? []
  return (
    <div>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={def.placeholder ?? t('admin.filters.find')} className={`${INPUT} mb-1.5 h-8 text-[13px]`} />
      {loaded.isFetching && dq ? (
        <p className="px-2.5 py-3 text-xs text-neutral-400">{t('admin.filters.searching')}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          {options.length === 0 && <p className="px-2.5 py-3 text-xs text-neutral-400">{dq ? t('admin.filters.no_options') : t('admin.filters.type_to_search')}</p>}
          {options.map((o) => (
            <button key={o.value} type="button" onClick={() => onApply({ [def.key]: o.value })} className={OPTION_ROW}>
              <span className="w-3.5 shrink-0">{values[def.key] === o.value && <Check size={13} />}</span>
              <span className="flex-1 truncate">{o.label}</span>
              {o.count !== undefined && <span className="text-[11px] tabular-nums text-neutral-400">{o.count.toLocaleString()}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── saved views ─────────────────────────────────────────────────────────────

// Views are shared through the API (GET/POST/PUT/DELETE /saved_views), with a
// "share with the team" switch. Servers without that endpoint fall back to
// this browser's localStorage.
const VIEW_PAGES: Record<string, string> = {
  orgs: 'organizations',
  users: 'users',
  audit: 'activity',
  'org-audit': 'activity',
  pocs: 'pocs',
  automations: 'automations',
  runs: 'runs',
  team: 'team',
  tasks: 'tasks',
  deliveries: 'deliveries',
  follows: 'follows',
  notifications: 'notifications',
}

interface ApiView {
  view_uuid: string
  name: string
  filters: FilterValues
  shared?: boolean
  is_mine?: boolean
}

function SavedViews({
  storageKey,
  values,
  keys,
  onApply,
}: {
  storageKey: string
  values: FilterValues
  keys: string[]
  onApply: (v: FilterValues) => void
}) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [local, setLocal] = React.useState<SavedView[]>([])
  const [name, setName] = React.useState('')
  const [shared, setShared] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const page = VIEW_PAGES[storageKey.split(':').pop() ?? ''] ?? storageKey
  const apiKey = ['platform', 'saved-views', page]

  const api = useQuery({
    queryKey: apiKey,
    queryFn: () => listSavedViews(token, page),
    enabled: !!token && open,
    retry: shouldRetry,
  })
  const useLocal = !!api.error && isNotAvailable(api.error)

  React.useEffect(() => {
    // Views saved on this browser before shared views existed stay listed.
    if (open) setLocal(readViews(storageKey))
  }, [open, storageKey])

  // Saved views remember the sort too.
  const allKeys = keys.includes('sort') ? keys : [...keys, 'sort']
  const current: FilterValues = Object.fromEntries(allKeys.filter((k) => values[k]).map((k) => [k, values[k]]))
  const hasCurrent = Object.keys(current).length > 0
  const same = (a: FilterValues) => allKeys.every((k) => (a[k] ?? '') === (current[k] ?? ''))

  const localViews = local.map((v) => ({ view_uuid: `local:${v.name}`, name: v.name, filters: v.values, is_mine: true, local: true }))
  const views: (ApiView & { local?: boolean })[] = useLocal ? localViews : [...(Array.isArray(api.data) ? (api.data as ApiView[]) : []), ...localViews]

  const save = async () => {
    const n = name.trim().slice(0, 40)
    if (!n || !hasCurrent) return
    if (useLocal) {
      const next = [...local.filter((v) => v.name !== n), { name: n, values: current }]
      setLocal(next)
      writeViews(storageKey, next)
      setName('')
      return
    }
    setBusy(true)
    try {
      await createSavedView(token, { page, name: n, filters: current, shared })
      setName('')
      setShared(false)
      queryClient.invalidateQueries({ queryKey: apiKey })
    } catch (err) {
      toast.error(errorMessage(err, t('admin.filters.save_failed')))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (v: ApiView & { local?: boolean }) => {
    if (v.local) {
      const next = local.filter((x) => x.name !== v.name)
      setLocal(next)
      writeViews(storageKey, next)
      return
    }
    try {
      await deleteSavedView(token, v.view_uuid)
      queryClient.invalidateQueries({ queryKey: apiKey })
    } catch (err) {
      toast.error(errorMessage(err, t('admin.filters.delete_failed')))
    }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={t('admin.filters.views')}
          title={t('admin.filters.views')}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-white nice-shadow text-xs font-semibold text-neutral-700 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/10"
        >
          <BookmarkSimple size={14} />
          <span className="hidden sm:inline">{t('admin.filters.views')}</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="end" sideOffset={6} collisionPadding={12} className={POPOVER} style={{ zIndex: 'var(--z-popover)' as any }}>
          <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold text-neutral-400">{t('admin.filters.saved_views')}</p>
          {api.isLoading && !useLocal ? (
            <p className="px-2.5 pb-2 text-xs text-neutral-400">{t('common.loading')}</p>
          ) : views.length === 0 ? (
            <p className="px-2.5 pb-2 text-xs text-neutral-400">{t('admin.filters.no_views')}</p>
          ) : null}
          <div className="max-h-56 overflow-y-auto">
            {views.map((v) => (
              <div key={v.view_uuid} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onApply(v.filters ?? {})
                    setOpen(false)
                  }}
                  className={OPTION_ROW}
                >
                  <span className="w-3.5 shrink-0">{same(v.filters ?? {}) && <Check size={13} />}</span>
                  <span className="flex-1 truncate">{v.name}</span>
                  {v.shared && <span className="text-[10px] font-semibold text-sky-600">{t('admin.filters.shared')}</span>}
                  {v.local && !useLocal && <span className="text-[10px] font-semibold text-neutral-400">{t('admin.filters.this_browser')}</span>}
                </button>
                {v.is_mine !== false && (
                  <button
                    type="button"
                    onClick={() => remove(v)}
                    aria-label={t('admin.filters.delete_view', { name: v.name })}
                    className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg text-neutral-300 hover:text-rose-600 hover:bg-rose-50"
                  >
                    <Trash size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <form
            className="mt-1.5 border-t border-neutral-100 pt-2 px-1 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <div className="flex items-center gap-1.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={hasCurrent ? t('admin.filters.view_name') : t('admin.filters.nothing_to_save')}
                disabled={!hasCurrent}
                maxLength={40}
                className={`${INPUT} h-8 text-[13px]`}
              />
              <Button type="submit" size="sm" variant="primary" icon={<Plus size={12} weight="bold" />} disabled={!hasCurrent || !name.trim()} loading={busy}>
                {t('admin.filters.save')}
              </Button>
            </div>
            {!useLocal && (
              <label className="flex items-center gap-2 px-1 text-xs text-neutral-600">
                <input type="checkbox" className="accent-neutral-900" checked={shared} onChange={(e) => setShared(e.target.checked)} disabled={!hasCurrent} />
                {t('admin.filters.share_with_team')}
              </label>
            )}
          </form>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
