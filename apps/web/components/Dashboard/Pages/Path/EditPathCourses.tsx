'use client'
import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { DragDropContext, Draggable, Droppable, DropResult } from '@hello-pangea/dnd'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Medal, CheckCircle, Flag, DotsSixVertical, CircleNotch, Lock, Minus, Plus, Shuffle, Sparkle, Trophy, X } from '@phosphor-icons/react'
import toast from 'react-hot-toast'
import { useOrg } from '@components/Contexts/OrgContext'
import { Switch } from '@components/ui/switch'
import { BTN_PRIMARY_SM, Chip, SectionCard, SettingRow } from '@components/Dashboard/Shared/DashKit/DashKit'
import { getUriWithOrg } from '@services/config/config'
import { Path, PathCourseCard, removePathPrefix, setPathCourses, updatePath } from '@services/paths/paths'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { usePathCache } from './usePathSave'
import PathCoursePicker, { PathCourseThumb } from './PathCoursePicker'

type Row = { course_uuid: string; required: boolean; course: PathCourseCard }

function rowsFrom(path: Path): Row[] {
  return path.courses.map((item) => ({
    course_uuid: item.course_uuid,
    required: item.required,
    course: item.course,
  }))
}

const SPRING = { type: 'spring', stiffness: 380, damping: 30 } as const

// The track column of the journey: a node with a dashed line running down to
// the next one. `last` drops the line so the track ends on the finish node.
function TrackColumn({ node, last, faded }: { node: React.ReactNode; last?: boolean; faded?: boolean }) {
  return (
    <div className="flex flex-col items-center w-10 shrink-0">
      {node}
      {!last && (
        <div
          className={`flex-1 w-0 min-h-3 border-s-2 border-dashed border-neutral-200 transition-opacity ${faded ? 'opacity-0' : ''}`}
        />
      )}
    </div>
  )
}

function StepNode({ index, required, locked }: { index: number; required: boolean; locked: boolean }) {
  return (
    <span
      className={`relative w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold tabular-nums shrink-0 transition-colors ${
        required
          ? 'bg-sky-500 text-white ring-4 ring-sky-100'
          : 'bg-violet-50 text-violet-600 outline-2 outline-dashed outline-violet-400 -outline-offset-2'
      }`}
    >
      {index + 1}
      {locked && (
        <span className="absolute -bottom-1 -end-1 w-5 h-5 rounded-full bg-white nice-shadow text-neutral-500 flex items-center justify-center">
          <Lock size={10} />
        </span>
      )}
    </span>
  )
}

function EditPathCourses({ path, orgslug }: { path: Path; orgslug: string }) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const { accessToken, store } = usePathCache()
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(path))
  const [saving, setSaving] = useState(false)
  const [savingRule, setSavingRule] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  // Optimistic values while a rule change is in flight.
  const [pendingElectives, setPendingElectives] = useState<number | null>(null)
  const [pendingSequential, setPendingSequential] = useState<boolean | null>(null)

  // Re-seed local state whenever a save hands back a fresh path.
  const [seededFrom, setSeededFrom] = useState(path)
  if (seededFrom !== path) {
    setSeededFrom(path)
    setRows(rowsFrom(path))
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
    setSavingRule(true)
    try {
      store(await updatePath(path.path_uuid, body, accessToken))
    } catch (error: any) {
      toast.error(getErrorMessage(error?.detail, t('paths.toasts.save_error')))
    } finally {
      setSavingRule(false)
      setPendingElectives(null)
      setPendingSequential(null)
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
  const sequential = pendingSequential ?? path.sequential
  const electives = pendingElectives ?? Math.min(path.electives_required, electiveCount)
  const firstRequired = rows.findIndex((r) => r.required)

  const stepElectives = (delta: number) => {
    const next = Math.max(0, Math.min(electiveCount, electives + delta))
    if (next === electives) return
    setPendingElectives(next)
    saveRules({ electives_required: next })
  }

  const toggleSequential = (checked: boolean) => {
    setPendingSequential(checked)
    saveRules({ sequential: checked })
  }

  const certificateHref = getUriWithOrg(orgslug, `/dash/paths/path/${removePathPrefix(path.path_uuid)}/certificate`)

  return (
    <div className="px-4 sm:px-10 pt-6 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
      {/* ---- The journey ---- */}
      <SectionCard
        title={
          <span className="flex items-center gap-2">
            {t('paths.dashboard.courses.title')}
            {saving && <CircleNotch size={14} className="animate-spin text-neutral-400" />}
          </span>
        }
        description={t('paths.dashboard.courses.subtitle')}
        actions={
          <button type="button" onClick={() => setPickerOpen(true)} className={BTN_PRIMARY_SM}>
            <Plus size={14} />
            {t('paths.dashboard.courses.add')}
          </button>
        }
        bodyClassName="px-5 pb-6 pt-4"
      >
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-5">
            <Chip tone="sky" icon={<span className="w-2 h-2 rounded-full bg-sky-500" />}>
              {t('paths.dashboard.journey.required_count', { count: requiredCount })}
            </Chip>
            <Chip tone="violet" icon={<span className="w-2 h-2 rounded-full outline-1 outline-dashed outline-violet-500 bg-white" />}>
              {t('paths.dashboard.journey.elective_count', { count: electiveCount })}
            </Chip>
            {sequential && (
              <Chip tone="neutral" icon={<Lock size={11} />}>
                {t('paths.dashboard.rules.sequential')}
              </Chip>
            )}
          </div>
        )}

        {/* Start */}
        <div className="flex gap-4">
          <TrackColumn
            node={
              <span className="w-10 h-10 rounded-full bg-neutral-900 text-white flex items-center justify-center shrink-0">
                <Flag size={16} />
              </span>
            }
          />
          <div className="pt-2.5 pb-5 text-xs font-bold uppercase tracking-wider text-neutral-400">
            {t('paths.dashboard.journey.start')}
          </div>
        </div>

        {/* Steps */}
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="path-courses">
            {(provided) => (
              <ol ref={provided.innerRef} {...provided.droppableProps} aria-label={t('paths.dashboard.courses.title')}>
                {rows.map((row, index) => (
                  <Draggable key={row.course_uuid} draggableId={row.course_uuid} index={index}>
                    {(drag, snapshot) => (
                      <li ref={drag.innerRef} {...drag.draggableProps} className="flex gap-4">
                        <TrackColumn
                          faded={snapshot.isDragging}
                          node={
                            <StepNode
                              index={index}
                              required={row.required}
                              locked={sequential && firstRequired !== -1 && index > firstRequired}
                            />
                          }
                        />
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          // Stagger only the entrance; hover reacts right away.
                          animate={{ opacity: 1, y: 0, transition: { ...SPRING, delay: Math.min(index, 10) * 0.035 } }}
                          transition={SPRING}
                          whileHover={snapshot.isDragging ? undefined : { y: -2 }}
                          className={`group flex-1 min-w-0 mb-3 flex flex-wrap sm:flex-nowrap items-center gap-3 rounded-2xl bg-white px-3 py-2.5 transition-[box-shadow,rotate,scale] duration-200 ${
                            snapshot.isDragging
                              ? 'shadow-2xl ring-2 ring-neutral-900/10 rotate-1 scale-[1.02]'
                              : 'ring-1 ring-neutral-200/80 hover:ring-neutral-300 hover:shadow-md'
                          }`}
                        >
                          <span
                            {...drag.dragHandleProps}
                            aria-label={t('paths.dashboard.courses.drag')}
                            className="text-neutral-300 hover:text-neutral-500 cursor-grab active:cursor-grabbing"
                          >
                            <DotsSixVertical size={18} />
                          </span>
                          <PathCourseThumb course={row.course} orgUuid={org?.org_uuid} />
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                              {t('paths.dashboard.journey.step', { n: index + 1 })}
                            </div>
                            <div className="font-semibold text-sm text-neutral-900 truncate" dir="auto">
                              {row.course.name}
                            </div>
                            {row.course.published === false && (
                              <span className="text-[11px] font-medium text-amber-600">
                                {t('paths.dashboard.courses.unpublished_hint')}
                              </span>
                            )}
                          </div>
                          <div
                            role="radiogroup"
                            aria-label={t('paths.dashboard.courses.requirement')}
                            className="flex items-center rounded-xl bg-neutral-100 p-0.5 text-xs font-semibold shrink-0"
                          >
                            {[true, false].map((value) => {
                              const active = row.required === value
                              return (
                                <button
                                  key={String(value)}
                                  type="button"
                                  role="radio"
                                  aria-checked={active}
                                  onClick={() =>
                                    !active && persist(rows.map((r, i) => (i === index ? { ...r, required: value } : r)))
                                  }
                                  className={`h-7 px-2.5 rounded-lg transition-colors ${
                                    active
                                      ? value
                                        ? 'bg-white text-sky-700 shadow-sm'
                                        : 'bg-white text-violet-700 shadow-sm'
                                      : 'text-neutral-500 hover:text-neutral-800'
                                  }`}
                                >
                                  {value ? t('paths.required') : t('paths.elective')}
                                </button>
                              )
                            })}
                          </div>
                          <button
                            type="button"
                            onClick={() => persist(rows.filter((_, i) => i !== index))}
                            aria-label={t('paths.dashboard.courses.remove')}
                            title={t('paths.dashboard.courses.remove')}
                            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-neutral-300 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          >
                            <X size={16} />
                          </button>
                        </motion.div>
                      </li>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </ol>
            )}
          </Droppable>
        </DragDropContext>

        {/* Add a course */}
        <div className="flex gap-4">
          <TrackColumn
            node={
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                aria-label={t('paths.dashboard.courses.add')}
                className="w-10 h-10 rounded-full bg-white text-neutral-400 outline-2 outline-dashed outline-neutral-300 -outline-offset-2 flex items-center justify-center shrink-0 hover:text-neutral-900 hover:outline-neutral-500 transition-colors"
              >
                <Plus size={18} />
              </button>
            }
          />
          <motion.button
            type="button"
            onClick={() => setPickerOpen(true)}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            transition={SPRING}
            className="flex-1 min-w-0 mb-3 rounded-2xl border-2 border-dashed border-neutral-200 px-4 py-3.5 text-start hover:border-neutral-300 hover:bg-neutral-50/70 transition-colors"
          >
            <span className="block text-sm font-semibold text-neutral-800">
              {rows.length === 0 ? t('paths.dashboard.courses.empty_title') : t('paths.dashboard.courses.add')}
            </span>
            <span className="block text-xs text-neutral-500 mt-0.5">
              {rows.length === 0 ? t('paths.dashboard.courses.empty_description') : t('paths.dashboard.journey.add_hint')}
            </span>
          </motion.button>
        </div>

        {/* Finish */}
        <div className="flex gap-4">
          <TrackColumn
            last
            node={
              <motion.span
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.15 }}
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  path.certificate_enabled ? 'bg-amber-400 text-white ring-4 ring-amber-100' : 'bg-neutral-100 text-neutral-500'
                }`}
              >
                {path.certificate_enabled ? <Medal size={18} /> : <Trophy size={17} />}
              </motion.span>
            }
          />
          <div className="pt-1 min-w-0">
            <div className="text-sm font-semibold text-neutral-900">{t('paths.dashboard.journey.finish')}</div>
            {path.certificate_enabled ? (
              <p className="text-xs text-amber-700">{t('paths.dashboard.journey.finish_certificate')}</p>
            ) : (
              <p className="text-xs text-neutral-500">
                {t('paths.dashboard.journey.finish_plain')}{' '}
                <Link href={certificateHref} className="font-semibold text-neutral-700 hover:text-neutral-900 underline underline-offset-2">
                  {t('paths.dashboard.certificate.enable')}
                </Link>
              </p>
            )}
          </div>
        </div>
      </SectionCard>

      {/* ---- Completion rules ---- */}
      <div className="xl:sticky xl:top-6 flex flex-col gap-4">
        <SectionCard
          icon={<Sparkle size={16} />}
          title={
            <span className="flex items-center gap-2">
              {t('paths.dashboard.rules.title')}
              {savingRule && <CircleNotch size={14} className="animate-spin text-neutral-400" />}
            </span>
          }
          description={t('paths.dashboard.rules.subtitle')}
        >
          <div className="divide-y divide-neutral-100">
            <SettingRow
              icon={<Lock size={16} />}
              title={t('paths.dashboard.rules.sequential')}
              description={t('paths.dashboard.rules.sequential_hint')}
              control={
                <Switch
                  checked={sequential}
                  disabled={savingRule}
                  onCheckedChange={toggleSequential}
                  aria-label={t('paths.dashboard.rules.sequential')}
                />
              }
            />
            <SettingRow
              icon={<Shuffle size={16} />}
              title={t('paths.dashboard.rules.electives')}
              description={
                electiveCount
                  ? t('paths.dashboard.rules.electives_hint', { count: electiveCount })
                  : t('paths.dashboard.rules.electives_none')
              }
              control={
                <div
                  className={`inline-flex items-center rounded-xl bg-neutral-100 p-0.5 ${electiveCount ? '' : 'opacity-50'}`}
                  role="group"
                  aria-label={t('paths.dashboard.rules.electives')}
                >
                  <button
                    type="button"
                    onClick={() => stepElectives(-1)}
                    disabled={savingRule || electives <= 0}
                    aria-label={t('paths.dashboard.rules.decrease')}
                    className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-neutral-600 hover:bg-white hover:shadow-sm disabled:opacity-40 disabled:pointer-events-none transition-all"
                  >
                    <Minus size={14} />
                  </button>
                  <motion.span
                    key={electives}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={SPRING}
                    className="w-8 text-center text-sm font-bold text-neutral-900 tabular-nums"
                    aria-live="polite"
                  >
                    {electives}
                  </motion.span>
                  <button
                    type="button"
                    onClick={() => stepElectives(1)}
                    disabled={savingRule || electives >= electiveCount}
                    aria-label={t('paths.dashboard.rules.increase')}
                    className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-neutral-600 hover:bg-white hover:shadow-sm disabled:opacity-40 disabled:pointer-events-none transition-all"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              }
            />
          </div>
        </SectionCard>

        <div className="rounded-2xl bg-emerald-50/70 ring-1 ring-inset ring-emerald-100 px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
            <CheckCircle size={16} className="text-emerald-600 shrink-0" />
            {t('paths.dashboard.rules.summary_title')}
          </div>
          <p className="mt-1.5 text-sm text-emerald-900/80 leading-relaxed">
            {t('paths.dashboard.rules.summary', { required: requiredCount, electives })}{' '}
            {sequential ? t('paths.dashboard.rules.summary_sequential') : t('paths.dashboard.rules.summary_free')}{' '}
            {path.certificate_enabled && t('paths.dashboard.rules.summary_certificate')}
          </p>
        </div>
      </div>

      <PathCoursePicker
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

export default EditPathCourses
