'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'

import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import {
  applyPendingEdit,
  AtlasEvent,
  AtlasPageContextPayload,
  AtlasReferencePayload,
  AtlasSession,
  CandidateDTO,
  cancelPendingEdit,
  listPendingsForChat,
  refinePendingEdit,
  revokeAtlasSession,
  startAtlasSession,
  streamAtlasChat,
  undoPendingEdit,
} from '@services/ai/atlas'
import { AlertTriangle, Loader2, Send, X as XIcon } from 'lucide-react'
import { GlobeStand } from '@phosphor-icons/react'

import {
  ActionDock,
  applyEvent,
  ChatMessage,
  EmptyState,
  MessageBubble,
  MessagePending,
} from './AtlasChat'
import { AtlasReference, useAtlasMini } from './AtlasMiniContext'
import { EditableStructure } from './cards/StructureProposalCard'
import PageContextBreadcrumb from './composer/PageContextBreadcrumb'
import QuickActionChips from './composer/QuickActionChips'
import ReferencePicker from './composer/ReferencePicker'

// Side-panel surface for Atlas. Mounted once at ClientAdminLayout (via
// AtlasMiniProvider) so dashboard route transitions don't unmount the
// chat. Shares the streaming + event logic with AtlasChat — preview
// cards, destructive challenges, applied pills, ambiguities all render
// through the same MessageBubble.

interface Props {
  open: boolean
  onClose: () => void
}

export default function AtlasMiniPanel({ open, onClose }: Props) {
  const session = useLHSession() as any
  const accessToken: string | undefined = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const orgId: number | undefined = org?.id

  const {
    input,
    setInput,
    appendToInput,
    focusInput,
    registerInputRef,
    pageContext,
    attachedReferences,
    removeReference,
    clearReferences,
  } = useAtlasMini()

  const [atlasSession, setAtlasSession] = useState<AtlasSession | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [aichatUuid, setAichatUuid] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputElRef = useRef<HTMLTextAreaElement | null>(null)
  const pageContextRef = useRef(pageContext)
  const referencesRef = useRef(attachedReferences)

  // Route-derived page context. ``useRegisterAtlasPageContext`` (called
  // from CourseOverviewTop / EditorLoader) is the rich source — it supplies
  // human-readable names and activity-level focus — but it only fires once
  // the relevant component mounts and its context loads. The URL is always
  // available, so we mine ``course_uuid`` straight from the params and
  // merge it in as a fallback. This guarantees the backend sees
  // ``course_uuid`` on every chat turn the user fires while on a course
  // route, even before CourseContext has hydrated.
  const routeParams = useParams() as Record<string, string | string[] | undefined> | null
  const rawCourseUuid = (() => {
    const v = routeParams?.courseuuid ?? routeParams?.courseid
    return Array.isArray(v) ? v[0] : v
  })()
  // Dashboard routes pass the raw UUID in the URL; the backend / context
  // layer expects the ``course_`` prefix. Add it if missing.
  const routeCourseUuid = rawCourseUuid
    ? rawCourseUuid.startsWith('course_')
      ? rawCourseUuid
      : `course_${rawCourseUuid}`
    : undefined
  const rawActivityUuid = (() => {
    const v = routeParams?.activityuuid ?? routeParams?.activityid
    return Array.isArray(v) ? v[0] : v
  })()
  const routeActivityUuid = rawActivityUuid
    ? rawActivityUuid.startsWith('activity_')
      ? rawActivityUuid
      : `activity_${rawActivityUuid}`
    : undefined
  const routeContextRef = useRef<{ course_uuid?: string; activity_uuid?: string }>({})
  useEffect(() => {
    routeContextRef.current = {
      course_uuid: routeCourseUuid,
      activity_uuid: routeActivityUuid,
    }
  }, [routeCourseUuid, routeActivityUuid])

  // Latest-snapshot refs so the in-flight stream closure picks up
  // updated context without re-binding the send callback.
  useEffect(() => {
    pageContextRef.current = pageContext
  }, [pageContext])
  useEffect(() => {
    referencesRef.current = attachedReferences
  }, [attachedReferences])

  // Register textarea ref so external callers can `focusInput()` /
  // `appendToInput()`.
  useEffect(() => {
    registerInputRef(inputElRef.current)
    return () => registerInputRef(null)
  }, [registerInputRef])

  // ── session-token lifecycle ────────────────────────────────────────────
  const refreshSession = useCallback(async () => {
    if (!orgId || !accessToken) return
    try {
      const next = await startAtlasSession(orgId, accessToken)
      setAtlasSession(next)
      setSessionError(null)
    } catch (err: any) {
      setSessionError(err?.message || 'Could not start Atlas session.')
    }
  }, [orgId, accessToken])

  useEffect(() => {
    if (!open) return
    if (!atlasSession) refreshSession()
  }, [open, atlasSession, refreshSession])

  useEffect(() => {
    if (!atlasSession?.expires_at) return
    const expiryMs = new Date(atlasSession.expires_at).getTime()
    const refreshAt = expiryMs - 2 * 60 * 1000
    const delay = Math.max(refreshAt - Date.now(), 10_000)
    const t = setTimeout(() => refreshSession(), delay)
    return () => clearTimeout(t)
  }, [atlasSession, refreshSession])

  useEffect(() => {
    return () => {
      const s = atlasSession
      if (s && accessToken) {
        revokeAtlasSession(s.token_uuid, accessToken).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (open) setTimeout(focusInput, 0)
  }, [open, focusInput])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  // ── derived state ──────────────────────────────────────────────────────
  const buildPageContextPayload = useCallback((): AtlasPageContextPayload | undefined => {
    const pc = pageContextRef.current
    const route = routeContextRef.current
    const refs = referencesRef.current
    const refsPayload: AtlasReferencePayload[] | undefined = refs.length
      ? refs.map((r: AtlasReference) => ({
          type: r.type,
          uuid: r.uuid,
          name: r.name,
          parent_course_uuid: r.parent_course_uuid,
          parent_chapter_id: r.parent_chapter_id,
          parent_chapter_name: r.parent_chapter_name,
          activity_type: r.activity_type,
        }))
      : undefined
    // Merge order: route-derived UUIDs are the floor, the registered
    // ``pageContext`` overlays them (so course_name / chapter_name from
    // CourseContext win), and references are appended last.
    const merged: AtlasPageContextPayload = {
      ...(route.course_uuid ? { course_uuid: route.course_uuid } : {}),
      ...(route.activity_uuid ? { activity_uuid: route.activity_uuid } : {}),
      ...(pc || {}),
    }
    if (refsPayload) merged.references = refsPayload
    const hasAnyContext =
      merged.course_uuid ||
      merged.chapter_uuid ||
      merged.chapter_id !== undefined ||
      merged.activity_uuid ||
      refsPayload
    if (!hasAnyContext) return undefined
    return merged
  }, [])

  const canSend =
    !!atlasSession && !!accessToken && !!orgId && !sending && input.trim().length > 0

  // ── pending edit lifecycle ─────────────────────────────────────────────
  const [pendingBusy, setPendingBusy] = useState<Record<string, boolean>>({})

  const updatePending = useCallback(
    (pendingId: string, patch: (p: MessagePending) => MessagePending) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (!m.pendings || !m.pendings[pendingId]) return m
          return { ...m, pendings: { ...m.pendings, [pendingId]: patch(m.pendings[pendingId]) } }
        }),
      )
    },
    [],
  )

  const handleApplyPending = useCallback(
    async (pendingId: string, opts?: { confirmationPhrase?: string }) => {
      if (!atlasSession || !accessToken || !orgId) return
      setPendingBusy((p) => ({ ...p, [pendingId]: true }))
      updatePending(pendingId, (p) => ({ ...p, status: 'applying' }))
      try {
        const stream = applyPendingEdit({
          pendingId,
          orgId,
          sessionToken: atlasSession.token,
          confirmationPhrase: opts?.confirmationPhrase,
          accessToken,
        })
        for await (const event of stream) {
          if (event.type === 'applied') {
            updatePending(pendingId, (p) => ({
              ...p,
              status: 'applied',
              versionAfter: event.version_after,
              undoToken: event.undo_token,
            }))
          } else if (event.type === 'error') {
            updatePending(pendingId, (p) => ({
              ...p,
              status: 'error',
              errorMessage: event.message,
            }))
          }
        }
      } catch (err: any) {
        updatePending(pendingId, (p) => ({
          ...p,
          status: 'error',
          errorMessage: err?.message || 'Apply failed.',
        }))
      } finally {
        setPendingBusy((p) => {
          const next = { ...p }
          delete next[pendingId]
          return next
        })
      }
    },
    [accessToken, atlasSession, orgId, updatePending],
  )

  const handleUndoPending = useCallback(
    async (pendingId: string): Promise<boolean> => {
      if (!atlasSession || !accessToken || !orgId) return false
      try {
        const stream = undoPendingEdit({
          pendingId,
          orgId,
          sessionToken: atlasSession.token,
          accessToken,
        })
        let ok = false
        for await (const event of stream) {
          if (event.type === 'applied') {
            ok = true
            updatePending(pendingId, (p) => ({
              ...p,
              status: 'dropped',
              versionAfter: event.version_after ?? p.versionAfter,
            }))
          } else if (event.type === 'error') {
            updatePending(pendingId, (p) => ({
              ...p,
              status: 'error',
              errorMessage: event.message,
            }))
          }
        }
        return ok
      } catch {
        return false
      }
    },
    [accessToken, atlasSession, orgId, updatePending],
  )

  const handleCancelPending = useCallback(
    async (pendingId: string) => {
      if (!accessToken || !orgId) return
      setPendingBusy((p) => ({ ...p, [pendingId]: true }))
      try {
        const ok = await cancelPendingEdit({ pendingId, orgId, accessToken })
        if (ok) updatePending(pendingId, (p) => ({ ...p, status: 'dropped' }))
      } finally {
        setPendingBusy((p) => {
          const next = { ...p }
          delete next[pendingId]
          return next
        })
      }
    },
    [accessToken, orgId, updatePending],
  )

  // ── send / refine ──────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      if (!atlasSession || !accessToken || !orgId) return
      const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text }
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now() + 1}`,
        role: 'model',
        content: '',
        toolCalls: [],
        streaming: true,
      }
      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setInput('')
      setSending(true)
      // Clear chips on send so the next message doesn't carry stale pins.
      clearReferences()

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const stream = streamAtlasChat({
          orgId,
          sessionToken: atlasSession.token,
          message: text,
          aichatUuid: aichatUuid ?? undefined,
          accessToken,
          signal: controller.signal,
          pageContext: buildPageContextPayload(),
        })
        for await (const event of stream) {
          if (event.type === 'session') {
            setAichatUuid(event.aichat_uuid)
            continue
          }
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? applyEvent(m, event) : m)),
          )
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, streaming: false, errored: true, content: m.content || `Atlas encountered an error: ${err?.message || err}` }
                : m,
            ),
          )
        } else {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, streaming: false } : m)),
          )
        }
      } finally {
        setSending(false)
        abortRef.current = null
      }
    },
    [
      accessToken,
      aichatUuid,
      atlasSession,
      buildPageContextPayload,
      clearReferences,
      orgId,
      setInput,
    ],
  )

  const handleRefinePending = useCallback(
    async (pendingId: string, instruction: string) => {
      if (!atlasSession || !accessToken || !orgId) return
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: `Refine: ${instruction}`,
      }
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now() + 1}`,
        role: 'model',
        content: '',
        toolCalls: [],
        streaming: true,
      }
      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setSending(true)
      try {
        const stream = refinePendingEdit({
          pendingId,
          orgId,
          sessionToken: atlasSession.token,
          instruction,
          accessToken,
          pageContext: buildPageContextPayload(),
        })
        for await (const event of stream) {
          if (event.type === 'session') continue
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? applyEvent(m, event) : m)),
          )
        }
      } catch (err: any) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, streaming: false, errored: true, content: err?.message || 'Refine failed.' }
              : m,
          ),
        )
      } finally {
        setSending(false)
      }
    },
    [accessToken, atlasSession, buildPageContextPayload, orgId],
  )

  const onSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSend) return
    sendMessage(input.trim())
  }

  const stop = () => abortRef.current?.abort()

  const liveTools = useMemo(() => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'model' || !last.streaming) return null
    return last.toolCalls || null
  }, [messages])

  // ── render ─────────────────────────────────────────────────────────────
  //
  // No backdrop / blur overlay — the panel pushes the page (handled by
  // AtlasMiniProvider). No shadow either: the panel sits flush against
  // its slot so any drop-shadow bleeds onto the visible page edge.
  return (
    <aside
      className={`fixed bottom-0 right-0 top-0 z-50 flex w-[460px] max-w-[100vw] flex-col text-white transition-transform ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
      style={{
        background:
          'linear-gradient(0deg, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.35) 100%), ' +
          'radial-gradient(120% 110% at 50% -5%, rgba(139, 92, 246, 0.18) 0%, rgba(0, 0, 0, 0) 55%), ' +
          'rgb(2 1 20 / 100%)',
      }}
      aria-hidden={!open}
    >
        {/* header */}
        <header className="flex-none flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <GlobeStand size={18} weight="duotone" className="text-violet-300" />
            <span className="text-sm font-semibold text-white/90">Atlas</span>
          </div>
          <button
            type="button"
            aria-label="Close Atlas"
            onClick={onClose}
            className="rounded-md p-1.5 text-white/55 hover:text-white/90 hover:bg-white/[0.06] transition-colors"
          >
            <XIcon size={16} />
          </button>
        </header>

        {sessionError && (
          <div className="flex-none flex items-center gap-2 bg-rose-500/10 text-rose-200 px-4 py-2 text-xs border-b border-rose-500/20">
            <AlertTriangle size={13} />
            <span className="flex-1">{sessionError}</span>
            <button
              className="font-semibold underline hover:text-rose-100"
              onClick={() => refreshSession()}
            >
              Retry
            </button>
          </div>
        )}

        {/* messages */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto atlas-scroll">
          {messages.length === 0 ? (
            <div className="h-full min-h-[40vh] flex items-center justify-center px-4">
              <EmptyState
                onPick={(p) => sendMessage(p)}
                disabled={!atlasSession || sending}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-5 px-4 py-5">
              {messages.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  isLast={i === messages.length - 1}
                  disabled={sending}
                  onConfirm={() => sendMessage('go')}
                  onCancel={() => sendMessage('cancel')}
                  onApplyPending={handleApplyPending}
                  onCancelPending={handleCancelPending}
                  onRefinePending={handleRefinePending}
                  onUndoPending={handleUndoPending}
                  onApplyStructure={(structure: EditableStructure) => {
                    const payload = {
                      name: structure.title || 'Untitled course',
                      description: structure.description || undefined,
                      chapters: structure.chapters.map((ch) => ({
                        name: ch.name,
                        activities: ch.activities.map((a) => ({
                          name: a.name,
                          kind: a.kind,
                        })),
                      })),
                    }
                    sendMessage(
                      'Call `propose_course_from_structure` with this exact structure ' +
                        '(do not modify it):\n```json\n' +
                        JSON.stringify(payload, null, 2) +
                        '\n```',
                    )
                  }}
                  onRefineStructure={(instruction) =>
                    sendMessage(`Regenerate the course structure with this constraint: ${instruction}`)
                  }
                  onRetryError={() => {
                    const lastUser = [...messages].reverse().find((mm) => mm.role === 'user')
                    if (lastUser?.content) sendMessage(lastUser.content)
                  }}
                  onPickCandidate={(cand: CandidateDTO) =>
                    sendMessage(`Use ${cand.kind} ${cand.uuid} (${cand.name}).`)
                  }
                  pendingBusy={pendingBusy}
                />
              ))}
            </div>
          )}
        </div>

        {liveTools && liveTools.length > 0 && (
          <div className="flex-none px-4 pt-2">
            <ActionDock tools={liveTools} />
          </div>
        )}

        {/* attached chips */}
        {attachedReferences.length > 0 && (
          <div className="flex-none px-4 pt-2 flex flex-wrap gap-1.5">
            {attachedReferences.map((r) => (
              <span
                key={`${r.type}_${r.uuid}`}
                className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 ring-1 ring-inset ring-violet-400/25 px-2 py-0.5 text-[11px] text-violet-100"
              >
                <span className="font-medium truncate max-w-[12rem]">{r.name}</span>
                <span className="text-violet-300/50">· {r.type}</span>
                <button
                  type="button"
                  onClick={() => removeReference(r.uuid)}
                  className="text-violet-200/60 hover:text-white"
                  aria-label="Remove reference"
                >
                  <XIcon size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* composer */}
        <div className="flex-none border-t border-white/[0.04]">
          <PageContextBreadcrumb compact />
          {input.trim().length === 0 && !sending && (
            <QuickActionChips
              onPick={(p) => setInput(p)}
              disabled={!atlasSession}
            />
          )}
          <form onSubmit={onSubmit} className="px-3 py-2.5 flex items-end gap-2">
            <ReferencePicker />
            <div
              className={`flex-1 rounded-xl bg-white/[0.02] transition-all ${
                sending
                  ? 'atlas-composer-glow'
                  : 'ring-1 ring-inset ring-white/[0.06] focus-within:ring-violet-400/30 focus-within:bg-white/[0.04]'
              }`}
            >
              <textarea
                ref={inputElRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onSubmit()
                  }
                }}
                placeholder={atlasSession ? 'Ask Atlas…' : 'Starting Atlas…'}
                rows={2}
                className="w-full resize-none bg-transparent outline-none text-[13px] text-white placeholder:text-white/30 px-3 py-2 min-h-[44px] max-h-40"
                disabled={!atlasSession}
              />
            </div>
            {sending ? (
              <button
                type="button"
                onClick={stop}
                className="flex items-center gap-1.5 bg-white/10 hover:bg-white/15 text-white/80 ring-1 ring-inset ring-white/10 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors"
              >
                <Loader2 size={14} className="animate-spin" />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-white/5 disabled:text-white/30 text-white ring-1 ring-inset ring-violet-400/30 disabled:ring-white/10 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors"
              >
                <Send size={14} />
                Send
              </button>
            )}
          </form>
        </div>

        <style jsx>{`
          .atlas-scroll {
            scrollbar-width: thin;
            scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
          }
          .atlas-scroll::-webkit-scrollbar { width: 8px; }
          .atlas-scroll::-webkit-scrollbar-track { background: transparent; }
          .atlas-scroll::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
          }
          .atlas-scroll::-webkit-scrollbar-thumb:hover {
            background-color: rgba(255, 255, 255, 0.2);
          }
          /* Composer glow during Atlas streaming. Same animation across
             the full page + mini panel for consistency. */
          .atlas-composer-glow {
            box-shadow:
              inset 0 0 0 1px rgba(167, 139, 250, 0.45),
              0 0 14px 0 rgba(167, 139, 250, 0.25),
              0 0 28px 0 rgba(167, 139, 250, 0.12);
            animation: atlas-composer-glow 2.4s ease-in-out infinite;
          }
          @keyframes atlas-composer-glow {
            0%, 100% {
              box-shadow:
                inset 0 0 0 1px rgba(167, 139, 250, 0.35),
                0 0 12px 0 rgba(167, 139, 250, 0.18),
                0 0 24px 0 rgba(167, 139, 250, 0.08);
            }
            50% {
              box-shadow:
                inset 0 0 0 1px rgba(167, 139, 250, 0.60),
                0 0 20px 0 rgba(167, 139, 250, 0.38),
                0 0 40px 0 rgba(167, 139, 250, 0.18);
            }
          }
        `}</style>
    </aside>
  )
}

// Re-export the named utility so external suppress-warning imports work.
// (The Provider mounts <AtlasMiniPanel /> as default; this keeps the
// module shape compatible with anything that imported `{ appendToInput }`
// or similar from this file in the past.)
export { applyEvent }
