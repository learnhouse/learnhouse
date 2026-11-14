'use client'
import React from 'react'
import { usePlatformMe } from '@components/Admin/hooks'
import { NoAccess } from '@components/Admin/Shared/AdminKit'
import UnifiedAuditView from '@components/Admin/Activity/UnifiedAuditView'

// The unified audit log (org + platform events), pre-filtered to this org.
export default function ActivitySection({ orgId }: { orgId: string }) {
  const me = usePlatformMe()
  if (!me.isLoading && !me.can('audit.read')) return <NoAccess />
  if (me.isLoading) return null
  return <UnifiedAuditView orgId={orgId} embedded />
}
