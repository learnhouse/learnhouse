'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowSquareOut, BookOpen, CalendarBlank, CheckCircle, Eye, EyeSlash } from '@phosphor-icons/react'
import { Button, EmptyState, Panel, StatusPill, recipes } from '@/design'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { safeHref } from '@services/security/url'
import { saRequest } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import type { Paginated } from '@services/ee/platform/types'
import { useAccessToken, useFrontendDomain, useListKeyboard, useUrlQuery, shouldRetry } from '@components/Admin/hooks'
import FilterBar, { filterKeys, resolveDate, type FilterDef } from '@components/Admin/Shared/FilterBar'
import { ListSkeleton, Pagination, QueryError, formatDate } from '@components/Admin/Shared/AdminKit'

const LIMIT = 20
// Prefixed URL keys so Courses filters don't collide with the Members tab.
const K = { q: 'c_q', published: 'c_published', visibility: 'c_visibility', since: 'c_created_since', until: 'c_created_until', page: 'c_page' } as const

function inRange(value: string | null | undefined, since?: string, until?: string): boolean {
  if (!since && !until) return true
  if (!value) return false
  const t = new Date(value).getTime()
  if (since && t < new Date(since).getTime()) return false
  if (until && t > new Date(until).getTime()) return false
  return true
}

function Thumb({ orgUuid, course }: { orgUuid: string; course: any }) {
  const [failed, setFailed] = React.useState(false)
  const file: string | null = course.thumbnail_image || null
  if (file && !failed) {
    const src = file.startsWith('http') ? file : getCourseThumbnailMediaDirectory(orgUuid, course.course_uuid, file)
    return <img src={src} alt="" onError={() => setFailed(true)} className="h-9 w-14 rounded-lg object-cover bg-neutral-100 shrink-0" />
  }
  return (
    <span className="h-9 w-14 rounded-lg bg-neutral-100 text-neutral-300 flex items-center justify-center shrink-0">
      <BookOpen size={16} weight="fill" />
    </span>
  )
}

export default function CoursesSection({ orgId, orgUuid, orgSlug }: { orgId: string; orgUuid: string; orgSlug: string }) {
  const { t, i18n } = useTranslation()
  const token = useAccessToken()
  const domain = useFrontendDomain()
  const [url, setUrl] = useUrlQuery()
  const search = url[K.q] ?? ''
  const published = url[K.published]
  const visibility = url[K.visibility]
  const since = resolveDate(url[K.since])
  const until = resolveDate(url[K.until], true)
  const page = Math.max(1, Number(url[K.page]) || 1)
  const setPage = (p: number) => setUrl({ [K.page]: p > 1 ? String(p) : undefined })

  const query = {
    page,
    limit: LIMIT,
    q: search,
    search,
    published,
    visibility,
    public: visibility ? String(visibility === 'public') : undefined,
    created_since: since,
    created_until: until,
  }
  const q = useQuery({
    queryKey: [...platformKeys.orgCourses(orgId, page), { search, published, visibility, since, until }],
    queryFn: () => saRequest<Paginated<any>>(`/organizations/${orgId}/courses`, token, { query }),
    enabled: !!token,
    retry: shouldRetry,
    placeholderData: (prev) => prev,
  })
  const raw: any[] = Array.isArray(q.data?.items) ? q.data!.items : []
  // Client-side pass for filters an older server doesn't apply.
  const items = raw.filter((c) => {
    if (published && String(!!c.published) !== published) return false
    if (visibility && (visibility === 'public') !== !!c.public) return false
    if (!inRange(c.creation_date, since, until)) return false
    if (search && !`${c.name ?? ''} ${c.description ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const total = q.data?.total ?? 0
  const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:'
  const courseUrl = (course: any) => `${protocol}//${orgSlug}.${domain}/course/${String(course.course_uuid || '').replace(/^course_/, '')}`
  // j/k + Enter: open the highlighted course in a new tab.
  const kb = useListKeyboard(items, (c) => window.open(safeHref(courseUrl(c)), '_blank', 'noopener,noreferrer'))
  const defs: FilterDef[] = [
    {
      key: K.published,
      kind: 'boolean',
      label: t('common.status'),
      icon: <CheckCircle size={14} />,
      trueLabel: t('admin.org_detail.published'),
      falseLabel: t('admin.org_detail.draft'),
    },
    {
      key: K.visibility,
      kind: 'select',
      label: t('admin.org_detail.visibility'),
      icon: <Eye size={14} />,
      options: [
        { value: 'public', label: t('admin.org_detail.public') },
        { value: 'private', label: t('admin.org_detail.private') },
      ],
    },
    { key: 'c_created', kind: 'date', sinceKey: K.since, untilKey: K.until, label: t('admin.org_detail.created'), icon: <CalendarBlank size={14} /> },
  ]
  const filtered = !!(search || published || visibility || since || until)
  const clear = () => {
    const u: Record<string, undefined> = { [K.q]: undefined, [K.page]: undefined }
    for (const k of filterKeys(defs)) u[k] = undefined
    setUrl(u)
  }
  const bar = (
    <FilterBar
      values={url}
      onChange={setUrl}
      defs={defs}
      search={{ key: K.q, placeholder: t('admin.org.search_courses') }}
      pageKey={K.page}
      end={<span className="text-xs text-neutral-400 tabular-nums">{t('admin.org_detail.courses_count', { count: total })}</span>}
    />
  )

  let body: React.ReactNode
  if (q.isLoading) body = <ListSkeleton rows={5} />
  else if (q.error) body = <QueryError error={q.error} onRetry={() => q.refetch()} />
  else if (items.length === 0) {
    body = (
      <Panel>
        {filtered ? (
          <EmptyState
            icon={<BookOpen size={22} />}
            title={t('admin.org.no_courses_match')}
            action={
              <Button size="sm" onClick={clear}>
                {t('admin.org.clear_filters')}
              </Button>
            }
          />
        ) : (
          <EmptyState icon={<BookOpen size={22} />} title={t('admin.org_detail.no_courses')} description={t('admin.org.no_courses_desc')} />
        )}
      </Panel>
    )
  }
  if (body) {
    return (
      <div className="space-y-4">
        {bar}
        {body}
        {!q.isLoading && !q.error && <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {bar}
      <Panel divided className={q.isFetching ? 'opacity-70 transition-opacity' : ''}>
        <div className={`${recipes.tableHead} hidden sm:grid grid-cols-[minmax(0,1fr)_7rem_7rem_7rem] gap-4`}>
          <span>{t('admin.org_detail.course')}</span>
          <span>{t('common.status')}</span>
          <span>{t('admin.org_detail.visibility')}</span>
          <span>{t('admin.org_detail.created')}</span>
        </div>
        {items.map((course, i) => {
          const url = courseUrl(course)
          return (
            <a
              key={course.id}
              {...kb.rowProps(i)}
              href={safeHref(url)}
              target="_blank"
              rel="noopener noreferrer"
              className="group px-5 py-3 grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_7rem_7rem_7rem] gap-x-4 gap-y-1 items-center hover:bg-neutral-50 data-[active=true]:bg-neutral-50"
            >
              <span className="flex items-center gap-3 min-w-0">
                <Thumb orgUuid={orgUuid} course={course} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">
                    <span className="truncate">{course.name}</span>
                    <ArrowSquareOut size={13} className="shrink-0 text-neutral-300 group-hover:text-neutral-500" />
                  </span>
                  {course.description && <span className="block text-xs text-neutral-400 truncate">{course.description}</span>}
                </span>
              </span>
              <span>
                <StatusPill status={course.published ? 'success' : 'warning'} dot>
                  {course.published ? t('admin.org_detail.published') : t('admin.org_detail.draft')}
                </StatusPill>
              </span>
              <span className="hidden sm:flex items-center gap-1.5 text-xs text-neutral-500">
                {course.public ? <Eye size={14} /> : <EyeSlash size={14} />}
                {course.public ? t('admin.org_detail.public') : t('admin.org_detail.private')}
              </span>
              <span className="hidden sm:block text-xs text-neutral-500">{formatDate(course.creation_date, i18n.language)}</span>
            </a>
          )
        })}
      </Panel>
      <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />
    </div>
  )
}
