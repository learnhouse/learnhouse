'use client'
/*
 The AI Editor: the activity editor's AI panel, on the Atlas engine.

 This root stays mounted while the editor is open (the panel itself only
 renders when opened), so a turn keeps streaming with the panel closed, the
 in-page previews and ghost text keep working, and the "/ai" slash items and
 the selection menu can hand it work (aiEditorBridge).

   ┌ AI Editor ─────────── history · new · Atlas · ⚙ · ✕ ┐
   │ thread: messages, tool steps, proposal cards        │
   │ (empty: greeting + quick actions)                   │
   ├─────────────────────────────────────────────────────┤
   │ selection chip · sources · ✦ actions · cost · send  │
   └─────────────────────────────────────────────────────┘

 Desktop: a side panel next to the page. Phones: a bottom sheet.
*/
import React from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { Editor } from '@tiptap/react'
import type { Plugin } from '@tiptap/pm/state'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import {
  ArrowSquareOut,
  CheckCircle,
  CircleNotch,
  ClockCounterClockwise,
  CaretRight,
  DotsThree,
  NotePencil,
  Warning,
  X,
} from '@phosphor-icons/react'
import { AIAccentLine, AIAvatar, AIMark, AIThinking, AI_DARK_SURFACE } from '@components/Objects/AI/AIBrand'
import AIMarkdownRenderer from '@components/Objects/Activities/AI/AIMarkdownRenderer'
import UserAvatar from '@components/Objects/UserAvatar'
import { AIEditorStateTypes, useAIEditor, useAIEditorDispatch } from '@components/Contexts/AI/AIEditorContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'
import { getUriWithOrg } from '@services/config/config'
import { completeAIEditorText } from '@services/ai/aiEditor'
import { cn } from '@/lib/utils'
import { useCollabSession } from '../Collab/CollabContext'
import { setAIHighlight, clearAIHighlight } from '../Extensions/AISelectionHighlight/AISelectionHighlight'
import { type AIEditorEngine, type AITurn, type CapturedSelection, captureSelection, useAIEditorEngine } from './useAIEditorEngine'
import { AI_EDITOR_EVENT, type AIEditorRequest, setAIEditorEngineReady } from './aiEditorBridge'
import { type PreviewAction, type PreviewItem, type PreviewLabels, aiPreviewKey, createPreviewPlugin } from './engine/previewPlugin'
import { createGhostPlugin } from './engine/ghostText'
import { actionById, type CreditCosts, type QuickAction, type QuickActionId, suggestedActions } from './engine/actions'
import ProposalCard from './panel/ProposalCard'
import { ACTION_ICONS, type ActionRun, type Heading, actionMessage } from './panel/actionUtils'
import HistoryView from './panel/HistoryView'
import Composer, { type MenuRequest, type PendingFile } from './panel/Composer'
import { blockName, hunkLabel, toolLabel } from './panel/labels'
import './aiEditor.css'

type AIEditorSidePanelProps = {
  editor: Editor
  activity: any
  course: any
  /** Autosave mode: save now and name a version (live editing uses the room's checkpoint). */
  nameVersion?: (_label: string) => Promise<boolean>
  /** Opens the page's version history. */
  onOpenHistory?: () => void
}

const GHOST_KEY = 'lh_ai_ghost_text'
const PREVIEW_PROPOSALS = 3

function readGhostPref(): boolean {
  try {
    return localStorage.getItem(GHOST_KEY) === '1'
  } catch {
    return false
  }
}

function headingsOf(editor: Editor | null): Heading[] {
  if (!editor || editor.isDestroyed) return []
  const out: Heading[] = []
  editor.state.doc.forEach((node, _offset, index) => {
    if (node.type.name === 'heading' && node.textContent.trim()) {
      out.push({ index, level: node.attrs.level || 2, text: node.textContent.trim().slice(0, 80) })
    }
  })
  return out
}

export default function AIEditorSidePanel(props: AIEditorSidePanelProps) {
  const { editor, activity } = props
  const { t } = useTranslation()
  const { track } = useLHAnalytics('editor')
  const session = useLHSession() as any
  const org = useOrg() as any
  const token: string | null = session?.data?.tokens?.access_token ?? null
  const orgId: number | null = org?.id ?? null
  const aiState = useAIEditor() as AIEditorStateTypes
  const dispatchAI = useAIEditorDispatch() as any
  const open = !!aiState.isSidePanelOpen
  const collab = useCollabSession()

  const nameVersion = React.useMemo(() => {
    if (collab) return (label: string) => collab.saveVersion(label).then((r) => r.ok)
    return props.nameVersion
  }, [collab, props.nameVersion])

  const engine = useAIEditorEngine({ editor, activity, orgId, token, nameVersion, t })

  React.useEffect(() => {
    setAIEditorEngineReady(engine.engine === 'atlas')
    return () => setAIEditorEngineReady(false)
  }, [engine.engine])

  // ── composer state lives here so it survives closing the panel ─────────
  const [input, setInput] = React.useState('')
  const [files, setFiles] = React.useState<PendingFile[]>([])
  const [ctxSel, setCtxSel] = React.useState<CapturedSelection | null>(null)
  const [view, setView] = React.useState<'chat' | 'history'>('chat')
  const [menuRequest, setMenuRequest] = React.useState<MenuRequest | null>(null)
  const [ghost, setGhost] = React.useState(readGhostPref)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const threadRef = React.useRef<HTMLDivElement | null>(null)

  // Track the selection while the author works in the page.
  React.useEffect(() => {
    if (!editor) return
    const onSel = () => {
      if (!editor.isFocused) return
      const sel = captureSelection(editor)
      setCtxSel(sel && sel.text ? sel : null)
    }
    editor.on('selectionUpdate', onSel)
    return () => {
      editor.off('selectionUpdate', onSel)
    }
  }, [editor])

  // ── in-page previews ────────────────────────────────────────────────────
  const onActionRef = React.useRef<PreviewAction>(() => {})
  const labelsRef = React.useRef<PreviewLabels>({
    accept: '',
    reject: '',
    ai: '',
    generate: () => '',
    imageSuggestion: '',
    quiz: () => '',
    cards: () => '',
    block: () => '',
    imageCredits: 5,
  })
  const labels: PreviewLabels = {
    accept: t('editor.ai_editor_v2.accept'),
    reject: t('editor.ai_editor_v2.reject'),
    ai: t('ai_brand.badge'),
    generate: (n) => t('editor.ai_editor_v2.generate_image', { count: n }),
    imageSuggestion: t('editor.ai_editor_v2.hunk.image'),
    quiz: (n) => t('editor.ai_editor_v2.preview.quiz', { count: n }),
    cards: (n) => t('editor.ai_editor_v2.preview.cards', { count: n }),
    block: (type) => blockName(type, t),
    imageCredits: engine.costs.image,
  }
  const onPreviewAction: PreviewAction = (key, action) => {
    const [pid, hid] = key.split(':')
    if (action === 'accept') void engine.accept(pid, [hid])
    else engine.reject(pid, [hid])
  }
  // The plugin reads the latest labels and handler through refs.
  React.useEffect(() => {
    labelsRef.current = labels
    onActionRef.current = onPreviewAction
  })

  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const plugin = createPreviewPlugin(labelsRef, onActionRef)
    editor.registerPlugin(plugin)
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(aiPreviewKey)
    }
  }, [editor])

  const previewItems: PreviewItem[] = React.useMemo(() => {
    const ids: string[] = []
    for (const turn of engine.turns) if (turn.role === 'ai') ids.push(...turn.proposals)
    const withOpen = ids.filter((id) => {
      const p = engine.proposals[id]
      return p && p.hunks.some((h) => (p.decisions[h.id] ?? 'pending') === 'pending')
    })
    return withOpen.slice(-PREVIEW_PROPOSALS).reverse().flatMap((id) => {
      const p = engine.proposals[id]
      return p.hunks
        .filter((h) => (p.decisions[h.id] ?? 'pending') === 'pending')
        .map((h) => ({ key: `${id}:${h.id}`, hunk: h, label: hunkLabel(h, t), aliases: engine.aliasesFor(id) }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.turns, engine.proposals, t])

  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta(aiPreviewKey, { items: previewItems }).setMeta('addToHistory', false))
  }, [editor, previewItems])

  const focusHunk = React.useCallback(
    (key: string | null, scroll?: boolean) => {
      if (!editor || editor.isDestroyed) return
      editor.view.dispatch(editor.state.tr.setMeta(aiPreviewKey, { focus: key }).setMeta('addToHistory', false))
      if (key && scroll) {
        requestAnimationFrame(() =>
          document.querySelector(`[data-ai-hunk="${CSS.escape(key)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        )
      }
    },
    [editor]
  )

  // ── ghost text ──────────────────────────────────────────────────────────
  const ghostCtx = React.useRef({ orgId, token, activityUuid: activity?.activity_uuid as string })
  React.useEffect(() => {
    ghostCtx.current = { orgId, token, activityUuid: activity?.activity_uuid }
  }, [orgId, token, activity?.activity_uuid])
  React.useEffect(() => {
    if (!editor || editor.isDestroyed || !ghost || engine.engine !== 'atlas') return
    const plugin: Plugin = createGhostPlugin({
      hint: t('editor.ai_editor_v2.ghost.tab'),
      fetchSuggestion: async (before, after, signal) => {
        const c = ghostCtx.current
        if (!c.orgId || !c.token) return ''
        return completeAIEditorText({ orgId: c.orgId, token: c.token, activityUuid: c.activityUuid, before, after, signal })
      },
    })
    // First in line, so Tab reaches it before other keymaps.
    editor.registerPlugin(plugin, (p, plugins) => [p, ...plugins])
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(plugin.spec.key!)
    }
  }, [editor, ghost, engine.engine, t])

  // ── sending ─────────────────────────────────────────────────────────────
  const openPanel = React.useCallback(() => {
    if (!aiState.isSidePanelOpen) {
      track(AnalyticsEvent.AiEditorPanelOpened)
      dispatchAI({ type: 'setSidePanelOpen' })
    }
  }, [aiState.isSidePanelOpen, dispatchAI, track])

  const sendMessage = React.useCallback(
    async (message: string, opts: { action?: string | null; selection?: CapturedSelection | null; source?: string } = {}) => {
      const ready = files.filter((f) => f.file).map((f) => f.file!)
      if (!message.trim() && !ready.length) return
      setView('chat')
      track(AnalyticsEvent.AiEditorMessageSent, {
        source: opts.source || 'input',
        has_text_selection: !!(opts.selection ?? ctxSel)?.text,
        is_new_session: !engine.chat,
      })
      const selection = opts.selection !== undefined ? opts.selection : ctxSel ?? (editor ? { ...captureSelection(editor)!, text: '' } : null)
      setFiles([])
      if (editor) clearAIHighlight(editor)
      await engine.send({ message: message.trim() || t('editor.ai_editor_v2.use_sources'), action: opts.action, files: ready, selection })
    },
    [files, ctxSel, editor, engine, track, t]
  )

  const runAction = React.useCallback(
    (run: ActionRun) => {
      const a = actionById(run.action)
      let selection: CapturedSelection | null = a?.usesSelection && !run.asCopy ? ctxSel : null
      if (!selection && editor) {
        const cur = captureSelection(editor)
        selection = cur ? { ...cur, text: '', path: run.path ?? cur.path } : null
      }
      if (run.path && selection) selection = { ...selection, path: run.path }
      void sendMessage(run.message, { action: run.asCopy ? null : run.action, selection, source: 'quick_action' })
    },
    [ctxSel, editor, sendMessage]
  )

  // Requests from the slash menu and the selection menu.
  React.useEffect(() => {
    const onRequest = (e: Event) => {
      const req = (e as CustomEvent<AIEditorRequest>).detail || {}
      openPanel()
      setView('chat')
      if (!req.action || req.action === 'open' || req.compose) {
        // The panel may still be mounting: try a few times.
        for (const ms of [60, 250, 600]) setTimeout(() => inputRef.current?.focus(), ms)
        return
      }
      const sel = captureSelection(editor)
      const hasSelection = !!sel?.text
      if (sel?.text) setCtxSel(sel)
      const id = req.action as QuickActionId
      const message = req.message || actionMessage(t, id, { param: req.param, hasSelection })
      void sendMessage(message, { action: id, selection: sel, source: 'bridge' })
    }
    window.addEventListener(AI_EDITOR_EVENT, onRequest)
    return () => window.removeEventListener(AI_EDITOR_EVENT, onRequest)
  }, [editor, openPanel, sendMessage, t])

  // Keep the thread scrolled to the newest message.
  const lastTurn = engine.turns[engine.turns.length - 1] as AITurn | undefined
  const scrollKey = `${engine.turns.length}:${lastTurn?.role === 'ai' ? `${lastTurn.text.length}:${lastTurn.proposals.length}:${lastTurn.tools.length}` : ''}`
  React.useEffect(() => {
    const el = threadRef.current
    if (el && engine.turns.length) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey])

  React.useEffect(() => {
    if (open && view === 'history') void engine.loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view])

  if (!open) return null

  const close = () => {
    if (editor) clearAIHighlight(editor)
    setSettingsOpen(false)
    dispatchAI({ type: 'setSidePanelClose' })
  }
  const headings = headingsOf(editor)
  const atlas = !!engine.status?.atlas
  const loading = engine.engine === 'loading'
  const unavailable = engine.engine === 'none'
  const iconBtn = 'inline-flex h-7 w-7 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/[0.08] hover:text-white/90'
  const atlasHref = engine.chat && org?.slug ? getUriWithOrg(org.slug, `/dash/atlas?chat=${encodeURIComponent(engine.chat)}`) : null

  const composer = (placement: 'top' | 'bottom') => (
    <Composer
      value={input}
      onChange={setInput}
      onSend={() => {
        const msg = input
        setInput('')
        void sendMessage(msg)
      }}
      onStop={() => void engine.stop()}
      onRun={runAction}
      busy={engine.busy}
      disabled={loading}
      costs={engine.costs}
      headings={headings}
      atlas={atlas}
      selectionText={ctxSel?.text || ''}
      onClearSelection={() => {
        setCtxSel(null)
        if (editor) clearAIHighlight(editor)
      }}
      files={files}
      setFiles={setFiles}
      canAttach={engine.engine === 'atlas'}
      orgId={orgId}
      token={token}
      placement={placement}
      menuRequest={menuRequest}
      inputRef={inputRef}
    />
  )
  const empty = !loading && !unavailable && engine.turns.length === 0

  return (
    <>
      {/* Phones: the panel is a bottom sheet over the page. */}
      <button type="button" aria-label={t('editor.ai_editor_v2.close')} onClick={close} className="fixed inset-0 z-[var(--z-modal-backdrop)] bg-black/30 md:hidden" />
      <motion.aside
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        aria-label={t('editor.ai_editor_v2.title')}
        data-lh-ai-editor=""
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.defaultPrevented) close()
        }}
        className={cn(
          'flex flex-col overflow-hidden text-white ring-1 ring-inset ring-white/10',
          'fixed inset-x-0 bottom-0 z-[var(--z-modal)] h-[84dvh] rounded-t-2xl',
          'md:sticky md:z-auto md:top-[112px] md:mt-[112px] md:h-[calc(100vh-196px)] md:w-[360px] md:shrink-0 md:self-start md:rounded-xl xl:w-[384px]'
        )}
        style={{ background: AI_DARK_SURFACE }}
      >
        <AIAccentLine className="shrink-0 opacity-80" />
        <div className="mx-auto mt-1.5 h-1 w-10 shrink-0 rounded-full bg-white/20 md:hidden" aria-hidden />
        {/* Header */}
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.07] ps-3.5 pe-1.5">
          <AIMark size={20} alt="" pulse={engine.busy} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white/85">
            {view === 'history' ? t('editor.ai_editor_v2.history.title') : t('editor.ai_editor_v2.title')}
          </span>
          <button
            type="button"
            onClick={() => setView((v) => (v === 'history' ? 'chat' : 'history'))}
            aria-pressed={view === 'history'}
            title={t('editor.ai_editor_v2.history.title')}
            aria-label={t('editor.ai_editor_v2.history.title')}
            className={cn(iconBtn, view === 'history' && 'bg-white/10 text-white')}
          >
            <ClockCounterClockwise size={15} />
          </button>
          <button
            type="button"
            onClick={() => {
              setView('chat')
              void engine.newChat()
            }}
            disabled={engine.busy}
            title={t('editor.ai_editor_v2.new_chat')}
            aria-label={t('editor.ai_editor_v2.new_chat')}
            className={cn(iconBtn, 'disabled:opacity-30')}
          >
            <NotePencil size={15} />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              title={t('editor.ai_editor_v2.more')}
              aria-label={t('editor.ai_editor_v2.more')}
              className={cn(iconBtn, settingsOpen && 'bg-white/10 text-white')}
            >
              <DotsThree size={16} weight="bold" />
            </button>
            {settingsOpen && (
              <div className="absolute end-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-xl bg-[#17132e] py-1 ring-1 ring-inset ring-white/10 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.6)]">
                {atlas && atlasHref && (
                  <a href={atlasHref} target="_blank" rel="noopener noreferrer" className="flex h-9 items-center gap-2.5 px-3 text-[13px] text-white/75 hover:bg-white/[0.06] hover:text-white">
                    <ArrowSquareOut size={15} className="text-white/45" />
                    {t('editor.ai_editor_v2.open_in_atlas')}
                  </a>
                )}
                <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-white/[0.06]">
                  <input
                    type="checkbox"
                    checked={ghost}
                    disabled={engine.engine !== 'atlas'}
                    onChange={(e) => {
                      setGhost(e.target.checked)
                      try {
                        localStorage.setItem(GHOST_KEY, e.target.checked ? '1' : '0')
                      } catch {
                        // storage blocked: on for this visit only
                      }
                    }}
                    className="mt-0.5 accent-violet-500"
                  />
                  <span>
                    <span className="block text-[13px] text-white/80">{t('editor.ai_editor_v2.ghost.title')}</span>
                    <span className="block text-[12px] leading-snug text-white/40">{t('editor.ai_editor_v2.ghost.body', { count: engine.costs.complete })}</span>
                  </span>
                </label>
              </div>
            )}
          </div>
          <button type="button" onClick={close} title={t('editor.ai_editor_v2.close')} aria-label={t('editor.ai_editor_v2.close')} className={iconBtn}>
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        {view === 'history' ? (
          <HistoryView
            items={engine.history}
            onRevert={(p) => {
              const res = engine.revert(p)
              if (res.reverted) toast.success(t('editor.ai_editor_v2.history.done', { count: res.reverted }))
              return res
            }}
            onOpenVersions={props.onOpenHistory}
          />
        ) : empty ? (
          // Empty: the composer first, a few relevant actions under it.
          <div className="flex min-h-0 flex-1 flex-col">
            {composer('top')}
            <Suggestions editor={editor} headings={headings} hasSelection={!!ctxSel?.text} costs={engine.costs} onRun={runAction} onChoose={(action) => setMenuRequest((r) => ({ n: (r?.n ?? 0) + 1, action }))} />
          </div>
        ) : (
          <>
            <div ref={threadRef} className="lh-ai-scroll flex-1 overflow-y-auto px-3.5 py-4">
              {loading ? (
                <div className="flex h-full items-center justify-center">
                  <AIThinking tone="dark" />
                </div>
              ) : unavailable ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <Warning size={20} className="text-amber-300" />
                  <p className="text-[13px] text-white/60">{engine.status?.error || t('editor.ai_editor_v2.errors.unavailable')}</p>
                </div>
              ) : (
                <Thread engine={engine} editor={editor} onFocus={focusHunk} onSuggestion={(s) => void sendMessage(s, { source: 'follow_up' })} />
              )}
            </div>
            {!unavailable && composer('bottom')}
          </>
        )}
        {/* Keep the selection visible while typing in the panel. */}
        <FocusHighlighter editor={editor} selection={ctxSel} inputRef={inputRef} />
      </motion.aside>
    </>
  )
}

function FocusHighlighter({
  editor,
  selection,
  inputRef,
}: {
  editor: Editor | null
  selection: CapturedSelection | null
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  React.useEffect(() => {
    const el = inputRef.current
    if (!el || !editor) return
    const onFocus = () => {
      if (selection?.text) {
        const size = editor.state.doc.content.size
        setAIHighlight(editor, { from: Math.min(selection.from, size), to: Math.min(selection.to, size) })
      }
    }
    el.addEventListener('focus', onFocus)
    return () => el.removeEventListener('focus', onFocus)
  }, [editor, selection, inputRef])
  return null
}

function Suggestions({
  editor,
  headings,
  hasSelection,
  costs,
  onRun,
  onChoose,
}: {
  editor: Editor | null
  headings: Heading[]
  hasSelection: boolean
  costs: CreditCosts
  onRun: (_run: ActionRun) => void
  onChoose: (_action: QuickAction) => void
}) {
  const { t } = useTranslation()
  const textLength = editor && !editor.isDestroyed ? editor.state.doc.textContent.length : 0
  const ids = suggestedActions({ hasSelection, textLength, headings: headings.length })
  return (
    <div className="px-1.5 pt-3">
      <ul className="flex flex-col">
        {ids.map((id) => {
          const action = actionById(id)!
          const Icon = ACTION_ICONS[id]
          return (
            <li key={id}>
              <button
                type="button"
                data-ai-action={id}
                title={t('editor.ai_editor_v2.cost', { count: costs.turn })}
                onClick={() =>
                  action.param ? onChoose(action) : onRun({ action: id, message: actionMessage(t, id, { hasSelection: hasSelection && action.usesSelection }) })
                }
                className="group flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-start text-[13px] text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <Icon size={15} className="shrink-0 text-violet-300/70 group-hover:text-violet-200" />
                <span className="min-w-0 flex-1 truncate">{t(`editor.ai_editor_v2.actions.${id}`)}</span>
                {action.param && <CaretRight size={11} className="text-white/25 rtl:rotate-180" />}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="px-2 pt-2 text-[12px] text-white/30">{t('editor.ai_editor_v2.slash_hint')}</p>
    </div>
  )
}

function Thread({
  engine,
  editor,
  onFocus,
  onSuggestion,
}: {
  engine: AIEditorEngine
  editor: Editor
  onFocus: (_key: string | null, _scroll?: boolean) => void
  onSuggestion: (_s: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4">
      <AnimatePresence initial={false}>
        {engine.turns.map((turn) =>
          turn.role === 'user' ? (
            <motion.div key={turn.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end gap-2">
              <div className="max-w-[85%] rounded-2xl rounded-ee-md bg-white/[0.08] px-3 py-2 text-[13px] leading-relaxed text-white/90 ring-1 ring-inset ring-white/[0.06]">
                <span className="whitespace-pre-wrap break-words">{turn.text}</span>
                {!!turn.files?.length && <span className="mt-1 block text-[11px] text-white/45">{turn.files.join(', ')}</span>}
              </div>
              <div className="shrink-0 pt-0.5">
                <UserAvatar rounded="rounded-lg" border="border-2" width={24} shadow="shadow-none" />
              </div>
            </motion.div>
          ) : (
            <motion.div key={turn.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5">
              <div className="shrink-0 pt-0.5">
                <AIAvatar size={24} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {turn.tools.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {turn.tools.map((tool) => (
                      <li key={tool.id} className="flex items-center gap-1.5 text-[11.5px] text-white/45">
                        {tool.done ? (
                          tool.ok ? <CheckCircle size={12} className="text-emerald-300/80" /> : <Warning size={12} className="text-amber-300/80" />
                        ) : (
                          <CircleNotch size={12} className="animate-spin text-violet-300" />
                        )}
                        <span className="truncate">{toolLabel(tool.name, tool.done, t)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {turn.text ? (
                  <div className={cn('text-[13px]', turn.streaming && 'ai-message-streaming')}>
                    <AIMarkdownRenderer content={turn.text} isStreaming={turn.streaming} />
                  </div>
                ) : turn.streaming && !turn.proposals.length ? (
                  <AIThinking tone="dark" className="py-1" />
                ) : null}
                {[...new Set(turn.proposals)].map((pid) => {
                  const p = engine.proposals[pid]
                  if (!p) return <div key={pid} className="h-16 animate-pulse rounded-xl bg-white/[0.04]" />
                  return (
                    <ProposalCard
                      key={pid}
                      proposal={p}
                      schema={editor.schema}
                      costs={engine.costs}
                      applying={engine.applying === pid}
                      onAccept={(ids) => void engine.accept(pid, ids)}
                      onReject={(ids) => engine.reject(pid, ids)}
                      onFocus={onFocus}
                    />
                  )
                })}
                {turn.pendings.map((c) => (
                  <div key={c.id} className="rounded-xl bg-white/[0.04] p-3 ring-1 ring-inset ring-amber-300/20">
                    <p className="text-[10.5px] font-bold uppercase tracking-wide text-amber-200/80">{t('editor.ai_editor_v2.approval.title')}</p>
                    <p className="mt-1 text-[12.5px] text-white/85">{c.summary}</p>
                    {c.target?.name && <p className="mt-0.5 text-[11px] text-white/45">{String(c.target.name)}</p>}
                    {c.status === 'open' || c.status === 'busy' ? (
                      <div className="mt-2 flex justify-end gap-1.5">
                        <button
                          type="button"
                          disabled={c.status === 'busy' || engine.busy}
                          onClick={() => void engine.decidePending(turn.id, c.id, false)}
                          className="h-7 rounded-lg px-2.5 text-[12px] font-semibold text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-40"
                        >
                          {t('editor.ai_editor_v2.approval.decline')}
                        </button>
                        <button
                          type="button"
                          disabled={c.status === 'busy' || engine.busy}
                          onClick={() => void engine.decidePending(turn.id, c.id, true)}
                          className="h-7 rounded-lg bg-violet-500/30 px-3 text-[12px] font-semibold text-violet-50 ring-1 ring-inset ring-violet-300/30 hover:bg-violet-500/45 disabled:opacity-40"
                        >
                          {c.status === 'busy' ? <CircleNotch size={12} className="animate-spin" /> : t('editor.ai_editor_v2.approval.approve')}
                        </button>
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[11px] font-semibold text-white/45">{t(`editor.ai_editor_v2.approval.${c.status}`)}</p>
                    )}
                  </div>
                ))}
                {turn.applied.map((s, i) => (
                  <p key={i} className="flex items-center gap-1.5 text-[12px] text-emerald-200/85">
                    <CheckCircle size={13} /> {s}
                  </p>
                ))}
                {turn.error && (
                  <div role="alert" className="flex items-start gap-1.5 rounded-lg bg-rose-500/15 px-2.5 py-2 text-[12px] text-rose-100 ring-1 ring-inset ring-rose-400/25">
                    <Warning size={13} className="mt-0.5 shrink-0" />
                    <span>{turn.error}</span>
                  </div>
                )}
                {turn.stopped && <p className="text-[11px] text-white/40">{t('editor.ai_editor_v2.stopped')}</p>}
                {!turn.streaming && turn.suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {turn.suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={engine.busy}
                        onClick={() => onSuggestion(s)}
                        className="rounded-full bg-white/[0.06] px-2.5 py-1 text-start text-[11.5px] text-white/70 ring-1 ring-inset ring-white/[0.06] hover:bg-white/[0.12] hover:text-white disabled:opacity-40"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>
    </div>
  )
}
