'use client'
import React, { useState, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getAPIUrl, getDeploymentMode } from '@services/config/config'
import {
  getOrgLogoMediaDirectory,
  getUserAvatarMediaDirectory,
  getCourseThumbnailMediaDirectory,
} from '@services/media/media'
import { apiFetch } from '@services/utils/ts/requests'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import Link from 'next/link'
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  ArrowLeft,
  Buildings,
  BookOpen,
  Users,
  ChartBar,
  CreditCard,
  GearSix,
  Globe,
  Eye,
  EyeSlash,
  MagnifyingGlass,
  CaretLeft,
  CaretRight,
  User,
  Check,
  ArrowSquareOut,
  Robot,
  ArrowClockwise,
  SlidersHorizontal,
} from '@phosphor-icons/react'

function getLogoUrl(orgUuid: string, logoImage: string): string {
  if (logoImage.startsWith('http')) return logoImage
  return getOrgLogoMediaDirectory(orgUuid, logoImage)
}

function getAvatarUrl(userUuid: string, avatarImage: string): string {
  if (avatarImage.startsWith('http')) return avatarImage
  return getUserAvatarMediaDirectory(userUuid, avatarImage)
}

function getCourseThumbnailUrl(orgUuid: string, courseUuid: string, file: string): string {
  if (file.startsWith('http')) return file
  return getCourseThumbnailMediaDirectory(orgUuid, courseUuid, file)
}

const ALL_TABS = [
  { id: 'overview', label: 'Overview', icon: Buildings },
  { id: 'courses', label: 'Courses', icon: BookOpen },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'analytics', label: 'Analytics', icon: ChartBar },
  { id: 'plan', label: 'Plan', icon: CreditCard },
  { id: 'features', label: 'Features', icon: SlidersHorizontal },
  { id: 'settings', label: 'Admin Controls', icon: GearSix },
] as const

type TabId = (typeof ALL_TABS)[number]['id']

function getTabsForMode(mode: string) {
  // In non-SaaS modes (EE/OSS) plans don't apply — hide the Plan tab.
  return mode === 'saas' ? ALL_TABS : ALL_TABS.filter((t) => t.id !== 'plan')
}

function useUrlParams() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const updateParams = useCallback(
    (updates: Record<string, string | number>, removals?: string[]) => {
      const params = new URLSearchParams(searchParams.toString())
      if (removals) {
        for (const key of removals) params.delete(key)
      }
      for (const [key, value] of Object.entries(updates)) {
        const strVal = String(value)
        // Remove default values to keep URL clean
        if (
          (key === 'tab' && strVal === 'overview') ||
          (key === 'page' && strVal === '1') ||
          (key === 'search' && strVal === '') ||
          (key === 'days' && strVal === '30')
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

  return { searchParams, updateParams }
}

function getFrontendDomain(): string {
  if (typeof window === 'undefined') return 'localhost:3000'
  return (
    document.cookie
      .split('; ')
      .find((c) => c.startsWith('LH_frontend_domain='))
      ?.split('=')[1] || 'localhost:3000'
  )
}

export default function OrgDetailPage() {
  const params = useParams()
  const orgId = params.orgId as string
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const { searchParams, updateParams } = useUrlParams()

  const mode = getDeploymentMode()
  const tabs = useMemo(() => getTabsForMode(mode), [mode])
  const requestedTab = (searchParams.get('tab') as TabId) || 'overview'
  // Guard against URLs pointing at a tab that isn't available in this mode
  const activeTab: TabId = tabs.some((t) => t.id === requestedTab) ? requestedTab : 'overview'
  const setActiveTab = (tab: TabId) => {
    // When switching tabs, clear sub-tab params (page, search, days)
    updateParams({ tab }, ['page', 'search', 'days'])
  }

  const { data: org, isLoading } = useQuery({
    queryKey: queryKeys.org.detail(orgId),
    queryFn: () => apiFetch(`${getAPIUrl()}ee/superadmin/organizations/${orgId}`, accessToken),
    enabled: !!accessToken,
    staleTime: 60_000,
  })

  if (isLoading) return <PageLoading />
  if (!org) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-white/40">
        <Buildings size={48} weight="fill" />
        <p className="mt-4 text-lg">Organization not found</p>
      </div>
    )
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/admin/organizations"
          className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/60 transition-colors mb-3"
        >
          <ArrowLeft size={14} weight="bold" />
          Back to Organizations
        </Link>
        <div className="flex items-center gap-4">
          {org.logo_image ? (
            <img
              src={getLogoUrl(org.org_uuid, org.logo_image)}
              alt={org.name}
              className="h-12 w-12 rounded-xl object-contain bg-white/[0.05]"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : (
            <div className="h-12 w-12 rounded-xl bg-white/[0.08] flex items-center justify-center">
              <Buildings size={24} weight="fill" className="text-white/30" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-white">{org.name}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-white/40 font-mono">{org.slug}</span>
              {mode === 'saas' && (
                <span
                  className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded ${
                    org.plan === 'enterprise'
                      ? 'bg-amber-400/10 text-amber-400'
                      : org.plan === 'pro'
                        ? 'bg-purple-400/10 text-purple-400'
                        : org.plan === 'standard'
                          ? 'bg-blue-400/10 text-blue-400'
                          : 'bg-white/[0.06] text-white/40'
                  }`}
                >
                  {org.plan}
                </span>
              )}
            </div>
          </div>
          <a
            href={`${typeof window !== 'undefined' ? window.location.protocol : 'http:'}//${org.slug}.${getFrontendDomain()}/dash`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] px-3 py-2 rounded-lg transition-all shrink-0"
          >
            <ArrowSquareOut size={14} weight="bold" />
            Open Dashboard
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-white/[0.08] mb-6">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.id
                  ? 'text-white border-white'
                  : 'text-white/40 border-transparent hover:text-white/60 hover:border-white/20'
              }`}
            >
              <Icon size={16} weight={activeTab === tab.id ? 'fill' : 'regular'} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <OverviewTab org={org} orgId={orgId} accessToken={accessToken} />}
      {activeTab === 'courses' && <CoursesTab orgId={orgId} accessToken={accessToken} orgUuid={org.org_uuid} orgSlug={org.slug} />}
      {activeTab === 'users' && <UsersTab orgId={orgId} accessToken={accessToken} />}
      {activeTab === 'analytics' && <AnalyticsTab orgId={orgId} accessToken={accessToken} />}
      {activeTab === 'plan' && mode === 'saas' && <PlanTab orgId={orgId} accessToken={accessToken} currentPlan={org.plan} config={org.config} />}
      {activeTab === 'features' && <FeaturesTab orgId={orgId} accessToken={accessToken} config={org.config} mode={mode} />}
      {activeTab === 'settings' && <SettingsTab orgId={orgId} accessToken={accessToken} org={org} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------
function UsageBar({
  label,
  usage,
  limit,
}: {
  label: string
  usage: number
  limit: number | string
}) {
  const isUnlimited = limit === 'unlimited' || limit === 0
  const numLimit = typeof limit === 'number' ? limit : 0
  const pct = isUnlimited ? 0 : numLimit > 0 ? Math.min(100, (usage / numLimit) * 100) : 0
  const barColor = isUnlimited
    ? 'bg-blue-400/60'
    : pct >= 90
      ? 'bg-red-400'
      : pct >= 70
        ? 'bg-yellow-400'
        : 'bg-emerald-400'

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-white/40 uppercase tracking-wider">{label}</p>
        <p className="text-xs text-white/50">
          {usage.toLocaleString()} / {isUnlimited ? 'Unlimited' : numLimit.toLocaleString()}
        </p>
      </div>
      <p className="text-2xl font-bold text-white mb-2">{usage.toLocaleString()}</p>
      <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: isUnlimited ? '15%' : `${Math.max(2, pct)}%` }}
        />
      </div>
      {!isUnlimited && pct >= 90 && (
        <p className="text-[10px] text-red-400/80 mt-1.5">Limit almost reached</p>
      )}
    </div>
  )
}

function OverviewTab({ org, orgId, accessToken }: { org: any; orgId: string; accessToken: string }) {
  const { data: usageData } = useQuery({
    queryKey: queryKeys.org.usage(Number(orgId)),
    queryFn: () => apiFetch(`${getAPIUrl()}ee/superadmin/organizations/${orgId}/usage`, accessToken),
    enabled: !!accessToken,
    staleTime: 60_000,
  })

  const features = usageData?.features

  return (
    <div className="space-y-6">
      {/* Usage bars */}
      {features ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <UsageBar label="Courses" usage={features.courses.usage} limit={features.courses.limit} />
          <UsageBar label="Members" usage={features.members.usage} limit={features.members.limit} />
          <UsageBar label="Admin Seats" usage={features.admin_seats.usage} limit={features.admin_seats.limit} />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Users', value: org.user_count },
            { label: 'Courses', value: org.course_count },
            { label: 'Admins', value: org.admin_users?.length || 0 },
            { label: 'Custom Domains', value: org.custom_domains?.length || 0 },
          ].map((s) => (
            <div key={s.label} className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
              <p className="text-xs text-white/40 uppercase tracking-wider">{s.label}</p>
              <p className="text-2xl font-bold text-white mt-1">{s.value.toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      {/* Info grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-medium text-white/60">Details</h3>
          <InfoRow label="Email" value={org.email} />
          <InfoRow label="Slug" value={org.slug} mono />
          <InfoRow label="UUID" value={org.org_uuid} mono />
          <InfoRow label="Created" value={new Date(org.creation_date).toLocaleDateString()} />
          <InfoRow label="Updated" value={new Date(org.update_date).toLocaleDateString()} />
          {org.description && <InfoRow label="Description" value={org.description} />}
        </div>

        <div className="space-y-4">
          {/* Custom domains */}
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white/60 mb-3">Custom Domains</h3>
            {org.custom_domains?.length > 0 ? (
              <div className="space-y-2">
                {org.custom_domains.map((d: string) => (
                  <div key={d} className="flex items-center gap-2 text-sm text-emerald-400">
                    <Globe size={14} weight="fill" />
                    {d}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-white/25">No custom domains configured</p>
            )}
          </div>

          {/* Admin users */}
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white/60 mb-3">Admin Users</h3>
            {org.admin_users?.length > 0 ? (
              <div className="space-y-2">
                {org.admin_users.map((u: any) => (
                  <div key={u.username} className="flex items-center gap-2">
                    {u.avatar_image ? (
                      <img
                        src={getAvatarUrl(u.user_uuid, u.avatar_image)}
                        alt={u.username}
                        className="w-6 h-6 rounded-full object-cover bg-gray-700"
                        onError={(e) => {
                          ;(e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
                        <User size={12} weight="fill" className="text-white/40" />
                      </div>
                    )}
                    <div>
                      <span className="text-sm text-white/80">{u.username}</span>
                      <span className="text-xs text-white/30 ml-2">{u.email}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-white/25">No admin users</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-white/40">{label}</span>
      <span className={`text-sm text-white/80 ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Courses Tab
// ---------------------------------------------------------------------------
function CoursesTab({
  orgId,
  accessToken,
  orgUuid,
  orgSlug,
}: {
  orgId: string
  accessToken: string
  orgUuid: string
  orgSlug: string
}) {
  const { searchParams, updateParams } = useUrlParams()
  const page = Number(searchParams.get('page')) || 1
  const setPage = (p: number) => updateParams({ tab: 'courses', page: p })

  const domain = getFrontendDomain()

  const { data, isLoading } = useQuery({
    queryKey: [...queryKeys.courses.list(orgId), 'superadmin', page],
    queryFn: () => apiFetch(`${getAPIUrl()}ee/superadmin/organizations/${orgId}/courses?page=${page}&limit=20`, accessToken),
    enabled: !!accessToken,
    staleTime: 60_000,
  })

  if (isLoading) return <PageLoading />

  const items = data?.items || []
  const total = data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / 20))

  if (items.length === 0 && page === 1) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-white/40">
        <BookOpen size={48} weight="fill" />
        <p className="mt-4">No courses in this organization</p>
      </div>
    )
  }

  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:'

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-white/40">{total} course{total !== 1 ? 's' : ''}</span>
      </div>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-white/[0.08]">
            <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">Course</th>
            <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">Status</th>
            <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">Visibility</th>
            <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map((course: any) => {
            const courseId = course.course_uuid.replace(/^course_/, '')
            const courseUrl = `${protocol}//${orgSlug}.${domain}/course/${courseId}`
            return (
              <tr
                key={course.id}
                className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors cursor-pointer"
                onClick={() => window.open(courseUrl, '_blank', 'noopener,noreferrer')}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {course.thumbnail_image ? (
                      <img
                        src={getCourseThumbnailUrl(orgUuid, course.course_uuid, course.thumbnail_image)}
                        alt={course.name}
                        className="h-8 w-12 object-cover rounded bg-white/[0.05]"
                        onError={(e) => {
                          ;(e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    ) : (
                      <div className="h-8 w-12 rounded bg-white/[0.05] flex items-center justify-center">
                        <BookOpen size={14} weight="fill" className="text-white/20" />
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium text-white">{course.name}</p>
                      {course.description && (
                        <p className="text-xs text-white/30 truncate max-w-xs">{course.description}</p>
                      )}
                    </div>
                    <ArrowSquareOut size={14} weight="bold" className="text-white/20 ml-auto shrink-0" />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      course.published
                        ? 'bg-emerald-400/10 text-emerald-400'
                        : 'bg-yellow-400/10 text-yellow-400'
                    }`}
                  >
                    {course.published ? 'Published' : 'Draft'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 text-xs text-white/50">
                    {course.public ? (
                      <>
                        <Eye size={14} /> Public
                      </>
                    ) : (
                      <>
                        <EyeSlash size={14} /> Private
                      </>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-white/40">
                    {new Date(course.creation_date).toLocaleDateString()}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Users Tab
// ---------------------------------------------------------------------------
function UsersTab({ orgId, accessToken }: { orgId: string; accessToken: string }) {
  const { searchParams, updateParams } = useUrlParams()
  const page = Number(searchParams.get('page')) || 1
  const search = searchParams.get('search') || ''
  const [searchInput, setSearchInput] = useState(search)

  const setPage = (p: number) => updateParams({ tab: 'users', page: p, search })

  const { data, isLoading } = useQuery({
    queryKey: [...queryKeys.org.users(Number(orgId)), 'superadmin', page, search],
    queryFn: () => apiFetch(`${getAPIUrl()}ee/superadmin/organizations/${orgId}/users?page=${page}&limit=20&search=${encodeURIComponent(search)}`, accessToken),
    enabled: !!accessToken,
    staleTime: 60_000,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    updateParams({ tab: 'users', search: searchInput, page: 1 })
  }

  if (isLoading && !data) return <PageLoading />

  const items = data?.items || []
  const total = data?.total || 0
  const totalPages = Math.max(1, Math.ceil(total / 20))

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-white/40">{total} user{total !== 1 ? 's' : ''}</span>
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlass
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search users..."
              className="bg-white/[0.05] border border-white/[0.08] rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/20 w-48"
            />
          </div>
        </form>
      </div>

      {items.length === 0 && page === 1 ? (
        <div className="flex flex-col items-center justify-center py-20 text-white/40">
          <Users size={48} weight="fill" />
          <p className="mt-4">{search ? 'No users match your search' : 'No users in this organization'}</p>
        </div>
      ) : (
        <>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/[0.08]">
                <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">User</th>
                <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">Email</th>
                <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">Role</th>
                <th className="px-4 py-3 text-xs font-medium text-white/40 uppercase tracking-wider">Joined</th>
              </tr>
            </thead>
            <tbody>
              {items.map((user: any) => (
                <tr key={user.id} className="border-b border-white/[0.05] hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {user.avatar_image ? (
                        <img
                          src={getAvatarUrl(user.user_uuid, user.avatar_image)}
                          alt={user.username}
                          className="w-7 h-7 rounded-full object-cover bg-gray-700"
                          onError={(e) => {
                            ;(e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center">
                          <User size={14} weight="fill" className="text-white/40" />
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium text-white">{user.username}</p>
                        {(user.first_name || user.last_name) && (
                          <p className="text-xs text-white/30">
                            {[user.first_name, user.last_name].filter(Boolean).join(' ')}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-white/50">{user.email}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-white/60 capitalize">{user.role_name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-white/40">
                      {user.creation_date ? new Date(user.creation_date).toLocaleDateString() : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Analytics Tab
// ---------------------------------------------------------------------------
function AnalyticsTab({ orgId, accessToken }: { orgId: string; accessToken: string }) {
  const { searchParams, updateParams } = useUrlParams()
  const days = Number(searchParams.get('days')) || 30
  const setDays = (d: number) => updateParams({ tab: 'analytics', days: d })

  const { data: analytics, isLoading } = useQuery({
    queryKey: [...queryKeys.superadmin.analytics(), 'org', orgId, days],
    queryFn: () => apiFetch(`${getAPIUrl()}ee/superadmin/organizations/${orgId}/analytics?days=${days}`, accessToken),
    enabled: !!accessToken,
    staleTime: 60_000,
  })

  if (isLoading) return <PageLoading />

  if (!analytics || Object.keys(analytics).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-white/40">
        <ChartBar size={48} weight="fill" />
        <p className="mt-4 text-lg">No analytics available</p>
        <p className="text-sm text-white/25 mt-1">Ensure Tinybird analytics is configured</p>
      </div>
    )
  }

  // Extract key metrics from core queries
  const liveUsers = analytics.live_users?.data?.[0]?.live_users || 0
  const funnel = analytics.enrollment_funnel?.data?.[0] || {}
  const eventCounts = analytics.event_counts?.data || []
  const dauData = analytics.daily_active_users?.data || []
  const topCourses = analytics.top_courses?.data || []
  const countryData = analytics.visitors_by_country?.data || []
  const deviceData = analytics.visitors_by_device?.data || []
  const referrerData = analytics.visitors_by_referrer?.data || []

  return (
    <div className="space-y-6">
      {/* Time range selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-white/40">Period:</span>
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
              days === d
                ? 'bg-white/10 text-white'
                : 'text-white/40 hover:text-white/60 hover:bg-white/[0.05]'
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard label="Live Users" value={liveUsers} />
        <MetricCard label="Page Views" value={funnel.page_views || 0} />
        <MetricCard label="Course Views" value={funnel.course_views || 0} />
        <MetricCard label="Enrollments" value={funnel.enrollments || 0} />
        <MetricCard label="Completions" value={funnel.completions || 0} />
      </div>

      {/* DAU Chart (simple bar representation) */}
      {dauData.length > 0 && (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
          <h3 className="text-sm font-medium text-white/60 mb-4">Daily Active Users</h3>
          <div className="flex items-end gap-1 h-24">
            {dauData.map((d: any, i: number) => {
              const max = Math.max(...dauData.map((x: any) => x.dau || 0), 1)
              const height = ((d.dau || 0) / max) * 100
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-blue-400/40 rounded-sm min-h-[2px]"
                    style={{ height: `${height}%` }}
                    title={`${d.date}: ${d.dau} users`}
                  />
                </div>
              )
            })}
          </div>
          <div className="flex justify-between mt-2">
            <span className="text-[10px] text-white/20">{dauData[0]?.date}</span>
            <span className="text-[10px] text-white/20">{dauData[dauData.length - 1]?.date}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Top Courses */}
        {topCourses.length > 0 && (
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
            <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">Top Courses</h3>
            <div className="space-y-2">
              {topCourses.slice(0, 5).map((c: any, i: number) => (
                <div key={i} className="flex justify-between items-center">
                  <span className="text-xs text-white/50 truncate max-w-[140px] font-mono">
                    {c.course_uuid?.slice(0, 12)}...
                  </span>
                  <div className="flex gap-3 text-xs">
                    <span className="text-white/60">{c.views} views</span>
                    <span className="text-emerald-400/80">{c.enrollments} enrolled</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Event Counts */}
        {eventCounts.length > 0 && (
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
            <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">Events</h3>
            <div className="space-y-2">
              {eventCounts.slice(0, 8).map((e: any, i: number) => (
                <div key={i} className="flex justify-between items-center">
                  <span className="text-xs text-white/50">{e.event_name}</span>
                  <span className="text-xs text-white/70 tabular-nums">
                    {(e.total || 0).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Countries */}
        {countryData.length > 0 && (
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
            <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">Top Countries</h3>
            <div className="space-y-2">
              {countryData.slice(0, 8).map((c: any, i: number) => (
                <div key={i} className="flex justify-between items-center">
                  <span className="text-xs text-white/50">{c.country_code || 'Unknown'}</span>
                  <span className="text-xs text-white/70 tabular-nums">
                    {(c.visits || 0).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Devices */}
        {deviceData.length > 0 && (
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
            <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">Devices</h3>
            <div className="space-y-2">
              {deviceData.map((d: any, i: number) => (
                <div key={i} className="flex justify-between items-center">
                  <span className="text-xs text-white/50 capitalize">{d.device_type || 'Unknown'}</span>
                  <span className="text-xs text-white/70 tabular-nums">
                    {(d.visits || 0).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Referrers */}
        {referrerData.length > 0 && (
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5">
            <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">Top Referrers</h3>
            <div className="space-y-2">
              {referrerData.slice(0, 8).map((r: any, i: number) => (
                <div key={i} className="flex justify-between items-center">
                  <span className="text-xs text-white/50 truncate max-w-[140px]">
                    {r.referrer_domain || 'Direct'}
                  </span>
                  <span className="text-xs text-white/70 tabular-nums">
                    {(r.visits || 0).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Show any remaining query results generically */}
        {Object.entries(analytics)
          .filter(
            ([key]) =>
              ![
                'live_users',
                'enrollment_funnel',
                'event_counts',
                'daily_active_users',
                'top_courses',
                'visitors_by_country',
                'visitors_by_device',
                'visitors_by_referrer',
                'daily_visitor_breakdown',
                'activity_engagement',
              ].includes(key)
          )
          .map(([queryName, queryData]: [string, any]) => {
            const rows = queryData?.data || []
            if (rows.length === 0) return null
            const firstRow = rows[0] || {}
            const values = Object.entries(firstRow)
            return (
              <div
                key={queryName}
                className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5"
              >
                <h3 className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">
                  {queryName.replace(/_/g, ' ')}
                </h3>
                <div className="space-y-2">
                  {values.map(([key, val]: [string, any]) => (
                    <div key={key} className="flex justify-between items-center">
                      <span className="text-xs text-white/50">{key.replace(/_/g, ' ')}</span>
                      <span className="text-xs font-medium text-white/70">
                        {typeof val === 'number' ? val.toLocaleString() : String(val)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
      </div>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-4">
      <p className="text-xs text-white/40 uppercase tracking-wider">{label}</p>
      <p className="text-xl font-bold text-white mt-1">{value.toLocaleString()}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plan Tab
// ---------------------------------------------------------------------------
function PlanTab({
  orgId,
  accessToken,
  currentPlan,
  config,
}: {
  orgId: string
  accessToken: string
  currentPlan: string
  config: any
}) {
  const queryClient = useQueryClient()
  const [selectedPlan, setSelectedPlan] = useState(currentPlan)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const plans = [
    {
      id: 'free',
      name: 'Free',
      description: 'Basic features for small teams',
      color: 'text-white/40 bg-white/[0.06]',
    },
    {
      id: 'standard',
      name: 'Standard',
      description: 'Custom domains, more storage',
      color: 'text-blue-400 bg-blue-400/10',
    },
    {
      id: 'pro',
      name: 'Pro',
      description: 'Advanced analytics, API access',
      color: 'text-purple-400 bg-purple-400/10',
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      description: 'Multi-org, unlimited everything',
      color: 'text-amber-400 bg-amber-400/10',
    },
  ]

  const [error, setError] = useState('')

  const handleSavePlan = async () => {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const res = await fetch(`${getAPIUrl()}ee/superadmin/organizations/${orgId}/plan`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ plan: selectedPlan }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || `Failed to update plan (${res.status})`)
        return
      }
      setSaved(true)
      // Refresh org data so currentPlan updates
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(orgId) })
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  // Feature limits from config (v2: resolved_features, v1: features)
  const features = config?.resolved_features || config?.features || {}

  return (
    <div className="space-y-6">
      {/* Plan selector */}
      <div>
        <h3 className="text-sm font-medium text-white/60 mb-4">Plan</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {plans.map((plan) => (
            <button
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className={`text-left p-4 rounded-xl border transition-all ${
                selectedPlan === plan.id
                  ? 'border-white/30 bg-white/[0.06]'
                  : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15]'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-medium uppercase tracking-wider px-2 py-0.5 rounded ${plan.color}`}>
                  {plan.name}
                </span>
                {selectedPlan === plan.id && (
                  <Check size={16} weight="bold" className="text-emerald-400" />
                )}
              </div>
              <p className="text-xs text-white/40 mt-1">{plan.description}</p>
            </button>
          ))}
        </div>
        {selectedPlan !== currentPlan && (
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleSavePlan}
              disabled={saving}
              className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Plan'}
            </button>
            <button
              onClick={() => setSelectedPlan(currentPlan)}
              className="px-4 py-2 text-white/40 hover:text-white/60 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        {saved && (
          <p className="text-sm text-emerald-400 mt-2">Plan updated successfully</p>
        )}
        {error && (
          <p className="text-sm text-red-400 mt-2">{error}</p>
        )}
      </div>

      {/* AI Credits */}
      <AICreditsSection orgId={orgId} accessToken={accessToken} />

      {/* Feature limits overview */}
      <div>
        <h3 className="text-sm font-medium text-white/60 mb-4">Feature Limits</h3>
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl divide-y divide-white/[0.06]">
          {Object.entries(features).map(([key, val]: [string, any]) => (
            <div key={key} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-2 h-2 rounded-full ${val?.enabled !== false ? 'bg-emerald-400' : 'bg-white/20'}`}
                />
                <span className="text-sm text-white/70 capitalize">{key.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-white/40">
                {val?.limit !== undefined && <span>Limit: {val.limit}</span>}
                {val?.signup_mode && <span>Signup: {val.signup_mode}</span>}
                {val?.admin_limit !== undefined && <span>Admin limit: {val.admin_limit}</span>}
                <span className={val?.enabled !== false ? 'text-emerald-400/60' : 'text-white/20'}>
                  {val?.enabled !== false ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AICreditsSection({ orgId, accessToken }: { orgId: string; accessToken: string }) {
  const queryClient = useQueryClient()
  const aiCreditsKey = ['superadmin', 'org', orgId, 'ai-credits'] as const
  const { data: summary, isLoading } = useQuery({
    queryKey: aiCreditsKey,
    queryFn: () => apiFetch(`${getAPIUrl()}orgs/${orgId}/ai-credits`, accessToken),
    enabled: !!accessToken,
    staleTime: 60_000,
  })

  const [amount, setAmount] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const initial = summary?.purchased_credits
  React.useEffect(() => {
    if (typeof initial === 'number') setAmount(String(initial))
  }, [initial])

  const parsed = amount === '' ? NaN : Number(amount)
  const isValid = Number.isInteger(parsed) && parsed >= 0
  const isDirty = isValid && parsed !== summary?.purchased_credits

  const setPurchased = async () => {
    if (!isValid) {
      setError('Enter a non-negative integer')
      return
    }
    setSaving(true)
    setError('')
    setSaved('')
    try {
      const res = await fetch(`${getAPIUrl()}orgs/${orgId}/ai-credits/set`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ amount: parsed }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || `Failed to set credits (${res.status})`)
        return
      }
      setSaved(`Purchased credits set to ${parsed.toLocaleString()}`)
      queryClient.invalidateQueries({ queryKey: aiCreditsKey })
      setTimeout(() => setSaved(''), 2500)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  const resetUsage = async () => {
    if (!confirm('Reset used AI credits to 0 for this org?')) return
    setResetting(true)
    setError('')
    setSaved('')
    try {
      const res = await fetch(`${getAPIUrl()}orgs/${orgId}/ai-credits/reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || `Failed to reset usage (${res.status})`)
        return
      }
      setSaved('Used credits reset to 0')
      queryClient.invalidateQueries({ queryKey: aiCreditsKey })
      setTimeout(() => setSaved(''), 2500)
    } catch {
      setError('Network error')
    } finally {
      setResetting(false)
    }
  }

  const fmt = (v: number | string | undefined) =>
    v === undefined ? '—' : typeof v === 'number' ? v.toLocaleString() : v

  return (
    <div>
      <h3 className="text-sm font-medium text-white/60 mb-4 flex items-center gap-2">
        <Robot size={14} weight="fill" className="text-violet-400" />
        AI Credits
      </h3>
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-5 space-y-5">
        {isLoading ? (
          <p className="text-sm text-white/40">Loading…</p>
        ) : !summary ? (
          <p className="text-sm text-red-400">Failed to load credits summary</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'Plan base', value: fmt(summary.base_credits) },
                { label: 'Purchased', value: fmt(summary.purchased_credits) },
                { label: 'Total', value: fmt(summary.total_credits) },
                { label: 'Used', value: fmt(summary.used_credits) },
                { label: 'Remaining', value: fmt(summary.remaining_credits) },
              ].map((s) => (
                <div key={s.label} className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2.5">
                  <p className="text-[10px] text-white/40 uppercase tracking-wider">{s.label}</p>
                  <p className="text-lg font-semibold text-white mt-1">{s.value}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-white/40 uppercase tracking-wider block mb-1.5">
                  Purchased credits
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
                  placeholder="e.g. 5000"
                />
              </div>
              <button
                onClick={setPurchased}
                disabled={saving || !isDirty}
                className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : 'Set purchased'}
              </button>
              <button
                onClick={resetUsage}
                disabled={resetting}
                className="px-4 py-2 bg-white/[0.04] hover:bg-white/[0.08] text-white/70 text-sm rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1.5"
                title="Reset the org's used AI credits to 0"
              >
                <ArrowClockwise size={14} weight="bold" />
                {resetting ? 'Resetting…' : 'Reset usage'}
              </button>
            </div>

            <p className="text-[11px] text-white/30 leading-snug">
              Overwrites the org's purchased credit balance. Total available = plan base + purchased. Resetting usage zeroes out consumed credits for the period.
            </p>

            {saved && <p className="text-sm text-emerald-400">{saved}</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Features Tab — per-feature admin toggles (writes to config.admin_toggles)
// ---------------------------------------------------------------------------

type FeatureToggle = { disabled: boolean }
type AIToggle = { disabled: boolean; copilot_enabled: boolean }
type MembersToggle = { disabled: boolean; signup_mode: 'open' | 'inviteOnly' }

type AdminToggles = {
  ai: AIToggle
  analytics: FeatureToggle
  api: FeatureToggle
  boards: FeatureToggle
  collaboration: FeatureToggle
  collections: FeatureToggle
  communities: FeatureToggle
  members: MembersToggle
  payments: FeatureToggle
  playgrounds: FeatureToggle
  podcasts: FeatureToggle
}

const DEFAULT_ADMIN_TOGGLES: AdminToggles = {
  ai: { disabled: false, copilot_enabled: true },
  analytics: { disabled: false },
  api: { disabled: false },
  boards: { disabled: false },
  collaboration: { disabled: false },
  collections: { disabled: false },
  communities: { disabled: false },
  members: { disabled: false, signup_mode: 'open' },
  payments: { disabled: false },
  playgrounds: { disabled: false },
  podcasts: { disabled: false },
}

const FEATURE_ORDER: { key: keyof AdminToggles; label: string; description: string }[] = [
  { key: 'ai', label: 'AI', description: 'AI assistant, copilot, generation tools' },
  { key: 'analytics', label: 'Analytics', description: 'Dashboards and engagement metrics' },
  { key: 'api', label: 'API', description: 'API tokens and programmatic access' },
  { key: 'boards', label: 'Boards', description: 'Kanban-style learning boards' },
  { key: 'collaboration', label: 'Collaboration', description: 'Real-time co-editing' },
  { key: 'collections', label: 'Collections', description: 'Group courses into collections' },
  { key: 'communities', label: 'Communities', description: 'Public/private community spaces' },
  { key: 'members', label: 'Members', description: 'Member directory and roles' },
  { key: 'payments', label: 'Payments', description: 'Paid courses and checkout' },
  { key: 'playgrounds', label: 'Playgrounds', description: 'Interactive code/exec environments' },
  { key: 'podcasts', label: 'Podcasts', description: 'Audio episodes inside courses' },
]

function ToggleSwitch({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        enabled ? 'bg-emerald-500/70' : 'bg-white/[0.12]'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  )
}

function FeaturesTab({
  orgId,
  accessToken,
  config,
  mode,
}: {
  orgId: string
  accessToken: string
  config: any
  mode: string
}) {
  const queryClient = useQueryClient()
  const version: string = config?.config_version || '1.0'
  const isV2 = version.startsWith('2')

  const initial: AdminToggles = useMemo(() => {
    if (!isV2) return DEFAULT_ADMIN_TOGGLES
    const incoming = config?.admin_toggles || {}
    return {
      ...DEFAULT_ADMIN_TOGGLES,
      ...incoming,
      ai: { ...DEFAULT_ADMIN_TOGGLES.ai, ...(incoming.ai || {}) },
      members: { ...DEFAULT_ADMIN_TOGGLES.members, ...(incoming.members || {}) },
    }
  }, [config, isV2])

  const [draft, setDraft] = useState<AdminToggles>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Re-sync when the org refetches (e.g., after a save invalidation).
  React.useEffect(() => {
    setDraft(initial)
  }, [initial])

  const isDirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const resolvedFeatures = config?.resolved_features || config?.features || {}

  const setFeatureEnabled = (key: keyof AdminToggles, enabled: boolean) => {
    setDraft((d) => ({ ...d, [key]: { ...d[key], disabled: !enabled } }))
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await fetch(
        `${getAPIUrl()}ee/superadmin/organizations/${orgId}/admin_toggles`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ toggles: draft }),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.detail || `Failed to save (${res.status})`)
        return
      }
      setSaved(true)
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(orgId) })
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  if (!isV2) {
    return (
      <div className="space-y-6">
        <div className="bg-amber-400/[0.06] border border-amber-400/20 rounded-xl p-5">
          <h3 className="text-sm font-medium text-amber-300">
            Per-feature toggles unavailable
          </h3>
          <p className="text-xs text-white/50 mt-1.5 leading-relaxed">
            This organization uses a legacy v1 config. Newly-created organizations use
            v2 and support these toggles automatically. Migrate this org to v2 to manage
            features here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-white/60 mb-1">Feature toggles</h3>
        <p className="text-xs text-white/40 mb-4">
          {mode === 'saas'
            ? 'Override the plan defaults for this organization. Disabled features are hidden from the org dashboard.'
            : 'Enable or disable features for this organization.'}
        </p>
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl divide-y divide-white/[0.06]">
          {FEATURE_ORDER.map(({ key, label, description }) => {
            const t = draft[key]
            const enabled = !t.disabled
            const limitInfo = resolvedFeatures[key]?.limit
            return (
              <div key={key} className="px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-white/90 font-medium">{label}</p>
                    <p className="text-xs text-white/40 mt-0.5">{description}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {mode === 'saas' && limitInfo !== undefined && limitInfo !== null && (
                      <span className="text-[11px] text-white/40">
                        Limit: {limitInfo === 0 ? '∞' : limitInfo}
                      </span>
                    )}
                    <ToggleSwitch
                      enabled={enabled}
                      onChange={(v) => setFeatureEnabled(key, v)}
                    />
                  </div>
                </div>

                {/* Special sub-controls */}
                {key === 'ai' && enabled && (
                  <div className="mt-3 pl-3 border-l-2 border-white/[0.06] flex items-center justify-between">
                    <div>
                      <p className="text-xs text-white/70">AI Copilot</p>
                      <p className="text-[11px] text-white/40">Inline writing/coding suggestions</p>
                    </div>
                    <ToggleSwitch
                      enabled={(draft.ai as AIToggle).copilot_enabled}
                      onChange={(v) =>
                        setDraft((d) => ({
                          ...d,
                          ai: { ...d.ai, copilot_enabled: v },
                        }))
                      }
                    />
                  </div>
                )}
                {key === 'members' && enabled && (
                  <div className="mt-3 pl-3 border-l-2 border-white/[0.06] flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-white/70">Signup mode</p>
                      <p className="text-[11px] text-white/40">
                        How new users can join the organization
                      </p>
                    </div>
                    <select
                      value={(draft.members as MembersToggle).signup_mode}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          members: {
                            ...d.members,
                            signup_mode: e.target.value as 'open' | 'inviteOnly',
                          },
                        }))
                      }
                      className="bg-white/[0.05] border border-white/[0.1] rounded-md px-2.5 py-1 text-xs text-white focus:outline-none focus:border-white/30"
                    >
                      <option value="open">Open</option>
                      <option value="inviteOnly">Invite only</option>
                    </select>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {(isDirty || saved || error) && (
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {isDirty && (
              <button
                onClick={() => setDraft(initial)}
                disabled={saving}
                className="px-4 py-2 text-white/40 hover:text-white/60 text-sm transition-colors"
              >
                Discard
              </button>
            )}
            {saved && <p className="text-sm text-emerald-400">Saved</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>
        )}
      </div>

      {/* In EE/OSS, AI Credits has no other home (Plan tab is hidden). */}
      {mode !== 'saas' && (
        <AICreditsSection orgId={orgId} accessToken={accessToken} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings Tab
// ---------------------------------------------------------------------------
function SettingsTab({
  orgId,
  accessToken,
  org,
}: {
  orgId: string
  accessToken: string
  org: any
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: org.name || '',
    slug: org.slug || '',
    email: org.email || '',
    description: org.description || '',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const hasChanges =
    form.name !== (org.name || '') ||
    form.slug !== (org.slug || '') ||
    form.email !== (org.email || '') ||
    form.description !== (org.description || '')

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const res = await fetch(
        `${getAPIUrl()}ee/superadmin/organizations/${orgId}/settings`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(form),
        }
      )
      if (!res.ok) {
        const data = await res.json()
        setError(data.detail || 'Failed to save')
        return
      }
      setSaved(true)
      queryClient.invalidateQueries({ queryKey: queryKeys.org.detail(orgId) })
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:'
  const dashSettingsUrl = `${protocol}//${org.slug}.${getFrontendDomain()}/dash/org/settings/general`

  return (
    <div className="max-w-2xl space-y-6">
      <a
        href={dashSettingsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 p-4 bg-white/[0.04] border border-white/[0.08] rounded-xl hover:bg-white/[0.07] hover:border-white/[0.14] transition-all group"
      >
        <div className="h-8 w-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
          <GearSix size={16} weight="fill" className="text-white/50 group-hover:text-white/80 transition-colors" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">Full Organization Settings</p>
          <p className="text-xs text-white/40 mt-0.5">Branding, features, AI, domains, SSO, API access, and more</p>
        </div>
        <ArrowSquareOut size={16} weight="bold" className="text-white/30 group-hover:text-white/60 shrink-0 transition-colors" />
      </a>
      <div>
        <h3 className="text-sm font-medium text-white/40 mb-4 uppercase tracking-wider text-xs">Platform Admin Controls</h3>
        <div className="space-y-4">
          <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field
            label="Slug"
            value={form.slug}
            onChange={(v) => setForm({ ...form, slug: v })}
            mono
            hint="Used in URLs. Changing this will break existing links."
          />
          <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <div>
            <label className="text-xs text-white/40 block mb-1.5">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/20 resize-none"
            />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {saved && <p className="text-sm text-emerald-400">Settings saved successfully</p>}

      {hasChanges && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            onClick={() =>
              setForm({
                name: org.name || '',
                slug: org.slug || '',
                email: org.email || '',
                description: org.description || '',
              })
            }
            className="px-4 py-2 text-white/40 hover:text-white/60 text-sm transition-colors"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  mono,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  mono?: boolean
  hint?: string
}) {
  return (
    <div>
      <label className="text-xs text-white/40 block mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/20 ${mono ? 'font-mono text-xs' : ''}`}
      />
      {hint && <p className="text-[10px] text-white/25 mt-1">{hint}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared Pagination
// ---------------------------------------------------------------------------
function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number
  totalPages: number
  onPageChange: (p: number) => void
}) {
  return (
    <div className="flex items-center justify-between mt-4 px-4">
      <span className="text-xs text-white/30">
        Page {page} of {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
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
                onClick={() => onPageChange(p)}
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
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="p-1.5 rounded text-white/40 hover:text-white hover:bg-white/[0.08] transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
        >
          <CaretRight size={14} weight="bold" />
        </button>
      </div>
    </div>
  )
}
