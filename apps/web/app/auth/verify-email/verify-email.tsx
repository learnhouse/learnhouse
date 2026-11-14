'use client'
import React, { useEffect, useRef, useState } from 'react'
import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { verifyEmail } from '@services/auth/auth'
import { defaultPostAuthPath } from '@services/auth/redirects'
import { useTranslation } from 'react-i18next'
import AuthLayout from '@components/Auth/AuthLayout'
import { AuthStatus, authButtonClass } from '@components/Auth/AuthUI'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

interface VerifyEmailClientProps {
    org: any
}

function VerifyEmailClient({ org }: VerifyEmailClientProps) {
    const { t } = useTranslation();
    const { track } = useLHAnalytics('public')
    const searchParams = useSearchParams()
    const token = searchParams.get('token') || ''
    const userUuid = searchParams.get('user') || ''
    const orgUuid = searchParams.get('org') || ''
    const homePath = defaultPostAuthPath(org)

    const [isVerifying, setIsVerifying] = useState(true)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState(false)

    // The verification token is single-use: the backend consumes (deletes) it the
    // moment it succeeds and auto-signs the user in. So this request must fire
    // EXACTLY once. Without this guard the effect re-runs: React 18 StrictMode
    // double-invokes it, and in production the `t`/`track` identities change once
    // i18n/analytics initialise, retriggering the effect, and the second call
    // hits an already-consumed token, wrongly reporting "invalid or expired" for
    // a user who is, in fact, now verified.
    const hasRunRef = useRef(false)

    useEffect(() => {
        if (hasRunRef.current) return
        hasRunRef.current = true

        const verify = async () => {
            if (!token || !userUuid || !orgUuid) {
                track(AnalyticsEvent.EmailVerificationCompleted, { result: 'fail' })
                setError(t('auth.verification_missing_params'))
                setIsVerifying(false)
                return
            }

            try {
                const res = await verifyEmail(token, userUuid, orgUuid)
                if (res.success) {
                    track(AnalyticsEvent.EmailVerificationCompleted, { result: 'success' })
                    // Verification auto-signs the user in (session cookies were set
                    // via the auth proxy), so they never touch the login form. Emit
                    // login_succeeded here too, otherwise the signup→login funnel
                    // shows a phantom drop for every verified user. `method`
                    // distinguishes this from a credentials login.
                    track(AnalyticsEvent.LoginSucceeded, { method: 'email_verification' })
                    setSuccess(true)
                    // Verification also signs the user in (session cookies were
                    // set via the auth proxy). Send them into their school's home
                    // page, or the hub when verifying on the org-less apex (whose
                    // '/' is the login page). A full navigation lets auth
                    // bootstrap from the new cookies.
                    setTimeout(() => {
                        window.location.assign(homePath)
                    }, 1200)
                } else {
                    track(AnalyticsEvent.EmailVerificationCompleted, { result: 'fail' })
                    setError(res.error || t('auth.verification_failed'))
                }
            } catch {
                track(AnalyticsEvent.EmailVerificationCompleted, { result: 'fail' })
                setError(t('auth.verification_failed'))
            } finally {
                setIsVerifying(false)
            }
        }

        verify()
        // Depend only on the verification inputs. `t`/`track` are intentionally
        // excluded: their identities change on init and would retrigger a
        // single-use request (the hasRunRef guard is the hard stop).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, userUuid, orgUuid])

    return (
        <AuthLayout
          org={org}
          welcomeText={t('auth.verifying_your_email')}
          title={t('auth.image_title_verify', { defaultValue: 'Verify your email.' })}
          subtitle={t('auth.image_subtitle_verify', {
            defaultValue: 'One quick step to secure your account and get started.',
          })}
        >
            <div aria-live="polite">
                {isVerifying && (
                    <AuthStatus loading title={t('auth.verify_email_title')} description={t('auth.verifying_email')} />
                )}

                {!isVerifying && error && (
                    <AuthStatus
                        tone="danger"
                        icon={<WarningCircle size={22} weight="duotone" />}
                        title={t('auth.verification_failed')}
                        description={error}
                    >
                        <p className="text-[13px] text-neutral-500">{t('auth.verification_trouble')}</p>
                        <Link href="/login" className={authButtonClass('primary', 'mt-2')}>
                            {t('auth.back_to_login')}
                        </Link>
                    </AuthStatus>
                )}

                {!isVerifying && success && (
                    <AuthStatus
                        tone="success"
                        icon={<CheckCircle size={22} weight="duotone" />}
                        title={t('auth.email_verified_success')}
                        description={t('auth.email_verified_message')}
                    >
                        <Link href={homePath} className={authButtonClass('primary')}>
                            {t('auth.continue_to_dashboard', { defaultValue: 'Continue to your dashboard' })}
                        </Link>
                    </AuthStatus>
                )}
            </div>
        </AuthLayout>
    )
}

export default VerifyEmailClient
