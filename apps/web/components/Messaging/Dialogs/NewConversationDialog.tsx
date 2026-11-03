'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Check, MagnifyingGlass, SpinnerGap, UsersThree, X } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { messagingKeys, useMessaging } from '@components/Messaging/MessagingProvider'
import { useDirectory } from '@components/Messaging/hooks'
import { PersonAvatar, CourseThumb } from '@components/Messaging/ui/Avatars'
import EmojiPickerPopover from '@components/Messaging/ui/EmojiPicker'
import {
  Conversation,
  CourseCard,
  DirectoryPerson,
  createConversation,
  displayName,
  sendMessage,
} from '@services/messaging/messaging'
import { presenceLine } from '@components/Messaging/utils'

function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

export default function NewConversationDialog({
  open,
  onOpenChange,
  onCreated,
  shareCourse,
  title,
  excludeUserIds = [],
  onPickPeople,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (conversation: Conversation) => void
  /** Share this course into the conversation once it's created. */
  shareCourse?: CourseCard | null
  title?: string
  excludeUserIds?: number[]
  /** Picker-only mode (e.g. adding people to a group). */
  onPickPeople?: (people: DirectoryPerson[]) => Promise<void> | void
}) {
  const { t } = useTranslation()
  const { orgId, token, presence } = useMessaging()
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<DirectoryPerson[]>([])
  const [groupTitle, setGroupTitle] = useState('')
  const [groupEmoji, setGroupEmoji] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const debounced = useDebounced(query)
  const { data: people, isFetching } = useDirectory(debounced, open)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setPicked([])
      setGroupTitle('')
      setGroupEmoji('')
      setNote('')
      setError('')
    }
  }, [open])

  const visible = useMemo(
    () => (people || []).filter((p) => !excludeUserIds.includes(p.id)),
    [people, excludeUserIds]
  )

  const toggle = (p: DirectoryPerson) =>
    setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur.filter((x) => x.id !== p.id) : [...cur, p]))

  const isGroup = picked.length > 1 && !onPickPeople

  const submit = async () => {
    if (!picked.length || !orgId || !token) return
    setBusy(true)
    setError('')
    try {
      if (onPickPeople) {
        await onPickPeople(picked)
        onOpenChange(false)
        return
      }
      const conv = await createConversation(
        {
          org_id: orgId,
          kind: isGroup ? 'group' : 'dm',
          user_uuids: picked.map((p) => p.user_uuid),
          title: isGroup ? groupTitle : undefined,
          emoji: isGroup ? groupEmoji : undefined,
        },
        token
      )
      if (shareCourse) {
        await sendMessage(conv.conversation_uuid, { content: note, course_uuid: shareCourse.course_uuid }, token)
      }
      qc.invalidateQueries({ queryKey: messagingKeys.conversations(orgId) })
      onCreated?.(conv)
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const cta = onPickPeople
    ? t('messaging.add_people', { defaultValue: 'Add people' })
    : shareCourse
      ? t('messaging.share', { defaultValue: 'Share' })
      : isGroup
        ? t('messaging.create_group', { defaultValue: 'Create group' })
        : t('messaging.start_chat', { defaultValue: 'Start chat' })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-gray-100 space-y-0">
          <DialogTitle className="text-xl font-semibold text-gray-900">
            {title ||
              (shareCourse
                ? t('messaging.share_course_title', { defaultValue: 'Share course' })
                : t('messaging.new_message', { defaultValue: 'New message' }))}
          </DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            {shareCourse
              ? t('messaging.share_course_desc', { defaultValue: 'Pick who to send it to.' })
              : t('messaging.new_message_desc', { defaultValue: 'Message one person, or pick several to start a group.' })}
          </DialogDescription>
        </DialogHeader>

        {shareCourse && (
          <div className="mx-5 mt-4 flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
            <CourseThumb course={shareCourse} size={40} />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{shareCourse.name}</p>
              <p className="text-xs text-gray-500 truncate">{shareCourse.description}</p>
            </div>
          </div>
        )}

        <div className="px-5 pt-4">
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-2 focus-within:ring-2 focus-within:ring-gray-200">
            <MagnifyingGlass size={15} className="text-gray-400" />
            {picked.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 rounded-md bg-gray-100 text-gray-800 ps-1 pe-1.5 py-0.5 text-xs font-medium">
                <PersonAvatar user={p} size={16} showPresence={false} />
                {displayName(p)}
                <button onClick={() => toggle(p)} className="opacity-70 hover:opacity-100" aria-label="Remove">
                  <X size={11} weight="bold" />
                </button>
              </span>
            ))}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={picked.length ? '' : t('messaging.search_people', { defaultValue: 'Search people' })}
              className="flex-1 min-w-[120px] text-sm outline-none bg-transparent py-0.5"
            />
            {isFetching && <SpinnerGap size={14} className="animate-spin text-gray-400" />}
          </div>
        </div>

        <div className="mt-2 max-h-[320px] overflow-y-auto px-2 pb-2">
          {visible.length === 0 && !isFetching && (
            <p className="text-center text-xs text-gray-400 py-8">
              {t('messaging.no_people', { defaultValue: 'No one found' })}
            </p>
          )}
          {visible.map((p) => {
            const selected = picked.some((x) => x.id === p.id)
            const live = presence[p.id] || p.presence
            return (
              <button
                key={p.id}
                onClick={() => toggle(p)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-start transition-colors ${
                  selected ? 'bg-gray-100' : 'hover:bg-gray-50'
                }`}
              >
                <PersonAvatar user={p} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {displayName(p)} <span className="text-gray-400 font-normal">@{p.username}</span>
                  </p>
                  <p className="text-xs text-gray-500 truncate">{presenceLine(live)}</p>
                </div>
                <span
                  className={`h-5 w-5 rounded-full border flex items-center justify-center transition-colors ${
                    selected ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-300'
                  }`}
                >
                  {selected && <Check size={11} weight="bold" />}
                </span>
              </button>
            )
          })}
        </div>

        {isGroup && (
          <div className="px-5 pb-3 flex items-center gap-2">
            <EmojiPickerPopover onPick={setGroupEmoji} side="top" align="start">
              <button className="h-10 w-10 rounded-lg border border-gray-200 flex items-center justify-center text-lg hover:bg-gray-50">
                {groupEmoji || <UsersThree size={18} className="text-gray-400" />}
              </button>
            </EmojiPickerPopover>
            <input
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              maxLength={120}
              placeholder={t('messaging.group_name', { defaultValue: 'Group name (optional)' })}
              className="flex-1 h-10 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:ring-2 focus:ring-gray-200"
            />
          </div>
        )}

        {shareCourse && (
          <div className="px-5 pb-3">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('messaging.add_note', { defaultValue: 'Add a note (optional)' })}
              className="w-full h-10 rounded-lg border border-gray-200 px-3 text-sm outline-none focus:ring-2 focus:ring-gray-200"
            />
          </div>
        )}

        {error && <p className="px-5 pb-2 text-xs text-red-600">{error}</p>}

        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
          <span className="text-xs text-gray-500">
            {picked.length
              ? t('messaging.selected', { defaultValue: '{{count}} selected', count: picked.length })
              : ''}
          </span>
          <button
            disabled={!picked.length || busy}
            onClick={submit}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 hover:bg-gray-800 transition-colors"
          >
            {busy && <SpinnerGap size={14} className="animate-spin" />}
            {cta}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
