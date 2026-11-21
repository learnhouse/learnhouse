'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import {
  CalendarBlank,
  ChatText,
  Eye,
  EyeSlash,
  GraduationCap,
  ListChecks,
  ChatCircleText,
  SlidersHorizontal,
  Target,
  UserCircle,
  UsersThree,
} from '@phosphor-icons/react'
import { Switch } from '@components/ui/switch'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import { Button, ChoiceCard, INPUT, SectionCard, SettingRow, StickySaveBar, SubTabPanel, SubTabs, useSubTab } from '@/design'
import { queryKeys } from '@/lib/query/keys'
import { detailMessage } from '@services/utils/ts/requests'
import type { PeerReviewAnonymity, PeerReviewScoreMode, PeerReviewSettings } from '@services/courses/peerReview'
import { savePeerReviewSettings } from '@services/courses/peerReviewAdmin'
import {
  PEER_REVIEW_LIMITS,
  defaultPrompts,
  pruneSampleScores,
  samePrompts,
  validateSettings,
  type Issue,
} from '@/lib/assignments/peerReviewRubric'
import RubricBuilder from './RubricBuilder'
import PromptsEditor from './PromptsEditor'
import PracticeSamplesEditor from './PracticeSamplesEditor'
import WhyPeerReviewCard from './WhyPeerReviewCard'
import { FieldError, NumberStepper, issueMessage } from './ui'

const SECTIONS = ['settings', 'rubric', 'prompts', 'practice'] as const
type Section = (typeof SECTIONS)[number]

// The editor's working copy: prompts are always materialized (the defaults in
// the viewer's language when the API stores null).
type Draft = Omit<PeerReviewSettings, 'prompts'> & { prompts: NonNullable<PeerReviewSettings['prompts']> }

function toDateInputValue(raw?: string | null): string {
  const match = /^\d{4}-\d{2}-\d{2}/.exec((raw ?? '').trim())
  return match ? match[0] : ''
}

function sectionOf(issue: Issue): Section {
  if (issue.code.startsWith('prompt')) return 'prompts'
  if (issue.code.startsWith('sample')) return 'practice'
  if (issue.code === 'reviews_range' || issue.code === 'min_reviews_range') return 'settings'
  return 'rubric'
}

export default function PeerReviewSetup({
  assignmentUuid,
  settings,
  locked,
  userKey,
}: {
  assignmentUuid: string
  settings: PeerReviewSettings
  /** The org plan lacks peer_review. */
  locked: boolean
  userKey: string
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const session = useLHSession() as any
  const accessToken: string = session?.data?.tokens?.access_token
  const [section, setSection] = useSubTab<Section>('settings', SECTIONS, { rememberAs: 'assignment-peer-review:setup' })

  const defaults = React.useMemo(() => defaultPrompts((k) => t(k)), [t])
  const toDraft = React.useCallback(
    (s: PeerReviewSettings): Draft => ({ ...s, review_due_date: toDateInputValue(s.review_due_date) || null, prompts: s.prompts ?? defaults }),
    [defaults]
  )
  // The subpage remounts this editor (key) whenever the server copy changes,
  // so the initial snapshot is taken once.
  const [initial] = React.useState<Draft>(() => toDraft(settings))
  const [draft, setDraft] = React.useState<Draft>(initial)
  const [showErrors, setShowErrors] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const issues = validateSettings({ ...draft, prompts: draft.prompts })
  const sectionHasIssue = (key: Section) => showErrors && issues.some((i) => sectionOf(i) === key)
  const sectionDirty = (key: Section) => {
    const fields: Record<Section, (keyof Draft)[]> = {
      settings: ['reviews_required', 'anonymity', 'require_reviews_to_see_feedback', 'review_due_date', 'self_review_enabled', 'calibration_enabled', 'helpfulness_enabled', 'revision_plan_enabled', 'score_mode', 'min_reviews_for_score'],
      rubric: ['rubric'],
      prompts: ['prompts'],
      practice: ['calibration_samples'],
    }
    return fields[key].some((f) => JSON.stringify(draft[f]) !== JSON.stringify(initial[f]))
  }

  // Locked orgs can still switch an already-on review off, never on.
  const formDisabled = locked && !initial.enabled

  const save = async () => {
    if (issues.length > 0) {
      setShowErrors(true)
      setSection(sectionOf(issues[0]))
      toast.error(t('peer_review.instructor.save.fix_errors'))
      return
    }
    setSaving(true)
    const toastId = toast.loading(t('peer_review.instructor.save.saving'))
    try {
      await savePeerReviewSettings(
        assignmentUuid,
        {
          enabled: draft.enabled,
          reviews_required: draft.reviews_required,
          require_reviews_to_see_feedback: draft.require_reviews_to_see_feedback,
          review_due_date: draft.review_due_date || null,
          anonymity: draft.anonymity,
          self_review_enabled: draft.self_review_enabled,
          calibration_enabled: draft.calibration_enabled,
          helpfulness_enabled: draft.helpfulness_enabled,
          revision_plan_enabled: draft.revision_plan_enabled,
          score_mode: draft.score_mode,
          min_reviews_for_score: draft.min_reviews_for_score,
          rubric: draft.rubric.map((c) => ({
            ...c,
            title: c.title.trim(),
            levels: c.levels.map((l) => ({ ...l, label: l.label.trim(), points: Number(l.points) })),
          })),
          calibration_samples: pruneSampleScores(draft.calibration_samples, draft.rubric),
          // Untouched defaults stay null so each learner sees them in their language.
          prompts: samePrompts(draft.prompts, defaults) ? null : draft.prompts.map((p) => ({ ...p, label: p.label.trim() })),
        },
        accessToken
      )
      await queryClient.invalidateQueries({ queryKey: queryKeys.peerReview.all(assignmentUuid) })
      toast.success(t('peer_review.instructor.save.saved'))
    } catch (e: any) {
      toast.error(detailMessage(e?.detail, t('peer_review.instructor.save.error')))
    } finally {
      toast.dismiss(toastId)
      setSaving(false)
    }
  }

  const anonymityOptions: { value: PeerReviewAnonymity; icon: React.ReactNode }[] = [
    { value: 'double_blind', icon: <EyeSlash size={16} /> },
    { value: 'anonymous_reviewer', icon: <UserCircle size={16} /> },
    { value: 'named', icon: <Eye size={16} /> },
  ]
  const scoreModes: { value: PeerReviewScoreMode; icon: React.ReactNode }[] = [
    { value: 'feedback_only', icon: <ChatCircleText size={16} /> },
    { value: 'suggest_grade', icon: <GraduationCap size={16} /> },
  ]
  const toggle = (key: keyof Draft, title: string, hint: string) => (
    <SettingRow
      title={title}
      description={hint}
      control={<Switch checked={!!draft[key]} onCheckedChange={(next) => set(key, next as any)} aria-label={title} />}
    />
  )
  const settingsIssues = showErrors ? issues.filter((i) => sectionOf(i) === 'settings') : []

  return (
    <div className='flex flex-col gap-4'>
      {locked && <FeatureGate feature='peer_review'>{null}</FeatureGate>}

      <fieldset disabled={formDisabled} className={`flex flex-col gap-4 min-w-0 ${formDisabled ? 'opacity-60' : ''}`}>
        {/* Master switch */}
        <section className='bg-white rounded-2xl nice-shadow p-5 flex items-start justify-between gap-4'>
          <div className='flex items-start gap-3 min-w-0'>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${draft.enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-neutral-100 text-neutral-500'}`}>
              <UsersThree size={20} weight='duotone' />
            </div>
            <div className='min-w-0'>
              <h2 className='text-base font-semibold text-neutral-900 leading-tight'>{t('peer_review.instructor.toggle.title')}</h2>
              <p className='mt-0.5 text-sm text-neutral-500 max-w-2xl'>
                {draft.enabled ? t('peer_review.instructor.toggle.on_hint') : t('peer_review.instructor.toggle.off_hint')}
              </p>
            </div>
          </div>
          <Switch
            checked={draft.enabled}
            onCheckedChange={(next) => set('enabled', next)}
            disabled={locked && !draft.enabled}
            aria-label={t('peer_review.instructor.toggle.title')}
            className='mt-1'
          />
        </section>

        {draft.enabled && <WhyPeerReviewCard userKey={userKey} />}

        <SubTabs
          ariaLabel={t('peer_review.instructor.setup')}
          idPrefix='peer-review-setup'
          value={section}
          onChange={setSection}
          items={[
            { key: 'settings', label: t('peer_review.instructor.sections.settings'), icon: <SlidersHorizontal size={15} />, dirty: sectionDirty('settings') || sectionHasIssue('settings') },
            { key: 'rubric', label: t('peer_review.instructor.sections.rubric'), icon: <ListChecks size={15} />, dirty: sectionDirty('rubric') || sectionHasIssue('rubric') },
            { key: 'prompts', label: t('peer_review.instructor.sections.prompts'), icon: <ChatText size={15} />, dirty: sectionDirty('prompts') || sectionHasIssue('prompts') },
            { key: 'practice', label: t('peer_review.instructor.sections.practice'), icon: <Target size={15} />, dirty: sectionDirty('practice') || sectionHasIssue('practice') },
          ]}
        >
          <SubTabPanel tab='settings' className='flex flex-col gap-4'>
            <SectionCard
              icon={<UsersThree size={18} />}
              title={t('peer_review.instructor.settings.reviewing_title')}
              description={t('peer_review.instructor.settings.reviewing_description')}
              bodyClassName='p-5 divide-y divide-neutral-100'
            >
              <SettingRow
                title={t('peer_review.instructor.settings.reviews_required')}
                description={t('peer_review.instructor.settings.reviews_required_hint')}
                control={
                  <NumberStepper
                    value={draft.reviews_required}
                    onChange={(n) => set('reviews_required', n)}
                    min={PEER_REVIEW_LIMITS.reviewsMin}
                    max={PEER_REVIEW_LIMITS.reviewsMax}
                    label={t('peer_review.instructor.settings.reviews_required')}
                  />
                }
              />
              <div className='py-4'>
                <p className='text-sm font-semibold text-neutral-900'>{t('peer_review.instructor.settings.anonymity')}</p>
                <p className='text-xs text-neutral-500 mt-0.5'>{t('peer_review.instructor.settings.anonymity_hint')}</p>
                <div role='radiogroup' aria-label={t('peer_review.instructor.settings.anonymity')} className='mt-3 grid grid-cols-1 md:grid-cols-3 gap-2'>
                  {anonymityOptions.map((opt) => (
                    <ChoiceCard
                      key={opt.value}
                      selected={draft.anonymity === opt.value}
                      onClick={() => set('anonymity', opt.value)}
                      icon={opt.icon}
                      title={t(`peer_review.instructor.anonymity.${opt.value}`)}
                      description={t(`peer_review.instructor.anonymity.${opt.value}_hint`)}
                    />
                  ))}
                </div>
              </div>
              {toggle('require_reviews_to_see_feedback', t('peer_review.instructor.settings.require_reviews'), t('peer_review.instructor.settings.require_reviews_hint'))}
              <SettingRow
                title={t('peer_review.instructor.settings.due_date')}
                description={t('peer_review.instructor.settings.due_date_hint')}
                icon={<CalendarBlank size={16} />}
                control={
                  <div className='flex items-center gap-1.5'>
                    <input
                      type='date'
                      value={draft.review_due_date || ''}
                      onChange={(e) => set('review_due_date', e.target.value || null)}
                      aria-label={t('peer_review.instructor.settings.due_date')}
                      className={`${INPUT} w-40`}
                    />
                    {draft.review_due_date && (
                      <Button variant='ghost' size='sm' onClick={() => set('review_due_date', null)}>
                        {t('peer_review.instructor.settings.clear')}
                      </Button>
                    )}
                  </div>
                }
              />
            </SectionCard>

            <SectionCard
              icon={<SlidersHorizontal size={18} />}
              title={t('peer_review.instructor.settings.steps_title')}
              description={t('peer_review.instructor.settings.steps_description')}
              bodyClassName='p-5 divide-y divide-neutral-100'
            >
              {toggle('self_review_enabled', t('peer_review.instructor.settings.self_review'), t('peer_review.instructor.settings.self_review_hint'))}
              {toggle('calibration_enabled', t('peer_review.instructor.settings.practice'), t('peer_review.instructor.settings.practice_hint'))}
              {toggle('helpfulness_enabled', t('peer_review.instructor.settings.helpfulness'), t('peer_review.instructor.settings.helpfulness_hint'))}
              {toggle('revision_plan_enabled', t('peer_review.instructor.settings.revision_plan'), t('peer_review.instructor.settings.revision_plan_hint'))}
            </SectionCard>

            <SectionCard
              icon={<GraduationCap size={18} />}
              title={t('peer_review.instructor.settings.score_title')}
              description={t('peer_review.instructor.settings.score_description')}
              bodyClassName='p-5 flex flex-col gap-4'
            >
              <div role='radiogroup' aria-label={t('peer_review.instructor.settings.score_title')} className='grid grid-cols-1 md:grid-cols-2 gap-2'>
                {scoreModes.map((opt) => (
                  <ChoiceCard
                    key={opt.value}
                    selected={draft.score_mode === opt.value}
                    onClick={() => set('score_mode', opt.value)}
                    icon={opt.icon}
                    title={t(`peer_review.instructor.score_mode.${opt.value}`)}
                    description={t(`peer_review.instructor.score_mode.${opt.value}_hint`)}
                  />
                ))}
              </div>
              <SettingRow
                title={t('peer_review.instructor.settings.min_reviews')}
                description={t('peer_review.instructor.settings.min_reviews_hint')}
                control={
                  <NumberStepper
                    value={draft.min_reviews_for_score}
                    onChange={(n) => set('min_reviews_for_score', n)}
                    min={1}
                    max={PEER_REVIEW_LIMITS.reviewsMax}
                    label={t('peer_review.instructor.settings.min_reviews')}
                  />
                }
              />
              {settingsIssues.slice(0, 1).map((issue) => <FieldError key={issue.code}>{issueMessage(t, issue)}</FieldError>)}
            </SectionCard>
          </SubTabPanel>

          <SubTabPanel tab='rubric' className='flex flex-col gap-4'>
            <RubricBuilder rubric={draft.rubric} onChange={(next) => set('rubric', next)} issues={issues} showErrors={showErrors} />
          </SubTabPanel>

          <SubTabPanel tab='prompts' className='flex flex-col gap-4'>
            <PromptsEditor
              prompts={draft.prompts}
              onChange={(next) => set('prompts', next)}
              onReset={() => set('prompts', defaults)}
              isDefault={samePrompts(draft.prompts, defaults)}
              issues={issues}
              showErrors={showErrors}
            />
          </SubTabPanel>

          <SubTabPanel tab='practice' className='flex flex-col gap-4'>
            <PracticeSamplesEditor
              samples={draft.calibration_samples}
              rubric={draft.rubric}
              practiceEnabled={draft.calibration_enabled}
              onChange={(next) => set('calibration_samples', next)}
              issues={issues}
              showErrors={showErrors}
            />
          </SubTabPanel>
        </SubTabs>
      </fieldset>

      <StickySaveBar visible={dirty} saving={saving} onSave={save} onDiscard={() => { setDraft(initial); setShowErrors(false) }} />
    </div>
  )
}
