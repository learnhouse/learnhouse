'use client'
// "Compare all features": the marketing compare table, in the app. Four plan
// columns on desktop (the current plan's column tinted), one plan at a time on
// phones. Starts with the limits and the teaching rows; the rest opens on
// demand so the page stays short.
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CaretDown, Check } from '@phosphor-icons/react'
import { Button } from '@/design'
import { findPlan, type PlanLimits } from '../_lib/plans'
import { planName } from '../../_billing/planText'
import { ACCENT, CARD_PLANS, PlanBadge, compareGroups, rowLabel, type AccentKey, type Cell } from './planDisplay'

const COLLAPSED_GROUPS = 2

function Yes({ label }: { label: string }) {
  return (
    <span className="inline-grid place-items-center w-[22px] h-[22px] rounded-full bg-emerald-50 text-emerald-600" aria-label={label}>
      <Check size={12} weight="bold" />
    </span>
  )
}
function No({ label }: { label: string }) {
  return <span className="inline-block w-2.5 h-px bg-black/15 align-middle" aria-label={label} />
}

export default function PlanComparison({ planLimits, currentPlanId }: { planLimits?: PlanLimits; currentPlanId: string }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [mobilePlan, setMobilePlan] = useState(() => Math.max(0, (CARD_PLANS as readonly string[]).indexOf(currentPlanId)))
  const groups = compareGroups(t, planLimits)
  const shown = expanded ? groups : groups.slice(0, COLLAPSED_GROUPS)
  const cols = CARD_PLANS.map((id) => ({ id, accent: (id === 'enterprise' ? 'enterpriseLight' : id) as AccentKey }))
  const currentCol = (CARD_PLANS as readonly string[]).indexOf(currentPlanId)
  const yes = t('billing.flow.included', { defaultValue: 'Included' })
  const no = t('billing.flow.not_included', { defaultValue: 'Not included' })
  const cell = (c: Cell) => (c === true ? <Yes label={yes} /> : c === false ? <No label={no} /> : c)
  const groupTitle = (key: string) => t(`billing.flow.rows.${key}`)
  const label = (key: string, Icon: React.ElementType, tint: string) => (
    <span className="inline-flex items-center gap-3">
      <Icon size={17} weight="duotone" className={`flex-shrink-0 ${tint}`} />
      <span>{rowLabel(t, key)}</span>
    </span>
  )

  return (
    <section aria-labelledby="compare-h" data-testid="plan-compare">
      <div className="text-center">
        <h2 id="compare-h" className="text-black font-black text-[24px] md:text-[30px] leading-[1.1] tracking-tight">
          {t('billing.flow.compare_heading', { defaultValue: 'Compare all features' })}
        </h2>
        <p className="mt-2 text-black/45 text-[15px] font-medium max-w-xl mx-auto text-balance">
          {t('billing.flow.compare_subtitle', {
            defaultValue: 'Every paid plan includes unlimited members and courses, 0% platform fees, Atlas AI and course import.',
          })}
        </p>
      </div>

      {/* Desktop: all plans side by side. */}
      <div className="hidden md:block mt-8 rounded-2xl nice-shadow bg-white overflow-hidden">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <th scope="col" className="text-start w-[36%] px-7 py-5 font-semibold text-black/35 shadow-[inset_0_-1px_0_rgba(0,0,0,0.06)]">
                {t('billing.flow.feature', { defaultValue: 'Feature' })}
              </th>
              {cols.map((c, j) => (
                <th
                  key={c.id}
                  scope="col"
                  className={`px-3 py-5 shadow-[inset_0_-1px_0_rgba(0,0,0,0.06)] ${j === currentCol ? ACCENT[c.accent].soft : ''}`}
                >
                  <div className="flex flex-col items-center gap-1.5">
                    <PlanBadge accent={c.accent}>{planName(t, findPlan(c.id)!)}</PlanBadge>
                    {j === currentCol && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-black/40">
                        {t('billing.flow.current_short', { defaultValue: 'Current' })}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          {shown.map((g) => (
            <tbody key={g.key}>
              <tr className="border-t border-black/[0.06] first:border-t-0">
                <th colSpan={1} scope="colgroup" className="px-7 pt-6 pb-2.5 text-start text-[11px] font-bold uppercase tracking-[0.1em] text-black/35">
                  {groupTitle(g.key)}
                </th>
                {cols.map((c, j) => (
                  <td key={c.id} className={j === currentCol ? ACCENT[c.accent].soft : ''} />
                ))}
              </tr>
              {g.rows.map((row) => (
                <tr key={row.key} className="border-t border-black/[0.04]">
                  <th scope="row" className="px-7 py-3 text-start text-black/75 font-medium">
                    {label(row.key, row.icon, g.tint)}
                  </th>
                  {row.cells.map((c, j) => (
                    <td
                      key={j}
                      className={`px-3 py-3 text-center text-black/60 font-medium tabular-nums ${j === currentCol ? ACCENT[cols[j].accent].soft : ''}`}
                    >
                      {cell(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {/* Phone: one plan at a time. */}
      <div className="md:hidden mt-6 rounded-2xl nice-shadow bg-white overflow-hidden">
        <div
          role="tablist"
          aria-label={t('billing.flow.compare_heading', { defaultValue: 'Compare all features' })}
          className="flex items-center justify-between gap-1 px-4 py-3.5 shadow-[inset_0_-1px_0_rgba(0,0,0,0.06)] overflow-x-auto scrollbar-hide"
        >
          {cols.map((c, j) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={mobilePlan === j}
              onClick={() => setMobilePlan(j)}
              className={`rounded-md outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-black/30 ${mobilePlan === j ? '' : 'opacity-35 grayscale'}`}
            >
              <PlanBadge accent={c.accent}>{planName(t, findPlan(c.id)!)}</PlanBadge>
            </button>
          ))}
        </div>
        {shown.map((g) => (
          <div key={g.key} className="border-t border-black/[0.06] first:border-t-0">
            <p className="px-5 pt-5 pb-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-black/35">{groupTitle(g.key)}</p>
            <ul>
              {g.rows.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-4 px-5 py-3 border-t border-black/[0.04] text-[14px]">
                  <span className="min-w-0 text-black/75 font-medium">{label(row.key, row.icon, g.tint)}</span>
                  <span className="flex-shrink-0 text-end text-black/60 font-medium tabular-nums">{cell(row.cells[mobilePlan])}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {groups.length > COLLAPSED_GROUPS && (
        <div className="mt-5 flex justify-center">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            icon={<CaretDown size={14} weight="bold" className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />}
          >
            {expanded
              ? t('billing.flow.show_fewer', { defaultValue: 'Show fewer features' })
              : t('billing.flow.show_all', { defaultValue: 'Show all features' })}
          </Button>
        </div>
      )}
    </section>
  )
}
