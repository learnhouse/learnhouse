'use client'
import React, { use } from 'react'
import { useSelectedLayoutSegment } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import {
  ArrowUpRight,
  GraduationCap,
  House,
  Key,
  FlowArrow,
  Globe,
  MagnifyingGlass,
  Plug,
  ShieldCheck,
  Terminal,
} from '@phosphor-icons/react'
import { getUriWithOrg } from '@services/config/config'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import { DOCS } from '@components/Dashboard/Pages/Org/Developers/devKit'
import { PlanLevel, isFeatureAvailable } from '@services/plans/plans'

type LayoutParams = { orgslug: string }

// The header's docs button points at the page for the open tab.
const TAB_DOCS: Record<string, string> = {
  api: DOCS.apiOverview,
  mcp: DOCS.mcp,
  automations: DOCS.webhooks,
  domains: DOCS.domains,
  sso: DOCS.sso,
  lti: DOCS.lti,
}

interface TabConfig {
  id: string
  label: string
  icon: React.ReactNode
  requiredPlan?: PlanLevel
  title: string
  subtitle: string
}

const getDevTabs = (t: any): TabConfig[] => [
  {
    id: 'overview',
    label: t('dashboard.developers.tabs.overview'),
    icon: <House size={16} />,
    title: t('dashboard.developers.home.page_title'),
    subtitle: t('dashboard.developers.home.page_subtitle'),
  },
  {
    id: 'api',
    label: t('dashboard.organization.settings.tabs.api', { defaultValue: 'API Access' }),
    icon: <Key size={16} />,
    requiredPlan: 'pro',
    title: t('dashboard.organization.settings.pages.api.title', { defaultValue: 'API Access' }),
    subtitle: t('dashboard.organization.settings.pages.api.subtitle', { defaultValue: 'Manage API tokens and access' }),
  },
  {
    id: 'mcp',
    label: t('dashboard.organization.settings.tabs.mcp'),
    icon: <Plug size={16} />,
    title: t('dashboard.organization.settings.pages.mcp.title'),
    subtitle: t('dashboard.organization.settings.pages.mcp.subtitle'),
  },
  {
    id: 'automations',
    label: t('dashboard.organization.settings.tabs.automations', { defaultValue: 'Automations' }),
    icon: <FlowArrow size={16} />,
    requiredPlan: 'pro',
    title: t('dashboard.organization.settings.tabs.automations', { defaultValue: 'Automations' }),
    subtitle: t('dashboard.organization.automations.webhooks_subtitle', { defaultValue: 'Connect external services with webhooks' }),
  },
  {
    id: 'domains',
    label: t('dashboard.organization.settings.tabs.domains', { defaultValue: 'Domains' }),
    icon: <Globe size={16} />,
    requiredPlan: 'pro',
    title: t('dashboard.organization.settings.pages.domains.title', { defaultValue: 'Custom Domains' }),
    subtitle: t('dashboard.organization.settings.pages.domains.subtitle', { defaultValue: 'Configure custom domains for your organization' }),
  },
  {
    id: 'seo',
    label: 'SEO',
    icon: <MagnifyingGlass size={16} />,
    requiredPlan: 'standard',
    title: 'SEO',
    subtitle: t('dashboard.organization.settings.pages.seo.subtitle', { defaultValue: 'Manage search engine optimization settings' }),
  },
  {
    id: 'sso',
    label: t('dashboard.organization.settings.tabs.sso', { defaultValue: 'SSO' }),
    icon: <ShieldCheck size={16} />,
    requiredPlan: 'enterprise',
    title: t('dashboard.organization.settings.pages.sso.title', { defaultValue: 'Single Sign-On' }),
    subtitle: t('dashboard.organization.settings.pages.sso.subtitle', { defaultValue: 'Configure SSO for your organization' }),
  },
  {
    id: 'lti',
    label: t('lti.admin.tab'),
    icon: <GraduationCap size={16} />,
    requiredPlan: 'enterprise',
    title: t('lti.admin.page_title'),
    subtitle: t('lti.admin.page_subtitle'),
  },
]

// The header and tab bar live in a layout so switching tabs only swaps the
// body: the header stays mounted instead of flashing on every navigation.
export default function DevelopersLayout(props: { children: React.ReactNode; params: Promise<LayoutParams> }) {
  const { t } = useTranslation()
  const params = use(props.params)
  // null on /dash/developers itself, the subpage id below it.
  const segment = useSelectedLayoutSegment() ?? 'overview'
  const base = getUriWithOrg(params.orgslug, '') + '/dash/developers'

  // Hide tabs whose feature is unavailable in the current deployment mode. In
  // OSS this drops the enterprise-only SSO/LTI tabs (which would otherwise
  // render a dead "upgrade" card, since getUpgradeUrl() is null for OSS).
  // EE/SaaS keep all tabs; per-plan gating is handled by each page.
  const devTabs = getDevTabs(t).filter((tab) => tab.id === 'overview' || isFeatureAvailable(tab.id))
  const current = devTabs.find((tab) => tab.id === segment) ?? devTabs[0]

  const tabs: DashTabItem[] = devTabs.map((tab) => ({
    key: tab.id,
    label: tab.label,
    icon: tab.icon,
    href: tab.id === 'overview' ? base : `${base}/${tab.id}`,
    active: current.id === tab.id,
    requiresPlan: tab.requiredPlan,
  }))

  return (
    <div className="h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto_1fr] grid-cols-1 overflow-hidden">
      <header className="px-4 sm:px-10 bg-white nice-shadow z-10 relative min-w-0">
        <div className="pt-4 sm:pt-6 flex flex-col gap-4">
          <Breadcrumbs
            items={[
              {
                label: t('dashboard.developers.breadcrumb', { defaultValue: 'Developers' }),
                href: '/dash/developers',
                icon: <Terminal size={14} />,
              },
            ]}
          />
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900 truncate">{current.title}</h1>
              <p className="mt-1 text-sm text-neutral-500 truncate">{current.subtitle}</p>
            </div>
            {/* The overview hero carries its own docs links; SEO has no docs page. */}
            {TAB_DOCS[current.id] && (
            <a
              href={TAB_DOCS[current.id]}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass('secondary', 'md', 'max-sm:hidden')}
            >
              {t('dashboard.developers.docs_button')}
              <ArrowUpRight size={13} className="rtl:-scale-x-100" />
            </a>
            )}
          </div>
        </div>
        <DashTabBar className="mt-2 sm:mt-3 -mb-px" tabs={tabs} />
      </header>
      <div className="min-w-0 overflow-y-auto overflow-x-hidden">
        <div className="px-4 sm:px-10 pt-6 pb-10">{props.children}</div>
      </div>
    </div>
  )
}
