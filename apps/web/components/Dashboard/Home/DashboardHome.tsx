'use client'
import React from 'react'
import Link from 'next/link'
import { Plus, ChartBar, GearSix, Users, House } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { usePlan } from '@components/Hooks/usePlan'
import { BTN_GHOST, BTN_PRIMARY, DashPageHeader } from '@components/Dashboard/Shared/DashKit/DashKit'
import OnboardingHomeCard from '@components/Dashboard/Onboarding/OnboardingHomeCard'
import WelcomeTourCard from '@components/Dashboard/Onboarding/WelcomeTourCard'
import QuickStats from '@ee/components/Analytics/Home/QuickStats'
import { isOrgAnalyticsAvailable } from '@ee/components/Analytics/availability'
import RecentCourses from './RecentCourses'
import RecentMembers from './RecentMembers'
import WebsiteCard from './WebsiteCard'
import ContentOverview from './ContentOverview'
import UsageOverview, { FeaturesCard } from './UsageOverview'
import { PlanChip } from './homeKit'
import { AICreditsBalanceNotice } from '@components/Objects/AI/CreditCost'

export default function DashboardHome() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any
  const plan = usePlan()

  // The first name's first word; never a username with digits (accounts made
  // on the platform page get a generated one), else just "Welcome back".
  const user = session?.data?.user
  const firstName = String(user?.first_name || '').trim().split(/\s+/)[0]
  const handle = String(user?.username || '')
  const username = firstName || (/^[\p{L}]+$/u.test(handle) ? handle : '')

  return (
    <div className="relative isolate flex w-full">
      {/* Header backdrop: the same fine dot grid as the sidebar footer, fading
          out below the welcome header. Decorative; sits under the content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80 -z-10"
        style={{
          backgroundImage: 'radial-gradient(rgba(0,0,0,0.13) 1px, transparent 1.2px)',
          backgroundSize: '14px 14px',
          backgroundPosition: 'center top',
          maskImage: 'radial-gradient(110% 100% at 50% 0%, black 0%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(110% 100% at 50% 0%, black 0%, transparent 70%)',
        }}
      />
      <div className="px-4 sm:px-10 pb-10 flex flex-col gap-5 w-full min-w-0">
        <DashPageHeader
          breadcrumbs={[{ label: t('common.home'), href: '/dash', icon: <House size={14} /> }]}
          title={
            <span dir="auto">
              {t('dashboard.home.welcome_back')}
              {username ? `, ${username}` : ''}
            </span>
          }
          subtitle={
            <span className="inline-flex flex-wrap items-center gap-2">
              <PlanChip plan={plan} withSuffix />
              {org?.name && <span dir="auto">{org.name}</span>}
            </span>
          }
          actions={
            <>
              {isOrgAnalyticsAvailable() && (
                <Link href="/dash/analytics" className={BTN_GHOST}>
                  <ChartBar size={16} />
                  {t('dashboard.home.analytics')}
                </Link>
              )}
              <Link href="/dash/users/settings/users" className={BTN_GHOST}>
                <Users size={16} />
                {t('dashboard.home.members')}
              </Link>
              <Link href="/dash/org/settings/overview" className={BTN_GHOST}>
                <GearSix size={16} />
                {t('dashboard.home.settings')}
              </Link>
              <Link href="/dash/courses?new=true" className={BTN_PRIMARY}>
                <Plus size={16} weight="bold" />
                {t('dashboard.home.create_course')}
              </Link>
            </>
          }
        />
        <AdminAuthorization authorizationMode="component">
          <AICreditsBalanceNotice />
        </AdminAuthorization>

        <AdminAuthorization authorizationMode="component">
          <div className="flex flex-col gap-5">
            {/* First run: the welcome tour, then the launch plan until setup is done */}
            <WelcomeTourCard />
            <OnboardingHomeCard />

            <ContentOverview />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
              <div className="lg:col-span-2 flex flex-col gap-5 min-w-0">
                <RecentCourses />
                <RecentMembers />
              </div>
              <div className="flex flex-col gap-5 min-w-0">
                <WebsiteCard />
                <UsageOverview />
                {isOrgAnalyticsAvailable() && <QuickStats />}
                <FeaturesCard />
              </div>
            </div>
          </div>
        </AdminAuthorization>
      </div>
    </div>
  )
}
