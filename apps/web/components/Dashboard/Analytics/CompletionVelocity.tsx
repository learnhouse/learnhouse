'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'
import { Lightning } from '@phosphor-icons/react'

function formatVelocity(hours: number): { value: string; unit: string } {
  if (hours < 1) {
    return { value: `${Math.round(hours * 60)}`, unit: 'minutes' }
  }
  if (hours < 48) {
    return { value: `${Math.round(hours * 10) / 10}`, unit: 'hours' }
  }
  const days = Math.round((hours / 24) * 10) / 10
  return { value: `${days}`, unit: 'days' }
}

export default function CompletionVelocity({ days = '90' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('completion_velocity', { days })
  const rows = data?.data ?? []

  // Calculate overall average across all courses
  const totalTransitions = rows.reduce((sum: number, r: any) => sum + (r.transitions || 0), 0)
  const weightedSum = rows.reduce(
    (sum: number, r: any) => sum + (r.avg_hours_between || 0) * (r.transitions || 0),
    0
  )
  const avgHours = totalTransitions > 0 ? weightedSum / totalTransitions : null
  const velocity = avgHours != null && totalTransitions >= 3 ? formatVelocity(avgHours) : null

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px]">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Completion Velocity</h3>
      <p className="text-xs text-gray-400 mb-4">Average time between activity completions</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : !velocity ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Not enough data yet</div>
      ) : (
        <div className="flex flex-col items-center justify-center h-48 gap-3">
          <div className="p-3 rounded-full bg-amber-50">
            <Lightning size={24} weight="fill" className="text-amber-500" />
          </div>
          <div className="text-center">
            <p className="text-4xl font-bold text-gray-900">{velocity.value}</p>
            <p className="text-sm text-gray-500 mt-1">avg {velocity.unit} between completions</p>
          </div>
          <p className="text-xs text-gray-400">
            Based on {totalTransitions} activity transitions
          </p>
        </div>
      )}
    </div>
  )
}
