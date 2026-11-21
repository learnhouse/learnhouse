'use client'
/*
 The course's Contributions tab: whether learners can improve the course
 from the learner page (off by default), who may, and the review queue
 (suggested edits, feedback, credited contributors).

 Settings are staged and sent by the header Save like the other tabs;
 reviewing acts at once.
*/
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ChatCircleText, GearSix, Globe, HandHeart, PencilSimpleLine, ShieldCheck, Student, UsersThree } from '@phosphor-icons/react'
import { ChoiceCard, SectionCard, SettingRow, StatCard, SubTabs, SubTabPanel, useSubTab, recipes } from '@/design'
import { Switch } from '@components/ui/switch'
import { useCourse } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useCourseRights } from '@components/Hooks/useCourseRights'
import { getUriWithOrg } from '@services/config/config'
import {
  getContributionSettings,
  getContributionSummary,
  updateContributionSettings,
  type ContributionAudience,
  type ContributionSettings,
} from '@services/courses/contributions'
import { EditorPage, EditorSkeleton, ErrorNotice } from '../courseEditorUi'
import { useSectionDraft } from '../courseEditorSave'
import ReviewSuggestions from './ReviewSuggestions'
import ReviewFeedback from './ReviewFeedback'
import ContributorsList from './ContributorsList'

type Section = 'suggestions' | 'feedback' | 'contributors' | 'settings'
const SECTIONS: readonly Section[] = ['suggestions', 'feedback', 'contributors', 'settings']
type Draft = Partial<Omit<ContributionSettings, 'plan_allowed'>>

export const contributionKeys = {
  settings: (c: string) => ['contributions', 'settings', c],
  summary: (c: string) => ['contributions', 'summary', c],
  suggestions: (c: string, status: string) => ['contributions', 'suggestions', c, status],
  feedback: (c: string, status: string) => ['contributions', 'feedback', c, status],
  contributors: (c: string) => ['contributions', 'contributors', c, 'manage'],
}

export default function EditCourseContributions({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const token: string = session?.data?.tokens?.access_token
  const course = useCourse() as any
  const courseUuid: string | undefined = course?.courseStructure?.course_uuid
  const { hasPermission } = useCourseRights(courseUuid ?? '')
  const canManage = hasPermission('manage_contributors')
  const [section, setSection] = useSubTab<Section>('suggestions', SECTIONS, { param: 'tab', rememberAs: false })

  const settingsQuery = useQuery({
    queryKey: contributionKeys.settings(courseUuid ?? ''),
    queryFn: () => getContributionSettings(courseUuid!, token),
    enabled: !!courseUuid && !!token,
  })
  const summaryQuery = useQuery({
    queryKey: contributionKeys.summary(courseUuid ?? ''),
    queryFn: () => getContributionSummary(courseUuid!, token),
    enabled: !!courseUuid && !!token,
    staleTime: 15_000,
  })

  const draft = useSectionDraft<Draft>('contributions', {
    label: t('dashboard.courses.contributions.settings.title'),
    tab: 'contributions',
    save: async (value: Draft) => {
      await updateContributionSettings(courseUuid!, value, token)
      await settingsQuery.refetch()
    },
  })

  if (!courseUuid || settingsQuery.isLoading) {
    return (
      <EditorPage width="wide">
        <EditorSkeleton sections={2} rows={3} />
      </EditorPage>
    )
  }
  const saved = settingsQuery.data
  const settings = { ...(saved ?? {}), ...(draft.value ?? {}) } as ContributionSettings
  const planAllowed = saved?.plan_allowed !== false

  const change = (patch: Draft) => {
    const next = { ...(draft.value ?? {}), ...patch }
    for (const key of Object.keys(next) as (keyof Draft)[]) {
      if (saved && saved[key] === next[key]) delete next[key]
    }
    if (Object.keys(next).length === 0) draft.clear()
    else draft.set(next)
  }

  const summary = summaryQuery.data
  const audiences: { key: ContributionAudience; icon: React.ReactNode }[] = [
    { key: 'enrolled', icon: <Student size={18} /> },
    { key: 'members', icon: <UsersThree size={18} /> },
    { key: 'signed_in', icon: <Globe size={18} /> },
  ]

  const settingsCard = (
    <SectionCard
      icon={<HandHeart size={18} />}
      title={t('dashboard.courses.contributions.settings.title')}
      description={t('dashboard.courses.contributions.settings.description')}
      actions={
        <Switch
          checked={!!settings.enabled}
          disabled={!canManage || (!planAllowed && !saved?.enabled)}
          onCheckedChange={(v) => change({ enabled: v })}
          aria-label={t('dashboard.courses.contributions.settings.enable')}
        />
      }
    >
      {!planAllowed && (
        <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/10">
          {t('dashboard.courses.contributions.settings.plan_required')}{' '}
          <a className="font-semibold underline" href={getUriWithOrg(orgslug, '/dash/org/settings/plan')}>
            {t('dashboard.courses.contributions.settings.see_plans')}
          </a>
        </p>
      )}
      <div className={settings.enabled ? '' : 'pointer-events-none opacity-50'} aria-disabled={!settings.enabled}>
        <p className="mb-2 text-sm font-semibold text-neutral-800">{t('dashboard.courses.contributions.settings.audience')}</p>
        <div role="radiogroup" aria-label={t('dashboard.courses.contributions.settings.audience')} className="grid gap-3 sm:grid-cols-3">
          {audiences.map((a) => (
            <ChoiceCard
              key={a.key}
              selected={settings.audience === a.key}
              onClick={() => canManage && change({ audience: a.key })}
              icon={a.icon}
              title={t(`dashboard.courses.contributions.audience.${a.key}.title`)}
              description={t(`dashboard.courses.contributions.audience.${a.key}.description`)}
            />
          ))}
        </div>
        <div className="mt-5 divide-y divide-neutral-100">
          <SettingRow
            icon={<PencilSimpleLine size={16} />}
            title={t('dashboard.courses.contributions.settings.suggestions')}
            description={t('dashboard.courses.contributions.settings.suggestions_hint')}
            control={<Switch checked={!!settings.allow_suggestions} disabled={!canManage} onCheckedChange={(v) => change({ allow_suggestions: v })} aria-label={t('dashboard.courses.contributions.settings.suggestions')} />}
          />
          <SettingRow
            icon={<ChatCircleText size={16} />}
            title={t('dashboard.courses.contributions.settings.feedback')}
            description={t('dashboard.courses.contributions.settings.feedback_hint')}
            control={<Switch checked={!!settings.allow_feedback} disabled={!canManage} onCheckedChange={(v) => change({ allow_feedback: v })} aria-label={t('dashboard.courses.contributions.settings.feedback')} />}
          />
          <SettingRow
            icon={<ShieldCheck size={16} />}
            title={t('dashboard.courses.contributions.settings.trusted')}
            description={t('dashboard.courses.contributions.settings.trusted_hint')}
            control={<Switch checked={!!settings.trusted_publish} disabled={!canManage} onCheckedChange={(v) => change({ trusted_publish: v })} aria-label={t('dashboard.courses.contributions.settings.trusted')} />}
          />
        </div>
        <p className="mt-4 text-xs text-neutral-500">{t('dashboard.courses.contributions.settings.limits')}</p>
      </div>
    </SectionCard>
  )

  return (
    <EditorPage width="wide">
      {draft.error && <ErrorNotice>{draft.error}</ErrorNotice>}
      {!saved?.enabled ? (
        // Off (until saved on): the switch first, with what it does.
        settingsCard
      ) : (
        <>
          <div className={recipes.statGrid}>
            <StatCard
              icon={<PencilSimpleLine size={18} />}
              iconClass="bg-amber-50 text-amber-600"
              label={t('dashboard.courses.contributions.stats.pending')}
              value={summary?.pending_suggestions ?? null}
              active={section === 'suggestions'}
              onClick={() => setSection('suggestions')}
            />
            <StatCard
              icon={<ChatCircleText size={18} />}
              iconClass="bg-sky-50 text-sky-600"
              label={t('dashboard.courses.contributions.stats.feedback')}
              value={summary?.open_feedback ?? null}
              active={section === 'feedback'}
              onClick={() => setSection('feedback')}
            />
            <StatCard
              icon={<HandHeart size={18} />}
              iconClass="bg-emerald-50 text-emerald-600"
              label={t('dashboard.courses.contributions.stats.contributors')}
              value={summary?.contributors ?? null}
              active={section === 'contributors'}
              onClick={() => setSection('contributors')}
            />
          </div>
          <SubTabs
            value={section}
            onChange={setSection}
            ariaLabel={t('dashboard.courses.settings.tabs.contributions')}
            items={[
              { key: 'suggestions', label: t('dashboard.courses.contributions.tabs.suggestions'), icon: <PencilSimpleLine size={15} /> },
              { key: 'feedback', label: t('dashboard.courses.contributions.tabs.feedback'), icon: <ChatCircleText size={15} /> },
              { key: 'contributors', label: t('dashboard.courses.contributions.tabs.contributors'), icon: <HandHeart size={15} /> },
              { key: 'settings', label: t('dashboard.courses.contributions.tabs.settings'), icon: <GearSix size={15} />, dirty: draft.dirty },
            ]}
          >
            <SubTabPanel value={section} tab="suggestions">
              <ReviewSuggestions orgslug={orgslug} courseUuid={courseUuid} token={token} />
            </SubTabPanel>
            <SubTabPanel value={section} tab="feedback">
              <ReviewFeedback orgslug={orgslug} courseUuid={courseUuid} token={token} />
            </SubTabPanel>
            <SubTabPanel value={section} tab="contributors">
              <ContributorsList courseUuid={courseUuid} token={token} canManage={canManage} trustedPublish={!!saved?.trusted_publish} />
            </SubTabPanel>
            <SubTabPanel value={section} tab="settings">
              {settingsCard}
            </SubTabPanel>
          </SubTabs>
        </>
      )}
    </EditorPage>
  )
}
