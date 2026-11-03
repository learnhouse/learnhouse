'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { ChatsCircle, NotePencil, UsersThree } from '@phosphor-icons/react'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { messagingKeys, useMessaging, useMessagingEnabled } from '@components/Messaging/MessagingProvider'
import { useAgents, useOrgCourses } from '@components/Messaging/hooks'
import ConversationSidebar from '@components/Messaging/Sidebar/ConversationSidebar'
import Thread from '@components/Messaging/Thread/Thread'
import NewConversationDialog from '@components/Messaging/Dialogs/NewConversationDialog'
import BroadcastDialog from '@components/Messaging/Dialogs/BroadcastDialog'
import SettingsDialog from '@components/Messaging/Dialogs/SettingsDialog'
import AgentBuilderDialog from '@components/Messaging/Agents/AgentBuilderDialog'
import AgentAvatar from '@components/Messaging/Agents/AgentAvatar'
import AgentsGallery from '@components/Messaging/Agents/AgentsGallery'
import {
  Agent,
  Conversation,
  CourseCard,
  createConversation,
  listAgents,
  openAgentChat,
} from '@services/messaging/messaging'

function EmptyState({
  onNewMessage,
  onAgent,
  onNewAgent,
  defaultAgent,
}: {
  onNewMessage: () => void
  onAgent: (a: Agent) => void
  onNewAgent: () => void
  defaultAgent: Agent | undefined
}) {
  const { t } = useTranslation()
  const option = (icon: React.ReactNode, title: string, desc: string, onClick: () => void) => (
    <button
      onClick={onClick}
      className="flex flex-col items-center rounded-xl border border-gray-200 bg-white px-4 py-5 text-center transition-colors hover:border-gray-300 hover:bg-gray-50/60"
    >
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-gray-50 text-gray-600">{icon}</span>
      <span className="text-sm font-semibold text-gray-900">{title}</span>
      <span className="mt-1 text-xs text-gray-500">{desc}</span>
    </button>
  )
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white nice-shadow text-gray-400">
        <ChatsCircle size={26} weight="fill" />
      </div>
      <h2 className="text-lg font-bold text-gray-700">{t('messaging.empty_title', { defaultValue: 'Your messages' })}</h2>
      <p className="mt-1 max-w-sm text-sm text-gray-400">
        {t('messaging.empty_desc', {
          defaultValue: 'Talk with classmates and teachers, follow course announcements, or ask an AI agent about anything you are learning.',
        })}
      </p>
      <div className="mt-6 grid w-full max-w-xl gap-3 sm:grid-cols-3">
        {option(<NotePencil size={20} weight="fill" />, t('messaging.new_message', { defaultValue: 'New message' }), 'Message someone or start a group', onNewMessage)}
        {defaultAgent &&
          option(<AgentAvatar agent={defaultAgent} size={22} />, `Ask ${defaultAgent.name}`, 'Answers with sources from your courses', () => onAgent(defaultAgent))}
        {option(<UsersThree size={20} weight="fill" />, 'Build an agent', 'Your own tutor, with its own style', onNewAgent)}
      </div>
    </div>
  )
}

function MessagesApp({ orgslug }: { orgslug: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const qc = useQueryClient()
  const { orgId, token } = useMessaging()
  const { data: agents = [] } = useAgents()
  const selected = params.get('c')
  const focus = params.get('m')
  const shareUuid = params.get('share')
  const showAgents = params.get('agents') === '1'

  const [newOpen, setNewOpen] = useState(false)
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(params.get('settings') === 'notifications')
  const [builder, setBuilder] = useState<{ open: boolean; agent: Agent | null }>({ open: false, agent: null })
  const [shareCourse, setShareCourse] = useState<CourseCard | null>(null)
  const handled = useRef<string>('')

  const setQuery = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(next)) {
        if (v === null) sp.delete(k)
        else sp.set(k, v)
      }
      const qs = sp.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
    },
    [params, pathname, router]
  )

  const select = useCallback(
    (uuid: string | null, focusMessage?: string) =>
      setQuery({ c: uuid, m: focusMessage ?? null, agent: null, agents: null, to: null, share: null, settings: null }),
    [setQuery]
  )

  const openConversation = useCallback(
    (c: Conversation) => {
      qc.invalidateQueries({ queryKey: messagingKeys.conversations(orgId ?? 0) })
      select(c.conversation_uuid)
    },
    [qc, orgId, select]
  )

  const openAgent = useCallback(
    async (agentUuid: string, fresh = false) => {
      if (!token) return
      const conv = await openAgentChat(agentUuid, token, fresh)
      if (fresh) qc.removeQueries({ queryKey: messagingKeys.messages(conv.conversation_uuid) })
      openConversation(conv)
    },
    [token, openConversation, qc]
  )

  // Deep links: ?agent=, ?to=, ?share=
  const { data: courses = [] } = useOrgCourses(orgslug, Boolean(shareUuid))
  useEffect(() => {
    if (!token || !orgId) return
    const agentParam = params.get('agent')
    const toParam = params.get('to')
    const key = `${agentParam}|${toParam}`
    if ((agentParam || toParam) && handled.current !== key) {
      handled.current = key
      ;(async () => {
        try {
          if (agentParam) {
            let uuid = agentParam
            if (agentParam === 'default') {
              const list = await listAgents(orgId, token)
              uuid = list.find((a) => a.is_default)?.agent_uuid || list[0]?.agent_uuid
            }
            if (uuid) await openAgent(uuid)
          } else if (toParam) {
            const conv = await createConversation({ org_id: orgId, kind: 'dm', user_uuids: [toParam] }, token)
            openConversation(conv)
          }
        } catch {
          setQuery({ agent: null, to: null })
        }
      })()
    }
  }, [params, token, orgId, openAgent, openConversation, setQuery])

  useEffect(() => {
    if (!shareUuid || !courses.length) return
    const c = courses.find((x) => x.course_uuid === shareUuid || x.course_uuid === `course_${shareUuid}`)
    if (c) {
      setShareCourse({ course_uuid: c.course_uuid, name: c.name, description: c.description || '', thumbnail_image: c.thumbnail_image || '' })
      setNewOpen(true)
    }
  }, [shareUuid, courses])

  useEffect(() => {
    if (params.get('settings') === 'notifications') setSettingsOpen(true)
  }, [params])

  const defaultAgent = useMemo(() => agents.find((a) => a.is_default), [agents])

  return (
    <div className="flex h-[calc(100dvh-72px)] w-full max-w-(--breakpoint-2xl) mx-auto px-0 sm:px-4 md:px-6 lg:px-8 gap-3 md:py-5">
      <aside
        className={`${selected ? 'hidden md:flex' : 'flex'} w-full md:w-[340px] lg:w-[360px] flex-shrink-0 flex-col bg-white md:rounded-xl md:shadow-md md:shadow-gray-300/25 md:outline md:outline-1 md:outline-gray-200/40 overflow-hidden`}
      >
        <ConversationSidebar
          orgslug={orgslug}
          selected={selected}
          onSelect={select}
          onNewMessage={() => {
            setShareCourse(null)
            setNewOpen(true)
          }}
          onAnnounce={() => setBroadcastOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onNewAgent={() => setBuilder({ open: true, agent: null })}
          onOpenAgentChat={openConversation}
        />
      </aside>

      <section aria-label="Conversation" data-messages-thread className={`${selected ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col bg-white md:rounded-xl md:shadow-md md:shadow-gray-300/25 md:outline md:outline-1 md:outline-gray-200/40 overflow-hidden`}>
        {selected ? (
          <Thread
            key={selected}
            uuid={selected}
            orgslug={orgslug}
            focusMessageUuid={focus}
            onBack={() => select(null)}
            onLeft={() => select(null)}
            onOpenConversation={openConversation}
            onEditAgent={(agent) => setBuilder({ open: true, agent })}
            onNewAgentChat={(uuid) => openAgent(uuid, true)}
          />
        ) : showAgents ? (
          <div className="flex-1 overflow-y-auto p-5 sm:p-8">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white nice-shadow">
                <UsersThree size={16} weight="fill" className="text-black" />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-gray-900">Agents</h2>
            </div>
            <p className="mt-2 mb-6 text-sm text-gray-500">
              Assistants that answer from your courses, each with its own style.
            </p>
            <AgentsGallery orgslug={orgslug} onOpenChat={openConversation} />
          </div>
        ) : (
          <EmptyState
            onNewMessage={() => setNewOpen(true)}
            onAgent={(a) => openAgent(a.agent_uuid)}
            onNewAgent={() => setBuilder({ open: true, agent: null })}
            defaultAgent={defaultAgent}
          />
        )}
      </section>

      <NewConversationDialog
        open={newOpen}
        onOpenChange={(o) => {
          setNewOpen(o)
          if (!o && shareUuid) setQuery({ share: null })
        }}
        shareCourse={shareCourse}
        onCreated={openConversation}
      />
      <BroadcastDialog open={broadcastOpen} onOpenChange={setBroadcastOpen} onSent={openConversation} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(o) => {
          setSettingsOpen(o)
          if (!o && params.get('settings')) setQuery({ settings: null })
        }}
      />
      <AgentBuilderDialog
        open={builder.open}
        agent={builder.agent}
        orgslug={orgslug}
        onOpenChange={(open) => setBuilder((b) => ({ ...b, open }))}
        onSaved={(agent) => {
          qc.invalidateQueries({ queryKey: messagingKeys.agents(orgId ?? 0) })
          qc.invalidateQueries({ queryKey: ['messaging', 'agent', agent.agent_uuid] })
          if (!builder.agent) openAgent(agent.agent_uuid)
        }}
      />
    </div>
  )
}

export default function MessagesClient({ orgslug }: { orgslug: string }) {
  const enabled = useMessagingEnabled()
  return (
    <AuthenticatedClientElement checkMethod="authentication">
      {enabled ? (
        <MessagesApp orgslug={orgslug} />
      ) : (
        <div className="max-w-3xl mx-auto px-4 py-16">
          <FeatureGate feature="messaging" orgslug={orgslug} context="public">
            <MessagesApp orgslug={orgslug} />
          </FeatureGate>
        </div>
      )}
    </AuthenticatedClientElement>
  )
}
