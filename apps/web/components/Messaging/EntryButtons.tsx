'use client'

import React from 'react'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/DashKit'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { ChatCircleText, PaperPlaneTilt } from '@phosphor-icons/react'
import { useMessaging, useMessagingEnabled } from '@components/Messaging/MessagingProvider'
import { openInDock } from '@components/Messaging/Dock/dockBus'
import { createConversation } from '@services/messaging/messaging'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'

function useSignedIn() {
  const session = useLHSession() as any
  return session?.status === 'authenticated' || Boolean(session?.data?.user?.id)
}

/** "Share in Messages" for the public course page. */
export function ShareCourseInMessagesButton({ orgslug, courseUuid }: { orgslug: string; courseUuid: string }) {
  const { t } = useTranslation()
  const enabled = useMessagingEnabled()
  const signedIn = useSignedIn()
  if (!enabled || !signedIn) return null
  return (
    <Link
      href={getUriWithOrg(orgslug, `/messages?share=${encodeURIComponent(courseUuid)}`)}
      className={buttonClass('secondary', 'md')}
    >
      <PaperPlaneTilt size={15} />
      {t('messaging.share_in_messages', { defaultValue: 'Share in Messages' })}
    </Link>
  )
}

/** "Message" on a member's public profile. */
export function MessageUserButton({ orgslug: slug, userUuid, userId }: { orgslug?: string; userUuid: string; userId: number }) {
  const { t } = useTranslation()
  const params = useParams() as any
  const orgslug = slug || params?.orgslug
  const enabled = useMessagingEnabled()
  const { orgId, token } = useMessaging()
  const session = useLHSession() as any
  const me = session?.data?.user?.id
  if (!enabled || !me || me === userId) return null

  // Open the DM in the chat dock when it's on screen; otherwise the link goes to Messages.
  const openHere = async (e: React.MouseEvent) => {
    if (!orgId || !token || e.metaKey || e.ctrlKey || window.innerWidth < 768) return
    e.preventDefault()
    try {
      const conv = await createConversation({ org_id: orgId, kind: 'dm', user_uuids: [userUuid] }, token)
      if (!openInDock(conv.conversation_uuid)) window.location.href = getUriWithOrg(orgslug, `/messages?c=${conv.conversation_uuid}`)
    } catch {
      window.location.href = getUriWithOrg(orgslug, `/messages?to=${encodeURIComponent(userUuid)}`)
    }
  }

  return (
    <Link
      onClick={openHere}
      href={getUriWithOrg(orgslug, `/messages?to=${encodeURIComponent(userUuid)}`)}
      className={buttonClass('primary', 'md')}
    >
      <ChatCircleText size={16} weight="fill" />
      {t('messaging.message', { defaultValue: 'Message' })}
    </Link>
  )
}
