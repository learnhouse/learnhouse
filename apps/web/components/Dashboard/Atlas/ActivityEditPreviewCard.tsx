'use client'

import React, { useMemo, useState } from 'react'

import ActivityPreview from '@components/Objects/Activities/ActivityPreview/ActivityPreview'
import { AtlasEvent } from '@services/ai/atlas'
import { Check, FileText, Loader2, Pencil, RotateCcw, X as XIcon } from 'lucide-react'

import { MessagePending } from './AtlasChat'

// Renders a ``preview.activity`` event payload as a before/after card
// using the existing ActivityPreview component (with autoFetch=false so
// it consumes the draft object directly instead of refetching). Apply /
// Cancel / Refine wire to the new /pending/{id}/* HTTP endpoints owned
// by AtlasChat / AtlasMiniPanel.

interface Props {
  pending: MessagePending
  busy?: boolean
  onApply: () => void
  onCancel: () => void
  onRefine: (instruction: string) => void
}

type PreviewActivityEvent = Extract<AtlasEvent, { type: 'preview.activity' }>

export default function ActivityEditPreviewCard({ pending, busy, onApply, onCancel, onRefine }: Props) {
  const preview = pending.preview as PreviewActivityEvent
  const [tab, setTab] = useState<'proposed' | 'current' | 'compare'>('proposed')
  const [refineOpen, setRefineOpen] = useState(false)
  const [refineText, setRefineText] = useState('')

  // Compare tab is only useful when both before and after exist AND the
  // activity carries a markdown-shaped body (assignment description,
  // dynamic-markdown URL doesn't have inline content to diff).
  const aType = (preview.proposed as any)?.activity_type
  const aSubType = (preview.proposed as any)?.activity_sub_type
  const canCompare = !!preview.current && diffSupportedForType(aType, aSubType)

  // Build draft activity objects ActivityPreview can render. The
  // ``proposed`` and ``current`` payloads from the event already match
  // the Activity shape (name, activity_type, activity_sub_type, content).
  // We tag activity_uuid so the preview component's keying is stable.
  const draftProposed = useMemo(
    () => ({ activity_uuid: preview.target.uuid || 'preview-proposed', ...preview.proposed }),
    [preview.proposed, preview.target.uuid],
  )
  const draftCurrent = useMemo(
    () =>
      preview.current
        ? { activity_uuid: preview.target.uuid || 'preview-current', ...preview.current }
        : null,
    [preview.current, preview.target.uuid],
  )

  const isApplied = pending.status === 'applied'
  const isDropped = pending.status === 'dropped'
  const isError = pending.status === 'error'

  return (
    <div className="rounded-xl ring-1 ring-inset ring-white/10 bg-black/20 overflow-hidden">
      {/* header */}
      <div className="px-4 py-3 border-b border-white/10 bg-gradient-to-b from-violet-500/10 to-transparent">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-violet-300/80 mb-1">
          <FileText size={11} className="text-violet-300" />
          Activity · {preview.mode}
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[15px] font-semibold text-white/95 truncate">
            {preview.target.name || '(new)'}
          </h3>
          {preview.expected_version !== undefined && (
            <span className="text-[10px] text-white/35 font-mono">v{preview.expected_version}</span>
          )}
        </div>
        {preview.summary && (
          <p className="text-xs text-white/60 mt-1 leading-relaxed">{preview.summary}</p>
        )}
      </div>

      {/* tabs */}
      {!isApplied && !isDropped && draftCurrent && (
        <div className="flex items-center gap-1 border-b border-white/[0.06] bg-black/15 px-3 py-1.5">
          {(['proposed', 'current'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-2 py-0.5 text-[11px] capitalize transition-colors ${
                tab === t
                  ? 'bg-violet-500/20 text-violet-100 ring-1 ring-inset ring-violet-400/30'
                  : 'text-white/55 hover:text-white/80 hover:bg-white/[0.04]'
              }`}
            >
              {t}
            </button>
          ))}
          {canCompare && (
            <button
              type="button"
              onClick={() => setTab('compare')}
              className={`rounded-md px-2 py-0.5 text-[11px] capitalize transition-colors ${
                tab === 'compare'
                  ? 'bg-violet-500/20 text-violet-100 ring-1 ring-inset ring-violet-400/30'
                  : 'text-white/55 hover:text-white/80 hover:bg-white/[0.04]'
              }`}
            >
              compare
            </button>
          )}
        </div>
      )}

      {/* preview body */}
      <div className="bg-black/10 px-4 py-3 max-h-[60vh] overflow-auto">
        {tab === 'compare' && draftCurrent ? (
          <MarkdownCompare
            activityType={aType}
            currentContent={(preview.current as any)?.content}
            proposedContent={(preview.proposed as any)?.content}
          />
        ) : (
          <div className="rounded-lg bg-white/95 text-zinc-900 p-3">
            <ActivityPreview
              activity={tab === 'proposed' ? draftProposed : draftCurrent || draftProposed}
              autoFetch={false}
            />
          </div>
        )}
      </div>

      {/* footer / actions */}
      {isApplied ? (
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-white/10 bg-emerald-500/10 text-emerald-200 text-xs">
          <Check size={13} />
          <span className="font-semibold">Applied</span>
          {pending.versionAfter !== undefined && (
            <span className="text-emerald-300/70">v{pending.versionAfter}</span>
          )}
        </div>
      ) : isDropped ? (
        <div className="px-4 py-2 border-t border-white/10 text-[11px] italic text-white/40">
          Proposal dropped.
        </div>
      ) : isError ? (
        <div className="px-4 py-2 border-t border-white/10 bg-rose-500/10 text-rose-200 text-xs">
          {pending.errorMessage || 'Apply failed.'}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-t border-white/10">
          <button
            type="button"
            onClick={onApply}
            disabled={busy}
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 disabled:bg-white/5 disabled:text-white/30 text-white ring-1 ring-inset ring-violet-400/30 disabled:ring-white/10 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {busy ? 'Applying…' : 'Apply'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white/70 hover:text-white/90 ring-1 ring-inset ring-white/10 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            <XIcon size={13} />
            Cancel
          </button>
          <button
            type="button"
            onClick={() => setRefineOpen((v) => !v)}
            disabled={busy}
            className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white/70 hover:text-white/90 ring-1 ring-inset ring-white/10 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            <Pencil size={13} />
            Refine
          </button>
          {refineOpen && (
            <form
              className="w-full flex items-center gap-2 mt-2"
              onSubmit={(e) => {
                e.preventDefault()
                const text = refineText.trim()
                if (!text) return
                onRefine(text)
                setRefineText('')
                setRefineOpen(false)
              }}
            >
              <input
                autoFocus
                type="text"
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
                placeholder="Change the tone, shorten, translate…"
                className="flex-1 rounded-lg bg-black/30 ring-1 ring-inset ring-white/10 focus:ring-violet-400/40 outline-none text-sm text-white px-2 py-1.5"
              />
              <button
                type="submit"
                className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white ring-1 ring-inset ring-violet-400/30 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
              >
                <RotateCcw size={13} />
                Send
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Compare tab helpers ─────────────────────────────────────────────────

function diffSupportedForType(
  type: string | undefined,
  subType: string | undefined,
): boolean {
  // Assignment activities store markdown directly in content.description.
  if (type === 'TYPE_ASSIGNMENT') return true
  // Dynamic-markdown subtype stores a URL — not inline content; the
  // markdown lives at the remote URL. Skip diff for that path; the
  // Proposed/Current tabs still render via fetch.
  return false
}

function extractMarkdownFromContent(
  type: string | undefined,
  content: any,
): string {
  if (type === 'TYPE_ASSIGNMENT' && content && typeof content === 'object') {
    return String(content.description || '')
  }
  if (typeof content === 'string') return content
  return ''
}

function MarkdownCompare({
  activityType,
  currentContent,
  proposedContent,
}: {
  activityType: string | undefined
  currentContent: any
  proposedContent: any
}) {
  const before = extractMarkdownFromContent(activityType, currentContent)
  const after = extractMarkdownFromContent(activityType, proposedContent)
  const ops = useMemo(() => diffLines(before, after), [before, after])
  if (!before && !after) {
    return (
      <div className="rounded-lg bg-white/95 text-zinc-700 p-3 text-sm italic">
        No textual content to compare.
      </div>
    )
  }
  return (
    <div className="rounded-lg bg-white/95 text-zinc-900 p-3 font-mono text-[12px] leading-relaxed">
      {ops.length === 0 ? (
        <span className="italic text-zinc-500">No changes detected.</span>
      ) : (
        <pre className="whitespace-pre-wrap">
          {ops.map((op, i) => (
            <span
              key={i}
              className={
                op.type === 'add'
                  ? 'block bg-emerald-50 text-emerald-800 px-1'
                  : op.type === 'del'
                  ? 'block bg-rose-50 text-rose-800 px-1 line-through'
                  : 'block text-zinc-700 px-1'
              }
            >
              {op.type === 'add' ? '+ ' : op.type === 'del' ? '- ' : '  '}
              {op.text || ' '}
            </span>
          ))}
        </pre>
      )}
    </div>
  )
}

// Minimal LCS line-diff. Returns a sequence of equal / add / del ops in
// reading order. Good enough for short activity bodies (assignments
// are typically under a few KB); for long documents an external
// ``diff`` package would be better but adds a dep we don't need yet.
type DiffOp = { type: 'eq' | 'add' | 'del'; text: string }

function diffLines(a: string, b: string): DiffOp[] {
  const A = a.split('\n')
  const B = b.split('\n')
  const m = A.length
  const n = B.length
  // dp[i][j] = LCS length of A[i:] and B[j:].
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (A[i] === B[j]) dp[i][j] = dp[i + 1][j + 1] + 1
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (A[i] === B[j]) {
      ops.push({ type: 'eq', text: A[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: A[i] })
      i++
    } else {
      ops.push({ type: 'add', text: B[j] })
      j++
    }
  }
  while (i < m) {
    ops.push({ type: 'del', text: A[i++] })
  }
  while (j < n) {
    ops.push({ type: 'add', text: B[j++] })
  }
  // If after diffing there's nothing but eq, drop the whole thing so we
  // can render an "unchanged" hint at the call site.
  if (ops.every((o) => o.type === 'eq')) return []
  return ops
}
