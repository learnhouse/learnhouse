'use client'
// Settings → Plan & usage, SaaS: the running trial (days left, what it
// unlocks, what happens at the end) and, once an org is on Free after a
// trial or a cancellation, what that move changed and that an upgrade puts it
// back. Calm on purpose: no countdown theatrics, one action.
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, CaretDown, HourglassMedium, ArrowCounterClockwise } from '@phosphor-icons/react'
import { Panel, buttonClass } from '@/design'
import { planNameById } from '@/app/(hub)/_billing/planText'
import DowngradePreview from '@components/Billing/DowngradePreview'
import { trialProgress, type OrgTrial } from '@services/plans/trial'
import type { DowngradePreview as Preview, LastDowngrade } from '@services/orgs/planOverview'

const P = 'dashboard.organization.plan_usage.trial'

function useDate() {
  const { i18n } = useTranslation()
  return (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString(i18n.language, { month: 'long', day: 'numeric' }) : ''
}

export function TrialCard({
  trial,
  preview,
  upgradeUrl,
  canManage,
  unlockedCount,
}: {
  trial: OrgTrial
  preview: Preview | null | undefined
  upgradeUrl: string | null
  canManage: boolean
  unlockedCount: number
}) {
  const { t } = useTranslation()
  const date = useDate()
  const [open, setOpen] = useState(false)
  const plan = planNameById(t, trial.plan, trial.plan)
  const pct = trialProgress(trial)
  const lastDays = trial.days_left <= 3

  return (
    <Panel padded className="flex flex-col gap-4" data-testid="trial-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
            <HourglassMedium size={20} weight="duotone" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-neutral-900">
              {t(`${P}.title`, { plan, count: trial.days_left })}
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              {t(`${P}.desc`, { plan, date: date(trial.ends_at), count: unlockedCount })}
            </p>
          </div>
        </div>
        {canManage && upgradeUrl && (
          <a href={upgradeUrl} className={buttonClass(lastDays ? 'primary' : 'secondary', 'md')} data-testid="trial-choose-plan">
            {t(`${P}.choose`, { plan })}
            <ArrowRight size={13} weight="bold" className="rtl:rotate-180" />
          </a>
        )}
      </div>
      <div>
        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-violet-500/80" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-neutral-400 tabular-nums">
          <span>{date(trial.started_at)}</span>
          <span>{date(trial.ends_at)}</span>
        </div>
      </div>
      {preview && (
        <div className="border-t border-neutral-100 pt-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex w-full items-center justify-between gap-2 text-start text-sm font-medium text-neutral-700 hover:text-neutral-900"
          >
            {t(`${P}.what_happens`)}
            <CaretDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && <DowngradePreview preview={preview} className="mt-3" />}
        </div>
      )}
    </Panel>
  )
}

export function LastDowngradeCard({
  downgrade,
  upgradeUrl,
  canManage,
}: {
  downgrade: LastDowngrade
  upgradeUrl: string | null
  canManage: boolean
}) {
  const { t } = useTranslation()
  const date = useDate()
  if (downgrade.restored) return null
  const plan = planNameById(t, downgrade.from_plan, downgrade.from_plan)
  const titleKey = downgrade.reason === 'trial_expired' ? 'ended_title_trial' : 'ended_title'
  return (
    <Panel padded className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between" data-testid="last-downgrade">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
          <ArrowCounterClockwise size={20} weight="duotone" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-tight text-neutral-900">
            {t(`${P}.${titleKey}`, { plan, date: date(downgrade.created_at) })}
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            {downgrade.courses_made_private > 0
              ? t(`${P}.ended_courses`, { count: downgrade.courses_made_private, plan })
              : t(`${P}.ended_no_courses`, { plan })}
          </p>
        </div>
      </div>
      {canManage && upgradeUrl && (
        <a href={upgradeUrl} className={buttonClass('primary', 'md')} data-testid="restore-plan">
          {t(`${P}.restore`, { plan })}
          <ArrowRight size={13} weight="bold" className="rtl:rotate-180" />
        </a>
      )}
    </Panel>
  )
}
