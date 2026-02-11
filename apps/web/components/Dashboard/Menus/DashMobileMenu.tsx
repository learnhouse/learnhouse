'use client'
import { useOrg } from '@components/Contexts/OrgContext'
import { Backpack, BadgeDollarSign, BookCopy, Headphones, Home, MessagesSquare, School, Settings, Users } from 'lucide-react'
import Link from 'next/link'
import React from 'react'
import { useTranslation } from 'react-i18next'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { isFeatureAvailable, PlanLevel } from '@services/plans/plans'

function DashMobileMenu() {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const plan: PlanLevel = org?.config?.config?.cloud?.plan || 'free'

  // Feature visibility: enabled by org AND allowed by plan
  const showCommunities = org?.config?.config?.features?.communities?.enabled !== false && isFeatureAvailable('communities', plan)
  const showPodcasts = org?.config?.config?.features?.podcasts?.enabled === true && isFeatureAvailable('podcasts', plan)
  const showPayments = org?.config?.config?.features?.payments?.enabled !== false && isFeatureAvailable('payments', plan)

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-black/90 backdrop-blur-lg text-white shadow-xl">
      <div className="flex justify-around items-center h-16 px-2">
        <AdminAuthorization authorizationMode="component">
          <ToolTip content={t('common.home')} slateBlack sideOffset={8} side="top">
            <Link href={`/`} className="flex flex-col items-center p-2" aria-label="Go to dashboard home">
              <Home size={20} />
              <span className="text-xs mt-1">{t('common.home')}</span>
            </Link>
          </ToolTip>
          <ToolTip content={t('courses.courses')} slateBlack sideOffset={8} side="top">
            <Link href={`/dash/courses`} className="flex flex-col items-center p-2" aria-label="Manage courses">
              <BookCopy size={20} />
              <span className="text-xs mt-1">{t('courses.courses')}</span>
            </Link>
          </ToolTip>
          <ToolTip content={t('common.assignments')} slateBlack sideOffset={8} side="top">
            <Link href={`/dash/assignments`} className="flex flex-col items-center p-2" aria-label="Manage assignments">
              <Backpack size={20} />
              <span className="text-xs mt-1">{t('common.assignments')}</span>
            </Link>
          </ToolTip>
          {showCommunities && (
            <ToolTip content={t('communities.title')} slateBlack sideOffset={8} side="top">
              <Link href={`/dash/communities`} className="flex flex-col items-center p-2" aria-label="Manage communities">
                <MessagesSquare size={20} />
                <span className="text-xs mt-1">{t('communities.title')}</span>
              </Link>
            </ToolTip>
          )}
          {showPodcasts && (
            <ToolTip content={t('podcasts.podcasts')} slateBlack sideOffset={8} side="top">
              <Link href={`/dash/podcasts`} className="flex flex-col items-center p-2" aria-label="Manage podcasts">
                <Headphones size={20} />
                <span className="text-xs mt-1">{t('podcasts.podcasts')}</span>
              </Link>
            </ToolTip>
          )}
          {showPayments && (
            <ToolTip content={t('common.payments')} slateBlack sideOffset={8} side="top">
              <Link href={`/dash/payments/customers`} className="flex flex-col items-center p-2" aria-label="Manage payments and billing">
                <BadgeDollarSign size={20} />
                <span className="text-xs mt-1">{t('common.payments')}</span>
              </Link>
            </ToolTip>
          )}
          <ToolTip content={t('common.users')} slateBlack sideOffset={8} side="top">
            <Link href={`/dash/users/settings/users`} className="flex flex-col items-center p-2" aria-label="Manage users">
              <Users size={20} />
              <span className="text-xs mt-1">{t('common.users')}</span>
            </Link>
          </ToolTip>
          <ToolTip content={t('common.organization')} slateBlack sideOffset={8} side="top">
            <Link href={`/dash/org/settings/general`} className="flex flex-col items-center p-2" aria-label="Organization settings">
              <School size={20} />
              <span className="text-xs mt-1">{t('common.organization')}</span>
            </Link>
          </ToolTip>
        </AdminAuthorization>
        <ToolTip content={t('common.settings')} slateBlack sideOffset={8} side="top">
          <Link href={'/account/general'} className="flex flex-col items-center p-2" aria-label="User account settings">
            <Settings size={20} />
            <span className="text-xs mt-1">{t('common.settings')}</span>
          </Link>
        </ToolTip>
      </div>
    </div>
  )
}

export default DashMobileMenu
