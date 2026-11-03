'use client'

/**
 * Reminders in Messages: the bell that lists what's coming up (and lets you
 * cancel it), and the "Remind me" menu on any message.
 */

import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, BellSimpleSlash, Clock } from '@phosphor-icons/react'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import { useMessaging } from '@components/Messaging/MessagingProvider'
import { formatDue } from '@components/Messaging/Rich/MoreBlocks'
import { cancelReminder, createReminder, listReminders, type ChatMessage } from '@services/messaging/messaging'

export const remindersKey = (orgId: number) => ['messaging', orgId, 'reminders'] as const

export function useReminders() {
  const { orgId, token, enabled } = useMessaging()
  return useQuery({
    queryKey: remindersKey(orgId ?? 0),
    queryFn: () => listReminders(orgId!, token!),
    enabled: Boolean(enabled && orgId && token),
    staleTime: 30_000,
  })
}

/** Bell button with upcoming and recently delivered reminders. */
export function RemindersButton({ onOpenConversation }: { onOpenConversation?: (uuid: string) => void }) {
  const { token, orgId } = useMessaging()
  const qc = useQueryClient()
  const { data: reminders = [] } = useReminders()
  const upcoming = reminders.filter((r) => r.status === 'pending')
  const sent = reminders.filter((r) => r.status === 'sent').slice(0, 5)
  const [open, setOpen] = useState(false)

  const cancel = async (uuid: string) => {
    if (!token) return
    await cancelReminder(uuid, token)
    qc.invalidateQueries({ queryKey: remindersKey(orgId ?? 0) })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          title="Reminders"
          aria-label={upcoming.length ? `Reminders, ${upcoming.length} upcoming` : 'Reminders'}
        >
          <Bell size={18} weight="fill" />
          {upcoming.length > 0 && (
            <span className="absolute top-1 end-1 h-2 w-2 rounded-full bg-gray-900 ring-2 ring-white" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-gray-100 px-4 py-3">
          <p className="text-sm font-semibold text-gray-900">Reminders</p>
          <p className="text-xs text-gray-500">Ask any agent to remind you, or use "Remind me" on a message.</p>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {upcoming.length === 0 && sent.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-gray-500">Nothing scheduled.</p>
          )}
          {upcoming.map((r) => (
            <div key={r.reminder_uuid} className="group flex items-start gap-3 px-4 py-2 hover:bg-gray-50">
              <Clock size={16} className="mt-0.5 shrink-0 text-gray-500" />
              <button
                className="min-w-0 flex-1 text-start"
                onClick={() => {
                  if (r.conversation_uuid) onOpenConversation?.(r.conversation_uuid)
                  setOpen(false)
                }}
              >
                <p className="truncate text-sm font-medium text-gray-900">{r.text}</p>
                <p className="text-xs text-gray-500">{formatDue(r.due_at)}</p>
              </button>
              <button
                onClick={() => cancel(r.reminder_uuid)}
                className="rounded-md p-1 text-gray-400 opacity-0 hover:bg-gray-100 hover:text-gray-700 group-hover:opacity-100"
                title="Cancel reminder"
              >
                <BellSimpleSlash size={15} />
              </button>
            </div>
          ))}
          {sent.length > 0 && (
            <>
              <p className="px-4 pt-3 pb-1 text-xs font-medium text-gray-400">Sent</p>
              {sent.map((r) => (
                <div key={r.reminder_uuid} className="flex items-start gap-3 px-4 py-2 opacity-70">
                  <Bell size={16} className="mt-0.5 shrink-0 text-gray-400" />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-700">{r.text}</p>
                    <p className="text-xs text-gray-400">{formatDue(r.due_at)}</p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function at(hour: number, addDays: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + addDays)
  d.setHours(hour, 0, 0, 0)
  return d
}

function nextMonday9(): Date {
  const d = at(9, 0)
  const add = ((8 - d.getDay()) % 7) || 7
  d.setDate(d.getDate() + add)
  return d
}

const PRESETS: { label: string; when: () => Date }[] = [
  { label: 'In 20 minutes', when: () => new Date(Date.now() + 20 * 60_000) },
  { label: 'In 1 hour', when: () => new Date(Date.now() + 60 * 60_000) },
  { label: 'Tomorrow at 9:00', when: () => at(9, 1) },
  { label: 'Next Monday at 9:00', when: () => nextMonday9() },
]

/** "Remind me about this message" with quick presets. */
export function RemindMeMenu({ message, children }: { message: ChatMessage; children: React.ReactElement }) {
  const { token, orgId } = useMessaging()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const snippet = (message.content || message.attachment?.course?.name || 'this message').replace(/\s+/g, ' ').slice(0, 120)

  const pick = async (when: Date) => {
    if (!token || !orgId) return
    setError(null)
    try {
      const r = await createReminder(orgId, { text: snippet, due_at: when.toISOString(), message_uuid: message.message_uuid }, token)
      qc.invalidateQueries({ queryKey: remindersKey(orgId) })
      setDone(formatDue(r.due_at))
      setTimeout(() => {
        setOpen(false)
        setDone(null)
      }, 1200)
    } catch (e: any) {
      setError(e?.message || 'Could not set the reminder')
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        {done ? (
          <p className="px-3 py-2 text-sm text-gray-700">Reminder set for {done}</p>
        ) : (
          <>
            <p className="px-3 pt-2 pb-1 text-xs font-medium text-gray-500">Remind me</p>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => pick(p.when())}
                className="w-full rounded-md px-3 py-1.5 text-start text-sm text-gray-700 hover:bg-gray-100"
              >
                {p.label}
              </button>
            ))}
            {error && <p className="px-3 py-1.5 text-xs text-red-600">{error}</p>}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
