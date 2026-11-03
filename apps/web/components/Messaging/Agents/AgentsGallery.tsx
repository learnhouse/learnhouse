'use client'

import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Books, ChatCircleText, GlobeSimple, PencilSimple, Plus, SpinnerGap, UsersThree } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { messagingKeys } from '@components/Messaging/MessagingProvider'
import { type Agent, type Conversation, listAgents, openAgentChat } from '@services/messaging/messaging'
import AgentAvatar from './AgentAvatar'
import AgentBuilderDialog, { TONES } from './AgentBuilderDialog'

export type AgentsGalleryProps = {
  orgslug: string
  /** Called with the agent chat to open after the person picks an agent. */
  onOpenChat: (_conversation: Conversation) => void
  /** Compact list for a sidebar instead of the full grid. */
  compact?: boolean
}

export function useAgents() {
  const org = useOrg() as any
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  return useQuery({
    queryKey: messagingKeys.agents(org?.id ?? 0),
    queryFn: () => listAgents(org.id, token!),
    enabled: Boolean(org?.id && token),
    staleTime: 60_000,
  })
}

function groupAgents(agents: Agent[]) {
  return [
    { key: 'default', label: 'Default', items: agents.filter((a) => a.is_default) },
    { key: 'mine', label: 'Yours', items: agents.filter((a) => !a.is_default && a.mine) },
    { key: 'org', label: 'Shared with everyone', items: agents.filter((a) => !a.is_default && !a.mine) },
  ].filter((g) => g.items.length > 0)
}

function AgentCard({
  agent,
  busy,
  onChat,
  onEdit,
}: {
  agent: Agent
  busy: boolean
  onChat: () => void
  onEdit?: () => void
}) {
  const tone = TONES.find((t) => t.value === agent.tone)?.label
  const chip = 'inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600'
  return (
    <div className="group relative flex flex-col rounded-xl bg-white nice-shadow p-4">
      <div className="flex items-start gap-3">
        <AgentAvatar agent={agent} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-base font-bold text-gray-900">{agent.name}</p>
            {agent.is_default && <span className={chip}>Built in</span>}
          </div>
          <p className="mt-0.5 line-clamp-2 min-h-[2.5em] text-xs text-gray-500">
            {agent.description || 'No description yet.'}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {tone && <span className={chip}>{tone}</span>}
        <span className={chip}>
          {agent.knowledge_mode === 'general' ? <GlobeSimple size={11} /> : <BookOpen size={11} />}
          {agent.knowledge_mode === 'general' ? 'Courses + general' : 'Courses only'}
        </span>
        <span className={chip}>
          <Books size={11} />
          {agent.course_uuids.length ? `${agent.course_uuids.length} course${agent.course_uuids.length === 1 ? '' : 's'}` : 'All courses'}
        </span>
        {agent.visibility === 'org' && !agent.is_default && (
          <span className={chip}>
            <UsersThree size={11} />
            Shared
          </span>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-900"
            aria-label={`Edit ${agent.name}`}
          >
            <PencilSimple size={11} weight="bold" />
            Edit
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onChat}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
        >
          {busy ? <SpinnerGap size={13} className="animate-spin" /> : <ChatCircleText size={14} weight="fill" />}
          Chat
        </button>
      </div>
    </div>
  )
}

export default function AgentsGallery({ orgslug, onOpenChat, compact = false }: AgentsGalleryProps) {
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const { data: agents, isLoading } = useAgents()
  const [builderOpen, setBuilderOpen] = useState(false)
  const [editing, setEditing] = useState<Agent | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = async (agent: Agent) => {
    if (!token) return
    setOpening(agent.agent_uuid)
    setError(null)
    try {
      onOpenChat(await openAgentChat(agent.agent_uuid, token))
    } catch (e: any) {
      setError(e?.message || 'Could not open the chat')
    } finally {
      setOpening(null)
    }
  }

  const startCreate = () => {
    setEditing(null)
    setBuilderOpen(true)
  }

  const builder = (
    <AgentBuilderDialog
      open={builderOpen}
      onOpenChange={setBuilderOpen}
      agent={editing}
      orgslug={orgslug}
      onSaved={(saved) => {
        if (!editing) open(saved)
      }}
    />
  )

  if (compact) {
    return (
      <div className="space-y-0.5">
        {isLoading && <div className="px-3 py-2 text-xs text-gray-400">Loading agents…</div>}
        {(agents || []).map((agent) => (
          <div key={agent.agent_uuid} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-gray-50">
            <button type="button" onClick={() => open(agent)} className="flex items-center gap-2.5 min-w-0 flex-1 text-start">
              <AgentAvatar agent={agent} size={30} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-900 truncate">{agent.name}</span>
                <span className="block text-xs text-gray-500 truncate">{agent.description || 'Agent'}</span>
              </span>
              {opening === agent.agent_uuid && <SpinnerGap size={13} className="animate-spin text-gray-400 shrink-0" />}
            </button>
            {agent.can_edit && (
              <button
                type="button"
                onClick={() => {
                  setEditing(agent)
                  setBuilderOpen(true)
                }}
                className="p-1 rounded-md text-gray-400 opacity-0 group-hover:opacity-100 hover:text-gray-900 hover:bg-white"
                aria-label={`Edit ${agent.name}`}
              >
                <PencilSimple size={13} weight="bold" />
              </button>
            )}
          </div>
        ))}
        {error && <p className="px-2 text-xs text-red-600">{error}</p>}
        {builder}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <SpinnerGap size={14} className="animate-spin" />
          Loading agents…
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {groupAgents(agents || []).map((group, gi) => (
        <section key={group.key}>
          <h3 className="text-sm font-semibold text-gray-900 mb-2.5">{group.label}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {group.items.map((agent) => (
              <AgentCard
                key={agent.agent_uuid}
                agent={agent}
                busy={opening === agent.agent_uuid}
                onChat={() => open(agent)}
                onEdit={
                  agent.can_edit
                    ? () => {
                        setEditing(agent)
                        setBuilderOpen(true)
                      }
                    : undefined
                }
              />
            ))}
            {gi === 0 && (
              <button
                type="button"
                onClick={startCreate}
                className="flex flex-col items-center justify-center gap-2 min-h-[180px] rounded-xl border border-dashed border-gray-300 bg-gray-50/50 text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors"
              >
                <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-white nice-shadow">
                  <Plus size={20} weight="bold" />
                </span>
                <span className="text-sm font-semibold text-gray-700">Create agent</span>
                <span className="text-xs text-gray-400 max-w-[200px] text-center">
                  Pick a name, colors and a personality. It answers from your courses.
                </span>
              </button>
            )}
          </div>
        </section>
      ))}
      {builder}
    </div>
  )
}
