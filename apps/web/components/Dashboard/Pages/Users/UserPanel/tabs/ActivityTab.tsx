'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowSquareOut, CaretLeft, CaretRight, ClipboardText, Pulse, WarningCircle } from '@phosphor-icons/react'
import { Button, SegmentedControl, formatRelative } from '@components/Dashboard/Shared/DashKit/DashKit'
import { StatusDot } from '@/design'
import { queryKeys } from '@/lib/query/keys'
import { getAuditLogs } from '@services/ee/audit_logs'
import { getUriWithOrg } from '@services/config/config'
import { AuditSentence } from '@components/Dashboard/Pages/Org/OrgAuditLogs/auditUi'
import { outcomeStatus } from '@components/Dashboard/Pages/Org/OrgAuditLogs/auditFormat'
import { EventRow, ListSkeleton, P, QuietEmpty } from '../panelUi'
import { useMemberActivity, usePanelAuth } from '../panelState'

type Source = 'learning' | 'by' | 'about'
const PAGE = 20

export default function ActivityTab({
  userId,
  userUuid,
  name,
  auditLog,
}: {
  userId: number
  userUuid?: string
  name: string
  /** The org audit log is readable here (Enterprise, Admin role). */
  auditLog: boolean
}) {
  const { t } = useTranslation()
  const [source, setSource] = useState<Source>('learning')

  return (
    <div className="flex flex-col gap-3">
      {auditLog && (
        <div className="overflow-x-auto scrollbar-hide">
          <SegmentedControl<Source>
            value={source}
            onChange={setSource}
            ariaLabel={t(`${P}.activity.source`)}
            options={[
              { key: 'learning', label: t(`${P}.activity.learning`) },
              { key: 'by', label: t(`${P}.activity.by`) },
              { key: 'about', label: t(`${P}.activity.about`) },
            ]}
          />
        </div>
      )}
      {source === 'learning' ? (
        <LearningEvents userId={userId} name={name} />
      ) : (
        <AuditEntries
          key={source}
          filters={source === 'by' ? { actor_id: userId } : { target_type: 'user', target_id: userUuid }}
          emptyTitle={t(source === 'by' ? `${P}.activity.by_empty` : `${P}.activity.about_empty`, { name })}
        />
      )}
      {!auditLog && <p className="text-[11px] text-neutral-400 px-1">{t(`${P}.activity.audit_hint`)}</p>}
    </div>
  )
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (_p: number) => void }) {
  const { t } = useTranslation()
  const pages = Math.max(1, Math.ceil(total / PAGE))
  if (pages <= 1) return null
  const btn =
    'h-7 w-7 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 disabled:opacity-40 disabled:pointer-events-none'
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-neutral-100 text-xs text-neutral-500">
      <span className="tabular-nums">{t(`${P}.activity.count`, { count: total })}</span>
      <div className="flex items-center gap-1">
        <button type="button" className={btn} disabled={page === 0} onClick={() => onPage(page - 1)} aria-label={t('pagination.previous')}>
          <CaretLeft size={14} className="rtl:rotate-180" />
        </button>
        <span className="tabular-nums px-1 font-medium text-neutral-700">
          {page + 1} / {pages}
        </span>
        <button type="button" className={btn} disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label={t('pagination.next')}>
          <CaretRight size={14} className="rtl:rotate-180" />
        </button>
      </div>
    </div>
  )
}

function LearningEvents({ userId, name }: { userId: number; name: string }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(0)
  const { data, isLoading, isError, refetch, isFetching } = useMemberActivity(userId, page, PAGE)

  if (isLoading) return <ListSkeleton rows={5} />
  if (isError || !data) return <LoadError onRetry={refetch} />
  return (
    <div className={`bg-white rounded-2xl nice-shadow overflow-hidden transition-opacity ${isFetching ? 'opacity-70' : ''}`}>
      {data.items.length === 0 ? (
        <QuietEmpty icon={<Pulse size={18} />} title={t(`${P}.activity.empty`, { name })} hint={t(`${P}.activity.empty_hint`)} />
      ) : (
        <ul className="divide-y divide-neutral-100 py-1">
          {data.items.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </ul>
      )}
      <Pager page={page} total={data.total} onPage={setPage} />
    </div>
  )
}

function AuditEntries({ filters, emptyTitle }: { filters: Record<string, any>; emptyTitle: string }) {
  const { t, i18n } = useTranslation()
  const { orgId, token } = usePanelAuth()
  const params = useParams() as any
  const [page, setPage] = useState(0)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...queryKeys.org.auditLogs(orgId ?? 0), 'member', filters, page],
    queryFn: () => getAuditLogs(orgId!, token!, filters, page * PAGE, PAGE),
    enabled: !!orgId && !!token,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })

  if (isLoading) return <ListSkeleton rows={5} />
  if (isError || !data) return <LoadError onRetry={refetch} />
  return (
    <div className="bg-white rounded-2xl nice-shadow overflow-hidden">
      {data.items.length === 0 ? (
        <QuietEmpty icon={<ClipboardText size={18} />} title={emptyTitle} />
      ) : (
        <ul className="divide-y divide-neutral-100">
          {data.items.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 px-4 py-2.5">
              <StatusDot status={outcomeStatus(entry.outcome)} className="mt-2" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-neutral-600 break-words">
                  <AuditSentence entry={entry} />
                </p>
                <time className="text-[11px] text-neutral-400 tabular-nums" dateTime={entry.created_at}>
                  {formatRelative(entry.created_at.endsWith('Z') || entry.created_at.includes('+') ? entry.created_at : `${entry.created_at}Z`, i18n.language)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager page={page} total={data.total} onPage={setPage} />
      <div className="px-4 py-2.5 border-t border-neutral-100">
        <Link
          href={getUriWithOrg(params?.orgslug, '/dash/users/settings/audit-logs')}
          className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-500 hover:text-neutral-900"
        >
          {t(`${P}.activity.open_audit`)} <ArrowSquareOut size={12} />
        </Link>
      </div>
    </div>
  )
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="bg-white rounded-2xl nice-shadow">
      <QuietEmpty
        icon={<WarningCircle size={18} />}
        title={t(`${P}.load_error`)}
        action={
          <Button size="sm" onClick={onRetry}>
            {t(`${P}.retry`)}
          </Button>
        }
      />
    </div>
  )
}
