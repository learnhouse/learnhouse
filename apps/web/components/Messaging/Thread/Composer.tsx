'use client'

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowBendUpLeft,
  At,
  BookOpen,
  Lock,
  MagnifyingGlass,
  PaperPlaneRight,
  PencilSimple,
  Smiley,
  TextAa,
  X,
} from '@phosphor-icons/react'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { Kbd, readDraft, writeDraft } from '@components/Messaging/ui/kit'
import { stripMd } from '@components/Messaging/Thread/MessageItem'
import EmojiPickerPopover from '@components/Messaging/ui/EmojiPicker'
import { CourseThumb, PersonAvatar } from '@components/Messaging/ui/Avatars'
import AgentAvatar from '@components/Messaging/Agents/AgentAvatar'
import { useOrgCourses, OrgCourse } from '@components/Messaging/hooks'
import { Agent, ChatMessage, CourseCard, UserSummary, displayName } from '@services/messaging/messaging'
import { senderName } from '@components/Messaging/utils'

export type ComposerSend = { content: string; course?: CourseCard | null; agent_uuids: string[] }

type Mention =
  | { kind: 'agent'; agent: Agent; label: string }
  | { kind: 'user'; user: UserSummary; label: string }

const TYPING_EVERY_MS = 3000
const TYPING_IDLE_MS = 4000

export default function Composer({
  orgslug,
  placeholder,
  disabledReason,
  agents,
  members,
  replyTo,
  editing,
  initialCourse,
  onCancelReply,
  onCancelEdit,
  onSend,
  onSubmitEdit,
  onEditLast,
  onTyping,
  compact = false,
  draftKey,
}: {
  orgslug: string
  placeholder: string
  disabledReason?: string | null
  agents: Agent[]
  members: UserSummary[]
  replyTo: ChatMessage | null
  editing: ChatMessage | null
  initialCourse?: CourseCard | null
  onCancelReply: () => void
  onCancelEdit: () => void
  onSend: (payload: ComposerSend) => void
  onSubmitEdit: (message: ChatMessage, content: string) => void
  onEditLast: () => void
  onTyping: (typing: boolean) => void
  compact?: boolean
  /** Keeps unsent text for this conversation in the browser. */
  draftKey?: string
}) {
  const { t } = useTranslation()
  const [text, setText] = useState(() => (typeof window === 'undefined' ? '' : readDraft(draftKey)))
  const [course, setCourse] = useState<CourseCard | null>(initialCourse ?? null)
  const [mentioned, setMentioned] = useState<Agent[]>([])
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [courseOpen, setCourseOpen] = useState(false)
  const [courseQuery, setCourseQuery] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const typingState = useRef<{ last: number; idle?: ReturnType<typeof setTimeout>; on: boolean }>({ last: 0, on: false })
  const { data: courses = [] } = useOrgCourses(orgslug, courseOpen)

  useEffect(() => {
    if (initialCourse) setCourse(initialCourse)
  }, [initialCourse])

  useEffect(() => {
    if (editing) {
      setText(editing.content)
      requestAnimationFrame(() => {
        ref.current?.focus()
        ref.current?.setSelectionRange(editing.content.length, editing.content.length)
      })
    }
  }, [editing])

  useEffect(() => {
    if (replyTo) ref.current?.focus()
  }, [replyTo])

  // Save the draft a moment after typing stops; edits are never drafts.
  useEffect(() => {
    if (editing) return
    const id = setTimeout(() => writeDraft(draftKey, text), 300)
    return () => clearTimeout(id)
  }, [text, draftKey, editing])

  // Autosize.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(220, el.scrollHeight) + 'px'
  }, [text])

  const stopTyping = () => {
    const s = typingState.current
    if (s.idle) clearTimeout(s.idle)
    if (s.on) {
      s.on = false
      s.last = 0
      onTyping(false)
    }
  }

  const bumpTyping = () => {
    const s = typingState.current
    const now = Date.now()
    if (!s.on || now - s.last > TYPING_EVERY_MS) {
      s.on = true
      s.last = now
      onTyping(true)
    }
    if (s.idle) clearTimeout(s.idle)
    s.idle = setTimeout(stopTyping, TYPING_IDLE_MS)
  }

  useEffect(() => () => stopTyping(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const mentionOptions: Mention[] = useMemo(() => {
    if (mentionQuery === null) return []
    const q = mentionQuery.toLowerCase()
    const a: Mention[] = agents
      .filter((x) => x.name.toLowerCase().includes(q))
      .map((agent) => ({ kind: 'agent', agent, label: agent.name }))
    const u: Mention[] = members
      .filter((m) => displayName(m).toLowerCase().includes(q) || m.username.toLowerCase().includes(q))
      .map((user) => ({ kind: 'user', user, label: user.username }))
    return [...a, ...u].slice(0, 8)
  }, [mentionQuery, agents, members])

  const detectMention = (value: string, caret: number) => {
    const before = value.slice(0, caret)
    const m = before.match(/(?:^|\s)@([\w.-]{0,30})$/)
    setMentionQuery(m ? m[1] : null)
    setMentionIndex(0)
  }

  const applyMention = (opt: Mention) => {
    const el = ref.current
    if (!el) return
    const caret = el.selectionStart
    const before = text.slice(0, caret).replace(/@([\w.-]{0,30})$/, `@${opt.label.replace(/\s+/g, '')} `)
    const next = before + text.slice(caret)
    setText(next)
    if (opt.kind === 'agent') {
      setMentioned((cur) => (cur.some((x) => x.agent_uuid === opt.agent.agent_uuid) ? cur : [...cur, opt.agent]))
    }
    setMentionQuery(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(before.length, before.length)
    })
  }

  const submit = () => {
    const content = text.trim()
    if (editing) {
      if (content && content !== editing.content) onSubmitEdit(editing, content)
      else onCancelEdit()
      setText(readDraft(draftKey))
      return
    }
    if (!content && !course) return
    // Only agents whose @handle is still in the text.
    const agent_uuids = mentioned
      .filter((a) => new RegExp(`@${a.name.replace(/\s+/g, '')}\\b`, 'i').test(content))
      .map((a) => a.agent_uuid)
    onSend({ content, course, agent_uuids })
    setText('')
    writeDraft(draftKey, '')
    setCourse(null)
    setMentioned([])
    stopTyping()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOptions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % mentionOptions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + mentionOptions.length) % mentionOptions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        applyMention(mentionOptions[mentionIndex])
        return
      }
      if (e.key === 'Escape') {
        setMentionQuery(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
      return
    }
    if (e.key === 'ArrowUp' && !text && !editing) {
      e.preventDefault()
      onEditLast()
      return
    }
    if (e.key === 'Escape') {
      if (editing) {
        setText(readDraft(draftKey))
        onCancelEdit()
      } else if (replyTo) onCancelReply()
    }
  }

  // The @ button starts a mention at the caret, as if typed.
  const startMention = () => {
    const el = ref.current
    const caret = el?.selectionStart ?? text.length
    const before = text.slice(0, caret)
    const insert = before && !/\s$/.test(before) ? ' @' : '@'
    const next = before + insert + text.slice(caret)
    setText(next)
    requestAnimationFrame(() => {
      el?.focus()
      const pos = caret + insert.length
      el?.setSelectionRange(pos, pos)
      detectMention(next, pos)
    })
  }

  const insertEmoji = (emoji: string) => {
    const el = ref.current
    const caret = el?.selectionStart ?? text.length
    const next = text.slice(0, caret) + emoji + text.slice(caret)
    setText(next)
    setEmojiOpen(false)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret + emoji.length, caret + emoji.length)
    })
  }

  const filteredCourses = courses.filter((c: OrgCourse) => c.name.toLowerCase().includes(courseQuery.toLowerCase()))

  const tool = 'flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700'
  const canSend = Boolean(text.trim() || course)

  if (disabledReason) {
    return (
      <div className={compact ? 'px-2 pb-2' : 'px-3 pb-3 md:px-4 md:pb-4'}>
        <div className="flex items-center gap-2.5 rounded-2xl bg-neutral-50 px-4 py-3 text-sm text-neutral-500 ring-1 ring-inset ring-neutral-200/70">
          <Lock size={15} className="shrink-0" />
          {disabledReason}
        </div>
      </div>
    )
  }

  return (
    <div className={`relative ${compact ? 'px-2 pb-2' : 'px-3 pb-3 md:px-4 md:pb-4'}`}>
      {/* Mention popup */}
      {mentionOptions.length > 0 && (
        <div
          role="listbox"
          className="absolute bottom-full start-4 z-20 mb-1 w-72 max-w-[calc(100%-2rem)] rounded-xl bg-white p-1 shadow-[0_8px_24px_rgba(0,0,0,0.1)] ring-1 ring-neutral-900/[0.06]"
        >
          <p className="px-2 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            {t('messaging.mention', { defaultValue: 'Mention' })}
          </p>
          {mentionOptions.map((o, i) => (
            <button
              key={o.kind === 'agent' ? o.agent.agent_uuid : o.user.user_uuid}
              type="button"
              role="option"
              aria-selected={i === mentionIndex}
              onMouseDown={(e) => {
                e.preventDefault()
                applyMention(o)
              }}
              onMouseEnter={() => setMentionIndex(i)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start ${i === mentionIndex ? 'bg-neutral-100' : ''}`}
            >
              {o.kind === 'agent' ? <AgentAvatar agent={o.agent} size={24} /> : <PersonAvatar user={o.user} size={24} />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-neutral-900">{o.kind === 'agent' ? o.agent.name : displayName(o.user)}</span>
                <span className="block truncate text-[11px] text-neutral-500">
                  {o.kind === 'agent'
                    ? o.agent.description || t('messaging.agent_replies_here', { defaultValue: 'Agent · replies in this chat' })
                    : `@${o.user.username}`}
                </span>
              </span>
              {o.kind === 'agent' && (
                <span className="rounded-md bg-neutral-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                  {t('messaging.agent', { defaultValue: 'Agent' })}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-2xl bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-neutral-200 transition-shadow focus-within:shadow-[0_2px_10px_rgba(0,0,0,0.06)] focus-within:ring-neutral-300">
        {(replyTo || editing) && (
          <div className="flex items-center gap-2 border-b border-neutral-100 px-3.5 py-2 text-xs text-neutral-500">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${editing ? 'bg-amber-50 text-amber-600' : 'bg-neutral-100 text-neutral-500'}`}>
              {editing ? <PencilSimple size={12} /> : <ArrowBendUpLeft size={12} />}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {editing ? (
                t('messaging.editing', { defaultValue: 'Editing message' })
              ) : (
                <>
                  {t('messaging.replying_to', { defaultValue: 'Replying to' })}{' '}
                  <span className="font-semibold text-neutral-700">{senderName(replyTo!)}</span>
                  {replyTo!.content ? `: ${stripMd(replyTo!.content).slice(0, 80)}` : ''}
                </>
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                if (editing) {
                  setText(readDraft(draftKey))
                  onCancelEdit()
                } else onCancelReply()
              }}
              aria-label={t('common.cancel', { defaultValue: 'Cancel' })}
              className="rounded-md p-1 hover:bg-neutral-100 hover:text-neutral-800"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {course && !editing && (
          <div className="px-3 pt-3">
            <div className="inline-flex max-w-full items-center gap-2.5 rounded-xl bg-neutral-50 py-1.5 ps-1.5 pe-2 ring-1 ring-inset ring-neutral-200">
              <CourseThumb course={course} size={32} />
              <span className="min-w-0 max-w-[220px] truncate text-sm font-medium text-neutral-800">{course.name}</span>
              <button
                type="button"
                onClick={() => setCourse(null)}
                aria-label={t('messaging.remove_course', { defaultValue: 'Remove course' })}
                className="rounded-md p-0.5 text-neutral-400 hover:text-neutral-700"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        )}

        <textarea
          ref={ref}
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value)
            detectMention(e.target.value, e.target.selectionStart)
            if (e.target.value) bumpTyping()
            else stopTyping()
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            stopTyping()
            setTimeout(() => setMentionQuery(null), 120)
          }}
          placeholder={placeholder}
          maxLength={4000}
          aria-label={placeholder}
          className={`block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base leading-relaxed outline-none placeholder:text-neutral-400 sm:text-sm ${compact ? 'max-h-32' : ''}`}
        />

        <div className="flex items-center gap-0.5 px-2 pb-2">
          <EmojiPickerPopover onPick={insertEmoji} open={emojiOpen} onOpenChange={setEmojiOpen} align="start">
            <button type="button" className={tool} aria-label={t('messaging.emoji', { defaultValue: 'Emoji' })} title={t('messaging.emoji', { defaultValue: 'Emoji' })}>
              <Smiley size={18} />
            </button>
          </EmojiPickerPopover>
          {(agents.length > 0 || members.length > 0) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={startMention} className={tool} aria-label={t('messaging.mention_someone', { defaultValue: 'Mention someone or an agent' })}>
                  <At size={18} />
                </button>
              </TooltipTrigger>
              <TooltipContent className="text-xs">{t('messaging.mention_someone', { defaultValue: 'Mention someone or an agent' })}</TooltipContent>
            </Tooltip>
          )}
          {!editing && (
            <Popover open={courseOpen} onOpenChange={setCourseOpen}>
              <PopoverTrigger asChild>
                <button type="button" className={tool} aria-label={t('messaging.share_course', { defaultValue: 'Share a course' })} title={t('messaging.share_course', { defaultValue: 'Share a course' })}>
                  <BookOpen size={18} />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-80 rounded-xl p-1.5">
                <div className="relative mb-1">
                  <MagnifyingGlass size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    autoFocus
                    value={courseQuery}
                    onChange={(e) => setCourseQuery(e.target.value)}
                    placeholder={t('messaging.find_course', { defaultValue: 'Find a course to share' })}
                    className="h-9 w-full rounded-lg bg-neutral-50 ps-8 pe-3 text-base outline-none ring-1 ring-inset ring-neutral-200 focus:ring-neutral-300 sm:text-sm"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {filteredCourses.length === 0 && (
                    <p className="py-6 text-center text-xs text-neutral-400">{t('messaging.no_courses', { defaultValue: 'No courses' })}</p>
                  )}
                  {filteredCourses.map((c: OrgCourse) => (
                    <button
                      key={c.course_uuid}
                      type="button"
                      onClick={() => {
                        setCourse({
                          course_uuid: c.course_uuid,
                          name: c.name,
                          description: c.description || '',
                          thumbnail_image: c.thumbnail_image || '',
                        })
                        setCourseOpen(false)
                        ref.current?.focus()
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start hover:bg-neutral-50"
                    >
                      <CourseThumb course={{ course_uuid: c.course_uuid, name: c.name, thumbnail_image: c.thumbnail_image || '' }} size={32} />
                      <span className="truncate text-sm text-neutral-800">{c.name}</span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
          {!compact && (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className={`${tool} hidden sm:flex`} aria-label={t('messaging.formatting', { defaultValue: 'Formatting' })} title={t('messaging.formatting', { defaultValue: 'Formatting' })}>
                  <TextAa size={18} />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-64 rounded-xl p-3 text-xs text-neutral-600">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{t('messaging.formatting', { defaultValue: 'Formatting' })}</p>
                <ul className="space-y-1.5">
                  <li className="flex justify-between gap-3"><code className="text-neutral-500">**bold**</code><strong className="text-neutral-900">bold</strong></li>
                  <li className="flex justify-between gap-3"><code className="text-neutral-500">_italic_</code><em>italic</em></li>
                  <li className="flex justify-between gap-3"><code className="text-neutral-500">`code`</code><code className="rounded bg-neutral-100 px-1">code</code></li>
                  <li className="flex justify-between gap-3"><code className="text-neutral-500">&gt; quote</code><span className="border-s-2 border-neutral-300 ps-2">quote</span></li>
                  <li className="flex justify-between gap-3"><code className="text-neutral-500">- list</code><span>• list</span></li>
                </ul>
                <div className="mt-3 space-y-1.5 border-t border-neutral-100 pt-2.5">
                  <p className="flex items-center justify-between gap-2"><span>{t('messaging.kbd_send', { defaultValue: 'Send' })}</span><Kbd>Enter</Kbd></p>
                  <p className="flex items-center justify-between gap-2"><span>{t('messaging.kbd_newline', { defaultValue: 'New line' })}</span><span className="flex gap-1"><Kbd>Shift</Kbd><Kbd>Enter</Kbd></span></p>
                  <p className="flex items-center justify-between gap-2"><span>{t('messaging.kbd_edit_last', { defaultValue: 'Edit your last message' })}</span><Kbd>↑</Kbd></p>
                  <p className="flex items-center justify-between gap-2"><span>{t('messaging.kbd_mention', { defaultValue: 'Mention' })}</span><Kbd>@</Kbd></p>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {mentioned.length > 0 && (
            <span className="ms-1 flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-neutral-500">
              {mentioned.map((a) => (
                <span key={a.agent_uuid} className="inline-flex shrink-0 items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5">
                  <AgentAvatar agent={a} size={14} /> {t('messaging.will_reply', { defaultValue: '{{name}} will reply', name: a.name })}
                </span>
              ))}
            </span>
          )}
          {!compact && (
            <span className="ms-auto me-2 hidden items-center gap-1 text-[11px] text-neutral-400 lg:flex">
              {editing ? (
                <>
                  <Kbd>Enter</Kbd> {t('messaging.kbd_save', { defaultValue: 'save' })} <Kbd className="ms-1.5">Esc</Kbd> {t('messaging.kbd_cancel', { defaultValue: 'cancel' })}
                </>
              ) : (
                <>
                  <Kbd>Enter</Kbd> {t('messaging.kbd_send_lower', { defaultValue: 'send' })} <Kbd className="ms-1.5">Shift</Kbd>
                  <Kbd>Enter</Kbd> {t('messaging.kbd_newline_lower', { defaultValue: 'new line' })}
                </>
              )}
            </span>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className={`${buttonClass(canSend ? 'primary' : 'secondary', 'icon')} ms-auto h-9 w-9 sm:h-8 sm:w-8 ${!compact ? 'lg:ms-0' : ''} disabled:!opacity-100 disabled:text-neutral-300`}
            aria-label={editing ? t('messaging.save', { defaultValue: 'Save' }) : t('messaging.send', { defaultValue: 'Send' })}
          >
            <PaperPlaneRight size={15} weight="fill" className="rtl:-scale-x-100" />
          </button>
        </div>
      </div>
    </div>
  )
}
