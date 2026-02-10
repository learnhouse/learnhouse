'use client'
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import useSWR from 'swr'
import { getAPIUrl } from '@services/config/config'
import { getOrgLogoMediaDirectory, getUserAvatarMediaDirectory } from '@services/media/media'
import { swrFetcher } from '@services/utils/ts/requests'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import Link from 'next/link'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Buildings, Globe, User, CaretLeft, CaretRight, BookOpen, MagnifyingGlass, ArrowSquareOut } from '@phosphor-icons/react'

interface PaginatedOrgResponse {
  items: OrgWithCount[]
  total: number
  page: number
  limit: number
}

interface AdminUserInfo {
  username: string
  email: string
  avatar_image: string | null
  user_uuid: string
}

interface OrgWithCount {
  id: number
  org_uuid: string
  name: string
  slug: string
  description: string | null
  email: string
  logo_image: string | null
  thumbnail_image: string | null
  creation_date: string
  update_date: string
  user_count: number
  course_count: number
  plan: string
  custom_domains: string[]
  admin_users: AdminUserInfo[]
}

interface VisitRow {
  org_id: number
  date: string
  views: number
}

function getLogoUrl(orgUuid: string, logoImage: string): string {
  if (logoImage.startsWith('http')) return logoImage
  return getOrgLogoMediaDirectory(orgUuid, logoImage)
}

function getAvatarUrl(userUuid: string, avatarImage: string): string {
  if (avatarImage.startsWith('http')) return avatarImage
  return getUserAvatarMediaDirectory(userUuid, avatarImage)
}

function getFrontendDomain(): string {
  if (typeof window === 'undefined') return 'localhost:3000'
  return (
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('learnhouse_frontend_domain='))
      ?.split('=')[1] || 'localhost:3000'
  )
}

const PLANS = ['all', 'free', 'paid', 'standard', 'pro', 'enterprise'] as const
const PAGE_SIZE = 20

function Sparkline({ data, max }: { data: number[]; max: number }) {
  if (data.length === 0) return <span className="text-white/20 text-xs">—</span>
  const h = 20
  const w = 56
  const step = w / Math.max(data.length - 1, 1)
  const safeMax = max || 1
  const points = data
    .map((v, i) => `${i * step},${h - (v / safeMax) * h}`)
    .join(' ')
  const total = data.reduce((a, b) => a + b, 0)

  return (
    <div className="flex items-center gap-2">
      <svg width={w} height={h} className="shrink-0">
        <polyline
          points={points}
          fill="none"
          stroke="rgb(96, 165, 250)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-xs text-white/50 tabular-nums">{total.toLocaleString()}</span>
    </div>
  )
}

function AdminUserTooltip({ users }: { users: AdminUserInfo[] }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.top - 8, left: rect.left })
    }
  }, [open])

  if (users.length === 0) {
    return <span className="text-white/25 text-xs">None</span>
  }

  return (
    <>
      <button
        ref={btnRef}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="text-sm text-white/60 hover:text-white/80 transition-colors underline decoration-dotted underline-offset-2"
      >
        {users.length} admin{users.length !== 1 ? 's' : ''}
      </button>
      {open && pos && (
        <div
          className="fixed z-[9999] w-64 bg-[#1a1a1b] border border-white/[0.12] rounded-lg shadow-xl p-2 space-y-1"
          style={{ top: pos.top, left: pos.left, transform: 'translateY(-100%)' }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {users.map((u) => (
            <div key={u.username} className="flex items-center gap-2 px-2 py-1.5 rounded">
              {u.avatar_image ? (
                <img
                  src={getAvatarUrl(u.user_uuid, u.avatar_image)}
                  alt={u.username}
                  className="w-5 h-5 rounded-full object-cover bg-gray-700 shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              ) : (
                <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                  <User size={10} weight="fill" className="text-white/40" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-white/90 truncate">{u.username}</p>
                <p className="text-[10px] text-white/40 truncate">{u.email}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function ImgWithFallback({
  src,
  alt,
  className,
  fallback,
}: {
  src: string
  alt: string
  className: string
  fallback: React.ReactNode
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return <>{fallback}</>
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}

export default function OrganizationList() {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // Read initial values from URL search params
  const [planFilter, setPlanFilter] = useState<string>(searchParams.get('plan') || 'all')
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1)
  const [sortBy, setSortBy] = useState<string>(searchParams.get('sort') || 'id')
  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get('search') || '')

  // Sync state to URL search params
  const updateUrl = useCallback((updates: Record<string, string | number>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      const strVal = String(value)
      // Remove default values from URL to keep it clean
      if (
        (key === 'page' && strVal === '1') ||
        (key === 'sort' && strVal === 'id') ||
        (key === 'plan' && strVal === 'all') ||
        (key === 'search' && strVal === '')
      ) {
        params.delete(key)
      } else {
        params.set(key, strVal)
      }
    }
    const qs = params.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [searchParams, router, pathname])

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      updateUrl({ search, page: 1 })
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
      sort: sortBy,
    })
    if (debouncedSearch) params.set('search', debouncedSearch)
    if (planFilter !== 'all') params.set('plan', planFilter)
    return params.toString()
  }, [page, sortBy, debouncedSearch, planFilter])

  const { data: orgData, isLoading, isValidating } = useSWR<PaginatedOrgResponse>(
    accessToken ? `${getAPIUrl()}ee/superadmin/organizations?${queryParams}` : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: true, keepPreviousData: true }
  )

  const orgs = orgData?.items
  const totalCount = orgData?.total ?? 0

  const { data: visitsData } = useSWR<{ data: VisitRow[] }>(
    accessToken ? `${getAPIUrl()}ee/superadmin/organizations/visits` : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: false }
  )

  const visitsByOrg = useMemo(() => {
    const map: Record<number, number[]> = {}
    let globalMax = 0
    if (!visitsData?.data) return { map, globalMax }

    const raw: Record<number, Record<string, number>> = {}
    for (const row of visitsData.data) {
      if (!raw[row.org_id]) raw[row.org_id] = {}
      raw[row.org_id][row.date] = row.views
    }

    const today = new Date()
    const dates: string[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      dates.push(d.toISOString().slice(0, 10))
    }

    for (const [orgIdStr, dateMap] of Object.entries(raw)) {
      const orgId = Number(orgIdStr)
      map[orgId] = dates.map((d) => dateMap[d] || 0)
      const mx = Math.max(...map[orgId])
      if (mx > globalMax) globalMax = mx
    }
    return { map, globalMax }
  }, [visitsData])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const paged = orgs || []

  const handleFilterChange = (plan: string) => {
    setPlanFilter(plan)
    setPage(1)
    updateUrl({ plan, page: 1 })
  }
  const handleSortChange = (sort: string) => {
    setSortBy(sort)
    setPage(1)
    updateUrl({ sort, page: 1 })
  }
  const handlePageChange = (p: number) => {
    setPage(p)
    updateUrl({ page: p })
  }
  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  const domain = getFrontendDomain()
  const logoFallback = (
    <div className="h-8 w-8 rounded-lg bg-white/[0.08] flex items-center justify-center shrink-0">
      <Buildings size={16} weight="fill" className="text-white/30" />
    </div>
  )

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex items-center justify-between">
          <div className="relative">
            <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search organizations..."
              className="bg-white/[0.05] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/20 w-64"
            />
          </div>
          <span className="text-xs text-white/30">
            {totalCount} org{totalCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40 mr-1">Plan:</span>
            {PLANS.map((p) => (
              <button
                key={p}
                onClick={() => handleFilterChange(p)}
                className={`text-xs px-2.5 py-1 rounded-md transition-colors capitalize ${
                  planFilter === p
                    ? 'bg-white/10 text-white'
                    : 'text-white/40 hover:text-white/60 hover:bg-white/[0.05]'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40 mr-1">Sort:</span>
            {([
              ['id', 'Default'],
              ['newest', 'Newest'],
              ['users_desc', 'Most users'],
              ['users_asc', 'Least users'],
              ['courses_desc', 'Most courses'],
              ['most_visits', 'Most visits'],
              ['most_trails', 'Most engaged'],
              ['most_admins', 'Most admins'],
              ['payments_active', 'Payments'],
              ['recently_updated', 'Updated'],
              ['oldest', 'Oldest'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => handleSortChange(key)}
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                  sortBy === key
                    ? 'bg-white/10 text-white'
                    : 'text-white/40 hover:text-white/60 hover:bg-white/[0.05]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="relative">
        {isValidating && !isLoading && (
          <div className="absolute inset-0 bg-[#0f0f10]/50 z-10 flex items-center justify-center pointer-events-none">
            <div className="h-5 w-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        ) : !orgs || orgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-white/40">
            <Buildings size={48} weight="fill" />
            <p className="mt-4 text-lg">No organizations found</p>
          </div>
        ) : (
          <>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-white/[0.08]">
            <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">Organization</th>
            <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">URL</th>
            <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">Visits (7d)</th>
            <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">Users</th>
            <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">Courses</th>
            <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">Admins</th>
            <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">Plan</th>
            <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">Created</th>
            <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">Updated</th>
            <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider"></th>
          </tr>
        </thead>
        <tbody>
          {paged.map((org) => {
            const orgUrl = `${typeof window !== 'undefined' ? window.location.protocol : 'http:'}//${org.slug}.${domain}`
            const sparkData = visitsByOrg.map[org.id] || []

            return (
              <tr key={org.id} className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/organizations/${org.id}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                    {org.logo_image ? (
                      <ImgWithFallback
                        src={getLogoUrl(org.org_uuid, org.logo_image)}
                        alt={org.name}
                        className="h-8 w-8 object-contain rounded-lg bg-white/[0.05]"
                        fallback={logoFallback}
                      />
                    ) : (
                      logoFallback
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">{org.name}</p>
                      {org.description ? (
                        <p className="text-xs text-white/30 truncate max-w-[260px]">{org.description}</p>
                      ) : (
                        <p className="text-xs text-white/40 font-mono">{org.slug}</p>
                      )}
                    </div>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="space-y-1">
                    <a href={orgUrl} rel="noopener" className="flex items-center gap-1.5 text-xs text-blue-400/80 hover:text-blue-400 transition-colors font-mono">
                      <Globe size={12} weight="bold" className="shrink-0" />
                      <span className="truncate max-w-[180px]">{org.slug}.{domain}</span>
                    </a>
                    {org.custom_domains.map((d) => (
                      <a key={d} href={`${typeof window !== 'undefined' ? window.location.protocol : 'http:'}//${d}`} rel="noopener" className="flex items-center gap-1.5 text-xs text-emerald-400/80 hover:text-emerald-400 transition-colors">
                        <Globe size={12} weight="fill" className="shrink-0" />
                        {d}
                      </a>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Sparkline data={sparkData} max={visitsByOrg.globalMax} />
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-white/60">{org.user_count}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <BookOpen size={13} weight="fill" className="text-white/20 shrink-0" />
                    <span className="text-sm text-white/60">{org.course_count}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <AdminUserTooltip users={org.admin_users} />
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium uppercase tracking-wider px-2 py-0.5 rounded ${
                    org.plan === 'enterprise' ? 'bg-amber-400/10 text-amber-400'
                      : org.plan === 'pro' ? 'bg-purple-400/10 text-purple-400'
                      : org.plan === 'standard' ? 'bg-blue-400/10 text-blue-400'
                      : 'bg-white/[0.06] text-white/40'
                  }`}>
                    {org.plan}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-white/40">{new Date(org.creation_date).toLocaleDateString()}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-white/40">{new Date(org.update_date).toLocaleDateString()}</span>
                </td>
                <td className="px-4 py-3">
                  <a
                    href={`${orgUrl}/dash`}
                    rel="noopener"
                    className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white hover:bg-white/[0.08] px-2.5 py-1.5 rounded-lg transition-colors"
                    title="Open org dashboard"
                  >
                    <ArrowSquareOut size={14} weight="bold" />
                    Dashboard
                  </a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-4">
          <span className="text-xs text-white/30">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => handlePageChange(Math.max(1, page - 1))}
              disabled={page === 1}
              className="p-1.5 rounded text-white/40 hover:text-white hover:bg-white/[0.08] transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <CaretLeft size={14} weight="bold" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .map((p, idx, arr) => (
                <React.Fragment key={p}>
                  {idx > 0 && arr[idx - 1] !== p - 1 && (
                    <span className="text-white/20 text-xs px-1">...</span>
                  )}
                  <button
                    onClick={() => handlePageChange(p)}
                    className={`text-xs min-w-[28px] h-7 rounded transition-colors ${
                      p === page
                        ? 'bg-white/10 text-white'
                        : 'text-white/40 hover:text-white hover:bg-white/[0.05]'
                    }`}
                  >
                    {p}
                  </button>
                </React.Fragment>
              ))}
            <button
              onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded text-white/40 hover:text-white hover:bg-white/[0.08] transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <CaretRight size={14} weight="bold" />
            </button>
          </div>
        </div>
      )}
          </>
        )}
      </div>
    </div>
  )
}
