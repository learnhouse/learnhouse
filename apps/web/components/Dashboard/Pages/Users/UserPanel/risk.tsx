'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, CaretRight, Exam, Pulse, SealWarning, Warning } from '@phosphor-icons/react'
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover'
import type { RiskReason } from '@services/organizations/memberPanel'
import { P } from './panelUi'
import type { PanelTab } from './panelState'

// Why a member is at risk: the API returns `{code, params}` reasons (see
// assess_risk in services/orgs/member_panel.py); each one reads as a short
// sentence and points at the tab where it can be acted on.

const REASON_TAB: Record<string, PanelTab> = {
  inactive: 'activity',
  never_active: 'activity',
  assignment_overdue: 'assignments',
  training_overdue: 'overview',
  unfinished_courses: 'learning',
}

const REASON_ICON: Record<string, React.ReactNode> = {
  inactive: <Pulse size={14} weight="bold" />,
  never_active: <Pulse size={14} weight="bold" />,
  assignment_overdue: <Exam size={14} weight="bold" />,
  training_overdue: <SealWarning size={14} weight="bold" />,
  unfinished_courses: <BookOpen size={14} weight="bold" />,
}

export function reasonLabel(t: (_k: string, _o?: any) => string, reason: RiskReason): string {
  const p = reason.params || {}
  switch (reason.code) {
    case 'inactive':
      return t(`${P}.risk.inactive`, { count: p.days })
    case 'never_active':
      return p.days == null ? t(`${P}.risk.never_active_plain`) : t(`${P}.risk.never_active`, { count: p.days })
    case 'assignment_overdue':
      return p.count === 1 ? t(`${P}.risk.assignment_overdue_named`, { title: p.title }) : t(`${P}.risk.assignment_overdue`, { count: p.count })
    case 'training_overdue':
      return p.count === 1 ? t(`${P}.risk.training_overdue_named`, { title: p.title }) : t(`${P}.risk.training_overdue`, { count: p.count })
    case 'unfinished_courses':
      return t(`${P}.risk.unfinished_courses`, { count: p.count })
    default:
      return reason.code.replace(/_/g, ' ')
  }
}

/** The reasons as rows, each opening the tab where it can be dealt with. */
export function RiskReasonList({ reasons, onTab, tone = 'rose' }: { reasons: RiskReason[]; onTab: (_t: PanelTab) => void; tone?: 'rose' | 'amber' }) {
  const { t } = useTranslation()
  const iconTone = tone === 'rose' ? 'bg-rose-50 text-rose-600' : 'bg-amber-100/70 text-amber-700'
  return (
    <ul className="flex flex-col">
      {reasons.map((r, i) => (
        <li key={`${r.code}-${i}`}>
          <button
            type="button"
            onClick={() => onTab(REASON_TAB[r.code] ?? 'overview')}
            className="group w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-start hover:bg-black/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/15"
          >
            <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${iconTone}`}>{REASON_ICON[r.code] ?? <Warning size={14} />}</span>
            <span className="flex-1 min-w-0 text-[13px] text-neutral-800 truncate" dir="auto">
              {reasonLabel(t, r)}
            </span>
            <CaretRight size={12} className="text-neutral-300 group-hover:text-neutral-500 shrink-0 rtl:rotate-180" />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** "At risk" chip in the header; opens the reasons. */
export function RiskChip({ reasons, onTab }: { reasons: RiskReason[]; onTab: (_t: PanelTab) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset text-rose-700 bg-rose-50 ring-rose-600/15 hover:bg-rose-100/70 data-[state=open]:ring-rose-600/30 transition-colors"
          aria-label={t(`${P}.risk.why`)}
        >
          <Warning size={11} weight="fill" />
          {t(`${P}.chips.at_risk`)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2 rounded-xl border-0 bg-white nice-shadow ring-1 ring-black/5">
        <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{t(`${P}.risk.why`)}</p>
        <RiskReasonList
          reasons={reasons}
          onTab={(tab) => {
            setOpen(false)
            onTab(tab)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
