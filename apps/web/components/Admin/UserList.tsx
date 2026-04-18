'use client'
import React, { useState, useMemo, useCallback, useEffect } from 'react'
import useSWR from 'swr'
import { getAPIUrl } from '@services/config/config'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { swrFetcher } from '@services/utils/ts/requests'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  User,
  CaretLeft,
  CaretRight,
  MagnifyingGlass,
  Buildings,
  ShieldStar,
  EnvelopeSimple,
} from '@phosphor-icons/react'

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
}

interface PaginatedUserResponse {
  items: GlobalUser[]
  total: number
  page: number
  limit: number
}

function getAvatarUrl(userUuid: string, avatarImage: string): string {
  if (avatarImage.startsWith('http')) return avatarImage
  return getUserAvatarMediaDirectory(userUuid, avatarImage)
}

const SUPERADMIN_FILTERS = ['all', 'yes', 'no'] as const
const PAGE_SIZE = 20

function OrgListTooltip({ orgs }: { orgs: OrgMembership[] }) {
  const [open, setOpen] = useState(false)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.top - 8, left: rect.left })
    }
  }, [open])

  if (orgs.length === 0) {
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
        {orgs.length} org{orgs.length !== 1 ? 's' : ''}
      </button>
      {open && pos && (
        <div
          className="fixed z-[9999] w-64 bg-[#1a1a1b] border border-white/[0.12] rounded-lg shadow-xl p-2 space-y-1 max-h-64 overflow-y-auto"
          style={{ top: pos.top, left: pos.left, transform: 'translateY(-100%)' }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {orgs.map((o) => (
            <div
              key={o.id}
              className="flex items-center justify-between px-2 py-1.5 rounded"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Buildings
                  size={12}
                  weight="fill"
                  className="text-white/30 shrink-0"
                />
                <span className="text-xs font-medium text-white/90 truncate">
                  {o.name}
                </span>
              </div>
              <span className="text-[10px] text-white/40 shrink-0 ms-2">
                {o.role_name}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default function UserList() {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const [search, setSearch] = useState(searchParams.get('search') || '')
  const [debouncedSearch, setDebouncedSearch] = useState(
    searchParams.get('search') || ''
  )
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1)
  const [sortBy, setSortBy] = useState<string>(
    searchParams.get('sort') || 'id'
  )
  const [superadminFilter, setSuperadminFilter] = useState<string>(
    searchParams.get('superadmin') || 'all'
  )
  const [minOrgs, setMinOrgs] = useState(
    Number(searchParams.get('min_orgs')) || 0
  )

  const updateUrl = useCallback(
    (updates: Record<string, string | number>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        const strVal = String(value)
        if (
          (key === 'page' && strVal === '1') ||
          (key === 'sort' && strVal === 'id') ||
          (key === 'superadmin' && strVal === 'all') ||
          (key === 'search' && strVal === '') ||
          (key === 'min_orgs' && strVal === '0')
        ) {
          params.delete(key)
        } else {
          params.set(key, strVal)
        }
      }
      const qs = params.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
    },
    [searchParams, router, pathname]
  )

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
    if (superadminFilter !== 'all')
      params.set('superadmin', superadminFilter)
    if (minOrgs > 0) params.set('min_orgs', String(minOrgs))
    return params.toString()
  }, [page, sortBy, debouncedSearch, superadminFilter, minOrgs])

  const {
    data: userData,
    isLoading,
    isValidating,
  } = useSWR<PaginatedUserResponse>(
    accessToken
      ? `${getAPIUrl()}ee/superadmin/users?${queryParams}`
      : null,
    (url: string) => swrFetcher(url, accessToken),
    { revalidateOnFocus: true, keepPreviousData: true }
  )

  const users = userData?.items
  const totalCount = userData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const paged = users || []

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
  const handleSuperadminFilter = (val: string) => {
    setSuperadminFilter(val)
    setPage(1)
    updateUrl({ superadmin: val, page: 1 })
  }
  const handleMinOrgsChange = (val: number) => {
    setMinOrgs(val)
    setPage(1)
    updateUrl({ min_orgs: val, page: 1 })
  }

  const avatarFallback = (
    <div className="h-8 w-8 rounded-full bg-white/[0.08] flex items-center justify-center shrink-0">
      <User size={14} weight="fill" className="text-white/30" />
    </div>
  )

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex items-center justify-between">
          <div className="relative">
            <MagnifyingGlass
              size={14}
              className="absolute start-2.5 top-1/2 -translate-y-1/2 text-white/30"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search users..."
              className="bg-white/[0.05] border border-white/[0.08] rounded-lg ps-8 pe-3 py-1.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/20 w-64"
            />
          </div>
          <span className="text-xs text-white/30">
            {totalCount} user{totalCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40 me-1">Role:</span>
              {SUPERADMIN_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => handleSuperadminFilter(f)}
                  className={`text-xs px-2.5 py-1 rounded-md transition-colors capitalize ${
                    superadminFilter === f
                      ? 'bg-white/10 text-white'
                      : 'text-white/40 hover:text-white/60 hover:bg-white/[0.05]'
                  }`}
                >
                  {f === 'all'
                    ? 'All'
                    : f === 'yes'
                      ? 'Superadmin'
                      : 'Regular'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40">Min orgs:</span>
              {[0, 1, 2, 3, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => handleMinOrgsChange(n)}
                  className={`text-xs px-2 py-1 rounded-md transition-colors ${
                    minOrgs === n
                      ? 'bg-white/10 text-white'
                      : 'text-white/40 hover:text-white/60 hover:bg-white/[0.05]'
                  }`}
                >
                  {n === 0 ? 'Any' : `${n}+`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40 me-1">Sort:</span>
            {(
              [
                ['id', 'Default'],
                ['newest', 'Newest'],
                ['oldest', 'Oldest'],
                ['orgs_desc', 'Most orgs'],
                ['orgs_asc', 'Least orgs'],
                ['username', 'Username'],
                ['recently_updated', 'Updated'],
              ] as const
            ).map(([key, label]) => (
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
        ) : !users || users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-white/40">
            <User size={48} weight="fill" />
            <p className="mt-4 text-lg">No users found</p>
          </div>
        ) : (
          <>
            <table className="w-full text-start">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">
                    Organizations
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.map((u) => {
                  const fullName = [u.first_name, u.last_name]
                    .filter(Boolean)
                    .join(' ')

                  return (
                    <tr
                      key={u.id}
                      className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {u.avatar_image ? (
                            <img
                              src={getAvatarUrl(u.user_uuid, u.avatar_image)}
                              alt={u.username}
                              className="h-8 w-8 rounded-full object-cover bg-white/[0.05]"
                              onError={(e) => {
                                ;(e.target as HTMLImageElement).style.display =
                                  'none'
                              }}
                            />
                          ) : (
                            avatarFallback
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white">
                              {u.username}
                            </p>
                            {fullName && (
                              <p className="text-xs text-white/30 truncate max-w-[200px]">
                                {fullName}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <EnvelopeSimple
                            size={12}
                            weight="bold"
                            className="text-white/20 shrink-0"
                          />
                          <span className="text-sm text-white/60 truncate max-w-[220px]">
                            {u.email}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <OrgListTooltip orgs={u.orgs} />
                      </td>
                      <td className="px-4 py-3">
                        {u.is_superadmin ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider px-2 py-0.5 rounded bg-amber-400/10 text-amber-400">
                            <ShieldStar size={12} weight="fill" />
                            Superadmin
                          </span>
                        ) : (
                          <span className="text-xs font-medium uppercase tracking-wider px-2 py-0.5 rounded bg-white/[0.06] text-white/40">
                            User
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-white/40">
                          {u.creation_date
                            ? new Date(u.creation_date).toLocaleDateString()
                            : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-white/40">
                          {u.update_date
                            ? new Date(u.update_date).toLocaleDateString()
                            : '—'}
                        </span>
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
                    .filter(
                      (p) =>
                        p === 1 ||
                        p === totalPages ||
                        Math.abs(p - page) <= 1
                    )
                    .map((p, idx, arr) => (
                      <React.Fragment key={p}>
                        {idx > 0 && arr[idx - 1] !== p - 1 && (
                          <span className="text-white/20 text-xs px-1">
                            ...
                          </span>
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
                    onClick={() =>
                      handlePageChange(Math.min(totalPages, page + 1))
                    }
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
