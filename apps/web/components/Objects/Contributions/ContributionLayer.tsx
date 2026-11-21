'use client'
/*
 Contributions on the learner page, laid over the lesson (DynamicCanva).

 - Hover a block (or focus its credit button): a tiny rail at the margin
   shows who helped write it (avatar stack, names on hover) and, when the
   course allows it, "Suggest an edit" and "Give feedback" for that block.
 - Select text: a small bubble offers the same two actions for the passage.
 - Nothing shows until you hover, select or focus, so the page reads as
   before. Hidden in print; the avatars are decorative, the credit button
   carries the names for screen readers.

 Renders nothing when the course doesn't take contributions and nobody is
 credited on this page.
*/
import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { ChatCircleText, HandHeart, PencilSimpleLine, X } from '@phosphor-icons/react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  createFeedback,
  createSuggestion,
  getContributionContext,
  type BlockCredit,
  type ContributionContext,
} from '@services/courses/contributions'
import { blockConfig } from './blockRegistry'
import { buildDraft, creditIndexes, fingerprint, readableText, type JSONNode } from './contributionModel'
import { ContributorAvatars, contributorName } from './contributorUi'
import SuggestEditModal from './SuggestEditModal'
import FeedbackModal from './FeedbackModal'
import MyContributions from './MyContributions'

type Rect = { top: number; height: number }
type Target = { from: number; to: number; quote: string }

const HINT_KEY = 'lh:contrib-hint-dismissed'

export const contributionContextKey = (activityUuid: string) => ['contributions', 'context', activityUuid]

function readHintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return false
  }
}

export default function ContributionLayer({
  editor,
  activity,
  courseUuid,
  orgUuid,
}: {
  editor: any
  activity: any
  courseUuid?: string
  orgUuid?: string
}) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const activityUuid: string = activity?.activity_uuid

  const { data: ctx } = useQuery<ContributionContext>({
    queryKey: [...contributionContextKey(activityUuid), !!token],
    queryFn: () => getContributionContext(activityUuid, token),
    enabled: !!activityUuid && session?.status !== 'loading',
    staleTime: 60_000,
    retry: false,
  })

  const layerRef = React.useRef<HTMLDivElement>(null)
  const [blocks, setBlocks] = React.useState<JSONNode[]>([])
  const [rects, setRects] = React.useState<Rect[]>([])
  const [hovered, setHovered] = React.useState<number | null>(null)
  const [railFocus, setRailFocus] = React.useState(false)
  const [selection, setSelection] = React.useState<(Target & { top: number; left: number }) | null>(null)
  const [suggestFor, setSuggestFor] = React.useState<Target | null>(null)
  const [feedbackFor, setFeedbackFor] = React.useState<Target | null>(null)
  const [mineOpen, setMineOpen] = React.useState(false)
  const [deepLinkClosed, setDeepLinkClosed] = React.useState(false)
  // The layer only renders in the browser (ssr: false), so storage is readable here.
  const [hintDismissed, setHintDismissed] = React.useState(readHintDismissed)
  const leaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const deepLink = searchParams?.get('contribution') || searchParams?.get('feedback')
  // A notification link (?contribution= / ?feedback=) opens "Your contributions".
  const showMine = mineOpen || (!!deepLink && !!token && !deepLinkClosed)

  const active = !!ctx?.enabled
  const canAct = !!ctx && (ctx.can_suggest || ctx.can_feedback)
  const hasCredits = !!ctx?.credits?.length
  const shown = !!editor && (canAct || hasCredits)

  // Where each top-level block sits, kept fresh on edits, resizes and late layout.
  const measure = React.useCallback(() => {
    const layer = layerRef.current
    if (!editor || !layer || editor.isDestroyed) return
    const base = layer.getBoundingClientRect()
    const nextRects: Rect[] = []
    const json: JSONNode[] = (editor.getJSON()?.content ?? []) as JSONNode[]
    let pos = 0
    editor.state.doc.forEach((node: any) => {
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null
      const r = dom?.getBoundingClientRect?.()
      nextRects.push(r ? { top: r.top - base.top, height: r.height } : { top: 0, height: 0 })
      pos += node.nodeSize
    })
    setBlocks(json)
    setRects(nextRects)
  }, [editor])

  React.useEffect(() => {
    if (!shown) return
    measure()
    const ro = new ResizeObserver(() => measure())
    if (editor?.view?.dom) ro.observe(editor.view.dom)
    const late = setTimeout(measure, 800)
    editor?.on?.('update', measure)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      clearTimeout(late)
      editor?.off?.('update', measure)
      window.removeEventListener('resize', measure)
    }
  }, [shown, editor, measure])

  // Hover: the top-level block under the pointer.
  React.useEffect(() => {
    if (!shown || !editor?.view?.dom) return
    const root: HTMLElement = editor.view.dom
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      let el = e.target as HTMLElement | null
      while (el && el.parentElement !== root) el = el.parentElement
      if (!el) return
      let index = -1
      try {
        // The block the element renders (decorations and widgets don't count).
        index = editor.state.doc.resolve(editor.view.posAtDOM(el, 0)).index(0)
      } catch {
        index = Array.prototype.indexOf.call(root.children, el)
      }
      if (index >= 0) {
        if (leaveTimer.current) clearTimeout(leaveTimer.current)
        setHovered(index)
      }
    }
    const onLeave = () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
      leaveTimer.current = setTimeout(() => setHovered(null), 250)
    }
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerleave', onLeave)
    return () => {
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerleave', onLeave)
    }
  }, [shown, editor])

  // Selection: a passage of text → the bubble.
  React.useEffect(() => {
    if (!editor || !canAct) return
    const update = () => {
      const { from, to, empty } = editor.state.selection
      const layer = layerRef.current
      if (empty || !layer) return setSelection(null)
      const text = editor.state.doc.textBetween(from, to, ' ', ' ').trim()
      if (!text) return setSelection(null)
      const doc = editor.state.doc
      const first = doc.resolve(from).index(0)
      const last = doc.resolve(Math.max(from, to - 1)).index(0)
      const start = editor.view.coordsAtPos(from)
      const end = editor.view.coordsAtPos(to)
      const base = layer.getBoundingClientRect()
      setSelection({
        from: first,
        to: last + 1,
        quote: text.slice(0, 1500),
        top: Math.min(start.top, end.top) - base.top,
        left: Math.max(0, Math.min((start.left + end.left) / 2 - base.left, base.width)),
      })
    }
    const onBlur = () => setTimeout(() => setSelection(null), 200)
    editor.on('selectionUpdate', update)
    editor.on('blur', onBlur)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('blur', onBlur)
    }
  }, [editor, canAct])

  const creditAt = React.useMemo(() => {
    const map = creditIndexes(blocks, ctx?.credits ?? [])
    const out = new Map<number, BlockCredit>()
    map.forEach((creditPos, index) => out.set(index, (ctx?.credits ?? [])[creditPos]))
    return out
  }, [blocks, ctx?.credits])

  if (!shown || !ctx) return null

  const rangeEditable = (from: number, to: number) =>
    blocks.slice(from, to).every((b) => blockConfig(b?.type).mode !== 'none')

  const clearPageSelection = () => {
    try {
      window.getSelection()?.removeAllRanges()
    } catch {
      // Nothing selected.
    }
  }
  const openSuggest = (target: Target) => {
    if (!token) return
    clearPageSelection()
    setSelection(null)
    setSuggestFor(target)
  }
  const openFeedback = (target: Target) => {
    if (!token) return
    clearPageSelection()
    setSelection(null)
    setFeedbackFor(target)
  }
  const blockTarget = (index: number): Target => ({ from: index, to: index + 1, quote: readableText(blocks[index]).slice(0, 500) })

  const refreshContext = () => queryClient.invalidateQueries({ queryKey: contributionContextKey(activityUuid) })

  const submitSuggestion = async (after: JSONNode[], note: string) => {
    if (!suggestFor || !token) return
    const draft = buildDraft(blocks, suggestFor.from, suggestFor.to, after, ctx.current_version, note)
    const res = await createSuggestion(activityUuid, draft, token)
    if (res.status === 'accepted') {
      toast.success(t('contributions.toasts.published'))
      router.refresh()
    } else {
      toast.success(t('contributions.toasts.suggested'))
    }
    refreshContext()
  }

  const submitFeedback = async (type: any, body: string) => {
    if (!feedbackFor || !token) return
    const anchorBlock = blocks[feedbackFor.from]
    await createFeedback(
      activityUuid,
      { feedback_type: type, body, quote: feedbackFor.quote, block_index: feedbackFor.from, block_fp: anchorBlock ? fingerprint(anchorBlock) : null },
      token
    )
    toast.success(t('contributions.toasts.feedback_sent'))
    refreshContext()
  }

  const dismissHint = () => {
    setHintDismissed(true)
    try {
      localStorage.setItem(HINT_KEY, '1')
    } catch {
      // Private mode: the hint just comes back next time.
    }
  }

  const railIndex = hovered
  const railRect = railIndex !== null ? rects[railIndex] : null
  const railCredit = railIndex !== null ? creditAt.get(railIndex) : undefined
  const railEditable = railIndex !== null && rangeEditable(railIndex, railIndex + 1)
  const showRail = railRect && railIndex !== null && (railCredit || canAct)

  const actionBtn =
    'inline-flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/20'

  return (
    <>
      <div ref={layerRef} className="pointer-events-none absolute inset-0 print:hidden" data-contribution-layer="">
        {/* One focus stop per credited block, so keyboard users reach the credit too. */}
        {[...creditAt.entries()].map(([index, credit]) => {
          const r = rects[index]
          if (!r) return null
          const names = credit.users.map(contributorName).join(', ')
          return (
            <button
              key={`credit-${index}`}
              type="button"
              className="pointer-events-auto absolute end-0 h-6 w-6 rounded-full opacity-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 lg:-end-12"
              style={{ top: r.top }}
              aria-label={t('contributions.credits.aria', { names })}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
            />
          )
        })}

        {showRail && (
          // A faint wash behind the block the rail is about.
          <div
            aria-hidden="true"
            className="absolute -inset-x-1 rounded-xl bg-neutral-900/[0.025] ring-1 ring-inset ring-neutral-900/[0.04] transition-all duration-150 sm:inset-x-2"
            style={{ top: railRect.top - 4, height: railRect.height + 8 }}
          />
        )}
        {showRail && (
          <div
            className="pointer-events-auto absolute end-1 z-10 flex items-center gap-0.5 rounded-xl bg-white/95 p-0.5 shadow-sm ring-1 ring-neutral-900/5 backdrop-blur animate-in fade-in duration-150 lg:-end-14 lg:flex-col lg:bg-transparent lg:shadow-none lg:ring-0"
            style={{ top: Math.max(0, railRect.top) }}
            onPointerEnter={() => leaveTimer.current && clearTimeout(leaveTimer.current)}
            onPointerLeave={() => !railFocus && setHovered(null)}
            onFocus={() => setRailFocus(true)}
            onBlur={() => setRailFocus(false)}
          >
            {railCredit && (
              <div className="group/credit relative px-0.5" aria-hidden="true">
                <ContributorAvatars users={railCredit.users} max={3} size={22} />
                <div className="pointer-events-none absolute end-full top-1/2 me-2 w-max max-w-[220px] -translate-y-1/2 rounded-lg bg-neutral-900 px-2.5 py-1.5 text-xs text-white opacity-0 shadow-lh-floating transition-opacity group-hover/credit:opacity-100">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-white/60">{t('contributions.credits.title')}</span>
                  {railCredit.users.map(contributorName).join(', ')}
                </div>
              </div>
            )}
            {ctx.can_suggest && railEditable && (
              <button
                type="button"
                className={actionBtn}
                title={t('contributions.actions.suggest')}
                aria-label={t('contributions.actions.suggest')}
                onClick={() => openSuggest(blockTarget(railIndex))}
              >
                <PencilSimpleLine size={15} />
              </button>
            )}
            {ctx.can_feedback && (
              <button
                type="button"
                className={actionBtn}
                title={t('contributions.actions.feedback')}
                aria-label={t('contributions.actions.feedback')}
                onClick={() => openFeedback(blockTarget(railIndex))}
              >
                <ChatCircleText size={15} />
              </button>
            )}
          </div>
        )}

        {selection && canAct && (
          <div
            className="pointer-events-auto absolute z-20 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-xl bg-neutral-900 p-1 text-white shadow-lh-floating rtl:translate-x-1/2"
            style={{ top: selection.top - 8, insetInlineStart: selection.left }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {ctx.can_suggest && rangeEditable(selection.from, selection.to) && (
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold hover:bg-white/10"
                onClick={() => openSuggest(selection)}
              >
                <PencilSimpleLine size={14} />
                {t('contributions.actions.suggest')}
              </button>
            )}
            {ctx.can_feedback && (
              <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold hover:bg-white/10"
                onClick={() => openFeedback(selection)}
              >
                <ChatCircleText size={14} />
                {t('contributions.actions.feedback')}
              </button>
            )}
          </div>
        )}
      </div>

      {canAct && !hintDismissed && (
        <div className="mx-2 mb-2 flex items-start gap-3 rounded-2xl bg-emerald-50/70 sm:mx-4 px-4 py-3 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-600/10 print:hidden">
          <HandHeart size={18} className="mt-0.5 shrink-0" />
          <p className="min-w-0 flex-1">{t('contributions.hint')}</p>
          <button type="button" onClick={dismissHint} aria-label={t('common.close')} className="shrink-0 text-emerald-800/70 hover:text-emerald-900">
            <X size={16} />
          </button>
        </div>
      )}

      {active && token && (ctx.my_open_suggestions > 0 || deepLink) && (
        <div className="mx-2 mb-1 flex justify-end sm:mx-4 print:hidden">
          <button
            type="button"
            onClick={() => setMineOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 ring-1 ring-inset ring-neutral-200 hover:ring-neutral-300"
          >
            <HandHeart size={14} />
            {t('contributions.mine.open', { count: ctx.my_open_suggestions })}
          </button>
        </div>
      )}

      {suggestFor && (
        <SuggestEditModal
          open
          onClose={() => setSuggestFor(null)}
          activity={activity}
          courseUuid={courseUuid}
          orgUuid={orgUuid}
          before={blocks.slice(suggestFor.from, suggestFor.to)}
          title={t('contributions.suggest.title')}
          submitLabel={ctx.publishes_directly ? t('contributions.suggest.publish') : t('contributions.suggest.send')}
          hint={ctx.publishes_directly ? t('contributions.suggest.trusted_hint') : t('contributions.suggest.review_note')}
          onSubmit={submitSuggestion}
        />
      )}
      {feedbackFor && (
        <FeedbackModal open onClose={() => setFeedbackFor(null)} quote={feedbackFor.quote} onSubmit={submitFeedback} />
      )}
      {showMine && token && (
        <MyContributions
          open
          onClose={() => {
            setMineOpen(false)
            setDeepLinkClosed(true)
          }}
          activity={activity}
          courseUuid={courseUuid}
          orgUuid={orgUuid}
          token={token}
          focus={deepLink}
          onChanged={refreshContext}
        />
      )}
    </>
  )
}
