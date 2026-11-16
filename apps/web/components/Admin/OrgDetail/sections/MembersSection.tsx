'use client'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { CalendarBlank, CaretRight, ShieldStar, Users } from '@phosphor-icons/react'
import { Button, Chip, EmptyState, Panel, recipes } from '@/design'
import { facetList, saRequest } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { Paginated } from '@services/ee/platform/types'
import { useAccessToken, useListKeyboard, useUrlQuery, shouldRetry } from '@components/Admin/hooks'
import { Avatar, ListSkeleton, Pagination, QueryError, adminPath, formatDate } from '@components/Admin/Shared/AdminKit'
import FilterBar, { filterKeys, resolveDate, type FilterDef } from '@components/Admin/Shared/FilterBar'

const LIMIT = 20
// URL keys are prefixed so the Members and Courses tabs keep separate filters.
const K = { q: 'm_q', role: 'm_role', since: 'm_joined_since', until: 'm_joined_until', page: 'm_page' } as const
const DEFAULT_ROLES = ['Admin', 'Maintainer', 'Instructor', 'User']

function inRange(value: string | null | undefined, since?: string, until?: string): boolean {
  if (!since && !until) return true
  if (!value) return false
  const t = new Date(value).getTime()
  if (since && t < new Date(since).getTime()) return false
  if (until && t > new Date(until).getTime()) return false
  return true
}

export default function MembersSection({ orgId }: { orgId: string }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const [url, setUrl] = useUrlQuery()
  const q = url[K.q] ?? ''
  const role = url[K.role]
  const since = resolveDate(url[K.since])
  const until = resolveDate(url[K.until], true)
  const page = Math.max(1, Number(url[K.page]) || 1)

  // `search` is the pre-§8 name of `q`; joined_* is what the API filters on.
  const query = { page, limit: LIMIT, search: q, q, role, joined_since: since, joined_until: until }
  const usersQ = useQuery({
    queryKey: [...platformKeys.orgUsers(orgId, page, q), { role, since, until }],
    queryFn: () => saRequest<Paginated<any> & { facets?: Record<string, unknown> }>(`/organizations/${orgId}/users`, token, { query }),
    enabled: !!token,
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })

  const raw: any[] = Array.isArray(usersQ.data?.items) ? usersQ.data!.items : []
  // Client-side pass for filters an older server doesn't apply.
  const items = raw.filter((u) => {
    if (role && String(u.role_name || '').toLowerCase() !== role.toLowerCase()) return false
    if (!inRange(u.creation_date, since, until)) return false
    if (q) {
      const hay = `${u.username ?? ''} ${u.email ?? ''} ${u.first_name ?? ''} ${u.last_name ?? ''}`.toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  })
  const total = usersQ.data?.total ?? 0
  const router = useRouter()
  const kb = useListKeyboard(items, (u) => router.push(adminPath.user(u.id)))

  const roleFacets = facetList(usersQ.data?.facets?.roles ?? usersQ.data?.facets?.role)
  const roleOptions = (roleFacets.length ? roleFacets.map((f) => f.value) : DEFAULT_ROLES).map((r) => ({
    value: r,
    label: r,
    count: roleFacets.find((f) => f.value === r)?.count,
  }))
  const defs: FilterDef[] = [
    { key: K.role, kind: 'select', label: t('admin.org_detail.role'), icon: <ShieldStar size={14} />, options: roleOptions },
    { key: 'm_joined', kind: 'date', sinceKey: K.since, untilKey: K.until, label: t('admin.org_detail.joined'), icon: <CalendarBlank size={14} /> },
  ]
  const filtered = !!(q || role || since || until)
  const clear = () => {
    const u: Record<string, undefined> = { [K.q]: undefined, [K.page]: undefined }
    for (const k of filterKeys(defs)) u[k] = undefined
    setUrl(u)
  }

  return (
    <div className="space-y-4">
      <FilterBar
        values={url}
        onChange={setUrl}
        defs={defs}
        search={{ key: K.q, placeholder: t('admin.org_detail.search_users') }}
        pageKey={K.page}
        end={<span className="text-xs text-neutral-400 tabular-nums">{t('admin.org_detail.users_count', { count: total })}</span>}
      />

      {usersQ.isLoading ? (
        <ListSkeleton rows={6} />
      ) : usersQ.error ? (
        <QueryError error={usersQ.error} onRetry={() => usersQ.refetch()} />
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Users size={22} />}
            title={filtered ? t('admin.org_detail.no_users_match') : t('admin.org_detail.no_users')}
            action={
              filtered ? (
                <Button size="sm" onClick={clear}>
                  {t('admin.org.clear_filters')}
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <Panel divided className={usersQ.isFetching ? 'opacity-70 transition-opacity' : ''}>
          <div className={`${recipes.tableHead} hidden sm:grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_7rem_7rem] gap-4`}>
            <span>{t('admin.org_detail.user')}</span>
            <span>{t('admin.org_detail.email')}</span>
            <span>{t('admin.org_detail.role')}</span>
            <span>{t('admin.org_detail.joined')}</span>
          </div>
          {items.map((u, i) => {
            const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ')
            return (
              <Link
                key={u.id}
                href={adminPath.user(u.id)}
                {...kb.rowProps(i)}
                className="group px-5 py-3 grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_7rem_7rem] gap-x-4 gap-y-1 items-center hover:bg-neutral-50 data-[active=true]:bg-neutral-50"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar user={u} size={30} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900 truncate">{u.username}</p>
                    {fullName && <p className="text-xs text-neutral-400 truncate">{fullName}</p>}
                    <p className="sm:hidden text-xs text-neutral-400 truncate">{u.email}</p>
                  </div>
                </div>
                <span className="hidden sm:block text-sm text-neutral-600 truncate">{u.email}</span>
                <span>
                  <Chip tone={/admin/i.test(u.role_name || '') ? 'amber' : 'neutral'} className="capitalize">
                    {u.role_name || '–'}
                  </Chip>
                </span>
                <span className="hidden sm:flex items-center justify-between gap-2 text-xs text-neutral-500">
                  {u.creation_date ? formatDate(u.creation_date, i18n.language) : t('admin.org_detail.na')}
                  <CaretRight size={12} className="text-neutral-300 opacity-0 group-hover:opacity-100 rtl:rotate-180" />
                </span>
              </Link>
            )
          })}
        </Panel>
      )}
      <Pagination page={page} total={total} limit={LIMIT} onPage={(p) => setUrl({ [K.page]: p > 1 ? String(p) : undefined })} />
    </div>
  )
}
