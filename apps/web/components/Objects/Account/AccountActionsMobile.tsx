'use client'
import React from 'react'
import Link from 'next/link'
import { User, Lock, ShoppingBag, Plug, Settings } from 'lucide-react'
import { getUriWithOrg } from '@services/config/config'
import { useTranslation } from 'react-i18next'

interface AccountActionsMobileProps {
  orgslug: string
  currentSubpage: string
}

const NAV_ITEMS = [
  { id: 'general', icon: Settings, labelKey: 'account.general' },
  { id: 'profile', icon: User, labelKey: 'account.profile' },
  { id: 'security', icon: Lock, labelKey: 'account.security' },
  { id: 'purchases', icon: ShoppingBag, labelKey: 'account.purchases' },
  { id: 'ai-apps', icon: Plug, labelKey: 'account.ai_apps' },
]

export function AccountActionsMobile({ orgslug, currentSubpage }: AccountActionsMobileProps) {
  const { t } = useTranslation()

  return (
    // A swipeable segment row under the page title. The phone tab bar already
    // owns the bottom edge, so this no longer floats there.
    <nav aria-label={t('account.mobile_actions')} className="md:hidden -mx-4 px-4 sm:-mx-6 sm:px-6">
      <div className="lh-scroll-x gap-2 py-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = currentSubpage === item.id
          return (
            <Link
              key={item.id}
              href={getUriWithOrg(orgslug, `/account/${item.id}`)}
              aria-current={isActive ? 'page' : undefined}
              className={`lh-press flex items-center gap-1.5 h-9 px-3.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 nice-shadow'
              }`}
            >
              <Icon size={15} />
              {t(item.labelKey)}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

export default AccountActionsMobile
