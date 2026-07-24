'use client'
import React, { useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import UserAvatar from '@components/Objects/UserAvatar'
import LearnHouseSpinner from '@components/Objects/Loaders/LearnHouseSpinner'
import {
  Search, ChevronLeft, ChevronRight, Eye, ExternalLink, BarChart3, GitCompare, X,
} from 'lucide-react'
import { fullName, fmtDate, avatarUrl } from './format'
import { useUsersAuditSummary } from './useUserAudit'
import UserDossierModal from './UserDossierModal'
import UsersComparisonTable from './UsersComparisonTable'
import UserAuditExport from './UserAuditExport'

const ITEMS_PER_PAGE = 12
const RANGES = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
]

export default function UserAnalytics() {
  const params = useParams() as any
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [days, setDays] = useState(365)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [modalUserId, setModalUserId] = useState<number | null>(null)
  const [comparing, setComparing] = useState(false)

  const buildQuery = () => {
    const p = new URLSearchParams()
    p.append('page', String(page))
    p.append('limit', String(ITEMS_PER_PAGE))
    p.append('sort_order', 'desc')
    if (search) p.append('search', search)
    return p.toString()
  }

  const listKey = useMemo(
    () => [...queryKeys.org.users(org?.id ?? 0), 'audit-list', page, search],
    [org?.id, page, search]
  )

  const { data, isFetching } = useQuery({
    queryKey: listKey,
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${org?.id}/users?${buildQuery()}`, token),
    enabled: !!org?.id && !!token,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  })

  const users = data?.items || []
  const total = data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE))
  const visibleIds: number[] = users.map((u: any) => u.user.id)

  // Summary (last connection etc.) for the visible page.
  const { data: summaryData } = useUsersAuditSummary(visibleIds, days)
  const summaryById = useMemo(() => {
    const m: Record<number, any> = {}
    for (const r of summaryData?.data || []) m[r.user.id] = r
    return m
  }, [summaryData])

  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return next
    })
  }, [allVisibleSelected, visibleIds])

  const toggleOne = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const selectedIds = Array.from(selected)
  const isInitialLoading = !data && isFetching

  const dossierHref = (userId: number) =>
    getUriWithOrg(params.orgslug, '') + `/dash/users/analytics/${userId}`

  return (
    <div className="px-4 sm:px-10 py-6 space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="relative max-w-xs w-full">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search students…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white rounded-lg border border-gray-200 p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setDays(r.value)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  days === r.value ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {selectedIds.length > 0 && (
            <>
              <button
                onClick={() => setComparing((c) => !c)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                <GitCompare size={15} /> {comparing ? 'Hide compare' : `Compare (${selectedIds.length})`}
              </button>
              <UserAuditExport userIds={selectedIds} days={days} label={`Export (${selectedIds.length})`} />
            </>
          )}
        </div>
      </div>

      {/* Selected banner */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between text-xs bg-blue-50 text-blue-700 rounded-lg px-3 py-2">
          <span>{selectedIds.length} student{selectedIds.length > 1 ? 's' : ''} selected</span>
          <button onClick={() => { setSelected(new Set()); setComparing(false) }} className="flex items-center gap-1 hover:underline">
            <X size={12} /> Clear
          </button>
        </div>
      )}

      {/* Comparison view */}
      {comparing && selectedIds.length > 0 && (
        <UsersComparisonTable userIds={selectedIds} days={days} onOpenUser={setModalUserId} />
      )}

      {/* User list */}
      {isInitialLoading ? (
        <div className="py-20 flex justify-center"><LearnHouseSpinner /></div>
      ) : users.length === 0 ? (
        <div className="py-20 text-center text-sm text-gray-400 flex flex-col items-center gap-2">
          <BarChart3 size={28} className="text-gray-300" />
          No students found.
        </div>
      ) : (
        <div className="bg-white rounded-xl nice-shadow overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 text-xs font-semibold text-gray-400 uppercase">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} className="rounded" />
            <span className="flex-1">Student</span>
            <span className="w-40 hidden sm:block">Last connection</span>
            <span className="w-24 text-right">Actions</span>
          </div>
          {users.map((item: any) => {
            const u = item.user
            const s = summaryById[u.id]
            return (
              <div key={u.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                <input
                  type="checkbox"
                  checked={selected.has(u.id)}
                  onChange={() => toggleOne(u.id)}
                  className="rounded"
                />
                <button onClick={() => setModalUserId(u.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  <UserAvatar
                    width={36}
                    rounded="rounded-lg"
                    avatar_url={avatarUrl(u)}
                    userId={String(u.id)}
                    username={u.username}
                    predefined_avatar={avatarUrl(u) ? undefined : 'empty'}
                  />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{fullName(u)}</div>
                    <div className="text-xs text-gray-400 truncate">@{u.username} · {u.email}</div>
                  </div>
                </button>
                <span className="w-40 hidden sm:block text-xs text-gray-500">
                  {s ? fmtDate(s.last_connection) : '—'}
                </span>
                <div className="w-24 flex items-center justify-end gap-2">
                  <button onClick={() => setModalUserId(u.id)} title="Quick view" className="text-gray-400 hover:text-blue-600">
                    <Eye size={16} />
                  </button>
                  <Link href={dossierHref(u.id)} title="Open full page" className="text-gray-400 hover:text-blue-600">
                    <ExternalLink size={15} />
                  </Link>
                </div>
              </div>
            )
          })}

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 text-xs text-gray-500">
            <span>{total} student{total > 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <span>{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1 rounded hover:bg-gray-100 disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      <UserDossierModal userId={modalUserId} days={days} onOpenChange={(o) => !o && setModalUserId(null)} />
    </div>
  )
}
