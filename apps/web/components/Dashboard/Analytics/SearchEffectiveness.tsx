'use client'
import React from 'react'
import { useAnalyticsPipe } from './useAnalyticsDashboard'

export default function SearchEffectiveness({ days = '30' }: { days?: string }) {
  const { data, isLoading } = useAnalyticsPipe('search_effectiveness', { days })
  const rows = data?.data ?? []

  return (
    <div className="bg-white rounded-xl nice-shadow p-5 min-h-[300px] overflow-hidden min-w-0">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Search Effectiveness</h3>
      <p className="text-xs text-gray-400 mb-4">Top queries and zero-result rate</p>
      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-gray-300">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-300">No data yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-gray-400 text-xs uppercase tracking-wider border-b border-gray-100">
                <th className="pb-2">Query</th>
                <th className="pb-2 text-end">Searches</th>
                <th className="pb-2 text-end">Zero Results %</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 15).map((r: any, i: number) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1.5 text-gray-700 truncate max-w-[200px]">{r.query}</td>
                  <td className="py-1.5 text-end text-gray-500">{r.search_count}</td>
                  <td className="py-1.5 text-end text-gray-500">{r.zero_result_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
