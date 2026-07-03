import React, { useEffect, useState, useCallback } from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getAPIUrl } from '@services/config/config'
import { RefreshCw, AlertCircle, CheckCircle2, Circle, Clock, Award } from 'lucide-react'

/**
 * Instructor-facing SCORM results table for one activity.
 *
 * Consumes GET /scorm/{activity_uuid}/results (course-management permission
 * required server-side). Drop this into the instructor's activity view, e.g.:
 *   <ScormResults activityUuid={activity.activity_uuid} />
 */

interface ScormResult {
  user_uuid: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  completion_status: string
  success_status: string
  score_raw?: number | null
  score_scaled?: number | null
  total_time: string
  update_date: string
}

const DONE = new Set(['completed', 'passed'])

function StatusPill({ status }: { status: string }) {
  const done = DONE.has(status)
  const Icon = done ? CheckCircle2 : Circle
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${
        done
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
          : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
      }`}
    >
      <Icon size={12} />
      {status.replace(/_/g, ' ')}
    </span>
  )
}

/** Render an ISO-8601 duration (PT#H#M#S) as a compact "1h 2m" label. */
function humanizeDuration(iso: string): string {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '')
  if (!m) return iso || '—'
  const [h, min, s] = [m[1], m[2], m[3]].map((v) => parseInt(v || '0', 10))
  const parts: string[] = []
  if (h) parts.push(`${h}h`)
  if (min) parts.push(`${min}m`)
  if (s && !h) parts.push(`${s}s`)
  return parts.length ? parts.join(' ') : '0s'
}

function ScormResults({ activityUuid }: { activityUuid: string }) {
  const session = useLHSession() as any
  const token = session?.data?.tokens?.access_token
  const [rows, setRows] = useState<ScormResult[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token || !activityUuid) return
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${getAPIUrl()}scorm/${activityUuid}/results`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        throw new Error(
          res.status === 403
            ? 'You need course management access to view SCORM results.'
            : `Failed to load results (${res.status})`,
        )
      }
      setRows(await res.json())
    } catch (e: any) {
      setError(e.message || 'Failed to load results')
    } finally {
      setIsLoading(false)
    }
  }, [token, activityUuid])

  useEffect(() => {
    load()
  }, [load])

  const name = (r: ScormResult) =>
    [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || r.email || r.user_uuid

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
          <Award size={15} className="text-neutral-400" />
          Learner results
          {!isLoading && !error && (
            <span className="text-xs font-normal text-neutral-400">({rows.length})</span>
          )}
        </h3>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors"
        >
          <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm">
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      {!error && isLoading && (
        <div role="status" className="py-8 text-center text-sm text-neutral-400">Loading results…</div>
      )}

      {!error && !isLoading && rows.length === 0 && (
        <div className="py-8 text-center text-sm text-neutral-400">No learners have started this activity yet.</div>
      )}

      {!error && !isLoading && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
                <th className="px-3 py-2 font-medium">Learner</th>
                <th className="px-3 py-2 font-medium">Completion</th>
                <th className="px-3 py-2 font-medium">Success</th>
                <th className="px-3 py-2 font-medium">Score</th>
                <th className="px-3 py-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_uuid} className="border-b last:border-0 border-neutral-100 dark:border-neutral-800/60">
                  <td className="px-3 py-2">
                    <div className="font-medium text-neutral-900 dark:text-white">{name(r)}</div>
                    {r.email && <div className="text-xs text-neutral-400">{r.email}</div>}
                  </td>
                  <td className="px-3 py-2"><StatusPill status={r.completion_status} /></td>
                  <td className="px-3 py-2"><StatusPill status={r.success_status} /></td>
                  <td className="px-3 py-2 text-neutral-700 dark:text-neutral-300">
                    {r.score_raw != null
                      ? r.score_raw
                      : r.score_scaled != null
                        ? `${Math.round(r.score_scaled * 100)}%`
                        : '—'}
                  </td>
                  <td className="px-3 py-2 text-neutral-500 dark:text-neutral-400">
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} />
                      {humanizeDuration(r.total_time)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default ScormResults
