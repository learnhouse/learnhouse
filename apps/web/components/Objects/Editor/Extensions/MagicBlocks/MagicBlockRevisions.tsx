import React from 'react'
import { ClockCounterClockwise, ArrowCounterClockwise, Eye } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import type { MagicBlockRevision } from './types'
import { useTranslation } from 'react-i18next'

interface MagicBlockRevisionsProps {
  revisions: MagicBlockRevision[]
  previewingRevisionId: string | null
  onPreview: (revision: MagicBlockRevision | null) => void
  onRestore: (revision: MagicBlockRevision) => void
}

function formatRelativeTime(unixSeconds: number, t: (key: string, opts?: any) => string): string {
  const diff = Date.now() / 1000 - unixSeconds
  if (diff < 60) return t('editor.blocks.magic_block_content.time_just_now')
  if (diff < 3600) return t('editor.blocks.magic_block_content.time_minutes_ago', { count: Math.floor(diff / 60) })
  if (diff < 86400) return t('editor.blocks.magic_block_content.time_hours_ago', { count: Math.floor(diff / 3600) })
  return t('editor.blocks.magic_block_content.time_days_ago', { count: Math.floor(diff / 86400) })
}

function MagicBlockRevisions({
  revisions,
  previewingRevisionId,
  onPreview,
  onRestore,
}: MagicBlockRevisionsProps) {
  const { t } = useTranslation()
  const ordered = [...revisions].reverse()

  if (ordered.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-center px-6">
        <ClockCounterClockwise weight="duotone" className="w-8 h-8 text-white/20 mb-3" />
        <p className="text-sm text-white/40">
          {t('editor.blocks.magic_block_content.history_empty')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
        <ClockCounterClockwise weight="duotone" className="w-4 h-4 text-white/50" />
        <span className="font-semibold text-sm text-white/70">
          {t('editor.blocks.magic_block_content.history')}
        </span>
        <span className="ml-auto text-xs text-white/40 bg-white/5 px-2 py-0.5 rounded-full">
          {ordered.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-hide">
        {ordered.map((rev, idx) => {
          const isPreviewing = previewingRevisionId === rev.revision_uuid
          const revisionNumber = ordered.length - idx
          return (
            <div
              key={rev.revision_uuid}
              className={cn(
                "rounded-xl p-3 ring-1 ring-inset transition-all",
                isPreviewing
                  ? "bg-purple-500/10 ring-purple-400/40"
                  : "bg-white/5 ring-white/10 hover:bg-white/[0.07]"
              )}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-white/60">
                  {t('editor.blocks.magic_block_content.revision_n', { n: revisionNumber })}
                </span>
                <span className="text-[10px] text-white/30">
                  {formatRelativeTime(rev.created_at, t)}
                </span>
              </div>
              <p className="text-xs text-white/50 line-clamp-2 mb-2.5">
                {rev.prompt}
              </p>
              <div className="flex gap-1.5">
                <button
                  onClick={() => onPreview(isPreviewing ? null : rev)}
                  className={cn(
                    "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all",
                    isPreviewing
                      ? "bg-purple-500/30 text-purple-100 hover:bg-purple-500/40"
                      : "bg-white/5 text-white/50 hover:text-white/80 hover:bg-white/10"
                  )}
                >
                  <Eye weight="duotone" className="w-3 h-3" />
                  {isPreviewing
                    ? t('editor.blocks.magic_block_content.stop_preview')
                    : t('editor.blocks.magic_block_content.preview')}
                </button>
                <button
                  onClick={() => onRestore(rev)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white/5 text-white/50 hover:text-white/80 hover:bg-white/10 transition-all"
                >
                  <ArrowCounterClockwise weight="duotone" className="w-3 h-3" />
                  {t('editor.blocks.magic_block_content.restore')}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default MagicBlockRevisions
