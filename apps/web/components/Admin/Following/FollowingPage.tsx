'use client'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import {
  Bell,
  Buildings,
  CalendarBlank,
  CreditCard,
  EnvelopeSimple,
  Eye,
  Hash,
  Lightning,
  PencilSimple,
  ShieldCheck,
} from '@phosphor-icons/react'
import { Button, DashPage, EmptyState, Panel, Skeleton, buttonClass, formatRelative } from '@/design'
import { getFollowFeed, opsKeys, type Follow } from '@services/ee/platform/ops'
import type { UnifiedEvent } from '@services/ee/platform/types'
import { useAccessToken, useListKeyboard, usePlatformMe, useUrlQuery, shouldRetry } from '@components/Admin/hooks'
import {
  AdminHeader,
  CopyLinkButton,
  ListSkeleton,
  NoAccess,
  OrgLogo,
  Pagination,
  PlanChip,
  QueryError,
  adminPath,
  formatDate,
  orgDisplayName,
} from '@components/Admin/Shared/AdminKit'
import FilterBar, { filterKeys, resolveDate, type FilterDef } from '@components/Admin/Shared/FilterBar'
import { IconTile, ToneCard } from '@components/Admin/Shared/OpsKit'
import { FollowForm, LevelChip, useFollows } from './FollowButton'

// /admin/following: the orgs I follow (level + delivery, edit / unfollow)
// and one merged feed of what they're doing (GET /follows/feed, the unified
// audit filters + level). Filters live in the URL.

const PAGE_SIZE = 25

export default function FollowingPage() {
  const { t } = useTranslation()
  const me = usePlatformMe()
  const { follows, isLoading, error, refetch } = useFollows()

  if (!me.isLoading && !me.can('platform.read')) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.following.title')} />
        <NoAccess />
      </DashPage>
    )
  }

  return (
    <DashPage>
      <AdminHeader
        title={t('admin.following.title')}
        subtitle={t('admin.following.subtitle')}
        actions={
          <>
            <CopyLinkButton />
            <Link
              href="/admin/organizations"
              className={buttonClass('primary', 'md')}
            >
              <Buildings size={14} />
              {t('admin.following.find_orgs')}
            </Link>
          </>
        }
      />

      <ToneCard
        icon={<Eye size={18} weight="duotone" />}
        tone="indigo"
        title={t('admin.following.orgs_title')}
        description={follows.length ? t('admin.following.orgs_count', { count: follows.length }) : t('admin.following.orgs_desc')}
        bodyClassName="p-5 pt-4"
      >
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[76px] rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <QueryError error={error} onRetry={() => refetch()} compact />
        ) : follows.length === 0 ? (
          <EmptyState
            icon={<Eye size={22} />}
            title={t('admin.following.empty_title')}
            description={t('admin.following.empty_desc')}
            action={
              <Link href="/admin/organizations" className="text-sm font-semibold text-neutral-900 underline underline-offset-2">
                {t('admin.following.find_orgs')}
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {follows.map((f) => (
              <FollowCard key={f.org_id} follow={f} />
            ))}
          </div>
        )}
      </ToneCard>

      {follows.length > 0 && <Feed follows={follows} />}
    </DashPage>
  )
}

function FollowCard({ follow }: { follow: Follow }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const org = follow.org
  const name = orgDisplayName({ id: follow.org_id, name: org?.name }, t)
  return (
    <div className="flex items-start gap-3 rounded-xl ring-1 ring-inset ring-neutral-200/80 p-3 min-w-0">
      <Link href={adminPath.org(follow.org_id)} className="shrink-0">
        <OrgLogo org={org ?? {}} size={36} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Link href={adminPath.org(follow.org_id)} className="truncate text-sm font-semibold text-neutral-900 hover:underline underline-offset-2">
            {name}
          </Link>
          {(follow.unread ?? 0) > 0 && (
            <span className="shrink-0 h-4 min-w-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-semibold tabular-nums inline-flex items-center justify-center" title={t('admin.following.unread', { count: follow.unread })}>
              {follow.unread}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <PlanChip plan={org?.plan} />
          <LevelChip level={follow.level} />
          <span className="inline-flex items-center gap-1 text-neutral-400">
            {follow.deliver_inbox && <Bell size={13} className="text-rose-600" aria-label={t('admin.following.inbox')} />}
            {follow.deliver_email && <EnvelopeSimple size={13} className="text-sky-600" aria-label={t('admin.following.email')} />}
            {follow.channel_uuid && <Hash size={13} className="text-violet-600" aria-label={t('admin.following.channel')} />}
          </span>
        </div>
        {follow.level === 'custom' && follow.event_types.length > 0 && (
          <p className="mt-1 text-[11px] text-neutral-400 truncate">{follow.event_types.map((k) => t(`admin.following.keys.${k}`, { defaultValue: k })).join(', ')}</p>
        )}
      </div>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={t('admin.following.edit_named', { name })}
            title={t('admin.following.edit')}
            className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100"
          >
            <PencilSimple size={14} />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="w-[min(20rem,calc(100vw-2rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl bg-white p-3 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.25)] ring-1 ring-neutral-200/80 focus:outline-none"
            style={{ zIndex: 'var(--z-popover)' as any }}
          >
            <p className="px-1 pb-2 text-sm font-semibold text-neutral-900 truncate">{t('admin.following.popover_title_named', { name })}</p>
            <FollowForm orgId={follow.org_id} follow={follow} onDone={() => setOpen(false)} />
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  )
}

function Feed({ follows }: { follows: Follow[] }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const router = useRouter()
  const [values, setValues] = useUrlQuery()
  const page = Math.max(1, Number(values.page) || 1)

  const query = React.useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      q: values.q || undefined,
      org_id: values.org_id || undefined,
      org_plan: values.org_plan || undefined,
      level: values.level || undefined,
      since: resolveDate(values.since),
      until: resolveDate(values.until, true),
    }),
    [values, page]
  )
  const q = useQuery({
    queryKey: opsKeys.feed(query),
    queryFn: () => getFollowFeed(token, query),
    enabled: !!token,
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })
  const items: UnifiedEvent[] = Array.isArray(q.data?.items) ? q.data!.items : []
  const canAudit = me.can('audit.read')
  const open = (e: UnifiedEvent) => router.push(canAudit ? adminPath.event(e.id) : e.org_id ? adminPath.org(e.org_id) : '/admin/following')
  const kb = useListKeyboard(items, open)

  const defs: FilterDef[] = [
    {
      key: 'org_id',
      kind: 'select',
      label: t('admin.following.filters.org'),
      icon: <Buildings size={14} />,
      options: follows.map((f) => ({ value: String(f.org_id), label: orgDisplayName({ id: f.org_id, name: f.org?.name }, t) })),
    },
    {
      key: 'org_plan',
      kind: 'select',
      label: t('admin.following.filters.plan'),
      icon: <CreditCard size={14} />,
      options: ['free', 'paid', 'standard', 'pro', 'enterprise'].map((p) => ({ value: p, label: p === 'paid' ? t('admin.users.paid_plans') : t(`admin.plans.${p}`) })),
    },
    {
      key: 'level',
      kind: 'select',
      label: t('admin.following.filters.level'),
      icon: <Lightning size={14} />,
      options: ['important', 'all'].map((l) => ({ value: l, label: t(`admin.following.feed_level.${l}`) })),
    },
    { key: 'date', kind: 'date', label: t('admin.following.filters.date'), icon: <CalendarBlank size={14} />, sinceKey: 'since', untilKey: 'until' },
  ]
  const filtered = !!values.q || filterKeys(defs).some((k) => !!values[k])
  const clear = () => {
    const u: Record<string, undefined> = { q: undefined, page: undefined }
    for (const k of filterKeys(defs)) u[k] = undefined
    setValues(u)
  }

  return (
    <section className="space-y-3 min-w-0">
      <div className="flex items-center gap-3">
        <IconTile icon={<Lightning size={18} weight="duotone" />} tone="amber" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-neutral-900 leading-tight">{t('admin.following.feed_title')}</h2>
          <p className="mt-0.5 text-sm text-neutral-500">{t('admin.following.feed_desc')}</p>
        </div>
      </div>
      <FilterBar
        values={values}
        onChange={setValues}
        defs={defs}
        search={{ key: 'q', placeholder: t('admin.following.feed_search') }}
        savedViewsKey="lh:admin:views:follows"
      />
      {q.data?.redacted && (
        <p className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
          <ShieldCheck size={13} className="text-amber-600" />
          {t('admin.following.redacted')}
        </p>
      )}
      {q.isLoading ? (
        <ListSkeleton rows={6} />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Lightning size={22} />}
            title={filtered ? t('admin.following.feed_no_match') : t('admin.following.feed_empty')}
            description={filtered ? t('admin.following.feed_no_match_desc') : t('admin.following.feed_empty_desc')}
            action={
              filtered ? (
                <Button size="sm" onClick={clear}>
                  {t('admin.filters.clear_all')}
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <>
          <Panel divided className={q.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
            {items.map((e, i) => (
              <div
                key={e.id}
                {...kb.rowProps(i)}
                onClick={() => open(e)}
                className="flex items-start gap-3 px-5 py-3 cursor-pointer hover:bg-neutral-50 data-[active=true]:bg-neutral-50 min-w-0"
              >
                <FeedDot event={e} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-neutral-900 break-words">{e.summary || e.action}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-400 min-w-0">
                    {e.org_id && (
                      <Link href={adminPath.org(e.org_id)} onClick={(ev) => ev.stopPropagation()} className="font-medium text-neutral-600 hover:underline underline-offset-2 truncate">
                        {e.org_name || `#${e.org_id}`}
                      </Link>
                    )}
                    {e.actor_label && !q.data?.redacted && (
                      <>
                        <span>·</span>
                        {e.actor_user_id ? (
                          <Link href={adminPath.user(e.actor_user_id)} onClick={(ev) => ev.stopPropagation()} className="hover:underline underline-offset-2 truncate">
                            {e.actor_label}
                          </Link>
                        ) : (
                          <span className="truncate">{e.actor_label}</span>
                        )}
                      </>
                    )}
                    <span>·</span>
                    <code className="font-mono text-[11px]" dir="ltr">
                      {e.action}
                    </code>
                  </div>
                </div>
                <span className="shrink-0 text-xs text-neutral-400 whitespace-nowrap" title={formatDate(e.created_at, i18n.language, true)}>
                  {formatRelative(e.created_at, i18n.language)}
                </span>
              </div>
            ))}
          </Panel>
          <Pagination page={page} total={q.data?.total ?? 0} limit={PAGE_SIZE} onPage={(p) => setValues({ page: p === 1 ? undefined : String(p) })} />
        </>
      )}
    </section>
  )
}

const SOURCE_DOT: Record<string, string> = { org: 'bg-sky-500', platform: 'bg-violet-500' }
const OUTCOME_DOT: Record<string, string> = { failed: 'bg-rose-500', denied: 'bg-rose-500', error: 'bg-rose-500' }

function FeedDot({ event }: { event: UnifiedEvent }) {
  const cls = OUTCOME_DOT[event.outcome ?? ''] ?? SOURCE_DOT[event.source] ?? 'bg-neutral-400'
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${cls}`} aria-hidden="true" />
}
