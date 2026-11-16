'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter, useSearchParams } from 'next/navigation'
import { BookOpen, Buildings, ClockCounterClockwise, CreditCard, GearSix, Handshake, House, ListBullets, NotePencil, PaintBrush, SlidersHorizontal, Users } from '@phosphor-icons/react'
import { DashPage, EmptyState, Panel, Skeleton, SubTabPanel, SubTabs, useSubTab } from '@/design'
import { getDeploymentMode } from '@services/config/config'
import { usePlatformMe } from '@components/Admin/hooks'
import { AdminHeader, QueryError } from '@components/Admin/Shared/AdminKit'
import { PocActionDialog, type PocActionKind } from '@components/Admin/Pocs/PocActions'
import StartPocDialog from '@components/Admin/Pocs/StartPocDialog'
import { useOrgDetail, useOrgProfile } from './orgQueries'
import OrgHeader, { type HeaderAction } from './OrgHeader'
import OverviewSection from './sections/OverviewSection'
import { AnalyticsPanel, UsageMeters } from './sections/UsageSection'
import MembersSection from './sections/MembersSection'
import CoursesSection from './sections/CoursesSection'
import PlanSection from './sections/PlanSection'
import AICostsCard from './sections/AICostsCard'
import CrmConnectionsCard from './sections/CrmConnectionsCard'
import PocSection from './sections/PocSection'
import NotesSection from './sections/NotesSection'
import ActivitySection from './sections/ActivitySection'
import SettingsSection from './sections/SettingsSection'
import BrandingSection from './sections/BrandingSection'
import ConfigurationSection from './sections/ConfigurationSection'
import TimelineSection from './sections/TimelineSection'
import { PendingDeletionBanner } from './DeletionPanel'

const SECTIONS = ['overview', 'people', 'content', 'plan', 'branding', 'configuration', 'poc', 'notes', 'timeline', 'activity', 'settings'] as const
type Section = (typeof SECTIONS)[number]

// Older links (?tab=… or the round-2 section names) land on the new sections.
const LEGACY: Record<string, Section> = {
  users: 'people',
  members: 'people',
  courses: 'content',
  usage: 'content',
  analytics: 'content',
  features: 'plan',
}

export default function OrgDetailPage({ orgId }: { orgId: string }) {
  const { t } = useTranslation()
  const me = usePlatformMe()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isSaaS = getDeploymentMode() === 'saas'
  const [section, setSection] = useSubTab<Section>('overview', SECTIONS, { rememberAs: 'admin-org-detail' })
  const orgQ = useOrgDetail(orgId)
  const profileQ = useOrgProfile(orgId)
  const [startPoc, setStartPoc] = React.useState(false)
  const [pocAction, setPocAction] = React.useState<PocActionKind | null>(null)
  const [composeNote, setComposeNote] = React.useState(0)

  React.useEffect(() => {
    const legacy = searchParams?.get('section') ?? searchParams?.get('tab')
    if (legacy && LEGACY[legacy]) setSection(LEGACY[legacy])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const org = orgQ.data
  const profile = profileQ.data

  if (orgQ.isLoading) {
    return (
      <DashPage>
        <div className="pt-6 flex items-start gap-4">
          <Skeleton className="h-14 w-14 rounded-xl" />
          <div className="space-y-2.5 flex-1">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-5 w-72" />
          </div>
        </div>
        <Skeleton className="h-10 w-full max-w-2xl rounded-xl" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[68px] rounded-2xl" />
          ))}
        </div>
      </DashPage>
    )
  }

  if (orgQ.error || !org) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.org_detail.not_found')} crumbs={[{ label: t('admin.nav.organizations'), href: '/admin/organizations' }]} />
        {orgQ.error && (orgQ.error as { status?: number }).status !== 404 ? (
          <QueryError error={orgQ.error} onRetry={() => orgQ.refetch()} />
        ) : (
          <Panel>
            <EmptyState icon={<Buildings size={22} />} title={t('admin.org_detail.not_found')} description={t('admin.org.not_found_desc')} />
          </Panel>
        )}
      </DashPage>
    )
  }

  const onAction = (a: HeaderAction) => {
    switch (a) {
      case 'plan':
        setSection('plan')
        break
      case 'start_poc':
        setStartPoc(true)
        break
      case 'extend_poc':
        setPocAction('extend')
        break
      case 'reopen':
        setPocAction('reopen')
        break
      case 'note':
        setSection('notes')
        setComposeNote((n) => n + 1)
        break
      case 'members':
        setSection('people')
        break
      case 'activity':
        router.push(`/admin/activity?org_id=${org.id}`)
        break
    }
  }

  const pocTarget = {
    id: org.id,
    name: org.name,
    plan: org.plan,
    poc_plan: profile?.poc_plan,
    poc_previous_plan: profile?.poc_previous_plan,
    poc_ends_at: profile?.poc_ends_at,
    lifecycle: profile?.lifecycle,
  }

  const items = [
    { key: 'overview' as const, label: t('admin.org_detail.tabs.overview'), icon: <House size={15} /> },
    { key: 'people' as const, label: t('admin.org.tabs.people'), icon: <Users size={15} /> },
    { key: 'content' as const, label: t('admin.org.tabs.content'), icon: <BookOpen size={15} /> },
    { key: 'plan' as const, label: isSaaS ? t('admin.org.tabs.plan') : t('admin.org_detail.tabs.features'), icon: <CreditCard size={15} /> },
    { key: 'branding' as const, label: t('admin.org_cfg.tabs.branding'), icon: <PaintBrush size={15} /> },
    { key: 'configuration' as const, label: t('admin.org_cfg.tabs.configuration'), icon: <SlidersHorizontal size={15} /> },
    { key: 'poc' as const, label: t('admin.org.tabs.poc'), icon: <Handshake size={15} /> },
    { key: 'notes' as const, label: t('admin.org.tabs.notes'), icon: <NotePencil size={15} /> },
    { key: 'timeline' as const, label: t('admin.org.tabs.timeline'), icon: <ListBullets size={15} /> },
    { key: 'activity' as const, label: t('admin.org.tabs.activity'), icon: <ClockCounterClockwise size={15} />, hidden: !me.can('audit.read') },
    { key: 'settings' as const, label: t('common.settings'), icon: <GearSix size={15} /> },
  ]

  return (
    <DashPage bottom="xl">
      <OrgHeader org={org} orgId={orgId} profile={profile} isSaaS={isSaaS} onAction={onAction} />
      <PendingDeletionBanner orgId={org.id} profile={profile} />

      <SubTabs items={items} value={section} onChange={setSection} variant="pills" ariaLabel={t('admin.org.sections')}>
        <SubTabPanel tab="overview">
          <OverviewSection
            org={org}
            orgId={orgId}
            profile={profile}
            profileError={profileQ.error}
            onOpenSection={(s) => setSection(s as Section)}
            onExtendPoc={me.can('pocs.manage') ? () => setPocAction('extend') : undefined}
          />
        </SubTabPanel>
        <SubTabPanel tab="people" unmountWhenHidden>
          <MembersSection orgId={orgId} />
        </SubTabPanel>
        <SubTabPanel tab="content" unmountWhenHidden className="space-y-8">
          <CoursesSection orgId={orgId} orgUuid={org.org_uuid} orgSlug={org.slug} />
          <AnalyticsPanel orgId={orgId} />
        </SubTabPanel>
        <SubTabPanel tab="plan">
          <UsageMeters org={org} orgId={orgId} />
          <PlanSection orgId={orgId} org={org} isSaaS={isSaaS} />
          <div className="mt-8">
            <AICostsCard orgId={orgId} />
          </div>
          <div className="mt-8">
            <CrmConnectionsCard orgId={orgId} />
          </div>
        </SubTabPanel>
        <SubTabPanel tab="branding" unmountWhenHidden>
          <BrandingSection orgId={orgId} />
        </SubTabPanel>
        <SubTabPanel tab="configuration" unmountWhenHidden>
          <ConfigurationSection orgId={orgId} onOpenPlan={() => setSection('plan')} />
        </SubTabPanel>
        <SubTabPanel tab="poc">
          <PocSection org={org} orgId={orgId} profileQ={profileQ} />
        </SubTabPanel>
        <SubTabPanel tab="notes" unmountWhenHidden>
          <NotesSection orgId={orgId} focusComposer={composeNote} />
        </SubTabPanel>
        <SubTabPanel tab="timeline" unmountWhenHidden>
          <TimelineSection orgId={org.id} />
        </SubTabPanel>
        <SubTabPanel tab="activity" unmountWhenHidden>
          <ActivitySection orgId={orgId} />
        </SubTabPanel>
        <SubTabPanel tab="settings">
          <SettingsSection org={org} orgId={orgId} profileQ={profileQ} isSaaS={isSaaS} />
        </SubTabPanel>
      </SubTabs>

      <StartPocDialog
        open={startPoc}
        onOpenChange={setStartPoc}
        presetOrg={{ id: org.id, name: org.name, slug: org.slug, org_uuid: org.org_uuid, logo_image: org.logo_image, plan: org.plan }}
      />
      <PocActionDialog kind={pocAction} org={pocAction ? pocTarget : null} onClose={() => setPocAction(null)} />
    </DashPage>
  )
}
