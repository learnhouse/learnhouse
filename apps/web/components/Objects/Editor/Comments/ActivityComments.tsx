'use client'
import React from 'react'
import { createPortal } from 'react-dom'
import { COMMENTS_SLOT_ID } from '../Header/EditorHeaderControls'
import { HBADGE, HICON } from '../Header/headerStyles'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import type { Editor } from '@tiptap/core'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import { ChatCircleText, ChatCenteredText, LinkBreak, X } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  type ActivityComment,
  type CommentAuthor,
  type CommentThread,
  createCommentThread,
  deleteComment,
  editComment,
  replyToThread,
  setThreadStatus,
} from '@services/courses/activityComments'
import { CommentCard, NewThreadCard, type ThreadActions } from './CommentCard'
import { commentHighlightKey, type CommentMarkStorage } from './CommentMark'
import { type CommentAnchor, collectCommentAnchors, groupThreads, layoutCards } from './commentAnchors'
import { useActivityComments } from './useActivityComments'

// Google Docs-style comments for the activity editor.
//
// Wide screens (>= 1100px): a rail beside the page with each open thread's
// card next to its text, stacked so cards never overlap and the focused one
// sits exactly at its anchor. Narrower screens: the same cards in a drawer.
// The "Comments" pill opens the full list (detached and resolved threads too).

const WIDE_QUERY = '(min-width: 1100px)'
const NEW_ID = 'new'
const RAIL_GAP = 8

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false)
  React.useEffect(() => {
    const mql = window.matchMedia(query)
    const update = () => setMatches(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [query])
  return matches
}

function sameAnchors(a: Map<string, CommentAnchor>, b: Map<string, CommentAnchor>): boolean {
  if (a.size !== b.size) return false
  for (const [id, x] of a) {
    const y = b.get(id)
    if (!y || y.from !== x.from || y.to !== x.to) return false
  }
  return true
}

function storageOf(editor: Editor | null): CommentMarkStorage | null {
  return ((editor?.storage as any)?.comment as CommentMarkStorage | undefined) ?? null
}

type Props = { editor: Editor | null; activity: { activity_uuid: string } }

function selectionBubbleVisible(): boolean {
  const bubble = document.querySelector<HTMLElement>('[data-lh-selection-bubble]')
  if (!bubble) return false
  const box = bubble.getBoundingClientRect()
  return box.width > 0 && box.height > 0 && getComputedStyle(bubble).visibility !== 'hidden'
}

export default function ActivityComments({ editor, activity }: Props) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const sessionUser = session?.data?.user
  const activityUuid = activity.activity_uuid
  const { data, applyThread, collaborative } = useActivityComments(editor, activityUuid, token)
  const threads = React.useMemo(() => data?.threads ?? [], [data])
  const wide = useMediaQuery(WIDE_QUERY)

  const [active, setActive] = React.useState<string | null>(null)
  const [composer, setComposer] = React.useState<{ quote: string } | null>(null)
  const [showResolved, setShowResolved] = React.useState(false)
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [anchors, setAnchors] = React.useState<Map<string, CommentAnchor>>(() => new Map())
  const [selectionButton, setSelectionButton] = React.useState<{ top: number; left: number } | null>(null)
  // The header's slot for the comments toggle (EditorHeaderControls)
  const [commentsSlot, setCommentsSlot] = React.useState<HTMLElement | null>(null)
  React.useEffect(() => {
    const find = () => setCommentsSlot(document.getElementById(COMMENTS_SLOT_ID))
    find()
    // The header remounts when the editor switches to live editing
    const observer = new MutationObserver(() => {
      const el = document.getElementById(COMMENTS_SLOT_ID)
      setCommentsSlot((prev) => (prev === el ? prev : el))
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  const me: CommentAuthor | null = sessionUser
    ? {
        id: sessionUser.id,
        user_uuid: sessionUser.user_uuid,
        username: sessionUser.username,
        first_name: sessionUser.first_name ?? '',
        last_name: sessionUser.last_name ?? '',
        avatar_image: sessionUser.avatar_image ?? '',
      }
    : null
  const ctx = {
    me: data?.current_user_id ?? sessionUser?.id ?? 0,
    canModerate: !!data?.can_moderate,
    activityUuid,
    token,
  }

  // ── where threads sit in the text ──
  React.useEffect(() => {
    if (!editor) return
    let timer = 0
    const recompute = () => {
      if (editor.isDestroyed) return
      const next = collectCommentAnchors(editor.state.doc)
      setAnchors((prev) => (sameAnchors(prev, next) ? prev : next))
    }
    // Typing re-renders nothing until the doc settles for a beat.
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(recompute, 120)
    }
    recompute()
    editor.on('update', schedule)
    return () => {
      editor.off('update', schedule)
      window.clearTimeout(timer)
    }
  }, [editor])

  const groups = React.useMemo(() => groupThreads(threads, anchors), [threads, anchors])

  // ── highlights + paste filter follow the thread list ──
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const visible = threads.filter((th) => th.status === 'open').map((th) => th.thread_uuid)
    editor.commands.setCommentHighlights({ visible, active })
    const storage = storageOf(editor)
    if (storage) storage.knownThreadIds = new Set(threads.map((th) => th.thread_uuid))
  }, [editor, threads, active])

  const scrollToAnchor = React.useCallback(
    (threadId: string) => {
      const anchor = anchors.get(threadId)
      if (!editor || !anchor || editor.isDestroyed) return
      try {
        const { node } = editor.view.domAtPos(anchor.from)
        const el = (node.nodeType === 3 ? node.parentElement : node) as HTMLElement | null
        const rect = el?.getBoundingClientRect()
        if (el && rect && (rect.top < 120 || rect.bottom > window.innerHeight - 60)) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        }
      } catch {
        // Position outside the view (doc changed under us): nothing to scroll.
      }
    },
    [editor, anchors]
  )

  // ── composer ──
  const openComposer = React.useCallback(() => {
    if (!editor || editor.isDestroyed) return
    const { from, to, empty } = editor.state.selection
    if (empty) {
      toast(t('editor.comments.select_text_first'))
      return
    }
    const quote = editor.state.doc.textBetween(from, to, ' ', ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
    if (!quote) {
      toast(t('editor.comments.select_text_first'))
      return
    }
    editor.commands.setCommentHighlights({ pending: { from, to } })
    setComposer({ quote })
    setActive(null)
    setSelectionButton(null)
    if (!wide) setPanelOpen(true)
  }, [editor, wide, t])

  const closeComposer = React.useCallback(() => {
    setComposer(null)
    if (editor && !editor.isDestroyed) editor.commands.setCommentHighlights({ pending: null })
  }, [editor])

  const fail = React.useCallback(
    (e: any) => {
      toast.error(e?.message || t('editor.comments.error'))
      return false
    },
    [t]
  )

  const submitNew = React.useCallback(
    async (body: string, mentions: number[]) => {
      if (!editor || !token || !composer) return false
      try {
        const thread = await createCommentThread(activityUuid, { quote: composer.quote, body, mentions }, token)
        const pending = commentHighlightKey.getState(editor.state)?.pending
        if (pending && !editor.isDestroyed) {
          editor.chain().setComment(thread.thread_uuid, pending).setCommentHighlights({ pending: null }).run()
        }
        applyThread(thread)
        setComposer(null)
        setActive(thread.thread_uuid)
        if (!collaborative) toast(t('editor.comments.save_to_keep'))
        return true
      } catch (e) {
        return fail(e)
      }
    },
    [editor, token, composer, activityUuid, applyThread, collaborative, fail, t]
  )

  const actions: ThreadActions = React.useMemo(
    () => ({
      reply: async (thread, body, mentions) => {
        if (!token) return false
        try {
          applyThread(await replyToThread(activityUuid, thread.thread_uuid, { body, mentions }, token))
          return true
        } catch (e) {
          return fail(e)
        }
      },
      edit: async (thread, comment: ActivityComment, body, mentions) => {
        if (!token) return false
        try {
          applyThread(await editComment(activityUuid, thread.thread_uuid, comment.comment_uuid, { body, mentions }, token))
          return true
        } catch (e) {
          return fail(e)
        }
      },
      remove: async (thread, comment: ActivityComment) => {
        if (!token) return false
        try {
          const updated = await deleteComment(activityUuid, thread.thread_uuid, comment.comment_uuid, token)
          applyThread(updated)
          // Last comment gone: the thread is gone, so is its highlight.
          if (updated.comments.every((c) => c.deleted) && editor && !editor.isDestroyed) {
            editor.commands.unsetComment(thread.thread_uuid)
            setActive((a) => (a === thread.thread_uuid ? null : a))
          }
          return true
        } catch (e) {
          return fail(e)
        }
      },
      setStatus: async (thread, status) => {
        if (!token) return false
        try {
          applyThread(await setThreadStatus(activityUuid, thread.thread_uuid, status, token))
          if (status === 'resolved') setActive((a) => (a === thread.thread_uuid ? null : a))
          return true
        } catch (e) {
          return fail(e)
        }
      },
    }),
    [token, activityUuid, applyThread, editor, fail]
  )

  // ── editor hooks: ⌘⌥M and clicks on highlighted text ──
  React.useEffect(() => {
    const storage = storageOf(editor)
    if (!storage) return
    storage.onShortcut = openComposer
    storage.onClickThreads = (ids) => {
      if (ids.length) {
        setActive(ids[0])
        if (!wide) setPanelOpen(true)
      } else {
        setActive(null)
      }
    }
    return () => {
      storage.onShortcut = null
      storage.onClickThreads = null
    }
  }, [editor, openComposer, wide])

  // ── floating "Comment" button next to a text selection ──
  React.useEffect(() => {
    if (!editor) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed) return
        const { selection } = editor.state
        const text = !selection.empty && editor.isFocused && (selection as any).$from?.parent?.inlineContent
        if (!text) return setSelectionButton(null)
        // The selection menu has its own Comment button: don't stack a second one
        if (selectionBubbleVisible()) return setSelectionButton(null)
        try {
          const coords = editor.view.coordsAtPos(selection.from)
          const box = editor.view.dom.getBoundingClientRect()
          const rtl = getComputedStyle(editor.view.dom).direction === 'rtl'
          const size = 36
          let left = rtl ? box.left - size - 8 : box.right + 8
          if (left < 8 || left + size > window.innerWidth - 8) left = rtl ? box.left + 4 : box.right - size - 4
          setSelectionButton({ top: Math.max(coords.top - 4, 8), left })
          // The selection menu opens a beat later; give way to it then too
          window.setTimeout(() => selectionBubbleVisible() && setSelectionButton(null), 150)
        } catch {
          setSelectionButton(null)
        }
      })
    }
    const hide = () => window.setTimeout(() => !editor.isDestroyed && !editor.isFocused && setSelectionButton(null), 150)
    editor.on('selectionUpdate', update)
    editor.on('focus', update)
    editor.on('blur', hide)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(frame)
      editor.off('selectionUpdate', update)
      editor.off('focus', update)
      editor.off('blur', hide)
      window.removeEventListener('scroll', update, true)
    }
  }, [editor])

  // ── deep link from a mention email: ?thread=thread_… ──
  const linked = React.useRef(false)
  React.useEffect(() => {
    if (linked.current || !data) return
    linked.current = true
    const id = new URLSearchParams(window.location.search).get('thread')
    const thread = id ? threads.find((th) => th.thread_uuid === id) : null
    if (!thread) return
    setActive(thread.thread_uuid)
    if (thread.status === 'resolved') {
      setShowResolved(true)
      setPanelOpen(true)
    } else if (!anchors.has(thread.thread_uuid) || !wide) {
      setPanelOpen(true)
    }
    window.setTimeout(() => scrollToAnchor(thread.thread_uuid), 300)
  }, [data, threads, anchors, wide, scrollToAnchor])

  const activate = (thread: CommentThread) => {
    setActive(thread.thread_uuid)
    scrollToAnchor(thread.thread_uuid)
  }

  const railThreads = React.useMemo(
    () =>
      showResolved
        ? [...groups.anchored, ...groups.resolved.filter((th) => anchors.has(th.thread_uuid))].sort(
            (a, b) => (anchors.get(a.thread_uuid)?.from ?? 0) - (anchors.get(b.thread_uuid)?.from ?? 0)
          )
        : groups.anchored,
    [groups, anchors, showResolved]
  )
  const openCount = groups.anchored.length + groups.detached.length
  const showRail = wide && (railThreads.length > 0 || !!composer)

  const newCard = composer ? (
    <NewThreadCard quote={composer.quote} onSubmit={submitNew} onCancel={closeComposer} ctx={ctx} me={me} />
  ) : null

  const card = (thread: CommentThread, opts: { detached?: boolean; quote?: boolean } = {}) => (
    <CommentCard
      key={thread.thread_uuid}
      thread={thread}
      active={active === thread.thread_uuid}
      onActivate={() => activate(thread)}
      ctx={ctx}
      actions={actions}
      detached={opts.detached}
      showQuote={opts.quote}
    />
  )

  return (
    <>
      {showRail && editor && (
        <CommentRail
          editor={editor}
          threads={railThreads}
          anchors={anchors}
          active={composer ? NEW_ID : active}
          hasNew={!!composer}
          newCard={newCard}
          renderCard={(th) => card(th)}
        />
      )}

      {/* The list: every thread, detached and resolved too. A drawer on narrow screens. */}
      {panelOpen && (
        <CommentPanel
          onClose={() => setPanelOpen(false)}
          showResolved={showResolved}
          setShowResolved={setShowResolved}
          count={openCount}
        >
          {!wide && newCard}
          {groups.anchored.length === 0 && groups.detached.length === 0 && !composer && (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <ChatCenteredText size={22} className="text-neutral-400" />
              <p className="mt-2 text-[13px] font-semibold text-neutral-800">{t('editor.comments.empty_title')}</p>
              <p className="mt-1 text-[12px] text-neutral-500">{t('editor.comments.empty_body')}</p>
            </div>
          )}
          {groups.anchored.map((th) => card(th, { quote: true }))}
          {groups.detached.length > 0 && (
            <Section icon={<LinkBreak size={13} />} title={t('editor.comments.detached')} hint={t('editor.comments.detached_hint')}>
              {groups.detached.map((th) => card(th, { detached: true }))}
            </Section>
          )}
          {showResolved && groups.resolved.length > 0 && (
            <Section title={t('editor.comments.resolved')}>{groups.resolved.map((th) => card(th, { quote: true }))}</Section>
          )}
        </CommentPanel>
      )}

      {/* Comments toggle: docked in the editor header group (no floating pill
          colliding with the Atlas bubble); floating only if the header has no slot */}
      {(() => {
        const label = openCount > 0 ? `${t('editor.comments.title')} (${openCount})` : t('editor.comments.title')
        if (commentsSlot) {
          // Docked: an icon button like the other header controls, count as a badge
          return createPortal(
            <ToolTip content={label} side="bottom">
              <button
                type="button"
                onClick={() => setPanelOpen((o) => !o)}
                aria-expanded={panelOpen}
                aria-label={label}
                data-comments-toggle
                className={HICON}
              >
                <ChatCircleText size={16} weight={openCount ? 'fill' : 'regular'} className={openCount ? 'text-amber-500' : ''} />
                {openCount > 0 && <span className={HBADGE}>{openCount}</span>}
              </button>
            </ToolTip>,
            commentsSlot,
          )
        }
        return (
          <button
            type="button"
            onClick={() => setPanelOpen((o) => !o)}
            aria-expanded={panelOpen}
            aria-label={label}
            data-comments-toggle
            className="fixed bottom-5 end-5 z-40 flex h-9 items-center gap-1.5 rounded-full bg-white ps-3 pe-3.5 text-[13px] font-semibold text-neutral-700 shadow-lh-floating ring-1 ring-neutral-200 transition-colors hover:bg-neutral-50"
          >
            <ChatCircleText size={16} weight={openCount ? 'fill' : 'regular'} className={openCount ? 'text-amber-500' : ''} />
            {t('editor.comments.title')}
            {openCount > 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold leading-[18px] text-amber-800 tabular-nums">{openCount}</span>
            )}
          </button>
        )
      })()}

      {selectionButton &&
        !composer &&
        createPortal(
          <button
            type="button"
            data-comment-add
            // Keep the editor selection: don't take focus on press.
            onMouseDown={(e) => e.preventDefault()}
            onClick={openComposer}
            style={{ top: selectionButton.top, left: selectionButton.left }}
            className="fixed z-[135] flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-700 shadow-lh-floating ring-1 ring-neutral-200 transition-colors hover:bg-amber-50 hover:text-amber-700"
            aria-label={t('editor.comments.add')}
            title={`${t('editor.comments.add')} (⌘⌥M)`}
          >
            <ChatCircleText size={18} />
          </button>,
          document.body
        )}
    </>
  )
}

function Section({ title, hint, icon, children }: { title: string; hint?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="pt-2">
      <div className="flex items-center gap-1.5 px-1 pb-2 text-[13px] font-semibold text-neutral-700">
        {icon}
        {title}
      </div>
      {hint && <p className="-mt-1 px-1 pb-2 text-[12px] text-neutral-400">{hint}</p>}
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function CommentPanel({
  children,
  onClose,
  showResolved,
  setShowResolved,
  count,
}: {
  children: React.ReactNode
  onClose: () => void
  showResolved: boolean
  setShowResolved: (_v: boolean) => void
  count: number
}) {
  const { t } = useTranslation()
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('textarea')) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <aside
      role="complementary"
      aria-label={t('editor.comments.title')}
      data-comments-panel
      className="fixed inset-x-0 bottom-0 z-[136] flex max-h-[75vh] flex-col rounded-t-2xl bg-neutral-50 shadow-lh-floating ring-1 ring-black/5 sm:inset-x-auto sm:end-4 sm:top-[150px] sm:bottom-4 sm:max-h-none sm:w-[360px] sm:rounded-2xl"
    >
      <div className="border-b border-neutral-200/70 px-4 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <ChatCircleText size={16} className="shrink-0 text-neutral-500" />
          <h2 className="min-w-0 truncate text-[14px] font-semibold text-neutral-900">{t('editor.comments.title')}</h2>
          {count > 0 && <span className="shrink-0 text-[12px] text-neutral-400 tabular-nums">{count}</span>}
          <button
            type="button"
            onClick={onClose}
            className="ms-auto shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700"
            aria-label={t('editor.comments.close')}
          >
            <X size={15} />
          </button>
        </div>
        <label className="mt-1.5 flex w-fit cursor-pointer select-none items-center gap-1.5 text-[12px] text-neutral-600">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-neutral-300 accent-neutral-900"
          />
          {t('editor.comments.show_resolved')}
        </label>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">{children}</div>
    </aside>,
    document.body
  )
}

/** Cards aligned with their anchors, beside the page. */
function CommentRail({
  editor,
  threads,
  anchors,
  active,
  hasNew,
  newCard,
  renderCard,
}: {
  editor: Editor
  threads: CommentThread[]
  anchors: Map<string, CommentAnchor>
  active: string | null
  hasNew: boolean
  newCard: React.ReactNode
  renderCard: (_thread: CommentThread) => React.ReactNode
}) {
  const { t } = useTranslation()
  const railRef = React.useRef<HTMLDivElement>(null)
  const cardRefs = React.useRef(new Map<string, HTMLDivElement>())
  const [tops, setTops] = React.useState<Map<string, number>>(() => new Map())
  const [height, setHeight] = React.useState(0)

  const layout = React.useCallback(() => {
    const rail = railRef.current
    if (!rail || editor.isDestroyed) return
    const railTop = rail.getBoundingClientRect().top
    const size = editor.state.doc.content.size
    const items: { id: string; pos: number }[] = threads
      .map((th) => ({ id: th.thread_uuid, pos: anchors.get(th.thread_uuid)?.from ?? -1 }))
      .filter((x) => x.pos >= 0)
    if (hasNew) {
      const pending = commentHighlightKey.getState(editor.state)?.pending
      items.push({ id: NEW_ID, pos: pending?.from ?? editor.state.selection.from })
    }
    items.sort((a, b) => a.pos - b.pos)
    const boxes = items.map(({ id, pos }) => {
      let desired = 0
      try {
        desired = editor.view.coordsAtPos(Math.min(Math.max(pos, 0), size)).top - railTop
      } catch {
        desired = 0
      }
      return { id, desired: Math.max(desired, 0), height: cardRefs.current.get(id)?.offsetHeight ?? 96 }
    })
    const next = layoutCards(boxes, active, RAIL_GAP)
    // Pushed-up cards may not go above the page's first line (the editor's
    // fixed toolbar sits above it).
    const page = editor.view.dom.closest('.activity-editor-content-wrapper') ?? editor.view.dom
    const floor = Math.max(0, page.getBoundingClientRect().top - railTop)
    const minTop = Math.min(...next.values())
    if (minTop < floor) for (const [id, top] of next) next.set(id, top + floor - minTop)
    let bottom = 0
    for (const box of boxes) bottom = Math.max(bottom, (next.get(box.id) ?? 0) + box.height)
    setTops((prev) => {
      if (prev.size === next.size && [...next].every(([id, v]) => prev.get(id) === v)) return prev
      return next
    })
    setHeight(bottom + 24)
  }, [editor, threads, anchors, active, hasNew])

  React.useLayoutEffect(() => {
    layout()
  }, [layout])

  React.useEffect(() => {
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(layout)
    }
    const ro = new ResizeObserver(schedule)
    ro.observe(editor.view.dom)
    for (const el of cardRefs.current.values()) ro.observe(el)
    window.addEventListener('resize', schedule)
    editor.on('update', schedule)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('resize', schedule)
      editor.off('update', schedule)
    }
  }, [editor, layout, threads, hasNew])

  const setRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el)
    else cardRefs.current.delete(id)
  }

  return (
    <aside
      ref={railRef}
      data-comments-rail
      aria-label={t('editor.comments.title')}
      className="relative w-[288px] shrink-0"
      style={{ minHeight: height }}
    >
      {hasNew && (
        <div
          ref={setRef(NEW_ID)}
          className="absolute inset-x-0 z-10 transition-transform duration-150 ease-lh-out"
          style={{ transform: `translateY(${tops.get(NEW_ID) ?? 0}px)` }}
        >
          {newCard}
        </div>
      )}
      {threads.map((th) => (
        <div
          key={th.thread_uuid}
          ref={setRef(th.thread_uuid)}
          className={`absolute inset-x-0 transition-transform duration-150 ease-lh-out ${active === th.thread_uuid ? 'z-10' : ''}`}
          style={{ transform: `translateY(${tops.get(th.thread_uuid) ?? 0}px)`, visibility: tops.has(th.thread_uuid) ? 'visible' : 'hidden' }}
        >
          {renderCard(th)}
        </div>
      ))}
    </aside>
  )
}
