import React from 'react'
import { ArrowCounterClockwise, ClockCounterClockwise } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { AIShimmer } from '@components/Objects/AI/AIBrand'
import type { MagicBlockRevision } from './types'

function formatRelativeTime(unixSeconds: number, t: (_key: string, _opts?: any) => string): string {
  const diff = Date.now() / 1000 - unixSeconds
  if (diff < 60) return t('editor.blocks.magic_block_content.time_just_now')
  if (diff < 3600) return t('editor.blocks.magic_block_content.time_minutes_ago', { count: Math.floor(diff / 60) })
  if (diff < 86400) return t('editor.blocks.magic_block_content.time_hours_ago', { count: Math.floor(diff / 3600) })
  return t('editor.blocks.magic_block_content.time_days_ago', { count: Math.floor(diff / 86400) })
}

/** Past generations of this block (newest first); restoring one makes it a draft to accept. */
function MagicBlockRevisions({
  revisions,
  loading,
  onRestore,
}: {
  revisions: MagicBlockRevision[]
  loading: boolean
  onRestore: (_revision: MagicBlockRevision) => void
}) {
  const { t } = useTranslation()
  const ordered = [...revisions].reverse()
  if (loading && ordered.length === 0) return <AIShimmer lines={3} />
  if (ordered.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <ClockCounterClockwise size={20} weight="duotone" className="text-neutral-300" />
        <p className="text-[12px] text-neutral-500">{t('editor.blocks.magic_block_content.history_empty')}</p>
      </div>
    )
  }
  return (
    <ul className="-mx-1 flex max-h-80 flex-col gap-0.5 overflow-y-auto">
      {ordered.map((rev, idx) => (
        <li key={rev.revision_uuid} className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-neutral-50">
          <span className="mt-px flex h-5 min-w-5 flex-none items-center justify-center rounded-md bg-violet-50 px-1 text-[10px] font-semibold text-violet-700">
            {ordered.length - idx}
          </span>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[12px] text-neutral-700">{rev.prompt}</p>
            <span className="text-[11px] text-neutral-400">{formatRelativeTime(rev.created_at, t)}</span>
          </div>
          <button
            type="button"
            onClick={() => onRestore(rev)}
            className="inline-flex h-7 flex-none items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
          >
            <ArrowCounterClockwise size={12} />
            {t('editor.blocks.magic_block_content.restore')}
          </button>
        </li>
      ))}
    </ul>
  )
}

export default MagicBlockRevisions
