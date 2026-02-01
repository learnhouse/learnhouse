'use client'
import Image from 'next/image'
import React, { useEffect, useState } from 'react'
import learnhouseIcon from 'public/learnhouse_bigicon_1.png'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { AlertTriangle, CheckCircle, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { getUriWithOrg, getUriWithoutOrg } from '@services/config/config'
import { useOrg } from '@components/Contexts/OrgContext'
import { useSearchParams } from 'next/navigation'
import { verifyEmail } from '@services/auth/auth'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from '@components/Utils/LanguageSwitcher'

function VerifyEmailClient() {
    const { t } = useTranslation();
    const org = useOrg() as any;
    const searchParams = useSearchParams()
    const token = searchParams.get('token') || ''
    const userUuid = searchParams.get('user') || ''
    const orgUuid = searchParams.get('org') || ''

    const [isVerifying, setIsVerifying] = useState(true)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState(false)

    useEffect(() => {
        const verify = async () => {
            if (!token || !userUuid || !orgUuid) {
                setError(t('auth.verification_missing_params'))
                setIsVerifying(false)
                return
            }

            try {
                const res = await verifyEmail(token, userUuid, orgUuid)
                if (res.success) {
                    setSuccess(true)
                } else {
                    setError(res.error || t('auth.verification_failed'))
                }
            } catch (err) {
                setError(t('auth.verification_failed'))
            } finally {
                setIsVerifying(false)
            }
        }

        verify()
    }, [token, userUuid, orgUuid, t])

    return (
        <div className="grid grid-flow-col justify-stretch h-screen">
            <div className="absolute top-4 right-4 z-dropdown">
                <LanguageSwitcher />
            </div>
            <div
                className="right-login-part"
                style={{
                    background:
                        'linear-gradient(041.61deg, #202020 7.15%, #000000 90.96%)',
                }}
            >
                <div className="login-topbar m-10">
                    <Link prefetch href={getUriWithOrg(org?.slug, '/')}>
                        <Image
                            quality={100}
                            width={30}
                            height={30}
                            src={learnhouseIcon}
                            alt=""
                        />
                    </Link>
                </div>
                <div className="ml-10 h-4/6 flex flex-row text-white">
                    <div className="m-auto flex space-x-4 items-center flex-wrap">
                        <div className="shadow-[0px_4px_16px_rgba(0,0,0,0.02)]">
                            {org?.logo_image ? (
                                <img
                                    src={`${getOrgLogoMediaDirectory(
                                        org?.org_uuid,
                                        org?.logo_image
                                    )}`}
                                    alt="Learnhouse"
                                    style={{ width: 'auto', height: 70 }}
                                    className="rounded-xl shadow-xl inset-0 ring-1 ring-inset ring-black/10 bg-white"
                                />
                            ) : (
                                <Image
                                    quality={100}
                                    width={70}
                                    height={70}
                                    src={learnhouseIcon}
                                    alt=""
                                />
                            )}
                        </div>
                        <div className="font-bold text-xl">{org?.name}</div>
                    </div>
                </div>
            </div>
            <div className="left-login-part bg-white flex flex-row">
                <div className="login-form m-auto w-80 text-center">
                    <h1 className="text-2xl font-bold mb-4">{t('auth.verify_email_title')}</h1>

                    {isVerifying && (
                        <div className="flex flex-col items-center gap-4 p-6">
                            <Loader2 className="h-12 w-12 animate-spin text-gray-600" />
                            <p className="text-gray-600">{t('auth.verifying_email')}</p>
                        </div>
                    )}

                    {!isVerifying && error && (
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col items-center gap-3 bg-red-50 rounded-lg p-6">
                                <AlertTriangle className="h-12 w-12 text-red-500" />
                                <div className="font-semibold text-red-800">{t('auth.verification_failed')}</div>
                                <div className="text-sm text-red-600">{error}</div>
                            </div>
                            <p className="text-sm text-gray-600">
                                {t('auth.verification_trouble')}
                            </p>
                            <Link
                                href={getUriWithoutOrg('/login?orgslug=' + org?.slug)}
                                className="text-blue-600 hover:text-blue-800 font-medium"
                            >
                                {t('auth.back_to_login')}
                            </Link>
                        </div>
                    )}

                    {!isVerifying && success && (
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col items-center gap-3 bg-green-50 rounded-lg p-6">
                                <CheckCircle className="h-12 w-12 text-green-500" />
                                <div className="font-semibold text-green-800">{t('auth.email_verified_success')}</div>
                                <div className="text-sm text-green-600">{t('auth.email_verified_message')}</div>
                            </div>
                            <Link
                                href={getUriWithoutOrg('/login?orgslug=' + org?.slug)}
                                className="w-full bg-black text-white font-bold text-center p-3 rounded-md shadow-md hover:bg-gray-800 transition-colors"
                            >
                                {t('auth.proceed_to_login')}
                            </Link>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default VerifyEmailClient
