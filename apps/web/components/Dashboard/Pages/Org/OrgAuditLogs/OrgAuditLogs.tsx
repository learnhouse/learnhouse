'use client'
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowsClockwise,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  ClockCounterClockwise,
  DownloadSimple,
  ListMagnifyingGlass,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { Button, Chip, EmptyState, INPUT, Panel, SearchInput, Skeleton, StatusPill, ToolbarSelect, recipes } from '@/design'
import { queryKeys } from '@/lib/query/keys'
import { intlLocale } from '@/lib/format'
import {
  exportAuditLogs,
  getAuditFacets,
  getAuditLogs,
  type AuditFilters,
} from '@services/ee/audit_logs'
import {
  CATEGORIES,
  OUTCOMES,
  VIAS,
  actorName,
  dateRangeBounds,
  outcomeStatus,
  type AuditEntry,
} from './auditFormat'
import { ActorAvatar, AuditSentence, targetTypeLabel, useAuditText } from './auditUi'
import AuditLogDrawer from './AuditLogDrawer'
import AuditRetentionDialog from './AuditRetentionDialog'

const PAGE_SIZE = 25

// Subgrid table (as in the courses list): the panel is the grid and each row
// spans it, so the columns line up. Below lg rows stack.
const TABLE_GRID = 'lg:grid lg:grid-cols-[minmax(0,9rem)_minmax(0,13rem)_minmax(0,1fr)_auto_auto]'
const ROW_GRID = 'lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-4'

type UiFilters = {
  q: string
  date: string
  start: string
  end: string
  actor: string
  category: string
  target: string
  outcome: string
  via: string
}

const EMPTY: UiFilters = { q: '', date: 'all', start: '', end: '', actor: 'all', category: 'all', target: 'all', outcome: 'all', via: 'all' }

function toApiFilters(f: UiFilters): AuditFilters {
  let start = f.start ? new Date(`${f.start}T00:00:00`).toISOString() : undefined
  let end = f.end ? new Date(`${f.end}T23:59:59.999`).toISOString() : undefined
  if (f.date !== 'custom') {
    start = dateRangeBounds(f.date).start
    end = undefined
  }
  return {
    q: f.q || undefined,
    category: f.category,
    target_type: f.target,
    outcome: f.outcome,
    via: f.via,
    actor_id: f.actor === 'all' ? undefined : f.actor,
    start_date: start,
    end_date: end,
  }
}

function RowSkeleton() {
  return (
    <div className={`flex items-center gap-3 px-5 py-3.5 ${ROW_GRID}`}>
      <Skeleton className="hidden lg:block h-3.5 w-20" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-7 w-7 !rounded-full" />
        <Skeleton className="h-3.5 w-24" />
      </div>
      <Skeleton className="h-3.5 w-full max-w-md" />
      <Skeleton className="hidden lg:block h-6 w-16 !rounded-full" />
      <Skeleton className="hidden lg:block h-6 w-20 !rounded-full" />
    </div>
  )
}

const OrgAuditLogs = () => {
  const { t, i18n } = useTranslation()
  const text = useAuditText()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()

  const [filters, setFilters] = useState<UiFilters>(EMPTY)
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [openId, setOpenId] = useState<number | null>(null)
  const [retentionOpen, setRetentionOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Debounce typing so each keystroke doesn't fire a request.
  React.useEffect(() => {
    const id = setTimeout(() => {
      setFilters((f) => (f.q === search ? f : { ...f, q: search }))
      setOffset(0)
    }, 300)
    return () => clearTimeout(id)
  }, [search])

  const patch = (p: Partial<UiFilters>) => {
    setFilters((f) => ({ ...f, ...p }))
    setOffset(0)
  }

  const apiFilters = toApiFilters(filters)
  const enabled = !!(org?.id && token)
  const listKey = [...queryKeys.org.auditLogs(org?.id ?? 0), 'list', offset, apiFilters] as const

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: listKey,
    queryFn: () => getAuditLogs(org.id, token as string, apiFilters, offset, PAGE_SIZE),
    enabled,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    retry: 1,
  })
  const { data: facets } = useQuery({
    queryKey: [...queryKeys.org.auditLogs(org?.id ?? 0), 'facets'],
    queryFn: () => getAuditFacets(org.id, token as string),
    enabled,
    staleTime: 5 * 60_000,
  })

  const items: AuditEntry[] = Array.isArray(data?.items) ? data.items : []
  const total = data?.total ?? 0
  const activeCount = (['actor', 'category', 'target', 'outcome', 'via'] as const).filter((k) => filters[k] !== 'all').length
    + (filters.date !== 'all' ? 1 : 0) + (filters.q ? 1 : 0)

  const clearFilters = () => {
    setSearch('')
    setFilters(EMPTY)
    setOffset(0)
  }

  const handleExport = async (format: 'csv' | 'json') => {
    if (!enabled || exporting) return
    setExporting(true)
    const toastId = toast.loading(text('export.generating'))
    try {
      await exportAuditLogs(org.id, token as string, apiFilters, format)
      toast.success(text('export.done'), { id: toastId })
      queryClient.invalidateQueries({ queryKey: queryKeys.org.auditLogs(org.id) })
    } catch {
      toast.error(text('export.failed'), { id: toastId })
    } finally {
      setExporting(false)
    }
  }

  const locale = intlLocale(i18n.language)
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const timeFmt = new Intl.DateTimeFormat(locale, { timeStyle: 'short' })

  const filterSelects = (
    <>
      <ToolbarSelect
        value={filters.date}
        onChange={(v) => patch({ date: v })}
        ariaLabel={text('filters.date')}
        icon={<CalendarBlank size={13} />}
        options={['all', 'today', '7d', '30d', '90d', 'custom'].map((v) => ({ value: v, label: text(`filters.date_${v}`) }))}
      />
      <ToolbarSelect
        value={filters.actor}
        onChange={(v) => patch({ actor: v })}
        ariaLabel={text('filters.actor')}
        options={[
          { value: 'all', label: text('filters.actor_all') },
          ...(facets?.actors ?? []).map((a) => ({ value: String(a.id), label: a.name || a.username || `#${a.id}` })),
        ]}
      />
      <ToolbarSelect
        value={filters.category}
        onChange={(v) => patch({ category: v })}
        ariaLabel={text('filters.category')}
        options={[
          { value: 'all', label: text('filters.category_all') },
          ...CATEGORIES.map((c) => ({ value: c, label: text(`category.${c}`) })),
        ]}
      />
      <ToolbarSelect
        value={filters.target}
        onChange={(v) => patch({ target: v })}
        ariaLabel={text('filters.target')}
        options={[
          { value: 'all', label: text('filters.target_all') },
          ...(facets?.target_types ?? []).map((tt) => ({ value: tt, label: targetTypeLabel(t, tt) })),
        ]}
      />
      <ToolbarSelect
        value={filters.outcome}
        onChange={(v) => patch({ outcome: v })}
        ariaLabel={text('filters.outcome')}
        options={[{ value: 'all', label: text('filters.outcome_all') }, ...OUTCOMES.map((o) => ({ value: o, label: text(`outcome.${o}`) }))]}
      />
      <ToolbarSelect
        value={filters.via}
        onChange={(v) => patch({ via: v })}
        ariaLabel={text('filters.via')}
        options={[{ value: 'all', label: text('filters.via_all') }, ...VIAS.map((v) => ({ value: v, label: text(`via.${v}`) }))]}
      />
    </>
  )

  return (
    <FeatureGate feature="audit_logs">
      <div className="flex flex-col gap-3 min-w-0">
        {/* Search and actions */}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center min-w-0">
          <SearchInput className="sm:max-w-md" value={search} onChange={setSearch} placeholder={text('search.placeholder')} />
          <div className="flex items-center gap-2 sm:ms-auto">
            <Button
              variant="secondary"
              size="icon"
              className="!h-9 !w-9"
              onClick={() => refetch()}
              aria-label={text('actions.refresh')}
              title={text('actions.refresh')}
            >
              <ArrowsClockwise size={14} className={isFetching ? 'animate-spin' : ''} />
            </Button>
            <Button variant="secondary" icon={<ClockCounterClockwise size={14} />} onClick={() => setRetentionOpen(true)}>
              {text('actions.retention')}
            </Button>
            <ExportMenu disabled={!enabled || exporting} onExport={handleExport} />
          </div>
        </div>

        {/* Filters: one row that scrolls inside itself on phones */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible pb-0.5 [&>*]:shrink-0">
          {filterSelects}
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className={`shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-xl text-xs font-semibold text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors ${recipes.focusRing}`}
            >
              <X size={12} />
              {text('filters.clear')}
              <span className="tabular-nums text-neutral-400">({activeCount})</span>
            </button>
          )}
        </div>

        {filters.date === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              aria-label={text('filters.from')}
              className={`${INPUT} !w-44`}
              value={filters.start}
              max={filters.end || undefined}
              onChange={(e) => patch({ start: e.target.value })}
            />
            <span className="text-neutral-400 text-xs">{text('filters.to')}</span>
            <input
              type="date"
              aria-label={text('filters.to')}
              className={`${INPUT} !w-44`}
              value={filters.end}
              min={filters.start || undefined}
              onChange={(e) => patch({ end: e.target.value })}
            />
          </div>
        )}

        {/* Log */}
        <Panel divided className={TABLE_GRID}>
          <div className={`hidden ${ROW_GRID} ${recipes.tableHead}`}>
            <span>{text('table.when')}</span>
            <span>{text('table.actor')}</span>
            <span>{text('table.event')}</span>
            <span>{text('table.outcome')}</span>
            <span>{text('table.via')}</span>
          </div>

          {isLoading && !data ? (
            <div className={`divide-y divide-neutral-100 ${ROW_GRID}`} aria-busy="true">
              {Array.from({ length: 8 }, (_, i) => <RowSkeleton key={i} />)}
            </div>
          ) : isError && !data ? (
            <div className="lg:col-span-full">
              <EmptyState
                icon={<WarningCircle size={22} />}
                title={text('error.title')}
                description={text('error.description')}
                action={<Button variant="secondary" size="sm" onClick={() => refetch()}>{text('actions.retry')}</Button>}
              />
            </div>
          ) : items.length === 0 ? (
            <div className="lg:col-span-full">
              <EmptyState
                icon={<ListMagnifyingGlass size={22} />}
                title={activeCount ? text('empty.filtered_title') : text('empty.title')}
                description={activeCount ? text('empty.filtered_description') : text('empty.description')}
                action={activeCount ? <Button variant="secondary" size="sm" onClick={clearFilters}>{text('filters.clear')}</Button> : undefined}
              />
            </div>
          ) : (
            <ul className={`divide-y divide-neutral-100 ${ROW_GRID} ${isFetching ? 'opacity-70' : ''} transition-opacity`}>
              {items.map((entry) => {
                const created = new Date(entry.created_at.endsWith('Z') || entry.created_at.includes('+') ? entry.created_at : `${entry.created_at}Z`)
                const valid = !isNaN(created.getTime())
                const name = actorName(entry, { system: text('actor.system'), unknown: text('actor.unknown'), scim: text('actor.scim'), support: text('actor.support') })
                return (
                  <li key={entry.id} className={ROW_GRID}>
                    <button
                      type="button"
                      onClick={() => setOpenId(entry.id)}
                      aria-haspopup="dialog"
                      title={text('table.open')}
                      className={`w-full text-start flex flex-col gap-1.5 px-4 sm:px-5 py-3 hover:bg-neutral-50/70 transition-colors lg:col-span-full lg:grid lg:grid-cols-subgrid lg:items-center lg:gap-x-4 lg:gap-y-0 ${recipes.focusRing} focus-visible:ring-inset focus-visible:ring-offset-0`}
                    >
                      <span className="hidden lg:flex flex-col min-w-0">
                        <span className="text-sm font-medium text-neutral-800 tabular-nums">{valid ? dateFmt.format(created) : '—'}</span>
                        <span className="text-[11px] text-neutral-400 tabular-nums">{valid ? timeFmt.format(created) : ''}</span>
                      </span>
                      <span className="flex items-center gap-2 min-w-0">
                        <ActorAvatar entry={entry} name={name} size={28} />
                        <span className="flex flex-col min-w-0">
                          <span className="text-sm font-medium text-neutral-800 truncate">{name}</span>
                          {entry.actor_role && <span className="text-[11px] text-neutral-400 truncate">{entry.actor_role}</span>}
                        </span>
                      </span>
                      <span className="text-sm text-neutral-600 min-w-0 break-words lg:line-clamp-2">
                        <AuditSentence entry={entry} />
                        {entry.reason && entry.outcome !== 'success' && (
                          <span className="text-neutral-400"> · {entry.reason.replace(/_/g, ' ')}</span>
                        )}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 lg:contents">
                        <span className="lg:justify-self-start">
                          <StatusPill status={outcomeStatus(entry.outcome)} dot>{text(`outcome.${entry.outcome || 'success'}`)}</StatusPill>
                        </span>
                        <span className="lg:justify-self-start">
                          <Chip tone={entry.via === 'atlas' || entry.via === 'mcp' ? 'violet' : entry.via === 'api_token' ? 'sky' : 'neutral'}>
                            {text(`via.${entry.via || 'ui'}`)}
                          </Chip>
                        </span>
                        <span className="lg:hidden text-[11px] text-neutral-400 tabular-nums">
                          {valid ? `${dateFmt.format(created)} · ${timeFmt.format(created)}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-neutral-500 tabular-nums">
              {text('list.showing', undefined, { start: offset + 1, end: Math.min(offset + PAGE_SIZE, total), total })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="icon"
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                disabled={offset === 0}
                aria-label={text('list.previous')}
              >
                <CaretLeft size={14} className="rtl:rotate-180" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total}
                aria-label={text('list.next')}
              >
                <CaretRight size={14} className="rtl:rotate-180" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <AuditLogDrawer
        orgId={org?.id}
        token={token}
        entryId={openId}
        onClose={() => setOpenId(null)}
        onOpen={(id) => setOpenId(id)}
      />
      {retentionOpen && (
        <AuditRetentionDialog orgId={org?.id} token={token} open={retentionOpen} onClose={() => setRetentionOpen(false)} />
      )}
    </FeatureGate>
  )
}

function ExportMenu({ disabled, onExport }: { disabled: boolean; onExport: (_format: 'csv' | 'json') => void }) {
  const text = useAuditText()
  const [open, setOpen] = useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="secondary"
        icon={<DownloadSimple size={14} />}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {text('actions.export')}
      </Button>
      {open && (
        <div role="menu" className="absolute end-0 top-full mt-1.5 z-30 w-44 rounded-xl bg-white nice-shadow p-1">
          {(['csv', 'json'] as const).map((format) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onExport(format)
              }}
              className="w-full text-start px-3 py-2 rounded-lg text-sm text-neutral-700 hover:bg-neutral-100"
            >
              {text(`actions.export_${format}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default OrgAuditLogs
