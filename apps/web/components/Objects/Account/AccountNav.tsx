'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Bell, CircleHalf, IconContext, Notepad, Plugs, Receipt, ShieldCheck, UserCircle } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import UserAvatar from '@components/Objects/UserAvatar'
import { getUriWithOrg } from '@services/config/config'

export type AccountSection = 'general' | 'security' | 'notifications' | 'appearance' | 'notes' | 'purchases' | 'ai-apps'

export const ACCOUNT_SECTIONS: { id: AccountSection; icon: React.ElementType; labelKey: string }[] = [
  { id: 'general', icon: UserCircle, labelKey: 'account.profile' },
  { id: 'security', icon: ShieldCheck, labelKey: 'account.security' },
  { id: 'notifications', icon: Bell, labelKey: 'notifications.title' },
  { id: 'appearance', icon: CircleHalf, labelKey: 'account.appearance' },
  { id: 'notes', icon: Notepad, labelKey: 'notes.title' },
  { id: 'purchases', icon: Receipt, labelKey: 'account.purchases' },
  { id: 'ai-apps', icon: Plugs, labelKey: 'account.ai_apps' },
]

// Tab and nav icons use Phosphor's duotone (semi-filled) weight.
const DUOTONE = { weight: 'duotone' as const }

/**
 * The account section nav: a sticky list on the start side from md up, an
 * underlined row that scrolls inside itself on phones. The active item follows
 * the org accent (lh-accent tokens resolve to neutral outside a themed org).
 */
export function AccountNav({ orgslug, current }: { orgslug: string; current: AccountSection }) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const user = session?.data?.user
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(' ')

  return (
    <IconContext.Provider value={DUOTONE}>
      {/* Desktop: identity + vertical list */}
      <div className="hidden md:block">
        <div className="flex items-center gap-3 px-1 pb-5">
          <UserAvatar border="border-2" rounded="rounded-full" width={40} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-neutral-900 truncate" dir="auto">
              {fullName || user?.username}
            </p>
            {user?.username && <p className="text-xs text-neutral-500 truncate">@{user.username}</p>}
          </div>
        </div>
        <nav aria-label={t('account.title')} className="flex flex-col gap-0.5">
          {ACCOUNT_SECTIONS.map(({ id, icon: Icon, labelKey }) => {
            const active = id === current
            return (
              <Link
                key={id}
                href={getUriWithOrg(orgslug, `/account/${id}`)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2.5 h-9 px-3 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20 ${
                  active
                    ? 'bg-white text-neutral-900 nice-shadow'
                    : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-200/50'
                }`}
              >
                <Icon size={18} className={active ? 'text-lh-accent-ink' : 'text-neutral-400'} />
                <span className="truncate">{t(labelKey)}</span>
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Phone: underlined row, scrolls inside itself */}
      <nav aria-label={t('account.title')} className="md:hidden -mx-4 px-4 sm:-mx-6 sm:px-6 border-b border-neutral-200">
        <div className="flex gap-5 overflow-x-auto scrollbar-hide">
          {ACCOUNT_SECTIONS.map(({ id, icon: Icon, labelKey }) => {
            const active = id === current
            return (
              <Link
                key={id}
                href={getUriWithOrg(orgslug, `/account/${id}`)}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px flex items-center gap-1.5 shrink-0 whitespace-nowrap py-3 text-sm font-semibold border-b-2 transition-colors ${
                  active ? 'border-lh-accent text-neutral-900' : 'border-transparent text-neutral-500 hover:text-neutral-800'
                }`}
              >
                <Icon size={16} className={active ? 'text-lh-accent-ink' : 'text-neutral-400'} />
                {t(labelKey)}
              </Link>
            )
          })}
        </div>
      </nav>
    </IconContext.Provider>
  )
}

export default AccountNav
