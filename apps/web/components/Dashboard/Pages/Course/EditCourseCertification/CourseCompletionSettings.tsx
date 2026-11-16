'use client'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  Buildings,
  CheckCircle,
  Confetti,
  Eye,
  House,
  LinkSimple,
  Medal,
  SquaresFour,
  Trophy,
  Warning,
} from '@phosphor-icons/react'
import { Switch } from '@components/ui/switch'
import { useCourse, useCourseDispatch } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { Chip, FieldLabel, INPUT, SectionCard, SettingRow, TEXTAREA } from '@components/Dashboard/Shared/DashKit/DashKit'
import { CharCount, ErrorNotice, FieldHint } from '../courseEditorUi'
import { useSectionDraft } from '../courseEditorSave'
import { updateCourse } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'
import ThumbnailImage from '@components/Objects/Thumbnails/ThumbnailImage'
import { useCourseCertification } from '@components/Hooks/useCourseCertification'
import {
  COURSE_END_LIMITS,
  type CourseCompletionConfig,
  courseEndFlags,
  getCourseCompletionConfig,
  getOrgCourseEndConfig,
  isExternalCourseEndLink,
  isSafeCourseEndLink,
  resolveCourseEndButton,
  resolveSecondaryButton,
} from '@components/Pages/Activity/courseEndConfig'

// What the course stores in extra_metadata.course_end, every field present.
type CompletionFields = Required<CourseCompletionConfig>

type CompletionDraft = {
  // On: no course config; the screen uses the organization's or the defaults.
  useDefault: boolean
  fields: CompletionFields
}

const EMPTY_FIELDS: CompletionFields = {
  title: '',
  message: '',
  button_text: '',
  button_link: '',
  show_confetti: true,
  show_back_button: true,
  secondary_button_text: '',
  secondary_button_link: '',
}

const K = 'dashboard.courses.completion'

function toFields(config: CourseCompletionConfig | null): CompletionFields {
  const fields = { ...EMPTY_FIELDS }
  if (!config) return fields
  for (const key of Object.keys(EMPTY_FIELDS) as (keyof CompletionFields)[]) {
    const value = config[key]
    if (typeof value === typeof EMPTY_FIELDS[key]) (fields as any)[key] = value
  }
  return fields
}

type LinkIssue = 'invalid' | 'text_required' | 'link_required' | null

function linkIssues(fields: CompletionFields) {
  const primaryLink = fields.button_link.trim()
  const secondaryLink = fields.secondary_button_link.trim()
  const secondaryText = fields.secondary_button_text.trim()
  const primary: LinkIssue = primaryLink && !isSafeCourseEndLink(primaryLink) ? 'invalid' : null
  let secondary: LinkIssue = null
  if (secondaryLink && !isSafeCourseEndLink(secondaryLink)) secondary = 'invalid'
  else if (secondaryLink && !secondaryText) secondary = 'text_required'
  else if (secondaryText && !secondaryLink) secondary = 'link_required'
  return { primary, secondary }
}

function CourseCompletionSettings() {
  const { t } = useTranslation()
  const { courseStructure } = useCourse() as any
  const dispatchCourse = useCourseDispatch()
  const session = useLHSession() as any
  const org = useOrg() as any
  const access_token = session?.data?.tokens?.access_token
  const { isEnabled: certificateEnabled } = useCourseCertification(courseStructure?.course_uuid ?? '')

  const issueMessage = (issue: LinkIssue) => {
    if (issue === 'invalid') return t(`${K}.link_invalid`, 'Use a path starting with / or a full http(s) URL')
    if (issue === 'text_required') return t(`${K}.secondary_text_required`, 'Add a label for the second button')
    if (issue === 'link_required') return t(`${K}.secondary_link_required`, 'Add a link for the second button')
    return null
  }

  // Keyed on the JSON so a refetch with the same values keeps the same object.
  const serverKey = JSON.stringify(getCourseCompletionConfig(courseStructure))
  const serverValue = useMemo<CompletionDraft>(() => {
    const serverConfig = JSON.parse(serverKey) as CourseCompletionConfig | null
    return { useDefault: !serverConfig, fields: toFields(serverConfig) }
  }, [serverKey])

  const draft = useSectionDraft<CompletionDraft>('completion', {
    label: t(`${K}.title`, 'Completion screen'),
    tab: 'certification',
    validate: (value: CompletionDraft) => {
      if (value.useDefault) return null
      const issues = linkIssues(value.fields)
      return issueMessage(issues.primary ?? issues.secondary)
    },
    save: async (value: CompletionDraft) => {
      const course_end = value.useDefault
        ? null
        : Object.fromEntries(
            Object.entries(value.fields).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
          )
      // Only this key is sent; the API merges it into the course's metadata.
      const res = await updateCourse(courseStructure.course_uuid, { extra_metadata: { course_end } }, access_token)
      // Show the saved values right away instead of waiting for the refetch.
      dispatchCourse({ type: 'patchStructure', payload: { extra_metadata: res?.extra_metadata ?? null } })
    },
  })

  const value = draft.value ?? serverValue
  const { useDefault, fields } = value
  const set = (patch: Partial<CompletionFields>) => draft.set({ useDefault, fields: { ...fields, ...patch } })
  const issues = useDefault ? { primary: null, secondary: null } : linkIssues(fields)

  const orgConfig = getOrgCourseEndConfig(org)
  const orgHasConfig = !!(orgConfig.message || orgConfig.button_text || orgConfig.button_link)
  // Placeholders: what the learner sees when a field is left empty.
  const fallback = {
    title: t('courses.end.completed', 'Course completed'),
    message: (orgConfig.message || '').trim() || t(`${K}.message_placeholder`, 'Optional. Shown as a short note under the heading.'),
    button_text: (orgConfig.button_text || '').trim() || t('courses.browse_all_courses'),
    button_link: (orgConfig.button_link || '').trim() || '/courses',
  }

  // The preview resolves exactly like the learner screen does.
  const effective: CourseCompletionConfig = useDefault
    ? { ...orgConfig }
    : {
        ...fields,
        message: fields.message.trim() || orgConfig.message || '',
        button_text: fields.button_text.trim() || orgConfig.button_text || '',
        button_link: fields.button_link.trim() || orgConfig.button_link || '',
      }

  const disabled = useDefault
  // While the default is on, the form shows the defaults, not the stashed custom values.
  const shown = disabled ? EMPTY_FIELDS : fields

  return (
    <SectionCard
      icon={<Trophy size={18} />}
      title={t(`${K}.title`, 'Completion screen')}
      description={t(`${K}.subtitle`, 'What learners see when they finish this course.')}
      bodyClassName="p-5 pt-4"
    >
      {draft.error && (
        <div className="mb-4">
          <ErrorNotice>{draft.error}</ErrorNotice>
        </div>
      )}

      <div className="rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200/70 px-4 py-3 mb-5">
        <SettingRow
          icon={<Buildings size={16} />}
          title={t(`${K}.use_default`, 'Use the default screen')}
          description={
            orgHasConfig
              ? t(`${K}.use_default_org`, "Shows your organization's completion message and button. Turn off to customize it for this course.")
              : t(`${K}.use_default_builtin`, 'Shows a congratulations message and a link to your course catalog. Turn off to customize it for this course.')
          }
          control={
            <Switch
              checked={useDefault}
              onCheckedChange={(on) => draft.set({ useDefault: on, fields })}
              aria-label={t(`${K}.use_default`, 'Use the default screen')}
            />
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] items-start">
        <fieldset disabled={disabled} className={`grid gap-6 min-w-0 transition-opacity ${disabled ? 'opacity-55' : ''}`}>
          {/* Text */}
          <div className="grid gap-4">
            <label className="block">
              <FieldLabel hint={<CharCount current={shown.title.length} max={COURSE_END_LIMITS.title} />}>
                {t(`${K}.heading_label`, 'Heading')}
              </FieldLabel>
              <input
                id="course-completion-title"
                value={shown.title}
                maxLength={COURSE_END_LIMITS.title}
                onChange={(e) => set({ title: e.target.value })}
                placeholder={fallback.title}
                className={INPUT}
              />
            </label>

            <label className="block">
              <FieldLabel hint={<CharCount current={shown.message.length} max={COURSE_END_LIMITS.message} />}>
                {t(`${K}.message_label`, 'Message')}
              </FieldLabel>
              <textarea
                id="course-completion-message"
                value={shown.message}
                maxLength={COURSE_END_LIMITS.message}
                onChange={(e) => set({ message: e.target.value })}
                placeholder={fallback.message}
                rows={4}
                className={TEXTAREA}
              />
              <FieldHint>
                {t(`${K}.fallback_hint`, 'Empty fields use the text shown in grey. Line breaks are kept.')}
              </FieldHint>
            </label>
          </div>

          {/* Buttons */}
          <div className="grid gap-4">
            <SubHeading>{t(`${K}.buttons_title`, 'Buttons')}</SubHeading>

            <div className="rounded-xl ring-1 ring-inset ring-neutral-200/80 px-4 py-3">
              <SettingRow
                icon={<ArrowLeft size={16} className="rtl:rotate-180" />}
                title={t(`${K}.back_button`, 'Back to course')}
                description={t(`${K}.back_button_desc`, 'Lets learners return to the course outline.')}
                control={
                  <Switch
                    checked={shown.show_back_button}
                    onCheckedChange={(on) => set({ show_back_button: on })}
                    aria-label={t(`${K}.back_button`, 'Back to course')}
                  />
                }
              />
            </div>

            <ButtonFields
              idPrefix="course-completion-primary"
              title={t(`${K}.primary_button`, 'Main button')}
              description={t(`${K}.primary_button_desc`, 'Where learners go next, for example another course.')}
              text={shown.button_text}
              link={shown.button_link}
              textPlaceholder={fallback.button_text}
              linkPlaceholder={fallback.button_link}
              error={issueMessage(issues.primary)}
              onText={(button_text) => set({ button_text })}
              onLink={(button_link) => set({ button_link })}
            />

            <ButtonFields
              idPrefix="course-completion-secondary"
              title={t(`${K}.secondary_button`, 'Second button')}
              badge={<Chip>{t(`${K}.optional`, 'Optional')}</Chip>}
              description={t(`${K}.secondary_button_desc`, 'For example a community, a survey or a follow-up course.')}
              text={shown.secondary_button_text}
              link={shown.secondary_button_link}
              textPlaceholder={t(`${K}.secondary_text_placeholder`, 'Join the community')}
              linkPlaceholder="https://"
              error={issueMessage(issues.secondary)}
              onText={(secondary_button_text) => set({ secondary_button_text })}
              onLink={(secondary_button_link) => set({ secondary_button_link })}
            />
          </div>

          {/* Celebration */}
          <div className="grid gap-4">
            <SubHeading>{t(`${K}.celebration_title`, 'Celebration')}</SubHeading>
            <div className="rounded-xl ring-1 ring-inset ring-neutral-200/80 px-4 py-3">
              <SettingRow
                icon={<Confetti size={16} />}
                title={t(`${K}.confetti`, 'Confetti')}
                description={t(`${K}.confetti_desc`, 'A burst of confetti when the screen opens.')}
                control={
                  <Switch
                    checked={shown.show_confetti}
                    onCheckedChange={(on) => set({ show_confetti: on })}
                    aria-label={t(`${K}.confetti`, 'Confetti')}
                  />
                }
              />
            </div>
          </div>
        </fieldset>

        <div className="lg:sticky lg:top-4 min-w-0">
          <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-neutral-500">
            <Eye size={14} />
            {t(`${K}.preview`, 'Live preview')}
          </div>
          <CompletionPreview
            config={effective}
            courseName={courseStructure?.name ?? ''}
            thumbnail={
              courseStructure?.thumbnail_image && org?.org_uuid
                ? getCourseThumbnailMediaDirectory(org.org_uuid, courseStructure.course_uuid, courseStructure.thumbnail_image)
                : null
            }
            certificateEnabled={certificateEnabled}
          />
        </div>
      </div>
    </SectionCard>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{children}</h3>
}

// Label + link for one button, with a hint that says whether the link is a
// page of this site or an outside URL.
function ButtonFields({
  idPrefix,
  title,
  badge,
  description,
  text,
  link,
  textPlaceholder,
  linkPlaceholder,
  error,
  onText,
  onLink,
}: {
  idPrefix: string
  title: string
  badge?: React.ReactNode
  description: string
  text: string
  link: string
  textPlaceholder: string
  linkPlaceholder: string
  error: string | null
  onText: (_value: string) => void
  onLink: (_value: string) => void
}) {
  const { t } = useTranslation()
  const trimmed = link.trim()
  const kind = !trimmed ? null : !isSafeCourseEndLink(trimmed) ? 'invalid' : isExternalCourseEndLink(trimmed) ? 'external' : 'internal'
  const quickLinks = [
    { href: '/courses', label: t(`${K}.quick_catalog`, 'Course catalog'), icon: <SquaresFour size={12} /> },
    { href: '/', label: t(`${K}.quick_home`, 'Home page'), icon: <House size={12} /> },
  ]

  return (
    <div className="rounded-xl ring-1 ring-inset ring-neutral-200/80 p-4 grid gap-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-neutral-900">{title}</span>
          {badge}
        </div>
        <p className="text-xs text-neutral-500 mt-0.5">{description}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block min-w-0">
          <FieldLabel hint={<CharCount current={text.length} max={COURSE_END_LIMITS.buttonText} />}>
            {t(`${K}.button_text_label`, 'Label')}
          </FieldLabel>
          <input
            id={`${idPrefix}-text`}
            value={text}
            maxLength={COURSE_END_LIMITS.buttonText}
            onChange={(e) => onText(e.target.value)}
            placeholder={textPlaceholder}
            className={INPUT}
          />
        </label>
        <label className="block min-w-0">
          <FieldLabel
            hint={
              kind === 'internal' ? (
                <Chip tone="sky" icon={<LinkSimple size={11} />} className="!py-0.5">
                  {t(`${K}.link_internal`, 'Internal page')}
                </Chip>
              ) : kind === 'external' ? (
                <Chip tone="violet" icon={<ArrowSquareOut size={11} />} className="!py-0.5">
                  {t(`${K}.link_external`, 'External URL')}
                </Chip>
              ) : kind === 'invalid' ? (
                <Chip tone="rose" icon={<Warning size={11} />} className="!py-0.5">
                  {t(`${K}.link_invalid_short`, 'Not a valid link')}
                </Chip>
              ) : null
            }
          >
            {t(`${K}.button_link_label`, 'Link')}
          </FieldLabel>
          <input
            id={`${idPrefix}-link`}
            value={link}
            maxLength={COURSE_END_LIMITS.link}
            onChange={(e) => onLink(e.target.value)}
            placeholder={linkPlaceholder}
            aria-invalid={!!error}
            data-ltr-content
            className={`${INPUT} ${error ? '!ring-rose-300 focus:!ring-rose-500/25' : ''}`}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className={`text-xs ${error ? 'text-rose-600 font-medium' : 'text-neutral-400'} me-auto`}>
          {error ??
            t(`${K}.link_help`, 'A page of this site like /courses, or a full https:// URL (opens in a new tab).')}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {quickLinks.map((q) => (
            <button
              key={q.href}
              type="button"
              onClick={() => onLink(q.href)}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-semibold text-neutral-600 bg-neutral-100 hover:bg-neutral-200/80 transition-colors"
            >
              {q.icon}
              {q.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// A scaled-down copy of the learner's completion screen (CourseEndView).
function CompletionPreview({
  config,
  courseName,
  thumbnail,
  certificateEnabled,
}: {
  config: CourseCompletionConfig
  courseName: string
  thumbnail: string | null
  certificateEnabled: boolean
}) {
  const { t } = useTranslation()
  const { confetti, backButton } = courseEndFlags(config)
  const primary = resolveCourseEndButton(config)
  const secondary = resolveSecondaryButton(config)
  const message = (config.message || '').trim()
  const btn = 'inline-flex items-center gap-1 text-[11px] font-medium h-6 px-2.5 rounded-lg max-w-full min-w-0'
  const outline = `${btn} bg-white text-neutral-700 shadow-[0_1px_1px_rgba(0,0,0,0.03),0_0_0_1px_rgba(0,0,0,0.07)]`

  return (
    <div className="relative overflow-hidden rounded-2xl bg-neutral-100/80 ring-1 ring-inset ring-neutral-200/70 p-4 sm:p-5">
      <div className="relative flex flex-col gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <ThumbnailImage
            src={thumbnail}
            alt=""
            className="w-16 h-9 shrink-0 rounded-md ring-1 ring-black/5 bg-neutral-100"
          />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-[10px] font-semibold text-neutral-900 min-w-0">
              <CheckCircle size={11} weight="fill" className="shrink-0" />
              <span className="truncate">{(config.title || '').trim() || t('courses.end.completed', 'Course completed')}</span>
              {confetti && <Confetti size={11} className="shrink-0 text-neutral-400" aria-label={t(`${K}.confetti`, 'Confetti')} />}
            </p>
            <p className="text-sm font-bold text-neutral-900 truncate"><bdi>{courseName}</bdi></p>
          </div>
        </div>
        {message && (
          <p className="border-s-2 border-neutral-300 ps-2.5 text-[11px] text-neutral-600 whitespace-pre-line break-words line-clamp-4">
            <bdi>{message}</bdi>
          </p>
        )}
        {certificateEnabled && (
          <div className="flex items-center justify-center gap-1.5 rounded-xl bg-white nice-shadow aspect-[2.4] text-[11px] font-medium text-neutral-500">
            <Medal size={14} weight="duotone" />
            {t(`${K}.preview_certificate`, 'The certificate shows here')}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {backButton && (
            <span className={`${btn} text-neutral-600`}>
              <ArrowLeft size={11} weight="bold" className="shrink-0 rtl:rotate-180" />
              <span className="truncate">{t('courses.back_to_course')}</span>
            </span>
          )}
          <span className="ms-auto flex flex-wrap justify-end gap-1.5 min-w-0">
            <span className={certificateEnabled ? outline : `${btn} bg-neutral-900 text-white`} title={primary.href}>
              <span className="truncate">{primary.text || t('courses.browse_all_courses')}</span>
              {primary.external ? <ArrowSquareOut size={11} weight="bold" className="shrink-0" /> : <ArrowRight size={11} weight="bold" className="shrink-0 rtl:rotate-180" />}
            </span>
            {secondary && (
              <span className={outline} title={secondary.href}>
                <span className="truncate">{secondary.text}</span>
                {secondary.external ? <ArrowSquareOut size={11} weight="bold" className="shrink-0" /> : <ArrowRight size={11} weight="bold" className="shrink-0 rtl:rotate-180" />}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

export default CourseCompletionSettings
