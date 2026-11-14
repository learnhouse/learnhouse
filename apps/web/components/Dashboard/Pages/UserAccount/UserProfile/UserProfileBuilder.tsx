'use client'
import React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import {
  ArrowDown,
  ArrowSquareOut,
  ArrowUp,
  Briefcase,
  CaretDown,
  DotsSixVertical,
  Eye,
  EyeSlash,
  GraduationCap,
  IdentificationCard,
  Plus,
  SquaresFour,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { updateProfile } from '@services/settings/profile'
import { getUser } from '@services/users/users'
import { getUriWithOrg } from '@services/config/config'
import { Button, EmptyState, SectionCard, Skeleton, StatusPill, StickySaveBar, buttonClass } from '@/design'
import { AccountInput, AccountLabel } from '@components/Objects/Account/AccountSection'
import ProfileView, { type ProfileUser } from '@components/Objects/Profile/ProfileView'
import { SECTION_META } from '@components/Objects/Profile/profileIcons'
import { useSectionTitle } from '@components/Objects/Profile/ProfileSections'
import { useAuthoredCourses, useOwnCertificates } from '@components/Objects/Profile/useProfileData'
import { useUserBadges } from '@ee/components/Plays/UserBadges'
import {
  LIMITS,
  SECTION_TYPES,
  SINGLE_SECTIONS,
  applyDetailTemplate,
  detailsToRecord,
  newSectionId,
  normalizeDetails,
  normalizeProfile,
  profileErrors,
  serializeProfile,
  type DetailItem,
  type DetailTemplate,
  type ProfileDoc,
  type ProfileSection,
  type SectionType,
} from '@/lib/profile/profile'
import {
  AffiliationEditor,
  DetailsEditor,
  EducationEditor,
  ExperienceEditor,
  FeaturedEditor,
  GalleryEditor,
  LinksEditor,
  RichTextField,
  SkillsEditor,
  TextEditor,
  type FeaturedOption,
} from './ProfileSectionEditors'

// The public profile builder: header fields, the ordered sections (details
// included, merged in from the old "Additional details"), and a live preview
// rendered by the same component as the public page.

type Draft = { doc: ProfileDoc; details: DetailItem[] }

const emptySection = (type: SectionType): ProfileSection => {
  const base: ProfileSection = { id: type === 'details' ? 'details' : newSectionId(type), type, title: '' }
  switch (type) {
    case 'text':
      return { ...base, content: '' }
    case 'links':
      return { ...base, links: [{ title: '', url: '' }] }
    case 'skills':
      return { ...base, skills: [] }
    case 'experience':
      return { ...base, experiences: [{ title: '', organization: '', startDate: '', endDate: '', current: false, description: '' }] }
    case 'education':
      return { ...base, education: [{ institution: '', degree: '', field: '', startDate: '', endDate: '', current: false, description: '' }] }
    case 'affiliation':
      return { ...base, affiliations: [{ name: '', description: '', logoUrl: '' }] }
    case 'image-gallery':
      return { ...base, images: [{ url: '', caption: '' }] }
    case 'featured':
      return { ...base, items: [] }
    default:
      return base
  }
}

const TEMPLATES: { key: DetailTemplate; icon: React.ReactNode; adds: SectionType[] }[] = [
  { key: 'general', icon: <IdentificationCard size={15} />, adds: ['links'] },
  { key: 'academic', icon: <GraduationCap size={15} />, adds: ['education'] },
  { key: 'professional', icon: <Briefcase size={15} />, adds: ['experience', 'skills'] },
]

function itemCount(s: ProfileSection, details: DetailItem[]): number | null {
  switch (s.type) {
    case 'details':
      return details.filter((d) => d.text.trim()).length
    case 'links':
      return s.links?.length ?? 0
    case 'skills':
      return s.skills?.length ?? 0
    case 'experience':
      return s.experiences?.length ?? 0
    case 'education':
      return s.education?.length ?? 0
    case 'affiliation':
      return s.affiliations?.length ?? 0
    case 'image-gallery':
      return s.images?.length ?? 0
    case 'featured':
      return s.items?.length ?? 0
    default:
      return null
  }
}

const UserProfileBuilder = ({ onDirtyChange }: { onDirtyChange?: (_dirty: boolean) => void } = {}) => {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const userId = session?.data?.user?.id
  const params = useParams() as any
  const orgslug = params?.orgslug as string
  const sectionTitle = useSectionTitle()

  const [user, setUser] = React.useState<(ProfileUser & Record<string, any>) | null>(null)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [snapshot, setSnapshot] = React.useState('')
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [open, setOpen] = React.useState<string | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [isSaving, setIsSaving] = React.useState(false)
  const [showErrors, setShowErrors] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!userId || !access_token) return
    try {
      const data = await getUser(userId, access_token)
      const next: Draft = { doc: normalizeProfile(data.profile, data.details), details: normalizeDetails(data.details) }
      setUser(data)
      setDraft(next)
      setSnapshot(JSON.stringify(next))
      setLoadFailed(false)
    } catch (error) {
      console.error('Error fetching user data:', error)
      setLoadFailed(true)
      toast.error(t('user.settings.profile_builder.toasts.loading_error'))
    }
  }, [userId, access_token, t])

  React.useEffect(() => {
    load()
  }, [load])

  const isDirty = !!draft && snapshot !== '' && JSON.stringify(draft) !== snapshot
  React.useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])
  React.useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  // Picks for the Featured section: only things the user actually has.
  const org = useOrg() as any
  const hasFeatured = !!draft?.doc.sections.some((s) => s.type === 'featured')
  const myCourses = useAuthoredCourses(userId, access_token, hasFeatured)
  const myCertificates = useOwnCertificates(org?.id, access_token, hasFeatured)
  const { data: myBadgesData, isLoading: badgesLoading } = useUserBadges(hasFeatured ? userId : undefined, access_token, org?.id)
  const featuredOptions: FeaturedOption[] = React.useMemo(() => {
    const badges: any[] = Array.isArray(myBadgesData) ? myBadgesData : []
    return [
      ...(myCourses.data ?? []).map((c: any) => ({ kind: 'course' as const, id: c.course_uuid, label: c.name, meta: c.published ? undefined : t('user.profile.builder.unpublished', { defaultValue: 'Unpublished: only you will see it' }) })),
      ...(myCertificates.data ?? []).map((c: any) => ({
        kind: 'certificate' as const,
        id: c.certificate_user.user_certification_uuid,
        label: c.certification?.config?.certification_name || c.course?.name,
        meta: c.course?.name,
      })),
      ...badges.map((b: any) => ({
        kind: 'badge' as const,
        id: b.playground_uuid,
        label: b.name,
        meta: b.play_name,
        thumb: (
          <span className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-sm" style={{ background: `color-mix(in srgb, ${/^#[0-9a-f]{3,8}$/i.test(b.color) ? b.color : '#a3a3a3'} 18%, white)` }} aria-hidden="true">
            {b.emoji}
          </span>
        ),
      })),
    ]
  }, [myCourses.data, myCertificates.data, myBadgesData, t])

  if (loadFailed) {
    return (
      <div className="bg-white rounded-2xl nice-shadow">
        <EmptyState
          icon={<WarningCircle size={22} />}
          title={t('user.settings.profile_builder.toasts.loading_error')}
          action={<Button onClick={load}>{t('user.settings.security.mfa.retry', { defaultValue: 'Retry' })}</Button>}
        />
      </div>
    )
  }

  if (!draft || !user) {
    return (
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] gap-5" aria-busy="true">
        <div className="flex flex-col gap-5">
          <div className="bg-white rounded-2xl nice-shadow p-5 space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
            <Skeleton className="h-28" />
          </div>
          <div className="bg-white rounded-2xl nice-shadow p-5 space-y-2">
            <Skeleton className="h-4 w-24" />
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}
          </div>
        </div>
        <Skeleton className="h-96 !rounded-2xl" />
      </div>
    )
  }

  const { doc, details } = draft
  const setDoc = (patch: Partial<ProfileDoc>) => setDraft((d) => (d ? { ...d, doc: { ...d.doc, ...patch } } : d))
  const setSections = (sections: ProfileSection[]) => setDoc({ sections })
  const setDetails = (next: DetailItem[]) => setDraft((d) => (d ? { ...d, details: next } : d))
  const updateSection = (s: ProfileSection) => setSections(doc.sections.map((x) => (x.id === s.id ? s : x)))
  const move = (index: number, to: number) => {
    if (to < 0 || to >= doc.sections.length) return
    const next = [...doc.sections]
    const [item] = next.splice(index, 1)
    next.splice(to, 0, item)
    setSections(next)
  }
  const onDragEnd = (result: DropResult) => {
    if (result.destination) move(result.source.index, result.destination.index)
  }
  const present = new Set(doc.sections.map((s) => s.type))
  const addSection = (type: SectionType) => {
    if (SINGLE_SECTIONS.has(type) && present.has(type)) return
    const section = emptySection(type)
    setSections([...doc.sections, section].slice(0, LIMITS.sections))
    setOpen(section.id)
    setAdding(false)
  }
  const applyTemplate = (key: DetailTemplate, adds: SectionType[]) => {
    const label = (id: string, fallback: string) => t(`user.settings.general.labels.${id.replace('-', '_')}`, { defaultValue: fallback })
    let sections = doc.sections
    if (!sections.some((s) => s.type === 'details')) sections = [emptySection('details'), ...sections]
    for (const type of adds) if (!sections.some((s) => s.type === type)) sections = [...sections, emptySection(type)]
    setDraft({ doc: { ...doc, sections }, details: applyDetailTemplate(details, key, label) })
    setOpen('details')
    setAdding(false)
  }

  const errors = profileErrors(doc)
  const errorSections = new Set(errors.map((e) => e.sectionId))

  const handleSave = async () => {
    if (errors.length) {
      setShowErrors(true)
      setOpen(errors[0].sectionId)
      toast.error(t('user.profile.builder.fix_errors', { defaultValue: 'Some addresses are not valid. Fix them before saving.' }))
      return
    }
    setIsSaving(true)
    const loadingToast = toast.loading(t('user.settings.profile_builder.saving'))
    try {
      // Fresh copy so a stale form never overwrites other fields. The read
      // omits the email (PII) but the update requires it: use the session's.
      const fresh = await getUser(String(user.id), access_token)
      const profile = serializeProfile(doc)
      const detailRecord = detailsToRecord(details)
      const payload = { ...fresh, profile, details: detailRecord }
      if (!payload.email && session?.data?.user?.email) payload.email = session.data.user.email
      const res = await updateProfile(payload, user.id, access_token)
      if (!res.success) throw new Error('Failed to update profile')
      const saved: Draft = { doc: normalizeProfile(profile, detailRecord), details: normalizeDetails(detailRecord) }
      setDraft(saved)
      setSnapshot(JSON.stringify(saved))
      setUser({ ...fresh, profile, details: detailRecord })
      setShowErrors(false)
      toast.success(t('user.settings.profile_builder.toasts.save_success'), { id: loadingToast })
    } catch (error) {
      console.error('Error updating profile:', error)
      toast.error(t('user.settings.profile_builder.toasts.save_error'), { id: loadingToast })
    } finally {
      setIsSaving(false)
    }
  }

  const publicHref = getUriWithOrg(orgslug, `/user/${user.username}`)

  const renderEditor = (s: ProfileSection) => {
    switch (s.type) {
      case 'details':
        return <DetailsEditor details={details} onChange={setDetails} />
      case 'text':
        return <TextEditor section={s} onChange={updateSection} />
      case 'links':
        return <LinksEditor section={s} onChange={updateSection} />
      case 'skills':
        return <SkillsEditor section={s} onChange={updateSection} />
      case 'experience':
        return <ExperienceEditor section={s} onChange={updateSection} />
      case 'education':
        return <EducationEditor section={s} onChange={updateSection} />
      case 'affiliation':
        return <AffiliationEditor section={s} onChange={updateSection} />
      case 'image-gallery':
        return <GalleryEditor section={s} onChange={updateSection} />
      case 'featured':
        return (
          <FeaturedEditor
            section={s}
            onChange={updateSection}
            options={featuredOptions}
            loading={myCourses.isLoading || myCertificates.isLoading || (badgesLoading && !!org?.id)}
          />
        )
      case 'courses':
        return <p className="text-sm text-neutral-500">{t('user.settings.profile_builder.editors.courses.info')}</p>
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] gap-5 items-start">
        <div className="flex flex-col gap-5 min-w-0">
          {/* Header fields */}
          <SectionCard
            icon={<IdentificationCard size={18} weight="duotone" />}
            title={t('user.profile.builder.header', { defaultValue: 'Profile header' })}
            description={t('user.profile.builder.header_hint', { defaultValue: 'Shown under your name. Name, photo and bio live in Personal info.' })}
            actions={
              <Link href={publicHref} target="_blank" className={buttonClass('secondary', 'sm')}>
                <ArrowSquareOut size={13} />
                {t('user.profile.builder.view_public', { defaultValue: 'View public profile' })}
              </Link>
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 min-w-0">
                <AccountLabel htmlFor="profile-headline" hint={`${LIMITS.headline - doc.headline.length}`}>
                  {t('user.profile.builder.headline', { defaultValue: 'Headline' })}
                </AccountLabel>
                <AccountInput
                  id="profile-headline"
                  value={doc.headline}
                  maxLength={LIMITS.headline}
                  onChange={(e) => setDoc({ headline: e.target.value })}
                  placeholder={t('user.profile.builder.headline_placeholder', { defaultValue: 'e.g. Design lead teaching interface design' })}
                  dir="auto"
                />
              </div>
              <div className="min-w-0">
                <AccountLabel htmlFor="profile-location">{t('user.settings.general.labels.location', { defaultValue: 'Location' })}</AccountLabel>
                <AccountInput
                  id="profile-location"
                  value={doc.location}
                  maxLength={LIMITS.location}
                  onChange={(e) => setDoc({ location: e.target.value })}
                  placeholder={t('user.profile.builder.location_placeholder', { defaultValue: 'City, country' })}
                  dir="auto"
                />
              </div>
              <div className="min-w-0">
                <AccountLabel htmlFor="profile-pronouns">{t('user.profile.builder.pronouns', { defaultValue: 'Pronouns' })}</AccountLabel>
                <AccountInput
                  id="profile-pronouns"
                  value={doc.pronouns}
                  maxLength={LIMITS.pronouns}
                  onChange={(e) => setDoc({ pronouns: e.target.value })}
                  placeholder={t('user.profile.builder.pronouns_placeholder', { defaultValue: 'e.g. she/her' })}
                  dir="auto"
                />
              </div>
              <div className="sm:col-span-2 min-w-0">
                <AccountLabel htmlFor="profile-about" hint={t('user.profile.builder.about_hint', { defaultValue: 'Replaces your short bio on the profile page' })}>
                  {t('common.about')}
                </AccountLabel>
                <RichTextField
                  id="profile-about"
                  value={doc.about}
                  onChange={(about) => setDoc({ about })}
                  max={LIMITS.about}
                  placeholder={t('user.profile.builder.about_placeholder', { defaultValue: 'A few lines about you, what you teach or what you are learning.' })}
                />
              </div>
            </div>
          </SectionCard>

          {/* Sections */}
          <SectionCard
            icon={<SquaresFour size={18} weight="duotone" />}
            title={t('user.settings.profile_builder.sections')}
            description={t('user.profile.builder.sections_hint', { defaultValue: 'Drag to reorder (or focus the handle and use Space and the arrow keys). Hidden sections stay saved but are not shown.' })}
          >
            {doc.sections.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-200 px-5 py-8 text-center">
                <p className="text-sm font-semibold text-neutral-800">{t('user.profile.builder.no_sections', { defaultValue: 'No sections yet' })}</p>
                <p className="mt-1 text-sm text-neutral-500">{t('user.profile.builder.no_sections_hint', { defaultValue: 'Start from a template or add sections one by one.' })}</p>
              </div>
            ) : (
              <DragDropContext onDragEnd={onDragEnd}>
                <Droppable droppableId="profile-sections">
                  {(provided) => (
                    <ul {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                      {doc.sections.map((s, index) => {
                        const meta = SECTION_META[s.type]
                        const Icon = meta.icon
                        const isOpen = open === s.id
                        const count = itemCount(s, details)
                        const hasError = showErrors && errorSections.has(s.id)
                        return (
                          <Draggable key={s.id} draggableId={s.id} index={index}>
                            {(drag, snap) => (
                              <li
                                ref={drag.innerRef}
                                {...drag.draggableProps}
                                className={`rounded-xl bg-white transition-shadow ${
                                  hasError ? 'ring-2 ring-rose-300' : isOpen ? 'ring-2 ring-neutral-900' : 'ring-1 ring-inset ring-neutral-200'
                                } ${snap.isDragging ? 'shadow-lg' : ''}`}
                              >
                                <div className="flex items-center gap-1.5 ps-1 pe-1.5 h-12">
                                  <span
                                    {...drag.dragHandleProps}
                                    aria-label={t('user.profile.builder.drag', { defaultValue: 'Drag to reorder {{name}}', name: sectionTitle(s) })}
                                    className="p-1.5 rounded-lg text-neutral-300 hover:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 shrink-0 cursor-grab"
                                  >
                                    <DotsSixVertical size={16} weight="bold" />
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setOpen(isOpen ? null : s.id)}
                                    aria-expanded={isOpen}
                                    className="flex-1 min-w-0 flex items-center gap-2.5 h-full text-start focus-visible:outline-none"
                                  >
                                    <span className={`shrink-0 ${s.hidden ? 'text-neutral-300' : 'text-neutral-500'}`}>
                                      <Icon size={17} weight="duotone" />
                                    </span>
                                    <span className={`min-w-0 truncate text-sm font-medium ${s.hidden ? 'text-neutral-400' : 'text-neutral-800'}`} dir="auto">
                                      {sectionTitle(s)}
                                    </span>
                                    {count !== null && <span className="shrink-0 text-xs tabular-nums text-neutral-400">{count}</span>}
                                    {s.hidden && <StatusPill className="shrink-0">{t('user.profile.builder.hidden', { defaultValue: 'Hidden' })}</StatusPill>}
                                    {hasError && <WarningCircle size={15} weight="fill" className="shrink-0 text-rose-500" />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => updateSection({ ...s, hidden: !s.hidden })}
                                    aria-pressed={!!s.hidden}
                                    aria-label={s.hidden ? t('user.profile.builder.show', { defaultValue: 'Show on profile' }) : t('user.profile.builder.hide', { defaultValue: 'Hide from profile' })}
                                    title={s.hidden ? t('user.profile.builder.show', { defaultValue: 'Show on profile' }) : t('user.profile.builder.hide', { defaultValue: 'Hide from profile' })}
                                    className="w-8 h-8 rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 flex items-center justify-center shrink-0"
                                  >
                                    {s.hidden ? <EyeSlash size={16} /> : <Eye size={16} />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setOpen(isOpen ? null : s.id)}
                                    aria-label={isOpen ? t('common.close') : t('user.profile.builder.edit_section', { defaultValue: 'Edit section' })}
                                    className="w-8 h-8 rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 flex items-center justify-center shrink-0"
                                  >
                                    <CaretDown size={14} weight="bold" className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                  </button>
                                </div>
                                {isOpen && (
                                  <div className="border-t border-neutral-100 px-3 sm:px-4 py-4 space-y-4">
                                      <div className="max-w-sm">
                                        <AccountLabel htmlFor={`${s.id}-title`}>{t('user.settings.profile_builder.editors.section_title')}</AccountLabel>
                                        <AccountInput
                                          id={`${s.id}-title`}
                                          value={s.title}
                                          maxLength={LIMITS.title}
                                          onChange={(e) => updateSection({ ...s, title: e.target.value })}
                                          placeholder={t(meta.labelKey, { defaultValue: meta.label })}
                                          dir="auto"
                                        />
                                      </div>
                                    {renderEditor(s)}
                                    <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-neutral-100">
                                      <Button size="sm" variant="ghost" icon={<ArrowUp size={13} />} disabled={index === 0} onClick={() => move(index, index - 1)}>
                                        {t('common.move_up')}
                                      </Button>
                                      <Button size="sm" variant="ghost" icon={<ArrowDown size={13} />} disabled={index === doc.sections.length - 1} onClick={() => move(index, index + 1)}>
                                        {t('common.move_down')}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="danger-ghost"
                                        className="ms-auto"
                                        icon={<Trash size={13} />}
                                        onClick={() => {
                                          setSections(doc.sections.filter((x) => x.id !== s.id))
                                          setOpen(null)
                                        }}
                                      >
                                        {t('user.profile.builder.remove_section', { defaultValue: 'Remove section' })}
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </li>
                            )}
                          </Draggable>
                        )
                      })}
                      {provided.placeholder}
                    </ul>
                  )}
                </Droppable>
              </DragDropContext>
            )}

            {/* Add a section / start from a template */}
            <div className="mt-4">
              {adding ? (
                <div className="rounded-xl bg-neutral-50 p-3 sm:p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-neutral-900">{t('user.settings.profile_builder.add_section')}</p>
                    <Button variant="ghost" size="icon" onClick={() => setAdding(false)} aria-label={t('common.close')} icon={<X size={14} />} />
                  </div>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {SECTION_TYPES.map((type) => {
                      const meta = SECTION_META[type]
                      const Icon = meta.icon
                      const taken = SINGLE_SECTIONS.has(type) && present.has(type)
                      return (
                        <li key={type}>
                          <button
                            type="button"
                            disabled={taken}
                            onClick={() => addSection(type)}
                            className="w-full h-full flex items-start gap-3 rounded-xl bg-white p-3 text-start nice-shadow hover:bg-neutral-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <span className="w-8 h-8 rounded-lg bg-neutral-100 text-neutral-600 flex items-center justify-center shrink-0">
                              <Icon size={17} weight="duotone" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-neutral-800">{t(meta.labelKey, { defaultValue: meta.label })}</span>
                              <span className="block text-xs text-neutral-500">
                                {taken ? t('user.profile.builder.already_added', { defaultValue: 'Already on your profile' }) : t(meta.descriptionKey, { defaultValue: meta.description })}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">
                      {t('user.profile.builder.templates', { defaultValue: 'Start from a template' })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {TEMPLATES.map((tpl) => (
                        <Button key={tpl.key} size="sm" icon={tpl.icon} onClick={() => applyTemplate(tpl.key, tpl.adds)}>
                          {t(`user.profile.builder.template_${tpl.key}`, { defaultValue: tpl.key === 'general' ? 'General' : tpl.key === 'academic' ? 'Academic' : 'Professional' })}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button icon={<Plus size={13} weight="bold" />} onClick={() => setAdding(true)} disabled={doc.sections.length >= LIMITS.sections}>
                    {t('user.settings.profile_builder.add_section')}
                  </Button>
                  {doc.sections.length === 0 &&
                    TEMPLATES.map((tpl) => (
                      <Button key={tpl.key} variant="ghost" icon={tpl.icon} onClick={() => applyTemplate(tpl.key, tpl.adds)}>
                        {t(`user.profile.builder.template_${tpl.key}`, { defaultValue: tpl.key === 'general' ? 'General' : tpl.key === 'academic' ? 'Academic' : 'Professional' })}
                      </Button>
                    ))}
                </div>
              )}
            </div>
          </SectionCard>
        </div>

        {/* Live preview: beside the editor on wide screens, below it otherwise. */}
        <aside className="min-w-0 xl:sticky xl:top-24" aria-label={t('user.profile.builder.preview', { defaultValue: 'Preview' })}>
          <div className="flex items-center justify-between gap-3 mb-2 px-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{t('user.profile.builder.preview', { defaultValue: 'Preview' })}</p>
            <Link href={publicHref} target="_blank" className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-500 hover:text-neutral-900">
              {t('user.profile.builder.view_public', { defaultValue: 'View public profile' })}
              <ArrowSquareOut size={12} />
            </Link>
          </div>
          <div className="rounded-2xl bg-neutral-100/80 ring-1 ring-inset ring-neutral-200/70 p-2.5 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto">
            <ProfileView user={user} doc={doc} details={details} isSelf orgslug={orgslug} mode="preview" />
          </div>
        </aside>
      </div>
      <StickySaveBar
        visible={isDirty}
        saving={isSaving}
        onSave={handleSave}
        onDiscard={() => {
          setDraft(JSON.parse(snapshot))
          setOpen(null)
          setShowErrors(false)
        }}
      />
    </>
  )
}

export default UserProfileBuilder
