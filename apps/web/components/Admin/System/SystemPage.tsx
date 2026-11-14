'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, Cpu, Database, Plugs, Robot, ShieldCheck, Timer } from '@phosphor-icons/react'
import { DashPage, SectionCard, StatusPill, Skeleton, Button, formatRelative } from '@/design'
import { getSystem, isNotAvailable } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { getAPIUrl, getDeploymentMode } from '@services/config/config'
import { getLearnHouseVersion } from '@/lib/version'
import { useAccessToken, usePlatformMe, shouldRetry } from '@components/Admin/hooks'
import { mcpUrlFromApi } from '@components/Admin/Developers/tabs/McpTab'
import { AdminHeader, KeyValue, NoAccess, QueryError, formatDate } from '@components/Admin/Shared/AdminKit'

// Licence values that are safe to show; anything that looks like a key or a
// secret is skipped even if the API sends it.
const SECRET_HINT = /key|secret|token|signature|password/i

function fmtValue(v: unknown, key = '', locale = 'en'): string {
  if (v === null || v === undefined || v === '') return '–'
  // Epoch seconds (heartbeats, issued_at) read better as dates.
  if (typeof v === 'number' && v > 1_000_000_000 && v < 10_000_000_000 && /heartbeat|_at$|time/.test(key)) {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v * 1000))
  }
  if (typeof v === 'number') return v.toLocaleString(locale)
  if (typeof v === 'boolean') return v ? '✓' : '✗'
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function OkPill({ ok }: { ok?: boolean }) {
  const { t } = useTranslation()
  if (ok === undefined) return <StatusPill status="neutral">{t('admin.system.unknown')}</StatusPill>
  return (
    <StatusPill status={ok ? 'success' : 'danger'} dot>
      {ok ? t('admin.system.ok') : t('admin.system.down')}
    </StatusPill>
  )
}

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)
  return (
    <Button
      size="sm"
      icon={copied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch {
          // clipboard blocked (insecure context)
        }
      }}
    >
      {copied ? t('admin.tokens.copied') : t('admin.tokens.copy')}
    </Button>
  )
}

export default function SystemPage() {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const q = useQuery({
    queryKey: platformKeys.system(),
    queryFn: () => getSystem(token),
    enabled: !!token && me.can('platform.read'),
    retry: shouldRetry,
    refetchInterval: 60_000,
  })
  const version = getLearnHouseVersion()
  const mode = getDeploymentMode()
  const s = q.data
  const unavailable = !!q.error && isNotAvailable(q.error)

  if (!me.isLoading && !me.can('platform.read')) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.system.title')} />
        <NoAccess />
      </DashPage>
    )
  }

  const license = s?.license && typeof s.license === 'object' ? Object.entries(s.license).filter(([k]) => !SECRET_HINT.test(k)) : []
  const loading = q.isLoading
  const mcpUrl = s?.mcp?.url || (s?.mcp?.path ? mcpUrlFromApi(s.mcp.path) : '')

  return (
    <DashPage>
      <AdminHeader title={t('admin.system.title')} subtitle={t('admin.system.subtitle')} />

      {!!q.error && !unavailable && <QueryError error={q.error} onRetry={() => q.refetch()} />}
      {unavailable && <QueryError error={q.error} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard icon={<Cpu size={18} className="text-sky-600" />} title={t('admin.system.instance')} description={t('admin.system.instance_desc')}>
          <div className="divide-y divide-neutral-100">
            <KeyValue label={t('admin.system.server_version')}>{loading ? <Skeleton className="h-4 w-20" /> : fmtValue(s?.version)}</KeyValue>
            <KeyValue label={t('admin.system.web_version')}>{version.label}</KeyValue>
            <KeyValue label={t('admin.system.deployment_mode')}>
              <span className="uppercase">{s?.deployment_mode ?? mode}</span>
            </KeyValue>
            <KeyValue label={t('admin.system.api_url')} mono>
              <span dir="ltr">{getAPIUrl()}</span>
            </KeyValue>
            <KeyValue label={t('admin.system.migrations_head')} mono>
              {loading ? <Skeleton className="h-4 w-24" /> : fmtValue(s?.migrations_head)}
            </KeyValue>
          </div>
        </SectionCard>

        <SectionCard icon={<Database size={18} className="text-emerald-600" />} title={t('admin.system.services')} description={t('admin.system.services_desc')}>
          <div className="divide-y divide-neutral-100">
            <KeyValue label={t('admin.system.database')}>{loading ? <Skeleton className="h-5 w-14 rounded-full" /> : <OkPill ok={s?.db_ok} />}</KeyValue>
            <KeyValue label={t('admin.system.redis')}>{loading ? <Skeleton className="h-5 w-14 rounded-full" /> : <OkPill ok={s?.redis_ok} />}</KeyValue>
          </div>
        </SectionCard>

        <SectionCard icon={<Timer size={18} className="text-amber-600" />} title={t('admin.system.scheduler')} description={t('admin.system.scheduler_desc')}>
          <div className="divide-y divide-neutral-100">
            <LoopRows label={t('admin.system.automations_scheduler')} loop={s?.scheduler} loaded={!!s} extra={
              typeof s?.scheduler?.last_ran === 'number' ? (
                <KeyValue label={t('admin.system.last_ran')}>{t('admin.system.rules_ran', { count: s.scheduler.last_ran })}</KeyValue>
              ) : null
            } />
            <LoopRows label={t('admin.system.worker')} loop={s?.worker} loaded={!!s} extra={
              s?.worker?.failed_steps && (Array.isArray(s.worker.failed_steps) ? s.worker.failed_steps.length : Number(s.worker.failed_steps)) ? (
                <KeyValue label={t('admin.system.failed_steps')}>
                  <StatusPill status="danger" dot>
                    {Array.isArray(s.worker.failed_steps) ? s.worker.failed_steps.join(', ') : String(s.worker.failed_steps)}
                  </StatusPill>
                </KeyValue>
              ) : null
            } />
          </div>
        </SectionCard>

        <SectionCard icon={<Robot size={18} className="text-violet-600" />} title={t('admin.system.mcp')} description={t('admin.system.mcp_desc')}>
          <div className="divide-y divide-neutral-100">
            <KeyValue label={t('admin.system.status')}>
              {s?.mcp ? (
                <StatusPill status={s.mcp.enabled ? 'success' : 'neutral'} dot>
                  {s.mcp.enabled ? t('admin.system.enabled') : t('admin.system.disabled')}
                </StatusPill>
              ) : (
                '–'
              )}
            </KeyValue>
            {(s?.mcp?.url || s?.mcp?.path) && (
              <div className="flex flex-wrap items-center justify-between gap-2 py-2.5 last:pb-0">
                <code dir="ltr" className="min-w-0 break-all font-mono text-xs text-neutral-700">
                  {mcpUrl}
                </code>
                <CopyButton value={mcpUrl} />
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          icon={<ShieldCheck size={18} className="text-rose-600" />}
          title={t('admin.system.license')}
          description={t('admin.system.license_desc')}
          className="lg:col-span-2"
        >
          {license.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 md:gap-x-10 divide-y divide-neutral-100 md:divide-y-0">
              {license.map(([k, v]) => (
                <div key={k} className="md:border-b md:border-neutral-100 md:py-2.5">
                  <KeyValue label={k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ')}>{fmtValue(v, k, i18n.language)}</KeyValue>
                </div>
              ))}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-neutral-500">
              <Plugs size={15} />
              {loading ? t('common.loading') : t('admin.system.no_license_info')}
            </p>
          )}
        </SectionCard>
      </div>
    </DashPage>
  )
}

/** Status, last tick and interval for one background loop (scheduler or worker). */
function LoopRows({
  label,
  loop,
  loaded,
  extra,
}: {
  label: string
  loop?: { enabled?: boolean; running?: boolean; last_tick_at?: string | null; interval_seconds?: number | null }
  loaded: boolean
  extra?: React.ReactNode
}) {
  const { t, i18n } = useTranslation()
  const status = !loop ? null : !loop.enabled ? 'off' : loop.running === false ? 'stopped' : 'running'
  return (
    <>
      <KeyValue label={label}>
        {status ? (
          <StatusPill status={status === 'running' ? 'success' : status === 'stopped' ? 'warning' : 'neutral'} dot>
            {t(`admin.system.loop_${status}`)}
          </StatusPill>
        ) : (
          '–'
        )}
      </KeyValue>
      <KeyValue label={t('admin.system.last_tick')}>
        <span title={formatDate(loop?.last_tick_at, i18n.language, true)}>
          {formatRelative(loop?.last_tick_at ?? null, i18n.language) ?? (loaded ? t('admin.system.no_tick_yet') : '–')}
        </span>
      </KeyValue>
      {loop?.interval_seconds ? (
        <KeyValue label={t('admin.system.interval')}>
          {loop.interval_seconds >= 3600
            ? t('admin.system.every_hours', { count: Math.round(loop.interval_seconds / 3600) })
            : t('admin.system.every_minutes', { count: Math.max(1, Math.round(loop.interval_seconds / 60)) })}
        </KeyValue>
      ) : null}
      {extra}
    </>
  )
}
