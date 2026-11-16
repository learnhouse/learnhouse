'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { StatusPill } from '@/design'
import { CHART_COLORS } from '@components/Admin/Shared/AdminKit'
import type { AICostDayRow, AIMargin } from '@services/ee/platform/types'

export { fillDays } from './aiCostsDays'

// Shared pieces of the AI costs page and the org detail card.

export const VALUE_COLOR = CHART_COLORS[0]
export const COST_COLOR = CHART_COLORS[3]

export function usd(value: number | null | undefined, digits?: number): string {
  const v = Number(value) || 0
  const d = digits ?? (v !== 0 && Math.abs(v) < 1 ? 4 : 2)
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`
}

export function num(value: number | null | undefined): string {
  return (Number(value) || 0).toLocaleString()
}

/** Published price: "3+" for metered features (a minimum; heavy requests charge their real usage). */
export function PriceCell({ credits, metered, absorbed }: { credits: number | null | undefined; metered?: boolean | null; absorbed?: boolean }) {
  const { t } = useTranslation()
  if (absorbed) return <span className="text-xs text-neutral-400">{t('admin.ai_costs.absorbed')}</span>
  if (credits === null || credits === undefined) return <span className="text-neutral-400">–</span>
  return metered ? <span title={t('admin.ai_costs.metered_title')}>{credits}+</span> : <span>{credits}</span>
}

/** "2.4×" with a status color: under the floor is danger, close to it warning. */
export function MarginBadge({ row, floor }: { row: Pick<AIMargin, 'margin_multiple' | 'below_floor'> & { absorbed?: boolean }; floor: number }) {
  const { t } = useTranslation()
  if (row.absorbed) return <span className="text-xs text-neutral-400">{t('admin.ai_costs.absorbed')}</span>
  const m = row.margin_multiple
  if (m === null || m === undefined) return <span className="text-xs text-neutral-400">–</span>
  const status = row.below_floor ? 'danger' : m < floor * 1.25 ? 'warning' : 'success'
  return (
    <StatusPill status={status} title={t('admin.ai_costs.margin_title', { floor })}>
      <span className="tabular-nums">{m.toFixed(2)}×</span>
    </StatusPill>
  )
}

/** Value charged (credits × credit value) and provider cost, per day, side by side. */
export function CostValueChart({ days, height = 120 }: { days: AICostDayRow[]; height?: number }) {
  const { t } = useTranslation()
  const max = Math.max(0.000001, ...days.map((d) => Math.max(d.value_usd, d.cost_usd)))
  if (!days.length) return <p className="text-sm text-neutral-400">{t('admin.ai_costs.no_usage')}</p>
  return (
    <div>
      <div
        role="img"
        aria-label={t('admin.ai_costs.chart_label')}
        className="flex items-end gap-1 w-full border-b border-[var(--adm-line)]"
        style={{ height }}
      >
        {days.map((d) => {
          const title = t('admin.ai_costs.chart_tooltip', { date: d.date, value: usd(d.value_usd), cost: usd(d.cost_usd), credits: num(d.credits) })
          return (
            <div key={d.date} title={title} className="flex-1 min-w-[4px] h-full flex items-end gap-px">
              <div className="flex-1 rounded-t-[2px]" style={{ height: `${Math.max(1, (d.value_usd / max) * 100)}%`, background: VALUE_COLOR, opacity: 0.85 }} />
              <div className="flex-1 rounded-t-[2px]" style={{ height: `${Math.max(1, (d.cost_usd / max) * 100)}%`, background: COST_COLOR, opacity: 0.85 }} />
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-neutral-400">
        <span>{days[0]?.date}</span>
        <span className="flex items-center gap-3">
          <Legend color={VALUE_COLOR} label={t('admin.ai_costs.value')} />
          <Legend color={COST_COLOR} label={t('admin.ai_costs.cost')} />
        </span>
        <span>{days[days.length - 1]?.date}</span>
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: color }} />
      {label}
    </span>
  )
}

export function Th({ children, end = false }: { children?: React.ReactNode; end?: boolean }) {
  return <th className={`px-3 first:ps-5 last:pe-5 py-2.5 font-medium ${end ? 'text-end' : 'text-start'}`}>{children}</th>
}

export function Td({ children, end = false, className = '' }: { children?: React.ReactNode; end?: boolean; className?: string }) {
  return <td className={`px-3 first:ps-5 last:pe-5 py-2 ${end ? 'text-end tabular-nums' : ''} ${className}`}>{children}</td>
}
