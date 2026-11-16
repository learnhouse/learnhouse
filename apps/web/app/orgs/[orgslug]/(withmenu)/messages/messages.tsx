'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMediaQuery } from 'usehooks-ts'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChatsCircle, NotePencil, UsersThree } from '@phosphor-icons/react'
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
import { Kbd, isTypingTarget, overlayOpen } from '@components/Messaging/ui/kit'
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
  const option = (key: string, icon: React.ReactNode, title: string, desc: string, onClick: () => void) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center rounded-2xl bg-white px-4 py-6 text-center ring-1 ring-inset ring-neutral-200/80 transition-all hover:-translate-y-px hover:shadow-md hover:ring-neutral-300"
    >
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700 transition-colors group-hover:bg-neutral-900 group-hover:text-white">
        {icon}
      </span>
      <span className="text-sm font-semibold text-neutral-900">{title}</span>
      <span className="mt-1 text-xs leading-relaxed text-neutral-500">{desc}</span>
    </button>
  )
  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-400">
        <ChatsCircle size={28} weight="fill" />
      </div>
      <h2 className="text-lg font-bold tracking-tight text-neutral-900">{t('messaging.empty_title', { defaultValue: 'Your messages' })}</h2>
      <p className="mt-1 max-w-sm text-sm text-neutral-500">
        {t('messaging.empty_desc', {
          defaultValue: 'Talk with classmates and teachers, follow course announcements, or ask an AI agent about anything you are learning.',
        })}
      </p>
      <div className="mt-7 grid w-full max-w-2xl gap-3 sm:grid-cols-3">
        {option(
          'new',
          <NotePencil size={20} weight="fill" />,
          t('messaging.new_message', { defaultValue: 'New message' }),
          t('messaging.new_message_hint', { defaultValue: 'Message someone or start a group' }),
          onNewMessage
        )}
        {defaultAgent &&
          option(
            'agent',
            <AgentAvatar agent={defaultAgent} size={22} />,
            t('messaging.ask_agent_title', { defaultValue: 'Ask {{name}}', name: defaultAgent.name }),
            t('messaging.ask_agent_hint', { defaultValue: 'Answers with sources from your courses' }),
            () => onAgent(defaultAgent)
          )}
        {option(
          'build',
          <UsersThree size={20} weight="fill" />,
          t('messaging.build_agent', { defaultValue: 'Build an agent' }),
          t('messaging.build_agent_hint', { defaultValue: 'Your own tutor, with its own style' }),
          onNewAgent
        )}
      </div>
      <div className="mt-8 hidden md:flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-neutral-400">
        <span className="inline-flex items-center gap-1.5">
          <Kbd>/</Kbd> {t('messaging.kbd_search_long', { defaultValue: 'Search' })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> {t('messaging.kbd_move_long', { defaultValue: 'Next / previous chat' })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>Alt</Kbd>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> {t('messaging.kbd_move_anywhere', { defaultValue: 'Switch chats while typing' })}
        </span>
      </div>
    </div>
  )
}

/**
 * On phones an open chat (or the agents gallery) covers the whole screen,
 * header and tab bar included, like a native messenger. It is portaled to the
 * body because the page content sits in its own stacking context, and it
 * follows the visual viewport so the composer rides on top of the keyboard.
 */
function PhoneScreen({ children }: { children: React.ReactNode }) {
  const [vv, setVv] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => {
    const v = window.visualViewport
    if (!v) return
    const update = () => setVv({ top: v.offsetTop, height: v.height })
    update()
    v.addEventListener('resize', update)
    v.addEventListener('scroll', update)
    return () => {
      v.removeEventListener('resize', update)
      v.removeEventListener('scroll', update)
    }
  }, [])
  // The page behind must not scroll while the screen is up.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])
  return createPortal(
    <div
      className="fixed inset-x-0 top-0 flex flex-col bg-white pt-[var(--lh-safe-top)] pb-[var(--lh-safe-bottom)]"
      style={{ zIndex: 'var(--z-nav-menu)', top: vv?.top ?? 0, height: vv ? vv.height : '100dvh' }}
    >
      {children}
    </div>,
    document.body
  )
}

function MessagesApp({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
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

  // Escape leaves the open chat (or the agents view) unless a field, menu or
  // dialog owns the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isTypingTarget(e.target) || overlayOpen()) return
      if (selected) select(null)
      else if (showAgents) setQuery({ agents: null })
    }
    // Capture phase: other page-level handlers stop Escape from bubbling.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [selected, showAgents, select, setQuery])

  const defaultAgent = useMemo(() => (Array.isArray(agents) ? agents : []).find((a) => a.is_default), [agents])
  const isPhone = useMediaQuery('(max-width: 767px)', { initializeWithValue: false })
  // Phones show either the list or one full-screen detail view.
  const detail = Boolean(selected || showAgents)

  const thread = selected ? (
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
    <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-8">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setQuery({ agents: null })}
          className="md:hidden -ms-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100"
          aria-label={t('common.back', { defaultValue: 'Back' })}
        >
          <ArrowLeft size={18} className="rtl:rotate-180" />
        </button>
        <div className="hidden md:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700">
          <UsersThree size={18} weight="fill" />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-neutral-900">{t('messaging.agents', { defaultValue: 'Agents' })}</h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            {t('messaging.agents_desc', { defaultValue: 'Assistants that answer from your courses, each with its own style.' })}
          </p>
        </div>
      </div>
      <div className="mt-6">
        <AgentsGallery orgslug={orgslug} onOpenChat={openConversation} />
      </div>
    </div>
  ) : (
    <EmptyState
      onNewMessage={() => setNewOpen(true)}
      onAgent={(a) => openAgent(a.agent_uuid)}
      onNewAgent={() => setBuilder({ open: true, agent: null })}
      defaultAgent={defaultAgent}
    />
  )

  return (
    // Phones: the list fills the space between the 60px header and the tab bar.
    // Desktop: one app surface, list and thread side by side.
    <div className="flex h-[calc(100dvh-60px-var(--lh-mobile-nav-h))] md:h-[calc(100dvh-72px)] w-full md:px-6 lg:px-8 md:pt-4 md:pb-5">
      <div className="flex min-w-0 flex-1 overflow-hidden bg-white md:rounded-2xl md:nice-shadow">
      <aside
        aria-label={t('messaging.conversations', { defaultValue: 'Conversations' })}
        className={`${detail ? 'hidden md:flex' : 'flex'} max-md:pb-[var(--lh-safe-bottom)] w-full md:w-[320px] lg:w-[340px] flex-shrink-0 flex-col bg-white md:border-e md:border-neutral-100 overflow-hidden`}
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

      {isPhone && detail ? (
        <PhoneScreen>{thread}</PhoneScreen>
      ) : (
        <section
          aria-label={t('messaging.conversation', { defaultValue: 'Conversation' })}
          data-messages-thread
          className="hidden md:flex flex-1 min-w-0 flex-col bg-white overflow-hidden"
        >
          {thread}
        </section>
      )}
      </div>

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
