'use client'
import React, { useState, useEffect, useCallback } from 'react'
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  RotateCcw,
  Loader2,
  ChevronLeft,
} from 'lucide-react'
import { getAPIUrl } from '@services/config/config'

interface Submission {
  id: string
  language_id: number
  source_code: string
  passed: boolean
  total_tests: number
  passed_tests: number
  execution_time_ms: number | null
  created_at: string
}

interface HistoryResponse {
  submissions: Submission[]
  total: number
  page: number
  limit: number
}

interface Props {
  activityUuid: string
  blockId: string
  accessToken: string
  onRestoreCode: (code: string) => void
}

export default function SubmissionHistory({
  activityUuid,
  blockId,
  accessToken,
  onRestoreCode,
}: Props) {
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const limit = 10

  const fetchHistory = useCallback(async () => {
    if (!activityUuid || !accessToken) return
    setLoading(true)
    setError(null)
    try {
      const url = `${getAPIUrl()}code/submissions/history?activity_uuid=${encodeURIComponent(activityUuid)}&block_id=${encodeURIComponent(blockId)}&page=${page}&limit=${limit}`
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = await resp.json()
      setData(json)
    } catch (err: any) {
      setError(err.message || 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [activityUuid, blockId, accessToken, page])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  if (!activityUuid) {
    return (
      <div className="text-sm text-neutral-400 text-center py-8">
        Submission history is not available in this context.
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-neutral-400" size={20} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-sm text-red-500 text-center py-8">
        {error}
        <button
          onClick={fetchHistory}
          className="ms-2 underline text-neutral-500 hover:text-neutral-700"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!data || data.submissions.length === 0) {
    return (
      <div className="text-sm text-neutral-400 text-center py-8">
        No submissions yet. Run your code to create a submission.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {data.submissions.map((sub) => {
        const isExpanded = expandedId === sub.id
        const date = new Date(sub.created_at)
        const dateStr = date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
        const timeStr = date.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        })

        return (
          <div
            key={sub.id}
            className="border border-neutral-200 rounded-lg bg-neutral-50/50 overflow-hidden"
          >
            {/* Header row */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : sub.id)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-start hover:bg-neutral-100/60 transition-colors"
            >
              {isExpanded ? (
                <ChevronDown size={14} className="text-neutral-400 shrink-0" />
              ) : (
                <ChevronRight size={14} className="text-neutral-400 shrink-0" />
              )}

              {sub.passed ? (
                <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
              ) : (
                <XCircle size={15} className="text-red-400 shrink-0" />
              )}

              <span className="text-xs font-semibold text-neutral-700">
                {sub.passed_tests}/{sub.total_tests} passed
              </span>

              {sub.execution_time_ms !== null && (
                <span className="flex items-center gap-0.5 text-[10px] text-neutral-400 ms-auto">
                  <Clock size={10} />
                  {sub.execution_time_ms}ms
                </span>
              )}

              <span className="text-[10px] text-neutral-400 ms-2 shrink-0">
                {dateStr} {timeStr}
              </span>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t border-neutral-200 bg-white">
                <pre className="text-xs font-mono p-3 overflow-x-auto max-h-[200px] overflow-y-auto bg-neutral-900 text-neutral-200 rounded-none">
                  {sub.source_code}
                </pre>
                <div className="flex justify-end p-2 border-t border-neutral-100">
                  <button
                    onClick={() => onRestoreCode(sub.source_code)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-800 bg-neutral-100 hover:bg-neutral-200 rounded-md transition-colors"
                  >
                    <RotateCcw size={12} />
                    Restore this code
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Pagination */}
      {data.total > limit && (() => {
        const totalPages = Math.ceil(data.total / limit)
        return (
          <div className="flex items-center justify-between pt-3">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} />
              Previous
            </button>
            <span className="text-[11px] text-neutral-400">
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-700 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight size={14} />
            </button>
          </div>
        )
      })()}
    </div>
  )
}
