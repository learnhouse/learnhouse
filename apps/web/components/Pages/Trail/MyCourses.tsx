'use client'
import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BookOpen, DotsThree, SortAscending, Trash } from '@phosphor-icons/react'
import { getUriWithOrg } from '@services/config/config'
import { removeCourse } from '@services/courses/activity'
import { revalidateTags } from '@services/utils/ts/requests'
import { queryKeys } from '@/lib/query/keys'
import { searchMatchesAny } from '@/lib/search/normalize'
import { buttonClass, ConfirmDialog, SearchInput, SegmentedControl, ToolbarSelect } from '@components/Dashboard/Shared/DashKit/DashKit'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import TrailCourseCard from './TrailCourseCard'
import type { RunSummary } from './trailStats'
import type { NextActivity } from './useNextActivity'
import { TrailEmpty, TrailSection } from './trailUi'

type Tab = 'progress' | 'completed' | 'all'
type Sort = 'recent' | 'progress' | 'name'

export default function MyCourses({
  orgslug,
  orgId,
  accessToken,
  summaries,
  nextByCourse,
  loading,
}: {
  orgslug: string
  orgId?: number
  accessToken?: string
  summaries: RunSummary[]
  nextByCourse: Record<string, NextActivity | null>
  loading: boolean
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('progress')
  const [sort, setSort] = useState<Sort>('recent')
  const [query, setQuery] = useState('')
  const [quitAllOpen, setQuitAllOpen] = useState(false)
  const [quitProgress, setQuitProgress] = useState<number | null>(null)

  const counts = {
    progress: summaries.filter((s) => !s.completed).length,
    completed: summaries.filter((s) => s.completed).length,
    all: summaries.length,
  }

  const visible = useMemo(() => {
    let list = summaries.filter((s) => (tab === 'all' ? true : tab === 'completed' ? s.completed : !s.completed))
    if (query.trim()) list = list.filter((s) => searchMatchesAny([s.course?.name, s.course?.description], query))
    const time = (s: RunSummary) => s.lastActive?.getTime() ?? 0
    return [...list].sort((a, b) =>
      sort === 'progress' ? b.percent - a.percent : sort === 'name' ? String(a.course?.name).localeCompare(String(b.course?.name)) : time(b) - time(a)
    )
  }, [summaries, tab, sort, query])

  // Same as before: quit each course in turn, then refresh once.
  const quitAll = async () => {
    if (!summaries.length) return
    setQuitProgress(0)
    try {
      for (let i = 0; i < summaries.length; i++) {
        await removeCourse(summaries[i].courseUuid, orgslug, accessToken)
        setQuitProgress(Math.round(((i + 1) / summaries.length) * 100))
      }
      await revalidateTags(['courses'], orgslug)
      router.refresh()
      if (orgId) await queryClient.invalidateQueries({ queryKey: queryKeys.trail.org(orgId) })
    } catch (error) {
      console.error('Error quitting courses:', error)
    } finally {
      setQuitProgress(null)
    }
  }

  const nextFor = (s: RunSummary) => {
    const next = nextByCourse[s.courseUuid]
    if (!next) return null
    return {
      name: next.activity?.name,
      href: getUriWithOrg(orgslug, `/course/${s.courseUuid.replace('course_', '')}/activity/${next.activityId}`),
    }
  }

  return (
    <TrailSection
      id="trail-courses"
      icon={<BookOpen size={18} />}
      title={t('trail.courses.title', 'My courses')}
      description={t('trail.courses.description', 'Everything you have started, with what comes next.')}
      count={summaries.length}
      actions={
        summaries.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={t('courses.actions')} className={buttonClass('secondary', 'icon', 'h-8! w-8! rounded-full!')}>
                <DotsThree size={16} weight="bold" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
              <DropdownMenuItem
                onSelect={() => setQuitAllOpen(true)}
                disabled={quitProgress !== null}
                className="flex items-center gap-2 cursor-pointer text-rose-600 focus:text-rose-700 focus:bg-rose-50"
              >
                <Trash size={15} />
                {quitProgress !== null ? t('courses.quitting_courses', { progress: quitProgress }) : t('courses.quit_all_courses')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined
      }
    >
      {summaries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            ariaLabel={t('trail.courses.title', 'My courses')}
            value={tab}
            onChange={setTab}
            options={[
              { key: 'progress', label: t('trail.courses.in_progress', 'In progress'), count: counts.progress },
              { key: 'completed', label: t('trail.courses.completed', 'Completed'), count: counts.completed },
              { key: 'all', label: t('trail.courses.all', 'All'), count: counts.all },
            ]}
          />
          <div className="ms-auto flex items-center gap-2 min-w-0 w-full sm:w-auto">
            <SearchInput value={query} onChange={setQuery} placeholder={t('trail.courses.search', 'Search your courses')} className="flex-1 sm:flex-none sm:w-64 min-w-0" />
            <ToolbarSelect
              ariaLabel={t('trail.courses.sort', 'Sort')}
              icon={<SortAscending size={14} />}
              value={sort}
              onChange={(v) => setSort(v as Sort)}
              options={[
                { value: 'recent', label: t('trail.courses.sort_recent', 'Recent activity') },
                { value: 'progress', label: t('trail.courses.sort_progress', 'Progress') },
                { value: 'name', label: t('trail.courses.sort_name', 'Name') },
              ]}
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-white nice-shadow overflow-hidden">
              <div className="aspect-video bg-neutral-100" />
              <div className="p-4 space-y-2">
                <div className="h-4 bg-neutral-100 rounded w-3/4" />
                <div className="h-1.5 bg-neutral-100 rounded-full w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : summaries.length === 0 ? (
        <TrailEmpty
          icon={<BookOpen size={22} />}
          title={t('user.no_courses_in_progress')}
          description={t('user.start_course_to_see_progress')}
          action={
            <Link href={getUriWithOrg(orgslug, '/courses')} className={buttonClass('primary', 'md', 'rounded-full! px-4')}>
              {t('trail.start.button', 'Browse courses')}
              <ArrowRight size={13} weight="bold" className="rtl:rotate-180" />
            </Link>
          }
        />
      ) : visible.length === 0 ? (
        <p className="rounded-2xl bg-white nice-shadow px-5 py-8 text-center text-sm text-neutral-500">
          {query
            ? t('trail.courses.no_match', 'No course matches your search.')
            : tab === 'completed'
              ? t('trail.courses.none_completed', 'No finished courses yet. Keep going!')
              : t('trail.courses.none_in_progress', 'Nothing in progress. Pick a new course from the catalog.')}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {visible.map((s) => (
            <TrailCourseCard key={s.courseUuid} run={s.run} course={s.course} orgslug={orgslug} nextActivity={nextFor(s)} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={quitAllOpen}
        onOpenChange={setQuitAllOpen}
        title={t('courses.quit_all_courses_title')}
        message={t('courses.quit_all_courses_confirm')}
        confirmLabel={t('courses.quit_all_courses')}
        onConfirm={quitAll}
      />
    </TrailSection>
  )
}
