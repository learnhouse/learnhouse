'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Check, MagnifyingGlass, NotePencil, PaperPlaneTilt, UserPlus, UsersThree, X } from '@phosphor-icons/react'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { Button, INPUT } from '@components/Dashboard/Shared/DashKit/DashKit'
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

  const body = (
    <div className="flex flex-col gap-3">
      {shareCourse && (
        <div className="flex items-center gap-3 rounded-xl bg-neutral-50 p-2.5 ring-1 ring-inset ring-neutral-200/70">
          <CourseThumb course={shareCourse} size={40} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900">{shareCourse.name}</p>
            <p className="truncate text-xs text-neutral-500">{shareCourse.description}</p>
          </div>
        </div>
      )}

      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 ring-1 ring-inset ring-neutral-200 transition-shadow focus-within:ring-2 focus-within:ring-neutral-900/15">
        <MagnifyingGlass size={15} className="shrink-0 text-neutral-400" />
        {picked.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 py-0.5 ps-0.5 pe-1.5 text-xs font-medium text-neutral-800">
            <PersonAvatar user={p} size={18} showPresence={false} />
            {displayName(p)}
            <button
              type="button"
              onClick={() => toggle(p)}
              className="rounded-full p-0.5 opacity-60 hover:bg-neutral-200 hover:opacity-100"
              aria-label={t('messaging.remove_person', { defaultValue: 'Remove {{name}}', name: displayName(p) })}
            >
              <X size={10} weight="bold" />
            </button>
          </span>
        ))}
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Backspace on an empty field drops the last pick, like any token input.
            if (e.key === 'Backspace' && !query && picked.length) setPicked((cur) => cur.slice(0, -1))
            if (e.key === 'Enter' && visible.length && query) {
              e.preventDefault()
              toggle(visible[0])
              setQuery('')
            }
          }}
          placeholder={picked.length ? '' : t('messaging.search_people', { defaultValue: 'Search people' })}
          className="min-w-[120px] flex-1 bg-transparent py-0.5 text-base outline-none placeholder:text-neutral-400 sm:text-sm"
        />
      </div>

      <div className="-mx-2 max-h-[320px] min-h-[160px] overflow-y-auto">
        {isFetching && visible.length === 0 &&
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2" aria-hidden>
              <div className="h-9 w-9 animate-pulse rounded-full bg-neutral-100" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-100" />
                <div className="h-2.5 w-1/4 animate-pulse rounded bg-neutral-100/70" />
              </div>
            </div>
          ))}
        {visible.length === 0 && !isFetching && (
          <div className="flex flex-col items-center py-10 text-center">
            <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400">
              <MagnifyingGlass size={16} />
            </span>
            <p className="text-sm font-medium text-neutral-700">{t('messaging.no_people', { defaultValue: 'No one found' })}</p>
            {query && <p className="mt-0.5 text-xs text-neutral-500">{t('messaging.no_people_desc', { defaultValue: 'Try a first name, last name or username.' })}</p>}
          </div>
        )}
        {visible.map((p) => {
          const selected = picked.some((x) => x.id === p.id)
          const live = presence[p.id] || p.presence
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p)}
              aria-pressed={selected}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start transition-colors ${selected ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
            >
              <PersonAvatar user={p} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900">
                  {displayName(p)} <span className="font-normal text-neutral-400">@{p.username}</span>
                </p>
                <p className="truncate text-xs text-neutral-500">{presenceLine(live)}</p>
              </div>
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors ${
                  selected ? 'bg-neutral-900 text-white' : 'ring-1 ring-inset ring-neutral-300'
                }`}
              >
                {selected && <Check size={11} weight="bold" />}
              </span>
            </button>
          )
        })}
      </div>

      {isGroup && (
        <div className="flex items-center gap-2">
          <EmojiPickerPopover onPick={setGroupEmoji} side="top" align="start">
            <button
              type="button"
              aria-label={t('messaging.group_emoji', { defaultValue: 'Group emoji' })}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50"
            >
              {groupEmoji || <UsersThree size={17} className="text-neutral-400" />}
            </button>
          </EmojiPickerPopover>
          <input
            value={groupTitle}
            onChange={(e) => setGroupTitle(e.target.value)}
            maxLength={120}
            placeholder={t('messaging.group_name', { defaultValue: 'Group name (optional)' })}
            className={INPUT}
          />
        </div>
      )}

      {shareCourse && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('messaging.add_note', { defaultValue: 'Add a note (optional)' })}
          className={INPUT}
        />
      )}

      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
    </div>
  )

  const footer = (
    <>
      <span className="me-auto text-xs text-neutral-500">
        {picked.length
          ? isGroup
            ? t('messaging.group_of', { defaultValue: 'Group of {{count}}', count: picked.length + 1 })
            : t('messaging.selected', { defaultValue: '{{count}} selected', count: picked.length })
          : ''}
      </span>
      <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
        {t('common.cancel', { defaultValue: 'Cancel' })}
      </Button>
      <Button variant="primary" disabled={!picked.length} loading={busy} onClick={submit}>
        {cta}
      </Button>
    </>
  )

  return (
    <Modal
      isDialogOpen={open}
      onOpenChange={onOpenChange}
      size="sm"
      preventClose={busy}
      icon={onPickPeople ? <UserPlus size={16} weight="bold" /> : shareCourse ? <PaperPlaneTilt size={16} weight="bold" /> : <NotePencil size={16} weight="bold" />}
      dialogTitle={
        title ||
        (shareCourse
          ? t('messaging.share_course_title', { defaultValue: 'Share course' })
          : t('messaging.new_message', { defaultValue: 'New message' }))
      }
      dialogDescription={
        onPickPeople
          ? t('messaging.add_people_desc', { defaultValue: 'They will see the conversation from now on.' })
          : shareCourse
            ? t('messaging.share_course_desc', { defaultValue: 'Pick who to send it to.' })
            : t('messaging.new_message_desc', { defaultValue: 'Message one person, or pick several to start a group.' })
      }
      dialogContent={body}
      footer={footer}
    />
  )
}
