'use client'
import React from 'react'
import { Warning } from '@phosphor-icons/react'

/** Shape of the FastAPI detail for a deactivated EE license. */
interface EELicenseDetail {
  error: 'ee_license_inactive'
  reason: string
  /** Path to the public diagnostics endpoint, sent by the API since 1.3.5. */
  diagnostics?: string
}

/**
 * Detect the deactivated-EE-license error thrown by `apiFetch` / `errorHandling`.
 * The thrown Error carries `.status` (number) and `.detail` (the raw response body).
 */
export function isEELicenseInactiveError(err: unknown): err is { status: 503; detail: EELicenseDetail } {
  if (!err || typeof err !== 'object') return false
  const e = err as { status?: unknown; detail?: unknown }
  if (e.status !== 503) return false
  const d = e.detail
  return (
    !!d &&
    typeof d === 'object' &&
    (d as { error?: unknown }).error === 'ee_license_inactive'
  )
}

/** Shape of the FastAPI detail for a surface that only exists in EE. */
interface EERequiredDetail {
  error: 'ee_required'
  feature: string
  message: string
}

/**
 * Detect the Enterprise-only 403 raised by
 * `apps/api/src/security/superadmin.py::ensure_ee_superadmin_surface`.
 *
 * Distinct from `isEELicenseInactiveError` (503): that one means EE is
 * installed but its license check is failing, which is transient. This one
 * means the feature does not exist on this deployment, which is permanent —
 * so it must not be presented as something to retry or reconfigure.
 */
export function isEERequiredError(err: unknown): err is { status: 403; detail: EERequiredDetail } {
  if (!err || typeof err !== 'object') return false
  const e = err as { status?: unknown; detail?: unknown }
  if (e.status !== 403) return false
  const d = e.detail
  return (
    !!d &&
    typeof d === 'object' &&
    (d as { error?: unknown }).error === 'ee_required'
  )
}

/**
 * Render a clear banner when an EE-gated endpoint returns 503 with the
 * `ee_license_inactive` detail, or 403 with `ee_required`. Falls back to a
 * generic error banner for any other thrown error. Returns null when there's
 * no error to show.
 */
export default function EELicenseError({ error }: { error: unknown }) {
  if (!error) return null
  if (isEERequiredError(error)) {
    return (
      <div className="rounded-2xl border border-sky-400/20 bg-sky-400/[0.06] p-5 my-4">
        <div className="flex items-start gap-3">
          <Warning size={20} weight="fill" className="text-sky-300 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-sky-200">
              Enterprise Edition license required
            </div>
            <p className="text-xs text-sky-200/80 mt-1.5 leading-relaxed">
              This endpoint is part of LearnHouse Enterprise Edition and is not
              available on this deployment.
            </p>
          </div>
        </div>
      </div>
    )
  }
  if (isEELicenseInactiveError(error)) {
    return (
      <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-5 my-4">
        <div className="flex items-start gap-3">
          <Warning size={20} weight="fill" className="text-amber-300 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-amber-200">
              Enterprise features are currently unavailable
            </div>
            <p className="text-xs text-amber-200/80 mt-1.5 leading-relaxed">
              The EE license check failed (<code className="font-mono">{error.detail.reason}</code>).
              Every <code className="font-mono">/ee/*</code> endpoint is returning 503, so this
              page can't load its data.
            </p>
            <details className="mt-3 text-xs text-amber-200/70">
              <summary className="cursor-pointer hover:text-amber-200 select-none">
                What to check
              </summary>
              <ul className="mt-2 space-y-1 list-disc list-inside leading-relaxed">
                {error.detail.diagnostics && (
                  <li>
                    Open{' '}
                    <code className="font-mono">{error.detail.diagnostics}</code> — it
                    answers even while the license is inactive, and its{' '}
                    <code className="font-mono">hint</code> field names the fix.
                  </li>
                )}
                <li>
                  For SaaS deployments: confirm{' '}
                  <code className="font-mono">LEARNHOUSE_SAAS=true</code> is set in the API
                  environment. SaaS short-circuits the license check.
                </li>
                <li>
                  For self-hosted EE: confirm{' '}
                  <code className="font-mono">LEARNHOUSE_LICENSE_KEY</code> is set and the
                  license server (or grace window) is reachable.
                </li>
                <li>
                  If you have shell access, the API logs carry the same reason
                  with full detail: <code className="font-mono">[EE] license inactive …</code>
                </li>
              </ul>
            </details>
          </div>
        </div>
      </div>
    )
  }

  // Generic error fallback
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <div className="rounded-2xl border border-red-400/20 bg-red-400/[0.06] p-5 my-4">
      <div className="flex items-start gap-3">
        <Warning size={20} weight="fill" className="text-red-300 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-red-200">Failed to load</div>
          <p className="text-xs text-red-200/80 mt-1 leading-relaxed break-words">{msg}</p>
        </div>
      </div>
    </div>
  )
}
