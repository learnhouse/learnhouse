'use client'
import React, { useMemo, useState } from 'react'
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { BookCopy, Check, GripVertical, ListOrdered, Loader2, Plus, Search, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useOrg } from '@components/Contexts/OrgContext'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Switch } from '@components/ui/switch'
import { getOrgCourses } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import { Path, PathCourseCard, setPathCourses, updatePath } from '@services/paths/paths'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { usePathCache } from './usePathSave'

type Row = { course_uuid: string; required: boolean; course: PathCourseCard }

function rowsFrom(path: Path): Row[] {
  return path.courses.map((item) => ({
    course_uuid: item.course_uuid,
    required: item.required,
    course: item.course,
  }))
}

function CourseThumb({ course, orgUuid }: { course: PathCourseCard; orgUuid: string }) {
  const src = course.thumbnail_image
    ? getCourseThumbnailMediaDirectory(orgUuid, course.course_uuid, course.thumbnail_image)
    : '/empty_thumbnail.png'
  return (
    <div
      className="w-20 aspect-video rounded-md bg-gray-100 bg-cover bg-center shrink-0 ring-1 ring-black/5"
      style={{ backgroundImage: `url(${src})` }}
    />
  )
}

function EditPathCourses({ path, orgslug }: { path: Path; orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const { accessToken, store } = usePathCache()
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(path))
  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [electives, setElectives] = useState(path.electives_required)

  // Re-seed local state whenever a save hands back a fresh path.
  const [seededFrom, setSeededFrom] = useState(path)
  if (seededFrom !== path) {
    setSeededFrom(path)
    setRows(rowsFrom(path))
    setElectives(path.electives_required)
  }

  const persist = async (next: Row[]) => {
    const previous = rows
    setRows(next)
    setSaving(true)
    try {
      const updated = await setPathCourses(
        path.path_uuid,
        next.map((r) => ({ course_uuid: r.course_uuid, required: r.required })),
        accessToken
      )
      store(updated)
    } catch (error: any) {
      setRows(previous)
      toast.error(getErrorMessage(error?.detail, t('paths.toasts.save_error')))
    } finally {
      setSaving(false)
    }
  }

  const saveRules = async (body: { sequential?: boolean; electives_required?: number }) => {
    try {
      store(await updatePath(path.path_uuid, body, accessToken))
    } catch (error: any) {
      toast.error(getErrorMessage(error?.detail, t('paths.toasts.save_error')))
    }
  }

  const onDragEnd = (result: DropResult) => {
    if (!result.destination || result.destination.index === result.source.index) return
    const next = [...rows]
    const [moved] = next.splice(result.source.index, 1)
    next.splice(result.destination.index, 0, moved)
    persist(next)
  }

  const excluded = useMemo(() => new Set(rows.map((r) => r.course_uuid)), [rows])
  const requiredCount = rows.filter((r) => r.required).length
  const electiveCount = rows.length - requiredCount

  return (
    <div className="px-4 sm:px-10 pt-6 space-y-6">
      <div className="bg-white rounded-xl shadow-sm px-4 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50 px-3 sm:px-5 py-3 rounded-md mb-4">
          <div className="flex flex-col -space-y-1">
            <h2 className="font-bold text-lg text-gray-800 flex items-center gap-2">
              {t('paths.dashboard.courses.title')}
              {saving && <Loader2 size={14} className="animate-spin text-gray-400" />}
            </h2>
            <p className="text-gray-500 text-xs sm:text-sm">{t('paths.dashboard.courses.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-black hover:bg-black/90 rounded-lg transition-colors shrink-0"
          >
            <Plus size={16} />
            {t('paths.dashboard.courses.add')}
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="bg-gray-50 border border-dashed border-gray-200 rounded-lg p-10 text-center">
            <ListOrdered className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h3 className="font-medium text-gray-700 mb-1">{t('paths.dashboard.courses.empty_title')}</h3>
            <p className="text-sm text-gray-500 mb-4">{t('paths.dashboard.courses.empty_description')}</p>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Plus size={16} />
              {t('paths.dashboard.courses.add')}
            </button>
          </div>
        ) : (
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="path-courses">
              {(provided) => (
                <ol
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  aria-label={t('paths.dashboard.courses.title')}
                  className="space-y-2"
                >
                  {rows.map((row, index) => (
                    <Draggable key={row.course_uuid} draggableId={row.course_uuid} index={index}>
                      {(drag, snapshot) => (
                        <li
                          ref={drag.innerRef}
                          {...drag.draggableProps}
                          className={`flex items-center gap-3 bg-white border rounded-lg px-3 py-2.5 transition-shadow ${
                            snapshot.isDragging ? 'border-gray-300 shadow-lg' : 'border-gray-100 hover:border-gray-200'
                          }`}
                        >
                          <span
                            {...drag.dragHandleProps}
                            aria-label={t('paths.dashboard.courses.drag')}
                            className="text-gray-300 hover:text-gray-500 cursor-grab"
                          >
                            <GripVertical size={18} />
                          </span>
                          <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs font-bold flex items-center justify-center shrink-0">
                            {index + 1}
                          </span>
                          <CourseThumb course={row.course} orgUuid={org?.org_uuid} />
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-sm text-gray-900 truncate" dir="auto">
                              {row.course.name}
                            </div>
                            {row.course.published === false && (
                              <span className="text-[10px] font-bold uppercase tracking-wide text-yellow-700">
                                {t('paths.dashboard.courses.unpublished_hint')}
                              </span>
                            )}
                          </div>
                          <div
                            role="radiogroup"
                            aria-label={t('paths.dashboard.courses.requirement')}
                            className="flex items-center bg-gray-100 rounded-lg p-0.5 text-xs font-medium shrink-0"
                          >
                            {[true, false].map((value) => (
                              <button
                                key={String(value)}
                                type="button"
                                role="radio"
                                aria-checked={row.required === value}
                                onClick={() =>
                                  row.required !== value &&
                                  persist(rows.map((r, i) => (i === index ? { ...r, required: value } : r)))
                                }
                                className={`px-2.5 py-1 rounded-md transition-colors ${
                                  row.required === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                }`}
                              >
                                {value ? t('paths.required') : t('paths.elective')}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => persist(rows.filter((_, i) => i !== index))}
                            aria-label={t('paths.dashboard.courses.remove')}
                            className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <X size={16} />
                          </button>
                        </li>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </ol>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm px-4 py-4">
        <div className="flex flex-col -space-y-1 bg-gray-50 px-3 sm:px-5 py-3 rounded-md mb-4">
          <h2 className="font-bold text-lg text-gray-800">{t('paths.dashboard.rules.title')}</h2>
          <p className="text-gray-500 text-xs sm:text-sm">{t('paths.dashboard.rules.subtitle')}</p>
        </div>
        <div className="divide-y divide-gray-100">
          <div className="flex items-start justify-between gap-6 px-1 sm:px-2 py-4">
            <div>
              <div className="text-sm font-medium text-gray-900">{t('paths.dashboard.rules.sequential')}</div>
              <p className="text-xs text-gray-500 mt-0.5 max-w-xl">{t('paths.dashboard.rules.sequential_hint')}</p>
            </div>
            <Switch
              checked={path.sequential}
              onCheckedChange={(checked) => saveRules({ sequential: checked })}
              aria-label={t('paths.dashboard.rules.sequential')}
            />
          </div>
          <div className="flex items-start justify-between gap-6 px-1 sm:px-2 py-4">
            <div>
              <div className="text-sm font-medium text-gray-900">{t('paths.dashboard.rules.electives')}</div>
              <p className="text-xs text-gray-500 mt-0.5 max-w-xl">
                {electiveCount
                  ? t('paths.dashboard.rules.electives_hint', { count: electiveCount })
                  : t('paths.dashboard.rules.electives_none')}
              </p>
            </div>
            <input
              type="number"
              min={0}
              max={electiveCount}
              disabled={!electiveCount}
              value={electives}
              onChange={(e) => setElectives(Math.max(0, Math.min(electiveCount, Number(e.target.value) || 0)))}
              onBlur={() => electives !== path.electives_required && saveRules({ electives_required: electives })}
              aria-label={t('paths.dashboard.rules.electives')}
              className="w-20 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-black/20 focus:border-transparent outline-none disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>
        </div>
        <p className="mt-2 px-1 sm:px-2 text-xs text-gray-500 flex items-center gap-1.5">
          <Check size={14} className="text-green-600 shrink-0" />
          {t('paths.dashboard.rules.summary', {
            required: requiredCount,
            electives: Math.min(path.electives_required, electiveCount),
          })}
        </p>
      </div>

      <CoursePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        orgslug={orgslug}
        orgUuid={org?.org_uuid}
        exclude={excluded}
        onAdd={(courses) =>
          persist([...rows, ...courses.map((course) => ({ course_uuid: course.course_uuid, required: true, course }))])
        }
      />
    </div>
  )
}

function CoursePicker({
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
  onAdd: (courses: PathCourseCard[]) => void
}) {
  const { t } = useTranslation()
  const { accessToken } = usePathCache()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])

  const { data: courses, isLoading } = useQuery({
    queryKey: ['courses', orgslug, 'all-for-paths'],
    queryFn: () => getOrgCourses(orgslug, {}, accessToken, true),
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
      dialogTitle={t('paths.dashboard.picker.title')}
      dialogDescription={t('paths.dashboard.picker.description')}
      minWidth="md"
      dialogContent={
        <div className="space-y-4">
          <div className="relative">
            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('paths.dashboard.picker.search')}
              className="w-full ps-9 pe-4 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-black/20 focus:border-transparent outline-none text-sm"
            />
          </div>
          <div className="max-h-[360px] overflow-y-auto -mx-1 px-1 space-y-1">
            {isLoading && (
              <div className="flex justify-center py-8">
                <Loader2 className="animate-spin text-gray-400" />
              </div>
            )}
            {!isLoading && available.length === 0 && (
              <div className="text-center py-8 text-sm text-gray-500">
                <BookCopy className="mx-auto mb-2 text-gray-300" />
                {t('paths.dashboard.picker.empty')}
              </div>
            )}
            {available.map((course) => {
              const index = selected.indexOf(course.course_uuid)
              const isSelected = index !== -1
              return (
                <button
                  key={course.course_uuid}
                  type="button"
                  onClick={() => toggle(course.course_uuid)}
                  className={`w-full flex items-center gap-3 p-2 rounded-lg border text-start transition-colors ${
                    isSelected ? 'border-gray-200 bg-gray-50' : 'border-transparent hover:bg-gray-50'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      isSelected ? 'bg-black border-black text-white' : 'border-gray-300'
                    }`}
                  >
                    {isSelected ? index + 1 : ''}
                  </span>
                  <CourseThumb course={course} orgUuid={orgUuid} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-gray-900 truncate" dir="auto">{course.name}</span>
                    {course.published === false && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-yellow-700">
                        {t('paths.draft')}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={close}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={!selected.length}
              onClick={confirm}
              className="px-4 py-2 text-sm font-medium text-white bg-black hover:bg-black/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('paths.dashboard.picker.add', { count: selected.length })}
            </button>
          </div>
        </div>
      }
    />
  )
}

export default EditPathCourses
