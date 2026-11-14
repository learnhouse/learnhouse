'use client'
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Buildings,
  CalendarBlank,
  EnvelopeSimple,
  IdentificationBadge,
  ShieldStar,
  SignIn,
  Tag,
  WarningCircle,
  Flag,
  UserGear,
  CreditCard,
  SortAscending,
  Users,
  UserSwitch,
} from '@phosphor-icons/react'
import { Button, Chip, DashPage, EmptyState, Panel, ToolbarSelect, recipes, formatRelative } from '@/design'
import { facetList, listOrgs, listUsers } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { useAccessToken, useListKeyboard, usePlatformMe, useUrlQuery, shouldRetry } from '@components/Admin/hooks'
import { AdminHeader, Avatar, CopyLinkButton, ListSkeleton, NoAccess, Pagination, QueryError, adminPath, formatDate } from '@components/Admin/Shared/AdminKit'
import { LIFECYCLES } from '@services/ee/platform/types'
import { useImpersonate } from '@components/Admin/Impersonation/useImpersonate'
import FilterBar, { filterKeys, resolveDate, type FilterDef, type FilterOption } from '@components/Admin/Shared/FilterBar'

interface OrgMembership {
  id: number
  name: string
  slug: string
  role_name: string
}

interface GlobalUser {
  id: number
  user_uuid: string
  username: string
  email: string
  first_name: string | null
  last_name: string | null
  avatar_image: string | null
  is_superadmin: boolean
  org_count: number
  orgs: OrgMembership[]
  creation_date: string
  update_date: string
  email_verified?: boolean
  signup_method?: string | null
  last_login_at?: string | null
}

const PAGE_SIZE = 20
// Legacy presets plus the v2 `key:dir` sorts (API: created|username|email|orgs|last_login + order).
const SORTS = ['id', 'newest', 'oldest', 'orgs_desc', 'orgs_asc', 'username', 'email:asc', 'last_login:desc', 'last_login:asc', 'recently_updated'] as const
const GRID = 'grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_8rem_7rem] lg:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_8rem_7rem_7rem] gap-x-4'

/** Count for a boolean facet sent as {true: n} / {yes: n} / [{value:'1', count}]. */
function boolCount(facet: unknown, want: boolean): number | undefined {
  const keys = want ? ['true', 'yes', '1'] : ['false', 'no', '0']
  const hit = facetList(facet).find((f) => keys.includes(f.value.toLowerCase()))
  return hit?.count
}

export default function UsersPage() {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const me = usePlatformMe()
  const { impersonate } = useImpersonate()
  const [values, setValues] = useUrlQuery()
  const page = Math.max(1, Number(values.page) || 1)
  const sort = values.sort || 'id'

  // Org names seen in the async picker, so a chip can show a name, not an id.
  const orgNames = React.useRef<Record<string, string>>({})

  const router = useRouter()
  const query = React.useMemo(() => {
    const yesNo = values.is_superadmin === 'true' ? 'yes' : values.is_superadmin === 'false' ? 'no' : undefined
    return {
      page,
      limit: PAGE_SIZE,
      sort: sort.split(':')[0],
      order: sort.includes(':') ? sort.split(':')[1] : undefined,
      // `search` and `superadmin=yes|no` are the pre-v2 names; send both.
      q: values.q || undefined,
      search: values.q || undefined,
      is_superadmin: values.is_superadmin,
      superadmin: yesNo,
      email_verified: values.email_verified,
      org_id: values.org_id,
      org_plan: values.org_plan,
      org_role: values.org_role,
      org_lifecycle: values.org_lifecycle,
      org_tag: values.org_tag,
      signup_method: values.signup_method,
      min_orgs: Number(values.min_orgs) > 0 ? Number(values.min_orgs) : undefined,
      created_since: resolveDate(values.created_since),
      created_until: resolveDate(values.created_until, true),
      last_login_since: resolveDate(values.last_login_since),
      last_login_until: resolveDate(values.last_login_until, true),
    }
  }, [values, page, sort])

  const q = useQuery({
    queryKey: platformKeys.users(query),
    queryFn: () => listUsers(token, query),
    enabled: !!token && me.can('platform.read'),
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })

  const facets = ((q.data as any)?.facets ?? {}) as Record<string, unknown>
  const signupOptions: FilterOption[] = facetList(facets.signup_method).map((f) => ({
    value: f.value,
    label: t(`admin.users.signup.${f.value}`, { defaultValue: f.label ?? f.value }),
    count: f.count,
  }))
  const orgCountOptions = facetList(facets.org_count)

  const defs: FilterDef[] = [
    {
      key: 'is_superadmin',
      kind: 'boolean',
      label: t('admin.user_list.superadmin'),
      icon: <ShieldStar size={14} />,
      trueLabel: t('admin.user_list.superadmin'),
      falseLabel: t('admin.user_list.regular'),
      counts: { true: boolCount(facets.superadmin, true), false: boolCount(facets.superadmin, false) },
    },
    {
      key: 'email_verified',
      kind: 'boolean',
      label: t('admin.users.email_verified'),
      icon: <EnvelopeSimple size={14} />,
      trueLabel: t('admin.users.verified'),
      falseLabel: t('admin.users.unverified'),
      counts: { true: boolCount(facets.email_verified ?? facets.verified, true), false: boolCount(facets.email_verified ?? facets.verified, false) },
    },
    {
      key: 'org_id',
      kind: 'async',
      label: t('admin.users.organization'),
      icon: <Buildings size={14} />,
      placeholder: t('admin.users.org_search'),
      load: async (text: string) => {
        const res = await listOrgs(token, { q: text, limit: 10, page: 1 })
        const items = Array.isArray(res?.items) ? res.items : []
        return items.map((o) => {
          orgNames.current[String(o.id)] = o.name
          return { value: String(o.id), label: o.name }
        })
      },
      describe: (v: string) => orgNames.current[v] ?? `#${v}`,
    },
    {
      key: 'signup_method',
      kind: 'select',
      label: t('admin.users.signup_method'),
      icon: <IdentificationBadge size={14} />,
      options: signupOptions,
      // Only offered once the API reports which methods exist.
      hidden: signupOptions.length === 0 && !values.signup_method,
    },
    {
      key: 'min_orgs',
      kind: 'select',
      label: t('admin.users.min_orgs'),
      icon: <Buildings size={14} />,
      // Matches the API's org_count facet buckets (0, 1, 2-5, 6+).
      options: ['1', '2', '6'].map((n) => ({
        value: n,
        label: t('admin.users.min_orgs_value', { count: Number(n) }),
        count: orgCountOptions.length
          ? orgCountOptions.filter((f) => parseInt(f.value, 10) >= Number(n)).reduce((a, f) => a + f.count, 0)
          : undefined,
      })),
    },
    {
      key: 'org_plan',
      kind: 'select',
      label: t('admin.users.org_plan'),
      icon: <CreditCard size={14} />,
      options: ['free', 'paid', 'standard', 'pro', 'enterprise'].map((p) => ({
        value: p,
        label: p === 'paid' ? t('admin.users.paid_plans') : t(`admin.plans.${p}`),
        count: facetList(facets.org_plan).find((f) => f.value === p)?.count,
      })),
    },
    {
      key: 'org_role',
      kind: 'select',
      label: t('admin.users.org_role'),
      icon: <UserGear size={14} />,
      options: ['admin', 'maintainer', 'member'].map((r) => ({ value: r, label: t(`admin.users.org_roles.${r}`) })),
    },
    {
      key: 'org_lifecycle',
      kind: 'select',
      label: t('admin.users.org_lifecycle'),
      icon: <Flag size={14} />,
      options: LIFECYCLES.map((l) => ({ value: l, label: t(`admin.lifecycle.${l}`) })),
    },
    { key: 'org_tag', kind: 'text', label: t('admin.users.org_tag'), icon: <Tag size={14} />, placeholder: t('admin.users.org_tag_placeholder') },
    { key: 'created', kind: 'date', label: t('admin.users.signed_up'), icon: <CalendarBlank size={14} />, sinceKey: 'created_since', untilKey: 'created_until' },
    {
      key: 'last_login',
      kind: 'date',
      label: t('admin.users.last_login'),
      icon: <SignIn size={14} />,
      sinceKey: 'last_login_since',
      untilKey: 'last_login_until',
    },
  ]

  const users: GlobalUser[] = Array.isArray(q.data?.items) ? (q.data!.items as GlobalUser[]) : []
  const kb = useListKeyboard(users, (u) => router.push(adminPath.user(u.id)))

  if (!me.isLoading && !me.can('platform.read')) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.pages.users')} />
        <NoAccess />
      </DashPage>
    )
  }

  const total = q.data?.total ?? 0
  const filtered = !!values.q || filterKeys(defs).some((k) => !!values[k])
  const clearFilters = () => {
    const updates: Record<string, undefined> = { q: undefined, page: undefined }
    for (const k of filterKeys(defs)) updates[k] = undefined
    setValues(updates)
  }

  return (
    <DashPage>
      <AdminHeader
        title={t('admin.pages.users')}
        subtitle={q.data ? t('admin.user_list.users_count', { count: total }) : t('admin.pages.users_desc')}
        actions={<CopyLinkButton />}
      />

      <FilterBar
        values={values}
        onChange={setValues}
        defs={defs}
        search={{ key: 'q', placeholder: t('admin.user_list.search_placeholder') }}
        savedViewsKey="lh:admin:views:users"
        end={
          <ToolbarSelect
            ariaLabel={t('admin.users.sort')}
            icon={<SortAscending size={14} />}
            value={sort}
            onChange={(v) => setValues({ sort: v === 'id' ? undefined : v, page: undefined })}
            options={SORTS.map((s) => ({ value: s, label: t(`admin.user_list.sort_${s.replace(':', '_')}`) }))}
          />
        }
      />

      {q.isLoading ? (
        <ListSkeleton rows={8} />
      ) : q.error ? (
        <QueryError error={q.error} onRetry={() => q.refetch()} />
      ) : users.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Users size={22} />}
            title={t('admin.user_list.no_users')}
            description={filtered ? t('admin.users.no_match_desc') : t('admin.users.empty_desc')}
            action={
              filtered ? (
                <Button size="sm" onClick={clearFilters}>
                  {t('admin.users.clear_filters')}
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <>
          <Panel divided className={q.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
            <div className={`${recipes.tableHead} hidden sm:grid ${GRID}`}>
              <span>{t('admin.user_list.col_user')}</span>
              <span>{t('common.organizations')}</span>
              <span>{t('admin.user_list.col_role')}</span>
              <span>{t('admin.user_list.col_created')}</span>
              <span className="hidden lg:block">{t('admin.users.last_login')}</span>
            </div>
            {users.map((u, i) => (
              <UserRow
                key={u.id}
                user={u}
                locale={i18n.language}
                rowProps={kb.rowProps(i)}
                onImpersonate={me.can('impersonation.readonly') ? (user) => { const o = (Array.isArray(user.orgs) ? user.orgs : [])[0]; if (o) void impersonate({ orgId: o.id, userId: user.id, slug: (o as any).slug }) } : undefined}
              />
            ))}
          </Panel>
          <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={(p) => setValues({ page: p === 1 ? undefined : String(p) })} />
        </>
      )}
    </DashPage>
  )
}

function UserRow({
  user: u,
  locale,
  rowProps,
  onImpersonate,
}: {
  user: GlobalUser
  locale: string
  rowProps: Record<string, unknown>
  onImpersonate?: (_user: GlobalUser) => void
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const orgs = Array.isArray(u.orgs) ? u.orgs : []
  const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ')
  const href = adminPath.user(u.id)
  // Nested links/buttons keep their own click; anywhere else opens the user.
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div
      {...rowProps}
      onClick={() => router.push(href)}
      className={`${GRID} items-center gap-y-1 px-5 py-3 cursor-pointer hover:bg-neutral-50 data-[active=true]:bg-neutral-50`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <Avatar user={u} size={32} />
        <div className="min-w-0">
          <Link href={href} onClick={stop} className="block text-sm font-semibold text-neutral-900 truncate hover:underline underline-offset-2">
            {u.username}
            {fullName && <span className="ms-1.5 font-normal text-neutral-400">{fullName}</span>}
          </Link>
          <p className="flex items-center gap-1.5 text-xs text-neutral-500 min-w-0">
            <span className="truncate">{u.email}</span>
            {u.email_verified === false && (
              <span title={t('admin.users.unverified')} className="shrink-0 text-amber-600">
                <WarningCircle size={12} weight="fill" />
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="hidden sm:flex items-center gap-1.5 min-w-0 text-sm">
        {orgs.length === 0 ? (
          <span className="text-xs text-neutral-400">{t('admin.user_list.none')}</span>
        ) : (
          <>
            <Link href={adminPath.org(orgs[0].id)} onClick={stop} className="truncate text-neutral-700 hover:text-neutral-900 hover:underline underline-offset-2">
              {orgs[0].name}
            </Link>
            {orgs.length > 1 && <span className="shrink-0 text-xs tabular-nums text-neutral-400">+{orgs.length - 1}</span>}
          </>
        )}
      </div>
      <div className="flex justify-end sm:justify-start">
        {u.is_superadmin ? (
          <Link href="/admin/team" onClick={stop} title={t('admin.users.open_team')}>
            <Chip tone="amber" icon={<ShieldStar size={12} weight="fill" />}>
              {t('admin.user_list.superadmin')}
            </Chip>
          </Link>
        ) : (
          <span className="inline-flex items-center gap-2">
            <span className="text-xs text-neutral-400">{t('admin.user_list.col_user')}</span>
            {onImpersonate && orgs.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  stop(e)
                  onImpersonate(u)
                }}
                title={t('admin.impersonation.impersonate')}
                aria-label={t('admin.impersonation.impersonate_user', { name: u.username })}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-amber-100 hover:text-amber-800"
                data-testid={`users-impersonate-${u.id}`}
              >
                <UserSwitch size={14} />
              </button>
            )}
          </span>
        )}
      </div>
      <span className="hidden sm:block text-xs text-neutral-500">{formatDate(u.creation_date, locale)}</span>
      <span className="hidden lg:block text-xs text-neutral-500" title={formatDate(u.last_login_at, locale, true)}>
        {formatRelative(u.last_login_at ?? null, locale) ?? t('admin.user_detail.never')}
      </span>
      {orgs.length > 0 && (
        <span className="sm:hidden col-span-2 inline-flex items-center gap-1 ps-11 text-xs text-neutral-500 min-w-0">
          <Buildings size={12} className="shrink-0" />
          <span className="truncate">{orgs.length === 1 ? orgs[0].name : t('admin.user_list.orgs_count', { count: orgs.length })}</span>
        </span>
      )}
    </div>
  )
}
