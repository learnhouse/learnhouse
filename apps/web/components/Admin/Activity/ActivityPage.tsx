'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { DashPage } from '@/design'
import { usePlatformMe } from '@components/Admin/hooks'
import { AdminHeader, NoAccess } from '@components/Admin/Shared/AdminKit'
import UnifiedAuditView from './UnifiedAuditView'

// The platform audit log: every organization's audit events merged with the
// platform team's own (console, API tokens, MCP, automations).
export default function ActivityPage() {
  const { t } = useTranslation()
  const me = usePlatformMe()
  return (
    <DashPage bottom="lg">
      <AdminHeader title={t('admin.audit.title')} subtitle={t('admin.audit.subtitle')} />
      {!me.isLoading && !me.can('audit.read') ? <NoAccess /> : <UnifiedAuditView />}
    </DashPage>
  )
}
