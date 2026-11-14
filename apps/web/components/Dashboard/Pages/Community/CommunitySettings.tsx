'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { BookOpen, Globe, Info, Prohibit, ShieldCheck, UsersThree } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useCommunity, useCommunityDispatch } from '@components/Contexts/CommunityContext'
import { updateCommunity } from '@services/communities/communities'
import { revalidateTags } from '@services/utils/ts/requests'
import { queryKeys } from '@/lib/query/keys'
import {
  ChoiceCard,
  FieldLabel,
  INPUT,
  SectionCard,
  StickySaveBar,
  TEXTAREA,
} from '@components/Dashboard/Shared/DashKit/DashKit'
import { SubTabPanel, SubTabs, useSubTab } from '@components/Dashboard/Shared/DashKit/SubTabs'
import CommunityEditThumbnail from './CommunityEditThumbnail'
import CommunityEditCourse from './CommunityEditCourse'
import { UserGroupsSection } from './CommunityEditAccess'
import { ModerationSections, moderationDraftEqual, moderationDraftOf, type ModerationDraft } from './CommunityEditModeration'

const NAME_MAX = 100
const DESCRIPTION_MAX = 500

type Draft = { name: string; description: string; public: boolean; moderation: ModerationDraft }

const SECTIONS = ['general', 'access', 'course', 'moderation', 'words'] as const
type Section = (typeof SECTIONS)[number]
// Old per-tab URLs (and #hash links) name the section they used to open.
const LEGACY_SECTION: Record<string, Section> = {
  general: 'general',
  thumbnail: 'general',
  access: 'access',
  course: 'course',
  moderation: 'moderation',
}

function isDirty(a: Draft, b: Draft) {
  return (
    a.name !== b.name ||
    a.description !== b.description ||
    a.public !== b.public ||
    !moderationDraftEqual(a.moderation, b.moderation)
  )
}

// Every community setting, grouped under sub-tabs. Text, visibility and
// moderation rules are drafts saved by the one sticky save bar (any sub-tab);
// the cover, linked course and user groups apply at once, as they are uploads
// and links, not form fields. Old per-tab URLs land here on ?section= (or the
// older #general, #access, #thumbnail, #course, #moderation).
export default function CommunitySettings() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any
  const community = useCommunity()?.community
  const dispatch = useCommunityDispatch()
  const accessToken = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()

  const saved: Draft | null = useMemo(
    () =>
      community
        ? {
            name: community.name,
            description: community.description || '',
            public: community.public,
            moderation: moderationDraftOf(community),
          }
        : null,
    [community]
  )
  const [draft, setDraft] = useState<Draft | null>(saved)
  const [saving, setSaving] = useState(false)
  const [section, setSection] = useSubTab<Section>('general', SECTIONS)

  // Follow the stored community (a save, an instant action) unless the form
  // holds edits of its own.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft((current) => (current && saved && isDirty(current, saved) ? current : saved))
  }, [saved])

  // Old #hash deep links open the matching sub-tab once.
  useEffect(() => {
    const legacy = LEGACY_SECTION[window.location.hash.replace('#', '')]
    if (!legacy) return
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    setSection(legacy)
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!community || !draft || !saved) return null

  const dirty = isDirty(draft, saved)
  const trimmedName = draft.name.trim()
  const nameError = !trimmedName
    ? t('dashboard.courses.communities.general.form.name_required')
    : trimmedName.length < 3
      ? t('dashboard.courses.communities.general.form.name_min_length')
      : undefined
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value })

  const handleSave = async () => {
    if (nameError) {
      toast.error(nameError)
      return
    }
    setSaving(true)
    const loadingToast = toast.loading(t('dashboard.courses.communities.general.toasts.updating'))
    try {
      const payload = {
        name: trimmedName,
        description: draft.description || null,
        public: draft.public,
        moderation_words: draft.moderation.words,
        moderation_settings: draft.moderation.settings,
      }
      const result = await updateCommunity(community.community_uuid, payload, accessToken)
      if (!result) throw new Error('update failed')
      dispatch?.({ type: 'setCommunity', payload: { ...community, ...payload } })
      queryClient.invalidateQueries({ queryKey: queryKeys.community.list(org.id) })
      queryClient.invalidateQueries({ queryKey: queryKeys.community.detail(community.community_uuid) })
      revalidateTags(['communities'], org.slug)
      toast.success(t('dashboard.courses.communities.general.toasts.update_success'), { id: loadingToast })
    } catch (error) {
      console.error('Failed to update community:', error)
      toast.error(t('dashboard.courses.communities.general.toasts.update_error'), { id: loadingToast })
    } finally {
      setSaving(false)
    }
  }

  const rulesDirty = JSON.stringify(draft.moderation.settings) !== JSON.stringify(saved.moderation.settings)
  const wordsDirty = JSON.stringify(draft.moderation.words) !== JSON.stringify(saved.moderation.words)

  return (
    <>
      <SubTabs
        ariaLabel={t('communities.dash.tabs.settings')}
        value={section}
        onChange={setSection}
        items={[
          {
            key: 'general',
            label: t('dashboard.subtabs.general', 'General'),
            icon: <Info size={15} />,
            dirty: draft.name !== saved.name || draft.description !== saved.description,
          },
          {
            key: 'access',
            label: t('dashboard.subtabs.access', 'Access'),
            icon: <Globe size={15} />,
            dirty: draft.public !== saved.public,
          },
          { key: 'course', label: t('dashboard.courses.communities.course.title'), icon: <BookOpen size={15} /> },
          {
            key: 'moderation',
            label: t('dashboard.subtabs.moderation', 'Moderation'),
            icon: <ShieldCheck size={15} />,
            dirty: rulesDirty,
          },
          {
            key: 'words',
            label: t('dashboard.courses.communities.moderation.blocked_words_section_title'),
            icon: <Prohibit size={15} />,
            dirty: wordsDirty,
          },
        ]}
      >
        <SubTabPanel tab="general">
          <SectionCard
            icon={<Info size={18} />}
            title={t('dashboard.courses.communities.general.title')}
            description={t('dashboard.courses.communities.general.subtitle')}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div>
                <FieldLabel
                  error={nameError && draft.name !== saved.name ? nameError : undefined}
                  hint={`${draft.name.length}/${NAME_MAX}`}
                >
                  {t('dashboard.courses.communities.general.form.name_label')}
                </FieldLabel>
                <input
                  aria-label={t('dashboard.courses.communities.general.form.name_label')}
                  value={draft.name}
                  maxLength={NAME_MAX}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder={t('dashboard.courses.communities.general.form.name_placeholder')}
                  className={INPUT}
                  dir="auto"
                />
              </div>
              <div className="lg:row-span-2">
                <FieldLabel hint={`${draft.description.length}/${DESCRIPTION_MAX}`}>
                  {t('dashboard.courses.communities.general.form.description_label')}
                </FieldLabel>
                <textarea
                  aria-label={t('dashboard.courses.communities.general.form.description_label')}
                  value={draft.description}
                  maxLength={DESCRIPTION_MAX}
                  rows={4}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder={t('dashboard.courses.communities.general.form.description_placeholder')}
                  className={TEXTAREA}
                  dir="auto"
                />
                <p className="mt-1.5 text-xs text-neutral-400">{t('communities.dash.form.description_hint')}</p>
              </div>
            </div>
          </SectionCard>
          <CommunityEditThumbnail />
        </SubTabPanel>

        <SubTabPanel tab="access">
          <SectionCard
            icon={<ShieldCheck size={18} />}
            title={t('dashboard.courses.communities.access.title')}
            description={t('dashboard.courses.communities.access.subtitle')}
          >
            <div role="radiogroup" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ChoiceCard
                selected={draft.public}
                onClick={() => set('public', true)}
                icon={<Globe size={18} />}
                title={t('dashboard.courses.communities.access.public.title')}
                description={t('dashboard.courses.communities.access.public.description')}
              />
              <ChoiceCard
                selected={!draft.public}
                onClick={() => set('public', false)}
                icon={<UsersThree size={18} />}
                title={t('dashboard.courses.communities.access.restricted.title')}
                description={t('dashboard.courses.communities.access.restricted.description')}
              />
            </div>
            {draft.public !== saved.public && (
              <p className="mt-3 text-xs text-amber-700">
                {draft.public
                  ? t('dashboard.courses.communities.access.public.confirmation_message')
                  : t('dashboard.courses.communities.access.restricted.confirmation_message')}
              </p>
            )}
          </SectionCard>
          {/* Groups only matter once the community is restricted. */}
          {!draft.public && <UserGroupsSection />}
        </SubTabPanel>

        <SubTabPanel tab="course">
          <CommunityEditCourse />
        </SubTabPanel>

        <SubTabPanel tab="moderation">
          <ModerationSections part="rules" value={draft.moderation} onChange={(moderation) => set('moderation', moderation)} />
        </SubTabPanel>

        <SubTabPanel tab="words">
          <ModerationSections part="words" value={draft.moderation} onChange={(moderation) => set('moderation', moderation)} />
        </SubTabPanel>
      </SubTabs>

      <StickySaveBar
        visible={dirty}
        saving={saving}
        onSave={handleSave}
        onDiscard={() => setDraft(saved)}
        disabled={!!nameError}
      />
    </>
  )
}
