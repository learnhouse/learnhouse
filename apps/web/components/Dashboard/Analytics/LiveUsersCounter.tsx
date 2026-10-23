'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { Broadcast } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

export default function LiveUsersCounter() {
  const { t } = useTranslation()
  const { data, isLoading } = useAnalyticsPipe('live_users', {}, 120000)
  const count = data?.data?.[0]?.live_users ?? 0

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 overflow-hidden min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <Broadcast className="text-green-500" size={16} weight="fill" />
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{t('dash.analytics.live_now')}</span>
      </div>
      <div className="text-3xl font-bold text-gray-900">
        {isLoading ? '…' : count}
      </div>
      <p className="text-xs text-gray-400 mt-1">{t('dash.analytics.active_last_5_min')}</p>
    </div>
  )
}
