'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { updatePassword } from '@services/settings/password'
import { Formik, Form } from 'formik'
import React from 'react'
import {
  AlertTriangle,
  Monitor,
  LogOut,
  ShieldCheck,
  ShieldOff,
  ShieldAlert,
  KeyRound,
  Copy,
  Check,
  Download,
  RefreshCw,
  Loader2,
  Smartphone,
} from 'lucide-react'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { Input } from "@components/ui/input"
import { Button } from "@components/ui/button"
import { Label } from "@components/ui/label"
import { Checkbox } from "@components/ui/checkbox"
import { toast } from 'react-hot-toast'
import { signOut } from '@components/Contexts/AuthContext'
import { getUriWithoutOrg, getAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader, getResponseMetadata } from '@services/utils/ts/requests'
import * as Yup from 'yup'
import { useTranslation } from 'react-i18next'
import AccountDangerZone from '@components/Objects/Account/subpages/AccountDangerZone'

const validationSchema = Yup.object().shape({
  old_password: Yup.string().required('validation.required'),
  new_password: Yup.string()
    .required('validation.required')
    .min(8, 'validation.password_min_length'),
})

// ---------------------------------------------------------------------------
// Two-factor authentication (TOTP)
// ---------------------------------------------------------------------------

type MfaStatus = {
  enabled: boolean
  confirmed_at: string | null
  backup_codes_remaining: number
  // Accounts created through SSO/OAuth have no password, so the backend does
  // not require (and rejects) one on setup/disable. Drives whether we render
  // the password step at all.
  has_password: boolean
}

// The enrolment wizard runs INSIDE the section (no route change):
//   password → scan → verify → codes
// `password` is skipped entirely when the account has no password.
type EnrollStep = 'password' | 'scan' | 'verify' | 'codes'

const BACKUP_CODES_LOW_THRESHOLD = 3

function TwoFactorAuthSection() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const [status, setStatus] = React.useState<MfaStatus | null>(null)
  const [statusLoading, setStatusLoading] = React.useState(true)
  const [statusError, setStatusError] = React.useState<string | null>(null)

  // Enrolment wizard
  const [step, setStep] = React.useState<EnrollStep | null>(null)
  const [password, setPassword] = React.useState('')
  const [secret, setSecret] = React.useState('')
  const [provisioningUri, setProvisioningUri] = React.useState('')
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null)
  const [qrFailed, setQrFailed] = React.useState(false)
  const [code, setCode] = React.useState('')
  const [backupCodes, setBackupCodes] = React.useState<string[]>([])
  const [codesAcknowledged, setCodesAcknowledged] = React.useState(false)

  // Managing an already-enabled factor
  const [panel, setPanel] = React.useState<'disable' | 'regenerate' | null>(null)

  // A single in-flight flag guards EVERY mutating call in this section, which
  // is what makes double-submits impossible (Enter key + click, double click…).
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [retryAfter, setRetryAfter] = React.useState(0)
  const [copied, setCopied] = React.useState<'secret' | 'codes' | null>(null)

  // 429 cooldown: tick down so the button stays disabled and the user can see
  // exactly how long they have to wait.
  React.useEffect(() => {
    if (retryAfter <= 0) return
    const id = setTimeout(() => setRetryAfter((s) => Math.max(0, s - 1)), 1000)
    return () => clearTimeout(id)
  }, [retryAfter])

  React.useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(id)
  }, [copied])

  // Same call shape the change-password form uses (getAPIUrl() +
  // RequestBodyWithAuthHeader + getResponseMetadata). Deliberately NOT apiFetch:
  // its errorHandling() turns a 401 into a global "session expired" event, and
  // /mfa/setup answers a wrong password with a 401 — which would sign the user
  // out mid-enrolment.
  const mfaFetch = React.useCallback(
    async (path: string, method: 'GET' | 'POST', body?: any) => {
      const result = await fetch(
        `${getAPIUrl()}auth/mfa${path}`,
        RequestBodyWithAuthHeader(method, body ?? null, null, access_token)
      )
      return getResponseMetadata(result)
    },
    [access_token]
  )

  // Surface the backend `detail.message` verbatim — those strings are already
  // written for end users — and turn a 429 into a visible cooldown.
  const readError = React.useCallback(
    (res: { data: any; status: number }, fallback: string): string => {
      const detail = res?.data?.detail
      if (res?.status === 429) {
        const seconds = Number(detail?.retry_after)
        if (Number.isFinite(seconds) && seconds > 0) setRetryAfter(Math.ceil(seconds))
        return getErrorMessage(
          detail,
          t('user.settings.security.mfa.rate_limited', {
            defaultValue: 'Too many attempts. Please wait a moment and try again.',
          })
        )
      }
      return getErrorMessage(detail, fallback)
    },
    [t]
  )

  const loadStatus = React.useCallback(async () => {
    if (!access_token) return
    try {
      const res = await mfaFetch('/status', 'GET')
      if (res.success) {
        setStatus(res.data as MfaStatus)
        setStatusError(null)
      } else {
        setStatusError(
          getErrorMessage(
            res.data?.detail,
            t('user.settings.security.mfa.status_error', {
              defaultValue: 'Could not load your two-factor settings.',
            })
          )
        )
      }
    } catch {
      setStatusError(
        t('user.settings.security.mfa.status_error', {
          defaultValue: 'Could not load your two-factor settings.',
        })
      )
    } finally {
      setStatusLoading(false)
    }
  }, [access_token, mfaFetch, t])

  React.useEffect(() => {
    loadStatus()
  }, [loadStatus])

  // Render the QR locally (the `qrcode` package) instead of an image service —
  // the secret must never leave the page, and the CSP blocks third-party images
  // anyway. Imported lazily so it stays out of the settings page bundle.
  React.useEffect(() => {
    if (step !== 'scan' || !provisioningUri) return
    let cancelled = false
    setQrFailed(false)
    import('qrcode')
      .then(async (mod) => {
        const QRCode: typeof import('qrcode') = (mod as any).default ?? mod
        const url = await QRCode.toDataURL(provisioningUri, {
          width: 200,
          margin: 1,
          errorCorrectionLevel: 'M',
        })
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [step, provisioningUri])

  const resetFlow = React.useCallback(() => {
    setStep(null)
    setPanel(null)
    setPassword('')
    setSecret('')
    setProvisioningUri('')
    setQrDataUrl(null)
    setQrFailed(false)
    setCode('')
    setBackupCodes([])
    setCodesAcknowledged(false)
    setError(null)
    setRetryAfter(0)
  }, [])

  const copyToClipboard = async (text: string, what: 'secret' | 'codes') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
    } catch {
      toast.error(
        t('user.settings.security.mfa.copy_failed', {
          defaultValue: 'Could not copy. Please select the text and copy it manually.',
        })
      )
    }
  }

  const downloadBackupCodes = () => {
    const header = t('user.settings.security.mfa.codes_file_header', {
      defaultValue: 'LearnHouse two-factor backup codes. Each code can be used once.',
    })
    const blob = new Blob([`${header}\n\n${backupCodes.join('\n')}\n`], {
      type: 'text/plain;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'learnhouse-backup-codes.txt'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  // --- requests -----------------------------------------------------------

  const runSetup = async (withPassword?: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await mfaFetch('/setup', 'POST', withPassword ? { password: withPassword } : {})
      if (res.success) {
        setSecret(res.data?.secret ?? '')
        setProvisioningUri(res.data?.provisioning_uri ?? '')
        setPassword('')
        setStep('scan')
      } else if (res.status === 409) {
        // Already enabled somewhere else (another tab) — resync rather than lie.
        toast.error(
          readError(
            res,
            t('user.settings.security.mfa.already_enabled', {
              defaultValue: 'Two-factor authentication is already enabled on this account.',
            })
          )
        )
        resetFlow()
        await loadStatus()
      } else {
        setError(
          readError(
            res,
            t('user.settings.security.mfa.setup_failed', {
              defaultValue: 'Could not start two-factor setup. Please try again.',
            })
          )
        )
      }
    } catch {
      setError(
        t('user.settings.security.mfa.setup_failed', {
          defaultValue: 'Could not start two-factor setup. Please try again.',
        })
      )
    } finally {
      setBusy(false)
    }
  }

  const startEnrollment = () => {
    setError(null)
    setRetryAfter(0)
    setCode('')
    setPassword('')
    if (status?.has_password) {
      setStep('password')
    } else {
      // No password on the account (SSO) — go straight to the QR.
      setStep('scan')
      runSetup()
    }
  }

  const confirmEnrollment = async () => {
    if (busy || code.length !== 6 || retryAfter > 0) return
    setBusy(true)
    setError(null)
    try {
      const res = await mfaFetch('/confirm', 'POST', { code })
      if (res.success) {
        setBackupCodes(Array.isArray(res.data?.backup_codes) ? res.data.backup_codes : [])
        setCodesAcknowledged(false)
        setCode('')
        setSecret('')
        setProvisioningUri('')
        setQrDataUrl(null)
        setStep('codes')
        toast.success(
          t('user.settings.security.mfa.enabled_toast', {
            defaultValue: 'Two-factor authentication is now enabled.',
          })
        )
      } else {
        setError(
          readError(
            res,
            t('user.settings.security.mfa.invalid_code', {
              defaultValue: 'That code is not valid. Please try again.',
            })
          )
        )
      }
    } catch {
      setError(
        t('user.settings.security.mfa.invalid_code', {
          defaultValue: 'That code is not valid. Please try again.',
        })
      )
    } finally {
      setBusy(false)
    }
  }

  const regenerateCodes = async () => {
    if (busy || code.length !== 6 || retryAfter > 0) return
    setBusy(true)
    setError(null)
    try {
      const res = await mfaFetch('/backup-codes/regenerate', 'POST', { code })
      if (res.success) {
        setBackupCodes(Array.isArray(res.data?.backup_codes) ? res.data.backup_codes : [])
        setCodesAcknowledged(false)
        setCode('')
        setPanel(null)
        setStep('codes')
      } else {
        setError(
          readError(
            res,
            t('user.settings.security.mfa.invalid_code', {
              defaultValue: 'That code is not valid. Please try again.',
            })
          )
        )
      }
    } catch {
      setError(
        t('user.settings.security.mfa.regenerate_failed', {
          defaultValue: 'Could not regenerate your backup codes. Please try again.',
        })
      )
    } finally {
      setBusy(false)
    }
  }

  const disableMfa = async () => {
    if (busy || code.length !== 6 || retryAfter > 0) return
    if (status?.has_password && !password) return
    setBusy(true)
    setError(null)
    try {
      const res = await mfaFetch(
        '/disable',
        'POST',
        status?.has_password ? { password, code } : { code }
      )
      if (res.success) {
        toast.success(
          t('user.settings.security.mfa.disabled_toast', {
            defaultValue: 'Two-factor authentication has been turned off.',
          })
        )
        resetFlow()
        await loadStatus()
      } else {
        setError(
          readError(
            res,
            t('user.settings.security.mfa.disable_failed', {
              defaultValue: 'Could not turn off two-factor authentication. Please try again.',
            })
          )
        )
      }
    } catch {
      setError(
        t('user.settings.security.mfa.disable_failed', {
          defaultValue: 'Could not turn off two-factor authentication. Please try again.',
        })
      )
    } finally {
      setBusy(false)
    }
  }

  const finishCodes = async () => {
    if (!codesAcknowledged || busy) return
    setBusy(true)
    try {
      resetFlow()
      await loadStatus()
    } finally {
      setBusy(false)
    }
  }

  // --- pieces -------------------------------------------------------------

  const errorBlock = error ? (
    <div className="flex items-start gap-2 text-red-600 bg-red-50 p-3 rounded-md">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span className="text-sm">
        {error}
        {retryAfter > 0 && (
          <>
            {' '}
            {t('user.settings.security.mfa.retry_in', {
              defaultValue: 'You can try again in {{seconds}}s.',
              seconds: retryAfter,
            })}
          </>
        )}
      </span>
    </div>
  ) : null

  const codeField = (id: string, onEnter: () => void) => (
    <div>
      <Label htmlFor={id}>
        {t('user.settings.security.mfa.code_label', { defaultValue: 'Authentication code' })}
      </Label>
      <Input
        id={id}
        name={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="000000"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onEnter()
          }
        }}
        disabled={busy}
        className="mt-1 max-w-[12rem] font-mono tracking-[0.4em] text-center"
      />
      <p className="text-xs text-gray-500 mt-1.5">
        {t('user.settings.security.mfa.code_hint', {
          defaultValue: 'Enter the 6-digit code currently shown in your authenticator app.',
        })}
      </p>
    </div>
  )

  const sectionHeader = (
    <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
      <h1 className="font-bold text-xl text-gray-800 flex items-center gap-2">
        <ShieldCheck size={18} className="text-gray-500" />
        {t('user.settings.security.mfa.title', {
          defaultValue: 'Two-factor authentication',
        })}
      </h1>
      <h2 className="text-gray-500 text-md ps-7">
        {t('user.settings.security.mfa.subtitle', {
          defaultValue:
            'Ask for a one-time code from your authenticator app whenever you sign in.',
        })}
      </h2>
    </div>
  )

  // --- render -------------------------------------------------------------

  let body: React.ReactNode

  if (statusLoading) {
    body = (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-4 text-sm text-gray-500">
        <Loader2 size={16} className="animate-spin" />
        {t('common.loading', { defaultValue: 'Loading...' })}
      </div>
    )
  } else if (statusError) {
    body = (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 p-4">
        <div className="flex items-start gap-2 text-red-600 min-w-0">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span className="text-sm">{statusError}</span>
        </div>
        <Button
          variant="outline"
          className="shrink-0"
          onClick={() => {
            setStatusLoading(true)
            setStatusError(null)
            loadStatus()
          }}
        >
          {t('user.settings.security.mfa.retry', { defaultValue: 'Retry' })}
        </Button>
      </div>
    )
  } else if (step === 'codes') {
    // Step 4 — the ONLY time these codes are ever visible.
    body = (
      <div className="rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex items-start gap-2 text-amber-700 bg-amber-50 p-3 rounded-md">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-semibold">
              {t('user.settings.security.mfa.codes_once_title', {
                defaultValue: 'This is the only time these codes will be shown.',
              })}
            </p>
            <p className="mt-0.5">
              {t('user.settings.security.mfa.codes_once_body', {
                defaultValue:
                  'Save them somewhere safe now. Each code can be used once to sign in if you lose access to your authenticator app. Once you leave this screen they cannot be retrieved — you would have to generate new ones.',
              })}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {backupCodes.map((c) => (
            <div
              key={c}
              className="font-mono text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 text-center select-all"
            >
              {c}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={() => copyToClipboard(backupCodes.join('\n'), 'codes')}
          >
            {copied === 'codes' ? <Check size={14} /> : <Copy size={14} />}
            {copied === 'codes'
              ? t('user.settings.security.mfa.copied', { defaultValue: 'Copied' })
              : t('user.settings.security.mfa.copy_all', { defaultValue: 'Copy all' })}
          </Button>
          <Button type="button" variant="outline" className="gap-1.5" onClick={downloadBackupCodes}>
            <Download size={14} />
            {t('user.settings.security.mfa.download', { defaultValue: 'Download .txt' })}
          </Button>
        </div>

        <div className="flex items-start gap-2.5 pt-1">
          <Checkbox
            id="mfa-codes-saved"
            checked={codesAcknowledged}
            onCheckedChange={(checked) => setCodesAcknowledged(checked === true)}
            className="mt-0.5"
          />
          <Label htmlFor="mfa-codes-saved" className="text-sm text-gray-700 leading-snug">
            {t('user.settings.security.mfa.codes_ack', {
              defaultValue: 'I have saved these codes somewhere safe.',
            })}
          </Label>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={finishCodes}
            disabled={!codesAcknowledged || busy}
            className="bg-black text-white hover:bg-black/90"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {t('user.settings.security.mfa.done', { defaultValue: 'Done' })}
          </Button>
        </div>
      </div>
    )
  } else if (step === 'password') {
    // Step 1 — confirm the password before we hand out a secret.
    body = (
      <div className="rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-gray-400" />
          <p className="text-sm font-medium text-gray-800">
            {t('user.settings.security.mfa.step_password_title', {
              defaultValue: 'Confirm your password',
            })}
          </p>
        </div>
        <p className="text-sm text-gray-500">
          {t('user.settings.security.mfa.step_password_body', {
            defaultValue: 'For your security, enter your current password to continue.',
          })}
        </p>
        <div>
          <Label htmlFor="mfa-password">
            {t('user.settings.password.current_password', { defaultValue: 'Current Password' })}
          </Label>
          <Input
            id="mfa-password"
            name="mfa-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (password) runSetup(password)
              }
            }}
            disabled={busy}
            className="mt-1 max-w-md"
          />
        </div>
        {errorBlock}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={resetFlow} disabled={busy}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type="button"
            onClick={() => runSetup(password)}
            disabled={busy || !password}
            className="bg-black text-white hover:bg-black/90"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {t('user.settings.security.mfa.continue', { defaultValue: 'Continue' })}
          </Button>
        </div>
      </div>
    )
  } else if (step === 'scan') {
    // Step 2 — QR + the raw secret for desktop authenticators.
    body = (
      <div className="rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Smartphone size={16} className="text-gray-400" />
          <p className="text-sm font-medium text-gray-800">
            {t('user.settings.security.mfa.step_scan_title', {
              defaultValue: 'Scan this with your authenticator app',
            })}
          </p>
        </div>
        <p className="text-sm text-gray-500">
          {t('user.settings.security.mfa.step_scan_body', {
            defaultValue:
              'Open an authenticator app (1Password, Google Authenticator, Authy, …) and scan the code below.',
          })}
        </p>

        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="flex items-center justify-center bg-white border border-gray-200 rounded-lg p-3 w-[224px] h-[224px] shrink-0">
            {qrDataUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={qrDataUrl}
                width={200}
                height={200}
                alt={t('user.settings.security.mfa.qr_alt', {
                  defaultValue: 'Two-factor setup QR code',
                })}
              />
            ) : qrFailed ? (
              <p className="text-xs text-gray-500 text-center px-3">
                {t('user.settings.security.mfa.qr_failed', {
                  defaultValue: 'The QR code could not be drawn. Use the setup key instead.',
                })}
              </p>
            ) : (
              <Loader2 size={20} className="animate-spin text-gray-400" />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              {t('user.settings.security.mfa.secret_label', {
                defaultValue: 'Or enter this setup key manually',
              })}
            </p>
            <div className="flex items-center gap-2">
              <code className="font-mono text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 break-all select-all min-w-0 flex-1">
                {secret || '…'}
              </code>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                disabled={!secret}
                onClick={() => copyToClipboard(secret, 'secret')}
                aria-label={t('user.settings.security.mfa.copy_secret', {
                  defaultValue: 'Copy setup key',
                })}
              >
                {copied === 'secret' ? <Check size={14} /> : <Copy size={14} />}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              {t('user.settings.security.mfa.secret_hint', {
                defaultValue: 'Useful for desktop authenticator apps that cannot scan a QR code.',
              })}
            </p>
          </div>
        </div>

        {errorBlock}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={resetFlow} disabled={busy}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setError(null)
              setStep('verify')
            }}
            disabled={busy || !secret}
            className="bg-black text-white hover:bg-black/90"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {t('user.settings.security.mfa.continue', { defaultValue: 'Continue' })}
          </Button>
        </div>
      </div>
    )
  } else if (step === 'verify') {
    // Step 3 — prove the app is set up before we switch 2FA on.
    body = (
      <div className="rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-gray-400" />
          <p className="text-sm font-medium text-gray-800">
            {t('user.settings.security.mfa.step_verify_title', {
              defaultValue: 'Confirm the code from your app',
            })}
          </p>
        </div>
        {codeField('mfa-confirm-code', confirmEnrollment)}
        {errorBlock}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setError(null)
              setCode('')
              setStep('scan')
            }}
            disabled={busy}
          >
            {t('user.settings.security.mfa.back', { defaultValue: 'Back' })}
          </Button>
          <Button
            type="button"
            onClick={confirmEnrollment}
            disabled={busy || code.length !== 6 || retryAfter > 0}
            className="bg-black text-white hover:bg-black/90"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {retryAfter > 0
              ? t('user.settings.security.mfa.wait_seconds', {
                  defaultValue: 'Wait {{seconds}}s',
                  seconds: retryAfter,
                })
              : t('user.settings.security.mfa.verify_and_enable', {
                  defaultValue: 'Verify and enable',
                })}
          </Button>
        </div>
      </div>
    )
  } else if (status?.enabled) {
    const remaining = status.backup_codes_remaining ?? 0
    const lowOnCodes = remaining <= BACKUP_CODES_LOW_THRESHOLD
    body = (
      <div className="rounded-lg border border-gray-200 p-4 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-green-50 text-green-600 shrink-0">
              <ShieldCheck size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800">
                {t('user.settings.security.mfa.enabled', { defaultValue: 'Enabled' })}
              </p>
              <p className="text-xs text-gray-500">
                {status.confirmed_at
                  ? t('user.settings.security.mfa.enabled_since', {
                      defaultValue: 'Since {{date}}',
                      date: new Date(status.confirmed_at).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      }),
                    })
                  : t('user.settings.security.mfa.enabled_hint', {
                      defaultValue: 'A code from your authenticator app is required to sign in.',
                    })}
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              disabled={busy}
              onClick={() => {
                setError(null)
                setCode('')
                setRetryAfter(0)
                setPanel(panel === 'regenerate' ? null : 'regenerate')
              }}
            >
              <RefreshCw size={14} />
              {t('user.settings.security.mfa.regenerate', {
                defaultValue: 'Regenerate backup codes',
              })}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
              disabled={busy}
              onClick={() => {
                setError(null)
                setCode('')
                setPassword('')
                setRetryAfter(0)
                setPanel(panel === 'disable' ? null : 'disable')
              }}
            >
              <ShieldOff size={14} />
              {t('user.settings.security.mfa.disable', { defaultValue: 'Disable' })}
            </Button>
          </div>
        </div>

        <div
          className={
            lowOnCodes
              ? 'flex items-center gap-2 text-amber-700 bg-amber-50 p-3 rounded-md'
              : 'flex items-center gap-2 text-gray-600 bg-gray-50 p-3 rounded-md'
          }
        >
          {lowOnCodes ? <ShieldAlert size={16} /> : <KeyRound size={16} className="text-gray-400" />}
          <span className="text-sm">
            {/* Interpolated as `remaining`, not `count`: `count` would put
                i18next into plural mode and look for suffixed keys. */}
            {t('user.settings.security.mfa.codes_remaining', {
              defaultValue: '{{remaining}} backup codes remaining',
              remaining,
            })}
            {lowOnCodes && (
              <>
                {' — '}
                {t('user.settings.security.mfa.codes_low', {
                  defaultValue: 'generate a new set so you do not get locked out.',
                })}
              </>
            )}
          </span>
        </div>

        {panel === 'regenerate' && (
          <div className="border-t border-gray-100 pt-4 space-y-4">
            <p className="text-sm text-gray-500">
              {t('user.settings.security.mfa.regenerate_body', {
                defaultValue:
                  'Generating a new set immediately invalidates all of your existing backup codes.',
              })}
            </p>
            {codeField('mfa-regenerate-code', regenerateCodes)}
            {errorBlock}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPanel(null)
                  setCode('')
                  setError(null)
                }}
                disabled={busy}
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                type="button"
                onClick={regenerateCodes}
                disabled={busy || code.length !== 6 || retryAfter > 0}
                className="bg-black text-white hover:bg-black/90"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {retryAfter > 0
                  ? t('user.settings.security.mfa.wait_seconds', {
                      defaultValue: 'Wait {{seconds}}s',
                      seconds: retryAfter,
                    })
                  : t('user.settings.security.mfa.regenerate_confirm', {
                      defaultValue: 'Generate new codes',
                    })}
              </Button>
            </div>
          </div>
        )}

        {panel === 'disable' && (
          <div className="border-t border-gray-100 pt-4 space-y-4">
            <div className="flex items-start gap-2 text-amber-700 bg-amber-50 p-3 rounded-md">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span className="text-sm">
                {t('user.settings.security.mfa.disable_warning', {
                  defaultValue:
                    'Turning this off removes the second step from sign-in and deletes your backup codes.',
                })}
              </span>
            </div>
            {status.has_password && (
              <div>
                <Label htmlFor="mfa-disable-password">
                  {t('user.settings.password.current_password', {
                    defaultValue: 'Current Password',
                  })}
                </Label>
                <Input
                  id="mfa-disable-password"
                  name="mfa-disable-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  className="mt-1 max-w-md"
                />
              </div>
            )}
            {codeField('mfa-disable-code', disableMfa)}
            {errorBlock}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPanel(null)
                  setCode('')
                  setPassword('')
                  setError(null)
                }}
                disabled={busy}
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={disableMfa}
                disabled={
                  busy ||
                  code.length !== 6 ||
                  retryAfter > 0 ||
                  (status.has_password && !password)
                }
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {retryAfter > 0
                  ? t('user.settings.security.mfa.wait_seconds', {
                      defaultValue: 'Wait {{seconds}}s',
                      seconds: retryAfter,
                    })
                  : t('user.settings.security.mfa.disable_confirm', {
                      defaultValue: 'Turn off two-factor',
                    })}
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  } else {
    // Disabled, nothing in flight.
    body = (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 p-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-gray-100 text-gray-400 shrink-0">
            <ShieldOff size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800">
              {t('user.settings.security.mfa.not_enabled', { defaultValue: 'Not enabled' })}
            </p>
            <p className="text-xs text-gray-500">
              {t('user.settings.security.mfa.not_enabled_hint', {
                defaultValue:
                  'Protect your account by also requiring a one-time code from your authenticator app when you sign in.',
              })}
            </p>
          </div>
        </div>
        <Button
          type="button"
          onClick={startEnrollment}
          disabled={busy}
          className="bg-black text-white hover:bg-black/90 shrink-0"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {t('user.settings.security.mfa.enable', { defaultValue: 'Enable' })}
        </Button>
      </div>
    )
  }

  return (
    <>
      {sectionHeader}
      <div className="mx-5 mb-6">{body}</div>
    </>
  )
}

function AccountSecurity() {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;
  const { t } = useTranslation();

  // Current device/browser, parsed client-side from the user agent (in an effect
  // to avoid SSR hydration mismatch).
  const [device, setDevice] = React.useState<{ browser: string; os: string } | null>(null)
  React.useEffect(() => {
    const ua = navigator.userAgent
    const browser =
      /Edg\//.test(ua) ? 'Edge' :
      /OPR\/|Opera/.test(ua) ? 'Opera' :
      /Chrome\//.test(ua) ? 'Chrome' :
      /Firefox\//.test(ua) ? 'Firefox' :
      /Safari\//.test(ua) ? 'Safari' : 'Browser'
    const os =
      /Windows/.test(ua) ? 'Windows' :
      /Mac OS X|Macintosh/.test(ua) ? 'macOS' :
      /Android/.test(ua) ? 'Android' :
      /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
      /Linux/.test(ua) ? 'Linux' : ''
    setDevice({ browser, os })
  }, [])

  const updatePasswordUI = async (values: any) => {
    const user_id = session?.data?.user?.id
    if (!user_id) {
      toast.error(t('user.settings.password.update_failed', { defaultValue: 'Could not update password. Please sign in again.' }))
      return
    }
    const loadingToast = toast.loading(t('user.settings.password.updating'))
    try {
      const response = await updatePassword(user_id, values, access_token)

      if (response.success) {
        toast.dismiss(loadingToast)

        toast.success(t('user.settings.password.password_updated'), { duration: 4000 })
        toast(() => (
          <div className="flex items-center gap-2">
            <span>{t('user.settings.password.relogin_message')}</span>
          </div>
        ), {
          duration: 4000,
          icon: '🔑'
        })

        await new Promise(resolve => setTimeout(resolve, 4000))
        signOut({ redirect: true, callbackUrl: getUriWithoutOrg('/') })
      } else {
        toast.error(getErrorMessage(response.data?.detail, 'Failed to update password'), { id: loadingToast })
      }
    } catch (error: any) {
      const errorMessage = getErrorMessage(error?.data?.detail, 'Failed to update password. Please try again.')
      toast.error(errorMessage, { id: loadingToast })
      console.error('Password update error:', error)
    }
  }

  return (
    <>
    <div className="bg-white rounded-xl nice-shadow">
      <div className="flex flex-col gap-0">
        {/* Current session / device */}
        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 mt-3 rounded-md">
          <h1 className="font-bold text-xl text-gray-800">
            {t('user.settings.security.current_session_title', { defaultValue: 'Current session' })}
          </h1>
          <h2 className="text-gray-500 text-md">
            {t('user.settings.security.current_session_subtitle', { defaultValue: 'The device you are signed in from right now.' })}
          </h2>
        </div>
        <div className="mx-5 mt-3 mb-6">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-3 min-w-0">
              <Monitor className="text-gray-400 shrink-0" size={20} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">
                  {device ? [device.browser, device.os].filter(Boolean).join(' · ') : '—'}
                </p>
                <p className="text-xs text-gray-500">
                  {t('user.settings.security.this_device', { defaultValue: 'This device' })}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => signOut({ redirect: true, callbackUrl: getUriWithoutOrg('/') })}
              className="gap-1.5 shrink-0"
            >
              <LogOut size={14} />
              {t('user.settings.security.sign_out', { defaultValue: 'Sign out' })}
            </Button>
          </div>
        </div>

        <div className="flex flex-col bg-gray-50 -space-y-1 px-5 py-3 mx-3 my-3 rounded-md">
          <h1 className="font-bold text-xl text-gray-800">
            {t('user.settings.password.title')}
          </h1>
          <h2 className="text-gray-500 text-md">
            {t('user.settings.password.subtitle')}
          </h2>
        </div>

        <div className="mx-5 mb-5">
          <Formik
            initialValues={{ old_password: '', new_password: '' }}
            validationSchema={validationSchema}
            onSubmit={async (values, { setSubmitting }) => {
              // Keep the form disabled for the WHOLE request (the old 400ms
              // setTimeout released it before the async call even ran, allowing
              // double-submit).
              try {
                await updatePasswordUI(values)
              } finally {
                setSubmitting(false)
              }
            }}
          >
            {({ isSubmitting, handleChange, errors, touched }) => (
              <Form className="w-full max-w-2xl mx-auto space-y-6">
                <div>
                  <Label htmlFor="old_password">{t('user.settings.password.current_password')}</Label>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    id="old_password"
                    name="old_password"
                    onChange={handleChange}
                    className="mt-1"
                  />
                  {touched.old_password && errors.old_password && (
                    <p className="text-red-500 text-sm mt-1">{t(errors.old_password as string)}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="new_password">{t('user.settings.password.new_password')}</Label>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    id="new_password"
                    name="new_password"
                    onChange={handleChange}
                    className="mt-1"
                  />
                  {touched.new_password && errors.new_password && (
                    <p className="text-red-500 text-sm mt-1">{t(errors.new_password as string)}</p>
                  )}
                </div>

                <div className="flex items-center space-x-2 text-amber-600 bg-amber-50 p-3 rounded-md">
                  <AlertTriangle size={16} />
                  <span className="text-sm">{t('user.settings.password.logout_warning')}</span>
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="bg-black text-white hover:bg-black/90"
                  >
                    {isSubmitting ? t('user.settings.password.updating') : t('user.settings.password.update_password')}
                  </Button>
                </div>
              </Form>
            )}
          </Formik>
        </div>

        {/* Two-factor authentication (TOTP) */}
        <TwoFactorAuthSection />
      </div>
    </div>

    {/* Danger zone — delete account (also deletes solely-owned orgs + content) */}
    <AccountDangerZone />
    </>
  )
}

export default AccountSecurity
