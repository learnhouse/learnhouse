'use client'
import React from 'react'
import { Warning } from '@phosphor-icons/react'
import { Trans, useTranslation } from 'react-i18next'

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
 * means the feature does not exist on this deployment, which is permanent,
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
  const { t } = useTranslation()
  if (!error) return null
  if (isEERequiredError(error)) {
    return (
      <div className="rounded-2xl bg-sky-50 ring-1 ring-inset ring-sky-600/10 p-5">
        <div className="flex items-start gap-3">
          <Warning size={20} weight="fill" className="text-sky-600 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-sky-900">
              {t('admin.ee_error.required_title')}
            </div>
            <p className="text-sm text-sky-800 mt-1 leading-relaxed">
              {t('admin.ee_error.required_desc')}
            </p>
          </div>
        </div>
      </div>
    )
  }
  if (isEELicenseInactiveError(error)) {
    return (
      <div className="rounded-2xl bg-amber-50 ring-1 ring-inset ring-amber-600/10 p-5">
        <div className="flex items-start gap-3">
          <Warning size={20} weight="fill" className="text-amber-600 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-amber-900">
              {t('admin.ee_error.inactive_title')}
            </div>
            <p className="text-sm text-amber-800 mt-1 leading-relaxed">
              <Trans
                i18nKey="admin.ee_error.inactive_desc"
                values={{ reason: error.detail.reason }}
                components={{ code: <code className="font-mono" /> }}
              />
            </p>
            <details className="mt-3 text-xs text-amber-800">
              <summary className="cursor-pointer font-medium hover:text-amber-950 select-none">
                {t('admin.ee_error.what_to_check')}
              </summary>
              <ul className="mt-2 space-y-1 list-disc ps-4 leading-relaxed">
                {error.detail.diagnostics && (
                  <li>
                    <Trans
                      i18nKey="admin.ee_error.check_diagnostics"
                      values={{ path: error.detail.diagnostics }}
                      components={{ code: <code className="font-mono" /> }}
                    />
                  </li>
                )}
                <li>
                  <Trans
                    i18nKey="admin.ee_error.check_saas"
                    components={{ code: <code className="font-mono" /> }}
                  />
                </li>
                <li>
                  <Trans
                    i18nKey="admin.ee_error.check_self_hosted"
                    components={{ code: <code className="font-mono" /> }}
                  />
                </li>
                <li>
                  <Trans
                    i18nKey="admin.ee_error.check_logs"
                    components={{ code: <code className="font-mono" /> }}
                  />
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
    <div className="rounded-2xl bg-rose-50 ring-1 ring-inset ring-rose-600/10 p-5">
      <div className="flex items-start gap-3">
        <Warning size={20} weight="fill" className="text-rose-600 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-rose-900">{t('admin.ee_error.failed_to_load')}</div>
          <p className="text-sm text-rose-800 mt-1 leading-relaxed break-words">{msg}</p>
        </div>
      </div>
    </div>
  )
}
