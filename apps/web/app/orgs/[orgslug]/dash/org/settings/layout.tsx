'use client'
import React, { use } from 'react'
import Image from 'next/image'
import { useSelectedLayoutSegment } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import {
  Buildings,
  ChartLine,
  Code,
  List,
  Palette,
  Plugs,
  SquaresFour,
  TextAlignLeft,
  Warning,
} from '@phosphor-icons/react'
import { getUriWithOrg } from '@services/config/config'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'
import type { PlanLevel } from '@services/plans/plans'
import { DEFAULT_SETTINGS_TAB, isMovedSubpage } from './settingsTabs'
import { isOrgAnalyticsAvailable } from '@ee/components/Analytics/availability'
import { isCrmAvailable } from '@ee/components/Integrations/availability'

type LayoutParams = { orgslug: string }

const P = 'dashboard.organization.settings.pages'
const T = 'dashboard.organization.settings.tabs'

// Header copy per tab. Keys already exist in the locales; the fallbacks are
// the inline English the old page used.
const TAB_COPY: Record<string, { title: string; subtitle: string; titleFallback?: string; subtitleFallback?: string }> = {
  overview: { title: `${P}.overview.title`, subtitle: `${P}.overview.subtitle` },
  general: { title: `${P}.general.title`, subtitle: `${P}.general.subtitle` },
  branding: { title: `${P}.branding.title`, subtitle: `${P}.branding.subtitle` },
  menu: {
    title: `${P}.menu.title`,
    subtitle: `${P}.menu.subtitle`,
    titleFallback: 'Public menu',
    subtitleFallback: 'Choose and order the links shown in your public navigation',
  },
  landing: { title: `${P}.landing.title`, subtitle: `${P}.landing.subtitle` },
  ai: {
    title: `${P}.ai.title`,
    subtitle: `${P}.ai.subtitle`,
    titleFallback: 'AI Features',
    subtitleFallback: 'Configure AI capabilities for your organization',
  },
  analytics: { title: `${P}.analytics.title`, subtitle: `${P}.analytics.subtitle` },
  integrations: { title: 'crm.page.title', subtitle: 'crm.page.subtitle' },
  other: { title: `${P}.other.title`, subtitle: `${P}.other.subtitle` },
  danger: {
    title: `${P}.danger.title`,
    subtitle: `${P}.danger.subtitle`,
    titleFallback: 'Danger Zone',
    subtitleFallback: 'Irreversible and destructive actions for this organization',
  },
}

// The header and tab bar live in a layout so switching tabs only swaps the
// body: the header stays mounted instead of flashing on every navigation.
export default function OrgSettingsLayout(props: { children: React.ReactNode; params: Promise<LayoutParams> }) {
  const { t } = useTranslation()
  const params = use(props.params)
  const segment = useSelectedLayoutSegment() ?? DEFAULT_SETTINGS_TAB

  // Legacy subpages redirect from the page; skip the header so it never flashes.
  if (isMovedSubpage(segment)) return <>{props.children}</>

  const copy = TAB_COPY[segment] ?? TAB_COPY[DEFAULT_SETTINGS_TAB]
  const base = getUriWithOrg(params.orgslug, '') + '/dash/org/settings'

  const tab = (key: string, label: string, icon: React.ReactNode, requiresPlan?: PlanLevel): DashTabItem => ({
    key,
    label,
    icon,
    href: `${base}/${key}`,
    active: segment === key,
    requiresPlan,
  })

  const tabs: DashTabItem[] = [
    tab('overview', t(`${T}.overview`), <SquaresFour size={16} />),
    tab('general', t(`${T}.general`), <TextAlignLeft size={16} />),
    tab('branding', t(`${T}.branding`), <Palette size={16} />),
    tab('menu', t(`${T}.menu`, { defaultValue: 'Menu' }), <List size={16} />),
    tab(
      'ai',
      t(`${T}.ai`, { defaultValue: 'AI' }),
      <Image src="/learnhouse_ai_simple_colored.png" alt="" width={16} height={16} />,
      'standard'
    ),
    // Analytics settings ship with Enterprise Edition; the tab is hidden without it.
    ...(isOrgAnalyticsAvailable() ? [tab('analytics', t(`${T}.analytics`), <ChartLine size={16} />)] : []),
    // CRM integrations (HubSpot on Pro, Salesforce on Enterprise) ship with EE.
    ...(isCrmAvailable() ? [tab('integrations', t('crm.page.tab'), <Plugs size={16} />, 'pro')] : []),
    tab('other', t(`${T}.other`), <Code size={16} />),
    tab('danger', t(`${T}.danger`, { defaultValue: 'Danger Zone' }), <Warning size={16} />),
  ]

  return (
    <div className="h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto_1fr] grid-cols-1 overflow-hidden">
      <header className="px-4 sm:px-10 bg-white nice-shadow z-10 relative min-w-0">
        <div className="pt-4 sm:pt-6 flex flex-col gap-4">
          <Breadcrumbs
            items={[{ label: t('common.organization'), href: `/dash/org/settings/${DEFAULT_SETTINGS_TAB}`, icon: <Buildings size={14} /> }]}
          />
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 truncate">
              {t(copy.title, copy.titleFallback ? { defaultValue: copy.titleFallback } : undefined)}
            </h1>
            <p className="mt-1 text-sm text-neutral-500 truncate">
              {t(copy.subtitle, copy.subtitleFallback ? { defaultValue: copy.subtitleFallback } : undefined)}
            </p>
          </div>
        </div>
        <DashTabBar className="mt-2 sm:mt-3 -mb-px" tabs={tabs} />
      </header>
      {/* The scroll container: StickySaveBar docks to its bottom edge. */}
      <div id="org-settings-scroll" className="min-w-0 overflow-y-auto overflow-x-hidden">
        {props.children}
      </div>
    </div>
  )
}
