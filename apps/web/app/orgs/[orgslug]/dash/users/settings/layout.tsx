'use client'
import React, { use } from 'react'
import { useSelectedLayoutSegment } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import {
  ArrowsClockwise,
  ClipboardText,
  Key,
  ScanSmiley,
  Shield,
  ShieldCheck,
  UserPlus,
  Users,
  UsersThree,
} from '@phosphor-icons/react'
import { getUriWithOrg } from '@services/config/config'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'
import type { PlanLevel } from '@services/plans/plans'

type LayoutParams = { orgslug: string }

// Header copy per tab. The keys already exist in the locales; the security
// tabs keep their inline English fallbacks as before.
const TAB_COPY: Record<string, { title: string; subtitle: string; titleFallback?: string; subtitleFallback?: string }> = {
  users: { title: 'dashboard.users.settings.pages.users.title', subtitle: 'dashboard.users.settings.pages.users.subtitle' },
  usergroups: {
    title: 'dashboard.users.settings.pages.usergroups.title',
    subtitle: 'dashboard.users.settings.pages.usergroups.subtitle',
  },
  roles: { title: 'dashboard.users.settings.pages.roles.title', subtitle: 'dashboard.users.settings.pages.roles.subtitle' },
  signups: { title: 'dashboard.users.settings.pages.signups.title', subtitle: 'dashboard.users.settings.pages.signups.subtitle' },
  add: { title: 'dashboard.users.settings.pages.add.title', subtitle: 'dashboard.users.settings.pages.add.subtitle' },
  'audit-logs': {
    title: 'dashboard.users.settings.pages.audit_logs.title',
    subtitle: 'dashboard.users.settings.pages.audit_logs.subtitle',
  },
  'sign-in': {
    title: 'dashboard.users.settings.pages.sign_in.title',
    subtitle: 'dashboard.users.settings.pages.sign_in.subtitle',
    titleFallback: 'Sign-in',
    subtitleFallback: 'Choose how members are allowed to sign in to this organization',
  },
  provisioning: { title: 'hr.scim.page_title', subtitle: 'hr.scim.page_subtitle' },
  'two-factor': {
    title: 'dashboard.users.settings.pages.two_factor.title',
    subtitle: 'dashboard.users.settings.pages.two_factor.subtitle',
    titleFallback: 'Two-factor',
    subtitleFallback: 'Require two-factor authentication for members of this organization',
  },
}

// The header and tab bar live in a layout so switching tabs only swaps the
// body: the header stays mounted instead of flashing on every navigation.
export default function UsersSettingsLayout(props: { children: React.ReactNode; params: Promise<LayoutParams> }) {
  const { t } = useTranslation()
  const params = use(props.params)
  const segment = useSelectedLayoutSegment() ?? 'users'
  const copy = TAB_COPY[segment] ?? TAB_COPY.users
  const base = getUriWithOrg(params.orgslug, '') + '/dash/users/settings'

  const tab = (
    key: string,
    label: string,
    icon: React.ReactNode,
    requiresPlan?: PlanLevel
  ): DashTabItem => ({ key, label, icon, href: `${base}/${key}`, active: segment === key, requiresPlan })

  const tabs: DashTabItem[] = [
    tab('users', t('dashboard.users.settings.tabs.users'), <Users size={16} />),
    tab('usergroups', t('dashboard.users.settings.tabs.usergroups'), <UsersThree size={16} />, 'standard'),
    tab('roles', t('dashboard.users.settings.tabs.roles'), <Shield size={16} />, 'pro'),
    tab('signups', t('dashboard.users.settings.tabs.signups'), <ScanSmiley size={16} />),
    tab('add', t('dashboard.users.settings.tabs.add'), <UserPlus size={16} />),
    tab('sign-in', t('dashboard.users.settings.tabs.sign_in', { defaultValue: 'Sign-in' }), <Key size={16} />),
    tab('provisioning', t('hr.scim.tab'), <ArrowsClockwise size={16} />, 'enterprise'),
    tab('two-factor', t('dashboard.users.settings.tabs.two_factor', { defaultValue: 'Two-factor' }), <ShieldCheck size={16} />),
    tab('audit-logs', t('dashboard.users.settings.tabs.audit_logs'), <ClipboardText size={16} />, 'enterprise'),
  ]

  return (
    <div className="h-screen w-full bg-[#f8f8f8] grid grid-rows-[auto_1fr] grid-cols-1 overflow-hidden">
      <header className="px-4 sm:px-10 bg-white nice-shadow z-10 relative min-w-0">
        <div className="pt-4 sm:pt-6 flex flex-col gap-4">
          <Breadcrumbs
            items={[{ label: t('common.users'), href: '/dash/users/settings/users', icon: <Users size={14} /> }]}
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
      <div className="min-w-0 overflow-y-auto overflow-x-hidden">{props.children}</div>
    </div>
  )
}
