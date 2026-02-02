'use client'
import { useOrgMembership } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { UserPlus } from 'lucide-react'
import { createContext, useContext } from 'react'
import { useTranslation } from 'react-i18next'

// Height of the banner in pixels
export const JOIN_BANNER_HEIGHT = 48

// Context to share banner visibility state
const JoinBannerContext = createContext<{ isVisible: boolean }>({ isVisible: false })

export function useJoinBannerVisible() {
  return useContext(JoinBannerContext)
}

export function OrgJoinBannerProvider({ children }: { children: React.ReactNode }) {
  const { isUserPartOfTheOrg } = useOrgMembership()
  const session = useLHSession() as any

  const shouldShow = session.status === 'authenticated' && !isUserPartOfTheOrg

  return (
    <JoinBannerContext.Provider value={{ isVisible: shouldShow }}>
      {children}
    </JoinBannerContext.Provider>
  )
}

export function OrgJoinBanner() {
  const { t } = useTranslation()
  const { org, isUserPartOfTheOrg, orgslug } = useOrgMembership()
  const session = useLHSession() as any

  // Only show banner for authenticated users who are not part of the org
  if (session.status !== 'authenticated' || isUserPartOfTheOrg) {
    return null
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 bg-gradient-to-r from-yellow-500 to-amber-500 text-white"
      style={{ zIndex: 'var(--z-nav-menu)', height: JOIN_BANNER_HEIGHT }}
    >
      <div className="w-full max-w-(--breakpoint-2xl) mx-auto px-4 sm:px-6 lg:px-8 flex items-center h-full">
        <div className="flex items-center space-x-3">
          <UserPlus size={20} className="flex-shrink-0" />
          <p className="text-sm font-medium">
            {t('banner.viewing_as_guest', { name: org?.name })}{' '}
            <a
              href={getUriWithOrg(orgslug, '/signup')}
              className="underline hover:no-underline font-bold"
            >
              {t('banner.join_organization')}
            </a>{' '}
            {t('banner.to_access_features')}
          </p>
        </div>
      </div>
    </div>
  )
}
