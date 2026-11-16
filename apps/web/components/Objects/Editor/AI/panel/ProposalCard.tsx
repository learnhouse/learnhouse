'use client'
/*
 A proposal in the AI Editor thread: one row per change with its diff,
 Accept / Reject each, or all at once. The same changes are previewed in the
 page (previewPlugin); hovering a row highlights it there.

 Text diffs use the selection menu's word diff (Blocks/bubble/selectionTools)
 so both AI surfaces show changes the same way.
*/
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { Schema } from '@tiptap/pm/model'
import { Check, ImageSquare, Minus, PencilSimpleLine, Plus, Warning, X, CircleNotch } from '@phosphor-icons/react'
import type { AIEditorHunk, AIEditorProposal, HunkDecision } from '@services/ai/aiEditor'
import { wordDiff } from '@components/Objects/Editor/Blocks/bubble/selectionTools'
import { cn } from '@/lib/utils'
import { hunkText } from '../engine/proposals'
import { acceptCredits, type CreditCosts } from '../engine/actions'
import { hunkLabel } from './labels'

const KIND_ICON = {
  replace: PencilSimpleLine,
  insert: Plus,
  delete: Minus,
  image: ImageSquare,
} as const

function Diff({ hunk, schema }: { hunk: AIEditorHunk; schema: Schema }) {
  const { t } = useTranslation()
  if (hunk.kind === 'image') {
    return <p className="text-[12px] leading-relaxed text-white/60">{hunk.prompt}</p>
  }
  const before = hunkText(hunk.before, schema, '\n')
  const after = hunkText(hunk.after, schema, '\n')
  if (hunk.kind === 'replace' && before && after) {
    return (
      <p className="text-[12.5px] leading-relaxed text-white/70 whitespace-pre-line line-clamp-6">
        {wordDiff(before, after).map((part, i) => (
          <span
            key={i}
            className={cn(
              part.kind === 'add' && 'rounded-sm bg-emerald-400/15 text-emerald-200',
              part.kind === 'del' && 'rounded-sm bg-rose-400/10 text-rose-300/70 line-through'
            )}
          >
            {part.text}
          </span>
        ))}
      </p>
    )
  }
  if (hunk.kind === 'delete') {
    const quiz = hunk.before.find((n) => n.type === 'blockQuiz')
    const label = before || (quiz ? String(quiz.attrs?.questions?.[0]?.question ?? '') : '') || t('editor.ai_editor_v2.hunk.no_text')
    return <p className="text-[12.5px] leading-relaxed text-rose-300/70 line-through line-clamp-4">{label}</p>
  }
  const atoms = hunk.after.filter((n) => n.type === 'blockQuiz')
  if (atoms.length) {
    const questions: any[] = atoms.flatMap((n) => (Array.isArray(n.attrs?.questions) ? n.attrs.questions : []))
    return (
      <ol className="list-decimal ps-4 text-[12.5px] leading-relaxed text-emerald-100/85 space-y-0.5">
        {questions.slice(0, 5).map((q, i) => (
          <li key={i}>{String(q?.question ?? '')}</li>
        ))}
      </ol>
    )
  }
  return <p className="text-[12.5px] leading-relaxed text-emerald-100/85 whitespace-pre-line line-clamp-6">{after || t('editor.ai_editor_v2.hunk.no_text')}</p>
}

function StatusText({ status }: { status: HunkDecision }) {
  const { t } = useTranslation()
  const tone =
    status === 'applied' ? 'text-emerald-300/80' : status === 'stale' ? 'text-amber-300/80' : status === 'reverted' ? 'text-sky-300/80' : 'text-white/35'
  return <span className={cn('shrink-0 text-[12px]', tone)}>{t(`editor.ai_editor_v2.status.${status}`)}</span>
}

export default function ProposalCard({
  proposal,
  schema,
  costs,
  applying,
  onAccept,
  onReject,
  onFocus,
}: {
  proposal: AIEditorProposal
  schema: Schema
  costs: CreditCosts
  applying: boolean
  onAccept: (_hunkIds: string[]) => void
  onReject: (_hunkIds: string[]) => void
  onFocus: (_key: string | null, _scroll?: boolean) => void
}) {
  const { t } = useTranslation()
  const decision = (h: AIEditorHunk): HunkDecision => proposal.decisions[h.id] ?? 'pending'
  const open = proposal.hunks.filter((h) => decision(h) === 'pending')
  const applied = proposal.hunks.filter((h) => decision(h) === 'applied').length
  const extra = acceptCredits(open, costs)

  return (
    <div className="rounded-lg bg-white/[0.03] ring-1 ring-inset ring-white/[0.08] overflow-hidden" data-ai-proposal={proposal.id}>
      <div className="px-3 pt-2.5 pb-2">
        <p className="text-[13px] leading-snug text-white/85">{proposal.summary}</p>
        <p className="mt-0.5 text-[12px] text-white/35">{t('editor.ai_editor_v2.changes_count', { count: proposal.hunks.length })}</p>
      </div>
      {proposal.notes?.length > 0 && (
        <div className="mx-3 mb-2 flex items-start gap-1.5 rounded-lg bg-amber-400/10 px-2 py-1.5 text-[11.5px] text-amber-100/80">
          <Warning size={13} className="mt-0.5 shrink-0" />
          <span>{proposal.notes.join(' ')}</span>
        </div>
      )}
      <ul className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
        {proposal.hunks.map((h) => {
          const Icon = KIND_ICON[h.kind] ?? PencilSimpleLine
          const status = decision(h)
          const key = `${proposal.id}:${h.id}`
          return (
            <li
              key={h.id}
              className={cn('group px-3 py-2.5 transition-colors', status === 'pending' ? 'hover:bg-white/[0.03]' : 'opacity-70')}
              onMouseEnter={() => status === 'pending' && onFocus(key)}
              onMouseLeave={() => onFocus(null)}
              data-ai-hunk-row={key}
            >
              <div className="flex items-center gap-2">
                <Icon
                  size={13}
                  className={cn('shrink-0', h.kind === 'delete' ? 'text-rose-300/70' : h.kind === 'replace' ? 'text-violet-300/80' : 'text-emerald-300/70')}
                />
                <button
                  type="button"
                  onClick={() => onFocus(key, true)}
                  className="min-w-0 flex-1 truncate text-start text-[12.5px] font-medium text-white/75 hover:text-white"
                >
                  {hunkLabel(h, t)}
                </button>
                {status === 'pending' ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={applying}
                      onClick={() => onReject([h.id])}
                      aria-label={t('editor.ai_editor_v2.reject')}
                      title={t('editor.ai_editor_v2.reject')}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-40"
                    >
                      <X size={13} weight="bold" />
                    </button>
                    <button
                      type="button"
                      disabled={applying}
                      onClick={() => onAccept([h.id])}
                      aria-label={h.kind === 'image' ? t('editor.ai_editor_v2.generate_image', { count: costs.image }) : t('editor.ai_editor_v2.accept')}
                      title={h.kind === 'image' ? t('editor.ai_editor_v2.generate_image', { count: costs.image }) : t('editor.ai_editor_v2.accept')}
                      className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-violet-200 hover:bg-violet-500/25 hover:text-white disabled:opacity-40"
                    >
                      <Check size={12} weight="bold" />
                      {h.kind === 'image' && <span>{costs.image}</span>}
                    </button>
                  </div>
                ) : (
                  <StatusText status={status} />
                )}
              </div>
              <div className="mt-1 ps-[21px]">
                <Diff hunk={h} schema={schema} />
                {h.lost && Object.keys(h.lost).length > 0 && (
                  <p className="mt-1 flex items-center gap-1 text-[12px] text-amber-200/75">
                    <Warning size={12} className="shrink-0" />
                    {t('editor.ai_editor_v2.lost.removes', {
                      list: Object.entries(h.lost)
                        .map(([type, n]) => t(`editor.ai_editor_v2.lost.${['comment', 'spoiler', 'definition', 'highlight', 'textEffect', 'link', 'textColor'].includes(type) ? type : 'other'}`, { count: n }))
                        .join(', '),
                    })}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {open.length > 0 ? (
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-2">
          <span className="flex-1 text-[11px] text-white/40">
            {extra > 0
              ? t('editor.ai_editor_v2.accept_all_cost', { count: extra })
              : applied > 0
                ? t('editor.ai_editor_v2.applied_so_far', { count: applied })
                : ''}
          </span>
          <button
            type="button"
            disabled={applying}
            onClick={() => onReject(open.map((h) => h.id))}
            className="h-7 rounded-lg px-2.5 text-[12px] font-medium text-white/55 hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
          >
            {t('editor.ai_editor_v2.reject_all')}
          </button>
          <button
            type="button"
            disabled={applying}
            onClick={() => onAccept(open.map((h) => h.id))}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-50 [background:linear-gradient(180deg,rgb(139,92,246)_0%,rgb(124,58,237)_100%)]"
          >
            {applying ? <CircleNotch size={12} className="animate-spin" /> : <Check size={12} weight="bold" />}
            {t('editor.ai_editor_v2.accept_all')}
          </button>
        </div>
      ) : (
        <div className="border-t border-white/[0.06] px-3 py-2 text-[11px] text-white/40">
          {proposal.version_label
            ? t('editor.ai_editor_v2.done_with_version', { label: proposal.version_label })
            : t('editor.ai_editor_v2.done')}
        </div>
      )}
    </div>
  )
}
