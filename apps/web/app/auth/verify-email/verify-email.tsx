'use client'
import React, { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle, Loader2, X } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { verifyEmail } from '@services/auth/auth'
import { useTranslation } from 'react-i18next'
import AuthLayout from '@components/Auth/AuthLayout'

interface VerifyEmailClientProps {
    org: any
}

function VerifyEmailClient({ org }: VerifyEmailClientProps) {
    const { t } = useTranslation();
    const searchParams = useSearchParams()
    const token = searchParams.get('token') || ''
    const userUuid = searchParams.get('user') || ''
    const orgUuid = searchParams.get('org') || ''

    const [isVerifying, setIsVerifying] = useState(true)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState(false)
    const [showMessage, setShowMessage] = useState(false)

    useEffect(() => {
        const verify = async () => {
            if (!token || !userUuid || !orgUuid) {
                setError(t('auth.verification_missing_params'))
                setIsVerifying(false)
                setShowMessage(true)
                return
            }

            try {
                const res = await verifyEmail(token, userUuid, orgUuid)
                if (res.success) {
                    setSuccess(true)
                    setShowMessage(true)
                } else {
                    setError(res.error || t('auth.verification_failed'))
                    setShowMessage(true)
                }
            } catch (err) {
                setError(t('auth.verification_failed'))
                setShowMessage(true)
            } finally {
                setIsVerifying(false)
            }
        }

        verify()
    }, [token, userUuid, orgUuid, t])

    return (
        <AuthLayout org={org} welcomeText={t('auth.verifying_your_email')}>
                {/* Message Top Bar */}
                {showMessage && !isVerifying && (error || success) && (
                    <div className={`
                        w-full px-4 py-3 flex items-center justify-between gap-3 animate-in slide-in-from-top duration-200
                        ${error ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}
                    `}>
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            {error ? <AlertTriangle size={18} className="shrink-0" /> : <CheckCircle size={18} className="shrink-0" />}
                            <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium">
                                    {error ? t('auth.verification_failed') : t('auth.email_verified_success')}
                                </span>
                                {success && (
                                    <span className="text-sm ml-2">
                                        · <Link href="/login" className="underline hover:no-underline">{t('auth.proceed_to_login')}</Link>
                                    </span>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={() => setShowMessage(false)}
                            className="p-1 hover:bg-white/20 rounded transition-colors shrink-0"
                        >
                            <X size={18} />
                        </button>
                    </div>
                )}

                <div className="flex-1 flex flex-row">
                    <div className="m-auto w-full max-w-sm px-6 py-8 sm:py-0">
                        {/* Header */}
                        <div className="mb-8 text-center">
                            <h1 className="text-2xl font-bold text-gray-900">{t('auth.verify_email_title')}</h1>
                        </div>

                        {/* Loading State */}
                        {isVerifying && (
                            <div className="bg-white rounded-xl p-8 nice-shadow">
                                <div className="flex flex-col items-center gap-4">
                                    <Loader2 className="h-12 w-12 animate-spin text-gray-600" />
                                    <p className="text-gray-600">{t('auth.verifying_email')}</p>
                                </div>
                            </div>
                        )}

                        {/* Error State */}
                        {!isVerifying && error && (
                            <div className="space-y-4">
                                <div className="bg-white rounded-xl p-6 nice-shadow">
                                    <div className="flex flex-col items-center gap-4 text-center">
                                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
                                            <AlertTriangle className="h-8 w-8 text-red-500" />
                                        </div>
                                        <div>
                                            <h2 className="font-semibold text-lg text-gray-900">{t('auth.verification_failed')}</h2>
                                            <p className="text-sm text-gray-500 mt-1">{error}</p>
                                        </div>
                                    </div>
                                </div>
                                <p className="text-sm text-gray-500 text-center">
                                    {t('auth.verification_trouble')}
                                </p>
                                <Link
                                    href="/login"
                                    className="block w-full bg-black text-white font-semibold text-center py-2.5 rounded-lg hover:bg-gray-800 transition-colors"
                                >
                                    {t('auth.back_to_login')}
                                </Link>
                            </div>
                        )}

                        {/* Success State */}
                        {!isVerifying && success && (
                            <div className="space-y-4">
                                <div className="bg-white rounded-xl p-6 nice-shadow">
                                    <div className="flex flex-col items-center gap-4 text-center">
                                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                                            <CheckCircle className="h-8 w-8 text-green-500" />
                                        </div>
                                        <div>
                                            <h2 className="font-semibold text-lg text-gray-900">{t('auth.email_verified_success')}</h2>
                                            <p className="text-sm text-gray-500 mt-1">{t('auth.email_verified_message')}</p>
                                        </div>
                                    </div>
                                </div>
                                <Link
                                    href="/login"
                                    className="block w-full bg-black text-white font-semibold text-center py-2.5 rounded-lg hover:bg-gray-800 transition-colors"
                                >
                                    {t('auth.proceed_to_login')}
                                </Link>
                            </div>
                        )}
                    </div>
                </div>
        </AuthLayout>
    )
}

export default VerifyEmailClient
