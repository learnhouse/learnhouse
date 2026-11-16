'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowClockwise, CircleNotch, CloudCheck, CloudSlash, Eye, WarningCircle } from '@phosphor-icons/react'
import ToolTip from '@components/Objects/StyledElements/Tooltip/Tooltip'
import { HLABEL } from './headerStyles'

/** What the editor's save state is, the same in collaborative and autosave mode. */
export type SaveStatus = 'live' | 'saved' | 'unsaved' | 'saving' | 'offline' | 'failed' | 'connecting' | 'readonly'

export interface SaveState {
  status: SaveStatus
  lastSavedAt: number | null
  onRetry?: () => void
}

function relative(ms: number, locale: string): string {
  const seconds = Math.round((ms - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const abs = Math.abs(seconds)
  if (abs < 45) return rtf.format(0, 'second')
  if (abs < 45 * 60) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 22 * 3600) return rtf.format(Math.round(seconds / 3600), 'hour')
  return rtf.format(Math.round(seconds / 86400), 'day')
}

/** A quiet inline save status: icon + word, details on hover. */
export default function SaveIndicator({ state }: { state: SaveState }) {
  const { t, i18n } = useTranslation()
  // Re-render now and then so the hover time stays right
  const [, tick] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])

  const savedAgo = state.lastSavedAt ? relative(state.lastSavedAt, i18n.language || 'en') : null
  const look: Record<SaveStatus, { icon: React.ReactNode; label: string; title: string; tone: string }> = {
    // Live editing, everything saved: the green dot people know
    live: {
      icon: (
        <span className="relative flex size-2 items-center justify-center">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-40 motion-reduce:hidden" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
      ),
      label: t('editor.save_status.live', 'Live'),
      title: savedAgo
        ? t('editor.save_status.live_ago_short', 'Live: all changes saved {{when}}', { when: savedAgo })
        : t('editor.save_status.live_tip', 'Live: all changes saved'),
      tone: 'text-emerald-700',
    },
    saved: {
      icon: <CloudCheck size={14} />,
      label: t('editor.save_status.saved', 'Saved'),
      title: savedAgo
        ? t('editor.save_status.saved_ago', 'All changes saved {{when}}', { when: savedAgo })
        : t('editor.save_status.saved_auto', 'Changes are saved automatically'),
      tone: 'text-neutral-500',
    },
    // Manual saving (live editing off): edits wait for Save
    unsaved: {
      icon: <span className="size-2 rounded-full bg-amber-500" />,
      label: t('editor.save_status.unsaved_short', 'Unsaved'),
      title: t('editor.save_status.unsaved_title', 'Save with the Save button or ⌘S.'),
      tone: 'text-amber-700',
    },
    saving: {
      icon: <CircleNotch size={14} className="animate-spin" />,
      label: t('editor.save_status.saving', 'Saving…'),
      title: t('editor.save_status.saving_title', 'Saving your changes…'),
      tone: 'text-neutral-500',
    },
    offline: {
      icon: <CloudSlash size={14} />,
      label: t('editor.save_status.offline_short', 'Offline'),
      title: t('editor.save_status.offline_title', 'Keep editing: your changes sync when the connection is back.'),
      tone: 'text-amber-700',
    },
    failed: {
      icon: <WarningCircle size={14} />,
      label: t('editor.save_status.failed', 'Save failed'),
      title: savedAgo
        ? t('editor.save_status.failed_title_ago', 'Your latest changes are not saved. Last save {{when}}.', { when: savedAgo })
        : t('editor.save_status.failed_title', 'Your latest changes are not saved.'),
      tone: 'text-rose-700',
    },
    connecting: {
      icon: <CircleNotch size={14} className="animate-spin" />,
      label: t('editor.save_status.connecting', 'Connecting…'),
      title: t('editor.save_status.connecting_title', 'Joining live editing. You can already edit; changes are saved automatically.'),
      tone: 'text-neutral-500',
    },
    readonly: {
      icon: <Eye size={14} />,
      label: t('editor.save_status.readonly', 'Read-only'),
      title: t('editor.save_status.readonly_title', 'You can view this page but not edit it.'),
      tone: 'text-neutral-500',
    },
  }
  const current = look[state.status]
  // The normal state is just the dot (or cloud); only states that need
  // attention spell themselves out, keeping the header narrow
  const quiet = state.status === 'live' || state.status === 'saved'

  return (
    <ToolTip content={current.title} side="bottom">
      <span
        role="status"
        aria-live="polite"
        aria-label={`${current.label}. ${current.title}`}
        tabIndex={0}
        data-testid="save-status"
        data-status={state.status}
        className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-1 text-[11px] font-semibold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/15 ${current.tone}`}
      >
        {current.icon}
        {!quiet && <span className={HLABEL}>{current.label}</span>}
        {state.status === 'failed' && state.onRetry && (
          <button
            type="button"
            onClick={state.onRetry}
            aria-label={t('editor.save_status.retry', 'Retry')}
            className="inline-flex items-center gap-0.5 rounded px-0.5 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600/20"
          >
            <ArrowClockwise size={12} weight="bold" />
            <span className="hidden xl:inline">{t('editor.save_status.retry', 'Retry')}</span>
          </button>
        )}
      </span>
    </ToolTip>
  )
}
