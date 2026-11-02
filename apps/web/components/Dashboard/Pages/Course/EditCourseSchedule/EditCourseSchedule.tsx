'use client'

import React, { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import {
  BellRing,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  Eye,
  Hourglass,
  Link2,
  ListChecks,
  Loader2,
  Repeat,
  Sparkles,
  TimerOff,
  UserRoundCheck,
  Users,
  Zap,
} from 'lucide-react'
import { Switch } from '@components/ui/switch'
import { useCourse } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUserGroups } from '@services/usergroups/usergroups'
import { asArray } from '@services/utils/ts/requests'
import { DripSchedule, getDripSchedule, updateDripSchedule } from '@services/courses/drip'
import { revalidateTags } from '@services/utils/ts/requests'
import {
  DEFAULT_DRIP_SETTINGS,
  DripAnchor,
  DripReleaseMode,
  DripRule,
  DripSettings,
  DayState,
  MAX_DELAY_DAYS,
  everyInterval,
  previewHorizon,
  stateOnDay,
  fromLocalInput,
  normalizeRule,
  releaseDate,
  toLocalInput,
} from '@/lib/drip'

type EditCourseScheduleProps = {
  orgslug: string
}

type ChapterRow = { chapter_uuid: string; name: string; rule: DripRule }

function formatDate(date: Date, locale: string) {
  return date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatDateTime(date: Date, locale: string) {
  return date.toLocaleString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function AnchorCard(props: {
  icon: React.ElementType
  title: string
  description: string
  selected: boolean
  onClick: () => void
}) {
  const Icon = props.icon
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`relative text-start rounded-xl p-4 transition-all duration-150 ${
        props.selected
          ? 'bg-white border border-indigo-200 ring-1 ring-indigo-100 shadow-xs'
          : 'bg-gray-50/80 border border-gray-100 hover:bg-gray-50 hover:border-gray-200'
      }`}
    >
      {props.selected && (
        <span className="absolute top-3 end-3 w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center">
          <Check size={12} strokeWidth={3.5} className="text-white" />
        </span>
      )}
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center ${
          props.selected ? 'bg-indigo-50 text-indigo-600' : 'bg-white border border-gray-100 text-gray-400'
        }`}
      >
        <Icon size={18} />
      </div>
      <div className={`mt-3 font-semibold ${props.selected ? 'text-gray-900' : 'text-gray-600'}`}>
        {props.title}
      </div>
      <div className="mt-0.5 text-xs text-gray-400 leading-snug pe-6">{props.description}</div>
    </button>
  )
}

function ModeButton(props: {
  active: boolean
  icon: React.ElementType
  label: string
  onClick: () => void
}) {
  const Icon = props.icon
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-semibold transition-colors ${
        props.active ? 'bg-white text-gray-900 shadow-xs ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      <Icon size={13} />
      {props.label}
    </button>
  )
}

export default function EditCourseSchedule(props: EditCourseScheduleProps) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const course = useCourse() as any
  const courseUuid: string = course?.courseStructure?.course_uuid
  const cleanUuid = courseUuid?.replace(/^course_/, '')

  const { data } = useQuery<DripSchedule>({
    queryKey: ['course', cleanUuid, 'drip'],
    queryFn: async () => {
      const res = await getDripSchedule(courseUuid, access_token)
      if (!res.success) throw new Error(res.data?.detail || 'Failed to load schedule')
      return res.data
    },
    enabled: !!(courseUuid && access_token),
    refetchOnWindowFocus: false,
  })

  if (!data) {
    return (
      <div className="sm:mx-10 mx-0 mt-6 space-y-4 animate-pulse">
        <div className="h-24 bg-white rounded-xl nice-shadow" />
        <div className="h-64 bg-white rounded-xl nice-shadow" />
      </div>
    )
  }

  return (
    <ScheduleEditor
      key={cleanUuid}
      schedule={data}
      courseUuid={courseUuid}
      accessToken={access_token}
      orgslug={props.orgslug}
    />
  )
}

function ScheduleEditor(props: {
  schedule: DripSchedule
  courseUuid: string
  accessToken: string
  orgslug: string
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'en'
  const queryClient = useQueryClient()
  const { courseUuid, accessToken: access_token } = props
  const cleanUuid = courseUuid.replace(/^course_/, '')

  const [settings, setSettings] = useState<DripSettings>(() => ({
    ...DEFAULT_DRIP_SETTINGS,
    ...props.schedule.settings,
  }))
  const [chapters, setChapters] = useState<ChapterRow[]>(() =>
    props.schedule.chapters.map((c) => ({ ...c, rule: normalizeRule(c.rule) }))
  )
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [every, setEvery] = useState(1)
  const [unit, setUnit] = useState<'days' | 'weeks'>('weeks')
  const [previewDay, setPreviewDay] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const org = useOrg() as any

  const { data: groups } = useQuery({
    queryKey: ['usergroups', org?.id],
    queryFn: async () => asArray<{ usergroup_uuid: string; name: string }>(await getUserGroups(org.id, access_token)),
    enabled: !!(org?.id && access_token),
    staleTime: 60_000,
  })

  const toggleExpanded = (uuid: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(uuid)) next.delete(uuid)
      else next.add(uuid)
      return next
    })

  const toggleEarlyAccess = (uuid: string) => {
    const current = settings.early_access_usergroups
    updateSettings({
      early_access_usergroups: current.includes(uuid) ? current.filter((u) => u !== uuid) : [...current, uuid],
    })
  }

  const toggleRequired = (index: number, uuid: string) => {
    const current = chapters[index].rule.require_chapters
    updateRule(index, {
      require_chapters: current.includes(uuid) ? current.filter((u) => u !== uuid) : [...current, uuid],
    })
  }

  const updateSettings = (patch: Partial<DripSettings>) => {
    setSettings((s) => ({ ...s, ...patch }))
    setDirty(true)
  }

  const updateRule = (index: number, patch: Partial<DripRule>) => {
    setChapters((rows) => rows.map((row, i) => (i === index ? { ...row, rule: { ...row.rule, ...patch } } : row)))
    setDirty(true)
  }

  const applyInterval = () => {
    setChapters((rows) => {
      const rules = everyInterval(rows.map((r) => r.rule), every, unit)
      return rows.map((row, i) => ({ ...row, rule: rules[i] }))
    })
    setDirty(true)
  }

  // Preview anchor: the cohort start date, or "someone who enrolls today".
  const previewAnchor = useMemo(() => {
    if (settings.anchor === 'fixed_date') return settings.start_date ? new Date(settings.start_date) : null
    const today = new Date()
    today.setSeconds(0, 0)
    return today
  }, [settings.anchor, settings.start_date])

  const validationError = useMemo(() => {
    if (!settings.enabled) return null
    if (settings.anchor === 'fixed_date' && !settings.start_date) {
      return t('dashboard.courses.schedule.errors.start_date', 'Pick the date the cohort starts.')
    }
    const missingDate = chapters.find((c) => c.rule.mode === 'date' && !c.rule.release_at)
    if (missingDate) {
      return t('dashboard.courses.schedule.errors.release_at', {
        defaultValue: 'Pick a release date for “{{name}}”.',
        name: missingDate.name,
      })
    }
    return null
  }, [settings, chapters, t])

  const save = async () => {
    if (validationError) {
      toast.error(validationError)
      return
    }
    setSaving(true)
    try {
      const res = await updateDripSchedule(
        courseUuid,
        { settings, chapters: chapters.map((c) => ({ chapter_uuid: c.chapter_uuid, rule: c.rule })) },
        access_token
      )
      if (!res.success) {
        toast.error(
          typeof res.data?.detail === 'string'
            ? res.data.detail
            : t('dashboard.courses.schedule.toasts.save_error', 'Could not save the schedule')
        )
        return
      }
      queryClient.setQueryData(['course', cleanUuid, 'drip'], res.data)
      setDirty(false)
      toast.success(t('dashboard.courses.schedule.toasts.save_success', 'Schedule saved'))
      await queryClient.invalidateQueries({ queryKey: ['course', cleanUuid, 'meta'] })
      revalidateTags(['courses'], props.orgslug)
    } catch {
      toast.error(t('dashboard.courses.schedule.toasts.save_error', 'Could not save the schedule'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sm:mx-10 mx-0 mt-6 pb-24 space-y-4">
      {/* Header + master switch */}
      <div className="bg-white rounded-xl nice-shadow px-5 py-5 sm:px-6 flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
          <CalendarClock size={20} />
        </div>
        <div className="grow min-w-0">
          <h2 className="font-bold text-lg text-gray-900 tracking-tight">
            {t('dashboard.courses.schedule.title', 'Drip content')}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {t(
              'dashboard.courses.schedule.description',
              'Release chapters over time instead of all at once. Learners see what is coming next and when it opens.'
            )}
          </p>
        </div>
        <label className="flex items-center gap-2 shrink-0 cursor-pointer" data-testid="drip-toggle">
          <span className="text-sm font-medium text-gray-600 hidden sm:inline">
            {settings.enabled
              ? t('dashboard.courses.schedule.on', 'On')
              : t('dashboard.courses.schedule.off', 'Off')}
          </span>
          <Switch checked={settings.enabled} onCheckedChange={(v) => updateSettings({ enabled: v })} />
        </label>
      </div>

      {settings.enabled && (
        <>
          {/* When the schedule starts */}
          <div className="bg-white rounded-xl nice-shadow px-5 py-5 sm:px-6">
            <h3 className="font-semibold text-gray-900">
              {t('dashboard.courses.schedule.anchor.title', 'When does the schedule start?')}
            </h3>
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <AnchorCard
                icon={UserRoundCheck}
                title={t('dashboard.courses.schedule.anchor.enrollment', 'When each learner enrolls')}
                description={t(
                  'dashboard.courses.schedule.anchor.enrollment_description',
                  'Everyone gets their own clock. Best for evergreen, self-paced courses.'
                )}
                selected={settings.anchor === 'enrollment'}
                onClick={() => updateSettings({ anchor: 'enrollment' as DripAnchor })}
              />
              <AnchorCard
                icon={Users}
                title={t('dashboard.courses.schedule.anchor.fixed_date', 'On a fixed start date')}
                description={t(
                  'dashboard.courses.schedule.anchor.fixed_date_description',
                  'One date for the whole cohort. Best for live launches and bootcamps.'
                )}
                selected={settings.anchor === 'fixed_date'}
                onClick={() => updateSettings({ anchor: 'fixed_date' as DripAnchor })}
              />
            </div>
            {settings.anchor === 'fixed_date' && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="text-sm font-medium text-gray-700" htmlFor="drip-start-date">
                  {t('dashboard.courses.schedule.anchor.start_date', 'Cohort starts on')}
                </label>
                <input
                  id="drip-start-date"
                  type="datetime-local"
                  value={toLocalInput(settings.start_date)}
                  onChange={(e) => updateSettings({ start_date: fromLocalInput(e.target.value) })}
                  className="h-9 px-3 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-800 outline-hidden focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            )}
          </div>

          {/* Early access and notifications */}
          <div className="bg-white rounded-xl nice-shadow px-5 py-5 sm:px-6 grid md:grid-cols-2 gap-6">
            <div data-testid="drip-early-access">
              <div className="flex items-center gap-2 font-semibold text-gray-900">
                <Sparkles size={16} className="text-indigo-500" />
                {t('dashboard.courses.schedule.early_access.title', 'Early access')}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {t('dashboard.courses.schedule.early_access.description', 'Members of these user groups get every chapter right away: staff, beta testers, a premium tier.')}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {asArray<{ usergroup_uuid: string; name: string }>(groups).length === 0 ? (
                  <span className="text-xs text-gray-400">
                    {t('dashboard.courses.schedule.early_access.empty', 'No user groups yet.')}
                  </span>
                ) : (
                  asArray<{ usergroup_uuid: string; name: string }>(groups).map((g) => {
                    const on = settings.early_access_usergroups.includes(g.usergroup_uuid)
                    return (
                      <button
                        key={g.usergroup_uuid}
                        type="button"
                        onClick={() => toggleEarlyAccess(g.usergroup_uuid)}
                        className={`h-7 px-2.5 rounded-full text-xs font-semibold flex items-center gap-1 transition-colors ${
                          on ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {on ? <Check size={12} strokeWidth={3} /> : <Users size={12} />}
                        {g.name}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
            <label className="flex items-start gap-3 cursor-pointer" data-testid="drip-notify">
              <div className="grow">
                <div className="flex items-center gap-2 font-semibold text-gray-900">
                  <BellRing size={16} className="text-indigo-500" />
                  {t('dashboard.courses.schedule.notify.title', 'Email learners when a chapter opens')}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {t('dashboard.courses.schedule.notify.description', 'Enrolled learners get a short email with a link back to the course as soon as a scheduled chapter opens for them.')}
                </p>
              </div>
              <Switch checked={settings.notify_email} onCheckedChange={(v) => updateSettings({ notify_email: v })} />
            </label>
          </div>

          {/* Chapter timeline */}
          <div className="bg-white rounded-xl nice-shadow px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-gray-900">
                  {t('dashboard.courses.schedule.chapters.title', 'Release plan')}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {settings.anchor === 'enrollment'
                    ? t('dashboard.courses.schedule.chapters.preview_enrollment', 'Dates shown for someone who enrolls today.')
                    : t('dashboard.courses.schedule.chapters.preview_cohort', 'Dates shown for the cohort.')}
                </p>
              </div>
              <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-100 rounded-lg ps-3 pe-1 py-1">
                <Repeat size={14} className="text-gray-400" />
                <span className="text-xs text-gray-600 whitespace-nowrap">
                  {t('dashboard.courses.schedule.interval.label', 'One chapter every')}
                </span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={every}
                  onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))}
                  className="w-12 h-7 px-2 rounded-md border border-gray-200 bg-white text-xs text-center"
                  aria-label={t('dashboard.courses.schedule.interval.amount', 'Interval')}
                />
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as 'days' | 'weeks')}
                  className="h-7 px-1.5 rounded-md border border-gray-200 bg-white text-xs"
                  aria-label={t('dashboard.courses.schedule.interval.unit', 'Unit')}
                >
                  <option value="days">{t('dashboard.courses.schedule.interval.days', 'days')}</option>
                  <option value="weeks">{t('dashboard.courses.schedule.interval.weeks', 'weeks')}</option>
                </select>
                <button
                  type="button"
                  onClick={applyInterval}
                  className="h-7 px-2.5 rounded-md bg-gray-900 text-white text-xs font-semibold hover:bg-gray-800"
                >
                  {t('dashboard.courses.schedule.interval.apply', 'Apply')}
                </button>
              </div>
            </div>

            {chapters.length === 0 ? (
              <p className="mt-6 text-sm text-gray-400">
                {t('dashboard.courses.schedule.chapters.empty', 'Add chapters to this course to schedule them.')}
              </p>
            ) : (
              <>
              {settings.anchor === 'enrollment' && (
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-indigo-50/60 border border-indigo-100 px-3 py-2" data-testid="drip-preview">
                  <Eye size={15} className="text-indigo-500" />
                  <span className="text-xs font-semibold text-indigo-900">
                    {previewDay === null
                      ? t('dashboard.courses.schedule.preview.label', 'Preview a learner’s view on any day')
                      : t('dashboard.courses.schedule.preview.day', { defaultValue: 'Day {{count}} after enrolling', count: previewDay })}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={previewHorizon(chapters.map((c) => c.rule))}
                    value={previewDay ?? 0}
                    onChange={(e) => setPreviewDay(Number(e.target.value))}
                    className="grow min-w-[160px] accent-indigo-600"
                    aria-label={t('dashboard.courses.schedule.preview.slider', 'Preview day')}
                  />
                  {previewDay !== null && (
                    <button type="button" onClick={() => setPreviewDay(null)} className="text-xs text-indigo-600 hover:underline">
                      {t('dashboard.courses.schedule.preview.clear', 'Clear')}
                    </button>
                  )}
                </div>
              )}
              <ol className="mt-5 relative">
                {chapters.map((row, index) => {
                  const opens = releaseDate(row.rule, previewAnchor)
                  const isLast = index === chapters.length - 1
                  const isOpen = expanded.has(row.chapter_uuid)
                  const earlier = chapters.slice(0, index)
                  const extras = row.rule.require_chapters.length + (row.rule.available_days ? 1 : 0)
                  const dayState: DayState | null = previewDay === null ? null : stateOnDay(row.rule, previewDay)
                  return (
                    <li key={row.chapter_uuid} className="relative ps-9 pb-5" data-testid="drip-chapter">
                      {!isLast && <span className="absolute start-[13px] top-7 bottom-0 w-px bg-gray-200" />}
                      <span className="absolute start-0 top-0.5 w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold flex items-center justify-center ring-4 ring-white">
                        {index + 1}
                      </span>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <span className="font-medium text-gray-800 me-auto">{row.name}</span>
                        {dayState && (
                          <span
                            data-testid="drip-day-state"
                            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                              {
                                open: 'bg-emerald-50 text-emerald-700',
                                upcoming: 'bg-amber-50 text-amber-700',
                                closed: 'bg-gray-100 text-gray-500',
                                dated: 'bg-sky-50 text-sky-700',
                              }[dayState]
                            }`}
                          >
                            {
                              {
                                open: t('dashboard.courses.schedule.preview.open', 'Open'),
                                upcoming: t('dashboard.courses.schedule.preview.upcoming', {
                                  defaultValue: 'Opens on day {{count}}',
                                  count: row.rule.mode === 'delay' ? row.rule.delay_days : 0,
                                }),
                                closed: t('dashboard.courses.schedule.preview.closed', 'Closed'),
                                dated: t('dashboard.courses.schedule.preview.dated', 'Fixed date'),
                              }[dayState]
                            }
                          </span>
                        )}
                        <span className="text-xs text-gray-500 flex items-center gap-1" data-testid="drip-opens">
                          <CalendarDays size={13} className="text-gray-400" />
                          {opens
                            ? row.rule.mode === 'date' || settings.anchor === 'fixed_date'
                              ? formatDateTime(opens, locale)
                              : formatDate(opens, locale)
                            : '—'}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                          <ModeButton
                            active={row.rule.mode === 'immediate'}
                            icon={Zap}
                            label={t('dashboard.courses.schedule.mode.immediate', 'Right away')}
                            onClick={() => updateRule(index, { mode: 'immediate' as DripReleaseMode })}
                          />
                          <ModeButton
                            active={row.rule.mode === 'delay'}
                            icon={Hourglass}
                            label={t('dashboard.courses.schedule.mode.delay', 'After a delay')}
                            onClick={() => updateRule(index, { mode: 'delay' as DripReleaseMode })}
                          />
                          <ModeButton
                            active={row.rule.mode === 'date'}
                            icon={CalendarDays}
                            label={t('dashboard.courses.schedule.mode.date', 'On a date')}
                            onClick={() => updateRule(index, { mode: 'date' as DripReleaseMode })}
                          />
                        </div>
                        {row.rule.mode === 'delay' && (
                          <span className="flex items-center gap-1.5 text-xs text-gray-600">
                            <input
                              type="number"
                              min={0}
                              max={MAX_DELAY_DAYS}
                              value={row.rule.delay_days}
                              onChange={(e) =>
                                updateRule(index, {
                                  delay_days: Math.min(MAX_DELAY_DAYS, Math.max(0, Number(e.target.value) || 0)),
                                })
                              }
                              className="w-16 h-7 px-2 rounded-md border border-gray-200 bg-white text-xs text-center"
                              aria-label={t('dashboard.courses.schedule.mode.delay_days', 'Days')}
                            />
                            {settings.anchor === 'enrollment'
                              ? t('dashboard.courses.schedule.mode.days_after_enrollment', 'days after enrolling')
                              : t('dashboard.courses.schedule.mode.days_after_start', 'days after the start date')}
                          </span>
                        )}
                        {row.rule.mode === 'date' && (
                          <input
                            type="datetime-local"
                            value={toLocalInput(row.rule.release_at)}
                            onChange={(e) => updateRule(index, { release_at: fromLocalInput(e.target.value) })}
                            className="h-7 px-2 rounded-md border border-gray-200 bg-white text-xs"
                            aria-label={t('dashboard.courses.schedule.mode.release_at', 'Release date')}
                          />
                        )}
                        {index > 0 && (
                          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none ms-1">
                            <input
                              type="checkbox"
                              checked={row.rule.require_previous}
                              onChange={(e) => updateRule(index, { require_previous: e.target.checked })}
                              className="accent-indigo-600"
                            />
                            <Link2 size={13} className="text-gray-400" />
                            {t('dashboard.courses.schedule.require_previous', 'Only after the previous chapter is completed')}
                          </label>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleExpanded(row.chapter_uuid)}
                          data-testid="drip-more"
                          className={`ms-auto flex items-center gap-1 h-7 px-2 rounded-md text-xs font-semibold transition-colors ${
                            isOpen || extras ? 'text-indigo-700 bg-indigo-50' : 'text-gray-500 hover:bg-gray-100'
                          }`}
                        >
                          {extras
                            ? t('dashboard.courses.schedule.more.count', { defaultValue: '{{count}} more conditions', count: extras })
                            : t('dashboard.courses.schedule.more.label', 'More conditions')}
                          <ChevronDown size={13} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        </button>
                      </div>
                      {isOpen && (
                        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3 space-y-3" data-testid="drip-conditions">
                          <div>
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                              <ListChecks size={13} className="text-gray-400" />
                              {t('dashboard.courses.schedule.more.requires', 'Requires these chapters to be completed')}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {earlier.length === 0 ? (
                                <span className="text-xs text-gray-400">
                                  {t('dashboard.courses.schedule.more.no_earlier', 'This is the first chapter.')}
                                </span>
                              ) : (
                                earlier.map((c) => {
                                  const on = row.rule.require_chapters.includes(c.chapter_uuid)
                                  return (
                                    <button
                                      key={c.chapter_uuid}
                                      type="button"
                                      onClick={() => toggleRequired(index, c.chapter_uuid)}
                                      className={`h-7 px-2.5 rounded-full text-xs font-medium flex items-center gap-1 transition-colors ${
                                        on ? 'bg-indigo-600 text-white' : 'bg-white ring-1 ring-gray-200 text-gray-600 hover:bg-gray-100'
                                      }`}
                                    >
                                      {on && <Check size={12} strokeWidth={3} />}
                                      {c.name}
                                    </button>
                                  )
                                })
                              )}
                            </div>
                          </div>
                          <label className="flex flex-wrap items-center gap-2 text-xs text-gray-700">
                            <input
                              type="checkbox"
                              checked={!!row.rule.available_days}
                              onChange={(e) => updateRule(index, { available_days: e.target.checked ? 7 : null })}
                              className="accent-indigo-600"
                            />
                            <TimerOff size={13} className="text-gray-400" />
                            <span className="font-semibold">{t('dashboard.courses.schedule.more.closes', 'Close it again')}</span>
                            {row.rule.available_days ? (
                              <>
                                <input
                                  type="number"
                                  min={1}
                                  max={MAX_DELAY_DAYS}
                                  value={row.rule.available_days}
                                  onChange={(e) =>
                                    updateRule(index, {
                                      available_days: Math.min(MAX_DELAY_DAYS, Math.max(1, Number(e.target.value) || 1)),
                                    })
                                  }
                                  className="w-16 h-7 px-2 rounded-md border border-gray-200 bg-white text-xs text-center"
                                  aria-label={t('dashboard.courses.schedule.more.closes_days', 'Days open')}
                                />
                                {t('dashboard.courses.schedule.more.closes_after', 'days after it opens')}
                              </>
                            ) : (
                              <span className="text-gray-400">
                                {t('dashboard.courses.schedule.more.closes_hint', 'For limited-time content like a replay or a live-week bonus.')}
                              </span>
                            )}
                          </label>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
              </>
            )}
          </div>
        </>
      )}

      {/* Save bar */}
      <div className="sticky bottom-4 flex justify-end">
        <div className="flex items-center gap-3 bg-white/90 backdrop-blur rounded-xl nice-shadow ps-4 pe-2 py-2">
          <span className="text-xs text-gray-500">
            {dirty
              ? t('dashboard.courses.schedule.unsaved', 'Unsaved changes')
              : t('dashboard.courses.schedule.saved', 'All changes saved')}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="h-8 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40 hover:bg-indigo-700"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {t('dashboard.courses.schedule.save', 'Save schedule')}
          </button>
        </div>
      </div>
    </div>
  )
}
