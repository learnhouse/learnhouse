'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, ListChecks, PaperPlaneTilt, Plugs, SlidersHorizontal } from '@phosphor-icons/react'
import { DashPage, SubTabPanel, SubTabs } from '@/design'
import { usePlatformMe } from '@components/Admin/hooks'
import { AdminHeader, CopyLinkButton, NoAccess } from '@components/Admin/Shared/AdminKit'
import { useUrlTab } from '@components/Admin/Shared/OpsKit'
import InboxTab from './InboxTab'
import ChannelsTab from './ChannelsTab'
import RulesTab from './RulesTab'
import DeliveriesTab from './DeliveriesTab'
import PreferencesTab from './PreferencesTab'

// /admin/notifications (§9): the inbox and personal preferences for everyone
// on the team; channels, rules and the delivery log for notifications.manage.
// The tab, its filters and any open dialog/drawer live in the URL.

const TABS = ['inbox', 'channels', 'rules', 'deliveries', 'preferences'] as const
type Tab = (typeof TABS)[number]

// Params a tab owns; switching tabs drops them so links stay clean.
const TAB_PARAMS = [
  'page',
  'unread',
  'event_key',
  'channel',
  'rule',
  'delivery',
  'status',
  'channel_uuid',
  'rule_uuid',
  'event',
  'org_id',
  'org_plan',
  'since',
  'until',
]

export default function NotificationsPage() {
  const { t } = useTranslation()
  const me = usePlatformMe()
  const [tab, setTab, values, setValues] = useUrlTab<Tab>(TABS, 'inbox', TAB_PARAMS)
  const canManage = me.can('notifications.manage')
  const managed = tab === 'channels' || tab === 'rules' || tab === 'deliveries'
  const current: Tab = managed && !canManage && !me.isLoading ? 'inbox' : tab

  if (!me.isLoading && !me.can('platform.read')) {
    return (
      <DashPage>
        <AdminHeader title={t('admin.notifications.title')} />
        <NoAccess />
      </DashPage>
    )
  }

  const items = [
    { key: 'inbox' as const, label: t('admin.notifications.tabs.inbox'), icon: <Bell size={15} /> },
    { key: 'channels' as const, label: t('admin.notifications.tabs.channels'), icon: <Plugs size={15} />, hidden: !canManage },
    { key: 'rules' as const, label: t('admin.notifications.tabs.rules'), icon: <ListChecks size={15} />, hidden: !canManage },
    { key: 'deliveries' as const, label: t('admin.notifications.tabs.deliveries'), icon: <PaperPlaneTilt size={15} />, hidden: !canManage },
    { key: 'preferences' as const, label: t('admin.notifications.tabs.preferences'), icon: <SlidersHorizontal size={15} /> },
  ]

  return (
    <DashPage>
      <AdminHeader title={t('admin.notifications.title')} subtitle={t('admin.notifications.subtitle')} actions={<CopyLinkButton />} />
      <SubTabs items={items} value={current} onChange={setTab} variant="pills" ariaLabel={t('admin.notifications.tabs_label')}>
        <SubTabPanel tab="inbox" unmountWhenHidden>
          <InboxTab values={values} setValues={setValues} />
        </SubTabPanel>
        {canManage && (
          <>
            <SubTabPanel tab="channels" unmountWhenHidden>
              <ChannelsTab values={values} setValues={setValues} />
            </SubTabPanel>
            <SubTabPanel tab="rules" unmountWhenHidden>
              <RulesTab values={values} setValues={setValues} />
            </SubTabPanel>
            <SubTabPanel tab="deliveries" unmountWhenHidden>
              <DeliveriesTab values={values} setValues={setValues} />
            </SubTabPanel>
          </>
        )}
        <SubTabPanel tab="preferences" unmountWhenHidden>
          <PreferencesTab />
        </SubTabPanel>
      </SubTabs>
    </DashPage>
  )
}
