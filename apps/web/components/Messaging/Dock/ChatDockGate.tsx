'use client'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useMessaging, useMessagingEnabled } from '@components/Messaging/MessagingProvider'

// The dock brings the whole messaging UI (threads, markdown, code highlighting,
// charts). Its own checks ran only after that code had downloaded, so every
// visitor paid for it, signed out or not. The same checks, made here first,
// keep it from loading at all where it would render nothing.
const ChatDock = dynamic(() => import('@components/Messaging/Dock/ChatDock'), { ssr: false })

export default function ChatDockGate({ orgslug }: { orgslug: string }) {
  const enabled = useMessagingEnabled()
  const { token, orgId, userId } = useMessaging()
  const pathname = usePathname() || ''
  const onMessagesPage = pathname.split('/').includes('messages')
  if (!enabled || !token || !orgId || !userId || onMessagesPage) return null
  return <ChatDock orgslug={orgslug} />
}
