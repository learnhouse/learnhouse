'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'

export default function CohortRetention({ days = '90' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('cohort_retention', { days })
  const rows = data?.data ?? []

  const pct = (val: number, total: number) =>
    total > 0 ? `${Math.round((val / total) * 100)}%` : '—'

  const cellColor = (val: number, total: number) => {
    if (total === 0) return ''
    const p = val / total
    if (p >= 0.5) return 'bg-indigo-100 text-indigo-800'
    if (p >= 0.25) return 'bg-indigo-50 text-indigo-600'
    return 'text-gray-500'
  }

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px]">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Cohort Retention</h3>
      <p className="text-xs text-gray-400 mb-4">% users active after signup week</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 uppercase tracking-wider border-b border-gray-100">
                <th className="pb-2 text-left">Cohort</th>
                <th className="pb-2">Size</th>
                <th className="pb-2">W1</th>
                <th className="pb-2">W2</th>
                <th className="pb-2">W4</th>
                <th className="pb-2">W8</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr key={i} className="border-b border-gray-50 text-center">
                  <td className="py-1.5 text-left text-gray-600">{r.cohort_week?.slice(0, 10)}</td>
                  <td className="py-1.5 font-medium">{r.cohort_size}</td>
                  <td className={`py-1.5 ${cellColor(r.week_1, r.cohort_size)}`}>{pct(r.week_1, r.cohort_size)}</td>
                  <td className={`py-1.5 ${cellColor(r.week_2, r.cohort_size)}`}>{pct(r.week_2, r.cohort_size)}</td>
                  <td className={`py-1.5 ${cellColor(r.week_4, r.cohort_size)}`}>{pct(r.week_4, r.cohort_size)}</td>
                  <td className={`py-1.5 ${cellColor(r.week_8, r.cohort_size)}`}>{pct(r.week_8, r.cohort_size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
