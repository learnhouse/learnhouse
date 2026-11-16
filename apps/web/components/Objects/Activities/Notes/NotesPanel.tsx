'use client'
import React, { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleNotch, Clock, Lock, Notepad, Plus, WarningCircle, X } from '@phosphor-icons/react'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import { formatRelative } from '@/lib/format'
import { countWords, formatTimestamp, isEmptyDoc } from '@/lib/notes/noteMarkdown'
import { closeNotes, takeCaptures, useNotesState, type NoteCapture } from '@/lib/notes/notesBus'
import { getVideoClock, subscribeVideoClock } from '@/lib/notes/videoClock'
import { scrollToLessonAnchor } from '@/lib/notes/lessonAnchor'
import type { LearnerNote, NoteAnchor, NoteDoc } from '@services/notes/notes'
import NoteEditor from './NoteEditor'
import NoteView from './NoteView'
import NoteCardHeader from './NoteCardHeader'
import { useActivityNotes, useNoteMutations } from './useNotes'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type NoteControl = { text: () => string; stop: () => Promise<string | null> }
const DRAFT = '__draft__'
const SAVE_DELAY = 800

const EMPTY_DOC: NoteDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

/** A quote from the lesson, linked back to the heading it sits under. */
function quoteDoc(quote: string, anchor?: NoteAnchor | null): NoteDoc {
  const href = anchor?.kind === 'heading' && anchor.ref ? `#${anchor.ref}` : null
  const text = quote.replace(/\s+/g, ' ').trim().slice(0, 1200)
  return {
    type: 'doc',
    content: [
      {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text, ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}) }] }],
      },
      { type: 'paragraph' },
    ],
  }
}

/** The note being written: the editor, autosave and its status line. */
function ActiveNote({
  activityUuid,
  note,
  initial,
  anchor,
  onCreated,
  onDiscard,
  control,
}: {
  activityUuid: string
  note: LearnerNote | null
  initial: NoteDoc
  anchor?: NoteAnchor | null
  onCreated: (_note: LearnerNote) => void
  onDiscard: () => void
  /** Filled with the note's live text and a way to stop saving before a delete. */
  control: React.Ref<NoteControl>
}) {
  const { t } = useTranslation()
  const { create, update } = useNoteMutations(activityUuid)
  const [state, setState] = useState<SaveState>(note ? 'saved' : 'idle')
  const [words, setWords] = useState(() => countWords(note?.plain_text || ''))
  const uuid = useRef<string | null>(note?.note_uuid ?? null)
  const pending = useRef<NoteDoc | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflight = useRef<Promise<unknown> | null>(null)
  const stopped = useRef(false)
  const text = useRef(note?.plain_text || '')

  useImperativeHandle(control, () => ({
      text: () => text.current,
      // Before a delete: no more saves, and wait for one in flight so a note
      // being created can't come back after it was deleted.
      stop: async () => {
        stopped.current = true
        if (timer.current) clearTimeout(timer.current)
        pending.current = null
        if (inflight.current) await inflight.current.catch(() => {})
        return uuid.current
      },
  }), [])

  const save = useCallback(async () => {
    timer.current = null
    if (stopped.current) return
    const doc = pending.current
    if (!doc) return
    // One write at a time, in order; the latest text wins.
    if (inflight.current) await inflight.current.catch(() => {})
    if (pending.current !== doc) return
    pending.current = null
    if (!uuid.current && isEmptyDoc(doc)) return
    setState('saving')
    const run = uuid.current
      ? update.mutateAsync({ noteUuid: uuid.current, content: doc })
      : create.mutateAsync({ content: doc, anchor: anchor ?? null }).then((created) => {
          uuid.current = created.note_uuid
          onCreated(created)
          return created
        })
    inflight.current = run
    try {
      await run
      if (!pending.current) setState('saved')
    } catch {
      setState('error')
      // Keep the text so the next keystroke (or the retry) sends it again.
      pending.current = pending.current ?? doc
    } finally {
      if (inflight.current === run) inflight.current = null
    }
  }, [anchor, create, update, onCreated])

  // Flush on unmount (switching notes, closing the panel, leaving the page).
  const saveRef = useRef(save)
  useLayoutEffect(() => {
    saveRef.current = save
  })
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      if (pending.current) void saveRef.current()
    },
    []
  )

  const onChange = (doc: NoteDoc, plain: string) => {
    if (stopped.current) return
    pending.current = doc
    text.current = plain
    setWords(countWords(plain))
    setState('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), SAVE_DELAY)
  }

  const status =
    state === 'saving' ? (
      <span className="inline-flex items-center gap-1 text-neutral-400">
        <CircleNotch size={11} className="animate-spin" /> {t('notes.saving', { defaultValue: 'Saving…' })}
      </span>
    ) : state === 'saved' ? (
      <span className="text-neutral-400">{t('notes.saved', { defaultValue: 'Saved' })}</span>
    ) : state === 'error' ? (
      <button type="button" onClick={() => void save()} className="inline-flex items-center gap-1 text-rose-600 hover:underline">
        <WarningCircle size={12} weight="fill" /> {t('notes.save_failed', { defaultValue: 'Not saved. Retry' })}
      </button>
    ) : (
      <span className="text-neutral-400">{t('notes.autosave_hint', { defaultValue: 'Saves as you type' })}</span>
    )

  return (
    <NoteEditor
      initial={initial}
      onChange={onChange}
      onBlurEmpty={() => {
        if (!uuid.current) onDiscard()
      }}
      footer={
        <div className="flex items-center justify-between gap-2 text-[11px] font-medium" aria-live="polite">
          {status}
          <span className="tabular-nums text-neutral-400">{t('notes.word_count', { count: words, defaultValue: '{{count}} words' })}</span>
        </div>
      }
    />
  )
}

function NoteCard({
  note,
  activityUuid,
  isActive,
  onActivate,
  onDeleted,
}: {
  note: LearnerNote
  activityUuid: string
  isActive: boolean
  onActivate: () => void
  onDeleted: () => void
}) {
  const { t, i18n } = useTranslation()
  const { remove } = useNoteMutations(activityUuid)
  const control = useRef<NoteControl | null>(null)

  return (
    <li
      className={`group rounded-xl bg-white p-3 ring-1 transition-shadow ${
        isActive ? 'ring-neutral-300 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_-10px_rgba(0,0,0,0.18)]' : 'ring-neutral-200/80 hover:ring-neutral-300'
      }`}
      data-note={note.note_uuid}
    >
      <NoteCardHeader
        anchor={note.anchor}
        updatedLabel={formatRelative(note.updated_at, i18n.language)}
        updatedTitle={new Date(note.updated_at).toLocaleString(i18n.language)}
        getText={() => (isActive && control.current ? control.current.text() : note.plain_text)}
        onDelete={async () => {
          if (isActive && control.current) await control.current.stop()
          await remove.mutateAsync(note.note_uuid)
          onDeleted()
        }}
      />
      {isActive ? (
        <ActiveNote
          activityUuid={activityUuid}
          note={note}
          initial={note.content?.content?.length ? note.content : EMPTY_DOC}
          onCreated={() => {}}
          onDiscard={() => {}}
          control={control}
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('a,button')) return
            onActivate()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onActivate()
            }
          }}
          aria-label={t('notes.edit', { defaultValue: 'Edit note' })}
          className="cursor-text rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/10"
        >
          {isEmptyDoc(note.content) ? (
            <p className="text-sm text-neutral-400">{t('notes.empty_note', { defaultValue: 'Empty note' })}</p>
          ) : (
            <NoteView doc={note.content} onLink={(href) => href.startsWith('#') && scrollToLessonAnchor(href.slice(1))} />
          )}
        </div>
      )}
    </li>
  )
}

/** Where the lesson video is, refreshed while the panel is open. */
function useVideoTime(enabled: boolean): number | null {
  const [time, setTime] = useState<number | null>(null)
  const [, bump] = useState(0)
  useEffect(() => subscribeVideoClock(() => bump((n) => n + 1)), [])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const tick = async () => {
      const clock = getVideoClock()
      const value = clock ? await clock.getTime() : null
      if (alive) setTime(value == null ? null : Math.floor(value))
    }
    void tick()
    const id = setInterval(() => void tick(), 500)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [enabled])
  return time
}

/**
 * The notes panel of a lesson: the learner's private notes as cards, the one
 * being written in an editor that saves as you type, a new-note button and,
 * on a video lesson, "Add note at 03:12". Rendered as a side panel from lg
 * up and inside a sheet below.
 */
export default function NotesPanel({
  activity,
  variant = 'side',
}: {
  activity: { activity_uuid: string; activity_type?: string; name?: string }
  variant?: 'side' | 'sheet'
}) {
  const { t } = useTranslation()
  const activityUuid = activity.activity_uuid
  const { data, isLoading, isError, error } = useActivityNotes(activityUuid)
  const notes = Array.isArray(data) ? data : []
  const { create, remove: removeNote } = useNoteMutations(activityUuid)
  const draftControl = useRef<NoteControl | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  // A new note keeps its editor after the first save (noteUuid set), so typing
  // never lands in an editor that is being swapped out.
  const [draft, setDraft] = useState<{ initial: NoteDoc; anchor?: NoteAnchor | null; key: number; noteUuid?: string } | null>(null)
  const { captures } = useNotesState()
  const isVideo = activity.activity_type === 'TYPE_VIDEO'
  const videoTime = useVideoTime(isVideo)
  const listRef = useRef<HTMLUListElement>(null)

  const startDraft = (initial: NoteDoc = EMPTY_DOC, anchor?: NoteAnchor | null) => {
    setActiveId(DRAFT)
    setDraft({ initial, anchor, key: Date.now() })
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' }))
  }

  // Quick captures (a selection, a video moment) become notes right away, so
  // nothing is lost if the panel closes before the learner types.
  const handled = useRef<Set<number>>(new Set())
  useEffect(() => {
    const fresh = captures.filter((c) => !handled.current.has(c.id))
    if (!fresh.length) return
    fresh.forEach((c) => handled.current.add(c.id))
    takeCaptures(fresh.map((c) => c.id))
    for (const capture of fresh as NoteCapture[]) {
      const content = capture.quote ? quoteDoc(capture.quote, capture.anchor) : EMPTY_DOC
      if (!capture.quote) {
        startDraft(content, capture.anchor)
        continue
      }
      create.mutate(
        { content, anchor: capture.anchor ?? null },
        { onSuccess: (note) => setActiveId(note.note_uuid) }
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captures])

  const addAtTime = async () => {
    const clock = getVideoClock()
    const value = clock ? await clock.getTime() : videoTime
    const seconds = Math.max(0, Math.floor(Number(value) || 0))
    startDraft(EMPTY_DOC, { kind: 'video', seconds, label: formatTimestamp(seconds) })
  }

  const errorStatus = (error as any)?.status
  const header = (
    <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700">
        <Notepad size={17} weight="duotone" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-neutral-900">
          {t('notes.title', { defaultValue: 'My notes' })}
          {notes.length > 0 && <span className="text-xs font-medium tabular-nums text-neutral-400">{notes.length}</span>}
        </h2>
        <p className="flex items-center gap-1 text-[11px] text-neutral-500">
          <Lock size={10} weight="bold" className="shrink-0" />
          <span className="truncate">{t('notes.private_hint', { defaultValue: 'Only you can see your notes' })}</span>
        </p>
      </div>
      {variant === 'side' && (
        <button
          type="button"
          onClick={closeNotes}
          aria-label={t('notes.close', { defaultValue: 'Close notes' })}
          title={t('notes.close', { defaultValue: 'Close notes' })}
          className="grid size-7 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800"
        >
          <X size={15} weight="bold" />
        </button>
      )}
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col" data-notes-panel="">
      {header}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        <button type="button" onClick={() => startDraft()} className={buttonClass('secondary', 'sm')} disabled={activeId === DRAFT && !draft?.noteUuid}>
          <Plus size={13} weight="bold" />
          {t('notes.new_note', { defaultValue: 'New note' })}
        </button>
        {isVideo && (
          <button type="button" onClick={() => void addAtTime()} className={buttonClass('secondary', 'sm')}>
            <Clock size={13} weight="bold" className="text-sky-600" />
            {t('notes.add_at_time', { defaultValue: 'Add note at {{time}}', time: formatTimestamp(videoTime ?? 0) })}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-neutral-100 bg-neutral-50/60 px-3 py-3">
        {isError ? (
          <p className="px-2 py-6 text-center text-sm text-neutral-500">
            {errorStatus === 403
              ? t('notes.join_to_take_notes', { defaultValue: 'Join this organization to take notes.' })
              : t('notes.load_failed', { defaultValue: 'Your notes could not be loaded.' })}
          </p>
        ) : isLoading ? (
          <div className="space-y-2" aria-busy>
            {[0, 1].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-white ring-1 ring-neutral-200/70" />
            ))}
          </div>
        ) : (
          <ul ref={listRef} className="space-y-2">
            {activeId === DRAFT && draft && (
              <li className="rounded-xl bg-white p-3 ring-1 ring-neutral-300 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_-10px_rgba(0,0,0,0.18)]">
                <NoteCardHeader
                  anchor={draft.anchor}
                  updatedLabel={draft.noteUuid ? t('notes.just_saved', { defaultValue: 'Just now' }) : t('notes.new_label', { defaultValue: 'New' })}
                  getText={() => draftControl.current?.text() ?? ''}
                  onDelete={async () => {
                    // Saved already (or being saved): delete it; never saved: just drop it.
                    const savedUuid = (await draftControl.current?.stop()) ?? draft.noteUuid ?? null
                    if (savedUuid) await removeNote.mutateAsync(savedUuid)
                    setDraft(null)
                    setActiveId(null)
                  }}
                />
                <ActiveNote
                  control={draftControl}
                  key={draft.key}
                  activityUuid={activityUuid}
                  note={null}
                  initial={draft.initial}
                  anchor={draft.anchor}
                  onCreated={(note) => setDraft((d) => (d ? { ...d, noteUuid: note.note_uuid } : d))}
                  onDiscard={() => {
                    setDraft(null)
                    setActiveId(null)
                  }}
                />
              </li>
            )}
            {notes.filter((n) => !(activeId === DRAFT && n.note_uuid === draft?.noteUuid)).map((note) => (
              <NoteCard
                key={note.note_uuid}
                note={note}
                activityUuid={activityUuid}
                isActive={activeId === note.note_uuid}
                onActivate={() => {
                  setDraft(null)
                  setActiveId(note.note_uuid)
                }}
                onDeleted={() => activeId === note.note_uuid && setActiveId(null)}
              />
            ))}
            {notes.length === 0 && activeId !== DRAFT && (
              <li className="flex flex-col items-center px-4 py-8 text-center">
                <span className="mb-3 grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-600">
                  <Notepad size={20} weight="duotone" />
                </span>
                <p className="text-sm font-medium text-neutral-800">{t('notes.empty_title', { defaultValue: 'No notes on this lesson yet' })}</p>
                <p className="mt-1 max-w-[260px] text-xs leading-relaxed text-neutral-500">
                  {isVideo
                    ? t('notes.empty_hint_video', { defaultValue: 'Write down what matters, or save a moment of the video to come back to it.' })
                    : t('notes.empty_hint', { defaultValue: 'Write down what matters, or select text in the lesson and add it to your notes.' })}
                </p>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
