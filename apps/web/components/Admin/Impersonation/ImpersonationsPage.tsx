'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ClockCounterClockwise, Eye, PencilSimple, Prohibit, UserSwitch, UsersThree } from '@phosphor-icons/react'
import { Button, ConfirmDialog, DashPage, EmptyState, Panel, StatusPill, SubTabPanel, SubTabs } from '@/design'
import { errorMessage, listImpersonations, revokeImpersonation } from '@services/ee/platform/api'
import { shouldRetry, useAccessToken, usePlatformMe } from '@components/Admin/hooks'
import { AdminHeader, CopyLinkButton, ListSkeleton, NoAccess, Pagination, QueryError, adminPath } from '@components/Admin/Shared/AdminKit'
import { useUrlTab } from '@components/Admin/Shared/OpsKit'
import { broadcastImpersonationEnded, type ImpersonationSession } from '@/lib/auth/impersonation'

// Impersonations: who is acting as whom right now (with Revoke), and the
// history. Starting one lives on org and user pages (or opening an org).

const TABS = ['active', 'history'] as const
type Tab = (typeof TABS)[number]
const LIMIT = 25

function useNow(active: boolean) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

function left(expires: string | null, now: number): string {
  const ms = expires ? Date.parse(expires) - now : 0
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

function when(iso: string | null, lang: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function ModePill({ mode }: { mode: string }) {
  const { t } = useTranslation()
  return mode === 'full' ? (
    <StatusPill status="danger">
      <PencilSimple size={11} weight="bold" />
      {t('admin.impersonation.full')}
    </StatusPill>
  ) : (
    <StatusPill status="info">
      <Eye size={11} weight="bold" />
      {t('admin.impersonation.read_only')}
    </StatusPill>
  )
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  const tone = status === 'active' ? 'success' : status === 'revoked' ? 'danger' : status === 'expired' ? 'warning' : 'neutral'
  return (
    <StatusPill status={tone as any} dot>
      {t(`admin.impersonation.status_${status}`, { defaultValue: status })}
    </StatusPill>
  )
}

function SessionRow({
  s,
  now,
  canRevoke,
  onRevoke,
}: {
  s: ImpersonationSession
  now: number
  canRevoke: boolean
  onRevoke: (_session: ImpersonationSession) => void
}) {
  const { t, i18n } = useTranslation()
  const active = s.status === 'active'
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center" data-testid={`impersonation-row-${s.session_uuid}`}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${s.target.kind === 'role' ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-800'}`}>
          {s.target.kind === 'role' ? <UsersThree size={16} /> : <UserSwitch size={16} />}
        </span>
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-neutral-600">
            {s.impersonator?.user_id ? (
              <Link href={adminPath.user(s.impersonator.user_id)} className="font-semibold text-neutral-900 hover:underline">
                {s.impersonator.label}
              </Link>
            ) : (
              <span className="font-semibold text-neutral-900">{s.impersonator?.label}</span>
            )}
            <span>{t('admin.impersonation.as')}</span>
            {s.target.user_id ? (
              <Link href={adminPath.user(s.target.user_id)} className="font-semibold text-neutral-900 hover:underline">
                {s.target.label}
              </Link>
            ) : (
              <span className="font-semibold text-neutral-900">{s.target.label}</span>
            )}
            {s.target.role_label && <span className="text-neutral-400">· {s.target.role_label}</span>}
            <span>{t('admin.impersonation.in')}</span>
            {s.org?.id ? (
              <Link href={adminPath.org(s.org.id)} className="font-semibold text-neutral-900 hover:underline">
                {s.org.name ?? `#${s.org.id}`}
              </Link>
            ) : (
              <span>—</span>
            )}
          </p>
          <p className="text-xs text-neutral-500">
            {t('admin.impersonation.started_at', { when: when(s.created_at, i18n.language) })}
            {!active && s.ended_at && <> · {t('admin.impersonation.ended_at', { when: when(s.ended_at, i18n.language) })}</>}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <ModePill mode={s.mode} />
        {active ? (
          <span className="tabular-nums text-sm font-semibold text-neutral-800" title={when(s.expires_at, i18n.language)}>
            {t('admin.impersonation.left', { time: left(s.expires_at, now) })}
          </span>
        ) : (
          <StatusBadge status={s.status} />
        )}
        {active && canRevoke && (
          <Button size="sm" variant="danger" icon={<Prohibit size={13} />} onClick={() => onRevoke(s)} data-testid={`impersonation-revoke-${s.session_uuid}`}>
            {t('admin.impersonation.revoke')}
          </Button>
        )}
      </div>
    </div>
  )
}

export default function ImpersonationsPage() {
  const { t } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const qc = useQueryClient()
  const [tab, setTab] = useUrlTab<Tab>(TABS, 'active')
  const [page, setPage] = React.useState(1)
  const [revoking, setRevoking] = React.useState<ImpersonationSession | null>(null)
  const allowed = me.can('impersonation.readonly') || me.can('audit.read')

  React.useEffect(() => setPage(1), [tab])

  const res = useQuery({
    queryKey: ['platform', 'impersonations', tab, page],
    queryFn: () => listImpersonations(token, { status: tab, page, limit: LIMIT }),
    enabled: !!token && allowed,
    retry: shouldRetry,
    refetchInterval: tab === 'active' ? 15_000 : false,
    placeholderData: (prev) => prev,
  })
  const items = Array.isArray(res.data?.items) ? res.data!.items : []
  const now = useNow(tab === 'active' && items.length > 0)

  if (!me.isLoading && !allowed) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.impersonation.title')} />
        <NoAccess />
      </DashPage>
    )
  }

  const canRevoke = (s: ImpersonationSession) =>
    me.can('impersonation.full') || (me.can('impersonation.readonly') && s.impersonator?.user_id === me.userId)

  const revoke = async () => {
    if (!revoking) return
    try {
      await revokeImpersonation(token, revoking.session_uuid)
      // Tabs of this browser still on that session leave it at once.
      broadcastImpersonationEnded(revoking.session_uuid)
      toast.success(t('admin.impersonation.revoked_toast'))
      qc.invalidateQueries({ queryKey: ['platform', 'impersonations'] })
    } catch (err) {
      toast.error(errorMessage(err, t('admin.common.error_desc')))
    }
  }

  return (
    <DashPage>
      <AdminHeader
        title={t('admin.impersonation.title')}
        subtitle={t('admin.impersonation.subtitle')}
        actions={
          <>
            <CopyLinkButton label="" />
          </>
        }
      />
      <SubTabs
        items={[
          { key: 'active' as const, label: t('admin.impersonation.tab_active'), icon: <UserSwitch size={15} className="text-amber-600" /> },
          { key: 'history' as const, label: t('admin.impersonation.tab_history'), icon: <ClockCounterClockwise size={15} className="text-sky-600" /> },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t('admin.impersonation.title')}
      >
        <SubTabPanel tab={tab}>
          {res.isLoading ? (
            <ListSkeleton rows={3} />
          ) : res.error ? (
            <QueryError error={res.error} onRetry={() => res.refetch()} />
          ) : items.length === 0 ? (
            <Panel>
              <EmptyState
                icon={<UserSwitch size={22} />}
                title={tab === 'active' ? t('admin.impersonation.none_active') : t('admin.impersonation.none_history')}
                description={tab === 'active' ? t('admin.impersonation.none_active_desc') : undefined}
              />
            </Panel>
          ) : (
            <div className="space-y-3">
              <Panel divided>
                {items.map((s) => (
                  <SessionRow key={s.session_uuid} s={s} now={now} canRevoke={canRevoke(s)} onRevoke={setRevoking} />
                ))}
              </Panel>
              <Pagination page={page} total={res.data?.total ?? 0} limit={LIMIT} onPage={setPage} />
            </div>
          )}
        </SubTabPanel>
      </SubTabs>
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        tone="danger"
        title={t('admin.impersonation.revoke_title')}
        message={t('admin.impersonation.revoke_desc', { name: revoking?.target.label ?? '', who: revoking?.impersonator?.label ?? '' })}
        confirmLabel={t('admin.impersonation.revoke')}
        onConfirm={revoke}
      />
    </DashPage>
  )
}
