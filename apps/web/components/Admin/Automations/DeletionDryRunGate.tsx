'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle, Crown, Hourglass } from '@phosphor-icons/react'
import type { Automation, AutomationAction, AutomationCondition } from '@services/ee/platform/types'
import { formatDate } from '@components/Admin/Shared/AdminKit'

// §11.2 brake for rules that schedule org deletions: owners only, and dry run
// can't be turned off until the rule has had a dry run or preview
// (`first_live_allowed_after_preview`). Changing the conditions or actions
// resets that, so an edited draft needs a new dry run too.

export function hasDeletionAction(actions: AutomationAction[] | undefined | null): boolean {
  return (Array.isArray(actions) ? actions : []).some((a) => a?.type === 'schedule_org_deletion')
}

/** True while dry run must stay on (deletion rule without a dry run of this exact version). */
export function dryRunLocked(rule: (Automation & { first_live_allowed_after_preview?: string | null }) | null, draft: { actions: AutomationAction[]; conditions: AutomationCondition[] }): boolean {
  if (!hasDeletionAction(draft.actions)) return false
  if (!rule || !rule.first_live_allowed_after_preview) return true
  const same =
    JSON.stringify(rule.actions ?? []) === JSON.stringify(draft.actions ?? []) && JSON.stringify(rule.conditions ?? []) === JSON.stringify(draft.conditions ?? [])
  return !same
}

export default function DeletionDryRunGate({
  rule,
  draft,
  isOwner,
}: {
  rule: (Automation & { first_live_allowed_after_preview?: string | null }) | null
  draft: { actions: AutomationAction[]; conditions: AutomationCondition[]; dry_run: boolean }
  isOwner: boolean
}) {
  const { t, i18n } = useTranslation()
  if (!hasDeletionAction(draft.actions)) return null
  const locked = dryRunLocked(rule, draft)
  return (
    <div className="mt-3 space-y-2">
      {!isOwner && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
          <Crown size={14} weight="fill" className="mt-px shrink-0" />
          {t('admin.automations.deletion_gate.owner_only')}
        </p>
      )}
      {locked ? (
        <p className="flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2.5 text-xs text-sky-700">
          <Hourglass size={14} weight="fill" className="mt-px shrink-0" />
          <span>
            <span className="font-semibold">{t('admin.automations.deletion_gate.needs_dry_run')}</span> {t('admin.automations.deletion_gate.needs_dry_run_desc')}
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">
          <CheckCircle size={14} weight="fill" className="mt-px shrink-0" />
          {t('admin.automations.deletion_gate.dry_run_done', { date: formatDate(rule?.first_live_allowed_after_preview, i18n.language, true) })}
        </p>
      )}
    </div>
  )
}
