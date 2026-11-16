'use client'
/*
 Magic block: AI-generated interactive HTML in a sandboxed frame.

 Editor flow, all inside the block (no modal):
   prompt → generate (streams into the preview, Stop cancels) → a draft with
   Use this / Try again / Discard and "ask for changes" → accepted content.
 Accepted content has toolbar tools: Edit with AI, History, Style, Height,
 Expand, Clear.

 Collab: the prompt, the stream and the draft are local; the document only
 changes when the author accepts a result (htmlContent + sessionUuid in one
 write), restores/clears it, or finishes a height drag (one write on release).
*/
import { NodeViewProps, NodeViewWrapper } from '@tiptap/react'
import { CreditCost } from '@components/Objects/AI/CreditCost'
import { useAICreditPrices } from '@components/Hooks/useAICredits'
import { Node } from '@tiptap/core'
import React from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'
import { useTranslation } from 'react-i18next'
import {
  ArrowClockwise,
  ArrowsIn,
  ArrowsOut,
  Check,
  ClockCounterClockwise,
  Clipboard,
  DotsSixVertical,
  Lock,
  PaintBrush,
  PencilSimple,
  Trash,
  X,
} from '@phosphor-icons/react'
import EditorBlockFrame from '../../Blocks/ui/EditorBlockFrame'
import { BlockPopover } from '../../Blocks/ui/BlockChrome'
import { AIButton, AIMark, AI_DARK_SURFACE } from '@components/Objects/AI/AIBrand'
import { useEditorProvider } from '@components/Contexts/Editor/EditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useCourse } from '@components/Contexts/CourseContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { buttonClass } from '@components/Dashboard/Shared/DashKit/buttons'
import PlanBadge from '@components/Dashboard/Shared/PlanRestricted/PlanBadge'
import { usePlan } from '@components/Hooks/usePlan'
import { PlanLevel } from '@services/plans/plans'
import { getMagicBlockSession } from '@services/ai/magicblocks'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { cn } from '@/lib/utils'
import MagicBlockPreview from './MagicBlockPreview'
import MagicBlockRevisions from './MagicBlockRevisions'
import { MagicComposer } from './MagicComposer'
import { useAICredits, useMagicGeneration, type MagicRequest, type MagicResult } from './useMagicGeneration'
import { MAGIC_BLOCK_MAX_ITERATIONS, type MagicBlockContext, type MagicBlockRevision } from './types'

const STYLE_STORAGE_KEY = 'magicblock_style_reference'
const HEIGHTS = [
  { id: 'S', value: 300 },
  { id: 'M', value: 450 },
  { id: 'L', value: 600 },
  { id: 'XL', value: 800 },
  { id: 'XXL', value: 1200 },
] as const

type MagicNodeViewProps = Omit<NodeViewProps, 'extension'> & {
  extension: Node & { options: { activity: { activity_uuid: string; name: string; content?: any } } }
}

function readStyle(): string | null {
  try {
    const v = window.localStorage.getItem(STYLE_STORAGE_KEY)
    return v && v.length > 0 ? v : null
  } catch {
    return null
  }
}

function writeStyle(v: string | null) {
  try {
    if (v) window.localStorage.setItem(STYLE_STORAGE_KEY, v)
    else window.localStorage.removeItem(STYLE_STORAGE_KEY)
  } catch {
    // private mode / blocked storage: the reference just won't persist
  }
}

/** Updates at most every `ms` while the value keeps changing (iframe reloads are costly). */
function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = React.useState(value)
  const last = React.useRef(0)
  React.useEffect(() => {
    const wait = Math.max(0, ms - (Date.now() - last.current))
    const timer = window.setTimeout(() => {
      last.current = Date.now()
      setShown(value)
    }, wait)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return shown
}

function MagicBlockComponent(props: MagicNodeViewProps) {
  const editorState = useEditorProvider() as { isEditable: boolean }
  const htmlContent: string | null = props.node.attrs.htmlContent
  const height: number = props.node.attrs.height || 400
  if (!editorState?.isEditable) {
    return htmlContent ? <MagicLearnerView html={htmlContent} height={height} /> : null
  }
  return <MagicEditor {...props} />
}

// ─── Learner ────────────────────────────────────────────────────────────────

function MagicLearnerView({ html, height }: { html: string; height: number }) {
  const { t } = useTranslation()
  const [full, setFull] = React.useState(false)
  return (
    <NodeViewWrapper className="block-magic w-full">
      <div className="group relative">
        <div className="overflow-hidden rounded-xl" style={{ height: `min(${height}px, 85vh)` }}>
          <MagicBlockPreview htmlContent={html} />
        </div>
        <button
          type="button"
          onClick={() => setFull(true)}
          className="absolute end-2 top-2 rounded-lg bg-black/50 p-2 opacity-0 transition-colors hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
          aria-label={t('editor.blocks.common.expand')}
          title={t('editor.blocks.common.expand')}
        >
          <ArrowsOut weight="duotone" className="h-4 w-4 text-white" />
        </button>
      </div>
      {full && <FullscreenMagic html={html} onClose={() => setFull(false)} />}
    </NodeViewWrapper>
  )
}

/** Full-screen view (a portal, not a Radix dialog, so node views are left alone). */
function FullscreenMagic({ html, onClose }: { html: string; onClose: () => void }) {
  const { t } = useTranslation()
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed inset-0 flex bg-black/50 p-2 sm:p-6"
      style={{ zIndex: 'var(--z-modal)' }}
      role="dialog"
      aria-modal="true"
      aria-label={t('editor.blocks.magic_block_content.interactive_element')}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      data-testid="magic-fullscreen"
    >
      <div className="relative flex min-h-0 w-full flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(0,0,0,0.25)]">
        <button
          type="button"
          onClick={onClose}
          className={buttonClass('secondary', 'sm', 'absolute end-3 top-3 z-10')}
        >
          <ArrowsIn size={13} />
          {t('common.close', 'Close')}
        </button>
        <div className="min-h-0 flex-1">
          <MagicBlockPreview htmlContent={html} />
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Editor ─────────────────────────────────────────────────────────────────

function MagicEditor(props: MagicNodeViewProps) {
  const { t } = useTranslation()
  const { node, editor, getPos, extension, updateAttributes } = props
  const session = useLHSession() as any
  const course = useCourse() as any
  const org = useOrg() as any
  const currentPlan = usePlan()
  const { track } = useLHAnalytics('editor')
  const accessToken: string | undefined = session?.data?.tokens?.access_token
  const rf = org?.config?.config?.resolved_features
  const canUseAI = rf?.ai?.enabled === true

  const htmlContent: string | null = node.attrs.htmlContent
  const sessionUuid: string | null = node.attrs.sessionUuid
  const blockUuid: string = node.attrs.blockUuid || ''
  const height: number = node.attrs.height || 400

  // Every block needs its own id. A duplicated or pasted copy carries the
  // original's id and session; give it a fresh id and its own session.
  React.useEffect(() => {
    if (!node.attrs.blockUuid) {
      queueMicrotask(() => updateAttributes({ blockUuid: `magic_${uuidv4()}` }))
      return
    }
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (typeof pos !== 'number') return
    let duplicate = false
    editor.state.doc.descendants((n, p) => {
      if (duplicate || p >= pos) return false
      if (n.type.name === 'blockMagic' && n.attrs.blockUuid === node.attrs.blockUuid) duplicate = true
    })
    if (duplicate) queueMicrotask(() => updateAttributes({ blockUuid: `magic_${uuidv4()}`, sessionUuid: null }))
  }, [node.attrs.blockUuid]) // eslint-disable-line react-hooks/exhaustive-deps

  const [styleRef, setStyleRef] = React.useState<string | null>(() => (typeof window === 'undefined' ? null : readStyle()))
  const { estimate: estimateCredits } = useAICreditPrices()
  const credits = useAICredits(org?.id, accessToken, estimateCredits('magic_block') ?? undefined)

  const buildContext = React.useCallback((): MagicBlockContext => {
    const content = extension.options.activity.content
    const extract = (nodes: any[]): string =>
      nodes
        .map((n) => (n.type === 'text' ? n.text || '' : Array.isArray(n.content) ? extract(n.content) : ''))
        .join(' ')
        .slice(0, 500)
    return {
      course_title: course?.courseStructure?.name || 'Course',
      course_description: course?.courseStructure?.description || '',
      activity_name: extension.options.activity.name || 'Activity',
      activity_content_summary: Array.isArray(content?.content) ? extract(content.content) : '',
    }
  }, [course, extension])

  const gen = useMagicGeneration({
    activityUuid: extension.options.activity.activity_uuid,
    blockUuid,
    accessToken,
    context: buildContext,
    styleReference: styleRef,
  })

  const [draft, setDraft] = React.useState<MagicResult | null>(null)
  const [prompt, setPrompt] = React.useState('')
  const [refineOpen, setRefineOpen] = React.useState(false)
  const [composing, setComposing] = React.useState(false)
  const [refinePrompt, setRefinePrompt] = React.useState('')
  const [revisions, setRevisions] = React.useState<MagicBlockRevision[]>([])
  const [revLoading, setRevLoading] = React.useState(false)
  const [usage, setUsage] = React.useState<{ session: string; count: number; max: number } | null>(null)
  const [pop, setPop] = React.useState<null | 'history' | 'style' | 'height'>(null)
  const [full, setFull] = React.useState(false)
  const [dragHeight, setDragHeight] = React.useState<number | null>(null)
  const [styleNote, setStyleNote] = React.useState<string | null>(null)

  const activeSession = draft?.sessionUuid ?? sessionUuid
  const editsLeft = usage && usage.session === activeSession ? usage.max - usage.count : null

  // Session details (past generations, edits used) when the author reaches for them.
  const loadSession = React.useCallback(async () => {
    if (!activeSession || !accessToken) return
    setRevLoading(true)
    const res = await getMagicBlockSession(activeSession, accessToken)
    setRevLoading(false)
    if (res.success && res.data) {
      setRevisions(Array.isArray(res.data.revisions) ? res.data.revisions : [])
      setUsage({
        session: activeSession,
        count: res.data.iteration_count ?? 0,
        max: res.data.max_iterations ?? MAGIC_BLOCK_MAX_ITERATIONS,
      })
    }
  }, [activeSession, accessToken])

  const go = async (req: MagicRequest) => {
    track(AnalyticsEvent.MagicBlockGenerationRequested, {
      iteration_count: usage?.count ?? 0,
      is_first_generation: req.kind === 'start',
    })
    const res = await gen.run(req)
    credits.refresh()
    if (!res) return
    setDraft(res)
    setUsage((u) =>
      req.kind === 'start' || !u || u.session !== res.sessionUuid
        ? { session: res.sessionUuid, count: req.kind === 'start' ? 1 : (u?.count ?? 0) + 1, max: u?.max ?? MAGIC_BLOCK_MAX_ITERATIONS }
        : { ...u, count: u.count + 1 },
    )
    setRevisions((r) => [...r, { revision_uuid: `local_${Date.now()}`, prompt: res.prompt, html: res.html, created_at: Date.now() / 1000 }].slice(-20))
  }

  const refine = (text: string) => {
    const base = draft?.html ?? htmlContent
    if (activeSession) go({ kind: 'iterate', prompt: text, sessionUuid: activeSession, baseHtml: base })
    else go({ kind: 'start', prompt: text })
    setRefinePrompt('')
  }

  const accept = () => {
    if (!draft) return
    track(AnalyticsEvent.MagicBlockSaved, { iteration_count: usage?.count ?? 0 })
    updateAttributes({ htmlContent: draft.html, sessionUuid: draft.sessionUuid })
    setDraft(null)
    setRefineOpen(false)
  }

  const clearContent = () => {
    updateAttributes({ htmlContent: null, sessionUuid: null })
    setDraft(null)
    setRefineOpen(false)
    setComposing(false)
    setRevisions([])
    setUsage(null)
  }

  const copyStyle = async () => {
    const html = draft?.html ?? htmlContent
    if (!html) return
    let ok = false
    try {
      await navigator.clipboard.writeText(html)
      ok = true
    } catch {
      // clipboard blocked: the reference still works in this browser
    }
    writeStyle(html)
    setStyleRef(html)
    setStyleNote(ok ? t('editor.blocks.magic_block_content.copy_style_done') : t('editor.blocks.magic_block_content.clipboard_unavailable'))
  }

  const pasteStyle = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text || !(/<\w/.test(text) && text.includes('>'))) {
        setStyleNote(t('editor.blocks.magic_block_content.paste_style_invalid'))
        return
      }
      writeStyle(text)
      setStyleRef(text)
      setStyleNote(t('editor.blocks_v2.magic.style_pasted', 'Style pasted. New generations will match it.'))
    } catch {
      setStyleNote(t('editor.blocks.magic_block_content.clipboard_unavailable'))
    }
  }

  const clearStyle = () => {
    writeStyle(null)
    setStyleRef(null)
  }

  // Pointer capture keeps the drag on the handle: without it the node view's
  // native drag (the block is draggable) or the iframe would swallow moves.
  const dragRef = React.useRef<{ startY: number; startH: number; current: number } | null>(null)
  const onDragDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startY: e.clientY, startH: height, current: height }
    setDragHeight(height)
  }
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    d.current = Math.max(200, Math.min(1500, Math.round(d.startH + e.clientY - d.startY)))
    setDragHeight(d.current)
  }
  const onDragEnd = () => {
    const d = dragRef.current
    dragRef.current = null
    setDragHeight(null)
    // One write per drag, not one per mouse move.
    if (d && d.current !== d.startH) updateAttributes({ height: d.current })
  }

  const liveStream = useThrottled(gen.stream, 600)
  const shownHtml = gen.streaming ? liveStream || draft?.html || htmlContent : (draft?.html ?? htmlContent)
  const frameHeight = dragHeight ?? height
  const hasContent = !!(htmlContent || draft)
  const showComposer = composing || !!draft || refineOpen || gen.streaming || !!gen.error

  const darkBtn =
    'flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-white/5 px-4 py-1.5 text-xs font-semibold text-white/40 outline outline-1 outline-neutral-100/10 transition-all delay-75 ease-linear hover:bg-white/10 hover:text-white/60 hover:outline-neutral-200/40'
  const darkIconBtn =
    'inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/50 transition-colors hover:bg-white/20 hover:text-white/80'

  const historyPopover = activeSession && (
    <BlockPopover
      open={pop === 'history'}
      onOpenChange={(o) => {
        setPop(o ? 'history' : null)
        if (o) loadSession()
      }}
      width={320}
      title={t('editor.blocks.magic_block_content.history')}
      trigger={
        <button type="button" className={darkIconBtn} aria-label={t('editor.blocks.magic_block_content.history')} title={t('editor.blocks.magic_block_content.history')}>
          <ClockCounterClockwise weight="duotone" size={14} />
        </button>
      }
    >
      <MagicBlockRevisions
        revisions={revisions}
        loading={revLoading}
        onRestore={(rev) => {
          setDraft({ html: rev.html, sessionUuid: activeSession, prompt: rev.prompt })
          setPop(null)
        }}
      />
    </BlockPopover>
  )

  const stylePopover = (
    <BlockPopover
      open={pop === 'style'}
      onOpenChange={(o) => {
        setPop(o ? 'style' : null)
        setStyleNote(null)
      }}
      width={300}
      title={t('editor.blocks_v2.magic.style', 'Design style')}
      trigger={
        <button
          type="button"
          className={cn(darkIconBtn, styleRef && 'bg-purple-500/25 text-purple-100')}
          aria-label={t('editor.blocks_v2.magic.style', 'Design style')}
          title={t('editor.blocks_v2.magic.style', 'Design style')}
        >
          <PaintBrush weight="duotone" size={14} />
        </button>
      }
    >
      <p className="text-[12px] leading-snug text-neutral-500">{t('editor.blocks.magic_block_content.copy_style_tooltip')}</p>
      <div className="flex flex-wrap gap-1.5">
        {hasContent && (
          <button type="button" onClick={copyStyle} className={buttonClass('secondary', 'sm')}>
            <PaintBrush size={13} />
            {t('editor.blocks.magic_block_content.copy_style')}
          </button>
        )}
        <button type="button" onClick={pasteStyle} className={buttonClass('secondary', 'sm')}>
          <Clipboard size={13} />
          {t('editor.blocks.magic_block_content.paste_style')}
        </button>
        {styleRef && (
          <button type="button" onClick={clearStyle} className={buttonClass('ghost', 'sm')}>
            <X size={13} />
            {t('editor.blocks.magic_block_content.clear_style')}
          </button>
        )}
      </div>
      {styleRef && <p className="text-[11px] text-violet-700">{t('editor.blocks.magic_block_content.using_copied_style')}</p>}
      {styleNote && <p className="text-[11px] text-neutral-500">{styleNote}</p>}
    </BlockPopover>
  )

  const draftBar = draft && !gen.streaming && (
    <div className="flex flex-wrap items-center gap-2" data-testid="magic-draft">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-white/80">
          {htmlContent ? t('editor.blocks_v2.magic.new_version', 'New version ready') : t('editor.blocks_v2.magic.first_version', 'Here’s a first version')}
        </div>
        <div className="truncate text-[11px] text-white/40">{draft.prompt}</div>
        {gen.creditsUsed != null && <CreditCost kind="used" credits={gen.creditsUsed} tone="dark" className="mt-0.5" />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setDraft(null)} className={darkBtn}>
          <Trash weight="duotone" className="h-4 w-4" />
          {t('editor.blocks_v2.magic.discard', 'Discard')}
        </button>
        {gen.last && (
          <button type="button" onClick={() => gen.last && go(gen.last)} disabled={!credits.enough} className={cn(darkBtn, 'disabled:opacity-40')}>
            <ArrowClockwise weight="duotone" className="h-4 w-4" />
            {t('editor.blocks_v2.magic.try_again', 'Try again')}
          </button>
        )}
        <AIButton size="sm" onClick={accept} icon={<Check size={12} weight="bold" />} data-testid="magic-accept">
          {t('editor.blocks_v2.magic.use_this', 'Use this')}
        </AIButton>
      </div>
    </div>
  )

  const composer = showComposer && (
    <MagicComposer
      mode={hasContent ? 'refine' : 'create'}
      bare
      prompt={hasContent ? refinePrompt : prompt}
      onPrompt={hasContent ? setRefinePrompt : setPrompt}
      onSubmit={hasContent ? refine : (p) => go({ kind: 'start', prompt: p })}
      onCancel={gen.cancel}
      streaming={gen.streaming}
      credits={credits}
      error={gen.error}
      onRetry={() => gen.last && go(gen.last)}
      onDismissError={() => gen.setError(null)}
      styleActive={!!styleRef}
      onClearStyle={clearStyle}
      editsLeft={hasContent ? editsLeft : undefined}
      onClose={draft || gen.streaming ? undefined : () => (hasContent ? setRefineOpen(false) : setComposing(false))}
      autoFocus
      header={draftBar || undefined}
    />
  )

  const panel = (
    <div
      style={{ background: AI_DARK_SURFACE }}
      className="rounded-2xl px-5 py-4 shadow-lg ring-1 ring-inset ring-white/10 transition-all ease-linear"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          <AIMark size={22} alt="" />
          <span className="text-sm font-semibold text-white/70">{t('editor.blocks.magic_block_content.title')}</span>
          {draft && !gen.streaming && (
            <span className="rounded-full bg-purple-500/25 px-2 py-0.5 text-[11px] font-semibold text-purple-100">
              {t('editor.blocks_v2.magic.draft', 'Draft')}
            </span>
          )}
        </div>
        {canUseAI && (
          <div className="flex items-center gap-1.5">
            {historyPopover}
            {stylePopover}
            {htmlContent && (
              <button
                type="button"
                onClick={clearContent}
                className={cn(darkIconBtn, 'hover:bg-red-500/30 hover:text-red-300')}
                aria-label={t('editor.blocks_v2.magic.clear', 'Clear and start over')}
                title={t('editor.blocks_v2.magic.clear', 'Clear and start over')}
              >
                <X weight="duotone" size={14} />
              </button>
            )}
          </div>
        )}
      </div>

      {!canUseAI && !htmlContent ? (
        // No AI on this plan and nothing generated yet.
        <div className="py-8 text-center">
          <div className="inline-flex flex-col items-center gap-3">
            <div className="rounded-full bg-white/10 p-4">
              <Lock weight="duotone" className="h-8 w-8 text-white/40" />
            </div>
            <div className="space-y-1">
              <p className="flex items-center justify-center gap-2 font-semibold text-white/80">
                {t('editor.blocks.magic_block_content.title')}
                <PlanBadge currentPlan={currentPlan} requiredPlan={(rf?.ai?.required_plan || 'standard') as PlanLevel} size="sm" alwaysShow />
              </p>
              <p className="text-sm text-white/50">{t('editor.blocks.magic_block_content.upgrade_required')}</p>
            </div>
          </div>
        </div>
      ) : !hasContent && !showComposer ? (
        // Empty: the original call to action; the prompt opens right here.
        <div className="py-8 text-center">
          <div className="inline-flex flex-col items-center gap-3">
            <AIMark size={64} className="drop-shadow-md" />
            <div className="space-y-1">
              <p className="font-semibold text-white/80">{t('editor.blocks.magic_block_content.create_interactive')}</p>
              <p className="text-sm text-white/50">{t('editor.blocks.magic_block_content.generate_description')}</p>
            </div>
            <AIButton size="lg" className="mt-2" onClick={() => setComposing(true)} data-testid="magic-start">
              {t('editor.blocks.magic_block_content.generate_with_ai')}
            </AIButton>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {(hasContent || gen.streaming) && (
            <div className="relative overflow-hidden rounded-lg ring-1 ring-inset ring-white/10" style={{ height: frameHeight }} data-testid={hasContent ? 'magic-preview' : 'magic-stream'}>
              {shownHtml ? <MagicBlockPreview htmlContent={shownHtml} streaming={gen.streaming} /> : <StreamPlaceholder />}
              {gen.streaming && (
                <span className="absolute end-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white/70 ring-1 ring-inset ring-white/10">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple-400" />
                  {t('editor.blocks.magic_block_content.generating')}
                </span>
              )}
            </div>
          )}
          {hasContent && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* Resize controls (as before): presets + drag */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  {HEIGHTS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => updateAttributes({ height: preset.value })}
                      className={cn(
                        'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                        height === preset.value ? 'bg-white/20 text-white/70' : 'bg-white/5 text-white/30 hover:bg-white/10 hover:text-white/50',
                      )}
                      title={`${preset.value}px`}
                    >
                      {preset.id}
                    </button>
                  ))}
                </div>
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label={t('editor.blocks.magic_block_content.drag_resize')}
                  title={t('editor.blocks.magic_block_content.drag_resize')}
                  onPointerDown={onDragDown}
                  onPointerMove={onDragMove}
                  onPointerUp={onDragEnd}
                  onPointerCancel={onDragEnd}
                  onMouseDown={(e) => {
                    // No native drag of the whole (draggable) block from here.
                    e.preventDefault()
                    e.stopPropagation()
                  }}
                  onDragStart={(e) => e.preventDefault()}
                  draggable={false}
                  className={cn(
                    'flex cursor-ns-resize touch-none select-none items-center gap-1 rounded bg-white/5 px-2 py-0.5 text-white/30 transition-colors hover:bg-white/10 hover:text-white/50',
                    dragHeight !== null && 'bg-white/15 text-white/60',
                  )}
                >
                  <DotsSixVertical weight="duotone" className="h-3 w-3" />
                  <span className="text-xs font-medium">{frameHeight}px</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setFull(true)} className={darkBtn}>
                  <ArrowsOut weight="duotone" className="h-4 w-4" />
                  <span>{t('editor.blocks.common.expand')}</span>
                </button>
                {canUseAI && (
                  <button
                    type="button"
                    onClick={() => {
                      setRefineOpen((o) => !o)
                      if (!usage) loadSession()
                    }}
                    className={cn(darkBtn, refineOpen && 'bg-white/10 text-white/70')}
                    data-testid="magic-edit"
                  >
                    <PencilSimple weight="duotone" className="h-4 w-4" />
                    <span>{t('editor.blocks.magic_block_content.edit')}</span>
                  </button>
                )}
              </div>
            </div>
          )}
          {composer}
        </div>
      )}
    </div>
  )

  return (
    <NodeViewWrapper className="block-magic w-full">
      <EditorBlockFrame editable node={node} editor={editor} getPos={getPos} selected={props.selected} tone="neutral">
        {panel}
      </EditorBlockFrame>
      {full && shownHtml && <FullscreenMagic html={shownHtml} onClose={() => setFull(false)} />}
    </NodeViewWrapper>
  )
}

function StreamPlaceholder() {
  return (
    <div className="flex h-full flex-col gap-3 bg-black/30 p-6" aria-hidden>
      <div className="h-5 w-1/3 animate-pulse rounded-md bg-white/[0.06]" />
      <div className="h-3 w-2/3 animate-pulse rounded-md bg-white/[0.06]" />
      <div className="mt-2 flex-1 animate-pulse rounded-xl bg-white/[0.04]" />
    </div>
  )
}

export default MagicBlockComponent
