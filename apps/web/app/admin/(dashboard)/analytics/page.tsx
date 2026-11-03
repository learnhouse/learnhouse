import React from 'react'
import AdminPageHeader from '@components/Admin/AdminPageHeader'
import type { Metadata } from 'next'
import GlobalAnalytics from '@components/Admin/GlobalAnalytics'

export const metadata: Metadata = {
  title: 'Analytics',
}

export default function AdminAnalyticsPage() {
  return (
    <div className="p-8">
      <AdminPageHeader titleKey="admin.pages.analytics" descriptionKey="admin.pages.analytics_desc" className="mb-8" />
      <GlobalAnalytics days={30} />
    </div>
  )
}
