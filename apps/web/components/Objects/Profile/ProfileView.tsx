'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import {
  ArrowRight,
  BookOpen,
  Check,
  LinkSimple,
  LockSimple,
  MapPin,
  Medal,
  PencilSimple,
  SquaresFour,
  Trophy,
  UserCircle,
} from '@phosphor-icons/react'
import UserAvatar from '@components/Objects/UserAvatar'
import CourseThumbnailLanding from '@components/Objects/Thumbnails/CourseThumbnailLanding'
import CertificateCard from '@components/Objects/Certificates/CertificateCard'
import { MessageUserButton } from '@components/Messaging/EntryButtons'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { getUriWithOrg } from '@services/config/config'
import { useTrail } from '@/hooks/queries/useTrail'
import { summarizeRuns, type RunSummary } from '@components/Pages/Trail/trailStats'
import { resourcePath } from '@/lib/seo/paths'
import { formatDate } from '@/lib/format'
import { Button, EmptyState, Skeleton, StatusPill, SubTabPanel, SubTabs, buttonClass, useSubTab } from '@/design'
import { useUserBadges, UserBadgesGrid, UserBadgesSkeleton, UserBadgesStrip } from '@ee/components/Plays/UserBadges'
import { layoutSections, type DetailItem, type ProfileDoc, type ProfileSection } from '@/lib/profile/profile'
import { SECTION_META } from './profileIcons'
import RichText from './RichText'
import {
  AffiliationList,
  DetailsList,
  EducationTimeline,
  ExperienceTimeline,
  Gallery,
  LinksList,
  ProfileCard,
  SkillsList,
  TextBlock,
  useSectionTitle,
} from './ProfileSections'
import { certificateCardProps, useAuthoredCourses, useFeaturedCertificates, useOwnCertificates } from './useProfileData'

export type ProfileUser = {
  id: number
  user_uuid: string
  username: string
  first_name?: string
  last_name?: string
  avatar_image?: string
  bio?: string
}

const TABS = ['overview', 'courses', 'achievements'] as const
type Tab = (typeof TABS)[number]

export const PUBLIC_PROFILE_EDIT_PATH = '/account/general?section=public'

const fullName = (u: ProfileUser) => [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username

/**
 * The public profile: header, then an overview (main column + slim side
 * column on desktop, one column on phones) and, on the page, Courses and
 * Achievements sub-tabs. `mode="preview"` is the builder's live preview:
 * one column, no tabs, inert actions, no viewer-only blocks.
 */
export default function ProfileView({
  user,
  doc,
  details,
  isSelf,
  orgslug,
  mode = 'page',
}: {
  user: ProfileUser
  doc: ProfileDoc
  details: DetailItem[]
  isSelf: boolean
  orgslug: string
  mode?: 'page' | 'preview'
}) {
  const { t } = useTranslation()
  const preview = mode === 'preview'
  const org = useOrg() as any
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token as string | undefined
  const title = useSectionTitle()

  const { main, side } = layoutSections(doc, details)
  const coursesSection = doc.sections.find((s) => s.type === 'courses' && !s.hidden)
  const featuredItems = doc.sections.filter((s) => s.type === 'featured' && !s.hidden).flatMap((s) => s.items ?? [])
  const wantsCourses = !!coursesSection || featuredItems.some((i) => i.kind === 'course')

  const courses = useAuthoredCourses(user.id, token, wantsCourses)
  const { data: badgesData, isLoading: badgesLoading } = useUserBadges(user.id, token, org?.id)
  const badges: any[] = Array.isArray(badgesData) ? badgesData : []

  // Viewer-only blocks: the learner's own progress and certificates.
  const ownBlocks = isSelf && !preview
  const { data: trail, isLoading: trailLoading } = useTrail(ownBlocks ? org?.id : undefined)
  const learning = React.useMemo(() => summarizeRuns(trail), [trail])
  const ownCertificates = useOwnCertificates(org?.id, token, ownBlocks)

  // Someone else's empty course list is noise: hide it (the owner keeps it).
  const hasAuthored = courses.isLoading || (courses.data?.length ?? 0) > 0
  const showAuthored = !!coursesSection && (isSelf || hasAuthored)
  const showCoursesTab = !preview && (showAuthored || ownBlocks)
  const showAchievementsTab = !preview && (badges.length > 0 || ownBlocks)
  const [tab, setTab] = useSubTab<Tab>('overview', TABS, { rememberAs: false })

  const hasAbout = !!doc.about.trim() || !!user.bio?.trim()
  const isEmpty = !hasAbout && main.length === 0 && side.length === 0 && badges.length === 0

  const renderMain = (s: ProfileSection) => {
    const meta = SECTION_META[s.type]
    const Icon = meta.icon
    const icon = <Icon weight="duotone" />
    switch (s.type) {
      case 'text':
        return <ProfileCard key={s.id} title={title(s)} icon={icon}><TextBlock section={s} /></ProfileCard>
      case 'experience':
        return <ProfileCard key={s.id} title={title(s)} icon={icon}><ExperienceTimeline section={s} /></ProfileCard>
      case 'education':
        return <ProfileCard key={s.id} title={title(s)} icon={icon}><EducationTimeline section={s} /></ProfileCard>
      case 'image-gallery':
        return <ProfileCard key={s.id} title={title(s)} icon={icon}><Gallery section={s} /></ProfileCard>
      case 'featured':
        return (
          <FeaturedSection
            key={s.id}
            section={s}
            title={title(s)}
            icon={icon}
            user={user}
            orgslug={orgslug}
            courses={courses.data ?? []}
            coursesLoading={courses.isLoading}
            badges={badges}
          />
        )
      case 'courses':
        if (!showAuthored) return null
        return (
          <AuthoredCourses
            key={s.id}
            title={title(s)}
            icon={icon}
            query={courses}
            orgslug={orgslug}
            limit={preview ? 2 : 4}
            onViewAll={showCoursesTab ? () => setTab('courses') : undefined}
          />
        )
      default:
        return null
    }
  }

  const renderSide = (s: ProfileSection) => {
    const Icon = SECTION_META[s.type].icon
    const icon = <Icon weight="duotone" />
    switch (s.type) {
      case 'details':
        return <ProfileCard key={s.id} title={title(s)} icon={icon}><DetailsList details={details} /></ProfileCard>
      case 'links':
        return <ProfileCard key={s.id} title={title(s)} icon={icon}><LinksList section={s} /></ProfileCard>
      case 'skills':
        return <ProfileCard key={s.id} title={title(s)} icon={icon}><SkillsList section={s} /></ProfileCard>
      case 'affiliation':
        return <ProfileCard key={s.id} title={title(s)} icon={icon}><AffiliationList section={s} /></ProfileCard>
      default:
        return null
    }
  }

  const about = (
    <ProfileCard title={t('common.about')} icon={<UserCircle weight="duotone" />}>
      {doc.about.trim() ? (
        <RichText value={doc.about} />
      ) : user.bio?.trim() ? (
        <p className="text-[15px] leading-relaxed text-neutral-700 whitespace-pre-line break-words" dir="auto">{user.bio}</p>
      ) : isSelf ? (
        <p className="text-sm text-neutral-500">
          {t('user.profile.about_empty_self', { defaultValue: 'Tell people who you are and what you teach or learn.' })}{' '}
          {!preview && (
            <Link href={getUriWithOrg(orgslug, PUBLIC_PROFILE_EDIT_PATH)} className="lh-t-link font-semibold text-neutral-900 hover:underline">
              {t('user.profile.add_intro', { defaultValue: 'Add an introduction' })}
            </Link>
          )}
        </p>
      ) : (
        <p className="text-sm text-neutral-400">{t('user.no_biography')}</p>
      )}
    </ProfileCard>
  )

  const badgesCard =
    badgesLoading && !!token && !preview ? (
      <ProfileCard title={t('plays.badges.title')} icon={<Medal weight="duotone" />}>
        <div className="flex gap-1.5">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="w-6 h-6 !rounded-full" />)}
        </div>
      </ProfileCard>
    ) : badges.length > 0 ? (
      <ProfileCard
        title={t('plays.badges.title')}
        icon={<Medal weight="duotone" />}
        action={
          showAchievementsTab ? (
            <button type="button" onClick={() => setTab('achievements')} className="text-xs font-semibold text-neutral-500 hover:text-neutral-900">
              {t('common.view_all', { defaultValue: 'View all' })}
            </button>
          ) : undefined
        }
      >
        <UserBadgesStrip badges={badges} max={preview ? 6 : 10} />
      </ProfileCard>
    ) : null

  const overview = (
    <div className={preview ? 'flex flex-col gap-4' : 'grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-5 items-start'}>
      <div className="flex flex-col gap-5 min-w-0">
        {about}
        {/* Phones (and the preview): the side cards follow About. */}
        {preview ? side.map(renderSide) : side.length > 0 && <div className="flex flex-col gap-5 lg:hidden">{side.map(renderSide)}</div>}
        {main.map(renderMain)}
        {isEmpty && (
          <div className="bg-white rounded-2xl nice-shadow">
            <EmptyState
              icon={<SquaresFour size={22} />}
              title={
                isSelf
                  ? t('user.profile.empty_self_title', { defaultValue: 'Your profile is waiting for you' })
                  : t('user.profile.empty_title', { defaultValue: '{{name}} has not filled in their profile yet', name: user.first_name || user.username })
              }
              description={
                isSelf
                  ? t('user.profile.empty_self_body', { defaultValue: 'Add a headline, your details, links and sections people can browse.' })
                  : undefined
              }
              action={
                isSelf && !preview ? (
                  <Link href={getUriWithOrg(orgslug, PUBLIC_PROFILE_EDIT_PATH)} className={buttonClass('primary', 'md')}>
                    <PencilSimple size={14} weight="bold" />
                    {t('user.profile.build', { defaultValue: 'Build your profile' })}
                  </Link>
                ) : undefined
              }
            />
          </div>
        )}
        {isSelf && !preview && !isEmpty && doc.sections.length === 0 && (
          <Link
            href={getUriWithOrg(orgslug, PUBLIC_PROFILE_EDIT_PATH)}
            className="flex items-center gap-3 rounded-2xl border border-dashed border-neutral-300 px-5 py-4 text-sm text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 transition-colors"
          >
            <SquaresFour size={20} weight="duotone" className="shrink-0 text-neutral-400" />
            <span className="flex-1 min-w-0">
              {t('user.profile.add_sections_hint', { defaultValue: 'Add your details, links, experience or featured work so people know you better.' })}
            </span>
            <ArrowRight size={14} className="shrink-0 rtl:rotate-180" />
          </Link>
        )}
        {preview ? badgesCard : badgesCard && <div className="lg:hidden">{badgesCard}</div>}
      </div>
      {!preview && (side.length > 0 || badgesCard) && (
        <aside className="hidden lg:flex flex-col gap-5 min-w-0 lg:sticky lg:top-[calc(6rem+var(--lh-company-bar-h,0px))]">
          {side.map(renderSide)}
          {badgesCard}
        </aside>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-5 min-w-0">
      <ProfileHeader user={user} doc={doc} isSelf={isSelf} orgslug={orgslug} preview={preview} />
      {preview ? (
        overview
      ) : (
        <SubTabs
          ariaLabel={t('user.profile.sections', { defaultValue: 'Profile sections' })}
          idPrefix="profile"
          value={tab}
          onChange={setTab}
          items={[
            { key: 'overview', label: t('user.profile.overview', { defaultValue: 'Overview' }), icon: <SquaresFour weight="duotone" /> },
            { key: 'courses', label: t('courses.courses', { defaultValue: 'Courses' }), icon: <BookOpen weight="duotone" />, hidden: !showCoursesTab },
            {
              key: 'achievements',
              label: t('trail.achievements.title', { defaultValue: 'Achievements' }),
              icon: <Trophy weight="duotone" />,
              hidden: !showAchievementsTab,
            },
          ]}
        >
          <SubTabPanel tab="overview">{overview}</SubTabPanel>
          {showCoursesTab && (
            <SubTabPanel tab="courses">
              {coursesSection && showAuthored && (
                <AuthoredCourses
                  title={title(coursesSection)}
                  icon={<BookOpen weight="duotone" />}
                  query={courses}
                  orgslug={orgslug}
                  wide
                />
              )}
              {ownBlocks && <OwnLearning summaries={learning} loading={trailLoading && !!org?.id} orgslug={orgslug} />}
            </SubTabPanel>
          )}
          {showAchievementsTab && (
            <SubTabPanel tab="achievements">
              {(badges.length > 0 || badgesLoading) && (
                <ProfileCard title={t('plays.badges.title')} icon={<Medal weight="duotone" />}>
                  {badgesLoading ? <UserBadgesSkeleton count={4} /> : <UserBadgesGrid badges={badges} />}
                </ProfileCard>
              )}
              {ownBlocks && (
                <OwnCertificates
                  query={ownCertificates}
                  learnerName={fullName(user)}
                  orgslug={orgslug}
                />
              )}
            </SubTabPanel>
          )}
        </SubTabs>
      )}
    </div>
  )
}

// ─── Header ──────────────────────────────────────────────────────────────────

function ProfileHeader({ user, doc, isSelf, orgslug, preview }: { user: ProfileUser; doc: ProfileDoc; isSelf: boolean; orgslug: string; preview: boolean }) {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)
  const avatarUrl = user.avatar_image ? getUserAvatarMediaDirectory(user.user_uuid, user.avatar_image) : ''

  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success(t('user.profile.link_copied', { defaultValue: 'Profile link copied' }))
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('user.profile.link_copy_failed', { defaultValue: 'Could not copy the link' }))
    }
  }

  return (
    <section className="bg-white rounded-2xl nice-shadow overflow-hidden min-w-0">
      {/* Cover: no cover images yet, so a soft wash of the org accent under
          the dashboard's dot grid, fading out toward the bottom. */}
      <div
        className={`relative ${preview ? 'h-20' : 'h-24 sm:h-36'}`}
        style={{ background: 'color-mix(in srgb, var(--lh-accent, #171717) 6%, #fafafa)' }}
        aria-hidden="true"
      >
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(rgba(0,0,0,0.13) 1px, transparent 1.2px)',
            backgroundSize: '14px 14px',
            backgroundPosition: 'center top',
            maskImage: 'radial-gradient(120% 140% at 50% 0%, black 0%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(120% 140% at 50% 0%, black 0%, transparent 75%)',
          }}
        />
      </div>
      <div className={preview ? 'px-4 pb-4' : 'px-5 sm:px-8 pb-5 sm:pb-7'}>
        <div className={`flex flex-wrap items-end justify-between gap-3 ${preview ? '-mt-10' : '-mt-12 sm:-mt-16'}`}>
          <div className={`relative rounded-full ring-4 ring-white bg-white shadow-sm ${preview ? '[&_img]:size-20!' : 'max-sm:[&_img]:size-24!'}`}>
            <UserAvatar
              width={preview ? 80 : 128}
              avatar_url={avatarUrl}
              predefined_avatar={avatarUrl ? undefined : 'empty'}
              rounded="rounded-full"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-1">
            {!preview && (
              <>
                {isSelf ? (
                  <Link href={getUriWithOrg(orgslug, PUBLIC_PROFILE_EDIT_PATH)} className={buttonClass('secondary', 'md')}>
                    <PencilSimple size={15} />
                    {t('user.profile.edit', { defaultValue: 'Edit profile' })}
                  </Link>
                ) : (
                  <MessageUserButton orgslug={orgslug} userUuid={user.user_uuid} userId={user.id} />
                )}
                <Button
                  onClick={copyLink}
                  icon={copied ? <Check size={15} weight="bold" /> : <LinkSimple size={15} />}
                  aria-label={t('user.profile.copy_link', { defaultValue: 'Copy profile link' })}
                  title={t('user.profile.copy_link', { defaultValue: 'Copy profile link' })}
                >
                  <span className="max-sm:sr-only">{t('user.profile.share', { defaultValue: 'Share' })}</span>
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="mt-3 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h1 className={`${preview ? 'text-lg' : 'text-2xl sm:text-[28px]'} font-bold tracking-tight text-neutral-900 break-words min-w-0`} dir="auto">
              {fullName(user)}
            </h1>
            {doc.pronouns.trim() && <span className="text-sm text-neutral-400" dir="auto">({doc.pronouns.trim()})</span>}
          </div>
          <p className="text-sm text-neutral-400">
            <bdi dir="ltr">@{user.username}</bdi>
          </p>
          {doc.headline.trim() && (
            <p className={`mt-2 ${preview ? 'text-sm' : 'text-[15px] sm:text-base'} font-medium text-neutral-700 break-words`} dir="auto">
              {doc.headline.trim()}
            </p>
          )}
          {doc.location.trim() && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-neutral-500 min-w-0">
              <MapPin size={15} className="shrink-0" aria-hidden="true" />
              <span className="truncate" dir="auto">{doc.location.trim()}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

// ─── Courses ─────────────────────────────────────────────────────────────────

function CourseGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="aspect-video !rounded-xl" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  )
}

function AuthoredCourses({
  title,
  icon,
  query,
  orgslug,
  limit,
  onViewAll,
  wide = false,
}: {
  title: string
  icon: React.ReactNode
  query: { data?: any[]; isLoading: boolean; isError: boolean }
  orgslug: string
  limit?: number
  onViewAll?: () => void
  wide?: boolean
}) {
  const { t } = useTranslation()
  const list = query.data ?? []
  const shown = limit ? list.slice(0, limit) : list
  return (
    <ProfileCard
      title={title}
      icon={icon}
      action={
        onViewAll && list.length > shown.length ? (
          <button type="button" onClick={onViewAll} className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-500 hover:text-neutral-900">
            {t('common.view_all', { defaultValue: 'View all' })}
            <span className="tabular-nums">({list.length})</span>
          </button>
        ) : undefined
      }
    >
      {query.isLoading ? (
        <CourseGridSkeleton count={wide ? 3 : 2} />
      ) : query.isError ? (
        <p className="text-sm text-rose-600">{t('courses.courses_load_error')}</p>
      ) : shown.length ? (
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${wide ? 'lg:grid-cols-3 xl:grid-cols-4' : ''}`}>
          {shown.map((course) => (
            <CourseThumbnailLanding key={course.course_uuid || course.id} course={course} orgslug={course.org_slug || orgslug} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-neutral-400">{t('courses.no_courses_found')}</p>
      )}
    </ProfileCard>
  )
}

function PrivatePill() {
  const { t } = useTranslation()
  return (
    <StatusPill icon={<LockSimple size={11} weight="bold" />}>
      {t('user.profile.only_you', { defaultValue: 'Only you can see this' })}
    </StatusPill>
  )
}

function OwnLearning({ summaries, loading, orgslug }: { summaries: RunSummary[]; loading: boolean; orgslug: string }) {
  const { t } = useTranslation()
  const inProgress = summaries.filter((s) => !s.completed)
  const completed = summaries.filter((s) => s.completed)
  const group = (label: string, items: RunSummary[]) =>
    items.length > 0 && (
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">
          {label} <span className="tabular-nums">· {items.length}</span>
        </p>
        <ul className="divide-y divide-neutral-100 rounded-xl ring-1 ring-neutral-100 overflow-hidden">
          {items.map((s) => (
            <li key={s.courseUuid}>
              <Link
                href={getUriWithOrg(orgslug, resourcePath('course', s.course, s.courseUuid))}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-neutral-50 transition-colors min-w-0"
              >
                <span className="flex-1 min-w-0 truncate text-sm font-medium text-neutral-800" dir="auto">{s.course?.name}</span>
                <span className="hidden sm:block w-28 h-1.5 rounded-full bg-neutral-100 overflow-hidden shrink-0" aria-hidden="true">
                  <span className="lh-t-progress block h-full rounded-full bg-neutral-900" style={{ width: `${s.percent}%` }} />
                </span>
                <span className="w-10 text-end text-xs font-semibold tabular-nums text-neutral-500 shrink-0">{s.percent}%</span>
                <ArrowRight size={13} className="text-neutral-300 shrink-0 rtl:rotate-180" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    )
  return (
    <ProfileCard title={t('user.profile.your_learning', { defaultValue: 'Your learning' })} icon={<BookOpen weight="duotone" />} action={<PrivatePill />}>
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}
        </div>
      ) : summaries.length === 0 ? (
        <p className="text-sm text-neutral-500">
          {t('user.profile.no_learning', { defaultValue: 'Courses you start show up here with your progress.' })}{' '}
          <Link href={getUriWithOrg(orgslug, '/courses')} className="lh-t-link font-semibold text-neutral-900 hover:underline">
            {t('trail.start.button', 'Browse courses')}
          </Link>
        </p>
      ) : (
        <div className="space-y-5">
          {group(t('user.profile.in_progress', { defaultValue: 'In progress' }), inProgress)}
          {group(t('user.profile.completed', { defaultValue: 'Completed' }), completed)}
        </div>
      )}
    </ProfileCard>
  )
}

function OwnCertificates({ query, learnerName, orgslug }: { query: { data?: any[]; isLoading: boolean }; learnerName: string; orgslug: string }) {
  const { t, i18n } = useTranslation()
  const list = query.data ?? []
  return (
    <ProfileCard title={t('trail.achievements.certificates', 'Certificates')} icon={<Medal weight="duotone" />} action={<PrivatePill />}>
      {query.isLoading ? (
        <CourseGridSkeleton count={3} />
      ) : list.length === 0 ? (
        <p className="text-sm text-neutral-500">
          {t('certificate.no_certificates_earned')} · {t('certificate.complete_courses_to_earn')}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((c: any) => {
            const date = formatDate(c.certificate_user.created_at, i18n.language, { dateStyle: 'long' })
            return (
              <CertificateCard
                key={c.certificate_user.user_certification_uuid}
                href={getUriWithOrg(orgslug, `/certificates/${c.certificate_user.user_certification_uuid}/verify`)}
                certificate={certificateCardProps(c, learnerName, date)}
                subtitle={c.course?.name}
                tag={t('certificate.kind_course')}
                date={date}
              />
            )
          })}
        </div>
      )}
    </ProfileCard>
  )
}

// ─── Featured ────────────────────────────────────────────────────────────────

function FeaturedSection({
  section,
  title,
  icon,
  user,
  orgslug,
  courses,
  coursesLoading,
  badges,
}: {
  section: ProfileSection
  title: string
  icon: React.ReactNode
  user: ProfileUser
  orgslug: string
  courses: any[]
  coursesLoading: boolean
  badges: any[]
}) {
  const { t, i18n } = useTranslation()
  const org = useOrg() as any
  const items = section.items ?? []
  const certIds = items.filter((i) => i.kind === 'certificate').map((i) => i.id)
  const certs = useFeaturedCertificates(certIds, org?.id, user.user_uuid)
  // Only what the viewer can already see: courses from the visibility-filtered
  // authored list, certificates verified against this user, badges from the
  // badge list. Anything else is skipped silently.
  const pickedCourses = items
    .filter((i) => i.kind === 'course')
    .map((i) => courses.find((c) => c.course_uuid === i.id))
    .filter(Boolean)
  const pickedCerts = certIds.map((id) => certs.certificates.find((c: any) => c.certificate_user.user_certification_uuid === id)).filter(Boolean)
  const pickedBadges = items
    .filter((i) => i.kind === 'badge')
    .map((i) => badges.find((b) => b.playground_uuid === i.id))
    .filter(Boolean)
  const loading = coursesLoading || certs.isLoading
  if (!loading && !pickedCourses.length && !pickedCerts.length && !pickedBadges.length) return null
  return (
    <ProfileCard title={title} icon={icon}>
      {loading ? (
        <CourseGridSkeleton count={2} />
      ) : (
        <div className="space-y-4">
          {(pickedCourses.length > 0 || pickedCerts.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {pickedCourses.map((course: any) => (
                <CourseThumbnailLanding key={course.course_uuid} course={course} orgslug={course.org_slug || orgslug} />
              ))}
              {pickedCerts.map((c: any) => {
                const date = formatDate(c.certificate_user.created_at, i18n.language, { dateStyle: 'long' })
                return (
                  <CertificateCard
                    key={c.certificate_user.user_certification_uuid}
                    href={getUriWithOrg(orgslug, `/certificates/${c.certificate_user.user_certification_uuid}/verify`)}
                    certificate={certificateCardProps(c, fullName(user), date)}
                    subtitle={c.course?.name}
                    tag={t('certificate.kind_course')}
                    date={date}
                  />
                )
              })}
            </div>
          )}
          {pickedBadges.length > 0 && <UserBadgesGrid badges={pickedBadges} />}
        </div>
      )}
    </ProfileCard>
  )
}
