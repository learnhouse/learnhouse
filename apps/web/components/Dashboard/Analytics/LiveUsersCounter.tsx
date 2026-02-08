'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { Radio } from 'lucide-react'

export default function LiveUsersCounter() {
  const { data, isLoading } = useAnalyticsPipe('live_users', {}, 30000)
  const count = data?.data?.[0]?.live_users ?? 0

  return (
    <div className="bg-white rounded-xl nice-shadow p-5">
      <div className="flex items-center gap-2 mb-1">
        <Radio className="text-green-500" size={16} />
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Live Now</span>
      </div>
      <div className="text-3xl font-bold text-gray-900">
        {isLoading ? '—' : count}
      </div>
      <p className="text-xs text-gray-400 mt-1">Active users in last 5 minutes</p>
    </div>
  )
}
