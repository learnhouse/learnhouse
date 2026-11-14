'use client'
/*
 The AI Editor's state: the page's Atlas chat, its turns as they stream,
 the proposals they produced and the author's decisions on them.

 It lives in the always-mounted AI Editor root (not the panel), so closing
 the panel never interrupts a turn; and the turn itself is an Atlas
 background run, so even leaving the page doesn't: reopening follows the
 run again from its first frame.

 Accepted changes are applied with engine/proposals.ts as editor
 transactions. Before the first change of a proposal is applied, a version
 named "Before AI: …" is saved, so the version history can always go back.
*/
import React from 'react'
import type { Editor } from '@tiptap/core'
import toast from 'react-hot-toast'
import {
  type AIEditorEvent,
  type AIEditorFile,
  type AIEditorPersistedMessage,
  type AIEditorProposal,
  type AIEditorStatus,
  type HunkDecision,
  AIEditorError,
  decideAIEditorPending,
  followAIEditorRun,
  getAIEditorHistory,
  getAIEditorProposal,
  getAIEditorStatus,
  loadAIEditorChat,
  recordAIEditorDecisions,
  startNewAIEditorChat,
  stopAIEditorRun,
  streamAIEditorChat,
} from '@services/ai/aiEditor'
import { startEditorAIChatSessionStream, sendEditorAIChatMessageStream } from '@services/ai/ai'
import { generateAIImage, fetchAIImageFile } from '@services/ai/generation'
import { uploadNewImageFile } from '@services/blocks/Image/images'
import { prepareAIContent } from './aiEditorContent'
import { type CreditCosts, costsOf } from './engine/actions'
import { type Aliases, addAliases, hunkTransaction, insertAtHunk } from './engine/proposals'

export interface ToolRow {
  id: string
  name: string
  done: boolean
  ok: boolean
  detail?: string | null
}

export type PendingStatus = 'open' | 'busy' | 'approved' | 'declined' | 'applied' | 'failed' | 'dropped'

export interface PendingCard {
  id: string
  summary: string
  tool: string
  target: Record<string, any>
  status: PendingStatus
  risk?: string
  challenge?: Record<string, any> | null
}

export interface UserTurn {
  id: string
  role: 'user'
  text: string
  action?: string | null
  files?: string[]
}

export interface AITurn {
  id: string
  role: 'ai'
  text: string
  tools: ToolRow[]
  proposals: string[]
  pendings: PendingCard[]
  applied: string[]
  suggestions: string[]
  streaming: boolean
  error?: string | null
  stopped?: boolean
}

export type Turn = UserTurn | AITurn

export interface SendOptions {
  message: string
  action?: string | null
  files?: AIEditorFile[]
  /** Selection captured when the request was made (defaults to the editor's). */
  selection?: CapturedSelection | null
}

export interface CapturedSelection {
  from: number
  to: number
  text: string
  path: number[]
}

let idSeq = 0
const nextId = (p: string) => `${p}${Date.now().toString(36)}${(idSeq++).toString(36)}`

const VERSION_TIMEOUT_MS = 6000

/** The selection (or the caret's block) as the server wants it. */
export function captureSelection(editor: Editor | null): CapturedSelection | null {
  if (!editor || editor.isDestroyed) return null
  const { from, to, empty } = editor.state.selection
  const $from = editor.state.doc.resolve(from)
  const top = $from.depth >= 1 ? $from.index(0) : Math.min($from.index(0), editor.state.doc.childCount - 1)
  return {
    from,
    to,
    text: empty ? '' : editor.state.doc.textBetween(from, to, '\n\n', ' ').slice(0, 6000),
    path: [Math.max(0, top)],
  }
}

function messagesToTurns(messages: AIEditorPersistedMessage[]): { turns: Turn[]; proposalIds: string[] } {
  const turns: Turn[] = []
  const proposalIds: string[] = []
  for (const m of messages || []) {
    if (m.role === 'user') {
      turns.push({ id: nextId('u'), role: 'user', text: m.content || '', files: (m.files || []).map((f) => f.name) })
      continue
    }
    const proposals = [
      ...new Set(
        (m.blocks || []).filter((b) => b?.type === 'editor_proposal' && typeof b.proposal_id === 'string').map((b) => b.proposal_id as string)
      ),
    ]
    proposalIds.push(...proposals)
    turns.push({
      id: nextId('a'),
      role: 'ai',
      text: m.content || '',
      // A tool is its name, or {name, ...} (newer Atlas history).
      tools: (Array.isArray(m.tools) ? m.tools : [])
        .map((tool: any) => (typeof tool === 'string' ? tool : String(tool?.name ?? '')))
        .filter(Boolean)
        .map((name) => ({ id: nextId('t'), name, done: true, ok: true })),
      proposals,
      pendings: [],
      applied: [],
      suggestions: [],
      streaming: false,
    })
  }
  return { turns, proposalIds }
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([p, new Promise<T>((resolve) => (timer = setTimeout(() => resolve(fallback), ms)))])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface EngineDeps {
  editor: Editor | null
  activity: any
  orgId: number | null
  token: string | null
  /** Name a version of the page now (collab checkpoint or autosave flush + name). */
  nameVersion?: (_label: string) => Promise<boolean>
  t: (_key: string, _opts?: any) => string
}

export function useAIEditorEngine({ editor, activity, orgId, token, nameVersion, t }: EngineDeps) {
  const activityUuid: string = activity?.activity_uuid
  const [status, setStatus] = React.useState<AIEditorStatus | null>(null)
  const [chat, setChat] = React.useState<string | null>(null)
  const [turns, setTurns] = React.useState<Turn[]>([])
  const [proposals, setProposals] = React.useState<Record<string, AIEditorProposal>>({})
  const [busy, setBusy] = React.useState(false)
  const [history, setHistory] = React.useState<AIEditorProposal[] | null>(null)
  const [applying, setApplying] = React.useState<string | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const chatRef = React.useRef<string | null>(null)
  const aliasesRef = React.useRef<Map<string, Aliases>>(new Map())
  const namedRef = React.useRef<Set<string>>(new Set())
  const legacyChatRef = React.useRef<string | null>(null)
  const costs: CreditCosts = costsOf(status?.costs)
  const engine: 'atlas' | 'legacy' | 'none' | 'loading' = !status
    ? 'loading'
    : status.available
      ? 'atlas'
      : status.legacy
        ? 'legacy'
        : 'none'

  React.useEffect(() => {
    chatRef.current = chat
  }, [chat])

  const patchTurn = React.useCallback((id: string, fn: (_t: AITurn) => AITurn) => {
    setTurns((all) => all.map((x) => (x.id === id && x.role === 'ai' ? fn(x) : x)))
  }, [])

  const loadProposal = React.useCallback(
    async (id: string) => {
      if (!orgId || !token) return
      try {
        const p = await getAIEditorProposal(orgId, id, token)
        setProposals((all) => ({ ...all, [id]: p }))
      } catch {
        // expired proposals simply don't show
      }
    },
    [orgId, token]
  )

  // ── one stream of Atlas events into an AI turn ─────────────────────────
  const consume = React.useCallback(
    async (gen: AsyncGenerator<AIEditorEvent>, turnId: string) => {
      try {
        for await (const ev of gen) {
          switch (ev.type) {
            case 'session':
              if (typeof ev.aichat_uuid === 'string') setChat(ev.aichat_uuid)
              break
            case 'message.delta':
              patchTurn(turnId, (x) => ({ ...x, text: x.text + String(ev.delta || '') }))
              break
            case 'tool.start':
              patchTurn(turnId, (x) => ({ ...x, tools: [...x.tools, { id: String(ev.call_id), name: String(ev.name), done: false, ok: true }] }))
              break
            case 'tool.end':
              patchTurn(turnId, (x) => ({
                ...x,
                tools: x.tools.map((r) => (r.id === ev.call_id ? { ...r, done: true, ok: !!ev.ok, detail: (ev as any).detail || null } : r)),
              }))
              break
            case 'ui.block': {
              const block = (ev as any).block || {}
              if (block.type === 'editor_proposal' && typeof block.proposal_id === 'string') {
                const pid = block.proposal_id as string
                patchTurn(turnId, (x) => (x.proposals.includes(pid) ? x : { ...x, proposals: [...x.proposals, pid] }))
                void loadProposal(pid)
              }
              break
            }
            case 'preview.action': {
              const e = ev as any
              patchTurn(turnId, (x) => ({
                ...x,
                pendings: [
                  ...x.pendings.filter((c) => c.id !== e.pending_id),
                  { id: e.pending_id, summary: e.summary, tool: e.tool, target: e.target || {}, status: 'open', risk: e.risk },
                ],
              }))
              break
            }
            case 'confirm.required': {
              const e = ev as any
              patchTurn(turnId, (x) => ({ ...x, pendings: x.pendings.map((c) => (c.id === e.pending_id ? { ...c, challenge: e.challenge } : c)) }))
              break
            }
            case 'applied': {
              const e = ev as any
              setTurns((all) =>
                all.map((x) =>
                  x.role === 'ai'
                    ? {
                        ...x,
                        pendings: x.pendings.map((c) => (c.id === e.pending_id ? { ...c, status: 'applied' as PendingStatus } : c)),
                        applied: x.id === turnId && e.summary ? [...x.applied, String(e.summary)] : x.applied,
                      }
                    : x
                )
              )
              break
            }
            case 'pending.dropped': {
              const e = ev as any
              setTurns((all) =>
                all.map((x) =>
                  x.role === 'ai'
                    ? { ...x, pendings: x.pendings.map((c) => (c.id === e.pending_id && c.status === 'open' ? { ...c, status: 'dropped' as PendingStatus } : c)) }
                    : x
                )
              )
              break
            }
            case 'suggestions': {
              const items = Array.isArray((ev as any).items) ? (ev as any).items : []
              const labels = items.map((i: any) => String(i?.prompt || i?.label || i?.text || '')).filter(Boolean).slice(0, 3)
              patchTurn(turnId, (x) => ({ ...x, suggestions: labels }))
              break
            }
            case 'error':
              patchTurn(turnId, (x) => ({ ...x, error: String((ev as any).message || t('editor.ai_editor_v2.errors.generic')) }))
              break
            case 'stopped':
              patchTurn(turnId, (x) => ({ ...x, stopped: true }))
              break
            default:
              break
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          patchTurn(turnId, (x) => ({ ...x, error: err?.message || t('editor.ai_editor_v2.errors.generic') }))
        }
      } finally {
        patchTurn(turnId, (x) => ({ ...x, streaming: false }))
      }
    },
    [patchTurn, loadProposal, t]
  )

  // ── status, the page's chat and a run still going ───────────────────────
  const loadChat = React.useCallback(
    async (chatId: string | null, activeRun?: { user_message: string } | null) => {
      if (!orgId || !token) return
      if (!chatId) {
        setTurns([])
        return
      }
      try {
        const res = await loadAIEditorChat(orgId, chatId, token)
        const { turns: restored, proposalIds } = messagesToTurns(res.messages)
        setTurns(restored)
        proposalIds.forEach((id) => void loadProposal(id))
        const run = res.active_run || activeRun
        if (run) {
          const turnId = nextId('a')
          setTurns((all) => [
            ...all,
            { id: nextId('u'), role: 'user', text: run.user_message || '' },
            { id: turnId, role: 'ai', text: '', tools: [], proposals: [], pendings: [], applied: [], suggestions: [], streaming: true },
          ])
          setBusy(true)
          const ctrl = new AbortController()
          abortRef.current = ctrl
          await consume(followAIEditorRun({ orgId, chat: chatId, token, signal: ctrl.signal }), turnId)
          setBusy(false)
        }
      } catch {
        setTurns([])
      }
    },
    [orgId, token, consume, loadProposal]
  )

  React.useEffect(() => {
    if (!orgId || !token || !activityUuid) return
    let cancelled = false
    getAIEditorStatus(orgId, activityUuid, token).then((s) => {
      if (cancelled) return
      setStatus(s)
      if (s.available && s.chat) {
        setChat(s.chat)
        void loadChat(s.chat, s.active_run || null)
      }
    })
    return () => {
      cancelled = true
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, token, activityUuid])

  // ── sending ─────────────────────────────────────────────────────────────
  const sendLegacy = React.useCallback(
    async (opts: SendOptions, turnId: string) => {
      if (!editor || !token) return
      const sel = opts.selection ?? captureSelection(editor)
      let text = ''
      await new Promise<void>((resolve) => {
        const callbacks = {
          onStart: (d: any) => d?.aichat_uuid && (legacyChatRef.current = d.aichat_uuid),
          onChatChunk: (chunk: string) => {
            text += chunk
            patchTurn(turnId, (x) => ({ ...x, text }))
          },
          onContentStart: () => {},
          onContentChunk: () => {},
          onContentEnd: (full: string) => {
            const { nodes } = prepareAIContent(full, editor.schema)
            if (!nodes.length) return
            const index = (sel?.path?.[0] ?? editor.state.doc.childCount - 1) + 1
            const prev = editor.state.doc.childCount ? editor.state.doc.child(Math.min(index - 1, editor.state.doc.childCount - 1)).toJSON() : null
            const id = `local_${nextId('p')}`
            const proposal: AIEditorProposal = {
              id,
              chat: null,
              activity_uuid: activityUuid,
              summary: opts.message.slice(0, 120),
              hunks: [{ id: 'h1', kind: 'insert', index, before: [], after: nodes as any, prev, next: null }],
              decisions: {},
              notes: [],
            }
            setProposals((all) => ({ ...all, [id]: proposal }))
            patchTurn(turnId, (x) => ({ ...x, proposals: [...x.proposals, id] }))
          },
          onComplete: (d: any) => {
            if (d?.aichat_uuid) legacyChatRef.current = d.aichat_uuid
            resolve()
          },
          onFollowUps: () => {},
          onError: (err: string) => {
            patchTurn(turnId, (x) => ({ ...x, error: err }))
            resolve()
          },
        }
        const request = {
          message: opts.message,
          activity_uuid: activityUuid,
          current_content: editor.getJSON(),
          selected_text: sel?.text || undefined,
          aichat_uuid: legacyChatRef.current || undefined,
          cursor_position: sel?.from,
        }
        const run = legacyChatRef.current ? sendEditorAIChatMessageStream : startEditorAIChatSessionStream
        run(request as any, token, callbacks as any).catch((e: any) => {
          patchTurn(turnId, (x) => ({ ...x, error: e?.message || String(e) }))
          resolve()
        })
      })
      patchTurn(turnId, (x) => ({ ...x, streaming: false }))
    },
    [editor, token, activityUuid, patchTurn]
  )

  const send = React.useCallback(
    async (opts: SendOptions) => {
      const message = opts.message.trim()
      if (!message || busy || !editor || !orgId || !token) return
      const turnId = nextId('a')
      setTurns((all) => [
        ...all,
        { id: nextId('u'), role: 'user', text: message, action: opts.action || null, files: (opts.files || []).map((f) => f.name) },
        { id: turnId, role: 'ai', text: '', tools: [], proposals: [], pendings: [], applied: [], suggestions: [], streaming: true },
      ])
      setBusy(true)
      try {
        if (engine === 'legacy') {
          await sendLegacy({ ...opts, message }, turnId)
          return
        }
        const sel = opts.selection ?? captureSelection(editor)
        const ctrl = new AbortController()
        abortRef.current = ctrl
        await consume(
          streamAIEditorChat({
            orgId,
            activityUuid,
            token,
            message,
            doc: editor.getJSON(),
            selection: sel ? { text: sel.text || null, path: sel.path } : null,
            action: opts.action || null,
            aichatUuid: chatRef.current,
            fileIds: (opts.files || []).map((f) => f.id),
            signal: ctrl.signal,
          }),
          turnId
        )
      } catch (err: any) {
        const msg =
          err instanceof AIEditorError && err.status === 403
            ? err.message || t('editor.ai_editor_v2.errors.credits')
            : err?.message || t('editor.ai_editor_v2.errors.generic')
        patchTurn(turnId, (x) => ({ ...x, streaming: false, error: msg }))
      } finally {
        setBusy(false)
      }
    },
    [busy, editor, orgId, token, engine, activityUuid, consume, sendLegacy, patchTurn, t]
  )

  const stop = React.useCallback(async () => {
    const id = chatRef.current
    if (id && orgId && token && engine === 'atlas') await stopAIEditorRun(orgId, id, token)
    else abortRef.current?.abort()
  }, [orgId, token, engine])

  const newChat = React.useCallback(async () => {
    if (busy) return
    abortRef.current?.abort()
    setTurns([])
    setChat(null)
    chatRef.current = null
    legacyChatRef.current = null
    if (orgId && token && engine === 'atlas') await startNewAIEditorChat(orgId, activityUuid, token).catch(() => undefined)
  }, [busy, orgId, token, engine, activityUuid])

  // ── decisions ───────────────────────────────────────────────────────────
  const setDecisions = React.useCallback(
    (pid: string, decisions: Record<string, HunkDecision>, versionLabel?: string | null) => {
      setProposals((all) => {
        const p = all[pid]
        if (!p) return all
        return { ...all, [pid]: { ...p, decisions: { ...p.decisions, ...decisions }, version_label: versionLabel || p.version_label } }
      })
      if (orgId && token && !pid.startsWith('local_')) void recordAIEditorDecisions(orgId, pid, decisions, token, versionLabel)
    },
    [orgId, token]
  )

  const ensureVersion = React.useCallback(
    async (p: AIEditorProposal): Promise<string | null> => {
      if (namedRef.current.has(p.id) || p.version_label) return p.version_label || null
      namedRef.current.add(p.id)
      const label = `${t('editor.ai_editor_v2.version_prefix')}: ${p.summary}`.slice(0, 120)
      if (!nameVersion) return null
      const ok = await withTimeout(nameVersion(label).catch(() => false), VERSION_TIMEOUT_MS, false)
      return ok ? label : null
    },
    [nameVersion, t]
  )

  const generateImage = React.useCallback(
    async (prompt: string, alt: string) => {
      if (!orgId || !token || !editor) throw new Error('not ready')
      const res: any = await generateAIImage({ org_id: orgId, prompt, activity_id: activity?.id }, token)
      if (!res?.success) throw new Error(res?.data?.detail || t('editor.ai_editor_v2.errors.image'))
      const file = await fetchAIImageFile(orgId, res.data.file_id, token)
      const blockObject = await uploadNewImageFile(file, activityUuid, token)
      const type = editor.schema.nodes.blockImage
      if (!type || !blockObject) throw new Error(t('editor.ai_editor_v2.errors.image'))
      return type.create({ blockObject, size: { width: 560 }, alt })
    },
    [orgId, token, editor, activity?.id, activityUuid, t]
  )

  const accept = React.useCallback(
    async (pid: string, hunkIds: string[]) => {
      const p = proposals[pid]
      if (!p || !editor || editor.isDestroyed) return
      if (!editor.isEditable) {
        toast.error(t('editor.ai_editor_v2.errors.read_only'))
        return
      }
      setApplying(pid)
      try {
        const label = await ensureVersion(p)
        const aliases = aliasesRef.current.get(pid) || new Map()
        aliasesRef.current.set(pid, aliases)
        const order = { replace: 0, delete: 1, insert: 2, image: 3 } as Record<string, number>
        const hunks = p.hunks
          .filter((h) => hunkIds.includes(h.id) && (p.decisions[h.id] ?? 'pending') === 'pending')
          .sort((a, b) => a.index - b.index || order[a.kind] - order[b.kind])
        const decisions: Record<string, HunkDecision> = {}
        for (const h of hunks) {
          if (h.kind === 'image') {
            try {
              const node = await generateImage(h.prompt || '', h.alt || '')
              const tr = insertAtHunk(editor.state, h, [node], aliases)
              if (tr) {
                editor.view.dispatch(tr)
                decisions[h.id] = 'applied'
              } else decisions[h.id] = 'stale'
            } catch (e: any) {
              toast.error(e?.message || t('editor.ai_editor_v2.errors.image'))
            }
            continue
          }
          const res = hunkTransaction(editor.state, h, { aliases })
          if (!res) {
            decisions[h.id] = 'stale'
            continue
          }
          editor.view.dispatch(res.tr)
          addAliases(aliases, h, editor.schema)
          decisions[h.id] = 'applied'
        }
        const stale = Object.values(decisions).filter((d) => d === 'stale').length
        if (stale) toast(t('editor.ai_editor_v2.stale_toast', { count: stale }))
        if (Object.keys(decisions).length) setDecisions(pid, decisions, label)
        setHistory(null)
      } finally {
        setApplying(null)
      }
    },
    [proposals, editor, ensureVersion, generateImage, setDecisions, t]
  )

  const reject = React.useCallback(
    (pid: string, hunkIds: string[]) => {
      const p = proposals[pid]
      if (!p) return
      const decisions: Record<string, HunkDecision> = {}
      for (const id of hunkIds) if ((p.decisions[id] ?? 'pending') === 'pending') decisions[id] = 'rejected'
      if (Object.keys(decisions).length) setDecisions(pid, decisions)
    },
    [proposals, setDecisions]
  )

  /** Undo the applied changes of a proposal (newest first), as new transactions. */
  const revert = React.useCallback(
    (p: AIEditorProposal): { reverted: number; stale: number } => {
      if (!editor || editor.isDestroyed) return { reverted: 0, stale: 0 }
      if (!editor.isEditable) {
        toast.error(t('editor.ai_editor_v2.errors.read_only'))
        return { reverted: 0, stale: 0 }
      }
      const applied = p.hunks.filter((h) => p.decisions[h.id] === 'applied' && h.kind !== 'image').sort((a, b) => b.index - a.index)
      const decisions: Record<string, HunkDecision> = {}
      let stale = 0
      for (const h of applied) {
        const res = hunkTransaction(editor.state, h, { direction: 'revert' })
        if (!res) {
          stale++
          continue
        }
        editor.view.dispatch(res.tr)
        decisions[h.id] = 'reverted'
      }
      if (Object.keys(decisions).length) {
        setDecisions(p.id, decisions)
        setHistory((list) => (list ? list.map((x) => (x.id === p.id ? { ...x, decisions: { ...x.decisions, ...decisions } } : x)) : list))
      }
      return { reverted: Object.keys(decisions).length, stale }
    },
    [editor, setDecisions, t]
  )

  const loadHistory = React.useCallback(async () => {
    if (!orgId || !token || engine !== 'atlas') {
      setHistory(Object.values(proposals).filter((p) => Object.values(p.decisions).some((d) => d === 'applied' || d === 'reverted')))
      return
    }
    try {
      setHistory(await getAIEditorHistory(orgId, activityUuid, token))
    } catch {
      setHistory([])
    }
  }, [orgId, token, engine, activityUuid, proposals])

  // ── approvals for changes to other pages ────────────────────────────────
  const decidePending = React.useCallback(
    async (turnId: string, pendingId: string, approve: boolean) => {
      if (!orgId || !token) return
      setTurns((all) =>
        all.map((x) => (x.role === 'ai' ? { ...x, pendings: x.pendings.map((c) => (c.id === pendingId ? { ...c, status: 'busy' as PendingStatus } : c)) } : x))
      )
      setBusy(true)
      try {
        await consume(decideAIEditorPending({ orgId, pendingId, approve, token }), turnId)
        setTurns((all) =>
          all.map((x) =>
            x.role === 'ai'
              ? {
                  ...x,
                  pendings: x.pendings.map((c) =>
                    c.id === pendingId && c.status === 'busy' ? { ...c, status: (approve ? 'approved' : 'declined') as PendingStatus } : c
                  ),
                }
              : x
          )
        )
      } catch (e: any) {
        toast.error(e?.message || t('editor.ai_editor_v2.errors.generic'))
      } finally {
        setBusy(false)
      }
    },
    [orgId, token, consume, t]
  )

  return {
    status,
    engine,
    costs,
    chat,
    turns,
    proposals,
    busy,
    applying,
    history,
    aliasesFor: (pid: string) => aliasesRef.current.get(pid),
    send,
    stop,
    newChat,
    accept,
    reject,
    revert,
    loadHistory,
    decidePending,
  }
}

export type AIEditorEngine = ReturnType<typeof useAIEditorEngine>
