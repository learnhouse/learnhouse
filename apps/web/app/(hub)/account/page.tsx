'use client'
import React, { Suspense, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, UserCog, KeyRound } from 'lucide-react'
import { Toaster } from 'react-hot-toast'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import UserAvatar from '@components/Objects/UserAvatar'
import AccountGeneral from '@components/Objects/Account/subpages/AccountGeneral'
import AccountSecurity from '@components/Objects/Account/subpages/AccountSecurity'



function AccountClient() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const router = useRouter()

  const isAuthenticated = session?.status === 'authenticated'
  const isLoading = session?.status === 'loading'

  // Redirect unauthenticated users to login (mirror app/home/home.tsx).
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isLoading, isAuthenticated, router])

  const showLoader = isLoading || !isAuthenticated

  return (
    <div className="fixed inset-0 z-[100] bg-white overflow-y-auto">
      <Toaster toastOptions={{ className: 'lh-toast' }} />
      <div className="relative min-h-screen">
        {/* Blueprint grid, fades in from bottom */}
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0,0,0,0.035) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.035) 1px, transparent 1px),
              linear-gradient(rgba(0,0,0,0.018) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,0,0,0.018) 1px, transparent 1px)
            `,
            backgroundSize: '80px 80px, 80px 80px, 16px 16px, 16px 16px',
            maskImage: 'linear-gradient(to top, black 0%, transparent 60%)',
            WebkitMaskImage: 'linear-gradient(to top, black 0%, transparent 60%)',
          }}
        />

        <div className="relative z-10 min-h-screen px-4 py-8">
          <div className="w-full max-w-2xl mx-auto">
            {/* Top bar */}
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3 min-w-0">
                <Link
                  href="/home"
                  className="flex items-center justify-center w-9 h-9 rounded-xl bg-white nice-shadow text-black/50 hover:text-black transition-colors flex-shrink-0"
                  aria-label={t('account.back_home', { defaultValue: 'Back to organizations' })}
                >
                  <ArrowLeft size={16} />
                </Link>
                <div className="flex flex-col min-w-0">
                  <h1 className="text-lg font-black tracking-tight text-gray-900 truncate">
                    {t('account.title', { defaultValue: 'Account settings' })}
                  </h1>
                  <p className="text-xs text-black/40 truncate">
                    {t('account.subtitle', {
                      defaultValue: 'Manage your profile, security and account',
                    })}
                  </p>
                </div>
              </div>
              {isAuthenticated && (
                <UserAvatar border="border-2" rounded="rounded-full" width={36} />
              )}
            </div>

            {showLoader ? (
              <div className="space-y-4">
                <div className="h-40 w-full rounded-2xl bg-black/[0.03] animate-pulse" />
                <div className="h-40 w-full rounded-2xl bg-black/[0.03] animate-pulse" />
                <div className="h-28 w-full rounded-2xl bg-black/[0.03] animate-pulse" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* A. Profile: identity (first/last name, username, bio, avatar) */}
                <section className="space-y-2.5">
                  <div className="flex items-center gap-2 px-1">
                    <UserCog size={15} className="text-black/40" />
                    <h2 className="text-sm font-semibold text-gray-700">
                      {t('account.section.profile', { defaultValue: 'Profile' })}
                    </h2>
                  </div>
                  <AccountGeneral />
                </section>

                {/* B. Security: change password */}
                <section className="space-y-2.5">
                  <div className="flex items-center gap-2 px-1">
                    <KeyRound size={15} className="text-black/40" />
                    <h2 className="text-sm font-semibold text-gray-700">
                      {t('account.section.security', { defaultValue: 'Security' })}
                    </h2>
                  </div>
                  <AccountSecurity />
                </section>

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 z-[100] bg-white" />}>
      <AccountClient />
    </Suspense>
  )
}
