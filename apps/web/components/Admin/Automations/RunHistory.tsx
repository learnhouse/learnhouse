'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { CaretRight, ClockCounterClockwise } from '@phosphor-icons/react'
import { Button, EmptyState, Panel, formatRelative } from '@/design'
import { getAutomationRuns } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { Automation, AutomationRun } from '@services/ee/platform/types'
import { shouldRetry, useAccessToken, useListKeyboard, useUrlQuery } from '@components/Admin/hooks'
import { CopyLinkButton, ListSkeleton, Pagination, QueryError, formatDate } from '@components/Admin/Shared/AdminKit'
import FilterBar from '@components/Admin/Shared/FilterBar'
import { DryRunPill, RunStatusPill } from './shared'
import { hasRunFilters, matchRun, runKey, runParams, runUrlKeys, useRunFilterDefs } from './runFilters'
import RunDrawer from './RunDrawer'
import { AutomationIcon } from './automationVisuals'

const PAGE_SIZE = 20
// Filters, page and the open run live in the URL (r_* and run), beside the
// editor's ?section=, so any view of the history is a shareable link.
const PREFIX = 'r_'

export default function RunHistory({ uuid, rule }: { uuid: string; rule?: Automation | null }) {
  const { t } = useTranslation()
  const token = useAccessToken()
  const [values, setUrl] = useUrlQuery()
  const defs = useRunFilterDefs(PREFIX)
  const page = Math.max(1, Number(values.r_page) || 1)
  const openRun = values.run || null
  const runs = useQuery({
    queryKey: [...platformKeys.automationRuns(uuid, page), ...runKey(values, PREFIX)],
    queryFn: () => getAutomationRuns(token, uuid, page, runParams(values, PREFIX)),
    enabled: !!token && !!uuid,
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })

  const params = runParams(values, PREFIX)
  const filtered = hasRunFilters(params)
  const items = (Array.isArray(runs.data?.items) ? runs.data!.items : []).filter((r) => matchRun(r, params))
  const open = (run: AutomationRun) => setUrl({ run: String(run.id) })
  const kb = useListKeyboard(items, open)
  const drawer = (
    <RunDrawer
      runId={openRun}
      fallback={items.find((r) => String(r.id) === openRun) ?? null}
      rule={rule}
      onClose={() => setUrl({ run: undefined })}
    />
  )
  const bar = (
    <FilterBar values={values} onChange={setUrl} defs={defs} pageKey="r_page" end={filtered ? <CopyLinkButton size="sm" /> : undefined} />
  )

  if (runs.error) {
    return (
      <>
        <QueryError error={runs.error} onRetry={() => runs.refetch()} />
        {drawer}
      </>
    )
  }
  if (runs.isLoading) return <ListSkeleton rows={4} avatar={false} />
  if (!items.length) {
    return (
      <div className="space-y-3">
        {(filtered || (runs.data?.total ?? 0) > 0) && bar}
        <Panel>
          {filtered ? (
            <EmptyState
              icon={<ClockCounterClockwise size={22} />}
              title={t('admin.automations.runs_empty_filtered_title')}
              description={t('admin.automations.runs_empty_filtered_desc')}
              action={
                <Button size="sm" onClick={() => setUrl(Object.fromEntries([...runUrlKeys(PREFIX), 'r_page'].map((k) => [k, undefined])))}>
                  {t('admin.automations.clear_filters')}
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<ClockCounterClockwise size={22} />} title={t('admin.automations.runs_empty_title')} description={t('admin.automations.runs_empty_desc')} />
          )}
        </Panel>
        {drawer}
      </div>
    )
  }
  return (
    <div className={`space-y-3 transition-opacity ${runs.isFetching ? 'opacity-70' : ''}`}>
      {bar}
      <Panel divided>
        {items.map((run, i) => (
          <RunRow key={run.id} run={run} rule={rule} onOpen={() => open(run)} rowProps={kb.rowProps(i)} />
        ))}
      </Panel>
      <Pagination
        page={page}
        total={runs.data?.total ?? items.length}
        limit={runs.data?.limit ?? PAGE_SIZE}
        onPage={(p) => setUrl({ r_page: p > 1 ? String(p) : undefined })}
      />
      <p className="hidden sm:block text-[11px] text-neutral-400">{t('admin.automations.kb_hint')}</p>
      {drawer}
    </div>
  )
}

function RunRow({
  run,
  rule,
  onOpen,
  rowProps,
}: {
  run: AutomationRun
  rule?: Automation | null
  onOpen: () => void
  rowProps: Record<string, unknown>
}) {
  const { t, i18n } = useTranslation()
  const results = Array.isArray(run.results) ? run.results : []
  return (
    <button
      type="button"
      onClick={onOpen}
      {...rowProps}
      className={`group w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-start hover:bg-neutral-50 data-[active=true]:bg-neutral-50 ${
        run.status === 'failed' ? 'bg-rose-50/40' : ''
      }`}
    >
      <AutomationIcon automation={rule} size="sm" />
      <RunStatusPill status={run.status} />
      <time className="text-sm text-neutral-900" dateTime={run.started_at}>
        {formatDate(run.started_at, i18n.language, true)}
      </time>
      <span className="text-xs text-neutral-400">{formatRelative(run.started_at, i18n.language)}</span>
      <span className="text-xs text-neutral-500">{t(`admin.automations.trigger.${run.trigger}`, { defaultValue: run.trigger })}</span>
      {run.dry_run && <DryRunPill />}
      <span className="ms-auto flex items-center gap-3 text-xs text-neutral-500 tabular-nums">
        {results.length > 0 && <span className="hidden sm:inline">{t('admin.automations.orgs_count', { count: results.length })}</span>}
        {t('admin.automations.matched_acted', { matched: run.matched ?? 0, acted: run.acted ?? 0 })}
        <CaretRight size={14} className="text-neutral-400 group-hover:text-neutral-900 rtl:rotate-180" />
      </span>
      {run.status === 'failed' && run.error && <p className="basis-full text-xs text-rose-700 break-words line-clamp-2">{run.error}</p>}
    </button>
  )
}
