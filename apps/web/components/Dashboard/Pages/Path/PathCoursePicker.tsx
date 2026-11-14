'use client'
import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Books, Check, Plus, MagnifyingGlass, X } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { BTN_PRIMARY, BTN_SECONDARY, Chip } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getAllOrgCourses } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { PathCourseCard } from '@services/paths/paths'
import { usePathCache } from './usePathSave'

export function PathCourseThumb({
  course,
  orgUuid,
  className = 'w-20',
}: {
  course: PathCourseCard
  orgUuid: string
  className?: string
}) {
  const src = course.thumbnail_image
    ? getCourseThumbnailMediaDirectory(orgUuid, course.course_uuid, course.thumbnail_image)
    : null
  return <ThumbnailImage src={src} className={`aspect-video rounded-lg bg-neutral-100 shrink-0 ring-1 ring-black/5 ${className}`} />
}

// Multi-select course list. Courses are added in the order they were ticked,
// which the numbered badges make visible.
function PathCoursePicker({
  open,
  onClose,
  orgslug,
  orgUuid,
  exclude,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  orgslug: string
  orgUuid: string
  exclude: Set<string>
  onAdd: (_courses: PathCourseCard[]) => void
}) {
  const { t } = useTranslation()
  const { accessToken } = usePathCache()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])

  const { data: courses, isLoading } = useQuery({
    queryKey: ['courses', orgslug, 'all-for-paths'],
    queryFn: () => getAllOrgCourses(orgslug, accessToken, true),
    enabled: open && !!accessToken,
    staleTime: 30_000,
  })

  const close = () => {
    setSelected([])
    setQuery('')
    onClose()
  }

  const available: PathCourseCard[] = (courses || []).filter(
    (c: PathCourseCard) =>
      !exclude.has(c.course_uuid) && (c.name || '').toLowerCase().includes(query.trim().toLowerCase())
  )

  const toggle = (uuid: string) =>
    setSelected((prev) => (prev.includes(uuid) ? prev.filter((u) => u !== uuid) : [...prev, uuid]))

  const confirm = () => {
    // Keep the order the author picked them in.
    const byUuid = new Map((courses || []).map((c: PathCourseCard) => [c.course_uuid, c]))
    onAdd(selected.map((uuid) => byUuid.get(uuid)).filter(Boolean) as PathCourseCard[])
    close()
  }

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={(value) => !value && close()}
      dialogTitle={
        <span className="flex items-center gap-2">
          <Books size={20} className="text-sky-500" />
          {t('paths.dashboard.picker.title')}
        </span>
      }
      dialogDescription={t('paths.dashboard.picker.description')}
      minWidth="md"
      noPadding
      dialogContent={
        <div className="flex flex-col min-h-full">
          <div className="sticky top-0 z-10 bg-white px-5 pt-4 pb-3">
            <div className="relative">
              <MagnifyingGlass size={16} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('paths.dashboard.picker.search')}
                aria-label={t('paths.dashboard.picker.search')}
                className="w-full h-9 ps-10 pe-9 text-sm bg-neutral-50 rounded-lg ring-1 ring-inset ring-neutral-200 focus:outline-none focus:ring-2 focus:ring-neutral-900/15 focus:bg-white placeholder:text-neutral-400 transition-shadow"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={t('paths.clear_search')}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 px-5 pb-4 space-y-1.5">
            {isLoading &&
              [1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 animate-pulse">
                  <div className="w-6 h-6 rounded-full bg-neutral-100" />
                  <div className="w-20 aspect-video rounded-lg bg-neutral-100" />
                  <div className="h-3.5 w-1/3 rounded bg-neutral-100" />
                </div>
              ))}
            {!isLoading && available.length === 0 && (
              <div className="flex flex-col items-center text-center py-12 gap-3">
                <div className="w-12 h-12 rounded-2xl bg-neutral-100 text-neutral-400 flex items-center justify-center">
                  <Books size={22} />
                </div>
                <p className="text-sm font-medium text-neutral-500">{t('paths.dashboard.picker.empty')}</p>
              </div>
            )}
            {available.map((course) => {
              const index = selected.indexOf(course.course_uuid)
              const isSelected = index !== -1
              return (
                <button
                  key={course.course_uuid}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggle(course.course_uuid)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-start transition-all ${
                    isSelected
                      ? 'bg-neutral-50 ring-2 ring-neutral-900'
                      : 'ring-1 ring-inset ring-transparent hover:bg-neutral-50 hover:ring-neutral-200'
                  }`}
                >
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold tabular-nums shrink-0 transition-colors ${
                      isSelected ? 'bg-neutral-900 text-white' : 'ring-1 ring-inset ring-neutral-300 text-transparent'
                    }`}
                  >
                    {isSelected ? index + 1 : <Check size={12} />}
                  </span>
                  <PathCourseThumb course={course} orgUuid={orgUuid} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-neutral-900 truncate" dir="auto">
                      {course.name}
                    </span>
                    {course.description && (
                      <span className="block text-xs text-neutral-500 truncate" dir="auto">
                        {course.description}
                      </span>
                    )}
                  </span>
                  {course.published === false && <Chip tone="amber">{t('paths.draft')}</Chip>}
                </button>
              )
            })}
          </div>

          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-white border-t border-neutral-100">
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              {selected.length > 0 && (
                <>
                  <span className="font-semibold text-neutral-800 tabular-nums">
                    {t('paths.dashboard.picker.selected', { count: selected.length })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelected([])}
                    className="text-xs font-semibold text-neutral-400 hover:text-neutral-700"
                  >
                    {t('paths.dashboard.picker.clear')}
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 ms-auto">
              <button type="button" onClick={close} className={BTN_SECONDARY}>
                {t('common.cancel')}
              </button>
              <button type="button" disabled={!selected.length} onClick={confirm} className={BTN_PRIMARY}>
                <Plus size={16} />
                {t('paths.dashboard.picker.add', { count: selected.length })}
              </button>
            </div>
          </div>
        </div>
      }
    />
  )
}

export default PathCoursePicker
