'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { ChatsCircle } from '@phosphor-icons/react'
import { getUriWithOrg } from '@services/config/config'
import { ConversationListSkeleton, ConversationRow } from '@components/Messaging/Sidebar/ConversationSidebar'
import { openInDock } from '@components/Messaging/Dock/dockBus'
import { useConversations } from '@components/Messaging/hooks'

const MAX = 12

/**
 * The inbox's Messages tab: the same conversation rows as the Messages page.
 * A conversation opens in the chat dock on desktop when it is on screen,
 * otherwise on the Messages page, exactly like the rest of the app.
 */
export default function MessagesPanel({ orgslug, onNavigate }: { orgslug: string; onNavigate?: () => void }) {
  const { t } = useTranslation()
  const router = useRouter()
  const { data, isLoading } = useConversations()
  const list = (data || []).filter((c) => !c.archived).slice(0, MAX)

  const open = (uuid: string) => {
    onNavigate?.()
    if (typeof window !== 'undefined' && window.innerWidth >= 768 && openInDock(uuid)) return
    router.push(getUriWithOrg(orgslug, `/messages?c=${uuid}`))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="inbox-messages">
      <div className="min-h-[200px] flex-1 overflow-y-auto overscroll-contain px-1.5 py-1.5">
        {isLoading ? (
          <ConversationListSkeleton rows={4} />
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center px-8 py-12 text-center">
            <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
              <ChatsCircle size={20} />
            </span>
            <p className="text-sm font-semibold text-neutral-900">{t('notifications.messages_empty_title')}</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">{t('notifications.messages_empty_body')}</p>
          </div>
        ) : (
          list.map((c) => <ConversationRow key={c.conversation_uuid} c={c} active={false} onClick={() => open(c.conversation_uuid)} />)
        )}
      </div>
      <Link
        href={getUriWithOrg(orgslug, '/messages')}
        onClick={onNavigate}
        className="flex h-11 shrink-0 items-center justify-center border-t border-neutral-100 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
      >
        {t('notifications.open_messages')}
      </Link>
    </div>
  )
}
