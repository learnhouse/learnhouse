'use client'
/*
 AI changes made to this page, newest first. "Revert" undoes a proposal's
 applied changes as new editor transactions (so it merges with live edits);
 when a change was edited since, the version saved before it ("Before AI: …")
 is one click away in the version history.
*/
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowCounterClockwise, ClockCounterClockwise, CircleNotch } from '@phosphor-icons/react'
import type { AIEditorProposal } from '@services/ai/aiEditor'
import { cn } from '@/lib/utils'

function relative(ts: number | null | undefined, t: (_k: string, _o?: any) => string): string {
  if (!ts) return ''
  const ms = ts < 1e12 ? ts * 1000 : ts
  const diff = Math.max(0, Date.now() - ms)
  const min = Math.round(diff / 60000)
  if (min < 1) return t('editor.ai_editor_v2.time.now')
  if (min < 60) return t('editor.ai_editor_v2.time.minutes', { count: min })
  const h = Math.round(min / 60)
  if (h < 24) return t('editor.ai_editor_v2.time.hours', { count: h })
  return new Date(ms).toLocaleDateString()
}

export default function HistoryView({
  items,
  onRevert,
  onOpenVersions,
}: {
  items: AIEditorProposal[] | null
  onRevert: (_p: AIEditorProposal) => { reverted: number; stale: number }
  onOpenVersions?: () => void
}) {
  const { t } = useTranslation()
  const [notice, setNotice] = React.useState<{ id: string; stale: number; reverted: number } | null>(null)

  if (items === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-white/40">
        <CircleNotch size={18} className="animate-spin" />
      </div>
    )
  }
  if (!items.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <ClockCounterClockwise size={20} className="text-white/30" />
        <p className="text-[13px] text-white/70">{t('editor.ai_editor_v2.history.empty_title')}</p>
        <p className="text-[12px] text-white/45">{t('editor.ai_editor_v2.history.empty_body')}</p>
      </div>
    )
  }
  return (
    <div className="lh-ai-scroll flex-1 overflow-y-auto px-3.5 py-1">
      <ol className="divide-y divide-white/[0.06]">
        {items.map((p) => {
          const values = Object.values(p.decisions || {})
          const applied = values.filter((v) => v === 'applied').length
          const reverted = values.filter((v) => v === 'reverted').length
          return (
            <li key={p.id} className="py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug text-white/80">{p.summary}</p>
                  <p className="mt-0.5 text-[12px] text-white/35">
                    {[
                      relative(p.applied_at || p.created_at, t),
                      applied ? t('editor.ai_editor_v2.history.applied', { count: applied }) : null,
                      reverted ? t('editor.ai_editor_v2.history.reverted', { count: reverted }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!applied}
                  onClick={() => {
                    const res = onRevert(p)
                    setNotice({ id: p.id, ...res })
                  }}
                  className={cn(
                    'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px]',
                    applied ? 'text-white/60 hover:bg-white/[0.08] hover:text-white' : 'text-white/25'
                  )}
                >
                  <ArrowCounterClockwise size={13} />
                  {t('editor.ai_editor_v2.history.revert')}
                </button>
              </div>
              {p.version_label && (
                <p className="mt-1 truncate text-[12px] text-white/30">
                  {t('editor.ai_editor_v2.history.version', { label: p.version_label })}
                </p>
              )}
              {notice?.id === p.id && (
                <div className="mt-2 flex items-center gap-2 text-[11.5px]">
                  <span className={notice.stale ? 'text-amber-200/85' : 'text-emerald-200/85'}>
                    {notice.stale
                      ? t('editor.ai_editor_v2.history.partly', { count: notice.stale })
                      : t('editor.ai_editor_v2.history.done', { count: notice.reverted })}
                  </span>
                  {notice.stale > 0 && onOpenVersions && (
                    <button type="button" onClick={onOpenVersions} className="font-semibold text-violet-200 underline-offset-2 hover:underline">
                      {t('editor.ai_editor_v2.history.open_versions')}
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
