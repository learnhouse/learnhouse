'use client'

import React, { useEffect, useRef } from 'react'
import GeneralWrapperStyled from '@components/Objects/StyledElements/Wrappers/GeneralWrapper'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import { AccountSidebar } from '@components/Objects/Account/AccountSidebar'
import { AccountActionsMobile } from '@components/Objects/Account/AccountActionsMobile'
import { User } from 'lucide-react'
import { getUriWithOrg } from '@services/config/config'
import { useMediaQuery } from 'usehooks-ts'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useTranslation } from 'react-i18next'
import AccountGeneral from '@components/Objects/Account/subpages/AccountGeneral'
import AccountProfile from '@components/Objects/Account/subpages/AccountProfile'
import AccountSecurity from '@components/Objects/Account/subpages/AccountSecurity'
import AccountPurchases from '@components/Objects/Account/subpages/AccountPurchases'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

interface AccountClientProps {
  orgslug: string
  org_id: number
  subpage: string
}

const getSubpageTitle = (subpage: string, t: (key: string) => string): string => {
  const titles: Record<string, string> = {
    'general': t('account.general'),
    'profile': t('account.profile'),
    'security': t('account.security'),
    'purchases': t('account.purchases'),
  }
  return titles[subpage] || t('account.title')
}

const AccountClient = ({ orgslug, org_id, subpage }: AccountClientProps) => {
  const isMobile = useMediaQuery('(max-width: 768px)')
  const session = useLHSession() as any
  const user = session?.data?.user
  const { t } = useTranslation()
  const { track } = useLHAnalytics('learner')

  // Fire one impression per distinct subpage (component stays mounted across
  // subpage changes, so guard on the value rather than relying on remount).
  const lastSubpageRef = useRef<string | null>(null)
  useEffect(() => {
    if (lastSubpageRef.current === subpage) return
    lastSubpageRef.current = subpage
    track(AnalyticsEvent.AccountSubpageViewed, { subpage })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subpage])

  const renderSubpage = () => {
    switch (subpage) {
      case 'general':
        return <AccountGeneral />
      case 'profile':
        return <AccountProfile />
      case 'security':
        return <AccountSecurity />
      case 'purchases':
        return <AccountPurchases orgId={org_id} orgslug={orgslug} />
      default:
        return <AccountGeneral />
    }
  }

  return (
    <>
      <GeneralWrapperStyled>
        {/* Breadcrumbs */}
        <div className="pb-4">
          <Breadcrumbs
            items={[
              {
                label: t('account.title'),
                href: getUriWithOrg(orgslug, '/account'),
                icon: <User size={14} />,
              },
              { label: getSubpageTitle(subpage, t) },
            ]}
          />
        </div>

        {/* Layout - Sidebar Left, Content Right */}
        <div className="flex flex-col md:flex-row gap-6 pt-2">
          {/* Left Sidebar - User Info (Desktop only) */}
          <div className="hidden md:block w-full md:w-72 lg:w-80 flex-shrink-0">
            <div className="sticky top-24">
              <AccountSidebar orgslug={orgslug} currentSubpage={subpage} />
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Mobile only shows user name */}
            <div className="md:hidden mb-4">
              <h1 className="text-xl font-bold text-gray-900">
                {user?.first_name} {user?.last_name}
              </h1>
              <p className="mt-1 text-sm text-gray-500">@{user?.username}</p>
            </div>

            {/* Subpage Content */}
            {renderSubpage()}
          </div>
        </div>

        {/* Bottom padding for mobile action bar */}
        {isMobile && <div className="h-24" />}
      </GeneralWrapperStyled>

      {/* Mobile Actions Bar */}
      {isMobile && (
        <AccountActionsMobile orgslug={orgslug} currentSubpage={subpage} />
      )}
    </>
  )
}

export default AccountClient
