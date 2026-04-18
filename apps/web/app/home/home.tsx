'use client'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import UserAvatar from '@components/Objects/UserAvatar'
import { getAPIUrl, getUriWithOrg } from '@services/config/config'
import { swrFetcher } from '@services/utils/ts/requests'
import { signOut } from '@components/Contexts/AuthContext'
import { getOrgLogoMediaDirectory } from '@services/media/media'
import { ChevronRight, Languages, Check, LogOut, Settings, TentTree, LogIn } from 'lucide-react'
import Link from 'next/link'
import React, { useEffect } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { changeLanguage } from '@/lib/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from '@components/ui/dropdown-menu'
import { AVAILABLE_LANGUAGES } from '@/lib/languages'

function HomeClient() {
  const { t, i18n } = useTranslation()
  const session = useLHSession() as any
  const router = useRouter()
  const access_token = session?.data?.tokens?.access_token
  const isAuthenticated = session?.status === 'authenticated'
  const isLoading = session?.status === 'loading'

  const { data: orgs, isLoading: orgsLoading } = useSWR(
    isAuthenticated ? `${getAPIUrl()}orgs/user/page/1/limit/50` : null,
    (url) => swrFetcher(url, access_token)
  )

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login')
    }
  }, [isLoading, isAuthenticated, router])

  return (
    <div className="fixed inset-0 z-[100] bg-white overflow-y-auto">
      <div className="relative min-h-screen">
        {/* Blueprint grid — fades in from bottom */}
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

        <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 py-12">
          <div className="w-full max-w-md flex flex-col items-center">
            {/* Brand */}
            <div className="flex flex-col items-center mb-10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/lrn.svg"
                alt="LearnHouse"
                width={44}
                height={44}
                className="opacity-90"
              />
              <h1 className="mt-6 font-black tracking-tight text-2xl text-gray-900 text-center">
                {t('common.your_organizations')}
              </h1>
              <p className="mt-1.5 text-sm text-black/40 text-center">
                {t('common.choose_an_organization_to_continue', {
                  defaultValue: 'Choose an organization to continue',
                })}
              </p>
            </div>

            {/* User strip */}
            {isAuthenticated && (
              <div className="w-full mb-6 flex items-center justify-between bg-white rounded-2xl nice-shadow px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <UserAvatar border="border-2" rounded="rounded-full" width={36} />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold text-gray-900 truncate capitalize">
                      {session?.data?.user?.first_name} {session?.data?.user?.last_name}
                    </span>
                    <span className="text-xs text-black/40 truncate">
                      {session?.data?.user?.email}
                    </span>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={t('common.settings')}
                      className="p-2 rounded-lg text-black/40 hover:text-black hover:bg-black/[0.04] transition-colors"
                    >
                      <Settings size={16} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end">
                    <DropdownMenuLabel>
                      <div className="flex flex-col">
                        <p className="text-sm font-medium">
                          {session?.data?.user?.first_name} {session?.data?.user?.last_name}
                        </p>
                        <p className="text-xs text-gray-500">{session?.data?.user?.email}</p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="flex items-center space-x-2">
                        <Languages size={14} />
                        <span>{t('common.language')}</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuPortal>
                        <DropdownMenuSubContent>
                          {AVAILABLE_LANGUAGES.map((language) => (
                            <DropdownMenuItem
                              key={language.code}
                              onClick={() => changeLanguage(language.code)}
                              className="flex items-center justify-between"
                            >
                              <span>
                                {t(language.translationKey)} ({language.nativeName})
                              </span>
                              {i18n.language.split('-')[0] === language.code && <Check size={14} />}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuPortal>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => signOut({ redirect: true, callbackUrl: '/login' })}
                      className="flex items-center space-x-2 text-red-600 focus:text-red-600"
                    >
                      <LogOut size={16} />
                      <span>{t('user.sign_out')}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            {/* Org list */}
            <div className="w-full space-y-2.5">
              {(isLoading || (isAuthenticated && orgsLoading)) && (
                <>
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-[68px] w-full rounded-2xl bg-black/[0.03] animate-pulse"
                    />
                  ))}
                </>
              )}

              {!isLoading && !isAuthenticated && (
                <Link
                  href="/login"
                  className="w-full flex items-center justify-center gap-2 px-5 py-3.5 bg-gray-900 text-white rounded-2xl font-semibold text-sm nice-shadow hover:bg-gray-800 transition-colors"
                >
                  <LogIn size={16} />
                  {t('auth.sign_in', { defaultValue: 'Sign in' })}
                </Link>
              )}

              {isAuthenticated && orgs && orgs.length === 0 && (
                <div className="flex flex-col items-center justify-center py-14 px-6 bg-white rounded-2xl nice-shadow">
                  <TentTree className="text-black/10" size={64} />
                  <p className="mt-4 text-sm font-semibold text-black/50 text-center">
                    {t('common.no_orgs_message')}
                  </p>
                </div>
              )}

              {isAuthenticated &&
                orgs &&
                orgs.map((org: any) => {
                  const initial = (org.name || org.slug || '?').trim().charAt(0).toUpperCase()
                  return (
                  <Link
                    key={org.id ?? org.slug}
                    href={getUriWithOrg(org.slug, '/')}
                    className="flex items-center p-4 bg-white rounded-2xl nice-shadow hover:shadow-lg transition-all group"
                  >
                    {org.logo_image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)}
                        alt={org.name}
                        className="w-11 h-11 rounded-xl object-cover flex-shrink-0 ring-1 ring-inset ring-black/5"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-700 font-bold text-lg flex-shrink-0 ring-1 ring-inset ring-black/5">
                        {initial}
                      </div>
                    )}

                    <div className="ms-3 flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 tracking-tight truncate">
                        {org.name}
                      </div>
                      {org.description ? (
                        <p className="text-xs text-black/40 truncate mt-0.5">{org.description}</p>
                      ) : (
                        <p className="text-xs text-black/30 truncate mt-0.5">{org.slug}</p>
                      )}
                    </div>

                    <ChevronRight
                      size={18}
                      className="ms-3 text-black/25 group-hover:text-black/60 group-hover:translate-x-0.5 transition-all flex-shrink-0 rtl:-scale-x-100"
                    />
                  </Link>
                  )
                })}
            </div>

            {/* Footer */}
            <a
              href="https://learnhouse.app"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-10 flex items-center gap-1.5 text-[11px] text-black/30 hover:text-black/60 transition-colors"
            >
              <span>{t('common.powered_by', { defaultValue: 'Powered by' })}</span>
              <span className="font-semibold tracking-tight text-black/50 group-hover:text-black/70">LearnHouse</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default HomeClient
