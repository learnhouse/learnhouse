'use client'
import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle, Loader2, X } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { verifyEmail } from '@services/auth/auth'
import { useTranslation } from 'react-i18next'
import AuthLayout from '@components/Auth/AuthLayout'
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

    const [isVerifying, setIsVerifying] = useState(true)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState(false)
    const [showMessage, setShowMessage] = useState(false)

    // The verification token is single-use: the backend consumes (deletes) it the
    // moment it succeeds and auto-signs the user in. So this request must fire
    // EXACTLY once. Without this guard the effect re-runs — React 18 StrictMode
    // double-invokes it, and in production the `t`/`track` identities change once
    // i18n/analytics initialise, retriggering the effect — and the second call
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
                setShowMessage(true)
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
                    setShowMessage(true)
                    // Verification also signs the user in (session cookies were
                    // set via the auth proxy). Send them into the app hub (/home)
                    // — NOT the apex '/' which is the public/login page — so a
                    // fresh, now-verified user lands somewhere useful. A full
                    // navigation lets auth bootstrap from the new cookies.
                    setTimeout(() => {
                        window.location.assign('/home')
                    }, 1200)
                } else {
                    track(AnalyticsEvent.EmailVerificationCompleted, { result: 'fail' })
                    setError(res.error || t('auth.verification_failed'))
                    setShowMessage(true)
                }
            } catch {
                track(AnalyticsEvent.EmailVerificationCompleted, { result: 'fail' })
                setError(t('auth.verification_failed'))
                setShowMessage(true)
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
                {/* Message Top Bar */}
                {showMessage && !isVerifying && (error || success) && (
                    <div className={`
                        mx-6 md:mx-12 lg:mx-20 mt-6 rounded-xl border px-4 py-3 flex items-center justify-between gap-3 animate-in slide-in-from-top duration-200
                        ${error ? 'bg-red-50 text-red-700 border-red-100' : 'bg-green-50 text-green-700 border-green-100'}
                    `}>
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            {error ? <AlertTriangle size={18} className="shrink-0" /> : <CheckCircle size={18} className="shrink-0" />}
                            <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium">
                                    {error ? t('auth.verification_failed') : t('auth.email_verified_success')}
                                </span>
                                {success && (
                                    <span className="text-sm ms-2">
                                        · <Link href="/home" className="underline hover:no-underline">{t('auth.continue_to_dashboard', { defaultValue: 'Continue to your dashboard' })}</Link>
                                    </span>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={() => setShowMessage(false)}
                            className="p-1 rounded-lg hover:bg-black/5 transition-colors shrink-0 opacity-60 hover:opacity-100"
                        >
                            <X size={18} />
                        </button>
                    </div>
                )}

                <div className="flex-1 flex items-center justify-center px-6 md:px-12 lg:px-20">
                    <div className="w-full max-w-[420px] py-10">
                        {/* Header */}
                        <h1 className="text-[28px] md:text-[32px] font-black text-black tracking-tight leading-tight text-center">{t('auth.verify_email_title')}</h1>

                        {/* Loading State */}
                        {isVerifying && (
                            <div className="mt-8 flex flex-col items-center gap-4">
                                <Loader2 className="h-12 w-12 animate-spin text-black/40" />
                                <p className="text-black/45 text-sm font-medium">{t('auth.verifying_email')}</p>
                            </div>
                        )}

                        {/* Error State */}
                        {!isVerifying && error && (
                            <div className="mt-8 space-y-5">
                                <div className="flex justify-center bg-red-50 rounded-xl text-red-600 space-x-3 items-center p-4 border border-red-100">
                                    <AlertTriangle size={18} className="shrink-0" />
                                    <div>
                                        <p className="font-semibold text-sm">{t('auth.verification_failed')}</p>
                                        <p className="text-sm font-medium mt-0.5">{error}</p>
                                    </div>
                                </div>
                                <p className="text-sm text-black/45 text-center font-medium">
                                    {t('auth.verification_trouble')}
                                </p>
                                <Link
                                    href="/login"
                                    className="box-border w-full inline-flex h-[44px] rounded-lg items-center justify-center bg-black hover:bg-black/85 text-white px-[15px] font-bold text-[14px] leading-none transition-all"
                                >
                                    {t('auth.back_to_login')}
                                </Link>
                            </div>
                        )}

                        {/* Success State */}
                        {!isVerifying && success && (
                            <div className="mt-8 space-y-5">
                                <div className="flex flex-col items-center gap-4 text-center">
                                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                                        <CheckCircle className="h-8 w-8 text-green-500" />
                                    </div>
                                    <div>
                                        <h2 className="font-bold text-lg text-black">{t('auth.email_verified_success')}</h2>
                                        <p className="text-sm text-black/45 font-medium mt-1">{t('auth.email_verified_message')}</p>
                                    </div>
                                </div>
                                <Link
                                    href="/home"
                                    className="box-border w-full inline-flex h-[44px] rounded-lg items-center justify-center bg-black hover:bg-black/85 text-white px-[15px] font-bold text-[14px] leading-none transition-all"
                                >
                                    {t('auth.continue_to_dashboard', { defaultValue: 'Continue to your dashboard' })}
                                </Link>
                            </div>
                        )}
                    </div>
                </div>
        </AuthLayout>
    )
}

export default VerifyEmailClient
