'use client'

import React from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, Tray, UsersThree } from '@phosphor-icons/react'
import { DashPage, DashPageHeader, SubTabPanel, SubTabs, useSubTab } from '@/design'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import NotificationsCenter from '@components/Notifications/NotificationsCenter'
import OrgRoutingPanel from '@components/Notifications/OrgRoutingPanel'

const TABS = ['inbox', 'routing'] as const

/** Dashboard → Notifications: the needs-attention inbox, and (admins) who is notified of what. */
export default function DashNotificationsPage() {
  const { t } = useTranslation()
  const { canManageOrg, rights } = useAdminStatus() as any
  const canRoute = canManageOrg || !!rights?.organizations?.action_update
  const [tab, setTab] = useSubTab('inbox', TABS)

  return (
    <DashPage bottom="xl">
      <DashPageHeader
        breadcrumbs={[{ label: t('notifications.admin_title'), href: '/dash/notifications', icon: <Bell size={14} /> }]}
        title={t('notifications.admin_title')}
        subtitle={t('notifications.admin_subtitle')}
      />
      {canRoute ? (
        <SubTabs
          ariaLabel={t('notifications.admin_title')}
          idPrefix="dash-notifications"
          value={tab}
          onChange={setTab}
          items={[
            { key: 'inbox', label: t('notifications.tabs.inbox'), icon: <Tray size={15} /> },
            { key: 'routing', label: t('notifications.routing.short'), icon: <UsersThree size={15} /> },
          ]}
        >
          <SubTabPanel tab="inbox">
            <NotificationsCenter audience="admin" />
          </SubTabPanel>
          <SubTabPanel tab="routing">
            <OrgRoutingPanel />
          </SubTabPanel>
        </SubTabs>
      ) : (
        <NotificationsCenter audience="admin" />
      )}
    </DashPage>
  )
}
