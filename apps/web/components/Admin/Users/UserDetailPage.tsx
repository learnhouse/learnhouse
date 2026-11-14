'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { UserSwitch } from '@phosphor-icons/react'
import { useImpersonate } from '@components/Admin/Impersonation/useImpersonate'
import {
  ArrowSquareOut,
  Buildings,
  CalendarBlank,
  CheckCircle,
  ClockCounterClockwise,
  EnvelopeSimple,
  Handshake,
  IdentificationBadge,
  ListChecks,
  ShieldStar,
  SignIn,
  Star,
  User,
  WarningCircle,
} from '@phosphor-icons/react'
import {
  Chip,
  Button,
  DashPage,
  EmptyState,
  Panel,
  SectionCard,
  StatCard,
  StatusPill,
  SubTabs,
  SubTabPanel,
  buttonClass,
  formatRelative,
  useSubTab,
} from '@/design'
import { getUser, isNotAvailable, listUsers } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { UnifiedEvent, UserDetail, UserDetailOrg } from '@services/ee/platform/types'
import { useAccessToken, usePlatformMe, shouldRetry } from '@components/Admin/hooks'
import {
  AdminHeader,
  Avatar,
  CopyLinkButton,
  KeyValue,
  ListSkeleton,
  NoAccess,
  OrgLogo,
  PlanChip,
  LifecycleChip,
  QueryError,
  RoleBadge,
  adminPath,
  daysUntil,
  formatDate,
} from '@components/Admin/Shared/AdminKit'

const SECTIONS = ['overview', 'orgs', 'activity', 'ownership'] as const

/**
 * GET /users/{id}; on servers without it, the user list row is the fallback
 * (profile basics + orgs), and the missing parts say so.
 */
async function loadUser(token: string | undefined, id: string): Promise<{ user: UserDetail | null; partial: boolean; error?: unknown }> {
  try {
    return { user: await getUser(token, id), partial: false }
  } catch (err) {
    if (!isNotAvailable(err)) throw err
    const res = await listUsers(token, { q: id, search: id, limit: 50, page: 1 }).catch(() => ({ items: [] as any[] }))
    const items = Array.isArray(res?.items) ? res.items : []
    const row = items.find((u: any) => String(u.id) === String(id))
    if (!row) return { user: null, partial: true, error: err }
    const orgs: UserDetailOrg[] = (Array.isArray(row.orgs) ? row.orgs : []).map((o: any) => ({ id: o.id, name: o.name, slug: o.slug, role_name: o.role_name }))
    return { user: { ...row, orgs }, partial: true, error: err }
  }
}

function eventsOf(u: UserDetail): UnifiedEvent[] {
  // The API names it `activity` (§10.2); older drafts used recent_events.
  const list = u.activity ?? u.recent_events ?? u.recent_activity
  return Array.isArray(list) ? list : []
}

export default function UserDetailPage({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const [section, setSection] = useSubTab('overview', SECTIONS, { rememberAs: 'admin-user-detail' })
  const { impersonate, busy: impersonating } = useImpersonate()

  const q = useQuery({
    queryKey: platformKeys.user(userId),
    queryFn: () => loadUser(token, userId),
    enabled: !!token && me.can('platform.read'),
    retry: shouldRetry,
  })

  if (!me.isLoading && !me.can('platform.read')) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.user_detail.title')} crumbs={[{ label: t('admin.pages.users'), href: '/admin/users' }]} />
        <NoAccess />
      </DashPage>
    )
  }

  const crumbs = [{ label: t('admin.pages.users'), href: '/admin/users' }]

  if (q.isLoading) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.user_detail.title')} crumbs={crumbs} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <StatCard key={i} icon={<User size={18} />} iconClass="bg-neutral-100 text-neutral-500" label="" value={null} />
          ))}
        </div>
        <ListSkeleton rows={4} />
      </DashPage>
    )
  }

  if (q.error || !q.data?.user) {
    const err = q.error ?? q.data?.error
    return (
      <DashPage>
        <AdminHeader title={t('admin.user_detail.title')} crumbs={crumbs} />
        {q.data && !q.data.user ? (
          <Panel>
            <EmptyState
              icon={<User size={22} />}
              title={t('admin.user_detail.not_found')}
              description={t('admin.user_detail.not_found_desc', { id: userId })}
              action={
                <Link href="/admin/users" className={buttonClass('secondary', 'sm')}>
                  {t('admin.user_detail.back_to_users')}
                </Link>
              }
            />
          </Panel>
        ) : (
          <QueryError error={err} onRetry={() => q.refetch()} />
        )}
      </DashPage>
    )
  }

  const u = q.data.user
  const partial = q.data.partial
  const orgs = Array.isArray(u.organizations) ? u.organizations : Array.isArray(u.orgs) ? u.orgs : []
  const events = eventsOf(u)
  const pocs = Array.isArray(u.pocs) ? u.pocs : Array.isArray(u.owned_pocs) ? u.owned_pocs : []
  const tasks = Array.isArray(u.tasks) ? u.tasks : []
  const follows = Array.isArray(u.follows) ? u.follows : []
  const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ')
  const created = u.creation_date ?? u.created_at
  const platformRole = u.platform_role ?? u.team?.role ?? (u.is_superadmin ? 'owner' : null)
  const activityHref = `/admin/activity?actor_user_id=${u.id}`

  return (
    <DashPage bottom="lg">
      <AdminHeader
        title={u.username}
        crumbs={crumbs}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 mt-1">
            <Avatar user={{ user_uuid: u.user_uuid, avatar_image: u.avatar_image, username: u.username }} size={22} />
            {fullName && <span className="text-neutral-600">{fullName}</span>}
            <span className="inline-flex items-center gap-1 text-neutral-500">
              <EnvelopeSimple size={13} />
              {u.email}
            </span>
            {u.email_verified === true && (
              <StatusPill status="success" icon={<CheckCircle size={12} weight="fill" />}>
                {t('admin.users.verified')}
              </StatusPill>
            )}
            {u.email_verified === false && (
              <StatusPill status="warning" icon={<WarningCircle size={12} weight="fill" />}>
                {t('admin.users.unverified')}
              </StatusPill>
            )}
            {platformRole && (
              <Link href="/admin/team" title={t('admin.users.open_team')} className="inline-flex items-center gap-1">
                <ShieldStar size={13} weight="fill" className="text-amber-500" />
                <RoleBadge role={platformRole} />
              </Link>
            )}
          </span>
        }
        actions={
          <>
            <CopyLinkButton />
            {me.can('impersonation.readonly') && !u.is_superadmin && !platformRole && orgs.length > 0 && (
              <Button
                icon={<UserSwitch size={14} />}
                loading={impersonating}
                onClick={() => void impersonate({ orgId: orgs[0].id, userId: u.id, slug: orgs[0].slug })}
                data-testid="user-impersonate"
              >
                {t('admin.impersonation.impersonate')}
              </Button>
            )}
            <Link href={activityHref} className={buttonClass('primary', 'md')}>
              <ClockCounterClockwise size={14} />
              {t('admin.user_detail.view_activity')}
            </Link>
          </>
        }
      />

      {partial && (
        <div className="flex items-start gap-2 text-sm text-amber-700">
          <WarningCircle size={16} className="mt-0.5 shrink-0" />
          {t('admin.user_detail.partial')}
        </div>
      )}

      <SubTabs
        ariaLabel={t('admin.user_detail.sections')}
        value={section}
        onChange={setSection}
        items={[
          { key: 'overview', label: t('admin.user_detail.overview'), icon: <User size={15} /> },
          { key: 'orgs', label: t('admin.user_detail.orgs'), icon: <Buildings size={15} />, badge: <span className="text-[11px] tabular-nums text-neutral-400">{orgs.length}</span> },
          { key: 'activity', label: t('admin.user_detail.activity'), icon: <ClockCounterClockwise size={15} /> },
          { key: 'ownership', label: t('admin.user_detail.ownership'), icon: <Handshake size={15} /> },
        ]}
      >
        <SubTabPanel tab="overview">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={<Buildings size={18} />} iconClass="bg-sky-50 text-sky-600" label={t('admin.user_detail.orgs')} value={orgs.length} />
            <StatCard
              icon={<ClockCounterClockwise size={18} />}
              iconClass="bg-violet-50 text-violet-600"
              label={t('admin.user_detail.recent_events')}
              value={partial ? '–' : events.length}
            />
            <StatCard icon={<Handshake size={18} />} iconClass="bg-amber-50 text-amber-600" label={t('admin.user_detail.pocs_owned')} value={partial ? '–' : pocs.length} />
            <StatCard icon={<ListChecks size={18} />} iconClass="bg-emerald-50 text-emerald-600" label={t('admin.user_detail.tasks')} value={partial ? '–' : tasks.length} />
          </div>
          <SectionCard icon={<IdentificationBadge size={18} />} title={t('admin.user_detail.profile')} description={t('admin.user_detail.profile_desc')}>
            <div className="divide-y divide-neutral-100">
              <KeyValue label={t('admin.user_detail.user_id')} mono>
                #{u.id}
              </KeyValue>
              {u.user_uuid && (
                <KeyValue label="UUID" mono>
                  <span dir="ltr">{u.user_uuid}</span>
                </KeyValue>
              )}
              <KeyValue label={t('admin.users.signup_method')}>
                {u.signup_method && u.signup_method !== 'none' ? t(`admin.users.signup.${u.signup_method}`, { defaultValue: u.signup_method }) : '–'}
              </KeyValue>
              <KeyValue label={t('admin.users.signed_up')}>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarBlank size={13} className="text-neutral-400" />
                  {formatDate(created, i18n.language)}
                </span>
              </KeyValue>
              <KeyValue label={t('admin.users.last_login')}>
                <span className="inline-flex items-center gap-1.5" title={formatDate(u.last_login_at, i18n.language, true)}>
                  <SignIn size={13} className="text-neutral-400" />
                  {formatRelative(u.last_login_at ?? null, i18n.language) ?? t('admin.user_detail.never')}
                </span>
              </KeyValue>
            </div>
          </SectionCard>
        </SubTabPanel>

        <SubTabPanel tab="orgs">
          {orgs.length === 0 ? (
            <Panel>
              <EmptyState icon={<Buildings size={22} />} title={t('admin.user_detail.no_orgs')} description={t('admin.user_detail.no_orgs_desc')} />
            </Panel>
          ) : (
            <Panel divided>
              {orgs.map((o) => (
                <Link key={o.id} href={adminPath.org(o.id)} className="flex items-center gap-3 px-5 py-3.5 hover:bg-neutral-50">
                  <OrgLogo org={o} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-neutral-900 truncate">{o.name}</p>
                    <p className="text-xs text-neutral-500 truncate">
                      <span dir="ltr">{o.slug ?? `#${o.id}`}</span>
                      {o.joined_at ? ` · ${t('admin.user_detail.joined', { date: formatDate(o.joined_at, i18n.language) })}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {(o.role ?? o.role_name) && <Chip>{o.role ?? o.role_name}</Chip>}
                    <PlanChip plan={o.plan} />
                    {o.lifecycle && o.lifecycle !== 'active' && <LifecycleChip lifecycle={o.lifecycle} />}
                  </div>
                </Link>
              ))}
            </Panel>
          )}
        </SubTabPanel>

        <SubTabPanel tab="activity">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-neutral-500">{t('admin.user_detail.activity_desc')}</p>
            <Link href={activityHref} className={buttonClass('secondary', 'sm')}>
              {t('admin.user_detail.view_all_activity')}
              <ArrowSquareOut size={13} className="rtl:-scale-x-100" />
            </Link>
          </div>
          {partial ? (
            <QueryError error={q.data.error} />
          ) : events.length === 0 ? (
            <Panel>
              <EmptyState icon={<ClockCounterClockwise size={22} />} title={t('admin.user_detail.no_events')} description={t('admin.user_detail.no_events_desc')} />
            </Panel>
          ) : (
            <Panel divided>
              {events.slice(0, 20).map((e) => (
                <Link key={e.id} href={adminPath.event(e.id)} className="flex items-start gap-3 px-5 py-3 hover:bg-neutral-50">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      e.outcome === 'failure' || e.outcome === 'denied' ? 'bg-rose-500' : e.source === 'platform' ? 'bg-violet-500' : 'bg-sky-500'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-neutral-900 break-words">{e.summary || e.action}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutral-400">
                      <code dir="ltr" className="font-mono text-[11px] text-neutral-500">
                        {e.action}
                      </code>
                      {e.org_name && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{e.org_name}</span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <time dateTime={e.created_at} title={formatDate(e.created_at, i18n.language, true)}>
                        {formatRelative(e.created_at, i18n.language) ?? '–'}
                      </time>
                    </p>
                  </div>
                </Link>
              ))}
            </Panel>
          )}
        </SubTabPanel>

        <SubTabPanel tab="ownership">
          {partial ? (
            <QueryError error={q.data.error} />
          ) : pocs.length + tasks.length + follows.length === 0 ? (
            <Panel>
              <EmptyState icon={<Handshake size={22} />} title={t('admin.user_detail.no_ownership')} description={t('admin.user_detail.no_ownership_desc')} />
            </Panel>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {pocs.length > 0 && (
                <SectionCard icon={<Handshake size={18} />} title={t('admin.user_detail.pocs_owned')} description={t('admin.user_detail.pocs_owned_desc')} bodyClassName="pt-3">
                  <div className="divide-y divide-neutral-100">
                    {pocs.map((p) => {
                      const orgId = p.id ?? p.org_id
                      const left = daysUntil(p.poc_ends_at)
                      return (
                        <Link key={orgId} href={adminPath.org(orgId as number, 'poc')} className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">{p.name ?? p.org_name}</span>
                          {p.poc_outcome ? (
                            <StatusPill status={p.poc_outcome === 'won' ? 'success' : 'neutral'}>{t(`admin.user_detail.outcome.${p.poc_outcome}`, { defaultValue: String(p.poc_outcome) })}</StatusPill>
                          ) : left !== null ? (
                            <StatusPill status={left < 0 ? 'danger' : left <= 3 ? 'warning' : 'info'}>{t('admin.user_detail.days_left', { count: left })}</StatusPill>
                          ) : null}
                        </Link>
                      )
                    })}
                  </div>
                </SectionCard>
              )}
              {tasks.length > 0 && (
                <SectionCard icon={<ListChecks size={18} />} title={t('admin.user_detail.tasks')} description={t('admin.user_detail.tasks_desc')} bodyClassName="pt-3">
                  <div className="divide-y divide-neutral-100">
                    {tasks.map((task, i) => {
                      const uuid = task.task_uuid ?? task.uuid
                      return (
                        <Link
                          key={uuid ?? i}
                          href={uuid ? `/admin/tasks?task=${encodeURIComponent(uuid)}` : '/admin/tasks'}
                          className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-neutral-900">{task.title ?? uuid}</span>
                            {task.org_name && <span className="block truncate text-xs text-neutral-500">{task.org_name}</span>}
                          </span>
                          {task.status && <Chip>{task.status}</Chip>}
                        </Link>
                      )
                    })}
                  </div>
                </SectionCard>
              )}
              {follows.length > 0 && (
                <SectionCard icon={<Star size={18} />} title={t('admin.user_detail.follows')} description={t('admin.user_detail.follows_desc')} bodyClassName="pt-3">
                  <div className="divide-y divide-neutral-100">
                    {follows.map((f, i) =>
                      f.org_id ? (
                        <Link key={f.org_id} href={adminPath.org(f.org_id)} className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50">
                          <Buildings size={15} className="text-neutral-400" />
                          <span className="min-w-0 flex-1 truncate text-sm text-neutral-900">{f.org_name ?? f.name ?? `#${f.org_id}`}</span>
                          {f.level && <Chip>{f.level}</Chip>}
                        </Link>
                      ) : (
                        <div key={i} className="px-5 py-3 text-sm text-neutral-700">
                          {f.org_name ?? f.name}
                        </div>
                      )
                    )}
                  </div>
                </SectionCard>
              )}
            </div>
          )}
        </SubTabPanel>
      </SubTabs>
    </DashPage>
  )
}

