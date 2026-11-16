'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { CircleNotch, LockSimple, WifiSlash } from '@phosphor-icons/react'
import type { CollabState } from './useActivityCollab'
import { collabNoticeKind } from './collabStatus'

/**
 * One line above the editor content when live editing is not running as it
 * should: reconnecting, given up (manual saving), or no edit rights.
 */
export default function CollabNotice({ state, live }: { state: CollabState; live: boolean }) {
  const { t } = useTranslation()
  const kind = collabNoticeKind(state, live)
  if (!kind) return null

  const content = {
    reconnecting: {
      icon: <CircleNotch size={16} className="animate-spin shrink-0" aria-hidden />,
      text: t('editor.live_editing.reconnecting', 'Reconnecting to live editing… You can keep working; changes save automatically.'),
      tone: 'bg-amber-50 text-amber-800 ring-amber-200',
    },
    manual: {
      icon: <WifiSlash size={16} className="shrink-0" aria-hidden />,
      text: t('editor.live_editing.unavailable_manual', 'Live editing unavailable, changes save manually.'),
      tone: 'bg-amber-50 text-amber-800 ring-amber-200',
    },
    forbidden: {
      icon: <LockSimple size={16} className="shrink-0" aria-hidden />,
      text: t('editor.live_editing.forbidden', "You can't edit this activity."),
      tone: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
    },
  }[kind]

  return (
    <div
      role="status"
      data-testid="collab-notice"
      data-kind={kind}
      className={`mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${content.tone}`}
    >
      {content.icon}
      <span>{content.text}</span>
    </div>
  )
}
