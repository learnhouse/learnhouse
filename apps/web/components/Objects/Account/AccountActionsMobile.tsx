'use client'
import React from 'react'
import Link from 'next/link'
import { User, Lock, BookOpen, Settings } from 'lucide-react'
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
  { id: 'my-courses', icon: BookOpen, labelKey: 'account.my_courses' },
]

export function AccountActionsMobile({ orgslug, currentSubpage }: AccountActionsMobileProps) {
  const { t } = useTranslation()

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
      <div className="mx-3 mb-4 bg-white/95 backdrop-blur-sm rounded-xl nice-shadow p-2">
        <div className="flex items-center justify-around">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const isActive = currentSubpage === item.id
            return (
              <Link
                key={item.id}
                href={getUriWithOrg(orgslug, `/account/${item.id}`)}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon size={18} />
                <span className="text-[10px] font-medium truncate max-w-[60px]">
                  {t(item.labelKey)}
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default AccountActionsMobile
