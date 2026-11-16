'use client'

/**
 * Reminders in Messages: the bell that lists what's coming up (and lets you
 * cancel it), and the "Remind me" menu on any message.
 */

import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Bell, BellSimpleSlash, Clock } from '@phosphor-icons/react'
import { IconButton } from '@components/Messaging/ui/kit'
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
  const { t } = useTranslation()
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
        <IconButton
          label={
            upcoming.length
              ? t('messaging.reminders_upcoming', { defaultValue: 'Reminders, {{count}} upcoming', count: upcoming.length })
              : t('messaging.reminders', { defaultValue: 'Reminders' })
          }
          className="relative"
        >
          <Bell size={17} />
          {upcoming.length > 0 && <span className="absolute top-1.5 end-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 overflow-hidden rounded-xl p-0">
        <div className="border-b border-neutral-100 px-4 py-3">
          <p className="text-sm font-semibold text-neutral-900">{t('messaging.reminders', { defaultValue: 'Reminders' })}</p>
          <p className="text-xs text-neutral-500">
            {t('messaging.reminders_desc', { defaultValue: 'Ask any agent to remind you, or use "Remind me" on a message.' })}
          </p>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {upcoming.length === 0 && sent.length === 0 && (
            <div className="flex flex-col items-center px-4 py-8 text-center">
              <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400">
                <Clock size={17} />
              </span>
              <p className="text-sm text-neutral-500">{t('messaging.nothing_scheduled', { defaultValue: 'Nothing scheduled.' })}</p>
            </div>
          )}
          {upcoming.map((r) => (
            <div key={r.reminder_uuid} className="group flex items-start gap-3 px-4 py-2 hover:bg-neutral-50">
              <Clock size={16} className="mt-0.5 shrink-0 text-neutral-500" />
              <button
                className="min-w-0 flex-1 text-start"
                onClick={() => {
                  if (r.conversation_uuid) onOpenConversation?.(r.conversation_uuid)
                  setOpen(false)
                }}
              >
                <p className="truncate text-sm font-medium text-neutral-900">{r.text}</p>
                <p className="text-xs text-neutral-500">{formatDue(r.due_at)}</p>
              </button>
              <button
                type="button"
                onClick={() => cancel(r.reminder_uuid)}
                className="rounded-md p-1 text-neutral-400 opacity-0 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:opacity-100 group-hover:opacity-100"
                title={t('messaging.cancel_reminder', { defaultValue: 'Cancel reminder' })}
                aria-label={t('messaging.cancel_reminder', { defaultValue: 'Cancel reminder' })}
              >
                <BellSimpleSlash size={15} />
              </button>
            </div>
          ))}
          {sent.length > 0 && (
            <>
              <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                {t('messaging.sent', { defaultValue: 'Sent' })}
              </p>
              {sent.map((r) => (
                <div key={r.reminder_uuid} className="flex items-start gap-3 px-4 py-2 opacity-70">
                  <Bell size={16} className="mt-0.5 shrink-0 text-neutral-400" />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-neutral-700">{r.text}</p>
                    <p className="text-xs text-neutral-400">{formatDue(r.due_at)}</p>
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

const PRESETS: { key: string; label: string; when: () => Date }[] = [
  { key: 'in_20m', label: 'In 20 minutes', when: () => new Date(Date.now() + 20 * 60_000) },
  { key: 'in_1h', label: 'In 1 hour', when: () => new Date(Date.now() + 60 * 60_000) },
  { key: 'tomorrow_9', label: 'Tomorrow at 9:00', when: () => at(9, 1) },
  { key: 'monday_9', label: 'Next Monday at 9:00', when: () => nextMonday9() },
]

/** "Remind me about this message" with quick presets. */
export function RemindMeMenu({ message, children }: { message: ChatMessage; children: React.ReactElement }) {
  const { t } = useTranslation()
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
      <PopoverContent align="end" className="w-56 rounded-xl p-1">
        {done ? (
          <p className="px-3 py-2 text-sm text-neutral-700">{t('messaging.reminder_set_for', { defaultValue: 'Reminder set for {{when}}', when: done })}</p>
        ) : (
          <>
            <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{t('messaging.remind_me', { defaultValue: 'Remind me' })}</p>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => pick(p.when())}
                className="w-full rounded-lg px-3 py-1.5 text-start text-sm text-neutral-700 hover:bg-neutral-100"
              >
                {t(`messaging.remind_presets.${p.key}`, { defaultValue: p.label })}
              </button>
            ))}
            {error && <p className="px-3 py-1.5 text-xs text-rose-600">{error}</p>}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
